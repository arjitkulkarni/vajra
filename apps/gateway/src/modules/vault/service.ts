/**
 * The vault: encrypt → pin → mint. Files never touch the ledger; their SHA-256 does.
 *   plaintext ─sha256→ sha256_plain
 *   AES-256-GCM(DEK) ─→ ciphertext ─sha256→ sha256_cipher ─→ storage (CIDv1)
 *   DEK wrapped by KEK (env in dev, KMS on the roadmap)
 * Downloads exist only behind an approved, single-use access request, and ship a signed manifest.
 */
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { AssetUploadMeta, Sensitivity } from "@vajra/contracts";
import { accessRequests, assets, assetVersions, grants, users } from "../../db/schema";
import { withTx, type AppContext } from "../../context";
import { aesGcmDecrypt, aesGcmEncrypt, ed25519, hashJson, newDek, randomHex, sha256Hex, unwrapDek, wrapDek } from "../../lib/crypto";
import { ApiError } from "../../lib/errors";
import { appendAudit } from "../audit/service";
import { enqueueLedger } from "../ledger/outbox";
import type { Session } from "../identity/session";
import { recomputeAssetTrust } from "../trust/service";

export type AssetRow = typeof assets.$inferSelect;
export type AssetVersionRow = typeof assetVersions.$inferSelect;

const SENS_RANK: Record<Sensitivity, number> = { low: 0, medium: 1, high: 2 };
const maxSensitivity = (a: Sensitivity, b: Sensitivity): Sensitivity => (SENS_RANK[a] >= SENS_RANK[b] ? a : b);

export function makeAssetUid(name: string): string {
  const slug = name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 22);
  return `${slug || "ASSET"}-${randomHex(2).toUpperCase()}`;
}

export interface UploadFile {
  buffer: Buffer;
  filename: string;
  mime: string;
}

export interface UploadResult {
  asset: AssetRow;
  version: AssetVersionRow;
  derivativeStatus: "root" | "authorised" | "unauthorised";
}

