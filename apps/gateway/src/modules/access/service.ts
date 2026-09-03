/**
 * The trust loop for one request:
 *   context → device → health → risk → policies → decide() → audit → (proof | step-up | approval) → incident rules
 */
import { and, eq } from "drizzle-orm";
import type { AccessDecisionResponse, AccessRequestBody, AttestationBody, DecisionTrace, DemoScenario, RiskResult, Role, Sensitivity, TrustScores, Verdict } from "@vajra/contracts";
import { decide, effectivePermissions, type DecisionOutput } from "@vajra/policy";
import { accessRequests, approvals, assets, assetTransfers, devices, users } from "../../db/schema";
import { withTx, type AppContext } from "../../context";
import { randomToken } from "../../lib/crypto";
import { ApiError } from "../../lib/errors";
import { appendAudit, type AuditEventRow } from "../audit/service";
import { livenessEvidence, verifySessionAttestation } from "../identity/attestation";
import { createNonce } from "../identity/nonces";
import type { DeviceRow, Session, UserRow } from "../identity/session";
import { enqueueLedger } from "../ledger/outbox";
import { evaluateIncident, openIncidentFor } from "../incident/service";
import { listActivePolicyVersions } from "../policy/store";
import { buildProof } from "../proof/service";
import { getAssetByUid } from "../provenance/service";
import { scoreRequestRisk } from "../risk/service";
import { bumpDeviceTrust, bumpIdentityTrust, recomputeAssetTrust } from "../trust/service";
import type { AssetRow } from "../vault/service";

export type AccessRequestRow = typeof accessRequests.$inferSelect;

const CONTENT_ACTIONS = new Set(["asset.open", "asset.download", "asset.export"]);
const CONTENT_TTL_MS = 5 * 60_000;
const STEP_UP_TTL_MS = 10 * 60_000;

/**
 * `trustOnSight` is the console session's one concession, and it is narrow on purpose.
 *
 * An ordinary first-seen device starts untrusted at 40, which is correct: nothing has vouched for
 * it. For a console session something has — the operator arrived holding the issued admin link,
 * from an allowlisted address, and there is no second machine-level fact this system could ask for.
 * Without this, every policy carrying `deviceTrusted: true` would step up or refuse on the first
 * request from a console the operator reached correctly, and the refusal would name a device
 * condition they have no way to satisfy.
 *
 * It applies ONLY when the demo scenario has not pinned a device of its own — see requestAccess.
 * The attack scenes work by presenting an unrecognised device, and a console that trusted every
 * fingerprint it was handed would quietly disarm them.
 */
async function resolveDevice(
  ctx: AppContext,
  user: UserRow,
  fingerprintHash: string,
  ip: string | null,
  geo: { lat: number; lng: number; city?: string } | undefined,
  trustOnSight = false,
) {
  let device: DeviceRow | undefined = (await ctx.db.select().from(devices).where(and(eq(devices.userId, user.id), eq(devices.fingerprintHash, fingerprintHash))).limit(1))[0];
  let isNew = false;
  if (!device) {
    isNew = true;
    await withTx(ctx.db, async (tx) => {
      device = (
        await tx
          .insert(devices)
          .values({
            userId: user.id,
            fingerprintHash,
            deviceTrust: trustOnSight ? 90 : 40,
            trusted: trustOnSight,
            label: trustOnSight ? "Admin console" : null,
            lastIp: ip,
            lastGeo: geo ?? null,
          })
          .returning()
      )[0]!;
      await bumpDeviceTrust(tx, device, "first_seen", null);
      if (!trustOnSight) await bumpIdentityTrust(tx, user, "new_device", device.id);
    });
  } else {
    await ctx.db.update(devices).set({ lastSeen: new Date(), lastIp: ip, lastGeo: geo ?? device.lastGeo }).where(eq(devices.id, device.id));
  }
  return { device: device!, isNew };
}

