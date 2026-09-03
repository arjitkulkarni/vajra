/**
 * Proof-of-Action: a signed, self-contained certificate for a decision, plus evidence packages for
 * incidents. Verification recomputes the hash, checks the issuer signature, recomputes the audit chain
 * link, asks the ledger for the anchor, and matches the policy hash.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  EvidencePackageSchema,
  ProofOfActionBodySchema,
  ProofOfActionSchema,
  type DecisionTrace,
  type EvidencePackage,
  type ProofOfAction,
  type ProofVerification,
  type RiskResult,
  type TrustScores,
  type Verdict,
} from "@vajra/contracts";
import type { Db } from "../../db/client";
import { auditEvents, evidencePackages, incidents, policyVersions, proofCertificates, trustEvents } from "../../db/schema";
import type { AppContext } from "../../context";
import { ed25519, hashJson, sha256Hex } from "../../lib/crypto";
import { ApiError } from "../../lib/errors";
import type { AuditEventRow } from "../audit/service";
import { toPolicyVersion } from "../policy/store";

export interface BuildProofInput {
  requestId: string;
  actorDid: string;
  assetUid: string | null;
  version: number | null;
  action: string;
  decision: Verdict;
  decidedAt: Date;
  policy: DecisionTrace["policyVersion"];
  trust: TrustScores;
  risk: RiskResult;
  deviceId: string | null;
  liveness: { attestationHash: string; verified: boolean; mode: "faceapi" | "simulated" } | null;
  approvals: { approver: string; attestationHash: string }[];
  trace: DecisionTrace;
  auditEvent: AuditEventRow;
}

async function nextCertId(db: Db): Promise<string> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(proofCertificates);
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `PoA-${ymd}-${String((r?.n ?? 0) + 1).padStart(6, "0")}`;
}

export function signBody(ctx: Pick<AppContext, "keys">, body: Record<string, unknown>): { bodyHash: string; signature: string } {
  const bodyHash = hashJson(body);
  return { bodyHash, signature: ed25519.sign(ctx.keys.privateKey, bodyHash) };
}

export async function buildProof(ctx: Pick<AppContext, "db" | "keys">, i: BuildProofInput, db: Db = ctx.db): Promise<ProofOfAction> {
  const certId = await nextCertId(db);
  const body = ProofOfActionBodySchema.parse({
    certId,
    actor: i.actorDid,
    asset: i.assetUid,
    version: i.version,
    action: i.action,
    decision: i.decision,
    decidedAt: i.decidedAt.toISOString(),
    policy: i.policy,
    trust: i.trust,
    risk: i.risk,
    device: i.deviceId ? sha256Hex(i.deviceId) : "none",
    liveness: i.liveness,
    approvals: i.approvals,
    trace: i.trace,
    audit: {
      eventId: i.auditEvent.id,
      seq: i.auditEvent.seq,
      payloadHash: i.auditEvent.payloadHash,
      prevHash: i.auditEvent.prevHash,
      chainHash: i.auditEvent.chainHash,
      ledgerTxId: i.auditEvent.ledgerTxId,
      block: i.auditEvent.block,
    },
    issuer: ctx.keys.issuerDid,
  });
  const { bodyHash, signature } = signBody(ctx, body);
  await db.insert(proofCertificates).values({ certId, requestId: i.requestId, auditEventId: i.auditEvent.id, body, bodyHash, signature });
  return { ...body, bodyHash, signature };
}

export async function getProof(ctx: Pick<AppContext, "db">, certId: string): Promise<ProofOfAction | null> {
  const r = (await ctx.db.select().from(proofCertificates).where(eq(proofCertificates.certId, certId)).limit(1))[0];
  if (!r) return null;
  return ProofOfActionSchema.parse({ ...r.body, bodyHash: r.bodyHash, signature: r.signature });
}

export async function listProofs(ctx: Pick<AppContext, "db">, filter: { requestId?: string; actorDid?: string; limit?: number }) {
  const rows = await ctx.db.select().from(proofCertificates).orderBy(desc(proofCertificates.createdAt)).limit(Math.min(filter.limit ?? 50, 500));
  return rows
    .map((r) => ProofOfActionSchema.parse({ ...r.body, bodyHash: r.bodyHash, signature: r.signature }))
    .filter((p) => (filter.requestId ? true : true) && (filter.actorDid ? p.actor === filter.actorDid : true));
}

/** After the outbox anchors an audit event, refresh every certificate that cites it and re-sign. */
export async function refreshProofsForAuditEvent(ctx: Pick<AppContext, "db" | "keys">, auditEventId: string): Promise<number> {
  const ev = (await ctx.db.select().from(auditEvents).where(eq(auditEvents.id, auditEventId)).limit(1))[0];
  if (!ev) return 0;
  const certs = await ctx.db.select().from(proofCertificates).where(eq(proofCertificates.auditEventId, auditEventId));
  for (const c of certs) {
    const body = { ...c.body, audit: { ...(c.body.audit as Record<string, unknown>), ledgerTxId: ev.ledgerTxId, block: ev.block } };
    const { bodyHash, signature } = signBody(ctx, body);
    await ctx.db.update(proofCertificates).set({ body, bodyHash, signature, updatedAt: new Date() }).where(eq(proofCertificates.id, c.id));
  }
  return certs.length;
}

