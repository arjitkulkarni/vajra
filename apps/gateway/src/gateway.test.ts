/**
 * Gateway integration tests — the invariants that must never regress.
 * The full seven-scene walkthrough lives in scripts/e2e.ts; this suite pins the security properties
 * that would be easiest to break by accident.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import type { AppContext } from "./context";
import { assets, auditEvents, demoIdentities, enrolments, faceVerifications, incidents, users } from "./db/schema";
import { b64u, didKeyFromRaw, ed25519, keyPairFromSecret, privateKeyFromSeed, sha256Hex } from "./lib/crypto";
import { verifyAuditChain } from "./modules/audit/service";
import { seedDemo } from "./modules/demo/seed";

let app: FastifyInstance;
let ctx: AppContext;
let close: () => Promise<void>;

const json = <T = Record<string, any>>(res: { body: string }): T => JSON.parse(res.body) as T;

async function call(method: string, url: string, opts: { token?: string; body?: unknown; scenario?: unknown } = {}) {
  const res = await app.inject({
    method: method as "GET",
    url,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.scenario ? { "x-vajra-demo-context": JSON.stringify(opts.scenario) } : {}),
      ...(opts.body ? { "content-type": "application/json" } : {}),
    },
    payload: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.statusCode, json: json(res) };
}

async function login(role: string) {
  const res = await call("POST", "/v1/demo/login", { body: { role } });
  return res.json as { sessionJwt: string; user: { did: string; displayName: string } };
}

async function signAs(role: string, nonce: string) {
  const row = (await ctx.db.select().from(demoIdentities).where(eq(demoIdentities.role, role)).limit(1))[0]!;
  return ed25519.sign(privateKeyFromSeed(b64u.decode(row.privateKeyJwk.d ?? "")), nonce);
}

async function deviceFp(role: string) {
  return sha256Hex(`vajra-demo-device:${role}`);
}

beforeAll(async () => {
  const built = await buildApp({ DB_MODE: "memory", STORAGE_MODE: "memory", LEDGER_MODE: "lite", RISK_MODE: "local", ANALYST_MODE: "template", DEMO_MODE: "true", LOG_LEVEL: "silent" });
  app = built.app;
  ctx = built.ctx;
  close = built.close;
  await seedDemo(ctx);
  await ctx.outbox.drain();
}, 120_000);

afterAll(async () => {
  await close();
});

describe("health and seeding", () => {
  it("reports every dependency and the running modes", async () => {
    const { json: h } = await call("GET", "/v1/health");
    expect(h.ok).toBe(true);
    expect(Object.keys(h.deps).sort()).toEqual(["db", "ledger", "risk", "storage"]);
    expect(h.modes.ledger).toBe("lite");
  });

  it("seeds four identities, seven policies and two assets, all anchored", async () => {
    const { json: stats } = await call("GET", "/v1/stats");
    expect(stats.identities).toBe(4);
    expect(stats.assets).toBe(2);
    expect(stats.pendingAnchors).toBe(0);
    expect(stats.faceImagesEncrypted).toBe(true);
    const { json: policies } = await call("GET", "/v1/policies", { token: (await login("admin")).sessionJwt });
    expect((policies as unknown as unknown[]).length).toBe(7);
  });

  it("recomputes asset trust once the mint is anchored", async () => {
    const engineer = await login("engineer");
    const list = (await call("GET", "/v1/assets", { token: engineer.sessionJwt })).json as unknown as { assetTrust: number }[];
    expect(list.every((a) => a.assetTrust === 100)).toBe(true);
  });
});

describe("identity", () => {
  it("refuses a DID that does not match its public key", async () => {
    const start = (await call("POST", "/v1/onboard/start")).json;
    const kp = keyPairFromSecret("mismatch-test");
    const res = await call("POST", "/v1/onboard/complete", {
      body: {
        did: "did:key:z6MkwrongwrongwrongwrongwrongwrongwrongwrongwX",
        publicKeyJwk: kp.publicKey.export({ format: "jwk" }),
        nonce: start.nonce,
        signature: ed25519.sign(kp.privateKey, start.nonce),
        deviceFingerprintHash: "unit-test-device-0001",
        displayName: "Mismatch",
        livenessMode: "simulated",
      },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toMatch(/did_mismatch|public_key_invalid/);
  });

  it("refuses an attestation whose signature does not verify", async () => {
    const start = (await call("POST", "/v1/onboard/start")).json;
    const kp = keyPairFromSecret("bad-signature-test");
    const res = await call("POST", "/v1/onboard/complete", {
      body: {
        did: didKeyFromRaw(kp.publicRaw),
        publicKeyJwk: kp.publicKey.export({ format: "jwk" }),
        nonce: start.nonce,
        signature: b64u.encode(Buffer.alloc(64, 7)),
        deviceFingerprintHash: "unit-test-device-0002",
        displayName: "Bad signature",
        livenessMode: "simulated",
      },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("attestation_invalid");
  });

  it("burns the nonce even when verification fails, so it cannot be retried", async () => {
    const start = (await call("POST", "/v1/onboard/start")).json;
    const kp = keyPairFromSecret("nonce-burn-test");
    const body = {
      did: didKeyFromRaw(kp.publicRaw),
      publicKeyJwk: kp.publicKey.export({ format: "jwk" }),
      nonce: start.nonce,
      signature: b64u.encode(Buffer.alloc(64, 9)),
      deviceFingerprintHash: "unit-test-device-0003",
      displayName: "Nonce burn",
      livenessMode: "simulated" as const,
    };
    await call("POST", "/v1/onboard/complete", { body });
    const second = await call("POST", "/v1/onboard/complete", { body: { ...body, signature: ed25519.sign(kp.privateKey, start.nonce) } });
    expect(second.json.error.code).toBe("nonce_invalid");
  });
});

describe("decisions", () => {
  it("explains an allow and issues a certificate", async () => {
    const manager = await login("manager");
    const fp = await deviceFp("manager");
    const asset = ((await call("GET", "/v1/assets", { token: manager.sessionJwt })).json as unknown as { assetUid: string; sensitivity: string }[]).find((a) => a.sensitivity === "high")!;
    const res = await call("POST", `/v1/assets/${asset.assetUid}/request`, {
      token: manager.sessionJwt,
      body: { action: "asset.view", context: { deviceId: fp } },
      scenario: { deviceId: fp, localHour: 11, geo: { lat: 12.97, lng: 77.59, city: "Bengaluru" } },
    });
    expect(res.json.verdict).toBe("ALLOW");
    expect(res.json.latencyMs).toBeLessThan(300);
    expect(res.json.certId).toBeTruthy();
    expect(res.json.trace.checks.every((c: { result: string }) => c.result === "pass")).toBe(true);
  });

  it("denies the insider scenario with named signals and opens an incident", async () => {
    const engineer = await login("engineer");
    const fp = await deviceFp("engineer");
    const asset = ((await call("GET", "/v1/assets", { token: engineer.sessionJwt })).json as unknown as { assetUid: string; sensitivity: string }[]).find((a) => a.sensitivity === "high")!;
    // Impossible travel is measured against this identity's last known location, so establish one.
    await call("POST", `/v1/assets/${asset.assetUid}/request`, {
      token: engineer.sessionJwt,
      body: { action: "asset.view", context: { deviceId: fp } },
      scenario: { deviceId: fp, localHour: 11, geo: { lat: 12.97, lng: 77.59, city: "Bengaluru" } },
    });
    const res = await call("POST", `/v1/assets/${asset.assetUid}/request`, {
      token: engineer.sessionJwt,
      body: { action: "asset.download", context: { deviceId: "unknown-device-unit" } },
      scenario: { deviceId: "unknown-device-unit", localHour: 2, geo: { lat: 19.076, lng: 72.8777, city: "Mumbai" }, burst: 47 },
    });
    expect(res.json.verdict).toBe("DENY");
    expect(res.json.risk.tier).toBe("high");
    expect(res.json.risk.signals).toContain("impossible_travel");
    expect(res.json.trace.reasons.length).toBeGreaterThan(1);
    expect(res.json.incidentId).toBeTruthy();
    expect(res.json.effectivePermissions["asset.transfer"]).toBe("deny");
  });

  it("fails closed for sensitive actions when the ledger is unavailable, but not for reads", async () => {
    const manager = await login("manager");
    const fp = await deviceFp("manager");
    const asset = ((await call("GET", "/v1/assets", { token: manager.sessionJwt })).json as unknown as { assetUid: string; sensitivity: string }[]).find((a) => a.sensitivity === "high")!;
    await call("POST", "/v1/demo/outage", { body: { dependency: "ledger", down: true } });
    const blocked = await call("POST", `/v1/assets/${asset.assetUid}/request`, {
      token: manager.sessionJwt,
      body: { action: "asset.download", context: { deviceId: fp } },
      scenario: { deviceId: fp, localHour: 11 },
    });
    expect(blocked.json.trace.reasons).toContain("dependency_down:ledger");
    const readable = await call("POST", `/v1/assets/${asset.assetUid}/request`, {
      token: manager.sessionJwt,
      body: { action: "asset.view", context: { deviceId: fp } },
      scenario: { deviceId: fp, localHour: 11 },
    });
    expect(readable.json.verdict).toBe("ALLOW");
    await call("POST", "/v1/demo/outage", { body: { dependency: "ledger", down: false } });
    await ctx.outbox.drain();
    expect(await ctx.outbox.pendingCount()).toBe(0);
  });
});

describe("evidence", () => {
  it("keeps the audit chain intact and detects a tampered payload", async () => {
    const before = await verifyAuditChain(ctx.db);
    expect(before.ok).toBe(true);
    expect(before.checked).toBeGreaterThan(10);

    const row = (await ctx.db.select().from(auditEvents).limit(1))[0]!;
    await ctx.db.update(auditEvents).set({ payload: { ...row.payload, tampered: true } }).where(eq(auditEvents.id, row.id));
    const after = await verifyAuditChain(ctx.db);
    expect(after.ok).toBe(false);
    expect(after.brokenAtSeq).toBe(row.seq);

    await ctx.db.update(auditEvents).set({ payload: row.payload }).where(eq(auditEvents.id, row.id));
    expect((await verifyAuditChain(ctx.db)).ok).toBe(true);
  });

  it("verifies a Proof-of-Action and rejects an altered one", async () => {
    const manager = await login("manager");
    const auditor = await login("auditor");
    const fp = await deviceFp("manager");
    const asset = ((await call("GET", "/v1/assets", { token: manager.sessionJwt })).json as unknown as { assetUid: string }[])[0]!;
    const decision = await call("POST", `/v1/assets/${asset.assetUid}/request`, {
      token: manager.sessionJwt,
      body: { action: "asset.view", context: { deviceId: fp } },
      scenario: { deviceId: fp, localHour: 11 },
    });
    await ctx.outbox.drain();
    const cert = (await call("GET", `/v1/proofs/${decision.json.certId}`, { token: auditor.sessionJwt })).json;

    const good = await call("POST", "/v1/verify/proof", { token: auditor.sessionJwt, body: { proof: cert } });
    expect(good.json.valid).toBe(true);

    const tampered = { ...cert, trust: { ...cert.trust, identity: 100 } };
    const bad = await call("POST", "/v1/verify/proof", { token: auditor.sessionJwt, body: { proof: tampered } });
    expect(bad.json.valid).toBe(false);
    expect(bad.json.checks.find((c: { id: string }) => c.id === "hash").ok).toBe(false);
  });
});

describe("governance", () => {
  it("refuses a transfer approved by the person who requested it", async () => {
    // A freshly onboarded identity: no open incident, and browser-style keys we hold here — so this
    // also exercises the real attestation path rather than the demo signing shortcut.
    const kp = keyPairFromSecret(`governance-${Date.now()}`);
    const did = didKeyFromRaw(kp.publicRaw);
    const fp = `governance-device-${Date.now()}`;
    const start = (await call("POST", "/v1/onboard/start")).json;
    const onboarded = await call("POST", "/v1/onboard/complete", {
      body: {
        did,
        publicKeyJwk: kp.publicKey.export({ format: "jwk" }),
        nonce: start.nonce,
        signature: ed25519.sign(kp.privateKey, start.nonce),
        deviceFingerprintHash: fp,
        displayName: "Governance Tester",
        livenessMode: "simulated",
        role: "manager",
      },
    });
    const token = onboarded.json.sessionJwt as string;
    const manager = await login("manager");

    const form = new FormData();
    form.append("file", new Blob([Buffer.from(`unit-test transfer asset ${Date.now()}`)]), "unit.cad");
    form.append("name", "Unit transfer asset");
    form.append("class", "design");
    form.append("sensitivity", "high");
    const uploaded = json(await app.inject({ method: "POST", url: "/v1/assets", headers: { authorization: `Bearer ${token}` }, payload: form as unknown as undefined }));
    await ctx.outbox.drain();

    const scenario = { deviceId: fp, localHour: 11, geo: { lat: 12.97, lng: 77.59, city: "Bengaluru" } };
    const req = await call("POST", `/v1/assets/${uploaded.assetUid}/request`, {
      token,
      body: { action: "asset.transfer", context: { deviceId: fp }, toDid: manager.user.did },
      scenario,
    });
    expect(req.json.verdict).toBe("STEP_UP");

    const stepped = await call("POST", `/v1/requests/${req.json.requestId}/step-up`, {
      token,
      body: { nonce: req.json.stepUp.nonce, signature: ed25519.sign(kp.privateKey, req.json.stepUp.nonce), livenessMode: "simulated" },
    });
    expect(stepped.json.verdict).toBe("PENDING_APPROVAL");

    // The requester cannot approve their own request — that is the entire point of the rule.
    const self = await call("POST", `/v1/approvals/${stepped.json.approvalId}/challenge`, { token });
    expect(self.status).toBe(403);
    expect(self.json.error.code).toBe("approver_is_requester");

    const ch = await call("POST", `/v1/approvals/${stepped.json.approvalId}/challenge`, { token: manager.sessionJwt });
    const decided = await call("POST", `/v1/approvals/${stepped.json.approvalId}/decide`, {
      token: manager.sessionJwt,
      body: { approve: true, reason: "unit test", attestation: { nonce: ch.json.nonce, signature: await signAs("manager", ch.json.nonce), livenessMode: "simulated" } },
    });
    expect(decided.json.status).toBe("approved");
    await ctx.outbox.drain();
    const owner = (await ctx.db.select().from(assets).where(eq(assets.assetUid, uploaded.assetUid)).limit(1))[0]!;
    expect(owner.ownerDid).toBe(manager.user.did);
  }, 60_000);

  it("recognises identical bytes uploaded under a different name", async () => {
    const engineer = await login("engineer");
    const bytes = `duplicate-detection-${Date.now()}`;
    const mk = (filename: string) => {
      const form = new FormData();
      form.append("file", new Blob([Buffer.from(bytes)]), filename);
      form.append("name", filename);
      form.append("class", "design");
      form.append("sensitivity", "high");
      return form;
    };
    const first = json(await app.inject({ method: "POST", url: "/v1/assets", headers: { authorization: `Bearer ${engineer.sessionJwt}` }, payload: mk("original.cad") as unknown as undefined }));
    const second = await app.inject({ method: "POST", url: "/v1/assets", headers: { authorization: `Bearer ${engineer.sessionJwt}` }, payload: mk("final_final_REAL.cad") as unknown as undefined });
    expect(second.statusCode).toBe(409);
    expect(json(second).error.details.assetUid).toBe(first.assetUid);
  });
});

/**
 * `livenessMode: "simulated"` means the browser measured no face at all — no camera, or no model
 * weights. It is allowed to satisfy the liveness gate so a laptop with no camera can still walk the
 * whole cryptographic path on stage, and that affordance is worth keeping. But it is an
 * unconditional pass on the one gate that proves a person was present, so outside DEMO_MODE it is
 * an authentication bypass: block the camera, sign the nonce, and the face never has to match.
 */