export async function requestAccess(ctx: AppContext, session: Session, assetUid: string, body: AccessRequestBody, scenario: DemoScenario | null, ip: string | null): Promise<AccessDecisionResponse> {
  const t0 = Date.now();
  const user = session.user;
  const asset = await getAssetByUid(ctx, assetUid);
  const context = { ...body.context };
  if (scenario) {
    if (scenario.deviceId) context.deviceId = scenario.deviceId;
    if (scenario.ip) context.ip = scenario.ip;
    if (scenario.geo) context.geo = scenario.geo;
    if (scenario.localHour !== undefined) context.localHour = scenario.localHour;
  }
  const localHour = context.localHour ?? new Date().getHours();
  context.localHour = localHour;

  // A console session's own machine is trusted on sight; a scenario-pinned device never is, so the
  // attack scenes keep working when they are driven from the admin console.
  const consoleDevice = session.console === true && !scenario?.deviceId;
  const { device, isNew } = await resolveDevice(ctx, user, context.deviceId, context.ip ?? ip, context.geo, consoleDevice);
  const health = await ctx.health.depsForDecision();

  let risk: RiskResult & { facts?: Record<string, unknown> };
  if (!health.risk) risk = { score: 100, tier: "high", signals: ["risk_unavailable"] };
  else risk = await scoreRequestRisk(ctx, { user, device, isNewDevice: isNew, context, burstOverride: scenario?.burst });

  const policies = await listActivePolicyVersions(ctx.db);
  const openIncident = await openIncidentFor(ctx.db, user.did);
  const vcRevoked = user.status === "revoked";

  const decision = decide({
    user: { did: user.did, role: user.role as Role, status: user.status as "active" | "suspended" | "revoked", vcRevoked },
    sessionValid: session.fresh || user.status === "revoked",
    asset: { uid: asset.assetUid, class: asset.class as "design" | "model" | "certificate" | "document", sensitivity: asset.sensitivity as Sensitivity, ownerDid: asset.ownerDid },
    action: body.action,
    context: { localHour, deviceTrusted: device.trusted },
    trust: { identity: user.identityTrust, device: device.deviceTrust },
    risk: { score: risk.score, tier: risk.tier, signals: risk.signals },
    policies,
    health,
    incidentSeverity: (openIncident?.severity as "S1" | "S2" | "S3" | undefined) ?? null,
  });

  if (body.action === "asset.transfer") {
    if (!body.toDid) throw ApiError.badRequest("to_did_required", "A transfer needs a recipient DID.");
    const to = (await ctx.db.select().from(users).where(eq(users.did, body.toDid)).limit(1))[0];
    if (!to || to.status !== "active") throw ApiError.badRequest("recipient_invalid", "The recipient is not an active identity.");
    if (to.did === user.did) throw ApiError.badRequest("recipient_is_self", "You already own this asset.");
  }

  const { request, auditEvent } = await withTx(ctx.db, async (tx) => {
    const [request] = await tx
      .insert(accessRequests)
      .values({
        userId: user.id,
        actorDid: user.did,
        assetId: asset.id,
        assetUid: asset.assetUid,
        action: body.action,
        actionClass: decision.actionClass,
        context: { ...context, scenario: scenario ?? undefined },
        deviceId: device.id,
        policyVersionId: decision.policyVersion?.id ?? null,
        identityTrust: user.identityTrust,
        deviceTrust: device.deviceTrust,
        assetTrust: asset.assetTrust,
        riskScore: risk.score,
        riskTier: risk.tier,
        riskSignals: risk.signals,
        decision: decision.verdict,
        reasons: decision.reasons,
        trace: decision.trace,
        stepUpRequired: decision.verdict === "STEP_UP",
        toDid: body.toDid ?? null,
        expiresAt: decision.verdict === "STEP_UP" ? new Date(Date.now() + STEP_UP_TTL_MS) : null,
        latencyMs: 0,
      })
      .returning();
    const auditEvent = await appendAudit(
      { db: tx },
      {
        eventType: "access.decision",
        actorDid: user.did,
        assetUid: asset.assetUid,
        requestId: request!.id,
        incidentId: openIncident?.incidentId ?? null,
        payload: {
          action: body.action,
          actionClass: decision.actionClass,
          verdict: decision.verdict,
          reasons: decision.reasons,
          risk: { score: risk.score, tier: risk.tier, signals: risk.signals },
          trust: { identity: user.identityTrust, device: device.deviceTrust, asset: asset.assetTrust },
          policy: decision.trace.policyVersion,
          deviceId: device.id,
          newDevice: isNew,
          localHour,
          city: context.geo?.city ?? null,
        },
      },
      tx,
    );
    await tx.update(accessRequests).set({ auditEventId: auditEvent.id }).where(eq(accessRequests.id, request!.id));
    return { request: { ...request!, auditEventId: auditEvent.id }, auditEvent };
  });

  const trust: TrustScores = { identity: user.identityTrust, device: device.deviceTrust, asset: asset.assetTrust };
  let stepUp: AccessDecisionResponse["stepUp"] = null;
  let contentUrl: string | null = null;
  let certId: string | null = null;
  let approvalId: string | null = null;

  if (decision.verdict === "ALLOW") {
    const fin = await finalizeAllow(ctx, request, asset, user, decision.trace, trust, risk, auditEvent, null, []);
    contentUrl = fin.contentUrl;
    certId = fin.certId;
  } else if (decision.verdict === "STEP_UP") {
    const n = await createNonce(ctx.db, "step_up", request.id, user.id);
    stepUp = { nonce: n.nonce, challenge: n.challenge as ("blink" | "turn_left" | "turn_right" | "smile")[], expiresAt: n.expiresAt };
  } else {
    const proof = await buildProof(ctx, proofInput(request, asset, user, decision.trace, trust, risk, auditEvent, null, []));
    certId = proof.certId;
    await ctx.db.update(accessRequests).set({ certId, finalizedAt: new Date() }).where(eq(accessRequests.id, request.id));
  }

  const inc = await evaluateIncident(ctx, { user, risk, requestId: request.id, auditEventId: auditEvent.id, assetUid: asset.assetUid, sensitive: decision.sensitive });
  await recomputeAssetTrust(ctx, asset.id);

  const latencyMs = Date.now() - t0;
  await ctx.db.update(accessRequests).set({ latencyMs }).where(eq(accessRequests.id, request.id));

  return {
    requestId: request.id,
    verdict: decision.verdict,
    trace: decision.trace,
    risk: { score: risk.score, tier: risk.tier, signals: risk.signals },
    trust,
    effectivePermissions: effectivePermissions({
      role: user.role as Role,
      trust: { identity: user.identityTrust, device: device.deviceTrust },
      riskTier: risk.tier,
      incidentSeverity: (inc.incident?.severity as "S1" | "S2" | "S3" | undefined) ?? null,
      revoked: user.status === "revoked",
    }),
    stepUp,
    approvalId,
    contentUrl,
    certId,
    auditEventId: auditEvent.id,
    incidentId: inc.incident?.incidentId ?? null,
    latencyMs,
  };
}

