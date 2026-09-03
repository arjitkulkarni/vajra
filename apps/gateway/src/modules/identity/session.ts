import { eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import type { Role } from "@vajra/contracts";
import type { Db } from "../../db/client";
import { devices, users } from "../../db/schema";
import type { AppContext } from "../../context";
import { ApiError } from "../../lib/errors";

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;

export interface SessionClaims {
  sub: string; // did
  uid: string;
  role: Role;
  sv: number;
  dev: string; // device fingerprint hash
}

export interface Session {
  claims: SessionClaims;
  user: UserRow;
  device: DeviceRow | null;
  /** false when the token's session_version is stale (revocation / lock) */
  fresh: boolean;
  /**
   * True when this session was minted from the issued admin console link rather than from a
   * face-verified login. See modules/identity/console-session.ts for what that is worth and what
   * it costs. Routes read it for exactly one purpose: to skip a liveness attestation that a
   * console session structurally cannot produce.
   */
  console?: boolean;
}

const secretBytes = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(ctx: Pick<AppContext, "config">, user: UserRow, deviceFingerprintHash: string): Promise<string> {
  return new SignJWT({ uid: user.id, role: user.role, sv: user.sessionVersion, dev: deviceFingerprintHash })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.did)
    .setIssuer(ctx.config.ISSUER_DID)
    .setAudience("vajra-gateway")
    .setIssuedAt()
    .setExpirationTime(`${ctx.config.SESSION_TTL_MINUTES}m`)
    .sign(secretBytes(ctx.config.SESSION_JWT_SECRET));
}

export async function verifySession(ctx: Pick<AppContext, "config" | "db">, token: string): Promise<Session> {
  let payload: SessionClaims;
  try {
    const res = await jwtVerify(token, secretBytes(ctx.config.SESSION_JWT_SECRET), { audience: "vajra-gateway", issuer: ctx.config.ISSUER_DID });
    payload = { sub: res.payload.sub!, uid: res.payload.uid as string, role: res.payload.role as Role, sv: res.payload.sv as number, dev: res.payload.dev as string };
  } catch {
    throw ApiError.unauthorized("session_invalid", "Your session is invalid or has expired. Verify your identity again.");
  }
  const user = (await ctx.db.select().from(users).where(eq(users.id, payload.uid)).limit(1))[0];
  if (!user) throw ApiError.unauthorized("session_invalid", "Unknown identity.");
  const fresh = user.sessionVersion === payload.sv;
  // A stale session is only tolerated for a revoked identity, so the decision trace can say why.
  if (!fresh && user.status !== "revoked") throw ApiError.unauthorized("session_locked", "This session was locked. Verify your identity again.");
  const device = (await ctx.db.select().from(devices).where(eq(devices.id, payload.dev)).limit(1))[0] ?? null;
  return { claims: payload, user, device, fresh };
}

export function requireActive(session: Session): void {
  if (session.user.status !== "active" || !session.fresh)
    throw ApiError.forbidden("identity_revoked", "This identity has been revoked.");
}

export function requireRole(session: Session, ...roles: Role[]): void {
  requireActive(session);
  if (!roles.includes(session.user.role as Role)) throw ApiError.forbidden("role_forbids", `This action needs one of: ${roles.join(", ")}.`);
}