describe("re-enrolment", () => {
  /**
   * `enrolments.employee_id` is unique, and for a long time only the `users` table was consulted
   * before an application was written. The two disagree the moment somebody applies twice: the
   * second application renames the `users` row to the new employee ID and leaves the first
   * application behind still holding the old one, so coming back to that first ID passed a gate
   * that said "free" and then hit a constraint that said otherwise — surfacing as a 500 with
   * nothing in it the person could act on, after they had already stood through the face check.
   */
  const apply = async (kp: ReturnType<typeof keyPairFromSecret>, employeeId: string, fp: string) => {
    const start = (await call("POST", "/v1/auth/signup/start")).json;
    const form = new FormData();
    form.append(
      "payload",
      JSON.stringify({
        employeeId,
        displayName: "Re-enrolment Tester",
        did: didKeyFromRaw(kp.publicRaw),
        publicKeyJwk: kp.publicKey.export({ format: "jwk" }),
        deviceFingerprintHash: fp,
        faceTemplate: Array.from({ length: 512 }, (_, i) => Math.sin(i) / 22),
        faceTemplateSamples: 5,
        faceTemplateModel: "adaface",
        role: "engineer",
        evidence: {
          nonce: start.nonce,
          signature: ed25519.sign(kp.privateKey, start.nonce),
          faceMatchScore: 78,
          livenessMode: "faceapi",
          livenessScore: 0.71,
          livenessSignals: { depth: 0.6, motion: 0.55, response: 1, focus: 0.8, texture: 0.7 },
        },
      }),
    );
    form.append("idDocument", new Blob([Buffer.from("card")], { type: "image/png" }), "id.png");
    form.append("faceImage", new Blob([Buffer.from("frame")], { type: "image/jpeg" }), "face.jpg");
    const res = await app.inject({ method: "POST", url: "/v1/auth/signup/submit", payload: form as unknown as undefined });
    return { status: res.statusCode, json: json(res) };
  };

  it("lets one identity re-apply, and supersedes its own open application", async () => {
    const kp = keyPairFromSecret(`re-enrol-${Date.now()}`);
    const did = didKeyFromRaw(kp.publicRaw);
    const a = `RE-${Date.now()}-A`;
    const b = `RE-${Date.now()}-B`;
    const fp = `re-enrol-device-${Date.now()}`;

    expect((await apply(kp, a, fp)).status).toBe(200);
    expect((await apply(kp, b, fp)).status).toBe(200);
    // Back to the first ID — the case that used to 500.
    expect((await apply(kp, a, fp)).status).toBe(200);

    // One identity, one open application: the superseded ones are gone rather than stacked up in
    // the administrator's queue under employee IDs this person is no longer claiming.
    const open = await ctx.db.select().from(enrolments).where(eq(enrolments.did, did));
    expect(open).toHaveLength(1);
    expect(open[0]!.employeeId).toBe(a);

    // The evidence of every attempt survives the application being replaced.
    const captures = await ctx.db.select().from(faceVerifications).where(eq(faceVerifications.did, did));
    expect(captures.length).toBe(3);
  }, 60_000);

  it("still refuses an employee ID somebody else has applied for, as a gate and not a crash", async () => {
    const mine = keyPairFromSecret(`re-enrol-mine-${Date.now()}`);
    const theirs = keyPairFromSecret(`re-enrol-theirs-${Date.now()}`);
    const employeeId = `RE-SHARED-${Date.now()}`;

    expect((await apply(mine, employeeId, `dev-mine-${Date.now()}`)).status).toBe(200);
    const clash = await apply(theirs, employeeId, `dev-theirs-${Date.now()}`);

    expect(clash.status).toBe(403);
    expect(clash.json.error.code).toBe("verification_failed");
    const idGate = (clash.json.error.details.checks as { id: string; result: string; detailKey: string }[]).find((c) => c.id === "employee_id");
    expect(idGate?.result).toBe("fail");
    expect(idGate?.detailKey).toBe("verify.employeeId.taken");
  }, 60_000);
});