function proofInput(
  request: AccessRequestRow,
  asset: AssetRow | null,
  user: UserRow,
  trace: DecisionTrace,
  trust: TrustScores,
  risk: RiskResult,
  auditEvent: AuditEventRow,
  liveness: { attestationHash: string; verified: boolean; mode: "faceapi" | "simulated" } | null,
  approvalsList: { approver: string; attestationHash: string }[],
) {
  return {
    requestId: request.id,
    actorDid: user.did,
    assetUid: asset?.assetUid ?? null,
    version: asset?.currentVersion ?? null,
    action: request.action,
    decision: trace.verdict,
    decidedAt: request.decidedAt,
    policy: trace.policyVersion,
    trust,
    risk,
    deviceId: request.deviceId,
    liveness,
    approvals: approvalsList,
    trace,
    auditEvent,
  };
}

async function finalizeAllow(
  ctx: AppContext,
  request: AccessRequestRow,
  asset: AssetRow,
  user: UserRow,
  trace: DecisionTrace,
  trust: TrustScores,
  risk: RiskResult,
  decisionEvent: AuditEventRow,
  liveness: { attestationHash: string; verified: boolean; mode: "faceapi" | "simulated" } | null,
  approvalsList: { approver: string; attestationHash: string; approverDid: string }[],
): Promise<{ contentUrl: string | null; certId: string }> {
  const now = new Date();
  const finalTrace: DecisionTrace = { ...trace, verdict: "ALLOW" };
  const result = await withTx(ctx.db, async (tx) => {
    let contentUrl: string | null = null;
    if (CONTENT_ACTIONS.has(request.action)) {
      const token = randomToken(24);
      await tx.update(accessRequests).set({ contentToken: token, contentUsed: false, expiresAt: new Date(now.getTime() + CONTENT_TTL_MS) }).where(eq(accessRequests.id, request.id));
      contentUrl = `/v1/assets/${asset.assetUid}/content?token=${token}`;
    }
    if (request.action === "asset.transfer" && request.toDid) {
      const approver = approvalsList[0]?.approverDid ?? "";
      await tx.update(assets).set({ ownerDid: request.toDid }).where(eq(assets.id, asset.id));
      const [tr] = await tx
        .insert(assetTransfers)
        .values({ assetId: asset.id, fromDid: user.did, toDid: request.toDid, requestId: request.id, approvalId: request.approvalId, approverDid: approver || null })
        .returning();
      await enqueueLedger(tx, { contract: "AssetPassport", fn: "Transfer", args: [asset.assetUid, user.did, request.toDid, request.id, approver], refTable: "asset_transfers", refId: tr!.id });
      await appendAudit({ db: tx }, { eventType: "asset.transferred", actorDid: user.did, assetUid: asset.assetUid, requestId: request.id, incidentId: request.incidentId, payload: { fromDid: user.did, toDid: request.toDid, approverDid: approver || null } }, tx);
    }
    if (request.action === "asset.delete") {
      await tx.update(assets).set({ deletedAt: now }).where(eq(assets.id, asset.id));
      await appendAudit({ db: tx }, { eventType: "asset.deleted", actorDid: user.did, assetUid: asset.assetUid, requestId: request.id, payload: {} }, tx);
    }
    const granted = await appendAudit(
      { db: tx },
      {
        eventType: "access.granted",
        actorDid: user.did,
        assetUid: asset.assetUid,
        requestId: request.id,
        incidentId: request.incidentId,
        payload: { action: request.action, liveness: liveness?.attestationHash ?? null, approvals: approvalsList.map((a) => a.approverDid), decisionEventId: decisionEvent.id },
      },
      tx,
    );
    const proof = await buildProof(ctx, proofInput({ ...request, decision: "ALLOW" }, asset, user, finalTrace, trust, risk, granted, liveness, approvalsList.map((a) => ({ approver: a.approver, attestationHash: a.attestationHash }))), tx);
    await tx.update(accessRequests).set({ decision: "ALLOW", certId: proof.certId, finalizedAt: now, trace: finalTrace }).where(eq(accessRequests.id, request.id));
    return { contentUrl, certId: proof.certId };
  });
  return result;
}

