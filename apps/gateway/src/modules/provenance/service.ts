/**
 * Provenance reads: the Asset Passport, chain of custody, lineage tree and the Trust Graph.
 * All projections over tables the write paths already maintain — no extra state.
 */
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { accessRequests, approvals, assets, assetTransfers, assetVersions, auditEvents, devices, incidents, policyVersions, users } from "../../db/schema";
import type { AppContext } from "../../context";
import { ApiError } from "../../lib/errors";
import type { AssetRow } from "../vault/service";

export async function getAssetByUid(ctx: Pick<AppContext, "db">, uid: string): Promise<AssetRow> {
  const a = (await ctx.db.select().from(assets).where(eq(assets.assetUid, uid)).limit(1))[0];
  if (!a) throw ApiError.notFound("asset_not_found", `No asset ${uid}.`);
  return a;
}

export async function listAssets(ctx: Pick<AppContext, "db">, forDid: string) {
  const rows = await ctx.db.select().from(assets).where(isNull(assets.deletedAt)).orderBy(desc(assets.createdAt));
  const ownerDids = [...new Set(rows.map((r) => r.ownerDid))];
  const owners = ownerDids.length ? await ctx.db.select({ did: users.did, displayName: users.displayName }).from(users).where(inArray(users.did, ownerDids)) : [];
  const nameOf = new Map(owners.map((o) => [o.did, o.displayName]));
  return rows.map((r) => ({
    assetUid: r.assetUid,
    name: r.name,
    class: r.class,
    sensitivity: r.sensitivity,
    ownerDid: r.ownerDid,
    ownerName: nameOf.get(r.ownerDid) ?? null,
    owned: r.ownerDid === forDid,
    currentVersion: r.currentVersion,
    lineageType: r.lineageType,
    assetTrust: r.assetTrust,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getPassport(ctx: Pick<AppContext, "db" | "ledger">, uid: string) {
  const db = ctx.db;
  const asset = await getAssetByUid(ctx, uid);
  const versions = await db.select().from(assetVersions).where(eq(assetVersions.assetId, asset.id)).orderBy(asc(assetVersions.version));
  const owner = (await db.select().from(users).where(eq(users.did, asset.ownerDid)).limit(1))[0];
  const creator = (await db.select().from(users).where(eq(users.did, asset.createdBy)).limit(1))[0];
  const parent = asset.parentAssetId ? (await db.select().from(assets).where(eq(assets.id, asset.parentAssetId)).limit(1))[0] : null;
  const children = await db.select().from(assets).where(eq(assets.parentAssetId, asset.id));
  const transfers = await db.select().from(assetTransfers).where(eq(assetTransfers.assetId, asset.id)).orderBy(asc(assetTransfers.createdAt));
  const since30d = new Date(Date.now() - 30 * 86_400_000);
  const [access] = await db.select({ n: sql<number>`count(*)::int`, last: sql<string | null>`max(${accessRequests.decidedAt})` }).from(accessRequests).where(eq(accessRequests.assetId, asset.id));
  const [approved] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(approvals)
    .innerJoin(accessRequests, eq(approvals.requestId, accessRequests.id))
    .where(and(eq(accessRequests.assetId, asset.id), eq(approvals.status, "approved")));
  const [incident30] = await db
    .select({ n: sql<number>`count(distinct ${auditEvents.incidentId})::int` })
    .from(auditEvents)
    .where(and(eq(auditEvents.assetUid, uid), gte(auditEvents.createdAt, since30d), sql`${auditEvents.incidentId} is not null`));
  const latest = versions[versions.length - 1];

  let ledgerRecord: unknown = null;
  try {
    ledgerRecord = await ctx.ledger.evaluate("AssetPassport", "Get", [uid]);
  } catch {
    ledgerRecord = null;
  }

  const riskStatus = (incident30?.n ?? 0) > 0 ? "elevated" : "low";
  return {
    assetUid: asset.assetUid,
    name: asset.name,
    mime: asset.mime,
    class: asset.class,
    sensitivity: asset.sensitivity,
    owner: { did: asset.ownerDid, displayName: owner?.displayName ?? null, status: owner?.status ?? "unknown" },
    creator: { did: asset.createdBy, displayName: creator?.displayName ?? null },
    createdAt: asset.createdAt.toISOString(),
    currentVersion: asset.currentVersion,
    versions: versions.map((v) => ({
      version: v.version,
      sha256: v.sha256Plain,
      sha256Cipher: v.sha256Cipher,
      cid: v.cid,
      sizeBytes: v.sizeBytes,
      status: v.status,
      ledgerTxId: v.ledgerTxId,
      block: v.block,
      createdBy: v.createdBy,
      createdAt: v.createdAt.toISOString(),
      parentSha256: v.parentSha256,
    })),
    lineage: {
      type: asset.lineageType,
      parent: parent ? { assetUid: parent.assetUid, name: parent.name, sensitivity: parent.sensitivity } : null,
      children: children.map((c) => ({ assetUid: c.assetUid, name: c.name, lineageType: c.lineageType, sensitivity: c.sensitivity })),
      derivativeStatus: (asset.passportMeta as Record<string, string>).derivativeStatus ?? (asset.parentAssetId ? "authorised" : "root"),
    },
    transfers: transfers.map((t) => ({ fromDid: t.fromDid, toDid: t.toDid, approverDid: t.approverDid, ledgerTxId: t.ledgerTxId, block: t.block, at: t.createdAt.toISOString() })),
    trust: { score: asset.assetTrust, breakdown: asset.trustBreakdown },
    verification: {
      integrity: latest?.status === "anchored",
      ownership: !!owner && owner.status === "active",
      origin: versions.some((v) => v.version === 1 && v.status === "anchored"),
    },
    stats: { accessEvents: access?.n ?? 0, lastAccess: access?.last ?? null, approvals: approved?.n ?? 0, incidents30d: incident30?.n ?? 0, riskStatus },
    passportMeta: asset.passportMeta,
    ledger: { record: ledgerRecord, latestTxId: latest?.ledgerTxId ?? null, latestBlock: latest?.block ?? null },
  };
}

export async function getCustody(ctx: Pick<AppContext, "db">, uid: string) {
  const db = ctx.db;
  await getAssetByUid(ctx, uid);
  const events = await db.select().from(auditEvents).where(eq(auditEvents.assetUid, uid)).orderBy(asc(auditEvents.seq));
  const requestIds = [...new Set(events.map((e) => e.requestId).filter((x): x is string => !!x))];
  const reqs = requestIds.length ? await db.select().from(accessRequests).where(inArray(accessRequests.id, requestIds)) : [];
  const reqById = new Map(reqs.map((r) => [r.id, r]));
  const dids = [...new Set(events.map((e) => e.actorDid).filter((x): x is string => !!x))];
  const people = dids.length ? await db.select({ did: users.did, displayName: users.displayName, role: users.role }).from(users).where(inArray(users.did, dids)) : [];
  const personOf = new Map(people.map((p) => [p.did, p]));
  const pvIds = [...new Set(reqs.map((r) => r.policyVersionId).filter((x): x is string => !!x))];
  const pvs = pvIds.length ? await db.select().from(policyVersions).where(inArray(policyVersions.id, pvIds)) : [];
  const pvById = new Map(pvs.map((p) => [p.id, p]));
  const approvalIds = [...new Set(reqs.map((r) => r.approvalId).filter((x): x is string => !!x))];
  const aps = approvalIds.length ? await db.select().from(approvals).where(inArray(approvals.id, approvalIds)) : [];
  const apById = new Map(aps.map((a) => [a.id, a]));

  return events.map((e) => {
    const r = e.requestId ? reqById.get(e.requestId) : undefined;
    const pv = r?.policyVersionId ? pvById.get(r.policyVersionId) : undefined;
    const ap = r?.approvalId ? apById.get(r.approvalId) : undefined;
    const who = e.actorDid ? personOf.get(e.actorDid) : undefined;
    return {
      seq: e.seq,
      at: e.createdAt.toISOString(),
      eventType: e.eventType,
      who: e.actorDid ? { did: e.actorDid, displayName: who?.displayName ?? null, role: who?.role ?? null } : null,
      action: r?.action ?? (e.payload.action as string | undefined) ?? null,
      decision: r?.decision ?? null,
      reasons: r?.reasons ?? [],
      policy: pv ? { key: pv.key, version: pv.version, hash: pv.specHash } : null,
      risk: r ? { score: r.riskScore, tier: r.riskTier } : null,
      approval: ap ? { status: ap.status, approverDid: ap.approverDid } : null,
      chainHash: e.chainHash,
      ledgerTxId: e.ledgerTxId,
      block: e.block,
      incidentId: e.incidentId,
      payload: e.payload,
    };
  });
}

export async function getLineage(ctx: Pick<AppContext, "db">, uid: string) {
  const asset = await getAssetByUid(ctx, uid);
  const ancestors: { assetUid: string; name: string; sensitivity: string; lineageType: string }[] = [];
  let cursor = asset;
  for (let i = 0; i < 20 && cursor.parentAssetId; i++) {
    const p = (await ctx.db.select().from(assets).where(eq(assets.id, cursor.parentAssetId)).limit(1))[0];
    if (!p) break;
    ancestors.unshift({ assetUid: p.assetUid, name: p.name, sensitivity: p.sensitivity, lineageType: p.lineageType });
    cursor = p;
  }
  const descend = async (a: AssetRow, depth: number): Promise<unknown[]> => {
    if (depth > 5) return [];
    const kids = await ctx.db.select().from(assets).where(eq(assets.parentAssetId, a.id));
    return Promise.all(
      kids.map(async (k) => ({
        assetUid: k.assetUid,
        name: k.name,
        sensitivity: k.sensitivity,
        lineageType: k.lineageType,
        derivativeStatus: (k.passportMeta as Record<string, string>).derivativeStatus ?? "authorised",
        children: await descend(k, depth + 1),
      })),
    );
  };
  return {
    self: { assetUid: asset.assetUid, name: asset.name, sensitivity: asset.sensitivity, lineageType: asset.lineageType },
    ancestors,
    children: await descend(asset, 0),
  };
}

export interface GraphNode {
  id: string;
  kind: "asset" | "person" | "device" | "policy" | "request" | "decision" | "audit" | "block" | "incident";
  label: string;
  meta?: Record<string, unknown>;
}
export interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

/** The Trust Graph: everything connected to an asset, as nodes and edges. */
export async function getGraph(ctx: Pick<AppContext, "db">, uid: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const db = ctx.db;
  const asset = await getAssetByUid(ctx, uid);
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const add = (n: GraphNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  add({ id: `asset:${uid}`, kind: "asset", label: asset.name, meta: { assetUid: uid, sensitivity: asset.sensitivity, trust: asset.assetTrust } });

  const dids = new Set<string>([asset.ownerDid, asset.createdBy]);
  const reqs = await db.select().from(accessRequests).where(eq(accessRequests.assetId, asset.id)).orderBy(desc(accessRequests.decidedAt)).limit(25);
  for (const r of reqs) dids.add(r.actorDid);
  const people = await db.select().from(users).where(inArray(users.did, [...dids]));
  for (const p of people) add({ id: `person:${p.did}`, kind: "person", label: p.displayName, meta: { did: p.did, role: p.role, trust: p.identityTrust, status: p.status } });
  edges.push({ from: `person:${asset.ownerDid}`, to: `asset:${uid}`, label: "owns" });
  if (asset.createdBy !== asset.ownerDid) edges.push({ from: `person:${asset.createdBy}`, to: `asset:${uid}`, label: "created" });

  const deviceIds = [...new Set(reqs.map((r) => r.deviceId).filter((x): x is string => !!x))];
  const devs = deviceIds.length ? await db.select().from(devices).where(inArray(devices.id, deviceIds)) : [];
  const devOwner = new Map(people.map((p) => [p.id, p.did]));
  for (const d of devs) {
    add({ id: `device:${d.id}`, kind: "device", label: d.label ?? `device ${d.fingerprintHash.slice(0, 6)}`, meta: { trust: d.deviceTrust, trusted: d.trusted } });
    const ownerDid = devOwner.get(d.userId);
    if (ownerDid) edges.push({ from: `person:${ownerDid}`, to: `device:${d.id}`, label: "uses" });
  }

  const pvIds = [...new Set(reqs.map((r) => r.policyVersionId).filter((x): x is string => !!x))];
  const pvs = pvIds.length ? await db.select().from(policyVersions).where(inArray(policyVersions.id, pvIds)) : [];
  for (const p of pvs) add({ id: `policy:${p.id}`, kind: "policy", label: `${p.key} v${p.version}`, meta: { hash: p.specHash } });

  const evs = reqs.length ? await db.select().from(auditEvents).where(inArray(auditEvents.requestId, reqs.map((r) => r.id))) : [];
  const evByReq = new Map<string, typeof evs>();
  for (const e of evs) {
    const list = evByReq.get(e.requestId!) ?? [];
    list.push(e);
    evByReq.set(e.requestId!, list);
  }
  const incidentIds = [...new Set(reqs.map((r) => r.incidentId).filter((x): x is string => !!x))];
  const incs = incidentIds.length ? await db.select().from(incidents).where(inArray(incidents.incidentId, incidentIds)) : [];
  for (const i of incs) add({ id: `incident:${i.incidentId}`, kind: "incident", label: i.incidentId, meta: { severity: i.severity, status: i.status } });

  for (const r of reqs) {
    add({ id: `request:${r.id}`, kind: "request", label: r.action.replace("asset.", ""), meta: { risk: r.riskScore, tier: r.riskTier, at: r.decidedAt.toISOString() } });
    edges.push({ from: `person:${r.actorDid}`, to: `request:${r.id}`, label: "requested" });
    edges.push({ from: `request:${r.id}`, to: `asset:${uid}`, label: "on" });
    if (r.deviceId && nodes.has(`device:${r.deviceId}`)) edges.push({ from: `device:${r.deviceId}`, to: `request:${r.id}`, label: "from" });
    add({ id: `decision:${r.id}`, kind: "decision", label: r.decision, meta: { reasons: r.reasons } });
    edges.push({ from: `request:${r.id}`, to: `decision:${r.id}`, label: "decided" });
    if (r.policyVersionId) edges.push({ from: `policy:${r.policyVersionId}`, to: `decision:${r.id}`, label: "under" });
    const first = evByReq.get(r.id)?.sort((a, b) => a.seq - b.seq)[0];
    if (first) {
      add({ id: `audit:${first.id}`, kind: "audit", label: `#${first.seq}`, meta: { chainHash: first.chainHash } });
      edges.push({ from: `decision:${r.id}`, to: `audit:${first.id}`, label: "recorded" });
      if (first.block !== null) {
        add({ id: `block:${first.block}`, kind: "block", label: `block ${first.block}`, meta: { txId: first.ledgerTxId } });
        edges.push({ from: `audit:${first.id}`, to: `block:${first.block}`, label: "anchored" });
      }
    }
    if (r.incidentId) edges.push({ from: `decision:${r.id}`, to: `incident:${r.incidentId}`, label: "escalated" });
  }
  return { nodes: [...nodes.values()], edges };
}
