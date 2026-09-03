/**
 * Demo seed — four identities with server-held demo keys (DEMO_MODE only), six policies, two assets.
 * `pnpm demo:reset` rebuilds this exact state so every rehearsal starts identical.
 */
import { sql } from "drizzle-orm";
import type { PolicySpecInput, Role } from "@vajra/contracts";
import {
  accessRequests,
  approvals,
  assets,
  assetTransfers,
  assetVersions,
  auditEvents,
  breakGlassGrants,
  credentials,
  demoIdentities,
  devices,
  evidencePackages,
  grants,
  incidents,
  ledgerBlocks,
  ledgerOutbox,
  ledgerState,
  ledgerStateHistory,
  livenessAttestations,
  livenessNonces,
  policies,
  policyVersions,
  proofCertificates,
  trustEvents,
  users,
} from "../../db/schema";
import { withTx, type AppContext } from "../../context";
import { didKeyFromRaw, keyPairFromSecret, sha256Hex } from "../../lib/crypto";
import { appendAudit } from "../audit/service";
import { enqueueLedger } from "../ledger/outbox";
import { DEFAULT_BASELINE } from "../identity/onboarding";
import type { Session } from "../identity/session";
import { issueIdentityCredential } from "../identity/vc";
import { createPolicyVersion } from "../policy/store";
import { uploadAsset } from "../vault/service";

export const DEMO_PEOPLE: { role: Role; name: string; trust: number; deviceTrust: number }[] = [
  { role: "engineer", name: "Asha Rao", trust: 92, deviceTrust: 85 },
  { role: "manager", name: "Vikram Nair", trust: 94, deviceTrust: 88 },
  { role: "auditor", name: "Meera Iyer", trust: 90, deviceTrust: 85 },
  { role: "admin", name: "Rohan Desai", trust: 96, deviceTrust: 90 },
];

export const DEMO_POLICIES: PolicySpecInput[] = [
  { key: "POL-001", name: "View asset metadata", subject: { role: ["engineer", "manager", "auditor", "admin"] }, action: "asset.view", effect: "allow", priority: 100 },
  { key: "POL-002", name: "Open asset content", subject: { role: ["engineer", "manager", "admin"] }, action: "asset.open", effect: "allow", condition: { maxRiskTier: "elevated" }, priority: 100 },
  {
    key: "POL-009",
    name: "Download high-sensitivity designs",
    subject: { role: ["engineer", "manager", "admin"] },
    action: "asset.download",
    resource: { sensitivity: ["high"] },
    condition: { hours: [8, 20], deviceTrusted: true, maxRiskTier: "elevated" },
    effect: "step_up",
    priority: 120,
  },
  { key: "POL-010", name: "Download ordinary assets", subject: { role: ["engineer", "manager", "admin"] }, action: "asset.download", resource: { sensitivity: ["low", "medium"] }, condition: { maxRiskTier: "elevated" }, effect: "allow", priority: 100 },
  {
    key: "POL-011",
    name: "Transfer ownership (two-person rule)",
    subject: { role: ["engineer", "manager", "admin"] },
    action: "asset.transfer",
    effect: "require_approval",
    approval: { approverRole: "manager", count: 1, distinctFromRequester: true },
    condition: { maxRiskTier: "elevated" },
    priority: 100,
  },
  { key: "POL-020", name: "Export models and designs", subject: { role: ["manager", "admin"] }, action: "asset.export", effect: "step_up", condition: { hours: [8, 20], deviceTrusted: true, maxRiskTier: "low" }, priority: 100 },
  { key: "POL-030", name: "Delete assets (admin, two-person)", subject: { role: ["admin"] }, action: "asset.delete", effect: "require_approval", approval: { approverRole: "admin", count: 1, distinctFromRequester: true }, priority: 100 },
];

export function demoDeviceFingerprint(role: Role): string {
  return sha256Hex(`vajra-demo-device:${role}`);
}

export async function wipeAll(ctx: Pick<AppContext, "db">): Promise<void> {
  const db = ctx.db;
  for (const t of [
    evidencePackages,
    proofCertificates,
    incidents,
    approvals,
    breakGlassGrants,
    accessRequests,
    grants,
    assetTransfers,
    assetVersions,
    assets,
    livenessAttestations,
    livenessNonces,
    trustEvents,
    credentials,
    devices,
    demoIdentities,
    policyVersions,
    policies,
    auditEvents,
    ledgerOutbox,
    ledgerStateHistory,
    ledgerState,
    ledgerBlocks,
    users,
  ]) {
    await db.delete(t);
  }
  await db.execute(sql`alter sequence audit_events_seq_seq restart with 1`);
  await db.execute(sql`alter sequence ledger_state_history_id_seq restart with 1`);
}

