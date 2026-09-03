import { and, eq } from "drizzle-orm";
import type { OnboardCompleteBody, OnboardCompleteResponse, Role } from "@vajra/contracts";
import { credentials, devices, livenessAttestations, users, type UserBaseline } from "../../db/schema";
import { withTx, type AppContext } from "../../context";
import { didKeyFromJwk, ed25519, publicKeyFromJwk, sha256Hex } from "../../lib/crypto";
import { ApiError } from "../../lib/errors";
import { appendAudit } from "../audit/service";
import { enqueueLedger } from "../ledger/outbox";
import { bumpDeviceTrust, bumpIdentityTrust } from "../trust/service";
import { livenessEvidence } from "./attestation";
import { consumeNonce, createNonce } from "./nonces";
import { signSession, type DeviceRow, type UserRow } from "./session";
import { issueIdentityCredential } from "./vc";

export const DEFAULT_BASELINE: UserBaseline = { hours: [9, 18], homeCity: "Bengaluru", homeGeo: { lat: 12.9716, lng: 77.5946 }, dailyAssets: 5 };

export async function startOnboarding(ctx: Pick<AppContext, "db">) {
  return createNonce(ctx.db, "onboard", null, null);
}

export function publicUser(u: UserRow) {
  return { id: u.id, did: u.did, displayName: u.displayName, role: u.role as Role, status: u.status as "active" | "suspended" | "revoked", identityTrust: u.identityTrust, createdAt: u.createdAt.toISOString() };
}

/**
 * Completes enrolment (or, for a DID we already know, signs the returning person in on this device).
 * The attestation is a signature over the single-use nonce with the browser-held DID key.
 */
export async function completeOnboarding(ctx: AppContext, body: OnboardCompleteBody, ip: string | null): Promise<OnboardCompleteResponse> {
  let derived: string;
  try {
    derived = didKeyFromJwk(body.publicKeyJwk);
  } catch {
    throw ApiError.badRequest("public_key_invalid", "The public key must be an Ed25519 OKP JWK.");
  }
  if (derived !== body.did) throw ApiError.badRequest("did_mismatch", "The DID does not match the public key.");

  await consumeNonce(ctx.db, body.nonce, "onboard", null);
  const ok = ed25519.verify(publicKeyFromJwk(body.publicKeyJwk), body.nonce, body.signature);
  if (!ok) throw ApiError.badRequest("attestation_invalid", "The liveness attestation signature did not verify.");

  const existing = (await ctx.db.select().from(users).where(eq(users.did, body.did)).limit(1))[0];
  if (existing) return signInExisting(ctx, existing, body, ip);

  const role: Role = ctx.config.DEMO_MODE && body.role ? body.role : "engineer";
  const result = await withTx(ctx.db, async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        did: body.did,
        displayName: body.displayName,
        role,
        publicKeyJwk: body.publicKeyJwk,
        baseline: DEFAULT_BASELINE,
        identityTrust: 60,
        livenessMode: body.livenessMode,
      })
      .returning();
    const [device] = await tx
      .insert(devices)
      .values({ userId: user!.id, fingerprintHash: body.deviceFingerprintHash, deviceTrust: 40, trusted: false, lastIp: ip })
      .returning();
    await bumpIdentityTrust(tx, user!, "onboarded", null);
    await bumpDeviceTrust(tx, device!, "first_seen", null);
    const attestationHash = sha256Hex(`${user!.did}|onboard||${body.nonce}|${body.signature}`);
    await tx.insert(livenessAttestations).values({
      userId: user!.id,
      nonce: body.nonce,
      purpose: "onboard",
      refId: null,
      signature: body.signature,
      attestationHash,
      mode: body.livenessMode,
      verified: true,
      deviceId: device!.id,
    });
    const { vcJwt, vcHash } = await issueIdentityCredential(ctx, user!, body.livenessMode);
    const [cred] = await tx.insert(credentials).values({ userId: user!.id, vcJwt, vcHash }).returning();
    await enqueueLedger(tx, {
      contract: "DIDRegistry",
      fn: "RegisterDID",
      args: [user!.did, sha256Hex(body.publicKeyJwk.x ?? ""), vcHash],
      refTable: "credentials",
      refId: cred!.id,
    });
    await appendAudit(
      { db: tx },
      {
        eventType: "identity.onboarded",
        actorDid: user!.did,
        payload: { role, ...livenessEvidence(body), deviceId: device!.id, vcHash, attestationHash, biometricBytesStored: 0 },
      },
      tx,
    );
    return { user: user!, device: device!, vcJwt };
  });

  const sessionJwt = await signSession(ctx, result.user, result.device.id);
  return {
    user: publicUser(result.user),
    vcJwt: result.vcJwt,
    sessionJwt,
    device: { id: result.device.id, deviceTrust: result.device.deviceTrust, trusted: result.device.trusted },
  };
}

async function signInExisting(ctx: AppContext, user: UserRow, body: OnboardCompleteBody, ip: string | null): Promise<OnboardCompleteResponse> {
  if (user.status === "revoked") throw ApiError.forbidden("identity_revoked", "This identity has been revoked.");
  let device: DeviceRow | undefined = (
    await ctx.db.select().from(devices).where(and(eq(devices.userId, user.id), eq(devices.fingerprintHash, body.deviceFingerprintHash))).limit(1)
  )[0];
  await withTx(ctx.db, async (tx) => {
    if (!device) {
      device = (await tx.insert(devices).values({ userId: user.id, fingerprintHash: body.deviceFingerprintHash, deviceTrust: 40, trusted: false, lastIp: ip }).returning())[0]!;
      await bumpDeviceTrust(tx, device, "first_seen", null);
      await bumpIdentityTrust(tx, user, "new_device", null);
    } else {
      await tx.update(devices).set({ lastSeen: new Date(), lastIp: ip }).where(eq(devices.id, device.id));
    }
    await bumpIdentityTrust(tx, user, "liveness_success", null);
    await tx.insert(livenessAttestations).values({
      userId: user.id,
      nonce: body.nonce,
      purpose: "onboard",
      refId: null,
      signature: body.signature,
      attestationHash: sha256Hex(`${user.did}|onboard||${body.nonce}|${body.signature}`),
      mode: body.livenessMode,
      verified: true,
      deviceId: device!.id,
    });
    await appendAudit({ db: tx }, { eventType: "identity.signed_in", actorDid: user.did, payload: { deviceId: device!.id, ...livenessEvidence(body) } }, tx);
  });
  const cred = (await ctx.db.select().from(credentials).where(eq(credentials.userId, user.id)).limit(1))[0];
  const sessionJwt = await signSession(ctx, user, device!.id);
  return {
    user: publicUser(user),
    vcJwt: cred?.vcJwt ?? "",
    sessionJwt,
    device: { id: device!.id, deviceTrust: device!.deviceTrust, trusted: device!.trusted },
  };
}
