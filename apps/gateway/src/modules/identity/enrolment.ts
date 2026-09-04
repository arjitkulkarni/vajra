/**
 * Enrolment and login — the five-verification bundle.
 *
 * Signup and login run the *same* five gates, in the same order, and record the same evidence:
 *
 *   1. employee_id    the ID on the card is free (signup) or resolves to an enrolled person (login)
 *   2. id_document    the employee ID card was supplied and is intact (signup mints it; login
 *                     re-verifies the stored ciphertext still hashes to what was approved)
 *   3. face_match     confidence that the live face is the enrolled face, 0-100
 *   4. liveness       the passive anti-spoof composite over depth · motion · reaction · focus · texture
 *   5. did_signature  an Ed25519 signature over a single-use server nonce, by the enrolled key
 *
 * There is no device or fingerprint factor on purpose: the only biometric here is the face, and
 * `did_signature` is cryptographic possession, not biometry.
 *
 * Gates 3 and 4 are computed in the browser — the descriptors and the frames never leave it during
 * the check — and arrive as numbers. The server cannot re-derive them, so it treats them as a claim
 * the attesting device makes about itself, and stores the frame that produced them beside the claim.
 * That is what makes it auditable: the image, its hash and both scores go on chain together, so a
 * later reviewer can re-run the match over exactly the bytes that were scored.
 *
 * A signup does not create a session. It creates a *pending* identity and waits for an administrator.
 */
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import type {
  EmbeddingModel,
  EnrolmentSummary,
  FaceEvidence,
  LoginCompletePayload,
  LoginCompleteResponse,
  LoginStartResponse,
  Role,
  SignupPayload,
  SignupStartResponse,
  SignupSubmitResponse,
  VerificationBundle,
  VerificationCheck,
} from "@vajra/contracts";
import {
  credentials,
  devices,
  enrolments,
  faceTemplates,
  faceVerifications,
  livenessAttestations,
  users,
  type VerificationCheck as CheckRow,
} from "../../db/schema";
import { withTx, type AppContext } from "../../context";
import type { Db } from "../../db/client";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  b64u,
  didKeyFromJwk,
  ed25519,
  hashJson,
  newDek,
  publicKeyFromJwk,
  sha256Hex,
  unwrapDek,
  wrapDek,
} from "../../lib/crypto";
import { ApiError } from "../../lib/errors";
import { appendAudit } from "../audit/service";
import { reportPresentationAttack } from "../incident/service";
import { spoofVerdict } from "./attestation";
import { enqueueLedger } from "../ledger/outbox";
import { bumpDeviceTrust, bumpIdentityTrust } from "../trust/service";
import { consumeNonce, createNonce } from "./nonces";
import { DEFAULT_BASELINE, publicUser } from "./onboarding";
import { signSession, type DeviceRow, type UserRow } from "./session";
import { issueIdentityCredential } from "./vc";

export type EnrolmentRow = typeof enrolments.$inferSelect;
export type FaceVerificationRow = typeof faceVerifications.$inferSelect;

/** Employee IDs are compared case-insensitively; one canonical form is stored. */
export const normaliseEmployeeId = (raw: string): string => raw.trim().toUpperCase();

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

// ─── the five gates ──────────────────────────────────────────────────────────

const gate = (id: CheckRow["id"], pass: boolean, detailKey: string, score: number | null = null, required: number | null = null): CheckRow => ({
  id,
  result: pass ? "pass" : "fail",
  score,
  required,
  detailKey,
});

/**
 * The liveness gate, which two independent checks can fail.
 *
 * The passive composite is a weighted score over signals the capturing device measured for itself,
 * and it fails a capture that could not demonstrate enough of them — usually bad light, a face half
 * out of frame, or somebody who never answered the challenge they were given. The live AI check is a classifier's
 * verdict on the same capture, and it fails a capture that looked like a print, a replay or a
 * rendered face. They fail different things, so they are reported as different detail keys: one
 * says try again, the other says an attack was seen, and the response ladder acts on that.
 *
 * The AI check's probability rides along in `signals` as `ai`, which means it is committed to by
 * the bundle hash and anchored with everything else — the number cannot be restated later either.
 * An absent `spoofCheck` is an unmeasured check, not a passed one: it leaves no `ai` signal behind,
 * and the gate rests on the passive composite alone, exactly as it did before this model existed.
 */
interface LivenessJudgement {
  score: number;
  signals: Record<string, number>;
  check: CheckRow;
  spoof: boolean;
}

function judgeLiveness(config: AppContext["config"], evidence: FaceEvidence, simulated: boolean): LivenessJudgement {
  const score = Math.round((evidence.livenessScore ?? 0) * 100);
  const verdict = spoofVerdict(config, evidence.spoofCheck);
  const signals: Record<string, number> = { ...(evidence.livenessSignals ?? {}) };
  if (verdict) signals.ai = evidence.spoofCheck!.liveProbability;
  const spoof = verdict?.spoof ?? false;
  const pass = simulated || (score >= config.LIVENESS_MIN_SCORE && !spoof);
  const detailKey = simulated
    ? "verify.liveness.simulated"
    : spoof
      ? "verify.liveness.spoof"
      : pass
        ? "verify.liveness.pass"
        : "verify.liveness.low";
  return { score, signals, spoof, check: gate("liveness", pass, detailKey, score, config.LIVENESS_MIN_SCORE) };
}

