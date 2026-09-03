/**
 * Trust state: persistent identity/device trust with a full event history, and asset trust
 * recomputed from provenance/audit facts. Pure maths lives in @vajra/trust; this module does the I/O.
 */
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import {
  applyDeviceTrust,
  applyIdentityTrust,
  computeAssetTrust,
  isDeviceTrusted,
  type AssetTrustResult,
  type DeviceTrustEvent,
  type IdentityTrustEvent,
} from "@vajra/trust";
import type { Db } from "../../db/client";
import { accessRequests, approvals, assetVersions, assets, assetTransfers, auditEvents, devices, trustEvents, users } from "../../db/schema";
import type { AppContext } from "../../context";
import type { DeviceRow, UserRow } from "../identity/session";

export async function bumpIdentityTrust(db: Db, user: UserRow, event: IdentityTrustEvent, refId: string | null): Promise<number> {
  const { next, delta } = applyIdentityTrust(user.identityTrust, event);
  if (delta !== 0 || event === "onboarded") {
    await db.update(users).set({ identityTrust: next }).where(eq(users.id, user.id));
    await db.insert(trustEvents).values({ subjectType: "identity", subjectId: user.did, delta, reason: event, scoreAfter: next, refId });
  }
  user.identityTrust = next;
  return next;
}

export async function bumpDeviceTrust(db: Db, device: DeviceRow, event: DeviceTrustEvent, refId: string | null): Promise<number> {
  const { next, delta } = applyDeviceTrust(device.deviceTrust, event);
  if (delta !== 0 || event === "first_seen") {
    await db.update(devices).set({ deviceTrust: next, trusted: isDeviceTrusted(next) }).where(eq(devices.id, device.id));
    await db.insert(trustEvents).values({ subjectType: "device", subjectId: device.id, delta, reason: event, scoreAfter: next, refId });
  }
  device.deviceTrust = next;
  device.trusted = isDeviceTrusted(next);
  return next;
}

export async function listTrustEvents(db: Db, subjectType: "identity" | "device" | "asset", subjectId: string, limit = 100) {
  return db
    .select()
    .from(trustEvents)
    .where(and(eq(trustEvents.subjectType, subjectType), eq(trustEvents.subjectId, subjectId)))
    .orderBy(desc(trustEvents.createdAt))
    .limit(limit);
}

/** After the outbox anchors a version, the asset's origin and version facts changed — recompute. */
export async function recomputeAssetTrustForVersion(ctx: Pick<AppContext, "db" | "storage">, assetVersionId: string): Promise<void> {
  const row = (await ctx.db.select({ assetId: assetVersions.assetId }).from(assetVersions).where(eq(assetVersions.id, assetVersionId)).limit(1))[0];
  if (row) await recomputeAssetTrust(ctx, row.assetId);
}

/** Gather the facts behind an asset's trust score and persist the result. */
export async function recomputeAssetTrust(ctx: Pick<AppContext, "db" | "storage">, assetId: string): Promise<AssetTrustResult | null> {
  const db = ctx.db;
  const asset = (await db.select().from(assets).where(eq(assets.id, assetId)).limit(1))[0];
  if (!asset) return null;
  const since30d = new Date(Date.now() - 30 * 86_400_000);

  const versions = await db.select().from(assetVersions).where(eq(assetVersions.assetId, assetId)).orderBy(desc(assetVersions.version));
  const latest = versions[0];
  const creator = (await db.select().from(users).where(eq(users.did, asset.createdBy)).limit(1))[0];
  const owner = (await db.select().from(users).where(eq(users.did, asset.ownerDid)).limit(1))[0];
  const transfers = await db.select().from(assetTransfers).where(eq(assetTransfers.assetId, assetId));

  const [incidentRow] = await db
    .select({ n: sql<number>`count(distinct ${auditEvents.incidentId})::int` })
    .from(auditEvents)
    .where(and(eq(auditEvents.assetUid, asset.assetUid), gte(auditEvents.createdAt, since30d), sql`${auditEvents.incidentId} is not null`));
  const [deniedRow] = await db
    .select({ n: count() })
    .from(accessRequests)
    .where(and(eq(accessRequests.assetId, assetId), eq(accessRequests.decision, "DENY"), gte(accessRequests.decidedAt, since30d)));

  const reqs = await db
    .select({ deviceTrust: accessRequests.deviceTrust, approvalId: accessRequests.approvalId })
    .from(accessRequests)
    .where(and(eq(accessRequests.assetId, assetId), sql`${accessRequests.decision} in ('ALLOW','STEP_UP','PENDING_APPROVAL')`));
  const trustedShare = reqs.length === 0 ? null : reqs.filter((r) => isDeviceTrusted(r.deviceTrust)).length / reqs.length;

  const approvalIds = reqs.map((r) => r.approvalId).filter((x): x is string => !!x);
  let approvalsPresent = 0;
  if (approvalIds.length) {
    const rows = await db.select().from(approvals).where(sql`${approvals.id} in ${approvalIds}`);
    approvalsPresent = rows.filter((r) => r.status === "approved").length;
  }

  let integrityOk = true;
  if (latest) {
    try {
      integrityOk = await ctx.storage.verify(latest.cid, latest.sha256Cipher);
    } catch {
      integrityOk = false;
    }
  }

  const result = computeAssetTrust({
    originVerified: !!creator && versions.some((v) => v.version === 1 && v.status === "anchored"),
    ownerValid: !!owner && owner.status === "active",
    transferChainConsistent: transfers.every((t) => !!t.ledgerTxId) || transfers.length === 0,
    versionsAnchored: versions.filter((v) => v.status === "anchored").length,
    versionsTotal: versions.length,
    incidentsLast30d: incidentRow?.n ?? 0,
    deniedAttempts: Number(deniedRow?.n ?? 0),
    trustedDeviceShare: trustedShare,
    approvalsRequired: approvalIds.length,
    approvalsPresent,
    integrityOk,
    metadataComplete: !!asset.name && Object.keys(asset.passportMeta ?? {}).length > 0,
  });

  if (asset.assetTrust !== result.score) {
    await db.insert(trustEvents).values({
      subjectType: "asset",
      subjectId: asset.assetUid,
      delta: result.score - asset.assetTrust,
      reason: "recomputed",
      scoreAfter: result.score,
      refId: null,
    });
  }
  await db.update(assets).set({ assetTrust: result.score, trustBreakdown: result.breakdown }).where(eq(assets.id, assetId));
  return result;
}