export async function seedDemo(ctx: AppContext): Promise<{ users: { role: Role; did: string; name: string }[] }> {
  const createdAt = new Date(Date.now() - 400 * 86_400_000);
  const people: { role: Role; did: string; name: string }[] = [];
  const sessions: Partial<Record<Role, Session>> = {};

  await withTx(ctx.db, async (tx) => {
    for (const p of DEMO_PEOPLE) {
      const kp = keyPairFromSecret(`vajra-demo:${p.role}`);
      const did = didKeyFromRaw(kp.publicRaw);
      const publicKeyJwk = kp.publicKey.export({ format: "jwk" }) as Record<string, string>;
      const privateKeyJwk = kp.privateKey.export({ format: "jwk" }) as Record<string, string>;
      const [user] = await tx
        .insert(users)
        .values({ did, displayName: p.name, role: p.role, publicKeyJwk, baseline: DEFAULT_BASELINE, identityTrust: p.trust, livenessMode: "faceapi", createdAt })
        .returning();
      const fp = demoDeviceFingerprint(p.role);
      const [device] = await tx
        .insert(devices)
        .values({ userId: user!.id, fingerprintHash: fp, label: `${p.name.split(" ")[0]}'s laptop`, deviceTrust: p.deviceTrust, trusted: true, firstSeen: createdAt, lastSeen: new Date(), lastGeo: DEFAULT_BASELINE.homeGeo })
        .returning();
      await tx.insert(trustEvents).values([
        { subjectType: "identity", subjectId: did, delta: 0, reason: "onboarded", scoreAfter: 60, createdAt },
        { subjectType: "identity", subjectId: did, delta: p.trust - 60, reason: "clean_history", scoreAfter: p.trust, createdAt: new Date(createdAt.getTime() + 86_400_000) },
        { subjectType: "device", subjectId: device!.id, delta: 0, reason: "first_seen", scoreAfter: 40, createdAt },
        { subjectType: "device", subjectId: device!.id, delta: p.deviceTrust - 40, reason: "admin_trusted", scoreAfter: p.deviceTrust, createdAt: new Date(createdAt.getTime() + 86_400_000) },
      ]);
      const { vcJwt, vcHash } = await issueIdentityCredential(ctx, user!, "faceapi");
      const [cred] = await tx.insert(credentials).values({ userId: user!.id, vcJwt, vcHash, issuedAt: createdAt }).returning();
      await enqueueLedger(tx, { contract: "DIDRegistry", fn: "RegisterDID", args: [did, sha256Hex(publicKeyJwk.x ?? ""), vcHash], refTable: "credentials", refId: cred!.id });
      await tx.insert(demoIdentities).values({ userId: user!.id, role: p.role, privateKeyJwk, deviceFingerprintHash: fp });
      await appendAudit({ db: tx }, { eventType: "identity.onboarded", actorDid: did, payload: { role: p.role, livenessMode: "faceapi", deviceId: device!.id, vcHash, seeded: true, biometricBytesStored: 0 } }, tx);
      people.push({ role: p.role, did, name: p.name });
      sessions[p.role] = { claims: { sub: did, uid: user!.id, role: p.role, sv: 1, dev: device!.id }, user: user!, device: device!, fresh: true };
    }
  });

  // policies are anchored one by one (each closes nothing — first versions)
  const adminDid = people.find((p) => p.role === "admin")!.did;
  for (const spec of DEMO_POLICIES) await createPolicyVersion(ctx, spec, adminDid);

  // identities must be on the ledger before assets can be minted for them
  await ctx.outbox.drain();

  const modelCard = Buffer.from(
    JSON.stringify(
      {
        model: "DefenceVision-v4",
        framework: "PyTorch 2.4",
        dataset: "DS-42 (aerial, 1.2M frames)",
        trainingRun: "run-2026-07-18-v12",
        metrics: { mAP: 0.912, latencyMs: 14 },
        approvedBy: "Research Lead",
        note: "Synthetic model card used for the VAJRA demo — weights are represented by this card.",
      },
      null,
      2,
    ),
  );
  await uploadAsset(ctx, sessions.manager!, { buffer: modelCard, filename: "DefenceVision-v4.modelcard.json", mime: "application/json" }, {
    name: "DefenceVision-v4",
    class: "model",
    sensitivity: "high",
    passportMeta: { dataset: "DS-42", trainingRun: "run-2026-07-18-v12", framework: "PyTorch 2.4", approvedBy: "Research Lead", deployment: "production" },
  });
  const checklist = Buffer.from(
    ["# Vendor onboarding checklist", "", "- [x] NDA signed", "- [x] Security questionnaire", "- [ ] API credentials issued through VAJRA", "- [ ] Quarterly access review scheduled", ""].join("\n"),
  );
  await uploadAsset(ctx, sessions.admin!, { buffer: checklist, filename: "vendor-onboarding-checklist.md", mime: "text/markdown" }, {
    name: "Vendor Onboarding Checklist",
    class: "document",
    sensitivity: "low",
    passportMeta: { department: "Procurement" },
  });
  await ctx.outbox.drain();
  return { users: people };
}

export async function resetDemo(ctx: AppContext) {
  await wipeAll(ctx);
  return seedDemo(ctx);
}