/**
 * The bundle hash commits to every gate *and* to the bytes that were scored, so it cannot be
 * restated later with a friendlier number. It is what goes on chain.
 */
function sealBundle(input: {
  purpose: "signup" | "login";
  did: string;
  employeeId: string;
  checks: CheckRow[];
  faceMatchScore: number;
  livenessScore: number;
  livenessSignals: Record<string, number>;
  faceSha256: string;
  idDocSha256: string;
  nonce: string;
}): VerificationBundle {
  const bundleHash = hashJson({
    purpose: input.purpose,
    did: input.did,
    employeeId: input.employeeId,
    checks: input.checks,
    faceMatchScore: input.faceMatchScore,
    livenessScore: input.livenessScore,
    livenessSignals: input.livenessSignals,
    faceSha256: input.faceSha256,
    idDocSha256: input.idDocSha256,
    nonce: input.nonce,
  });
  return {
    checks: input.checks,
    passed: input.checks.every((c) => c.result === "pass"),
    faceMatchScore: input.faceMatchScore,
    livenessScore: input.livenessScore,
    livenessSignals: input.livenessSignals,
    bundleHash,
  };
}

// ─── blob sealing (same envelope as an asset version) ────────────────────────

export interface SubmittedFile {
  buffer: Buffer;
  mime: string;
}

interface SealedBlob {
  sha256Plain: string;
  sha256Cipher: string;
  cid: string;
  dekWrapped: string;
  iv: string;
  sizeBytes: number;
}

function checkImage(file: SubmittedFile | null, what: "id_document" | "face_image"): SubmittedFile {
  if (!file || file.buffer.length === 0) throw ApiError.badRequest(`${what}_required`, "An image is required for this step.");
  if (file.buffer.length > MAX_IMAGE_BYTES) throw ApiError.badRequest(`${what}_too_large`, "Images are capped at 8 MB.");
  if (!IMAGE_MIMES.has(file.mime)) throw ApiError.badRequest(`${what}_bad_type`, "Send a JPEG, PNG or WebP image.");
  return file;
}

/** Encrypt under a fresh data key, address the ciphertext by content, and hand back the receipts. */
async function sealBlob(ctx: Pick<AppContext, "kek" | "storage">, file: SubmittedFile, aad: string): Promise<SealedBlob> {
  const dek = newDek();
  const sealed = aesGcmEncrypt(dek, file.buffer, aad);
  const { cid } = await ctx.storage.put(sealed.ciphertext);
  return {
    sha256Plain: sha256Hex(file.buffer),
    sha256Cipher: sha256Hex(sealed.ciphertext),
    cid,
    dekWrapped: wrapDek(ctx.kek, dek, aad),
    iv: sealed.iv,
    sizeBytes: file.buffer.length,
  };
}

async function openBlob(
  ctx: Pick<AppContext, "kek" | "storage">,
  ref: { cid: string; dekWrapped: string; iv: string; sha256Cipher: string },
  aad: string,
): Promise<Buffer> {
  const ciphertext = await ctx.storage.get(ref.cid);
  if (sha256Hex(ciphertext) !== ref.sha256Cipher) throw ApiError.conflict("blob_tampered", "The stored bytes no longer match the hash that was approved.");
  return aesGcmDecrypt(unwrapDek(ctx.kek, ref.dekWrapped, aad), { ciphertext, iv: ref.iv }, aad);
}

const idDocAad = (did: string) => `vajra:enrolment:id-document:${did}`;
const faceAad = (did: string) => `vajra:enrolment:face:${did}`;
const templateAad = (did: string) => `vajra:enrolment:template:${did}`;

// ─── signup ──────────────────────────────────────────────────────────────────

export async function startSignup(ctx: Pick<AppContext, "db" | "config">): Promise<SignupStartResponse> {
  const n = await createNonce(ctx.db, "signup", null, null);
  return { ...n, faceMatchThreshold: ctx.config.FACE_MATCH_MIN_SCORE, livenessThreshold: ctx.config.LIVENESS_MIN_SCORE };
}

/**
 * A fresh deployment has nobody who can approve anything, so the first enrolment into an
 * administrator-less database is approved on the spot and takes the admin role. It is recorded as
 * such in the audit event — `bootstrapAdmin: true` — rather than looking like an ordinary approval.
 */
async function needsBootstrapAdmin(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")));
  return (row?.n ?? 0) === 0;
}

