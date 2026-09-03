/**
 * The hash-chained audit log.
 *
 *   payload_hash(n) = sha256(canonical_json(payload))
 *   chain_hash(n)   = sha256(chain_hash(n-1) ∥ payload_hash(n))
 *
 * Every mutation in the gateway is written through here (event-sourcing-lite), and every chain hash
 * is queued for anchoring on the ledger. Denials are events too — they are evidence.
 */
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { auditEvents } from "../../db/schema";
import { withTx, type AppContext } from "../../context";
import { hashJson, sha256Hex } from "../../lib/crypto";
import { enqueueLedger } from "../ledger/outbox";
import { GENESIS_HASH } from "../ledger/types";

export type AuditEventRow = typeof auditEvents.$inferSelect;

export interface AppendAuditInput {
  eventType: string;
  actorDid?: string | null;
  assetUid?: string | null;
  requestId?: string | null;
  incidentId?: string | null;
  payload: Record<string, unknown>;
  anchor?: boolean;
}

export async function appendAudit(ctx: Pick<AppContext, "db">, input: AppendAuditInput, tx?: Db): Promise<AuditEventRow> {
  const run = async (t: Db): Promise<AuditEventRow> => {
    await t.execute(sql`select pg_advisory_xact_lock(4242)`);
    const last = (await t.select({ chainHash: auditEvents.chainHash }).from(auditEvents).orderBy(desc(auditEvents.seq)).limit(1))[0];
    const prevHash = last?.chainHash ?? GENESIS_HASH;
    const payload = { ...input.payload, eventType: input.eventType, actorDid: input.actorDid ?? null, assetUid: input.assetUid ?? null };
    const payloadHash = hashJson(payload);
    const chainHash = sha256Hex(prevHash + payloadHash);
    const [row] = await t
      .insert(auditEvents)
      .values({
        eventType: input.eventType,
        actorDid: input.actorDid ?? null,
        assetUid: input.assetUid ?? null,
        requestId: input.requestId ?? null,
        incidentId: input.incidentId ?? null,
        payload,
        payloadHash,
        prevHash,
        chainHash,
      })
      .returning();
    if (input.anchor !== false) {
      const summaryHash = hashJson({ eventType: input.eventType, actorDid: input.actorDid ?? null, assetUid: input.assetUid ?? null });
      await enqueueLedger(t, {
        contract: "AuditTrail",
        fn: "AnchorEvent",
        args: [row!.id, chainHash, input.eventType, summaryHash],
        refTable: "audit_events",
        refId: row!.id,
      });
    }
    return row!;
  };
  return tx ? run(tx) : withTx(ctx.db, run);
}

export interface AuditFilter {
  actorDid?: string;
  assetUid?: string;
  incidentId?: string;
  requestId?: string;
  eventType?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  order?: "asc" | "desc";
}

export async function listAudit(db: Db, f: AuditFilter): Promise<AuditEventRow[]> {
  const conds = [];
  if (f.actorDid) conds.push(eq(auditEvents.actorDid, f.actorDid));
  if (f.assetUid) conds.push(eq(auditEvents.assetUid, f.assetUid));
  if (f.incidentId) conds.push(eq(auditEvents.incidentId, f.incidentId));
  if (f.requestId) conds.push(eq(auditEvents.requestId, f.requestId));
  if (f.eventType) conds.push(eq(auditEvents.eventType, f.eventType));
  if (f.since) conds.push(gte(auditEvents.createdAt, f.since));
  if (f.until) conds.push(lte(auditEvents.createdAt, f.until));
  const q = db
    .select()
    .from(auditEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(f.order === "asc" ? asc(auditEvents.seq) : desc(auditEvents.seq))
    .limit(Math.min(f.limit ?? 100, 1000));
  return q;
}

export async function getAuditEvent(db: Db, id: string): Promise<AuditEventRow | null> {
  return (await db.select().from(auditEvents).where(eq(auditEvents.id, id)).limit(1))[0] ?? null;
}

/** Recompute the chain over a range; returns the first sequence number that breaks, if any. */
export async function verifyAuditChain(db: Db, fromSeq = 1, toSeq?: number): Promise<{ ok: boolean; checked: number; brokenAtSeq: number | null }> {
  const prevRow = fromSeq > 1 ? (await db.select().from(auditEvents).where(eq(auditEvents.seq, fromSeq - 1)).limit(1))[0] : null;
  let prev = prevRow?.chainHash ?? GENESIS_HASH;
  const conds = [gte(auditEvents.seq, fromSeq)];
  if (toSeq !== undefined) conds.push(lte(auditEvents.seq, toSeq));
  const rows = await db.select().from(auditEvents).where(and(...conds)).orderBy(asc(auditEvents.seq));
  let checked = 0;
  for (const r of rows) {
    const payloadHash = hashJson(r.payload);
    const expected = sha256Hex(prev + payloadHash);
    if (r.payloadHash !== payloadHash || r.prevHash !== prev || r.chainHash !== expected) return { ok: false, checked, brokenAtSeq: r.seq };
    prev = r.chainHash;
    checked += 1;
  }
  return { ok: true, checked, brokenAtSeq: null };
}

export function publicAuditEvent(r: AuditEventRow) {
  return {
    id: r.id,
    seq: r.seq,
    eventType: r.eventType,
    actorDid: r.actorDid,
    assetUid: r.assetUid,
    requestId: r.requestId,
    incidentId: r.incidentId,
    payload: r.payload,
    payloadHash: r.payloadHash,
    prevHash: r.prevHash,
    chainHash: r.chainHash,
    ledgerTxId: r.ledgerTxId,
    block: r.block,
    anchoredAt: r.anchoredAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
