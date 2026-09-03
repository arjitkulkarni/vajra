/**
 * Incident engine — where the risk engine changes the security posture instead of just scoring.
 *
 * Detection (per DID, 15-minute window)         Response ladder
 *   risk tier high                     → S2       S1  force step-up everywhere           (trust −10)
 *   ≥2 failed liveness                 → S2       S2  freeze high/critical actions       (trust −30)
 *   ≥3 distinct anomaly signals        → S2       S3  lock session · expire URLs · revoke temp grants
 *   burst/volume on a sensitive asset  → S3           · alert security · anchor the incident
 *   unauthorised derivative upload     → S2
 *   live AI check says spoof           → S3
 */
import { and, asc, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { IncidentSeverity, RiskResult } from "@vajra/contracts";
import { accessRequests, auditEvents, grants, incidents, livenessAttestations, trustEvents, users } from "../../db/schema";
import { withTx, type AppContext } from "../../context";
import { ApiError } from "../../lib/errors";
import { appendAudit } from "../audit/service";
import { enqueueLedger } from "../ledger/outbox";
import type { UserRow } from "../identity/session";
import { bumpIdentityTrust } from "../trust/service";

export type IncidentRow = typeof incidents.$inferSelect;

const SEV_RANK: Record<IncidentSeverity, number> = { S1: 1, S2: 2, S3: 3 };
const WINDOW_MS = 15 * 60_000;

export async function openIncidentFor(db: AppContext["db"], actorDid: string): Promise<IncidentRow | null> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  return (
    (await db.select().from(incidents).where(and(eq(incidents.actorDid, actorDid), eq(incidents.status, "open"), gte(incidents.openedAt, since))).orderBy(desc(incidents.openedAt)).limit(1))[0] ?? null
  );
}

export interface EvaluateInput {
  user: UserRow;
  risk: RiskResult;
  requestId: string | null;
  auditEventId: string | null;
  assetUid: string | null;
  sensitive: boolean;
  /** an attestation just failed (step-up / approval) */
  livenessFailed?: boolean;
  /**
   * The live AI check called this capture a presentation attack — a print, a replay, a rendered
   * face held up to the lens.
   *
   * It goes straight to S3 on the first occurrence, where a merely failed liveness check needs two.
   * The difference is what the evidence says about intent: a low passive score is usually bad light
   * or a person who did not blink when asked, and locking someone out of their own account for that
   * would be its own kind of failure. A model that has just watched a screen being held up in front
   * of a camera is not describing a bad afternoon, and the session it belongs to is not one to leave
   * open while somebody looks into it.
   */
  presentationAttack?: boolean;
  unauthorisedDerivative?: boolean;
}

export interface EvaluateResult {
  incident: IncidentRow | null;
  opened: boolean;
  escalated: boolean;
  responses: string[];
}