async function loadRequest(ctx: AppContext, requestId: string): Promise<AccessRequestRow> {
  const r = (await ctx.db.select().from(accessRequests).where(eq(accessRequests.id, requestId)).limit(1))[0];
  if (!r) throw ApiError.notFound("request_not_found");
  return r;
}

export async function stepUp(ctx: AppContext, session: Session, requestId: string, body: AttestationBody): Promise<AccessDecisionResponse> {
  const t0 = Date.now();
  const user = session.user;
  const request = await loadRequest(ctx, requestId);
  if (request.userId !== user.id) throw ApiError.forbidden("not_your_request");
  if (request.decision !== "STEP_UP" || request.stepUpOk !== null) throw ApiError.conflict("step_up_not_pending", "This request is not waiting for a liveness proof.");
  if (request.expiresAt && request.expiresAt.getTime() < Date.now()) throw ApiError.conflict("step_up_expired", "The step-up window closed. Request again.");
  const asset = request.assetUid ? await getAssetByUid(ctx, request.assetUid) : null;
  const device = request.deviceId ? (await ctx.db.select().from(devices).where(eq(devices.id, request.deviceId)).limit(1))[0] : undefined;
  const trace = request.trace as unknown as DecisionTrace;
  const risk: RiskResult = { score: request.riskScore, tier: request.riskTier as RiskResult["tier"], signals: request.riskSignals };

  const att = await verifySessionAttestation(ctx, session, body, "step_up", requestId, request.deviceId);
  const liveness = { attestationHash: att.attestationHash, verified: att.ok, mode: body.livenessMode };

  if (!att.ok) {
    const failEvent = await withTx(ctx.db, async (tx) => {
      await bumpIdentityTrust(tx, user, "liveness_failed", requestId);
      if (device) await bumpDeviceTrust(tx, device, "liveness_failed", requestId);
      const deniedTrace: DecisionTrace = {
        ...trace,
        verdict: "DENY",
        reasons: ["liveness_failed"],
        checks: [...trace.checks, { id: "liveness", labelKey: "trace.liveness", result: "fail", detailKey: "trace.detail.liveness_failed" }],
      };
      await tx.update(accessRequests).set({ decision: "DENY", stepUpOk: false, reasons: ["liveness_failed"], trace: deniedTrace, finalizedAt: new Date() }).where(eq(accessRequests.id, requestId));
      const ev = await appendAudit(
        { db: tx },
        { eventType: "liveness.failed", actorDid: user.did, assetUid: request.assetUid, requestId, incidentId: request.incidentId, payload: { purpose: "step_up", attestationHash: att.attestationHash, ...livenessEvidence(body) } },
        tx,
      );
      const proof = await buildProof(ctx, proofInput({ ...request, decision: "DENY" }, asset, user, deniedTrace, { identity: user.identityTrust, device: device?.deviceTrust ?? 0, asset: asset?.assetTrust ?? null }, risk, ev, liveness, []), tx);
      await tx.update(accessRequests).set({ certId: proof.certId }).where(eq(accessRequests.id, requestId));
      return { ev, deniedTrace, certId: proof.certId };
    });
    const inc = await evaluateIncident(ctx, { user, risk, requestId, auditEventId: failEvent.ev.id, assetUid: request.assetUid, sensitive: request.actionClass === "high" || request.actionClass === "critical", livenessFailed: true, presentationAttack: att.spoof });
    return respond(ctx, user, device, request, failEvent.deniedTrace, risk, asset, { verdict: "DENY", certId: failEvent.certId, auditEventId: failEvent.ev.id, incidentId: inc.incident?.incidentId ?? null, t0 });
  }

  const verifiedEvent = await withTx(ctx.db, async (tx) => {
    await bumpIdentityTrust(tx, user, "liveness_success", requestId);
    if (device) await bumpDeviceTrust(tx, device, "step_up_success", requestId);
    await tx.update(accessRequests).set({ stepUpOk: true }).where(eq(accessRequests.id, requestId));
    return appendAudit({ db: tx }, { eventType: "liveness.verified", actorDid: user.did, assetUid: request.assetUid, requestId, incidentId: request.incidentId, payload: { purpose: "step_up", attestationHash: att.attestationHash, ...livenessEvidence(body) } }, tx);
  });

  const approvalCheck = trace.checks.find((c) => c.id === "approval");
  if (approvalCheck) {
    const requiredRole = String(approvalCheck.params?.role ?? "manager");
    const requiredCount = Number(approvalCheck.params?.count ?? 1);
    const approvalId = await withTx(ctx.db, async (tx) => {
      const [ap] = await tx.insert(approvals).values({ requestId, kind: "two_person", requiredRole, requiredCount, requesterDid: user.did }).returning();
      await tx.update(accessRequests).set({ decision: "PENDING_APPROVAL", approvalId: ap!.id, expiresAt: new Date(Date.now() + 24 * 3_600_000) }).where(eq(accessRequests.id, requestId));
      await appendAudit({ db: tx }, { eventType: "approval.requested", actorDid: user.did, assetUid: request.assetUid, requestId, payload: { approvalId: ap!.id, requiredRole, requiredCount, action: request.action } }, tx);
      return ap!.id;
    });
    const trust: TrustScores = { identity: user.identityTrust, device: device?.deviceTrust ?? 0, asset: asset?.assetTrust ?? null };
    return respond(ctx, user, device, request, { ...trace, verdict: "PENDING_APPROVAL" }, risk, asset, { verdict: "PENDING_APPROVAL", approvalId, auditEventId: verifiedEvent.id, incidentId: request.incidentId, t0, trust });
  }

  const trust: TrustScores = { identity: user.identityTrust, device: device?.deviceTrust ?? 0, asset: asset?.assetTrust ?? null };
  const fin = await finalizeAllow(ctx, request, asset!, user, trace, trust, risk, verifiedEvent, liveness, []);
  if (asset) await recomputeAssetTrust(ctx, asset.id);
  return respond(ctx, user, device, request, { ...trace, verdict: "ALLOW" }, risk, asset, { verdict: "ALLOW", certId: fin.certId, contentUrl: fin.contentUrl, auditEventId: verifiedEvent.id, incidentId: request.incidentId, t0, trust });
}

