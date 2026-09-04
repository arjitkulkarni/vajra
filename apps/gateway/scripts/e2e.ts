/**
 * End-to-end proof that the whole trust loop works, run against an in-memory database and the lite
 * ledger. Every claim VAJRA makes on stage is asserted here:
 *
 *   onboard → passport → explainable decision → step-up → two-person approval → anchored audit
 *   → Proof VALID → insider incident → attack replay → evidence VALID → fail-closed → revocation
 *   → time-travel
 */
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app";
import { CONSOLE_KEY_HEADER, consoleKey } from "../src/lib/console-key";
import { demoIdentities, users } from "../src/db/schema";
import { b64u, didKeyFromRaw, ed25519, keyPairFromSecret, privateKeyFromSeed } from "../src/lib/crypto";
import { seedDemo } from "../src/modules/demo/seed";
import { verifyAuditChain } from "../src/modules/audit/service";
import adafaceFixture from "../../web/src/lib/__fixtures__/adaface-embeddings.json" with { type: "json" };

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    passed++;
    console.log(`  [32m✓[0m ${label}`);
  } else {
    failed++;
    console.log(`  [31m✗[0m ${label}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
  }
};
const scene = (n: string) => console.log(`\n[1m${n}[0m`);

const { app, ctx, close } = await buildApp({
  DB_MODE: "memory",
  STORAGE_MODE: "memory",
  LEDGER_MODE: "lite",
  RISK_MODE: "local",
  ANALYST_MODE: "template",
  DEMO_MODE: "true",
  LOG_LEVEL: "silent",
});

/**
 * The console key the administrative plane demands. Derived from the same secret the app booted
 * with, exactly as a browser would present it after following the issued link — so these scenes
 * exercise the real three-check path (key, then network, then role) rather than a bypass.
 */
const CONSOLE_KEY = consoleKey(ctx.config.ADMIN_CONSOLE_SECRET);
const consoleHeaders = { [CONSOLE_KEY_HEADER]: CONSOLE_KEY };

type Json = Record<string, any>;

/**
 * The enrolment routes take files, so the harness has to speak multipart. Hand-rolled rather than
 * pulled in: it is twenty lines, and it keeps the e2e script dependency-free.
 */
const BOUNDARY = "----vajrae2e";
interface Part {
  name: string;
  value?: string;
  filename?: string;
  mime?: string;
  body?: string;
}
const multipart = (parts: Part[]): { contentType: string; payload: Buffer } => {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const disposition = p.filename ? `form-data; name="${p.name}"; filename="${p.filename}"` : `form-data; name="${p.name}"`;
    const headers = p.filename ? `Content-Disposition: ${disposition}\r\nContent-Type: ${p.mime ?? "application/octet-stream"}\r\n\r\n` : `Content-Disposition: ${disposition}\r\n\r\n`;
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n${headers}`), Buffer.from(p.body ?? p.value ?? ""), Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return { contentType: `multipart/form-data; boundary=${BOUNDARY}`, payload: Buffer.concat(chunks) };
};

const call = async (
  method: string,
  url: string,
  opts: { token?: string; body?: unknown; scenario?: unknown; multipart?: { contentType: string; payload: Buffer } } = {},
): Promise<{ status: number; json: Json }> => {
  const res = await app.inject({
    method: (opts.multipart ? "POST" : method) as "GET",
    url,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.scenario ? { "x-vajra-demo-context": JSON.stringify(opts.scenario) } : {}),
      ...(opts.body ? { "content-type": "application/json" } : {}),
      ...(opts.multipart ? { "content-type": opts.multipart.contentType } : {}),
      ...consoleHeaders,
    },
    payload: opts.multipart ? opts.multipart.payload : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: Json = {};
  try {
    json = res.json() as Json;
  } catch {
    json = { raw: res.body.slice(0, 200) };
  }
  return { status: res.statusCode, json };
};

async function signAs(role: string, nonce: string): Promise<string> {
  const row = (await ctx.db.select().from(demoIdentities).where(eq(demoIdentities.role, role)).limit(1))[0]!;
  return ed25519.sign(privateKeyFromSeed(b64u.decode(row.privateKeyJwk.d ?? "")), nonce);
}

try {
  await seedDemo(ctx);
  await ctx.outbox.drain();

  // ── Scene 1: onboarding a brand-new person, browser-side keys ──────────────
  scene("Scene 1 — Onboard (live face → DID, browser-held keys)");
  const start = await call("POST", "/v1/onboard/start");
  check("challenge issued", start.status === 200 && !!start.json.nonce, start.json);
  const kp = keyPairFromSecret("e2e-volunteer");
  const did = didKeyFromRaw(kp.publicRaw);
  const complete = await call("POST", "/v1/onboard/complete", {
    body: {
      did,
      publicKeyJwk: kp.publicKey.export({ format: "jwk" }),
      nonce: start.json.nonce,
      signature: ed25519.sign(kp.privateKey, start.json.nonce),
      deviceFingerprintHash: "e2e-volunteer-laptop-0001",
      displayName: "Volunteer",
      livenessMode: "faceapi",
    },
  });
  check("DID registered and session issued", complete.status === 200 && complete.json.user?.did === did, complete.json);
  check("new identity starts at conservative trust 60", complete.json.user?.identityTrust === 60);
  const replay = await call("POST", "/v1/onboard/complete", { body: { did, publicKeyJwk: kp.publicKey.export({ format: "jwk" }), nonce: start.json.nonce, signature: ed25519.sign(kp.privateKey, start.json.nonce), deviceFingerprintHash: "e2e-volunteer-laptop-0001", displayName: "Replay", livenessMode: "faceapi" } });
  check("replayed nonce is refused", replay.status === 400 && replay.json.error?.code === "nonce_invalid", replay.json);

  const engineer = (await call("POST", "/v1/demo/login", { body: { role: "engineer" } })).json;
  const manager = (await call("POST", "/v1/demo/login", { body: { role: "manager" } })).json;
  const auditor = (await call("POST", "/v1/demo/login", { body: { role: "auditor" } })).json;
  const admin = (await call("POST", "/v1/demo/login", { body: { role: "admin" } })).json;
  check("seeded roles can sign in", !!engineer.sessionJwt && !!manager.sessionJwt && !!auditor.sessionJwt && !!admin.sessionJwt);

  // ── Scene 1b: the five-verification enrolment ─────────────────────────────
  //
  // The whole new front door, driven the way the browser drives it: an employee ID card, a live
  // capture, two confidence scores, a nonce signature — then an administrator decides, and only
  // then does a login produce a session.
  scene("Scene 1b — Signup (5 verifications → admin approval → login)");

  const signupStart = (await call("POST", "/v1/auth/signup/start")).json;
  check("signup issues a challenge and publishes both thresholds", signupStart.status !== 404 && signupStart.faceMatchThreshold === 45 && signupStart.livenessThreshold === 45, signupStart);

  const enrolKp = keyPairFromSecret("e2e-enrolment");
  const enrolDid = didKeyFromRaw(enrolKp.publicRaw);
  const enrolFp = "b".repeat(64);

  /**
   * A real AdaFace enrolment, not a synthetic vector.
   *
   * The fixture holds three genuine 512-d IR-50 embeddings — a five-crop enrolment average, a second
   * photograph of the same person, and a different person — produced by the same alignment and
   * preprocessing the browser runs. Driving the enrolment with these is what makes this scene a test
   * of the face path rather than of the multipart parser: the confidences below are *computed* from
   * the embeddings by the same curve `lib/did.ts` uses, so if the calibration or the threshold ever
   * drifts apart from the gateway's FACE_MATCH_MIN_SCORE, this scene fails.
   */
  const decodeEmbedding = (b64: string): Float32Array => {
    // Node hands out Buffers backed by a shared pool, so `.buffer` is the pool, not these bytes.
    const bytes = Buffer.from(b64, "base64");
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };
  const enrolmentEmbedding = decodeEmbedding(adafaceFixture.enrolment);
  const genuineProbe = decodeEmbedding(adafaceFixture.genuine);
  const impostorProbe = decodeEmbedding(adafaceFixture.impostor);
  const template = Array.from(enrolmentEmbedding);

  /** cosineSimilarity() and confidenceFromSimilarity() from apps/web/src/lib/did.ts. */
  const cosine = (a: Float32Array, b: Float32Array) => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      na += a[i]! * a[i]!;
      nb += b[i]! * b[i]!;
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  };
  const confidence = (similarity: number) => {
    const v = Math.max(0, Math.min(1, similarity));
    const t = 0.32; // ADAFACE_SIMILARITY_THRESHOLD
    return Math.max(0, Math.min(100, Math.round(v <= t ? (45 * v) / t : 45 + (55 * (v - t)) / (1 - t))));
  };
  const genuineScore = confidence(cosine(enrolmentEmbedding, genuineProbe));
  const impostorScore = confidence(cosine(enrolmentEmbedding, impostorProbe));
  check(
    "the AdaFace fixture separates the same person from a different one across the gateway's floor",
    template.length === 512 && genuineScore >= 45 && impostorScore < 45,
    { genuineScore, impostorScore, floor: 45 },
  );
  const signupBody = (payload: Json, faceBytes = "live-face-frame") =>
    multipart([
      { name: "payload", value: JSON.stringify(payload) },
      { name: "idDocument", filename: "id.png", mime: "image/png", body: "employee-id-card-bytes" },
      { name: "faceImage", filename: "face.jpg", mime: "image/jpeg", body: faceBytes },
    ]);

  // A capture that fails one gate is refused — and is still recorded as evidence.
  const lowScore = (await call("POST", "/v1/auth/signup/submit", {
    multipart: signupBody({
      employeeId: "CP-0042",
      displayName: "Priya Raman",
      did: enrolDid,
      publicKeyJwk: enrolKp.publicKey.export({ format: "jwk" }),
      deviceFingerprintHash: enrolFp,
      faceTemplate: template,
      faceTemplateSamples: 6,
      faceTemplateModel: "adaface",
      role: "engineer",
      evidence: { nonce: signupStart.nonce, signature: ed25519.sign(enrolKp.privateKey, signupStart.nonce), faceMatchScore: impostorScore, livenessMode: "faceapi", livenessScore: 0.8, livenessSignals: { depth: 0.7, motion: 0.7, response: 1, focus: 0.6, texture: 0.6 } },
    }),
  }));
  check("a low face-match confidence is refused", lowScore.status === 403 && lowScore.json.error?.code === "verification_failed", lowScore.json);
  const refusedChecks = (lowScore.json.error?.details?.checks ?? []) as Json[];
  check("all five gates are still evaluated and recorded on a refusal", refusedChecks.length === 5 && refusedChecks.find((c) => c.id === "face_match")?.result === "fail", refusedChecks);

  // A tag that disagrees with the vector it labels is refused before anything is stored. Letting
  // the two drift apart would put a 128-d template behind an "adaface" label, and the browser reads
  // the space to score in off the length — so a login would be judged in the wrong space entirely.
  const mislabelled = await call("POST", "/v1/auth/signup/submit", {
    multipart: signupBody({
      employeeId: "CP-0043",
      displayName: "Mislabelled Template",
      did: enrolDid,
      publicKeyJwk: enrolKp.publicKey.export({ format: "jwk" }),
      deviceFingerprintHash: enrolFp,
      faceTemplate: Array.from({ length: 128 }, (_, i) => Math.sin(i) / 4),
      faceTemplateSamples: 6,
      faceTemplateModel: "adaface",
      role: "engineer",
      evidence: { nonce: signupStart.nonce, signature: ed25519.sign(enrolKp.privateKey, signupStart.nonce), faceMatchScore: genuineScore, livenessMode: "faceapi", livenessScore: 0.8, livenessSignals: { depth: 0.7, motion: 0.7, response: 1, focus: 0.6, texture: 0.6 } },
    }),
  });
  check("a template whose model tag disagrees with its dimension is refused", mislabelled.status === 400 && mislabelled.json.error?.code === "validation_failed", mislabelled.json.error?.code);

  const signupStart2 = (await call("POST", "/v1/auth/signup/start")).json;
  const submitted = await call("POST", "/v1/auth/signup/submit", {
    multipart: signupBody({
      employeeId: "cp-0042",
      displayName: "Priya Raman",
      did: enrolDid,
      publicKeyJwk: enrolKp.publicKey.export({ format: "jwk" }),
      deviceFingerprintHash: enrolFp,
      faceTemplate: template,
      faceTemplateSamples: 6,
      faceTemplateModel: "adaface",
      role: "engineer",
      evidence: { nonce: signupStart2.nonce, signature: ed25519.sign(enrolKp.privateKey, signupStart2.nonce), faceMatchScore: genuineScore, livenessMode: "faceapi", livenessScore: 0.71, livenessSignals: { depth: 0.7, motion: 0.72, response: 1, focus: 0.6, texture: 0.61 } },
    }),
  });
  check("a passing bundle enrols and waits for an administrator", submitted.status === 200 && submitted.json.enrolment?.status === "pending", submitted.json);
  check("the employee ID is normalised to one canonical form", submitted.json.enrolment?.employeeId === "CP-0042", submitted.json.enrolment);
  check("all five verifications passed", submitted.json.verification?.checks?.length === 5 && submitted.json.verification?.passed === true, submitted.json.verification);
  check("the ID document and the face frame are content-addressed", !!submitted.json.enrolment?.idDocCid && !!submitted.json.enrolment?.faceCid, submitted.json.enrolment);
  const enrolmentId = submitted.json.enrolment.id as string;

  // No session before an administrator has decided.
  const earlyLogin = await call("POST", "/v1/auth/login/start", { body: { employeeId: "CP-0042" } });
  check("login is refused while the enrolment is pending", earlyLogin.status === 403 && earlyLogin.json.error?.code === "enrolment_pending", earlyLogin.json);

  const queue = (await call("GET", "/v1/admin/enrolments?status=pending", { token: admin.sessionJwt })).json as unknown as Json[];
  check("the enrolment is in the administrator's queue", Array.isArray(queue) && queue.some((e) => e.id === enrolmentId), queue);

  // The administrative plane is address-restricted when ADMIN_IP_ALLOWLIST is set. Assert it here
  // with a second app whose allowlist cannot match the loopback peer these requests arrive on, so
  // the control is proved to refuse rather than merely to exist.
  {
    const walled = await buildApp({
      DB_MODE: "memory",
      STORAGE_MODE: "memory",
      LEDGER_MODE: "lite",
      RISK_MODE: "local",
      ANALYST_MODE: "template",
      DEMO_MODE: "true",
      LOG_LEVEL: "silent",
      ADMIN_IP_ALLOWLIST: "203.0.113.7",
    });
    try {
      await seedDemo(walled.ctx);
      const inside = (await walled.app.inject({ method: "POST", url: "/v1/demo/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ role: "admin" }) })).json() as Json;
      const refused = await walled.app.inject({ method: "GET", url: "/v1/admin/enrolments", headers: { authorization: `Bearer ${inside.sessionJwt}`, ...consoleHeaders } });
      const body = refused.json() as Json;
      check("an off-allowlist address is refused the admin plane", refused.statusCode === 403 && body.error?.code === "admin_network_forbidden", body);

      // A spoofed forwarding header must not buy its way in: the check reads the socket, not a header.
      const spoofed = await walled.app.inject({
        method: "GET",
        url: "/v1/admin/enrolments",
        headers: { authorization: `Bearer ${inside.sessionJwt}`, "x-forwarded-for": "203.0.113.7", ...consoleHeaders },
      });
      check("a spoofed X-Forwarded-For does not bypass the allowlist", spoofed.statusCode === 403, spoofed.json());

      const me = (await walled.app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${inside.sessionJwt}`, ...consoleHeaders } })).json() as Json;
      check("the console is told why, so it can explain rather than just fail", me.adminNetwork === false, { adminNetwork: me.adminNetwork });

      // A non-admin read outside the admin plane is unaffected by the allowlist.
      const identities = await walled.app.inject({ method: "GET", url: "/v1/identities", headers: { authorization: `Bearer ${inside.sessionJwt}`, ...consoleHeaders } });
      check("ordinary auditor/manager reads are not caught by the admin allowlist", identities.statusCode === 200, identities.statusCode);
    } finally {
      await walled.close();
    }
  }

  // The console key: the outermost of the three admin checks. An administrator with a valid session
  // and an allowlisted address still gets nothing without the link they were issued.
  {
    const noKey = await app.inject({ method: "GET", url: "/v1/admin/enrolments", headers: { authorization: `Bearer ${admin.sessionJwt}` } });
    check("an administrator without the console link is refused", noKey.statusCode === 403 && (noKey.json() as Json).error?.code === "admin_console_key_required", noKey.json());

    const wrongKey = await app.inject({
      method: "GET",
      url: "/v1/admin/enrolments",
      headers: { authorization: `Bearer ${admin.sessionJwt}`, [CONSOLE_KEY_HEADER]: `${CONSOLE_KEY.slice(0, -1)}x` },
    });
    check("a near-miss console key is refused", wrongKey.statusCode === 403, wrongKey.statusCode);

    // Ordering: the key is checked before the role, so a non-admin without the link is told about
    // the link and learns nothing about their account.
    const engineerNoKey = await app.inject({ method: "GET", url: "/v1/admin/enrolments", headers: { authorization: `Bearer ${engineer.sessionJwt}` } });
    check("the key is refused before the role is discussed", (engineerNoKey.json() as Json).error?.code === "admin_console_key_required", engineerNoKey.json());

    const meKeyed = (await call("GET", "/v1/me", { token: admin.sessionJwt })).json;
    check("the console is told the key landed, so it can explain rather than just fail", meKeyed.adminConsole === true, { adminConsole: meKeyed.adminConsole });
  }

  check("this run's own admin plane is reachable with the link (allowlist empty)", (await call("GET", "/v1/admin/enrolments", { token: admin.sessionJwt })).status === 200);
  const idCard = await app.inject({ method: "GET", url: `/v1/admin/enrolments/${enrolmentId}/image/id-document`, headers: { authorization: `Bearer ${admin.sessionJwt}`, ...consoleHeaders } });
  check("the administrator can read back the decrypted ID card", idCard.statusCode === 200 && idCard.body === "employee-id-card-bytes", idCard.statusCode);

  const decideNonce = (await call("POST", `/v1/admin/enrolments/${enrolmentId}/challenge`, { token: admin.sessionJwt })).json;
  const enrolmentApproved = await call("POST", `/v1/admin/enrolments/${enrolmentId}/decide`, {
    token: admin.sessionJwt,
    body: { approve: true, reason: "ID card matches the HR record.", attestation: { nonce: decideNonce.nonce, signature: await signAs("admin", decideNonce.nonce), livenessMode: "simulated" } },
  });
  check("the administrator approves under their own liveness attestation", enrolmentApproved.status === 200 && enrolmentApproved.json.status === "approved", enrolmentApproved.json);

  await ctx.outbox.drain();
  const onChainEnrolment = (await call("GET", `/v1/admin/enrolments?status=approved`, { token: admin.sessionJwt })).json as unknown as Json[];
  check("the enrolment is anchored on the ledger", !!onChainEnrolment.find((e) => e.id === enrolmentId)?.ledgerTxId, onChainEnrolment.find((e) => e.id === enrolmentId));

  // Login re-runs the same five gates against the enrolled template.
  const loginStart = (await call("POST", "/v1/auth/login/start", { body: { employeeId: "CP-0042" } })).json;
  check("login hands back the enrolled template so the match runs in the browser", loginStart.faceTemplate?.length === 512 && loginStart.did === enrolDid, { len: loginStart.faceTemplate?.length });
  check("the template is handed back tagged with the net that made it", loginStart.faceTemplateModel === "adaface", loginStart.faceTemplateModel);
  // The template survived encryption, storage and decryption intact — otherwise the match a browser
  // runs against it would be scoring noise.
  const returned = loginStart.faceTemplate as number[];
  // Element-wise, not by similarity: a rounded confidence saturates at 100 well before the vectors
  // are actually equal, so scoring it against itself would call a corrupted template intact.
  const identical = returned.length === template.length && returned.every((v, i) => v === template[i]);
  check(
    "the stored template comes back bit-for-bit, so the confidence is recomputable",
    identical && confidence(cosine(new Float32Array(returned), genuineProbe)) === genuineScore,
    { identical, genuine: confidence(cosine(new Float32Array(returned), genuineProbe)), expected: genuineScore },
  );
  const loggedIn = await call("POST", "/v1/auth/login/complete", {
    multipart: multipart([
      { name: "payload", value: JSON.stringify({ employeeId: "CP-0042", deviceFingerprintHash: enrolFp, evidence: { nonce: loginStart.nonce, signature: ed25519.sign(enrolKp.privateKey, loginStart.nonce), faceMatchScore: genuineScore, livenessMode: "faceapi", livenessScore: 0.66, livenessSignals: { depth: 0.6, motion: 0.7, response: 1, focus: 0.6, texture: 0.6 } } }) },
      { name: "faceImage", filename: "face.jpg", mime: "image/jpeg", body: "login-face-frame" },
    ]),
  });
  check("login returns a session and all five verifications", loggedIn.status === 200 && !!loggedIn.json.sessionJwt && loggedIn.json.verification?.checks?.length === 5, loggedIn.json);
  check("a non-admin is sent to the workspace, not the control plane", loggedIn.json.home === "app", loggedIn.json.home);

  const loginStart3 = (await call("POST", "/v1/auth/login/start", { body: { employeeId: "CP-0042" } })).json;
  const wrongKey = keyPairFromSecret("e2e-imposter");
  const imposter = await call("POST", "/v1/auth/login/complete", {
    multipart: multipart([
      { name: "payload", value: JSON.stringify({ employeeId: "CP-0042", deviceFingerprintHash: enrolFp, evidence: { nonce: loginStart3.nonce, signature: ed25519.sign(wrongKey.privateKey, loginStart3.nonce), faceMatchScore: 91, livenessMode: "faceapi", livenessScore: 0.9, livenessSignals: { depth: 0.9, motion: 0.9, response: 1, focus: 0.9, texture: 0.9 } } }) },
      { name: "faceImage", filename: "face.jpg", mime: "image/jpeg", body: "imposter-frame" },
    ]),
  });
  check("a perfect face score cannot substitute for the enrolled key", imposter.status === 403 && (imposter.json.error?.details?.checks as Json[])?.find((c) => c.id === "did_signature")?.result === "fail", imposter.json.error?.details?.checks);

  await ctx.outbox.drain();
  const verifications = (await call("GET", `/v1/admin/verifications?did=${encodeURIComponent(enrolDid)}`, { token: admin.sessionJwt })).json as unknown as Json[];
  check("every face check — passed and refused — is stored and anchored", verifications.length >= 4 && verifications.every((v) => !!v.imageCid && !!v.ledgerTxId), verifications.map((v) => ({ purpose: v.purpose, passed: v.passed, tx: !!v.ledgerTxId })));
  check("a refused check is kept as evidence, not discarded", verifications.some((v) => v.passed === false), verifications.length);

  // ── Scene 2: mint an Asset Passport ───────────────────────────────────────
  scene("Scene 2 — Vault (upload → Asset Passport → anchored on the ledger)");
  const form = new FormData();
  form.append("file", new Blob([Buffer.from("SOLID BREP; DRDO ENGINE DESIGN V1; turbine blade profile\n")]), "DRDO_ENGINE_DESIGN_V1.cad");
  form.append("name", "DRDO Engine Design V1");
  form.append("class", "design");
  form.append("sensitivity", "high");
  const upRes = await app.inject({ method: "POST", url: "/v1/assets", headers: { authorization: `Bearer ${engineer.sessionJwt}` }, payload: form as unknown as undefined });
  const uploaded = upRes.json() as Json;
  check("passport minted", upRes.statusCode === 200 && !!uploaded.assetUid, uploaded);
  const assetUid = uploaded.assetUid as string;
  check("sha-256 recorded", typeof uploaded.sha256 === "string" && uploaded.sha256.length === 64);
  check("content-addressed CID assigned", typeof uploaded.cid === "string" && uploaded.cid.startsWith("b"));
  await ctx.outbox.drain();
  const passport = (await call("GET", `/v1/assets/${assetUid}/passport`, { token: engineer.sessionJwt })).json;
  check("anchored on the ledger with a tx id", !!passport.ledger?.latestTxId, passport.ledger);
  check("trust score computed with a 7-part breakdown", passport.trust?.breakdown?.length === 7, passport.trust);

  const dupForm = new FormData();
  dupForm.append("file", new Blob([Buffer.from("SOLID BREP; DRDO ENGINE DESIGN V1; turbine blade profile\n")]), "final_final_REAL.cad");
  dupForm.append("name", "final final REAL");
  dupForm.append("class", "design");
  dupForm.append("sensitivity", "low");
  const dup = await app.inject({ method: "POST", url: "/v1/assets", headers: { authorization: `Bearer ${engineer.sessionJwt}` }, payload: dupForm as unknown as undefined });
  const dupJson = dup.json() as Json;
  check("a renamed copy is recognised as the original (copy ≠ escape)", dup.statusCode === 409 && dupJson.error?.details?.assetUid === assetUid, dupJson.error);

  // ── Scene 3: normal access, explained ─────────────────────────────────────
  scene("Scene 3 — Normal access (explainable ALLOW + Proof-of-Action)");
  const view = await call("POST", `/v1/assets/${assetUid}/request`, {
    token: engineer.sessionJwt,
    body: { action: "asset.view", context: { deviceId: "seeded", localHour: 11, geo: { lat: 12.97, lng: 77.59, city: "Bengaluru" } } },
    scenario: { deviceId: (await ctx.db.select().from(demoIdentities).where(eq(demoIdentities.role, "engineer")).limit(1))[0]!.deviceFingerprintHash, localHour: 11, geo: { lat: 12.97, lng: 77.59, city: "Bengaluru" } },
  });
  check("calm view is ALLOWed", view.json.verdict === "ALLOW", view.json);
  check("every check is explained", Array.isArray(view.json.trace?.checks) && view.json.trace.checks.length >= 5);
  check("decision under 300 ms", view.json.latencyMs < 300, view.json.latencyMs);
  check("Proof-of-Action issued", !!view.json.certId);
  const engFp = (await ctx.db.select().from(demoIdentities).where(eq(demoIdentities.role, "engineer")).limit(1))[0]!.deviceFingerprintHash;
  const trustedScenario = { deviceId: engFp, localHour: 11, geo: { lat: 12.97, lng: 77.59, city: "Bengaluru" } };

  const download = await call("POST", `/v1/assets/${assetUid}/request`, { token: engineer.sessionJwt, body: { action: "asset.download", context: { deviceId: engFp } }, scenario: trustedScenario });
  check("high-sensitivity download demands a live person (STEP_UP)", download.json.verdict === "STEP_UP", download.json);
  const sig = await signAs("engineer", download.json.stepUp.nonce);
  const stepped = await call("POST", `/v1/requests/${download.json.requestId}/step-up`, { token: engineer.sessionJwt, body: { nonce: download.json.stepUp.nonce, signature: sig, livenessMode: "simulated" } });
  check("verified liveness unlocks the download", stepped.json.verdict === "ALLOW" && !!stepped.json.contentUrl, stepped.json);

  const content = await app.inject({ method: "GET", url: stepped.json.contentUrl });
  check("single-use link delivers the decrypted file", content.statusCode === 200 && content.body.includes("DRDO ENGINE DESIGN V1"));
  const manifest = JSON.parse(Buffer.from(content.headers["x-vajra-manifest"] as string, "base64").toString());
  check("download ships a signed provenance manifest", manifest.assetUid === assetUid && !!manifest.signature);
  const reuse = await app.inject({ method: "GET", url: stepped.json.contentUrl });
  check("the link cannot be reused", reuse.statusCode === 403, reuse.statusCode);

  // ── Scene 3b: two-person transfer ─────────────────────────────────────────
  scene("Scene 3b — Two-person rule (no one transfers a classified asset alone)");
  const transfer = await call("POST", `/v1/assets/${assetUid}/request`, { token: engineer.sessionJwt, body: { action: "asset.transfer", context: { deviceId: engFp }, toDid: manager.user.did }, scenario: trustedScenario });
  check("transfer requires step-up first", transfer.json.verdict === "STEP_UP", transfer.json);
  const tSig = await signAs("engineer", transfer.json.stepUp.nonce);
  const tStepped = await call("POST", `/v1/requests/${transfer.json.requestId}/step-up`, { token: engineer.sessionJwt, body: { nonce: transfer.json.stepUp.nonce, signature: tSig, livenessMode: "simulated" } });
  check("then waits for a second person", tStepped.json.verdict === "PENDING_APPROVAL" && !!tStepped.json.approvalId, tStepped.json);
  const selfApprove = await call("POST", `/v1/approvals/${tStepped.json.approvalId}/challenge`, { token: engineer.sessionJwt });
  check("the requester cannot approve their own request", selfApprove.status === 403 && selfApprove.json.error?.code === "approver_is_requester", selfApprove.json);
  const mChallenge = await call("POST", `/v1/approvals/${tStepped.json.approvalId}/challenge`, { token: manager.sessionJwt });
  const mSig = await signAs("manager", mChallenge.json.nonce);
  const approved = await call("POST", `/v1/approvals/${tStepped.json.approvalId}/decide`, { token: manager.sessionJwt, body: { approve: true, reason: "Reviewed in the design meeting", attestation: { nonce: mChallenge.json.nonce, signature: mSig, livenessMode: "simulated" } } });
  check("a distinct manager's live approval completes the transfer", approved.json.status === "approved" && approved.json.verdict === "ALLOW", approved.json);
  await ctx.outbox.drain();
  const afterTransfer = (await call("GET", `/v1/assets/${assetUid}/passport`, { token: manager.sessionJwt })).json;
  check("ownership moved on the ledger", afterTransfer.owner?.did === manager.user.did, afterTransfer.owner);
  check("the ledger records the approver", afterTransfer.transfers?.[0]?.approverDid === manager.user.did, afterTransfer.transfers);

  // ── Scene 4: the insider attack ───────────────────────────────────────────
  scene("Scene 4 — Attack (new device, Mumbai, 02:00, burst → DENY + incident + lockdown)");
  const attackScenario = { deviceId: "unknown-device-7f3a", localHour: 2, geo: { lat: 19.076, lng: 72.8777, city: "Mumbai" }, ip: "103.21.58.90", burst: 47 };
  const attack = await call("POST", `/v1/assets/${assetUid}/request`, { token: engineer.sessionJwt, body: { action: "asset.download", context: { deviceId: "unknown-device-7f3a" } }, scenario: attackScenario });
  check("the request is DENIED", attack.json.verdict === "DENY", attack.json);
  check("risk is high with named signals", attack.json.risk.tier === "high" && attack.json.risk.signals.includes("impossible_travel") && attack.json.risk.signals.includes("new_device"), attack.json.risk);
  check("the denial explains itself", attack.json.trace.reasons.length >= 2 && attack.json.trace.checks.some((c: Json) => c.result === "fail"), attack.json.trace.reasons);
  check("an incident opened automatically", !!attack.json.incidentId, attack.json);
  check("privileges shrank in the same response", attack.json.effectivePermissions["asset.transfer"] === "deny", attack.json.effectivePermissions);
  const incidentId = attack.json.incidentId as string;

  const failedSig = "AAAA" + "B".repeat(82) + "==";
  for (let i = 0; i < 2; i++) {
    const r = await call("POST", `/v1/assets/${assetUid}/request`, { token: engineer.sessionJwt, body: { action: "asset.open", context: { deviceId: "unknown-device-7f3a" } }, scenario: attackScenario });
    if (r.json.stepUp) await call("POST", `/v1/requests/${r.json.requestId}/step-up`, { token: engineer.sessionJwt, body: { nonce: r.json.stepUp.nonce, signature: failedSig, livenessMode: "simulated" } });
  }
  const incidents = (await call("GET", "/v1/incidents", { token: auditor.sessionJwt })).json as unknown as Json[];
  const inc = incidents.find((i) => i.incidentId === incidentId)!;
  check("failed liveness escalates the incident to S3", inc.severity === "S3", inc);
  check("the session was locked and links expired", inc.responses.includes("session_locked") && inc.responses.includes("content_urls_expired"), inc.responses);
  const afterLock = await call("GET", "/v1/me", { token: engineer.sessionJwt });
  check("the locked session is rejected", afterLock.status === 401 && afterLock.json.error?.code === "session_locked", afterLock.json);

  // ── Scene 5: fail closed ──────────────────────────────────────────────────
  scene("Scene 5 — Fail closed (stop the ledger, sensitive actions stop)");
  await call("POST", "/v1/demo/outage", { body: { dependency: "ledger", down: true } });
  const engineer2 = (await call("POST", "/v1/demo/login", { body: { role: "engineer" } })).json;
  const blocked = await call("POST", `/v1/assets/${assetUid}/request`, { token: manager.sessionJwt, body: { action: "asset.transfer", context: { deviceId: "seeded" }, toDid: engineer2.user.did }, scenario: { deviceId: (await ctx.db.select().from(demoIdentities).where(eq(demoIdentities.role, "manager")).limit(1))[0]!.deviceFingerprintHash, localHour: 11 } });
  check("the transfer is denied: ledger_unavailable", blocked.json.verdict === "DENY" && blocked.json.trace.reasons.includes("dependency_down:ledger"), blocked.json.trace?.reasons);
  const stillReadable = await call("POST", `/v1/assets/${assetUid}/request`, { token: manager.sessionJwt, body: { action: "asset.view", context: { deviceId: "seeded" } }, scenario: { deviceId: (await ctx.db.select().from(demoIdentities).where(eq(demoIdentities.role, "manager")).limit(1))[0]!.deviceFingerprintHash, localHour: 11 } });
  check("low-sensitivity reads still work (fails closed, not dark)", stillReadable.json.verdict === "ALLOW", stillReadable.json.verdict);
  await call("POST", "/v1/demo/outage", { body: { dependency: "ledger", down: false } });
  await ctx.outbox.drain();
  check("queued anchors drain once the ledger returns", (await ctx.outbox.pendingCount()) === 0);

  // ── Scene 6: attack replay + evidence ─────────────────────────────────────
  scene("Scene 6 — Attack replay and the evidence package");
  const timeline = (await call("GET", `/v1/incidents/${incidentId}/timeline`, { token: auditor.sessionJwt })).json;
  check("the incident replays as an ordered timeline", timeline.items.length >= 5, timeline.items?.length);
  check("the timeline carries the trust decay", timeline.items.some((i: Json) => i.kind === "trust" && i.delta < 0));
  const evidence = (await call("GET", `/v1/incidents/${incidentId}/evidence`, { token: auditor.sessionJwt })).json;
  check("an evidence package is generated and signed", !!evidence.packageHash && !!evidence.signature, Object.keys(evidence));
  const evVerify = (await call("POST", "/v1/verify/evidence", { token: auditor.sessionJwt, body: { package: evidence } })).json;
  check("the evidence package verifies end to end", evVerify.valid === true, evVerify.checks);

  // ── Scene 7: proof + time travel ──────────────────────────────────────────
  scene("Scene 7 — Proof-of-Action and time-travel");
  const cert = (await call("GET", `/v1/proofs/${stepped.json.certId}`, { token: auditor.sessionJwt })).json;
  const verify = (await call("POST", "/v1/verify/proof", { token: auditor.sessionJwt, body: { proof: cert } })).json;
  check("the certificate passes all five checks", verify.valid === true, verify.checks);
  const tampered = { ...cert, trust: { ...cert.trust, identity: 100 } };
  const tamperCheck = (await call("POST", "/v1/verify/proof", { token: auditor.sessionJwt, body: { proof: tampered } })).json;
  check("a tampered certificate fails the hash check", tamperCheck.valid === false && tamperCheck.checks.find((c: Json) => c.id === "hash")?.ok === false, tamperCheck.checks);

  const chain = await verifyAuditChain(ctx.db);
  check(`the audit hash chain is intact across ${chain.checked} events`, chain.ok, chain);

  const tt = (await call("GET", `/v1/timetravel?at=${encodeURIComponent(new Date().toISOString())}&did=${encodeURIComponent(engineer.user.did)}&assetUid=${assetUid}`, { token: auditor.sessionJwt })).json;
  check("time-travel reconstructs the person's state", tt.user?.existed === true && typeof tt.user.identityTrust === "number", tt.user);
  check("time-travel reconstructs the policies in force", Array.isArray(tt.policies) && tt.policies.length >= 5, tt.policies?.length);
  check("time-travel reconstructs the asset's owner at that moment", tt.asset?.owner?.did === manager.user.did, tt.asset?.owner);

  // ── Scene 8: revocation cascade ───────────────────────────────────────────
  scene("Scene 8 — Revocation cascade");
  const revChallenge = (await call("POST", `/v1/identities/${encodeURIComponent(engineer.user.did)}/revoke/challenge`, { token: admin.sessionJwt })).json;
  const aSig = await signAs("admin", revChallenge.nonce);
  const revoked = await call("POST", `/v1/identities/${encodeURIComponent(engineer.user.did)}/revoke`, { token: admin.sessionJwt, body: { reason: "Left the organisation", attestation: { nonce: revChallenge.nonce, signature: aSig, livenessMode: "simulated" } } });
  check("one click revokes credential, sessions, devices, grants and links", revoked.status === 200 && revoked.json.steps.length === 7, revoked.json.steps);
  const engineer3 = await call("POST", "/v1/demo/login", { body: { role: "engineer" } });
  const afterRevoke = await call("POST", `/v1/assets/${assetUid}/request`, { token: engineer3.json.sessionJwt, body: { action: "asset.view", context: { deviceId: engFp } }, scenario: trustedScenario });
  check("the revoked identity is denied", afterRevoke.json.verdict === "DENY" && afterRevoke.json.trace.reasons.includes("identity_revoked"), afterRevoke.json.trace?.reasons);

  // ── Analyst ───────────────────────────────────────────────────────────────
  scene("Analyst (narrates; never decides)");
  const explain = (await call("POST", "/v1/analyst/explain", { token: auditor.sessionJwt, body: { kind: "decision", id: attack.json.requestId, locale: "en" } })).json;
  check("the denial gets a plain-language explanation", typeof explain.text === "string" && explain.text.length > 80, explain.text?.slice(0, 80));
  const query = (await call("POST", "/v1/analyst/query", { token: auditor.sessionJwt, body: { question: `who was denied on ${assetUid} in the last 24 hours?` } })).json;
  check("a natural-language audit question resolves to a filter", query.filter?.assetUid === assetUid && query.count >= 1, query.filter);
  const draft = (await call("POST", "/v1/analyst/policy-draft", { token: admin.sessionJwt, body: { description: "managers may transfer high sensitivity designs only with two-person approval" } })).json;
  check("a policy draft is produced and validated", draft.draft?.effect === "require_approval", draft.draft);

  // ── Ledger integrity ──────────────────────────────────────────────────────
  scene("Ledger");
  const blocks = (await call("GET", "/v1/ledger/blocks?limit=5", { token: auditor.sessionJwt })).json;
  check("blocks are hash-chained and verify", blocks.verification?.ok === true, blocks.verification);
  check(`${blocks.verification?.blocks} blocks written`, (blocks.verification?.blocks ?? 0) > 10);

  const health = (await call("GET", "/v1/health")).json;
  check("health reports every dependency", health.ok === true && Object.keys(health.deps).length === 4, health.deps);
  const stats = (await call("GET", "/v1/stats")).json;
  check("stats report an intact chain and the true face-capture footprint", stats.chainIntact === true && stats.faceChecks > 0 && stats.faceImageBytesStored > 0 && stats.faceImagesEncrypted === true, stats);
} catch (e) {
  failed++;
  console.error("\n[31mE2E crashed:[0m", e);
} finally {
  await close();
}

console.log(`\n${failed === 0 ? "[32m" : "[31m"}${passed} passed, ${failed} failed[0m\n`);
process.exit(failed === 0 ? 0 : 1);
void users;
