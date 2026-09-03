/**
 * VAJRA chaincode for Hyperledger Fabric.
 *
 * The contract *logic* lives in `@vajra/chain-logic` and is unit-tested there; this file is the thin
 * Fabric adapter that maps `ctx.stub` onto the `ChainState` interface that logic expects. The gateway's
 * `lite` driver adapts the same logic onto a Postgres block store, so both runtimes are provably
 * executing identical rules — including the two-person rule on high-sensitivity transfers.
 *
 * Only hashes, DIDs, CIDs and decision summaries ever reach world state. Never files, PII or biometrics.
 */
import { Context, Contract, Info, Returns, Transaction } from "fabric-contract-api";
import type { Iterators } from "fabric-shim";
import { AssetPassport, AuditTrail, ChainError, DIDRegistry, IdentityVerification, PolicyRegistry, type ChainState, type HistoryEntry } from "@vajra/chain-logic";

class FabricState implements ChainState {
  readonly txId: string;
  readonly timestamp: string;

  constructor(private readonly ctx: Context) {
    this.txId = ctx.stub.getTxID();
    const ts = ctx.stub.getTxTimestamp();
    this.timestamp = new Date(Number(ts.seconds) * 1000 + Math.round(ts.nanos / 1e6)).toISOString();
  }

  async get<T>(key: string): Promise<T | null> {
    const bytes = await this.ctx.stub.getState(key);
    if (!bytes || bytes.length === 0) return null;
    return JSON.parse(bytes.toString()) as T;
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.ctx.stub.putState(key, Buffer.from(JSON.stringify(value)));
  }

  async history<T>(key: string): Promise<HistoryEntry<T>[]> {
    const iterator: Iterators.HistoryQueryIterator = await this.ctx.stub.getHistoryForKey(key);
    const out: HistoryEntry<T>[] = [];
    for (;;) {
      const res = await iterator.next();
      if (res.value) {
        const v = res.value;
        out.push({
          txId: v.txId,
          block: null,
          timestamp: new Date(Number(v.timestamp.seconds) * 1000 + Math.round(v.timestamp.nanos / 1e6)).toISOString(),
          value: v.isDelete || !v.value?.length ? null : (JSON.parse(Buffer.from(v.value).toString()) as T),
          deleted: !!v.isDelete,
        });
      }
      if (res.done) break;
    }
    await iterator.close();
    return out;
  }
}

/** Chaincode errors must serialise cleanly to the client. */
function wrap(e: unknown): never {
  if (e instanceof ChainError) throw new Error(`${e.code}: ${e.message}`);
  throw e;
}

const json = (v: unknown) => JSON.stringify(v);

@Info({ title: "DIDRegistry", description: "Decentralised identity anchors" })
export class DIDRegistryContract extends Contract {
  constructor() {
    super("DIDRegistry");
  }

  @Transaction()
  @Returns("string")
  async RegisterDID(ctx: Context, did: string, pubKeyHash: string, vcHash: string): Promise<string> {
    try {
      return json(await DIDRegistry.RegisterDID(new FabricState(ctx), did, pubKeyHash, vcHash));
    } catch (e) {
      wrap(e);
    }
  }

  @Transaction()
  @Returns("string")
  async RevokeDID(ctx: Context, did: string, reasonHash: string): Promise<string> {
    try {
      return json(await DIDRegistry.RevokeDID(new FabricState(ctx), did, reasonHash));
    } catch (e) {
      wrap(e);
    }
  }

  @Transaction(false)
  @Returns("string")
  async Get(ctx: Context, did: string): Promise<string> {
    try {
      return json(await DIDRegistry.Get(new FabricState(ctx), did));
    } catch (e) {
      wrap(e);
    }
  }
}

@Info({ title: "AssetPassport", description: "Non-fungible asset records: ownership, versions, lineage" })
export class AssetPassportContract extends Contract {
  constructor() {
    super("AssetPassport");
  }

  @Transaction()
  @Returns("string")
  async Mint(ctx: Context, uid: string, ownerDid: string, sha256: string, cid: string, assetClass: string, sensitivity: string, metaHash: string): Promise<string> {
    try {
      return json(await AssetPassport.Mint(new FabricState(ctx), uid, ownerDid, sha256, cid, assetClass, sensitivity, metaHash));
    } catch (e) {
      wrap(e);
    }
  }

  @Transaction()
  @Returns("string")
  async AddVersion(ctx: Context, uid: string, version: string, sha256: string, cid: string): Promise<string> {
    try {
      return json(await AssetPassport.AddVersion(new FabricState(ctx), uid, version, sha256, cid));
    } catch (e) {
      wrap(e);
    }
  }

  @Transaction()
  @Returns("string")
  async LinkDerivative(ctx: Context, childUid: string, parentUid: string, relation: string): Promise<string> {
    try {
      return json(await AssetPassport.LinkDerivative(new FabricState(ctx), childUid, parentUid, relation));
    } catch (e) {
      wrap(e);
    }
  }

  /** Governance on chain: a high-sensitivity transfer is refused unless a distinct, registered approver signs off. */
  @Transaction()
  @Returns("string")
  async Transfer(ctx: Context, uid: string, fromDid: string, toDid: string, requestId: string, approverDid: string): Promise<string> {
    try {
      return json(await AssetPassport.Transfer(new FabricState(ctx), uid, fromDid, toDid, requestId, approverDid));
    } catch (e) {
      wrap(e);
    }
  }

  @Transaction(false)
  @Returns("string")
  async Get(ctx: Context, uid: string): Promise<string> {
    try {
      return json(await AssetPassport.Get(new FabricState(ctx), uid));
    } catch (e) {
      wrap(e);
    }
  }