export async function submitSignup(
  ctx: AppContext,
  payload: SignupPayload,
  files: { idDocument: SubmittedFile | null; faceImage: SubmittedFile | null },
  ip: string | null,
): Promise<SignupSubmitResponse> {
  const employeeId = normaliseEmployeeId(payload.employeeId);
  const idDocument = checkImage(files.idDocument, "id_document");
  const faceImage = checkImage(files.faceImage, "face_image");
  const evidence = payload.evidence;
  /**
   * A capture that reports itself simulated measured no face at all — no camera, or no weights.
   *
   * It is allowed to satisfy the liveness gate so a laptop with no camera can still walk the whole
   * cryptographic path on stage, and that is worth keeping. But it is an unconditional pass on the
   * one gate that proves a person was present, so outside DEMO_MODE it is exactly an authentication
   * bypass: block the camera, sign the nonce, and the face never has to match. Outside a demo it is
   * refused, and the evidence still records that it was tried.
   */
  const simulated = evidence.livenessMode === "simulated" && ctx.config.DEMO_MODE;
  const live = judgeLiveness(ctx.config, evidence, simulated);
  const { score: livenessScore, signals: livenessSignals } = live;

  // Single-use, whatever happens next: the nonce is burned before any gate is judged.
  await consumeNonce(ctx.db, evidence.nonce, "signup", null);

  const checks: CheckRow[] = [];

  // 1 — employee ID, which two tables have an opinion about.
  //
  // `users` says whether anyone holds this ID today. `enrolments` says whether anyone has *applied*
  // for it and is still waiting, and that half is not pedantry: `enrolments.employee_id` is unique,
  // so an undecided application really does own the ID until an administrator decides. Asking only
  // the first question let this gate pass an ID the database was about to refuse, and the refusal
  // arrived as an unhandled constraint error — a 500 with nothing in it the person could act on.
  const takenBy = (await ctx.db.select().from(users).where(eq(users.employeeId, employeeId)).limit(1))[0];
  const appliedFor = (await ctx.db.select().from(enrolments).where(eq(enrolments.employeeId, employeeId)).limit(1))[0];
  // Someone else's application, unless it was declined — a declined one leaves the ID free to claim,
  // which is exactly what the `users` half has always said too.
  const claimedByAnother = !!appliedFor && appliedFor.did !== payload.did && appliedFor.status !== "denied";
  const employeeIdFree = (!takenBy || takenBy.status === "denied") && !claimedByAnother;
  checks.push(gate("employee_id", employeeIdFree, employeeIdFree ? "verify.employeeId.free" : "verify.employeeId.taken"));

  // 2 — employee ID document
  checks.push(gate("id_document", true, "verify.idDocument.captured"));

  // 3 — face match against the ID photo, scored in the browser
  const faceOk = evidence.faceMatchScore >= ctx.config.FACE_MATCH_MIN_SCORE;
  checks.push(
    gate("face_match", faceOk, simulated ? "verify.faceMatch.simulated" : faceOk ? "verify.faceMatch.pass" : "verify.faceMatch.low", evidence.faceMatchScore, ctx.config.FACE_MATCH_MIN_SCORE),
  );

  // 4 — liveness: the passive composite, and the live AI check that runs beside it
  checks.push(live.check);

  // 5 — the DID signature over the nonce
  let derived: string | null = null;
  try {
    derived = didKeyFromJwk(payload.publicKeyJwk);
  } catch {
    derived = null;
  }
  const signatureOk =
    derived === payload.did && ed25519.verify(publicKeyFromJwk(payload.publicKeyJwk), evidence.nonce, evidence.signature);
  checks.push(gate("did_signature", signatureOk, signatureOk ? "verify.signature.pass" : "verify.signature.fail"));

  const sealedFace = await sealBlob(ctx, faceImage, faceAad(payload.did));
  const sealedDoc = await sealBlob(ctx, idDocument, idDocAad(payload.did));
  const bundle = sealBundle({
    purpose: "signup",
    did: payload.did,
    employeeId,
    checks,
    faceMatchScore: evidence.faceMatchScore,
    livenessScore,
    livenessSignals,
    faceSha256: sealedFace.sha256Plain,
    idDocSha256: sealedDoc.sha256Plain,
    nonce: evidence.nonce,
  });

  // A refused attempt is evidence: the capture is stored and the failure is written to the chain,
  // then the caller is told which gate stopped them.
  if (!bundle.passed) {
    await withTx(ctx.db, async (tx) => {
      const verification = await insertVerification(tx, {
        userId: null,
        did: payload.did,
        employeeId,
        purpose: "signup",
        face: sealedFace,
        faceMime: faceImage.mime,
        bundle,
        livenessMode: evidence.livenessMode,
        nonce: evidence.nonce,
        signature: evidence.signature,
        deviceId: null,
        ip,
      });
      await enqueueVerification(tx, verification, payload.did);
      const ev = await appendAudit(
        { db: tx },
        {
          eventType: "identity.signup_refused",
          actorDid: payload.did,
          payload: {
            employeeId,
            checks: bundle.checks,
            bundleHash: bundle.bundleHash,
            faceSha256: sealedFace.sha256Plain,
            faceCid: sealedFace.cid,
            verificationId: verification.id,
          },
        },
        tx,
      );
      await tx.update(faceVerifications).set({ auditEventId: ev.id }).where(eq(faceVerifications.id, verification.id));
    });
    throw ApiError.forbidden("verification_failed", "One of the five verifications did not pass. Nothing was enrolled.").withDetails(bundle);
  }

  const bootstrap = await needsBootstrapAdmin(ctx.db);
  const requestedRole: Role = ctx.config.DEMO_MODE && payload.role ? payload.role : "engineer";
  const role: Role = bootstrap ? "admin" : requestedRole;

  const result = await withTx(ctx.db, async (tx) => {
    // A denied identity re-enrolling reuses its row rather than colliding on the DID.
    const prior = (await tx.select().from(users).where(eq(users.did, payload.did)).limit(1))[0];
    let user: UserRow;
    if (prior) {
      if (prior.status === "active") throw ApiError.conflict("already_enrolled", "This browser's identity is already enrolled. Sign in instead.");
      user = (
        await tx
          .update(users)
          .set({
            employeeId,
            displayName: payload.displayName,
            role,
            status: bootstrap ? "active" : "pending",
            publicKeyJwk: payload.publicKeyJwk,
            livenessMode: evidence.livenessMode,
            sessionVersion: prior.sessionVersion + 1,
            revokedAt: null,
          })
          .where(eq(users.id, prior.id))
          .returning()
      )[0]!;
    } else {
      user = (
        await tx
          .insert(users)
          .values({
            did: payload.did,
            employeeId,
            displayName: payload.displayName,
            role,
            status: bootstrap ? "active" : "pending",
            publicKeyJwk: payload.publicKeyJwk,
            baseline: DEFAULT_BASELINE,
            identityTrust: 60,
            livenessMode: evidence.livenessMode,
          })
          .returning()
      )[0]!;
    }

    let device = (
      await tx.select().from(devices).where(and(eq(devices.userId, user.id), eq(devices.fingerprintHash, payload.deviceFingerprintHash))).limit(1)
    )[0];
    if (!device) {
      device = (await tx.insert(devices).values({ userId: user.id, fingerprintHash: payload.deviceFingerprintHash, lastIp: ip }).returning())[0]!;
      await bumpDeviceTrust(tx, device, "first_seen", null);
    }
    await bumpIdentityTrust(tx, user, "onboarded", null);

    const verification = await insertVerification(tx, {
      userId: user.id,
      did: user.did,
      employeeId,
      purpose: "signup",
      face: sealedFace,
      faceMime: faceImage.mime,
      bundle,
      livenessMode: evidence.livenessMode,
      nonce: evidence.nonce,
      signature: evidence.signature,
      deviceId: device.id,
      ip,
    });

    await tx.insert(livenessAttestations).values({
      userId: user.id,
      nonce: evidence.nonce,
      purpose: "signup",
      refId: verification.id,
      signature: evidence.signature,
      attestationHash: sha256Hex(`${user.did}|signup|${verification.id}|${evidence.nonce}|${evidence.signature}`),
      mode: evidence.livenessMode,
      verified: true,
      deviceId: device.id,
    });

    await saveFaceTemplate(tx, ctx, user, payload.faceTemplate, payload.faceTemplateSamples, payload.faceTemplateModel);

    /**
     * One identity, one open application.
     *
     * `enrolments.employee_id` is unique, so a second application has to replace what is already
     * there rather than sit beside it. Two ordinary things get here: somebody re-submitting after a
     * bad photo, and somebody who applied under one employee ID and came back with the correction.
     * Both used to end in a constraint violation the caller saw as "something went wrong inside the
     * gateway" — and the second one silently, because the `users` row had been renamed to the new ID
     * while the old application stayed behind holding the old one.
     *
     * A declined application for this ID is cleared too, whoever it belonged to, because the gate
     * above has just said a declined ID is free to claim and the row must not contradict it.
     *
     * Only the *application* is removed, never the evidence. The `face_verifications` row — the
     * capture, its hashes, its five gates — and the audit event that anchored it are untouched and
     * still reachable by DID: what an administrator saw, and when, remains answerable.
     */
    await tx
      .delete(enrolments)
      .where(
        or(
          and(eq(enrolments.did, payload.did), ne(enrolments.status, "approved")),
          and(eq(enrolments.employeeId, employeeId), eq(enrolments.status, "denied")),
        ),
      );

    const [enrolment] = await tx
      .insert(enrolments)
      .values({
        userId: user.id,
        employeeId,
        did: user.did,
        displayName: user.displayName,
        requestedRole: role,
        idDocMime: idDocument.mime,
        idDocSizeBytes: sealedDoc.sizeBytes,
        idDocSha256: sealedDoc.sha256Plain,
        idDocCipherSha256: sealedDoc.sha256Cipher,
        idDocCid: sealedDoc.cid,
        idDocDekWrapped: sealedDoc.dekWrapped,
        idDocIv: sealedDoc.iv,
        verificationId: verification.id,
        faceMatchScore: bundle.faceMatchScore,
        livenessScore: bundle.livenessScore,
        checks: bundle.checks,
        bundleHash: bundle.bundleHash,
        status: bootstrap ? "approved" : "pending",
        decidedBy: bootstrap ? "bootstrap" : null,
        decidedAt: bootstrap ? new Date() : null,
        decisionReason: bootstrap ? "First administrator: no approver existed yet." : null,
      })
      .returning();

    // The enrolment record — hashes, content addresses and both confidence scores — goes on chain.
    await enqueueLedger(tx, {
      contract: "IdentityVerification",
      fn: "RecordEnrolment",
      args: [
        user.did,
        sha256Hex(employeeId),
        sealedDoc.sha256Plain,
        sealedDoc.cid,
        sealedFace.sha256Plain,
        sealedFace.cid,
        String(bundle.faceMatchScore),
        String(bundle.livenessScore),
        bundle.bundleHash,
      ],
      refTable: "enrolments",
      refId: enrolment!.id,
    });
    await enqueueVerification(tx, verification, user.did);

    const ev = await appendAudit(
      { db: tx },
      {
        eventType: "identity.signup_submitted",
        actorDid: user.did,
        payload: {
          employeeId,
          role,
          bootstrapAdmin: bootstrap,
          checks: bundle.checks,
          bundleHash: bundle.bundleHash,
          faceMatchScore: bundle.faceMatchScore,
          livenessScore: bundle.livenessScore,
          livenessSignals: bundle.livenessSignals,
          idDocSha256: sealedDoc.sha256Plain,
          idDocCid: sealedDoc.cid,
          faceSha256: sealedFace.sha256Plain,
          faceCid: sealedFace.cid,
          verificationId: verification.id,
          enrolmentId: enrolment!.id,
        },
      },
      tx,
    );
    await tx.update(enrolments).set({ auditEventId: ev.id }).where(eq(enrolments.id, enrolment!.id));
    await tx.update(faceVerifications).set({ auditEventId: ev.id }).where(eq(faceVerifications.id, verification.id));

    // The bootstrap admin is active immediately, so it needs its credential now.
    if (bootstrap) await issueCredentialFor(ctx, tx, user);
    return { enrolment: enrolment!, user };
  });

  return { enrolment: publicEnrolment(result.enrolment, sealedFace), verification: bundle };
}

