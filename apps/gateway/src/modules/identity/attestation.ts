/**
 * Liveness attestations: the only thing the server ever receives about a face.
 * The browser matched the face on-device, ran the liveness challenge, and signed the nonce with
 * the DID key. We verify the signature against the registered key and burn the nonce.
 */
import type { AttestationBody, SpoofCheck } from "@vajra/contracts";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { livenessAttestations } from "../../db/schema";
import { ed25519, publicKeyFromJwk, sha256Hex } from "../../lib/crypto";
import { consumeNonce, type NoncePurpose } from "./nonces";
import type { Session, UserRow } from "./session";

export interface AttestationResult {
  ok: boolean;
  attestationId: string;
  attestationHash: string;
  /**
   * The live AI check called this capture a presentation attack.
   *
   * Distinct from `!ok`, which is any failure at all. A wrong signature is a broken or a replayed
   * proof; this is a person holding something up to the lens, and the response ladder treats the
   * two differently — see modules/incident/service.
   */
  spoof: boolean;
}

/**
 * The live AI check's verdict on a reported capture.
 *
 * The device reports a number, this decides what it means. Keeping the comparison here rather than
 * in the browser is the whole point: a client that judged itself could simply choose to pass, and
 * one that refused to submit at all would keep the attack out of the record entirely.
 *
 * `null` when the check did not run — no weights on that machine, or a capture that ended before
 * the model returned anything. That is genuinely different from a pass, and it is recorded as
 * unmeasured rather than quietly counted as one.
 */
export function spoofVerdict(config: Pick<Config, "ANTISPOOF_MIN_LIVE">, check: SpoofCheck | undefined): { live: number; spoof: boolean } | null {
  if (!check) return null;
  const live = Math.round(check.liveProbability * 100);
  return { live, spoof: live < config.ANTISPOOF_MIN_LIVE };
}

/**
 * The liveness numbers the browser reported, shaped for an audit payload.
 *
 * A claim the attesting device makes about its own check, not something we can re-derive — so it is
 * recorded beside the signature that actually carries the weight, never in place of it.
 */
export function livenessEvidence(body: Pick<AttestationBody, "livenessMode" | "livenessScore" | "livenessSignals" | "spoofCheck">) {
  return {
    livenessMode: body.livenessMode,
    livenessScore: body.livenessScore ?? null,
    livenessSignals: body.livenessSignals ?? null,
    spoofCheck: body.spoofCheck ?? null,
  };
}

export async function verifyAttestation(
  ctx: { db: Db; config: Pick<Config, "ANTISPOOF_MIN_LIVE"> },
  user: UserRow,
  body: AttestationBody,
  purpose: NoncePurpose,
  refId: string | null,
  deviceId: string | null,
): Promise<AttestationResult> {
  await consumeNonce(ctx.db, body.nonce, purpose, refId);
  const pub = publicKeyFromJwk(user.publicKeyJwk);
  const signatureOk = ed25519.verify(pub, body.nonce, body.signature);
  // A proof signed by the right key over the right nonce, of a face the model says was on a screen,
  // is not a proof of anything this system wants to accept. Both have to hold.
  const spoof = spoofVerdict(ctx.config, body.spoofCheck)?.spoof ?? false;
  const ok = signatureOk && !spoof;
  const attestationHash = sha256Hex(`${user.did}|${purpose}|${refId ?? ""}|${body.nonce}|${body.signature}`);
  const [row] = await ctx.db
    .insert(livenessAttestations)
    .values({
      userId: user.id,
      nonce: body.nonce,
      purpose,
      refId,
      signature: body.signature,
      attestationHash,
      mode: body.livenessMode,
      verified: ok,
      deviceId,
    })
    .returning({ id: livenessAttestations.id });
  return { ok, attestationId: row!.id, attestationHash, spoof };
}

/**
 * The liveness gate for an action taken by a *session*, as opposed to one taken during login.
 *
 * Every provable administrative act — approving an enrolment, revoking an identity, closing an
 * incident, clearing a step-up — routes through here rather than calling `verifyAttestation`
 * directly, so the one exception below exists in exactly one place instead of five.
 *
 * THE EXCEPTION. A console session (modules/identity/console-session.ts) authenticated with the
 * issued admin link, not with a face. There is no enrolled template to match against and no
 * browser-held private key on that machine to sign the nonce with, so it cannot produce an
 * attestation — not "declines to", cannot. Demanding one would be a locked door with no key cut
 * for it: the console would be reachable and every action inside it would refuse.
 *
 * So the signature check is skipped and the act is recorded as what it actually was. The row is
 * still written, with `mode: "console"` and a signature field that says in words what authorised
 * it, because the evidence trail's job is to be TRUE rather than to be uniform — an auditor
 * reading it months later must be able to see that this approval rested on possession of the
 * console link and an allowlisted address, and not on somebody's face. A row that claimed
 * "faceapi" here would be the single most misleading thing in the database.
 *
 * The nonce is deliberately not consumed. Its job is to bind one face proof to one action so a
 * captured proof cannot be replayed onto a second; with no proof to bind there is nothing for it
 * to do, and a console session that could not find a nonce would fail for a reason the operator
 * could neither see nor act on.
 */
export const CONSOLE_ATTESTATION_MARKER = "authorised-by-issued-console-link";

export async function verifySessionAttestation(
  ctx: { db: Db; config: Pick<Config, "ANTISPOOF_MIN_LIVE"> },
  session: Session,
  body: AttestationBody,
  purpose: NoncePurpose,
  refId: string | null,
  deviceId: string | null,
): Promise<AttestationResult> {
  if (!session.console) return verifyAttestation(ctx, session.user, body, purpose, refId, deviceId);

  const user = session.user;
  const attestationHash = sha256Hex(`${user.did}|${purpose}|${refId ?? ""}|${CONSOLE_ATTESTATION_MARKER}`);
  const [row] = await ctx.db
    .insert(livenessAttestations)
    .values({
      userId: user.id,
      nonce: body.nonce,
      purpose,
      refId,
      signature: CONSOLE_ATTESTATION_MARKER,
      attestationHash,
      mode: "console",
      verified: true,
      deviceId,
    })
    .returning({ id: livenessAttestations.id });
  return { ok: true, attestationId: row!.id, attestationHash, spoof: false };
}