export async function uploadAsset(ctx: AppContext, session: Session, file: UploadFile, meta: AssetUploadMeta): Promise<UploadResult> {
  if (session.user.role === "auditor") throw ApiError.forbidden("role_forbids", "Auditors read evidence; they do not create assets.");
  if (file.buffer.length === 0) throw ApiError.badRequest("empty_file", "The file is empty.");
  if (file.buffer.length > 25 * 1024 * 1024) throw ApiError.badRequest("file_too_large", "Files are capped at 25 MB in the pilot.");

  const sha256Plain = sha256Hex(file.buffer);

  // Copy doesn't mean escape: identical bytes resolve to the asset they already are.
  const duplicate = (await ctx.db.select().from(assetVersions).where(eq(assetVersions.sha256Plain, sha256Plain)).limit(1))[0];
  if (duplicate) {
    const original = (await ctx.db.select().from(assets).where(eq(assets.id, duplicate.assetId)).limit(1))[0];
    if (original) {
      throw ApiError.conflict("duplicate_content", `These bytes are already ${original.assetUid} v${duplicate.version}.`).withDetails({
        assetUid: original.assetUid,
        name: original.name,
        version: duplicate.version,
        ownerDid: original.ownerDid,
        sensitivity: original.sensitivity,
        sha256: sha256Plain,
      });
    }
  }

  let sensitivity: Sensitivity = meta.sensitivity;
  let parent: AssetRow | null = null;
  let derivativeStatus: UploadResult["derivativeStatus"] = "root";
  if (meta.parentUid) {
    parent = (await ctx.db.select().from(assets).where(eq(assets.assetUid, meta.parentUid)).limit(1))[0] ?? null;
    if (!parent) throw ApiError.notFound("parent_not_found", "The parent asset does not exist.");
    sensitivity = maxSensitivity(meta.sensitivity, parent.sensitivity as Sensitivity);
    const hasGrant = (
      await ctx.db
        .select()
        .from(grants)
        .where(and(eq(grants.assetId, parent.id), eq(grants.userId, session.user.id), isNull(grants.revokedAt)))
        .limit(1)
    )[0];
    derivativeStatus = parent.ownerDid === session.user.did || session.user.role === "admin" || !!hasGrant ? "authorised" : "unauthorised";
  }

  const assetUid = makeAssetUid(meta.name);
  const version = 1;
  const aad = `${assetUid}|${version}`;
  const dek = newDek();
  const sealed = aesGcmEncrypt(dek, file.buffer, aad);
  const sha256Cipher = sha256Hex(sealed.ciphertext);
  const { cid } = await ctx.storage.put(sealed.ciphertext);
  const dekWrapped = wrapDek(ctx.kek, dek, aad);
  const passportMeta = { originalFilename: file.filename, ...(meta.passportMeta ?? {}) };
  const lineageType = parent ? (meta.lineageType && meta.lineageType !== "root" ? meta.lineageType : "derivative") : "root";

  const result = await withTx(ctx.db, async (tx) => {
    const [asset] = await tx
      .insert(assets)
      .values({
        assetUid,
        name: meta.name,
        mime: file.mime,
        class: meta.class,
        sensitivity,
        ownerDid: session.user.did,
        currentVersion: version,
        parentAssetId: parent?.id ?? null,
        lineageType,
        passportMeta: derivativeStatus === "root" ? passportMeta : { ...passportMeta, derivativeStatus },
        createdBy: session.user.did,
      })
      .returning();
    const [ver] = await tx
      .insert(assetVersions)
      .values({
        assetId: asset!.id,
        version,
        sha256Plain,
        sha256Cipher,
        cid,
        sizeBytes: file.buffer.length,
        dekWrapped,
        iv: sealed.iv,
        parentSha256: parent ? (await latestVersion(ctx, parent.id))?.sha256Plain ?? null : null,
        createdBy: session.user.did,
      })
      .returning();
    await enqueueLedger(tx, {
      contract: "AssetPassport",
      fn: "Mint",
      args: [assetUid, session.user.did, sha256Plain, cid, meta.class, sensitivity, hashJson(passportMeta)],
      refTable: "asset_versions",
      refId: ver!.id,
    });
    if (parent) await enqueueLedger(tx, { contract: "AssetPassport", fn: "LinkDerivative", args: [assetUid, parent.assetUid, lineageType] });
    await appendAudit(
      { db: tx },
      {
        eventType: "asset.minted",
        actorDid: session.user.did,
        assetUid,
        payload: { name: meta.name, class: meta.class, sensitivity, sha256: sha256Plain, cid, sizeBytes: file.buffer.length, parentUid: parent?.assetUid ?? null, lineageType, derivativeStatus },
      },
      tx,
    );
    if (derivativeStatus === "unauthorised") {
      await appendAudit(
        { db: tx },
        { eventType: "provenance.unauthorised_derivative", actorDid: session.user.did, assetUid, payload: { parentUid: parent!.assetUid, uploaderDid: session.user.did, parentOwnerDid: parent!.ownerDid } },
        tx,
      );
    }
    return { asset: asset!, version: ver! };
  });
  await recomputeAssetTrust(ctx, result.asset.id);
  const refreshed = (await ctx.db.select().from(assets).where(eq(assets.id, result.asset.id)).limit(1))[0]!;
  return { asset: refreshed, version: result.version, derivativeStatus };
}