// ─── login ───────────────────────────────────────────────────────────────────

export async function startLogin(ctx: Pick<AppContext, "db" | "config" | "kek">, rawEmployeeId: string): Promise<LoginStartResponse> {
  const employeeId = normaliseEmployeeId(rawEmployeeId);
  const user = (await ctx.db.select().from(users).where(eq(users.employeeId, employeeId)).limit(1))[0];
  if (!user) throw ApiError.notFound("employee_id_unknown", "No enrolment exists for that employee ID.");
  if (user.status === "pending") throw ApiError.forbidden("enrolment_pending", "Your enrolment is still waiting for an administrator.");
  if (user.status === "denied") throw ApiError.forbidden("enrolment_denied", "This enrolment was declined. Speak to your administrator.");
  if (user.status !== "active") throw ApiError.forbidden("identity_revoked", "This identity is no longer active.");

  const template = (await ctx.db.select().from(faceTemplates).where(eq(faceTemplates.userId, user.id)).limit(1))[0];
  if (!template) throw ApiError.conflict("no_face_template", "This identity has no enrolled face. Enrol again.");

  const n = await createNonce(ctx.db, "login", user.id, user.id);
  // The audit trail records that someone asked for this identity's template, whether or not the
  // login then succeeds — a lookup is itself worth being able to review.
  await appendAudit(ctx as Pick<AppContext, "db">, {
    eventType: "identity.login_started",
    actorDid: user.did,
    payload: { employeeId, nonceIssued: true },
    anchor: false,
  });

  return {
    ...n,
    did: user.did,
    displayName: user.displayName,
    faceTemplate: readFaceTemplate(ctx, user, template),
    faceTemplateModel: template.model as EmbeddingModel,
    faceMatchThreshold: ctx.config.FACE_MATCH_MIN_SCORE,
    livenessThreshold: ctx.config.LIVENESS_MIN_SCORE,
    accountStatus: user.status as LoginStartResponse["accountStatus"],
  };
}