export async function verifyProof(ctx: Pick<AppContext, "db" | "keys" | "ledger" | "health">, input: unknown): Promise<ProofVerification> {
  const parsed = ProofOfActionSchema.safeParse(input);
  if (!parsed.success) throw ApiError.badRequest("proof_malformed", "This is not a Proof-of-Action certificate.", parsed.error.flatten());
  const proof = parsed.data;
  const { bodyHash, signature, ...body } = proof;
  const checks: ProofVerification["checks"] = [];

  const recomputed = hashJson(body);
  checks.push({ id: "hash", ok: recomputed === bodyHash, detailKey: recomputed === bodyHash ? "verify.hash_ok" : "verify.hash_mismatch" });
  const sigOk = ed25519.verify(ctx.keys.publicKey, bodyHash, signature) && body.issuer === ctx.keys.issuerDid;
  checks.push({ id: "signature", ok: sigOk, detailKey: sigOk ? "verify.signature_ok" : "verify.signature_bad" });

  const ev = (await ctx.db.select().from(auditEvents).where(eq(auditEvents.id, body.audit.eventId)).limit(1))[0];
  let chainOk = false;
  if (ev) {
    const expected = sha256Hex(ev.prevHash + ev.payloadHash);
    chainOk = ev.chainHash === body.audit.chainHash && ev.prevHash === body.audit.prevHash && ev.payloadHash === body.audit.payloadHash && expected === ev.chainHash && hashJson(ev.payload) === ev.payloadHash;
  }
  checks.push({ id: "chain", ok: chainOk, detailKey: !ev ? "verify.chain_missing" : chainOk ? "verify.chain_ok" : "verify.chain_broken" });

  let ledgerOk = false;
  let ledgerDetail = "verify.ledger_missing";
  if (ctx.health.isSimulatedDown("ledger")) {
    ledgerDetail = "verify.ledger_unavailable";
  } else {
    try {
      const rec = (await ctx.ledger.evaluate("AuditTrail", "GetEvent", [body.audit.eventId])) as { chainHash?: string } | null;
      ledgerOk = !!rec && rec.chainHash === body.audit.chainHash;
      ledgerDetail = ledgerOk ? "verify.ledger_ok" : rec ? "verify.ledger_mismatch" : "verify.ledger_missing";
    } catch (e) {
      ledgerDetail = (e as { code?: string }).code === "not_found" ? "verify.ledger_missing" : "verify.ledger_unavailable";
    }
  }
  checks.push({ id: "ledger", ok: ledgerOk, detailKey: ledgerDetail });

  let policyOk = true;
  let policyDetail = "verify.policy_none";
  if (body.policy) {
    policyOk = false;
    policyDetail = "verify.policy_missing";
    const pv = (await ctx.db.select().from(policyVersions).where(and(eq(policyVersions.key, body.policy.key), eq(policyVersions.version, body.policy.version))).limit(1))[0];
    if (pv) {
      policyOk = pv.specHash === body.policy.hash && hashJson(pv.spec) === pv.specHash;
      policyDetail = policyOk ? "verify.policy_ok" : "verify.policy_mismatch";
      if (policyOk && !ctx.health.isSimulatedDown("ledger")) {
        try {
          const rec = (await ctx.ledger.evaluate("PolicyRegistry", "Get", [body.policy.key, String(body.policy.version)])) as { specHash?: string } | null;
          if (rec && rec.specHash !== body.policy.hash) {
            policyOk = false;
            policyDetail = "verify.policy_mismatch";
          }
        } catch {
          /* policy anchor may still be in the outbox; the DB hash match stands */
        }
      }
    }
  }
  checks.push({ id: "policy", ok: policyOk, detailKey: policyDetail });

  return { valid: checks.every((c) => c.ok), checks };
}

// ─── Evidence packages ───────────────────────────────────────────────────────