export async function evaluateIncident(ctx: AppContext, i: EvaluateInput): Promise<EvaluateResult> {
  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_MS);
  const [failed] = await ctx.db
    .select({ n: count() })
    .from(livenessAttestations)
    .where(and(eq(livenessAttestations.userId, i.user.id), eq(livenessAttestations.verified, false), gte(livenessAttestations.createdAt, since)));
  const failedCount = Number(failed?.n ?? 0);

  const anomaly = i.risk.signals.filter((s) => s !== "new_user" && s !== "risk_service_unavailable");
  const triggers: { rule: string; severity: IncidentSeverity }[] = [];
  if (i.risk.tier === "high") triggers.push({ rule: "risk_high", severity: "S2" });
  if (failedCount >= 2 || (i.livenessFailed && failedCount >= 1)) triggers.push({ rule: "repeated_liveness_failure", severity: "S2" });
  if (anomaly.length >= 3) triggers.push({ rule: "multiple_anomaly_signals", severity: "S2" });
  if ((anomaly.includes("burst") || anomaly.includes("abnormal_volume")) && i.sensitive) triggers.push({ rule: "sensitive_burst", severity: "S3" });
  if (i.unauthorisedDerivative) triggers.push({ rule: "unauthorised_derivative", severity: "S2" });
  if (i.presentationAttack) triggers.push({ rule: "presentation_attack", severity: "S3" });
  if (i.livenessFailed && failedCount >= 2) triggers.push({ rule: "liveness_lockout", severity: "S3" });

  const existing = await openIncidentFor(ctx.db, i.user.did);
  if (triggers.length === 0) {
    if (existing && (i.requestId || i.auditEventId)) await tagWithIncident(ctx, existing.incidentId, i.requestId, i.auditEventId);
    return { incident: existing, opened: false, escalated: false, responses: [] };
  }

  const target = triggers.reduce<IncidentSeverity>((s, t) => (SEV_RANK[t.severity] > SEV_RANK[s] ? t.severity : s), "S1");
  const responses: string[] = [];

  const incident = await withTx(ctx.db, async (tx) => {
    let inc: IncidentRow;
    let opened = false;
    let escalated = false;
    if (!existing) {
      const [c] = await tx.select({ n: count() }).from(incidents);
      const incidentId = `INC-${2041 + Number(c?.n ?? 0) + 1}`;
      inc = (
        await tx
          .insert(incidents)
          .values({
            incidentId,
            actorDid: i.user.did,
            severity: target,
            status: "open",
            peakRisk: i.risk.score,
            signals: [...new Set(anomaly)],
            summary: triggers.map((t) => t.rule).join(", "),
            responses: [],
          })
          .returning()
      )[0]!;
      opened = true;
      await bumpIdentityTrust(tx, i.user, "incident_opened", inc.incidentId);
      const ev = await appendAudit(
        { db: tx },
        {
          eventType: "incident.opened",
          actorDid: i.user.did,
          assetUid: i.assetUid,
          requestId: i.requestId,
          incidentId: inc.incidentId,
          payload: { incidentId: inc.incidentId, severity: target, triggers: triggers.map((t) => t.rule), riskScore: i.risk.score, signals: anomaly },
        },
        tx,
      );
      await enqueueLedger(tx, { contract: "AuditTrail", fn: "AnchorIncident", args: [inc.incidentId, ev.chainHash, target], refTable: "incidents", refId: inc.id });
    } else {
      inc = existing;
      escalated = SEV_RANK[target] > SEV_RANK[inc.severity as IncidentSeverity];
      const signals = [...new Set([...inc.signals, ...anomaly])];
      await tx
        .update(incidents)
        .set({ severity: escalated ? target : inc.severity, peakRisk: Math.max(inc.peakRisk, i.risk.score), signals, summary: [...new Set([...inc.summary.split(", ").filter(Boolean), ...triggers.map((t) => t.rule)])].join(", ") })
        .where(eq(incidents.id, inc.id));
      inc = { ...inc, severity: escalated ? target : inc.severity, peakRisk: Math.max(inc.peakRisk, i.risk.score), signals };
      await appendAudit(
        { db: tx },
        {
          eventType: escalated ? "incident.escalated" : "incident.attached",
          actorDid: i.user.did,
          assetUid: i.assetUid,
          requestId: i.requestId,
          incidentId: inc.incidentId,
          payload: { incidentId: inc.incidentId, severity: inc.severity, triggers: triggers.map((t) => t.rule), riskScore: i.risk.score },
        },
        tx,
      );
    }

    // response ladder — apply every rung up to the current severity that has not been applied yet
    const applied = new Set(inc.responses);
    const rungs: Record<IncidentSeverity, string[]> = {
      S1: ["step_up_forced"],
      S2: ["step_up_forced", "sensitive_actions_frozen"],
      S3: ["step_up_forced", "sensitive_actions_frozen", "session_locked", "content_urls_expired", "temporary_grants_revoked", "security_alerted"],
    };
    for (const r of rungs[inc.severity as IncidentSeverity]) {
      if (applied.has(r)) continue;
      responses.push(r);
      switch (r) {
        case "session_locked":
          await tx.update(users).set({ sessionVersion: i.user.sessionVersion + 1 }).where(eq(users.id, i.user.id));
          i.user.sessionVersion += 1;
          break;
        case "content_urls_expired":
          await tx.update(accessRequests).set({ expiresAt: now, contentUsed: true }).where(and(eq(accessRequests.userId, i.user.id), isNotNull(accessRequests.contentToken)));
          break;
        case "temporary_grants_revoked":
          await tx.update(grants).set({ revokedAt: now }).where(and(eq(grants.userId, i.user.id), isNotNull(grants.expiresAt)));
          break;
        case "security_alerted":
          ctx.log.warn({ incident: inc.incidentId, actor: i.user.did, severity: inc.severity }, "SECURITY ALERT — incident escalated to S3");
          break;
      }
      await appendAudit({ db: tx }, { eventType: `incident.response.${r}`, actorDid: i.user.did, incidentId: inc.incidentId, payload: { incidentId: inc.incidentId, response: r } }, tx);
    }
    if (responses.length) {
      const all = [...applied, ...responses];
      await tx.update(incidents).set({ responses: all }).where(eq(incidents.id, inc.id));
      inc = { ...inc, responses: all };
    }
    return { inc, opened, escalated };
  });

  await tagWithIncident(ctx, incident.inc.incidentId, i.requestId, i.auditEventId);
  return { incident: incident.inc, opened: incident.opened, escalated: incident.escalated, responses };
}

