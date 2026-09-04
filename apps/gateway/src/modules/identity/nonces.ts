import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../../db/client";
import { livenessNonces } from "../../db/schema";
import { randomToken } from "../../lib/crypto";
import { ApiError } from "../../lib/errors";

export type NoncePurpose = "signup" | "login" | "onboard" | "step_up" | "approval" | "revoke" | "close_incident" | "policy" | "break_glass";
export const NONCE_TTL_MS = 2 * 60 * 1000;

export type ChallengeStep = "turn_left" | "turn_right" | "smile";

/**
 * Every set asks for a head turn, and the turn is what the browser's depth signal needs to have
 * anything to measure: without one, out-of-plane structure is reported as unmeasured and the
 * composite falls back on signals a flat photo has a much easier time of. The second step varies so
 * that the pair drawn for one nonce is not the pair a recording was made against.
 */
const CHALLENGES: ChallengeStep[][] = [
  ["turn_left", "smile"],
  ["turn_right", "smile"],
  ["smile", "turn_left"],
  ["smile", "turn_right"],
  ["turn_left", "turn_right"],
  ["turn_right", "turn_left"],
];

export async function createNonce(
  db: Db,
  purpose: NoncePurpose,
  refId: string | null,
  userId: string | null,
): Promise<{ nonce: string; challenge: ChallengeStep[]; expiresAt: string }> {
  const nonce = randomToken(24);
  const challenge = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)]!;
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await db.insert(livenessNonces).values({ nonce, purpose, refId, userId, challenge, expiresAt });
  return { nonce, challenge, expiresAt: expiresAt.toISOString() };
}

/** Single use: the row is deleted the moment it is consumed, whatever the verification outcome. */
export async function consumeNonce(db: Db, nonce: string, purpose: NoncePurpose, refId?: string | null) {
  const row = (await db.select().from(livenessNonces).where(eq(livenessNonces.nonce, nonce)).limit(1))[0];
  if (!row) throw ApiError.badRequest("nonce_invalid", "This liveness challenge is unknown or was already used.");
  await db.delete(livenessNonces).where(eq(livenessNonces.nonce, nonce));
  if (row.purpose !== purpose) throw ApiError.badRequest("nonce_purpose_mismatch", "This challenge was issued for a different action.");
  if (refId !== undefined && (row.refId ?? null) !== (refId ?? null))
    throw ApiError.badRequest("nonce_ref_mismatch", "This challenge was issued for a different request.");
  if (row.expiresAt.getTime() < Date.now()) throw ApiError.badRequest("nonce_expired", "This liveness challenge expired. Start again.");
  return row;
}

export async function sweepExpiredNonces(db: Db): Promise<void> {
  await db.delete(livenessNonces).where(and(lt(livenessNonces.expiresAt, new Date())));
}