describe("live AI check", () => {
  /**
   * A presentation attack does not just fail the action it was aimed at — it ends the sessions the
   * account already has. That is the part worth pinning: refusing the step-up is easy, and it is
   * also what a merely bad capture gets. What separates the two is everything after the refusal.
   *
   * The signature here is genuine and the nonce is fresh, so nothing cryptographic is wrong with
   * this proof. The only thing wrong with it is that the device reported watching a screen.
   */
  it("refuses the action, opens an S3 incident and locks every session on the identity", async () => {
    const kp = keyPairFromSecret(`spoof-${Date.now()}`);
    const did = didKeyFromRaw(kp.publicRaw);
    const fp = `spoof-device-${Date.now()}`;
    const start = (await call("POST", "/v1/onboard/start")).json;
    const onboarded = await call("POST", "/v1/onboard/complete", {
      body: {
        did,
        publicKeyJwk: kp.publicKey.export({ format: "jwk" }),
        nonce: start.nonce,
        signature: ed25519.sign(kp.privateKey, start.nonce),
        deviceFingerprintHash: fp,
        displayName: "Spoof Tester",
        livenessMode: "simulated",
        role: "manager",
      },
    });
    const token = onboarded.json.sessionJwt as string;
    const manager = await login("manager");

    const form = new FormData();
    form.append("file", new Blob([Buffer.from(`unit-test spoof asset ${Date.now()}`)]), "spoof.cad");
    form.append("name", "Unit spoof asset");
    form.append("class", "design");
    form.append("sensitivity", "high");
    const uploaded = json(await app.inject({ method: "POST", url: "/v1/assets", headers: { authorization: `Bearer ${token}` }, payload: form as unknown as undefined }));
    await ctx.outbox.drain();

    const scenario = { deviceId: fp, localHour: 11, geo: { lat: 12.97, lng: 77.59, city: "Bengaluru" } };
    const req = await call("POST", `/v1/assets/${uploaded.assetUid}/request`, {
      token,
      body: { action: "asset.transfer", context: { deviceId: fp }, toDid: manager.user.did },
      scenario,
    });
    expect(req.json.verdict).toBe("STEP_UP");

    const stepped = await call("POST", `/v1/requests/${req.json.requestId}/step-up`, {
      token,
      body: {
        nonce: req.json.stepUp.nonce,
        // A real signature over the real nonce: the proof itself is sound.
        signature: ed25519.sign(kp.privateKey, req.json.stepUp.nonce),
        livenessMode: "faceapi",
        livenessScore: 0.82,
        livenessSignals: { depth: 0.8, motion: 0.7, response: 1, focus: 0.9, texture: 0.8 },
        // ... of a face the model is near-certain was not live. Well under ANTISPOOF_MIN_LIVE.
        spoofCheck: { model: "minifasnet_v2_2.7_80x80", samples: 5, liveProbability: 0.01 },
      },
    });
    expect(stepped.json.verdict).toBe("DENY");
    await ctx.outbox.drain();

    const incident = (await ctx.db.select().from(incidents).where(eq(incidents.actorDid, did)).limit(1))[0];
    expect(incident?.severity).toBe("S3");
    expect(incident?.summary).toContain("presentation_attack");
    // The response ladder, not a special case: S3 is what locks sessions, expires content URLs and
    // revokes temporary grants, and a detected attack is what puts the incident there.
    expect(incident?.responses).toContain("session_locked");

    // The consequence, from the outside: the token that was working two calls ago is now refused,
    // and refused as locked rather than merely expired.
    const after = await call("GET", "/v1/me", { token });
    expect(after.status).toBe(401);
    expect(after.json.error.code).toBe("session_locked");

    // The account itself is untouched. Revoking an identity is an administrator's decision made
    // against this incident — never a model's to take on its own.
    const row = (await ctx.db.select().from(users).where(eq(users.did, did)).limit(1))[0];
    expect(row?.status).toBe("active");
  }, 60_000);

  it("says nothing about a capture whose AI check could not run", async () => {
    // No weights on the device means no spoofCheck in the evidence, and that has to stay an
    // ordinary onboarding rather than a refusal — otherwise every machine that has not run
    // `pnpm models:fetch` is locked out by a check it was never able to perform.
    const kp = keyPairFromSecret(`no-spoof-check-${Date.now()}`);
    const start = (await call("POST", "/v1/onboard/start")).json;
    const res = await call("POST", "/v1/onboard/complete", {
      body: {
        did: didKeyFromRaw(kp.publicRaw),
        publicKeyJwk: kp.publicKey.export({ format: "jwk" }),
        nonce: start.nonce,
        signature: ed25519.sign(kp.privateKey, start.nonce),
        deviceFingerprintHash: `no-spoof-check-device-${Date.now()}`,
        displayName: "No AI Check",
        livenessMode: "simulated",
      },
    });
    expect(res.status).toBe(200);
    expect(res.json.sessionJwt).toBeTruthy();
  }, 60_000);
});

