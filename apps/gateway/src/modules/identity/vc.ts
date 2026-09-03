import { SignJWT } from "jose";
import type { AppContext } from "../../context";
import { sha256Hex } from "../../lib/crypto";
import type { UserRow } from "./session";

/** A W3C Verifiable Credential in JWT form, signed EdDSA by the platform issuer. */
export async function issueIdentityCredential(ctx: Pick<AppContext, "keys">, user: UserRow, livenessMode: string): Promise<{ vcJwt: string; vcHash: string }> {
  const now = new Date();
  const vc = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "VajraIdentityCredential"],
    issuer: ctx.keys.issuerDid,
    validFrom: now.toISOString(),
    credentialSubject: {
      id: user.did,
      role: user.role,
      org: "The CodePool",
      livenessVerified: true,
      livenessMode,
      enrolledAt: user.createdAt.toISOString(),
    },
  };
  const vcJwt = await new SignJWT({ vc })
    .setProtectedHeader({ alg: "EdDSA", typ: "vc+jwt" })
    .setIssuer(ctx.keys.issuerDid)
    .setSubject(user.did)
    .setJti(`urn:vajra:vc:${user.id}`)
    .setIssuedAt()
    .sign(ctx.keys.privateKey);
  return { vcJwt, vcHash: sha256Hex(vcJwt) };
}