async function respond(
  ctx: AppContext,
  user: UserRow,
  device: DeviceRow | undefined,
  request: AccessRequestRow,
  trace: DecisionTrace,
  risk: RiskResult,
  asset: AssetRow | null,
  o: { verdict: Verdict; certId?: string | null; contentUrl?: string | null; approvalId?: string | null; auditEventId: string; incidentId: string | null; t0: number; trust?: TrustScores },
): Promise<AccessDecisionResponse> {
  const fresh = (await ctx.db.select().from(users).where(eq(users.id, user.id)).limit(1))[0] ?? user;
  const dev = device ? (await ctx.db.select().from(devices).where(eq(devices.id, device.id)).limit(1))[0] : undefined;
  const inc = await openIncidentFor(ctx.db, user.did);
  return {
    requestId: request.id,
    verdict: o.verdict,
    trace,
    risk,
    trust: o.trust ?? { identity: fresh.identityTrust, device: dev?.deviceTrust ?? 0, asset: asset?.assetTrust ?? null },
    effectivePermissions: effectivePermissions({
      role: fresh.role as Role,
      trust: { identity: fresh.identityTrust, device: dev?.deviceTrust ?? 0 },
      riskTier: risk.tier,
      incidentSeverity: (inc?.severity as "S1" | "S2" | "S3" | undefined) ?? null,
      revoked: fresh.status === "revoked",
    }),
    stepUp: null,
    approvalId: o.approvalId ?? request.approvalId ?? null,
    contentUrl: o.contentUrl ?? null,
    certId: o.certId ?? null,
    auditEventId: o.auditEventId,
    incidentId: o.incidentId,
    latencyMs: Date.now() - o.t0,
  };
}