/**
 * A presentation attack was detected. Record it, and ban the sessions it belongs to.
 *
 * Every path that can see one — signup, login, step-up, an administrator's approval — funnels
 * through here so the consequence is identical wherever the attack was aimed, and so there is
 * exactly one place to read to find out what "banned" means. It means the S3 rung of the ladder
 * below: every session for this identity is invalidated (`sessionVersion` moves, so tokens already
 * issued stop verifying), every outstanding content URL expires, every temporary grant is revoked,
 * and security is alerted. The identity itself is *not* revoked — that is an administrator's
 * decision made against the incident this opens, not a model's to make on its own.
 *
 * Signup is the one path that does not call this, because it cannot: the attack arrives before
 * there is an account, and there is nothing to lock. There the refusal, the stored capture and the
 * failed gate on the chain are the whole response.
 */
export async function reportPresentationAttack(
  ctx: AppContext,
  user: UserRow,
  i: { purpose: string; requestId?: string | null; assetUid?: string | null; liveProbability?: number | null; samples?: number | null },
): Promise<EvaluateResult> {
  const ev = await appendAudit(ctx, {
    eventType: "liveness.spoof_detected",
    actorDid: user.did,
    assetUid: i.assetUid ?? null,
    requestId: i.requestId ?? null,
    payload: { purpose: i.purpose, liveProbability: i.liveProbability ?? null, samples: i.samples ?? null },
  });
  return evaluateIncident(ctx, {
    user,
    // A detected attack is not a risk score to be weighed against other factors; it is the top of
    // the scale by itself, and saying so keeps the incident's own record honest about why it opened.
    risk: { score: 100, tier: "high", signals: ["presentation_attack"] },
    requestId: i.requestId ?? null,
    auditEventId: ev.id,
    assetUid: i.assetUid ?? null,
    sensitive: true,
    livenessFailed: true,
    presentationAttack: true,
  });
}

async function tagWithIncident(ctx: Pick<AppContext, "db">, incidentId: string, requestId: string | null, auditEventId: string | null) {
  if (requestId) await ctx.db.update(accessRequests).set({ incidentId }).where(eq(accessRequests.id, requestId));
  if (auditEventId) await ctx.db.update(auditEvents).set({ incidentId }).where(eq(auditEvents.id, auditEventId));
  if (requestId) await ctx.db.update(auditEvents).set({ incidentId }).where(and(eq(auditEvents.requestId, requestId), sql`${auditEvents.incidentId} is null`));
}

