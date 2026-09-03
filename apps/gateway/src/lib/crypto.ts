/**
 * Cryptographic primitives for the gateway. Node's built-in crypto only — no native builds.
 *
 *  • sha256 / canonical JSON hashing (the audit hash chain, proof bodies, policy specs)
 *  • did:key ⇄ Ed25519 public key (multicodec 0xed01 + base58btc)
 *  • Ed25519 sign/verify (attestations, Proof-of-Action, manifests)
 *  • AES-256-GCM envelope encryption (asset vault: per-version DEK wrapped by the KEK)
 *  • CIDv1 (raw, sha2-256) so the local store speaks the same addresses as IPFS
 */
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, randomBytes, sign as nodeSign, verify as nodeVerify, type KeyObject } from "node:crypto";

// ─── Encoding ────────────────────────────────────────────────────────────────

export const b64u = {
  encode: (b: Uint8Array | Buffer): string => Buffer.from(b).toString("base64url"),
  decode: (s: string): Buffer => Buffer.from(s, "base64url"),
};

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]!];
  return out;
}

export function base58Decode(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const bytes: number[] = [];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    if (carry < 0) throw new Error("invalid base58 character");
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i]!;
  return out;
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export function base32Lower(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

// ─── Hashing ─────────────────────────────────────────────────────────────────

export const sha256Hex = (data: string | Uint8Array | Buffer): string => createHash("sha256").update(data).digest("hex");
export const sha256Bytes = (data: string | Uint8Array | Buffer): Buffer => createHash("sha256").update(data).digest();

/** Deterministic JSON: sorted keys, no whitespace, undefined dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      if (o[k] !== undefined) out[k] = sortValue(o[k]);
    }
    return out;
  }
  if (v instanceof Date) return v.toISOString();
  return v;
}
export const hashJson = (value: unknown): string => sha256Hex(canonicalJson(value));

/** CIDv1, raw codec (0x55), sha2-256 multihash, base32 — identical to what IPFS assigns a raw block. */
export function cidV1Raw(digest: Buffer): string {
  const prefix = Buffer.from([0x01, 0x55, 0x12, 0x20]);
  return "b" + base32Lower(Buffer.concat([prefix, digest]));
}

// ─── Ed25519 & did:key ───────────────────────────────────────────────────────

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const MULTICODEC_ED25519_PUB = Buffer.from([0xed, 0x01]);

export function privateKeyFromSeed(seed32: Buffer): KeyObject {
  if (seed32.length !== 32) throw new Error("seed must be 32 bytes");
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed32]), format: "der", type: "pkcs8" });
}

/** Derive a stable Ed25519 key pair from any secret string (dev-friendly; use KMS in production). */
export function keyPairFromSecret(secret: string): { privateKey: KeyObject; publicKey: KeyObject; publicRaw: Buffer } {
  const privateKey = privateKeyFromSeed(sha256Bytes(`vajra-ed25519:${secret}`));
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey, publicRaw: publicRawFromKey(publicKey) };
}

export function publicRawFromKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) throw new Error("not an OKP public key");
  return b64u.decode(jwk.x);
}

export function publicKeyFromRaw(raw: Buffer): KeyObject {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: b64u.encode(raw) }, format: "jwk" });
}

export function publicKeyFromJwk(jwk: Record<string, string>): KeyObject {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) throw new Error("expected an Ed25519 OKP JWK");
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" });
}

export function didKeyFromRaw(raw: Buffer): string {
  return "did:key:z" + base58Encode(Buffer.concat([MULTICODEC_ED25519_PUB, raw]));
}

export function rawFromDidKey(did: string): Buffer {
  if (!did.startsWith("did:key:z")) throw new Error("only did:key with base58btc is supported");
  const bytes = Buffer.from(base58Decode(did.slice("did:key:z".length)));
  if (bytes[0] !== 0xed || bytes[1] !== 0x01 || bytes.length !== 34) throw new Error("not an Ed25519 did:key");
  return bytes.subarray(2);
}

export function didKeyFromJwk(jwk: Record<string, string>): string {
  return didKeyFromRaw(publicRawFromKey(publicKeyFromJwk(jwk)));
}

export const ed25519 = {
  sign: (privateKey: KeyObject, data: Buffer | string): string => b64u.encode(nodeSign(null, Buffer.from(data), privateKey)),
  verify: (publicKey: KeyObject, data: Buffer | string, signatureB64u: string): boolean => {
    try {
      return nodeVerify(null, Buffer.from(data), publicKey, b64u.decode(signatureB64u));
    } catch {
      return false;
    }
  },
};

// ─── AES-256-GCM envelope ────────────────────────────────────────────────────

export interface Sealed {
  ciphertext: Buffer;
  iv: string; // base64url
}

export function aesGcmEncrypt(key: Buffer, plaintext: Buffer, aad?: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext: ct, iv: b64u.encode(iv) };
}

export function aesGcmDecrypt(key: Buffer, sealed: Sealed, aad?: string): Buffer {
  const iv = b64u.decode(sealed.iv);
  const tag = sealed.ciphertext.subarray(sealed.ciphertext.length - 16);
  const body = sealed.ciphertext.subarray(0, sealed.ciphertext.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export const kekFromSecret = (secret: string): Buffer => sha256Bytes(`vajra-kek:${secret}`);
export const newDek = (): Buffer => randomBytes(32);

/** Wrap a DEK with the KEK; returns `iv.ciphertext` (base64url). */
export function wrapDek(kek: Buffer, dek: Buffer, aad: string): string {
  const s = aesGcmEncrypt(kek, dek, aad);
  return `${s.iv}.${b64u.encode(s.ciphertext)}`;
}
export function unwrapDek(kek: Buffer, wrapped: string, aad: string): Buffer {
  const [iv, ct] = wrapped.split(".");
  if (!iv || !ct) throw new Error("malformed wrapped key");
  return aesGcmDecrypt(kek, { iv, ciphertext: b64u.decode(ct) }, aad);
}

export const randomToken = (bytes = 24): string => b64u.encode(randomBytes(bytes));
export const randomHex = (bytes = 16): string => randomBytes(bytes).toString("hex");