// ─── Approvals (two-person rule) ─────────────────────────────────────────────

export type ApprovalRow = typeof approvals.$inferSelect;

export async function listApprovals(ctx: AppContext, session: Session) {
  const me = session.user;
  const rows = await ctx.db.select().from(approvals).orderBy(approvals.createdAt);
  const mine = rows.filter((a) => a.requesterDid === me.did);
  const inbox = rows.filter((a) => a.status === "pending" && a.requesterDid !== me.did && (a.requiredRole === me.role || me.role === "admin"));
  const reqIds = [...new Set([...mine, ...inbox].map((a) => a.requestId))];
  const reqs = reqIds.length ? await ctx.db.select().from(accessRequests).where(eq(accessRequests.id, reqIds[0]!)).limit(0) : [];
  void reqs;
  const detail = async (a: ApprovalRow) => {
    const r = (await ctx.db.select().from(accessRequests).where(eq(accessRequests.id, a.requestId)).limit(1))[0];
    const requester = (await ctx.db.select({ displayName: users.displayName, role: users.role, identityTrust: users.identityTrust }).from(users).where(eq(users.did, a.requesterDid)).limit(1))[0];
    return {
      id: a.id,
      requestId: a.requestId,
      status: a.status,
      requiredRole: a.requiredRole,
      requester: { did: a.requesterDid, displayName: requester?.displayName ?? null, role: requester?.role ?? null, identityTrust: requester?.identityTrust ?? null },
      approverDid: a.approverDid,
      reason: a.reason,
      createdAt: a.createdAt.toISOString(),
      decidedAt: a.decidedAt?.toISOString() ?? null,
      request: r
        ? { action: r.action, assetUid: r.assetUid, toDid: r.toDid, risk: { score: r.riskScore, tier: r.riskTier, signals: r.riskSignals }, trust: { identity: r.identityTrust, device: r.deviceTrust }, trace: r.trace, decidedAt: r.decidedAt.toISOString() }
        : null,
    };
  };
  return { inbox: await Promise.all(inbox.map(detail)), mine: await Promise.all(mine.map(detail)) };
}

