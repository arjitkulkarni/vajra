/**
 * The console session — the issued admin link, used as a credential.
 *
 * WHAT CHANGED, AND WHY IT IS WORTH SAYING OUT LOUD
 * `lib/console-key.ts` used to end with "What it is NOT: a way in. A valid key with no admin
 * session gets you exactly nothing, because the role check still runs." That is no longer true,
 * and the reversal is deliberate: the operator who runs `pnpm admin:url` and follows the link is
 * now signed in as an administrator, with no face verification and no enrolment.
 *
 * The reason is that the two things were never really independent. The administrative plane is
 * where you go to APPROVE enrolments — including the first one — so requiring an approved,
 * face-verified admin identity in order to reach it is a bootstrap that eats itself: a fresh
 * database has nobody who can let anybody in. Every operator was resolving that by seeding a demo
 * admin and signing in as them, which means the "second factor" was, in practice, a second copy of
 * the first one.
 *
 * So the link is now the credential, and the honest description of the control is:
 *
 *   possession of the issued link  +  arrival from an allowlisted address  =  administrator
 *
 * That is a real control, and it is a WEAKER one than it was. It is weaker in exactly one way that
 * matters: anyone holding the link is an administrator, so the link is now a secret in the sense
 * that a password is a secret. Two things follow, and both are enforced elsewhere rather than here:
 *
 *   1. ADMIN_CONSOLE_SECRET must not be the shipped default on any host another person can reach.
 *      `scripts/admin-url.ts` says so loudly, because that warning is now load-bearing rather than
 *      advisory.
 *   2. ADMIN_IP_ALLOWLIST is the remaining independent factor. It is unchanged, it is still checked
 *      on every administrative route, and it is the thing standing between a leaked URL and a
 *      compromise. Setting it is no longer optional hygiene on a deployed host.
 *
 * WHAT THE SESSION IS
 * A real row, not a fiction. The operator is a genuine `users` record with a genuine `did:key`
 * derived from ADMIN_CONSOLE_SECRET, so:
 *
 *   - every action it takes is attributed to a stable, resolvable DID in the audit chain, and an
 *     auditor reading the ledger months later can tell console actions from human ones at a glance;
 *   - rotating the secret rotates the identity, so the audit trail segments at exactly the moment
 *     the old links died;
 *   - it holds a real Ed25519 key pair, so nothing downstream that expects a resolvable DID or a
 *     public JWK has to special-case it.
 *
 * It is created on first use and then reused, because a console that minted a new identity per
 * visit would fill the identity table with ghosts and make the audit trail unreadable.
 *
 * WHAT IT CANNOT DO
 * It has no face template and no browser-held private key on the operator's machine, so it cannot
 * produce a liveness attestation. Routes that demand one therefore skip that check for a console
 * session rather than failing it — see `routes/index.ts`. That is the same decision as above, said
 * once more: the link is the proof, and demanding a second proof the session structurally cannot
 * produce would just be a locked door with no key cut for it.
 */
import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Role } from "@vajra/contracts";
import { users } from "../../db/schema";
import type { AppContext } from "../../context";
import { keyPairFromSecret, didKeyFromRaw, b64u } from "../../lib/crypto";
import { CONSOLE_KEY_HEADER, consoleKeyMatches } from "../../lib/console-key";
import { DEFAULT_BASELINE } from "./onboarding";
import type { Session, UserRow } from "./session";

/**
 * Namespaced separately from the console key's own label so the two derivations are independent:
 * the key that opens the door and the identity that walks through it should not be recoverable
 * from one another.
 */
const OPERATOR_SEED_LABEL = "vajra-admin-console-operator:v1";

/** How the operator appears in the console header, in the audit trail and on every proof. */
const OPERATOR_NAME = "Console operator";

/**
 * The device fingerprint a console session presents when a route needs one.
 *
 * A constant, and deliberately a recognisable one: the console has no enrolled device, so every
 * console visit resolves to this single device row rather than accreting a new "first seen" device
 * on every browser the link is opened in. `access/service.ts` trusts it on sight — the link is what
 * vouches for the machine, and there is nothing else that could.
 */
