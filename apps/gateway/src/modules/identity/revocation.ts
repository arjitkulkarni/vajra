/**
 * Revocation cascade — one transaction, in order:
 *   VC → sessions (session_version bump) → device trust → grants → pending approvals → live content URLs
 *   → identity trust 0 → audit event → DIDRegistry.RevokeDID on the ledger.
 */
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { accessRequests, approvals, credentials, devices, grants, users } from "../../db/schema";
import { withTx, type AppContext } from "../../context";
import { sha256Hex } from "../../lib/crypto";
import { appendAudit } from "../audit/service";
import { enqueueLedger } from "../ledger/outbox";
import { bumpDeviceTrust, bumpIdentityTrust } from "../trust/service";
import type { UserRow } from "./session";

export interface RevocationSummary {
  did: string;
  steps: { step: string; count: number }[];
  auditEventId: string;
}

export async function revokeIdentity(ctx: AppContext, target: UserRow, admin: UserRow, reason: string): Promise<RevocationSummary> {
  const now = new Date();
  const steps: RevocationSummary["steps"] = [];
  const auditEventId = await withTx(ctx.db, async (tx) => {
    // 1 credential
    const creds = await tx.update(credentials).set({ status: "revoked", revokedAt: now, revokeReason: reason }).where(and(eq(credentials.userId, target.id), eq(credentials.status, "active"))).returning({ id: credentials.id });
    steps.push({ step: "credential_revoked", count: creds.length });
    // 2 sessions
    await tx.update(users).set({ status: "revoked", revokedAt: now, sessionVersion: target.sessionVersion + 1 }).where(eq(users.id, target.id));
    steps.push({ step: "sessions_killed", count: 1 });
    // 3 devices
    const devs = await tx.select().from(devices).where(eq(devices.userId, target.id));
    for (const d of devs) await bumpDeviceTrust(tx, d, "owner_revoked", null);
    steps.push({ step: "devices_untrusted", count: devs.length });
    // 4 grants
    const g = await tx.update(grants).set({ revokedAt: now }).where(and(eq(grants.userId, target.id), isNull(grants.revokedAt))).returning({ id: grants.id });
    steps.push({ step: "grants_removed", count: g.length });
    // 5 pending approvals they requested or must decide
    const a = await tx
      .update(approvals)
      .set({ status: "cancelled", reason: "identity_revoked", decidedAt: now })
      .where(and(eq(approvals.status, "pending"), or(eq(approvals.requesterDid, target.did), eq(approvals.approverDid, target.did))))
      .returning({ id: approvals.id });
    steps.push({ step: "approvals_cancelled", count: a.length });
    // 6 live content URLs and open requests
    const r = await tx
      .update(accessRequests)
      .set({ expiresAt: now, contentUsed: true })
      .where(and(eq(accessRequests.userId, target.id), or(gt(accessRequests.expiresAt, now), sql`${accessRequests.decision} in ('STEP_UP','PENDING_APPROVAL')`)))
      .returning({ id: accessRequests.id });
    steps.push({ step: "content_urls_expired", count: r.length });
    // 7 trust
    await bumpIdentityTrust(tx, target, "revoked", null);
    steps.push({ step: "identity_trust_zeroed", count: 1 });
    // 8 evidence + ledger
    const ev = await appendAudit(
      { db: tx },
      { eventType: "identity.revoked", actorDid: admin.did, payload: { targetDid: target.did, reasonHash: sha256Hex(reason), steps } },
      tx,
    );
    await enqueueLedger(tx, { contract: "DIDRegistry", fn: "RevokeDID", args: [target.did, sha256Hex(reason)] });
    return ev.id;
  });
  return { did: target.did, steps, auditEventId };
}