export async function buildEvidencePackage(ctx: Pick<AppContext, "db" | "keys">, incidentId: string): Promise<EvidencePackage> {
  const inc = (await ctx.db.select().from(incidents).where(eq(incidents.incidentId, incidentId)).limit(1))[0];
  if (!inc) throw ApiError.notFound("incident_not_found");
  const events = await ctx.db.select().from(auditEvents).where(eq(auditEvents.incidentId, incidentId)).orderBy(asc(auditEvents.seq));
  const reqIds = [...new Set(events.map((e) => e.requestId).filter((x): x is string => !!x))];
  const certs = reqIds.length ? await ctx.db.select().from(proofCertificates).where(inArray(proofCertificates.requestId, reqIds)) : [];
  const proofs = certs.map((c) => ProofOfActionSchema.parse({ ...c.body, bodyHash: c.bodyHash, signature: c.signature }));
  const policyKeys = new Set<string>();
  for (const p of proofs) if (p.policy) policyKeys.add(`${p.policy.key}:${p.policy.version}`);
  const pvRows = await ctx.db.select().from(policyVersions);
  const pvs = pvRows.filter((p) => policyKeys.has(`${p.key}:${p.version}`)).map(toPolicyVersion);
  const windowEnd = inc.closedAt ?? new Date();
  const tEvents = await ctx.db
    .select()
    .from(trustEvents)
    .where(and(eq(trustEvents.subjectType, "identity"), eq(trustEvents.subjectId, inc.actorDid), gte(trustEvents.createdAt, new Date(inc.openedAt.getTime() - 3_600_000)), lte(trustEvents.createdAt, windowEnd)))
    .orderBy(asc(trustEvents.createdAt));
  const [cnt] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(evidencePackages);
  const packageId = `EVP-${incidentId}-${String((cnt?.n ?? 0) + 1).padStart(3, "0")}`;
  const body = {
    packageId,
    incidentId,
    generatedAt: new Date().toISOString(),
    incident: {
      incidentId: inc.incidentId,
      actorDid: inc.actorDid,
      severity: inc.severity,
      status: inc.status,
      openedAt: inc.openedAt.toISOString(),
      closedAt: inc.closedAt?.toISOString() ?? null,
      peakRisk: inc.peakRisk,
      signals: inc.signals,
      responses: inc.responses,
      summary: inc.summary,
      ledgerTxId: inc.ledgerTxId,
      block: inc.block,
    },
    events: events.map((e) => ({
      id: e.id,
      seq: e.seq,
      eventType: e.eventType,
      actorDid: e.actorDid,
      assetUid: e.assetUid,
      requestId: e.requestId,
      payload: e.payload,
      payloadHash: e.payloadHash,
      prevHash: e.prevHash,
      chainHash: e.chainHash,
      ledgerTxId: e.ledgerTxId,
      block: e.block,
      createdAt: e.createdAt.toISOString(),
    })),
    proofs,
    policyVersions: pvs,
    trustEvents: tEvents.map((t) => ({ delta: t.delta, reason: t.reason, scoreAfter: t.scoreAfter, at: t.createdAt.toISOString() })),
    issuer: ctx.keys.issuerDid,
  };
  const packageHash = hashJson(body);
  const signature = ed25519.sign(ctx.keys.privateKey, packageHash);
  await ctx.db.insert(evidencePackages).values({ packageId, incidentId, body, packageHash, signature });
  return EvidencePackageSchema.parse({ ...body, packageHash, signature });
}

export async function verifyEvidencePackage(ctx: Pick<AppContext, "db" | "keys" | "ledger" | "health">, input: unknown) {
  const parsed = EvidencePackageSchema.safeParse(input);
  if (!parsed.success) throw ApiError.badRequest("evidence_malformed", "This is not an evidence package.", parsed.error.flatten());
  const pkg = parsed.data;
  const { packageHash, signature, ...body } = pkg;
  const checks: { id: string; ok: boolean; detailKey: string }[] = [];
  const recomputed = hashJson(body);
  checks.push({ id: "hash", ok: recomputed === packageHash, detailKey: recomputed === packageHash ? "verify.hash_ok" : "verify.hash_mismatch" });
  const sigOk = ed25519.verify(ctx.keys.publicKey, packageHash, signature);
  checks.push({ id: "signature", ok: sigOk, detailKey: sigOk ? "verify.signature_ok" : "verify.signature_bad" });

  let chainOk = true;
  for (const e of body.events as { payload: unknown; payloadHash: string; prevHash: string; chainHash: string }[]) {
    if (hashJson(e.payload) !== e.payloadHash || sha256Hex(e.prevHash + e.payloadHash) !== e.chainHash) chainOk = false;
  }
  checks.push({ id: "chain", ok: chainOk, detailKey: chainOk ? "verify.chain_ok" : "verify.chain_broken" });

  let ledgerOk = true;
  let ledgerDetail = "verify.ledger_ok";
  if (ctx.health.isSimulatedDown("ledger")) {
    ledgerOk = false;
    ledgerDetail = "verify.ledger_unavailable";
  } else {
    for (const e of body.events as { id: string; chainHash: string }[]) {
      try {
        const rec = (await ctx.ledger.evaluate("AuditTrail", "GetEvent", [e.id])) as { chainHash?: string } | null;
        if (!rec || rec.chainHash !== e.chainHash) {
          ledgerOk = false;
          ledgerDetail = "verify.ledger_mismatch";
          break;
        }
      } catch {
        ledgerOk = false;
        ledgerDetail = "verify.ledger_missing";
        break;
      }
    }
  }
  checks.push({ id: "ledger", ok: ledgerOk, detailKey: ledgerDetail });

  let proofsOk = true;
  for (const p of body.proofs) {
    const v = await verifyProof(ctx, p);
    if (!v.checks.filter((c) => c.id !== "ledger").every((c) => c.ok)) proofsOk = false;
  }
  checks.push({ id: "proofs", ok: proofsOk, detailKey: proofsOk ? "verify.proofs_ok" : "verify.proofs_bad" });
  return { valid: checks.every((c) => c.ok), checks, packageId: pkg.packageId, incidentId: pkg.incidentId, events: body.events.length, proofs: body.proofs.length };
}