export async function completeLogin(
  ctx: AppContext,
  payload: LoginCompletePayload,
  faceImageFile: SubmittedFile | null,
  ip: string | null,
): Promise<LoginCompleteResponse> {
  const employeeId = normaliseEmployeeId(payload.employeeId);
  const faceImage = checkImage(faceImageFile, "face_image");
  const evidence = payload.evidence;
  /**
   * A capture that reports itself simulated measured no face at all — no camera, or no weights.
   *
   * It is allowed to satisfy the liveness gate so a laptop with no camera can still walk the whole
   * cryptographic path on stage, and that is worth keeping. But it is an unconditional pass on the
   * one gate that proves a person was present, so outside DEMO_MODE it is exactly an authentication
   * bypass: block the camera, sign the nonce, and the face never has to match. Outside a demo it is
   * refused, and the evidence still records that it was tried.
   */
  const simulated = evidence.livenessMode === "simulated" && ctx.config.DEMO_MODE;
  const live = judgeLiveness(ctx.config, evidence, simulated);
  const { score: livenessScore, signals: livenessSignals } = live;

  const user = (await ctx.db.select().from(users).where(eq(users.employeeId, employeeId)).limit(1))[0];
  if (!user) throw ApiError.notFound("employee_id_unknown", "No enrolment exists for that employee ID.");
  await consumeNonce(ctx.db, evidence.nonce, "login", user.id);

  const enrolment = (
    await ctx.db.select().from(enrolments).where(eq(enrolments.userId, user.id)).orderBy(desc(enrolments.createdAt)).limit(1)
  )[0];

  const checks: CheckRow[] = [];

  // 1 — employee ID resolves to an approved identity
  const idOk = user.status === "active" && enrolment?.status === "approved";
  checks.push(
    gate("employee_id", idOk, user.status === "pending" ? "verify.employeeId.pending" : idOk ? "verify.employeeId.known" : "verify.employeeId.blocked"),
  );

  // 2 — the ID document approved at enrolment is still byte-for-byte what is stored
  let docOk = false;
  let docDetail = "verify.idDocument.missing";
  if (enrolment) {
    docOk = await ctx.storage.verify(enrolment.idDocCid, enrolment.idDocCipherSha256).catch(() => false);
    docDetail = docOk ? "verify.idDocument.intact" : "verify.idDocument.tampered";
  }
  checks.push(gate("id_document", docOk, docDetail));

  // 3 — face match against the enrolled template, re-scored in the browser
  const faceOk = evidence.faceMatchScore >= ctx.config.FACE_MATCH_MIN_SCORE;
  checks.push(
    gate("face_match", faceOk, simulated ? "verify.faceMatch.simulated" : faceOk ? "verify.faceMatch.pass" : "verify.faceMatch.low", evidence.faceMatchScore, ctx.config.FACE_MATCH_MIN_SCORE),
  );

  // 4 — liveness: the passive composite, and the live AI check that runs beside it
  checks.push(live.check);

  // 5 — the DID signature, against the key registered at enrolment
  const signatureOk = ed25519.verify(publicKeyFromJwk(user.publicKeyJwk), evidence.nonce, evidence.signature);
  checks.push(gate("did_signature", signatureOk, signatureOk ? "verify.signature.pass" : "verify.signature.fail"));

  const sealedFace = await sealBlob(ctx, faceImage, faceAad(user.did));
  const bundle = sealBundle({
    purpose: "login",
    did: user.did,
    employeeId,
    checks,
    faceMatchScore: evidence.faceMatchScore,
    livenessScore,
    livenessSignals,
    faceSha256: sealedFace.sha256Plain,
    idDocSha256: enrolment?.idDocSha256 ?? "",
    nonce: evidence.nonce,
  });

  const device = await upsertDevice(ctx.db, user, payload.deviceFingerprintHash, ip);

  const verification = await withTx(ctx.db, async (tx) => {
    const row = await insertVerification(tx, {
      userId: user.id,
      did: user.did,
      employeeId,
      purpose: "login",
      face: sealedFace,
      faceMime: faceImage.mime,
      bundle,
      livenessMode: evidence.livenessMode,
      nonce: evidence.nonce,
      signature: evidence.signature,
      deviceId: device.id,
      ip,
    });
    await tx.insert(livenessAttestations).values({
      userId: user.id,
      nonce: evidence.nonce,
      purpose: "login",
      refId: row.id,
      signature: evidence.signature,
      attestationHash: sha256Hex(`${user.did}|login|${row.id}|${evidence.nonce}|${evidence.signature}`),
      mode: evidence.livenessMode,
      verified: bundle.passed,
      deviceId: device.id,
    });
    await bumpIdentityTrust(tx, user, bundle.passed ? "liveness_success" : "liveness_failed", row.id);
    if (!bundle.passed) await bumpDeviceTrust(tx, device, "liveness_failed", row.id);
    await enqueueVerification(tx, row, user.did);
    const ev = await appendAudit(
      { db: tx },
      {
        eventType: bundle.passed ? "identity.login_succeeded" : "identity.login_refused",
        actorDid: user.did,
        payload: {
          employeeId,
          checks: bundle.checks,
          bundleHash: bundle.bundleHash,
          faceMatchScore: bundle.faceMatchScore,
          livenessScore: bundle.livenessScore,
          livenessSignals: bundle.livenessSignals,
          faceSha256: sealedFace.sha256Plain,
          faceCid: sealedFace.cid,
          verificationId: row.id,
          deviceId: device.id,
        },
      },
      tx,
    );
    await tx.update(faceVerifications).set({ auditEventId: ev.id }).where(eq(faceVerifications.id, row.id));
    return row;
  });

  // The refusal above is not the whole response to an attack. Someone presenting a screen to the
  // camera of an account they do not own may already hold a session on it — a stolen laptop, a
  // borrowed browser left signed in — so the sessions that exist are cut at the same moment this
  // attempt is refused, rather than surviving because the attempt happened to fail.
  if (live.spoof) {
    const inc = await reportPresentationAttack(ctx, user, {
      purpose: "login",
      liveProbability: evidence.spoofCheck?.liveProbability ?? null,
      samples: evidence.spoofCheck?.samples ?? null,
    });
    throw ApiError.forbidden(
      "presentation_attack",
      `The live check identified a presentation attack rather than a live face. You were not signed in, every session on this identity has been locked, and incident ${inc.incident?.incidentId ?? "—"} is open.`,
    ).withDetails(bundle);
  }
  if (!bundle.passed) throw ApiError.forbidden("verification_failed", "One of the five verifications did not pass.").withDetails(bundle);

  const cred = (await ctx.db.select().from(credentials).where(and(eq(credentials.userId, user.id), eq(credentials.status, "active"))).limit(1))[0];
  return {
    user: publicUser(user),
    sessionJwt: await signSession(ctx, user, device.id),
    vcJwt: cred?.vcJwt ?? "",
    device: { id: device.id, deviceTrust: device.deviceTrust, trusted: device.trusted },
    verification: bundle,
    verificationId: verification.id,
    home: user.role === "admin" ? "admin" : "app",
  };
}

