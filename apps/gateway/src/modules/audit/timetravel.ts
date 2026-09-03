/**
 * Time-travel: "what did the organisation believe was true at <timestamp>?"
 * Reconstructed purely from event streams — no snapshots. Because decide() is a pure function,
 * the effective permissions at that moment come for free.
 */
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import type { Role } from "@vajra/contracts";
import { effectivePermissions } from "@vajra/policy";
import { accessRequests, assets, assetTransfers, assetVersions, auditEvents, devices, incidents, policyVersions, trustEvents, users } from "../../db/schema";
import type { AppContext } from "../../context";
import { ApiError } from "../../lib/errors";
import { toPolicyVersion } from "../policy/store";

export async function reconstructAt(ctx: Pick<AppContext, "db">, at: Date, subject: { did?: string; assetUid?: string }) {
  const db = ctx.db;
  const out: Record<string, unknown> = { at: at.toISOString() };

  const pvs = await db
    .select()
    .from(policyVersions)
    .where(and(lte(policyVersions.activeFrom, at), sql`(${policyVersions.activeTo} is null or ${policyVersions.activeTo} > ${at})`))
    .orderBy(policyVersions.key);
  out.policies = pvs.map(toPolicyVersion);

  if (subject.did) {
    const user = (await db.select().from(users).where(eq(users.did, subject.did)).limit(1))[0];
    if (!user) throw ApiError.notFound("user_not_found");
    if (user.createdAt > at) {
      out.user = { did: user.did, existed: false };
    } else {
      const revoked = (await db.select().from(auditEvents).where(and(eq(auditEvents.eventType, "identity.revoked"), lte(auditEvents.createdAt, at), sql`${auditEvents.payload} ->> 'targetDid' = ${user.did}`)).limit(1))[0];
      const lastTrust = (await db.select().from(trustEvents).where(and(eq(trustEvents.subjectType, "identity"), eq(trustEvents.subjectId, user.did), lte(trustEvents.createdAt, at))).orderBy(desc(trustEvents.createdAt)).limit(1))[0];
      const identityTrust = lastTrust?.scoreAfter ?? 60;
      const devs = await db.select().from(devices).where(and(eq(devices.userId, user.id), lte(devices.firstSeen, at)));
      const deviceStates = [];
      for (const d of devs) {
        const lt = (await db.select().from(trustEvents).where(and(eq(trustEvents.subjectType, "device"), eq(trustEvents.subjectId, d.id), lte(trustEvents.createdAt, at))).orderBy(desc(trustEvents.createdAt)).limit(1))[0];
        deviceStates.push({ id: d.id, fingerprint: d.fingerprintHash.slice(0, 8), deviceTrust: lt?.scoreAfter ?? 40, trusted: (lt?.scoreAfter ?? 40) >= 60 });
      }
      const inc = (await db.select().from(incidents).where(and(eq(incidents.actorDid, user.did), lte(incidents.openedAt, at), sql`(${incidents.closedAt} is null or ${incidents.closedAt} > ${at})`)).orderBy(desc(incidents.openedAt)).limit(1))[0];
      const bestDevice = deviceStates.reduce((m, d) => (d.deviceTrust > m ? d.deviceTrust : m), 0);
      const window = 30 * 60_000;
      const decisions = await db
        .select()
        .from(accessRequests)
        .where(and(eq(accessRequests.userId, user.id), sql`${accessRequests.decidedAt} between ${new Date(at.getTime() - window)} and ${new Date(at.getTime() + window)}`))
        .orderBy(asc(accessRequests.decidedAt));
      out.user = {
        did: user.did,
        existed: true,
        displayName: user.displayName,
        role: user.role,
        status: revoked ? "revoked" : "active",
        identityTrust,
        devices: deviceStates,
        openIncident: inc ? { incidentId: inc.incidentId, severity: inc.severity } : null,
        effectivePermissions: effectivePermissions({ role: user.role as Role, trust: { identity: identityTrust, device: bestDevice }, riskTier: "low", incidentSeverity: (inc?.severity as "S1" | "S2" | "S3" | undefined) ?? null, revoked: !!revoked }),
        decisionsNearby: decisions.map((d) => ({ id: d.id, at: d.decidedAt.toISOString(), action: d.action, assetUid: d.assetUid, decision: d.decision, reasons: d.reasons, risk: d.riskScore, policyVersionId: d.policyVersionId })),
      };
    }
  }

  if (subject.assetUid) {
    const asset = (await db.select().from(assets).where(eq(assets.assetUid, subject.assetUid)).limit(1))[0];
    if (!asset) throw ApiError.notFound("asset_not_found");
    if (asset.createdAt > at) {
      out.asset = { assetUid: asset.assetUid, existed: false };
    } else {
      const transfers = await db.select().from(assetTransfers).where(and(eq(assetTransfers.assetId, asset.id), lte(assetTransfers.createdAt, at))).orderBy(asc(assetTransfers.createdAt));
      const ownerDid = transfers.length ? transfers[transfers.length - 1]!.toDid : asset.createdBy;
      const ver = (await db.select().from(assetVersions).where(and(eq(assetVersions.assetId, asset.id), lte(assetVersions.createdAt, at))).orderBy(desc(assetVersions.version)).limit(1))[0];
      const lt = (await db.select().from(trustEvents).where(and(eq(trustEvents.subjectType, "asset"), eq(trustEvents.subjectId, asset.assetUid), lte(trustEvents.createdAt, at))).orderBy(desc(trustEvents.createdAt)).limit(1))[0];
      const owner = (await db.select({ displayName: users.displayName }).from(users).where(eq(users.did, ownerDid)).limit(1))[0];
      out.asset = {
        assetUid: asset.assetUid,
        existed: true,
        name: asset.name,
        sensitivity: asset.sensitivity,
        owner: { did: ownerDid, displayName: owner?.displayName ?? null },
        version: ver ? { version: ver.version, sha256: ver.sha256Plain, cid: ver.cid, anchored: !!ver.ledgerTxId } : null,
        assetTrust: lt?.scoreAfter ?? null,
        transfersSoFar: transfers.length,
      };
    }
  }
  return out;
}