describe("simulated evidence", () => {
  it("is refused outside DEMO_MODE, and the refusal names the gate", async () => {
    const strict = await buildApp({
      DB_MODE: "memory",
      STORAGE_MODE: "memory",
      LEDGER_MODE: "lite",
      RISK_MODE: "local",
      DEMO_MODE: "false",
      MASTER_KEK: "test-kek-simulated-evidence",
      SESSION_JWT_SECRET: "test-session-simulated-evidence",
    });
    try {
      const start = json<{ nonce: string }>(await strict.app.inject({ method: "POST", url: "/v1/auth/signup/start" }));
      const kp = keyPairFromSecret("simulated-evidence-probe");
      const form = new FormData();
      form.append(
        "payload",
        JSON.stringify({
          employeeId: "SIM-0001",
          displayName: "Simulated Probe",
          did: didKeyFromRaw(kp.publicRaw),
          publicKeyJwk: kp.publicKey.export({ format: "jwk" }),
          deviceFingerprintHash: "f".repeat(64),
          // A real, well-formed template — the point is the *mode*, not a malformed payload.
          faceTemplate: Array.from({ length: 128 }, (_, i) => Math.sin(i) / 4),
          faceTemplateSamples: 5,
          faceTemplateModel: "faceapi",
          evidence: {
            nonce: start.nonce,
            signature: ed25519.sign(kp.privateKey, start.nonce),
            // Exactly what LivenessCapture's simulated path reports: the floor, and nothing measured.
            faceMatchScore: 45,
            livenessMode: "simulated",
            livenessScore: 0,
            livenessSignals: {},
          },
        }),
      );
      form.append("idDocument", new Blob([Buffer.from("card")], { type: "image/png" }), "id.png");
      form.append("faceImage", new Blob([Buffer.from("frame")], { type: "image/jpeg" }), "face.jpg");
      const res = await strict.app.inject({ method: "POST", url: "/v1/auth/signup/submit", payload: form as unknown as undefined });

      expect(res.statusCode).toBe(403);
      const checks = json(res).error.details.checks as { id: string; result: string }[];
      expect(json(res).error.code).toBe("verification_failed");
      expect(checks.find((c) => c.id === "liveness")?.result).toBe("fail");
      // All five are still evaluated and recorded — a refusal is evidence too.
      expect(checks).toHaveLength(5);
    } finally {
      await strict.close();
    }
  }, 60_000);
});
