/**
 * Versioned policy-as-code. A policy is never edited: a new version is created, the previous one is
 * closed, and both facts are anchored on the ledger. Decisions cite the exact version they ran under.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { PolicySpecSchema, type PolicySpec, type PolicySpecInput, type PolicyVersion } from "@vajra/contracts";
import type { Db } from "../../db/client";
import { policies, policyVersions } from "../../db/schema";
import { withTx, type AppContext } from "../../context";
import { hashJson } from "../../lib/crypto";
import { appendAudit } from "../audit/service";
import { enqueueLedger } from "../ledger/outbox";

export type PolicyVersionRow = typeof policyVersions.$inferSelect;

export function toPolicyVersion(r: PolicyVersionRow): PolicyVersion {
  return {
    id: r.id,
    key: r.key,
    version: r.version,
    hash: r.specHash,
    spec: PolicySpecSchema.parse(r.spec),
    activeFrom: r.activeFrom.toISOString(),
    activeTo: r.activeTo?.toISOString() ?? null,
    ledgerTxId: r.ledgerTxId,
  };
}

export async function listActivePolicyVersions(db: Db, at = new Date()): Promise<PolicyVersion[]> {
  const rows = await db
    .select()
    .from(policyVersions)
    .where(and(sql`${policyVersions.activeFrom} <= ${at}`, sql`(${policyVersions.activeTo} is null or ${policyVersions.activeTo} > ${at})`))
    .orderBy(policyVersions.key, desc(policyVersions.version));
  return rows.map(toPolicyVersion);
}

export async function listAllPolicyVersions(db: Db): Promise<PolicyVersion[]> {
  const rows = await db.select().from(policyVersions).orderBy(policyVersions.key, desc(policyVersions.version));
  return rows.map(toPolicyVersion);
}

export async function getPolicyVersion(db: Db, id: string): Promise<PolicyVersion | null> {
  const r = (await db.select().from(policyVersions).where(eq(policyVersions.id, id)).limit(1))[0];
  return r ? toPolicyVersion(r) : null;
}

export async function createPolicyVersion(ctx: Pick<AppContext, "db">, input: PolicySpecInput, createdByDid: string | null): Promise<PolicyVersion> {
  const spec: PolicySpec = PolicySpecSchema.parse(input);
  const specHash = hashJson(spec);
  return withTx(ctx.db, async (tx) => {
    let policy = (await tx.select().from(policies).where(eq(policies.key, spec.key)).limit(1))[0];
    if (!policy) {
      policy = (await tx.insert(policies).values({ key: spec.key, name: spec.name }).returning())[0]!;
    } else if (policy.name !== spec.name) {
      await tx.update(policies).set({ name: spec.name }).where(eq(policies.id, policy.id));
    }
    const now = new Date();
    const current = (
      await tx
        .select()
        .from(policyVersions)
        .where(and(eq(policyVersions.policyId, policy.id), isNull(policyVersions.activeTo)))
        .orderBy(desc(policyVersions.version))
        .limit(1)
    )[0];
    if (current) {
      await tx.update(policyVersions).set({ activeTo: now }).where(eq(policyVersions.id, current.id));
      await enqueueLedger(tx, { contract: "PolicyRegistry", fn: "ClosePolicyVersion", args: [spec.key, String(current.version), now.toISOString()] });
    }
    const latest = (await tx.select({ v: sql<number>`coalesce(max(${policyVersions.version}), 0)::int` }).from(policyVersions).where(eq(policyVersions.policyId, policy.id)))[0];
    const version = (latest?.v ?? 0) + 1;
    const [row] = await tx
      .insert(policyVersions)
      .values({ policyId: policy.id, key: spec.key, version, spec, specHash, activeFrom: now, createdBy: createdByDid })
      .returning();
    await enqueueLedger(tx, {
      contract: "PolicyRegistry",
      fn: "AnchorPolicyVersion",
      args: [spec.key, String(version), specHash, now.toISOString()],
      refTable: "policy_versions",
      refId: row!.id,
    });
    await appendAudit(
      { db: tx },
      {
        eventType: "policy.version_created",
        actorDid: createdByDid,
        payload: { key: spec.key, version, specHash, previousVersion: current?.version ?? null, effect: spec.effect, action: spec.action },
      },
      tx,
    );
    return toPolicyVersion(row!);
  });
}