// ─── admin decision ──────────────────────────────────────────────────────────

export async function listEnrolments(ctx: Pick<AppContext, "db">, status?: string): Promise<EnrolmentSummary[]> {
  const rows = status
    ? await ctx.db.select().from(enrolments).where(eq(enrolments.status, status)).orderBy(desc(enrolments.createdAt))
    : await ctx.db.select().from(enrolments).orderBy(desc(enrolments.createdAt));
  const out: EnrolmentSummary[] = [];
  for (const row of rows) {
    const v = (await ctx.db.select().from(faceVerifications).where(eq(faceVerifications.id, row.verificationId)).limit(1))[0];
    out.push(publicEnrolment(row, v ? { sha256Plain: v.imageSha256, cid: v.imageCid } : null));
  }
  return out;
}

export async function getEnrolmentById(ctx: Pick<AppContext, "db">, id: string): Promise<EnrolmentRow> {
  const row = (await ctx.db.select().from(enrolments).where(eq(enrolments.id, id)).limit(1))[0];
  if (!row) throw ApiError.notFound("enrolment_not_found");
  return row;
}

/**
 * Approve or deny an enrolment. The admin's own liveness attestation is verified by the caller;
 * the decision itself goes through the contract, which refuses a second decision and refuses a
 * decision made by the person enrolling.
 */
