/**
 * Browser-held decentralised identity.
 *
 * The Ed25519 key pair is generated with WebCrypto and the private key is stored in IndexedDB as a
 * non-extractable CryptoKey — it cannot be read back out by any script, including this one. Signing
 * happens here; the server only ever receives the public key, a signature and a nonce.
 */
"use client";

import { ADAFACE_DIM } from "./adaface-core";

const DB_NAME = "vajra";
const STORE = "identity";
const KEY_ID = "did-key";

interface StoredIdentity {
  id: string;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  did: string;
  descriptor?: number[];
  /** How many frames went into the enrolment template. More samples, tighter match distances. */
  descriptorSamples?: number;
  /** Which net produced it. Absent on templates enrolled before AdaFace, which are face-api's. */
  descriptorModel?: EmbeddingModel;
  createdAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(value: StoredIdentity): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function get(): Promise<StoredIdentity | null> {
  const db = await openDb();
  const result = await new Promise<StoredIdentity | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY_ID);
    req.onsuccess = () => resolve((req.result as StoredIdentity) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

export async function clearIdentity(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

// ─── base58btc + multicodec, so the DID matches the gateway's derivation ─────

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
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

export function b64uToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64u(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function didFromPublicJwk(jwk: JsonWebKey): string {
  const raw = b64uToBytes(jwk.x!);
  const prefixed = new Uint8Array(raw.length + 2);
  prefixed[0] = 0xed;
  prefixed[1] = 0x01;
  prefixed.set(raw, 2);
  return `did:key:z${base58Encode(prefixed)}`;
}

// ─── public API ──────────────────────────────────────────────────────────────

export interface Identity {
  did: string;
  publicKeyJwk: JsonWebKey;
  createdAt: string;
  hasDescriptor: boolean;
}

export async function loadIdentity(): Promise<Identity | null> {
  const stored = await get().catch(() => null);
  if (!stored) return null;
  return { did: stored.did, publicKeyJwk: stored.publicKeyJwk, createdAt: stored.createdAt, hasDescriptor: !!stored.descriptor };
}

export async function createIdentity(): Promise<Identity> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const did = didFromPublicJwk(publicKeyJwk);
  const identity: StoredIdentity = { id: KEY_ID, privateKey: pair.privateKey, publicKeyJwk, did, createdAt: new Date().toISOString() };
  await put(identity);
  return { did, publicKeyJwk, createdAt: identity.createdAt, hasDescriptor: false };
}

export async function getOrCreateIdentity(): Promise<Identity> {
  return (await loadIdentity()) ?? (await createIdentity());
}

/** Sign a server nonce with the browser-held private key. This is the whole attestation. */
export async function signNonce(nonce: string): Promise<string> {
  const stored = await get();
  if (!stored) throw new Error("No identity in this browser. Verify your identity first.");
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, stored.privateKey, new TextEncoder().encode(nonce));
  return bytesToB64u(new Uint8Array(sig));
}

/**
 * The face template this browser matches against, in its own storage.
 *
 * It is the mean of several frames rather than a single snapshot, which keeps later match scores
 * tight enough to run a stricter threshold than either model's stock one. This copy is what a
 * step-up scores against without asking the server anything; the gateway holds its own copy from
 * enrolment, which is what a login is judged against.
 *
 * The model is stored alongside the numbers because the two embedding spaces have nothing to say to
 * each other: a 128-d face-api descriptor and a 512-d AdaFace embedding are not comparable, and a
 * browser enrolled before the AdaFace weights landed must be re-enrolled rather than mis-scored.
 */
export async function saveDescriptor(descriptor: Float32Array, samples = 1, model: EmbeddingModel = modelOf(descriptor)): Promise<void> {
  const stored = await get();
  if (!stored) throw new Error("No identity to attach a descriptor to.");
  await put({ ...stored, descriptor: Array.from(descriptor), descriptorSamples: samples, descriptorModel: model });
}

export async function getDescriptor(): Promise<Float32Array | null> {
  const stored = await get().catch(() => null);
  return stored?.descriptor ? new Float32Array(stored.descriptor) : null;
}

export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(sum);
}

/** Cosine similarity. Both AdaFace embeddings are unit vectors, so this is just their dot product. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

// ─── the two embedding spaces ────────────────────────────────────────────────

/**
 * Which net produced a template. AdaFace (512-d, cosine) is the one VAJRA verifies against;
 * face-api (128-d, euclidean) survives only so a machine without the AdaFace weights still works
 * and so templates enrolled before the switch can be recognised for what they are.
 */
export type EmbeddingModel = "adaface" | "faceapi";

export { ADAFACE_DIM } from "./adaface-core";
export const FACEAPI_DIM = 128;

/** The dimension is the discriminator: 512 is AdaFace, 128 is face-api. Nothing else is stored. */
export function modelOf(v: Float32Array | number[]): EmbeddingModel {
  return v.length === ADAFACE_DIM ? "adaface" : "faceapi";
}

/**
 * AdaFace's operating point: the cosine similarity two crops of one person clear and two people do
 * not. IR-50/MS1MV2 puts genuine pairs well above 0.4 and impostor pairs below 0.2 on the kind of
 * imagery this handles, so 0.32 sits in the gap with room on both sides — and the enrolment
 * template being a five-frame mean rather than one snapshot is what buys that room.
 */
export const ADAFACE_SIMILARITY_THRESHOLD = 0.32;

/** face-api's threshold, stricter than its stock 0.6, which the averaged template earns us. */
export const FACE_MATCH_THRESHOLD = 0.55;

/**
 * A face comparison, in whichever space the two templates live in.
 *
 * `distance` is what the UI shows and what an auditor can recompute: euclidean for face-api,
 * `1 − cosine` for AdaFace. `score` is the 0-100 confidence the gateway records.
 */
export interface FaceScore {
  model: EmbeddingModel;
  /** Cosine similarity, for AdaFace. Null in the face-api space, which is not an angle. */
  similarity: number | null;
  distance: number;
  score: number;
  ok: boolean;
}

/**
 * Confidence, 0-100, calibrated so that 45 means "exactly at this model's operating point".
 *
 * That is the whole contract with the gateway: `FACE_MATCH_MIN_SCORE` defaults to 45 and it keeps
 * meaning the same thing whichever net produced the numbers, so an operator who raises the floor to
 * 60 gets a stricter check rather than an accidentally different one.
 *
 * For face-api the mapping is the plainest one that inverts — `(1 − distance) × 100` — and 0.55
 * lands on 45 by construction, which is why that formula was chosen in the first place. For AdaFace
 * it is piecewise linear in cosine similarity, hinged at 0.32 so the same 45 falls on the same
 * decision, with 1.0 at the top and 0 at no similarity at all.
 */
export function confidenceFromSimilarity(similarity: number): number {
  const s = Math.max(0, Math.min(1, similarity));
  const t = ADAFACE_SIMILARITY_THRESHOLD;
  const raw = s <= t ? (45 * s) / t : 45 + (55 * (s - t)) / (1 - t);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export const confidenceFromDistance = (distance: number): number => Math.max(0, Math.min(100, Math.round((1 - distance) * 100)));
export const distanceFromConfidence = (score: number): number => 1 - score / 100;

/**
 * Score a probe against a reference. Returns null when the two are not in the same space — a 128-d
 * template against a 512-d probe is not a low score, it is not a comparison at all, and silently
 * treating it as one is exactly the bug this guard exists to prevent.
 */
export function scoreMatch(reference: Float32Array, probe: Float32Array): FaceScore | null {
  if (reference.length !== probe.length) return null;
  const model = modelOf(probe);
  if (model === "adaface") {
    const similarity = cosineSimilarity(reference, probe);
    return {
      model,
      similarity,
      distance: 1 - similarity,
      score: confidenceFromSimilarity(similarity),
      ok: similarity >= ADAFACE_SIMILARITY_THRESHOLD,
    };
  }
  const distance = euclideanDistance(reference, probe);
  return { model, similarity: null, distance, score: confidenceFromDistance(distance), ok: distance <= FACE_MATCH_THRESHOLD };
}

export interface FaceMatch {
  /** False when this browser has no template — the person enrolled before the models were in place. */
  enrolled: boolean;
  distance: number | null;
  ok: boolean;
  /** Set when the stored template came from the other net and so cannot be compared at all. */
  mismatchedModel?: boolean;
}

/**
 * Match a probe against the template enrolled here. Runs here; nothing is ever sent.
 *
 * `ok` is false when the two are in different embedding spaces, and `mismatchedModel` says why. It
 * is tempting to treat that as "no template, carry on" — it is a stale enrolment rather than an
 * impostor — but a face check that cannot run is not a face check that passed, and a caller reading
 * only `ok` would otherwise wave a step-up through on nothing at all. The caller is told what
 * happened and can offer a re-enrolment; it may not silently continue.
 */
export async function matchFace(probe: Float32Array): Promise<FaceMatch> {
  const enrolled = await getDescriptor();
  if (!enrolled) return { enrolled: false, distance: null, ok: true };
  const scored = scoreMatch(enrolled, probe);
  if (!scored) return { enrolled: true, distance: null, ok: false, mismatchedModel: true };
  return { enrolled: true, distance: scored.distance, ok: scored.ok };
}

export function supportsEd25519(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

/** A stable, non-identifying device fingerprint. Hashed, so the raw signals never leave the browser. */
export async function deviceFingerprint(): Promise<string> {
  const parts = [
    navigator.userAgent,
    navigator.language,
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth),
    String(new Date().getTimezoneOffset()),
    String(navigator.hardwareConcurrency ?? 0),
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