  /** The provenance tree, straight out of Fabric's own key history. */
  @Transaction(false)
  @Returns("string")
  async GetHistory(ctx: Context, uid: string): Promise<string> {
    try {
      return json(await AssetPassport.GetHistory(new FabricState(ctx), uid));
    } catch (e) {
      wrap(e);
    }
  }
}

@Info({ title: "PolicyRegistry", description: "Immutable, hash-anchored policy versions" })
export class PolicyRegistryContract extends Contract {
  constructor() {
    super("PolicyRegistry");
  }

  @Transaction()
  @Returns("string")
  async AnchorPolicyVersion(ctx: Context, policyId: string, version: string, specHash: string, activeFrom: string): Promise<string> {
    try {
      return json(await PolicyRegistry.AnchorPolicyVersion(new FabricState(ctx), policyId, version, specHash, activeFrom));
    } catch (e) {
      wrap(e);
    }
  }

  @Transaction()
  @Returns("string")
  async ClosePolicyVersion(ctx: Context, policyId: string, version: string, activeTo: string): Promise<string> {
    try {
      return json(await PolicyRegistry.ClosePolicyVersion(new FabricState(ctx), policyId, version, activeTo));
    } catch (e) {
      wrap(e);
    }
  }

  @Transaction(false)
  @Returns("string")
  async Get(ctx: Context, policyId: string, version: string): Promise<string> {
    try {
      return json(await PolicyRegistry.Get(new FabricState(ctx), policyId, version));
    } catch (e) {
      wrap(e);
    }
  }
}

@Info({ title: "AuditTrail", description: "Hash-chain anchors for audit events and incidents" })
export class AuditTrailContract extends Contract {
  constructor() {
    super("AuditTrail");
  }

  @Transaction()
  @Returns("string")
  async AnchorEvent(ctx: Context, eventId: string, chainHash: string, type: string, summaryHash: string): Promise<string> {
    try {
      return json(await AuditTrail.AnchorEvent(new FabricState(ctx), eventId, chainHash, type, summaryHash));
    } catch (e) {
      wrap(e);
    }
  }

  @Transaction()
  @Returns("string")
  async AnchorIncident(ctx: Context, incidentId: string, chainHash: string, severity: string): Promise<string> {
    try {
      return json(await AuditTrail.AnchorIncident(new FabricState(ctx), incidentId, chainHash, severity));
    } catch (e) {
      wrap(e);
    }
  }

  @Transaction(false)
  @Returns("string")
  async GetEvent(ctx: Context, eventId: string): Promise<string> {
    try {
      return json(await AuditTrail.GetEvent(new FabricState(ctx), eventId));
    } catch (e) {
      wrap(e);
    }
  }

  @Transaction(false)
  @Returns("string")
  async GetIncident(ctx: Context, incidentId: string): Promise<string> {
    try {
      return json(await AuditTrail.GetIncident(new FabricState(ctx), incidentId));
    } catch (e) {
      wrap(e);
    }
  }
}

@Info({ title: "IdentityVerification", description: "Enrolment and face-verification evidence: hashes, content addresses and confidence scores" })
export class IdentityVerificationContract extends Contract {
  constructor() {
    super("IdentityVerification");
  }

  @Transaction()
  @Returns("string")
  async RecordEnrolment(
    ctx: Context,
    did: string,
    employeeIdHash: string,
    idDocSha256: string,
    idDocCid: string,
    faceSha256: string,
    faceCid: string,
    faceMatchScore: string,
    livenessScore: string,
    bundleHash: string,
  ): Promise<string> {
    try {
      return json(
        await IdentityVerification.RecordEnrolment(new FabricState(ctx), did, employeeIdHash, idDocSha256, idDocCid, faceSha256, faceCid, faceMatchScore, livenessScore, bundleHash),
      );
    } catch (e) {
      wrap(e);
    }
  }

  /** Governance on chain: one decision per enrolment, and never by the person enrolling. */
  @Transaction()
  @Returns("string")
  async DecideEnrolment(ctx: Context, did: string, decision: string, adminDid: string, reasonHash: string): Promise<string> {
    try {
      return json(await IdentityVerification.DecideEnrolment(new FabricState(ctx), did, decision, adminDid, reasonHash));
    } catch (e) {
      wrap(e);
    }
  }

  @Transaction()
  @Returns("string")
  async RecordVerification(
    ctx: Context,
    verificationId: string,
    did: string,
    purpose: string,
    faceSha256: string,
    faceCid: string,
    faceMatchScore: string,
    livenessScore: string,
    bundleHash: string,
    passed: string,
  ): Promise<string> {
    try {
      return json(
        await IdentityVerification.RecordVerification(new FabricState(ctx), verificationId, did, purpose, faceSha256, faceCid, faceMatchScore, livenessScore, bundleHash, passed),
      );
    } catch (e) {
      wrap(e);
    }
  }

  @Transaction(false)
  @Returns("string")
  async GetEnrolment(ctx: Context, did: string): Promise<string> {
    try {
      return json(await IdentityVerification.GetEnrolment(new FabricState(ctx), did));
    } catch (e) {
      wrap(e);
    }
  }

  @Transaction(false)
  @Returns("string")
  async GetVerification(ctx: Context, verificationId: string): Promise<string> {
    try {
      return json(await IdentityVerification.GetVerification(new FabricState(ctx), verificationId));
    } catch (e) {
      wrap(e);
    }
  }
}

export const contracts = [DIDRegistryContract, AssetPassportContract, PolicyRegistryContract, AuditTrailContract, IdentityVerificationContract];