export const CONSOLE_DEVICE_FINGERPRINT = "console-issued-link-0000000000000000";

/** Derived, never stored: the same input always yields the same identity. */
function operatorIdentity(secret: string): { did: string; publicKeyJwk: Record<string, string> } {
  const { publicKey, publicRaw } = keyPairFromSecret(`${OPERATOR_SEED_LABEL}:${secret}`);
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
  return {
    did: didKeyFromRaw(publicRaw),
    publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: jwk.x ?? b64u.encode(publicRaw) },
  };
}

/** True when this request carries the issued console link. Cheap, and says nothing about identity. */
export function presentsConsoleKey(ctx: Pick<AppContext, "config">, req: FastifyRequest): boolean {
  return consoleKeyMatches(ctx.config.ADMIN_CONSOLE_SECRET, req.headers[CONSOLE_KEY_HEADER] as string | undefined);
}

/**
 * Find or create the console operator.
 *
 * Two writers can race here on a cold start — the console makes several parallel calls on its first
 * paint — so the insert tolerates the unique constraint on `did` and re-reads rather than failing
 * the request that lost. The row is also repaired on every visit: an operator that was suspended,
 * revoked or had its trust decayed by an incident rule would otherwise lock the console out with no
 * way back in, which is the exact failure this whole path exists to prevent.
 */
async function ensureOperator(ctx: Pick<AppContext, "db" | "config">): Promise<UserRow> {
  const { did, publicKeyJwk } = operatorIdentity(ctx.config.ADMIN_CONSOLE_SECRET);
  const existing = (await ctx.db.select().from(users).where(eq(users.did, did)).limit(1))[0];
  if (existing) {
    if (existing.status === "active" && existing.role === "admin" && existing.identityTrust === 100) return existing;
    const [repaired] = await ctx.db
      .update(users)
      .set({ status: "active", role: "admin", identityTrust: 100, revokedAt: null })
      .where(eq(users.id, existing.id))
      .returning();
    return repaired ?? existing;
  }

  try {
    const [created] = await ctx.db
      .insert(users)
      .values({
        did,
        displayName: OPERATOR_NAME,
        role: "admin" satisfies Role,
        status: "active",
        // 100, not the enrolment default of 60: identity trust is a statement about how sure we are
        // this is the person we think it is, and for this session that question is answered by the
        // secret rather than by a face. Leaving it at 60 would make policies with a trust floor
        // refuse the console for reasons the operator could not act on.
        identityTrust: 100,
        publicKeyJwk,
        baseline: DEFAULT_BASELINE,
        livenessMode: "faceapi",
      })
      .returning();
    if (created) return created;
  } catch {
    /* lost the race — fall through and re-read */
  }
  const row = (await ctx.db.select().from(users).where(eq(users.did, did)).limit(1))[0];
  if (!row) throw new Error("console operator could not be created");
  return row;
}

/**
 * The session a valid console link is worth, or null if the link is absent or wrong.
 *
 * The network allowlist is NOT checked here, deliberately. `adminOnly` checks it a moment later and
 * refuses with its own message, and keeping the two separate is what lets the console tell an
 * operator on the wrong network that it is their network — rather than that their link is bad.
 */
export async function consoleSession(ctx: Pick<AppContext, "db" | "config">, req: FastifyRequest): Promise<Session | null> {
  if (!presentsConsoleKey(ctx, req)) return null;
  const user = await ensureOperator(ctx);
  return {
    claims: { sub: user.did, uid: user.id, role: "admin", sv: user.sessionVersion, dev: CONSOLE_DEVICE_FINGERPRINT },
    user,
    // Resolved lazily by whichever route needs one. `/v1/me` reports null, which is correct: until
    // the operator asks for something, no device has been involved.
    device: null,
    fresh: true,
    console: true,
  };
}