export async function listIncidents(ctx: Pick<AppContext, "db">, filter: { actorDid?: string; status?: string; limit?: number }) {
  const conds = [];
  if (filter.actorDid) conds.push(eq(incidents.actorDid, filter.actorDid));
  if (filter.status) conds.push(eq(incidents.status, filter.status));
  const rows = await ctx.db
    .select()
    .from(incidents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(incidents.openedAt))
    .limit(filter.limit ?? 100);
  return rows.map(publicIncident);
}

export function publicIncident(i: IncidentRow) {
  return {
    incidentId: i.incidentId,
    actorDid: i.actorDid,
    severity: i.severity,
    status: i.status,
    openedAt: i.openedAt.toISOString(),
    closedAt: i.closedAt?.toISOString() ?? null,
    closedBy: i.closedBy,
    closeReason: i.closeReason,
    peakRisk: i.peakRisk,
    summary: i.summary,
    signals: i.signals,
    responses: i.responses,
    ledgerTxId: i.ledgerTxId,
    block: i.block,
  };
}

export async function getIncident(ctx: Pick<AppContext, "db">, incidentId: string): Promise<IncidentRow> {
  const r = (await ctx.db.select().from(incidents).where(eq(incidents.incidentId, incidentId)).limit(1))[0];
  if (!r) throw ApiError.notFound("incident_not_found");
  return r;
}

/** Attack replay: the incident's audit events and the actor's trust changes, merged in time order. */
export async function getIncidentTimeline(ctx: Pick<AppContext, "db">, incidentId: string) {
  const inc = await getIncident(ctx, incidentId);
  const from = new Date(inc.openedAt.getTime() - WINDOW_MS);
  const to = inc.closedAt ?? new Date();
  const evs = await ctx.db.select().from(auditEvents).where(eq(auditEvents.incidentId, incidentId)).orderBy(asc(auditEvents.seq));
  const context = await ctx.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.actorDid, inc.actorDid), gte(auditEvents.createdAt, from), sql`${auditEvents.incidentId} is null`, sql`${auditEvents.createdAt} <= ${to}`))
    .orderBy(asc(auditEvents.seq));
  const tEvents = await ctx.db
    .select()
    .from(trustEvents)
    .where(and(eq(trustEvents.subjectType, "identity"), eq(trustEvents.subjectId, inc.actorDid), gte(trustEvents.createdAt, from), sql`${trustEvents.createdAt} <= ${to}`))
    .orderBy(asc(trustEvents.createdAt));
  const items = [
    ...[...evs, ...context].map((e) => ({
      at: e.createdAt.toISOString(),
      kind: "audit" as const,
      eventType: e.eventType,
      seq: e.seq,
      chainHash: e.chainHash,
      ledgerTxId: e.ledgerTxId,
      block: e.block,
      assetUid: e.assetUid,
      requestId: e.requestId,
      inIncident: e.incidentId === incidentId,
      payload: e.payload,
    })),
    ...tEvents.map((t) => ({ at: t.createdAt.toISOString(), kind: "trust" as const, reason: t.reason, delta: t.delta, scoreAfter: t.scoreAfter })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return { incident: publicIncident(inc), items };
}

export async function closeIncident(ctx: AppContext, incidentId: string, admin: UserRow, status: "resolved" | "false_positive", reason: string) {
  const inc = await getIncident(ctx, incidentId);
  if (inc.status !== "open") throw ApiError.conflict("incident_closed", "This incident is already closed.");
  await withTx(ctx.db, async (tx) => {
    await tx.update(incidents).set({ status, closedAt: new Date(), closedBy: admin.did, closeReason: reason }).where(eq(incidents.id, inc.id));
    if (status === "false_positive") {
      const actor = (await tx.select().from(users).where(eq(users.did, inc.actorDid)).limit(1))[0];
      if (actor) await bumpIdentityTrust(tx, actor, "incident_false_positive", inc.incidentId);
    }
    await appendAudit({ db: tx }, { eventType: "incident.closed", actorDid: admin.did, incidentId: inc.incidentId, payload: { incidentId: inc.incidentId, status, reasonLength: reason.length } }, tx);
  });
  return publicIncident(await getIncident(ctx, incidentId));
}