export async function challengeApproval(ctx: AppContext, session: Session, approvalId: string) {
  const ap = (await ctx.db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1))[0];
  if (!ap) throw ApiError.notFound("approval_not_found");
  if (ap.status !== "pending") throw ApiError.conflict("approval_decided", "This approval was already decided.");
  if (ap.requesterDid === session.user.did) throw ApiError.forbidden("approver_is_requester", "You cannot approve your own request.");
  if (ap.requiredRole !== session.user.role && session.user.role !== "admin") throw ApiError.forbidden("role_forbids", `This approval needs a ${ap.requiredRole}.`);
  return createNonce(ctx.db, "approval", approvalId, session.user.id);
}

export async function decideApproval(ctx: AppContext, session: Session, approvalId: string, body: { approve: boolean; reason?: string; attestation: AttestationBody }) {
  const t0 = Date.now();
  const me = session.user;
  const ap = (await ctx.db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1))[0];
  if (!ap) throw ApiError.notFound("approval_not_found");
  if (ap.status !== "pending") throw ApiError.conflict("approval_decided", "This approval was already decided.");
  if (ap.requesterDid === me.did) throw ApiError.forbidden("approver_is_requester", "You cannot approve your own request.");
  if (ap.requiredRole !== me.role && me.role !== "admin") throw ApiError.forbidden("role_forbids", `This approval needs a ${ap.requiredRole}.`);

  const request = await loadRequest(ctx, ap.requestId);
  const requester = (await ctx.db.select().from(users).where(eq(users.did, ap.requesterDid)).limit(1))[0];
  if (!requester) throw ApiError.notFound("requester_not_found");
  const asset = request.assetUid ? await getAssetByUid(ctx, request.assetUid) : null;
  const trace = request.trace as unknown as DecisionTrace;
  const risk: RiskResult = { score: request.riskScore, tier: request.riskTier as RiskResult["tier"], signals: request.riskSignals };
  const myDevice = session.device;

  const att = await verifySessionAttestation(ctx, session, body.attestation, "approval", approvalId, myDevice?.id ?? null);
  if (!att.ok) {
    await withTx(ctx.db, async (tx) => {
      await bumpIdentityTrust(tx, me, "liveness_failed", approvalId);
      if (myDevice) await bumpDeviceTrust(tx, myDevice, "liveness_failed", approvalId);
      await appendAudit({ db: tx }, { eventType: "liveness.failed", actorDid: me.did, requestId: request.id, payload: { purpose: "approval", approvalId, attestationHash: att.attestationHash } }, tx);
    });
    await evaluateIncident(ctx, { user: me, risk: { score: 0, tier: "low", signals: [] }, requestId: null, auditEventId: null, assetUid: null, sensitive: true, livenessFailed: true, presentationAttack: att.spoof });
    throw ApiError.forbidden("liveness_failed", "Your liveness proof did not verify. The approval was not recorded.");
  }

  if (!body.approve) {
    const certId = await withTx(ctx.db, async (tx) => {
      await tx.update(approvals).set({ status: "rejected", approverId: me.id, approverDid: me.did, reason: body.reason ?? null, attestationId: att.attestationId, decidedAt: new Date() }).where(eq(approvals.id, approvalId));
      const deniedTrace: DecisionTrace = { ...trace, verdict: "DENY", reasons: ["approval_rejected"], checks: trace.checks.map((c) => (c.id === "approval" ? { ...c, result: "fail" as const, detailKey: "trace.detail.approval_rejected" } : c)) };
      await tx.update(accessRequests).set({ decision: "DENY", reasons: ["approval_rejected"], trace: deniedTrace, finalizedAt: new Date() }).where(eq(accessRequests.id, request.id));
      const ev = await appendAudit({ db: tx }, { eventType: "approval.rejected", actorDid: me.did, assetUid: request.assetUid, requestId: request.id, payload: { approvalId, requesterDid: ap.requesterDid, reasonLength: (body.reason ?? "").length } }, tx);
      const proof = await buildProof(ctx, proofInput({ ...request, decision: "DENY" }, asset, requester, deniedTrace, { identity: requester.identityTrust, device: request.deviceTrust, asset: asset?.assetTrust ?? null }, risk, ev, null, [{ approver: me.did, attestationHash: att.attestationHash }]), tx);
      await tx.update(accessRequests).set({ certId: proof.certId }).where(eq(accessRequests.id, request.id));
      return proof.certId;
    });
    return { approvalId, status: "rejected", verdict: "DENY" as Verdict, certId, latencyMs: Date.now() - t0 };
  }

  const granted = await withTx(ctx.db, async (tx) => {
    await tx.update(approvals).set({ status: "approved", approverId: me.id, approverDid: me.did, reason: body.reason ?? null, attestationId: att.attestationId, decidedAt: new Date() }).where(eq(approvals.id, approvalId));
    await bumpIdentityTrust(tx, requester, "approval_received", approvalId);
    await bumpIdentityTrust(tx, me, "liveness_success", approvalId);
    if (myDevice) await bumpDeviceTrust(tx, myDevice, "step_up_success", approvalId);
    return appendAudit({ db: tx }, { eventType: "approval.granted", actorDid: me.did, assetUid: request.assetUid, requestId: request.id, payload: { approvalId, requesterDid: ap.requesterDid, approverDid: me.did, attestationHash: att.attestationHash } }, tx);
  });
  const trust: TrustScores = { identity: requester.identityTrust, device: request.deviceTrust, asset: asset?.assetTrust ?? null };
  const requesterAtt = (await ctx.db.select().from(accessRequests).where(eq(accessRequests.id, request.id)).limit(1))[0];
  void requesterAtt;
  const fin = await finalizeAllow(ctx, { ...request, approvalId }, asset!, requester, { ...trace, checks: trace.checks.map((c) => (c.id === "approval" ? { ...c, result: "pass" as const, detailKey: "trace.detail.approval_granted" } : c)) }, trust, risk, granted, null, [
    { approver: me.did, attestationHash: att.attestationHash, approverDid: me.did },
  ]);
  if (asset) await recomputeAssetTrust(ctx, asset.id);
  return { approvalId, status: "approved", verdict: "ALLOW" as Verdict, certId: fin.certId, contentUrl: fin.contentUrl, latencyMs: Date.now() - t0 };
}