export async function decideEnrolment(
  ctx: AppContext,
  admin: UserRow,
  attestationId: string,
  id: string,
  approve: boolean,
  reason: string,
): Promise<EnrolmentSummary> {
  const row = await getEnrolmentById(ctx, id);
  if (row.status !== "pending") throw ApiError.conflict("already_decided", `This enrolment was already ${row.status}.`);
  if (row.did === admin.did) throw ApiError.badRequest("approver_is_requester", "An enrolment cannot approve itself.");

  const updated = await withTx(ctx.db, async (tx) => {
    const [next] = await tx
      .update(enrolments)
      .set({
        status: approve ? "approved" : "denied",
        decidedBy: admin.displayName,
        decidedByDid: admin.did,
        decidedAt: new Date(),
        decisionReason: reason,
        attestationId,
      })
      .where(eq(enrolments.id, id))
      .returning();

    const target = (await tx.select().from(users).where(eq(users.id, row.userId)).limit(1))[0];
    if (!target) throw ApiError.notFound("user_not_found");
    await tx
      .update(users)
      .set({ status: approve ? "active" : "denied", sessionVersion: target.sessionVersion + 1 })
      .where(eq(users.id, target.id));
    if (approve) {
      await issueCredentialFor(ctx, tx, { ...target, status: "active" });
      await bumpIdentityTrust(tx, target, "admin_attested", id);
    }

    await enqueueLedger(tx, {
      contract: "IdentityVerification",
      fn: "DecideEnrolment",
      args: [row.did, approve ? "approved" : "denied", admin.did, sha256Hex(reason)],
      refTable: "enrolments",
      refId: id,
    });
    await appendAudit(
      { db: tx },
      {
        eventType: approve ? "identity.enrolment_approved" : "identity.enrolment_denied",
        actorDid: admin.did,
        payload: {
          enrolmentId: id,
          targetDid: row.did,
          employeeId: row.employeeId,
          role: row.requestedRole,
          reasonHash: sha256Hex(reason),
          bundleHash: row.bundleHash,
          attestationId,
        },
      },
      tx,
    );
    return next!;
  });

  const v = (await ctx.db.select().from(faceVerifications).where(eq(faceVerifications.id, row.verificationId)).limit(1))[0];
  return publicEnrolment(updated, v ? { sha256Plain: v.imageSha256, cid: v.imageCid } : null);
}

/** The two images an admin looks at before deciding. Decrypted on demand; never cached. */
export async function enrolmentImage(ctx: AppContext, id: string, which: "id-document" | "face"): Promise<{ buffer: Buffer; mime: string; sha256: string }> {
  const row = await getEnrolmentById(ctx, id);
  if (which === "id-document") {
    const buffer = await openBlob(
      ctx,
      { cid: row.idDocCid, dekWrapped: row.idDocDekWrapped, iv: row.idDocIv, sha256Cipher: row.idDocCipherSha256 },
      idDocAad(row.did),
    );
    return { buffer, mime: row.idDocMime, sha256: row.idDocSha256 };
  }
  const v = (await ctx.db.select().from(faceVerifications).where(eq(faceVerifications.id, row.verificationId)).limit(1))[0];
  if (!v) throw ApiError.notFound("verification_not_found");
  const buffer = await openBlob(
    ctx,
    { cid: v.imageCid, dekWrapped: v.imageDekWrapped, iv: v.imageIv, sha256Cipher: v.imageCipherSha256 },
    faceAad(row.did),
  );
  return { buffer, mime: v.imageMime, sha256: v.imageSha256 };
}