export async function addVersion(ctx: AppContext, session: Session, assetUid: string, file: UploadFile): Promise<UploadResult> {
  const asset = (await ctx.db.select().from(assets).where(eq(assets.assetUid, assetUid)).limit(1))[0];
  if (!asset) throw ApiError.notFound("asset_not_found");
  if (asset.ownerDid !== session.user.did && session.user.role !== "admin") throw ApiError.forbidden("not_owner", "Only the owner can add a version.");
  const sha256Plain = sha256Hex(file.buffer);
  const version = asset.currentVersion + 1;
  const aad = `${assetUid}|${version}`;
  const dek = newDek();
  const sealed = aesGcmEncrypt(dek, file.buffer, aad);
  const sha256Cipher = sha256Hex(sealed.ciphertext);
  const { cid } = await ctx.storage.put(sealed.ciphertext);
  const prev = await latestVersion(ctx, asset.id);
  const result = await withTx(ctx.db, async (tx) => {
    const [ver] = await tx
      .insert(assetVersions)
      .values({ assetId: asset.id, version, sha256Plain, sha256Cipher, cid, sizeBytes: file.buffer.length, dekWrapped: wrapDek(ctx.kek, dek, aad), iv: sealed.iv, parentSha256: prev?.sha256Plain ?? null, createdBy: session.user.did })
      .returning();
    await tx.update(assets).set({ currentVersion: version }).where(eq(assets.id, asset.id));
    await enqueueLedger(tx, { contract: "AssetPassport", fn: "AddVersion", args: [assetUid, String(version), sha256Plain, cid], refTable: "asset_versions", refId: ver!.id });
    await appendAudit({ db: tx }, { eventType: "asset.version_added", actorDid: session.user.did, assetUid, payload: { version, sha256: sha256Plain, cid, sizeBytes: file.buffer.length } }, tx);
    return ver!;
  });
  await recomputeAssetTrust(ctx, asset.id);
  const refreshed = (await ctx.db.select().from(assets).where(eq(assets.id, asset.id)).limit(1))[0]!;
  return { asset: refreshed, version: result, derivativeStatus: "root" };
}

export async function latestVersion(ctx: Pick<AppContext, "db">, assetId: string): Promise<AssetVersionRow | null> {
  return (await ctx.db.select().from(assetVersions).where(eq(assetVersions.assetId, assetId)).orderBy(desc(assetVersions.version)).limit(1))[0] ?? null;
}

export interface ContentDelivery {
  plaintext: Buffer;
  asset: AssetRow;
  version: AssetVersionRow;
  manifest: Record<string, unknown>;
}

/** Only an approved, unused, unexpired access request opens the door to the bytes. */
export async function deliverContent(ctx: AppContext, assetUid: string, token: string): Promise<ContentDelivery> {
  const now = new Date();
  const req = (
    await ctx.db
      .select()
      .from(accessRequests)
      .where(and(eq(accessRequests.contentToken, token), eq(accessRequests.assetUid, assetUid), eq(accessRequests.contentUsed, false), gt(accessRequests.expiresAt, now)))
      .limit(1)
  )[0];
  if (!req || req.decision !== "ALLOW") throw ApiError.forbidden("content_token_invalid", "This download link is invalid, used, or expired.");
  const asset = (await ctx.db.select().from(assets).where(eq(assets.assetUid, assetUid)).limit(1))[0];
  if (!asset) throw ApiError.notFound("asset_not_found");
  const version = await latestVersion(ctx, asset.id);
  if (!version) throw ApiError.notFound("version_not_found");
  const ciphertext = await ctx.storage.get(version.cid);
  const aad = `${asset.assetUid}|${version.version}`;
  const dek = unwrapDek(ctx.kek, version.dekWrapped, aad);
  const plaintext = aesGcmDecrypt(dek, { ciphertext, iv: version.iv }, aad);
  await ctx.db.update(accessRequests).set({ contentUsed: true }).where(eq(accessRequests.id, req.id));
  await appendAudit(ctx, { eventType: "asset.content_delivered", actorDid: req.actorDid, assetUid, requestId: req.id, payload: { version: version.version, sha256: version.sha256Plain, action: req.action } });

  const owner = (await ctx.db.select().from(users).where(eq(users.did, asset.ownerDid)).limit(1))[0];
  const manifestBody = {
    vajra: "asset-manifest/1",
    assetUid: asset.assetUid,
    name: asset.name,
    version: version.version,
    sha256: version.sha256Plain,
    cid: version.cid,
    owner: asset.ownerDid,
    ownerName: owner?.displayName ?? null,
    classification: asset.sensitivity,
    class: asset.class,
    policyVersion: req.policyVersionId,
    requestId: req.id,
    deliveredTo: req.actorDid,
    issuedAt: now.toISOString(),
    issuer: ctx.keys.issuerDid,
  };
  const manifest = { ...manifestBody, signature: ed25519.sign(ctx.keys.privateKey, hashJson(manifestBody)) };
  return { plaintext, asset, version, manifest };
}