export async function getRequest(ctx: AppContext, session: Session, requestId: string) {
  const r = await loadRequest(ctx, requestId);
  if (r.userId !== session.user.id && session.user.role !== "auditor" && session.user.role !== "admin" && session.user.role !== "manager") throw ApiError.forbidden("not_your_request");
  return publicRequest(r);
}

export function publicRequest(r: AccessRequestRow) {
  return {
    id: r.id,
    actorDid: r.actorDid,
    assetUid: r.assetUid,
    action: r.action,
    actionClass: r.actionClass,
    decision: r.decision as Verdict,
    reasons: r.reasons,
    trace: r.trace,
    risk: { score: r.riskScore, tier: r.riskTier, signals: r.riskSignals },
    trust: { identity: r.identityTrust, device: r.deviceTrust, asset: r.assetTrust },
    policyVersionId: r.policyVersionId,
    stepUpRequired: r.stepUpRequired,
    stepUpOk: r.stepUpOk,
    approvalId: r.approvalId,
    certId: r.certId,
    incidentId: r.incidentId,
    latencyMs: r.latencyMs,
    decidedAt: r.decidedAt.toISOString(),
    finalizedAt: r.finalizedAt?.toISOString() ?? null,
    context: { deviceId: r.deviceId, localHour: (r.context as { localHour?: number }).localHour ?? null, city: (r.context as { geo?: { city?: string } }).geo?.city ?? null },
  };
}

export async function listRequests(ctx: AppContext, session: Session, limit = 50) {
  const me = session.user;
  const all = await ctx.db.select().from(accessRequests).orderBy(accessRequests.decidedAt);
  const visible = me.role === "auditor" || me.role === "admin" || me.role === "manager" ? all : all.filter((r) => r.userId === me.id);
  return visible.slice(-limit).reverse().map(publicRequest);
}

export function currentPermissions(user: UserRow, device: DeviceRow | null, incidentSeverity: "S1" | "S2" | "S3" | null) {
  return effectivePermissions({ role: user.role as Role, trust: { identity: user.identityTrust, device: device?.deviceTrust ?? 0 }, riskTier: "low", incidentSeverity, revoked: user.status === "revoked" });
}

export type { DecisionOutput };