export async function listFaceVerifications(ctx: Pick<AppContext, "db">, opts: { did?: string; purpose?: string; limit?: number } = {}) {
  const conds = [];
  if (opts.did) conds.push(eq(faceVerifications.did, opts.did));
  if (opts.purpose) conds.push(eq(faceVerifications.purpose, opts.purpose));
  const rows = await ctx.db
    .select()
    .from(faceVerifications)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(faceVerifications.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
  return rows.map(publicVerification);
}

export const publicVerification = (v: FaceVerificationRow) => ({
  id: v.id,
  did: v.did,
  employeeId: v.employeeId,
  purpose: v.purpose as "signup" | "login",
  passed: v.passed,
  faceMatchScore: v.faceMatchScore,
  livenessScore: v.livenessScore,
  livenessSignals: v.livenessSignals,
  livenessMode: v.livenessMode,
  checks: v.checks,
  bundleHash: v.bundleHash,
  imageSha256: v.imageSha256,
  imageCid: v.imageCid,
  imageSizeBytes: v.imageSizeBytes,
  ledgerTxId: v.ledgerTxId,
  block: v.block,
  anchoredAt: v.anchoredAt?.toISOString() ?? null,
  auditEventId: v.auditEventId,
  createdAt: v.createdAt.toISOString(),
});

export function publicEnrolment(row: EnrolmentRow, face: { sha256Plain: string; cid: string } | null): EnrolmentSummary {
  return {
    id: row.id,
    employeeId: row.employeeId,
    displayName: row.displayName,
    did: row.did,
    requestedRole: row.requestedRole as Role,
    status: row.status as EnrolmentSummary["status"],
    faceMatchScore: row.faceMatchScore,
    livenessScore: row.livenessScore,
    checks: row.checks as VerificationCheck[],
    bundleHash: row.bundleHash,
    idDocSha256: row.idDocSha256,
    idDocCid: row.idDocCid,
    faceSha256: face?.sha256Plain ?? "",
    faceCid: face?.cid ?? "",
    ledgerTxId: row.ledgerTxId,
    block: row.block,
    decidedBy: row.decidedBy,
    decisionReason: row.decisionReason,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── internals ───────────────────────────────────────────────────────────────

async function insertVerification(
  tx: Db,
  input: {
    userId: string | null;
    did: string;
    employeeId: string;
    purpose: "signup" | "login";
    face: SealedBlob;
    faceMime: string;
    bundle: VerificationBundle;
    livenessMode: string;
    nonce: string;
    signature: string;
    deviceId: string | null;
    ip: string | null;
  },
): Promise<FaceVerificationRow> {
  const [row] = await tx
    .insert(faceVerifications)
    .values({
      userId: input.userId,
      did: input.did,
      employeeId: input.employeeId,
      purpose: input.purpose,
      imageMime: input.faceMime,
      imageSizeBytes: input.face.sizeBytes,
      imageSha256: input.face.sha256Plain,
      imageCipherSha256: input.face.sha256Cipher,
      imageCid: input.face.cid,
      imageDekWrapped: input.face.dekWrapped,
      imageIv: input.face.iv,
      faceMatchScore: input.bundle.faceMatchScore,
      livenessScore: input.bundle.livenessScore,
      livenessSignals: input.bundle.livenessSignals,
      livenessMode: input.livenessMode,
      checks: input.bundle.checks,
      bundleHash: input.bundle.bundleHash,
      passed: input.bundle.passed,
      nonce: input.nonce,
      signature: input.signature,
      deviceId: input.deviceId,
      ip: input.ip,
    })
    .returning();
  return row!;
}

/** Every face check reaches the ledger, passed or refused — a refusal is the evidence that matters. */
async function enqueueVerification(tx: Db, row: FaceVerificationRow, did: string): Promise<void> {
  await enqueueLedger(tx, {
    contract: "IdentityVerification",
    fn: "RecordVerification",
    args: [
      row.id,
      did,
      row.purpose,
      row.imageSha256,
      row.imageCid,
      String(row.faceMatchScore),
      String(row.livenessScore),
      row.bundleHash,
      String(row.passed),
    ],
    refTable: "face_verifications",
    refId: row.id,
  });
}

async function upsertDevice(db: Db, user: UserRow, fingerprintHash: string, ip: string | null): Promise<DeviceRow> {
  const existing = (await db.select().from(devices).where(and(eq(devices.userId, user.id), eq(devices.fingerprintHash, fingerprintHash))).limit(1))[0];
  if (existing) {
    await db.update(devices).set({ lastSeen: new Date(), lastIp: ip }).where(eq(devices.id, existing.id));
    return existing;
  }
  const created = (await db.insert(devices).values({ userId: user.id, fingerprintHash, lastIp: ip }).returning())[0]!;
  await bumpDeviceTrust(db, created, "first_seen", null);
  await bumpIdentityTrust(db, user, "new_device", null);
  return created;
}

async function saveFaceTemplate(
  tx: Db,
  ctx: Pick<AppContext, "kek">,
  user: UserRow,
  template: number[],
  samples: number,
  model: EmbeddingModel,
): Promise<void> {
  const plaintext = Buffer.from(JSON.stringify(template), "utf8");
  const dek = newDek();
  const aad = templateAad(user.did);
  const sealed = aesGcmEncrypt(dek, plaintext, aad);
  const values = {
    did: user.did,
    templateWrapped: b64u.encode(sealed.ciphertext),
    templateIv: sealed.iv,
    templateDekWrapped: wrapDek(ctx.kek, dek, aad),
    templateHash: sha256Hex(plaintext),
    samples,
    model,
    updatedAt: new Date(),
  };
  await tx
    .insert(faceTemplates)
    .values({ userId: user.id, ...values })
    .onConflictDoUpdate({ target: faceTemplates.userId, set: values });
}

function readFaceTemplate(ctx: Pick<AppContext, "kek">, user: UserRow, row: typeof faceTemplates.$inferSelect): number[] {
  const aad = templateAad(user.did);
  const plaintext = aesGcmDecrypt(unwrapDek(ctx.kek, row.templateDekWrapped, aad), { ciphertext: b64u.decode(row.templateWrapped), iv: row.templateIv }, aad);
  return JSON.parse(plaintext.toString("utf8")) as number[];
}

async function issueCredentialFor(ctx: Pick<AppContext, "keys">, tx: Db, user: UserRow): Promise<void> {
  const existing = (await tx.select().from(credentials).where(and(eq(credentials.userId, user.id), eq(credentials.status, "active"))).limit(1))[0];
  if (existing) return;
  const { vcJwt, vcHash } = await issueIdentityCredential(ctx, user, user.livenessMode);
  const [cred] = await tx.insert(credentials).values({ userId: user.id, vcJwt, vcHash }).returning();
  await enqueueLedger(tx, {
    contract: "DIDRegistry",
    fn: "RegisterDID",
    args: [user.did, sha256Hex(user.publicKeyJwk.x ?? ""), vcHash],
    refTable: "credentials",
    refId: cred!.id,
  });
}
