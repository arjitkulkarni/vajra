/**
 * The console key — a second factor on the administrative plane.
 *
 * The admin console is already behind two controls: `requireRole(session, "admin")` and a network
 * allowlist. Both are things about *where you are* and *who you are*. The console key adds a third,
 * independent of both: something you have to have been given.
 *
 * It is a keyed digest, not a stored token, so there is no table to read, nothing to expire and
 * nothing to replicate — the gateway recomputes it from `ADMIN_CONSOLE_SECRET` on every request and
 * compares in constant time. Rotating it is one environment variable and a restart; every URL handed
 * out under the old secret dies at that moment.
 *
 * What it IS, as of the console-session change: a way in. Presenting a valid key signs you in as
 * the administrative console operator, with no face verification and no prior enrolment. That is a
 * reversal of what this file used to say, and the argument for it — plus the two controls that are
 * now carrying the weight — lives in modules/identity/console-session.ts. Read that before
 * changing anything here.
 *
 * The short version: the administrative plane is where enrolments get approved, including the
 * first one, so requiring an approved administrator in order to reach it was a bootstrap that ate
 * itself. What remains in front of the control plane is possession of this link and arrival from
 * an allowlisted address.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { b64u } from "./crypto";

/** The header the console presents it on. Lower-case: Fastify normalises, CORS must match. */
export const CONSOLE_KEY_HEADER = "x-vajra-console-key";

/** The query parameter the operator pastes it in on. */
export const CONSOLE_KEY_PARAM = "k";

/**
 * Bumping this label invalidates every key ever issued without touching the secret — the escape
 * hatch for "a URL leaked and I cannot rotate the secret right now".
 */
const LABEL = "vajra-admin-console:v1";

/** 43 base64url characters — the full 256-bit digest, no truncation. */
export function consoleKey(secret: string): string {
  return b64u.encode(createHmac("sha256", secret).update(LABEL).digest());
}

/** Constant-time compare. Length is checked first because timingSafeEqual throws on a mismatch. */
export function consoleKeyMatches(secret: string, presented: string | null | undefined): boolean {
  if (!presented) return false;
  const expected = Buffer.from(consoleKey(secret), "utf8");
  const got = Buffer.from(presented, "utf8");
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

/**
 * The URL an operator is handed. The key rides as a query parameter rather than a path segment so
 * the console's eighteen routes keep their addresses — and the browser strips it from the address
 * bar on arrival, so it does not survive into a screenshot or a shoulder-surf.
 */
export function consoleUrl(webOrigin: string, secret: string, locale = "en"): string {
  const origin = (webOrigin === "*" ? "http://localhost:3000" : webOrigin.split(",")[0]!).trim().replace(/\/+$/, "");
  return `${origin}/${locale}/admin?${CONSOLE_KEY_PARAM}=${consoleKey(secret)}`;
}
