/**
 * @vajra/chain-logic — the smart-contract logic, written once, executed twice:
 *
 *   • inside Hyperledger Fabric via `chaincode/vajra-cc` (fabric-contract-api wraps ctx.stub)
 *   • inside the gateway's `lite` ledger driver (a hash-chained block store in Postgres)
 *
 * Contracts: DIDRegistry · AssetPassport · PolicyRegistry · AuditTrail.
 * Only hashes, DIDs, CIDs and decision summaries ever touch world state — never files, PII or biometrics.
 */

export interface HistoryEntry<T = unknown> {
  txId: string;
  block: number | null;
  timestamp: string;
  value: T | null;
  deleted: boolean;
}

/** The minimal world-state surface both runtimes provide. */
export interface ChainState {
  get<T = unknown>(key: string): Promise<T | null>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  history<T = unknown>(key: string): Promise<HistoryEntry<T>[]>;
  txId: string;
  timestamp: string;
}

export class ChainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ChainError";
  }
}

// ─── Keys ────────────────────────────────────────────────────────────────────

export const keys = {
  did: (did: string) => `did:${did}`,
  asset: (uid: string) => `asset:${uid}`,
  policy: (id: string, version: number) => `policy:${id}:${version}`,
  audit: (eventId: string) => `audit:${eventId}`,
  incident: (incidentId: string) => `incident:${incidentId}`,
  enrolment: (did: string) => `enrol:${did}`,
  verification: (id: string) => `verify:${id}`,
};

// ─── Records ─────────────────────────────────────────────────────────────────

export interface DidRecord {
  did: string;
  pubKeyHash: string;
  vcHash: string;
  status: "active" | "revoked";
  registeredAt: string;
  revokedAt: string | null;
  reasonHash: string | null;
}

export interface AssetRecord {
  uid: string;
  ownerDid: string;
  version: number;
  sha256: string;
  cid: string;
  class: string;
  sensitivity: string;
  metaHash: string;
  mintedAt: string;
  updatedAt: string;
  parentUid: string | null;
  relation: string | null;
  transfers: number;
}

export interface PolicyRecord {
  policyId: string;
  version: number;
  specHash: string;
  activeFrom: string;
  activeTo: string | null;
}

export interface AuditRecord {
  eventId: string;
  chainHash: string;
  type: string;
  summaryHash: string;
  anchoredAt: string;
}

/**
 * What an enrolment leaves on chain. The employee ID is carried as a hash, the ID document and the
 * live capture as their SHA-256 plus the content address of the encrypted blob — never the bytes,
 * never a face descriptor. Scores are integers 0-100 so the record is byte-identical in both runtimes.
 */
export interface EnrolmentRecord {
  did: string;
  employeeIdHash: string;
  idDocSha256: string;
  idDocCid: string;
  faceSha256: string;
  faceCid: string;
  faceMatchScore: number;
  livenessScore: number;
  bundleHash: string;
  status: "pending" | "approved" | "denied";
  submittedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  reasonHash: string | null;
}

/** One face check — the signup capture, and every login capture after it. */
export interface VerificationRecord {
  verificationId: string;
  did: string;
  purpose: "signup" | "login";
  faceSha256: string;
  faceCid: string;
  faceMatchScore: number;
  livenessScore: number;
  bundleHash: string;
  passed: boolean;
  recordedAt: string;
}

export interface IncidentRecord {
  incidentId: string;
  chainHash: string;
  severity: string;
  anchoredAt: string;
}

const need = (v: string | undefined | null, name: string): string => {
  if (!v) throw new ChainError("invalid_argument", `${name} is required`);
  return v;
};

/** Confidence values cross the contract boundary as strings; on chain they are integers 0-100. */
const score = (v: string | undefined | null, name: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new ChainError("invalid_argument", `${name} must be an integer 0-100`);
  return Math.round(n);
};

// ─── DIDRegistry ─────────────────────────────────────────────────────────────

export const DIDRegistry = {
  async RegisterDID(state: ChainState, did: string, pubKeyHash: string, vcHash: string): Promise<DidRecord> {
    need(did, "did");
    need(pubKeyHash, "pubKeyHash");
    const key = keys.did(did);
    const existing = await state.get<DidRecord>(key);
    if (existing && existing.status === "active") throw new ChainError("already_registered", `${did} is already registered`);
    const rec: DidRecord = {
      did,
      pubKeyHash,
      vcHash: vcHash ?? "",
      status: "active",
      registeredAt: state.timestamp,
      revokedAt: null,
      reasonHash: null,
    };
    await state.put(key, rec);
    return rec;
  },

  async RevokeDID(state: ChainState, did: string, reasonHash: string): Promise<DidRecord> {
    const key = keys.did(need(did, "did"));
    const rec = await state.get<DidRecord>(key);
    if (!rec) throw new ChainError("not_found", `${did} is not registered`);
    const next: DidRecord = { ...rec, status: "revoked", revokedAt: state.timestamp, reasonHash: reasonHash ?? null };
    await state.put(key, next);
    return next;
  },

  async Get(state: ChainState, did: string): Promise<DidRecord> {
    const rec = await state.get<DidRecord>(keys.did(need(did, "did")));
    if (!rec) throw new ChainError("not_found", `${did} is not registered`);
    return rec;
  },
};

// ─── AssetPassport ───────────────────────────────────────────────────────────

export const AssetPassport = {
  async Mint(
    state: ChainState,
    uid: string,
    ownerDid: string,
    sha256: string,
    cid: string,
    assetClass: string,
    sensitivity: string,
    metaHash: string,
  ): Promise<AssetRecord> {
    need(uid, "uid");
    need(ownerDid, "ownerDid");
    need(sha256, "sha256");
    const key = keys.asset(uid);
    if (await state.get(key)) throw new ChainError("already_minted", `${uid} already exists`);
    const owner = await state.get<DidRecord>(keys.did(ownerDid));
    if (!owner || owner.status !== "active") throw new ChainError("owner_not_registered", `${ownerDid} is not an active identity`);
    const rec: AssetRecord = {
      uid,
      ownerDid,
      version: 1,
      sha256,
      cid: cid ?? "",
      class: assetClass ?? "document",
      sensitivity: sensitivity ?? "high",
      metaHash: metaHash ?? "",
      mintedAt: state.timestamp,
      updatedAt: state.timestamp,
      parentUid: null,
      relation: null,
      transfers: 0,
    };
    await state.put(key, rec);
    return rec;
  },

  async AddVersion(state: ChainState, uid: string, version: string | number, sha256: string, cid: string): Promise<AssetRecord> {
    const key = keys.asset(need(uid, "uid"));
    const rec = await state.get<AssetRecord>(key);
    if (!rec) throw new ChainError("not_found", `${uid} does not exist`);
    const v = Number(version);
    if (!Number.isInteger(v) || v !== rec.version + 1)
      throw new ChainError("version_gap", `expected version ${rec.version + 1}, got ${version}`);
    const next: AssetRecord = { ...rec, version: v, sha256: need(sha256, "sha256"), cid: cid ?? "", updatedAt: state.timestamp };
    await state.put(key, next);
    return next;
  },

  async LinkDerivative(state: ChainState, childUid: string, parentUid: string, relation: string): Promise<AssetRecord> {
    const child = await state.get<AssetRecord>(keys.asset(need(childUid, "childUid")));
    if (!child) throw new ChainError("not_found", `${childUid} does not exist`);
    const parent = await state.get<AssetRecord>(keys.asset(need(parentUid, "parentUid")));
    if (!parent) throw new ChainError("not_found", `${parentUid} does not exist`);
    const next: AssetRecord = { ...child, parentUid, relation: relation ?? "derivative", updatedAt: state.timestamp };
    await state.put(keys.asset(childUid), next);
    return next;
  },

  /**
   * Governance lives here: on high-sensitivity assets the approver must be a distinct,
   * registered identity — the ledger itself refuses a one-person transfer.
   */
  async Transfer(
    state: ChainState,
    uid: string,
    fromDid: string,
    toDid: string,
    requestId: string,
    approverDid: string,
  ): Promise<AssetRecord> {
    const key = keys.asset(need(uid, "uid"));
    const rec = await state.get<AssetRecord>(key);
    if (!rec) throw new ChainError("not_found", `${uid} does not exist`);
    if (rec.ownerDid !== fromDid) throw new ChainError("not_owner", `${fromDid} does not own ${uid}`);
    need(toDid, "toDid");
    const to = await state.get<DidRecord>(keys.did(toDid));
    if (!to || to.status !== "active") throw new ChainError("recipient_not_registered", `${toDid} is not an active identity`);
    if (rec.sensitivity === "high") {
      if (!approverDid) throw new ChainError("approval_required", "high-sensitivity transfers need an approver");
      if (approverDid === fromDid) throw new ChainError("approver_is_requester", "approver must differ from the requester");
      const approver = await state.get<DidRecord>(keys.did(approverDid));
      if (!approver || approver.status !== "active") throw new ChainError("approver_not_registered", `${approverDid} is not an active identity`);
    }
    const next: AssetRecord = { ...rec, ownerDid: toDid, transfers: rec.transfers + 1, updatedAt: state.timestamp };
    await state.put(key, next);
    return next;
  },

  async Get(state: ChainState, uid: string): Promise<AssetRecord> {
    const rec = await state.get<AssetRecord>(keys.asset(need(uid, "uid")));
    if (!rec) throw new ChainError("not_found", `${uid} does not exist`);
    return rec;
  },

  async GetHistory(state: ChainState, uid: string): Promise<HistoryEntry<AssetRecord>[]> {
    return state.history<AssetRecord>(keys.asset(need(uid, "uid")));
  },
};

// ─── PolicyRegistry ──────────────────────────────────────────────────────────

export const PolicyRegistry = {
  async AnchorPolicyVersion(state: ChainState, policyId: string, version: string | number, specHash: string, activeFrom: string): Promise<PolicyRecord> {
    const v = Number(version);
    const key = keys.policy(need(policyId, "policyId"), v);
    if (await state.get(key)) throw new ChainError("already_anchored", `${policyId} v${v} already anchored`);
    const rec: PolicyRecord = { policyId, version: v, specHash: need(specHash, "specHash"), activeFrom: activeFrom || state.timestamp, activeTo: null };
    await state.put(key, rec);
    return rec;
  },

  async ClosePolicyVersion(state: ChainState, policyId: string, version: string | number, activeTo: string): Promise<PolicyRecord> {
    const key = keys.policy(need(policyId, "policyId"), Number(version));
    const rec = await state.get<PolicyRecord>(key);
    if (!rec) throw new ChainError("not_found", `${policyId} v${version} is not anchored`);
    const next = { ...rec, activeTo: activeTo || state.timestamp };
    await state.put(key, next);
    return next;
  },

  async Get(state: ChainState, policyId: string, version: string | number): Promise<PolicyRecord> {
    const rec = await state.get<PolicyRecord>(keys.policy(need(policyId, "policyId"), Number(version)));
    if (!rec) throw new ChainError("not_found", `${policyId} v${version} is not anchored`);
    return rec;
  },
};

// ─── AuditTrail ──────────────────────────────────────────────────────────────

export const AuditTrail = {
  async AnchorEvent(state: ChainState, eventId: string, chainHash: string, type: string, summaryHash: string): Promise<AuditRecord> {
    const key = keys.audit(need(eventId, "eventId"));
    if (await state.get(key)) throw new ChainError("already_anchored", `${eventId} already anchored`);
    const rec: AuditRecord = { eventId, chainHash: need(chainHash, "chainHash"), type: type ?? "", summaryHash: summaryHash ?? "", anchoredAt: state.timestamp };
    await state.put(key, rec);
    return rec;
  },

  async AnchorIncident(state: ChainState, incidentId: string, chainHash: string, severity: string): Promise<IncidentRecord> {
    const key = keys.incident(need(incidentId, "incidentId"));
    const rec: IncidentRecord = { incidentId, chainHash: need(chainHash, "chainHash"), severity: severity ?? "", anchoredAt: state.timestamp };
    await state.put(key, rec);
    return rec;
  },

  async GetEvent(state: ChainState, eventId: string): Promise<AuditRecord> {
    const rec = await state.get<AuditRecord>(keys.audit(need(eventId, "eventId")));
    if (!rec) throw new ChainError("not_found", `${eventId} is not anchored`);
    return rec;
  },

  async GetIncident(state: ChainState, incidentId: string): Promise<IncidentRecord> {
    const rec = await state.get<IncidentRecord>(keys.incident(need(incidentId, "incidentId")));
    if (!rec) throw new ChainError("not_found", `${incidentId} is not anchored`);
    return rec;
  },
};

// ─── IdentityVerification ───────────────────────────────────────────────────

/**
 * Enrolment and face-verification evidence.
 *
 * Two rules are enforced by the contract rather than by the API, so they hold in either runtime:
 *   • an approved enrolment cannot be re-submitted or silently overwritten, and
 *   • an enrolment decision is made once — a second DecideEnrolment on a decided record is refused.
 * The admin who decides can never be the person enrolling; the contract checks that too.
 */
export const IdentityVerification = {
  async RecordEnrolment(
    state: ChainState,
    did: string,
    employeeIdHash: string,
    idDocSha256: string,
    idDocCid: string,
    faceSha256: string,
    faceCid: string,
    faceMatchScore: string,
    livenessScore: string,
    bundleHash: string,
  ): Promise<EnrolmentRecord> {
    const key = keys.enrolment(need(did, "did"));
    const existing = await state.get<EnrolmentRecord>(key);
    if (existing && existing.status !== "denied") throw new ChainError("already_enrolled", `${did} already has a ${existing.status} enrolment`);
    const rec: EnrolmentRecord = {
      did,
      employeeIdHash: need(employeeIdHash, "employeeIdHash"),
      idDocSha256: need(idDocSha256, "idDocSha256"),
      idDocCid: need(idDocCid, "idDocCid"),
      faceSha256: need(faceSha256, "faceSha256"),
      faceCid: need(faceCid, "faceCid"),
      faceMatchScore: score(faceMatchScore, "faceMatchScore"),
      livenessScore: score(livenessScore, "livenessScore"),
      bundleHash: need(bundleHash, "bundleHash"),
      status: "pending",
      submittedAt: state.timestamp,
      decidedAt: null,
      decidedBy: null,
      reasonHash: null,
    };
    await state.put(key, rec);
    return rec;
  },

  async DecideEnrolment(state: ChainState, did: string, decision: string, adminDid: string, reasonHash: string): Promise<EnrolmentRecord> {
    const key = keys.enrolment(need(did, "did"));
    const rec = await state.get<EnrolmentRecord>(key);
    if (!rec) throw new ChainError("not_found", `${did} has no enrolment`);
    if (rec.status !== "pending") throw new ChainError("already_decided", `${did} was already ${rec.status}`);
    if (decision !== "approved" && decision !== "denied") throw new ChainError("invalid_argument", "decision must be approved or denied");
    if (need(adminDid, "adminDid") === did) throw new ChainError("approver_is_requester", "An enrolment cannot approve itself.");
    const next: EnrolmentRecord = { ...rec, status: decision, decidedAt: state.timestamp, decidedBy: adminDid, reasonHash: reasonHash ?? null };
    await state.put(key, next);
    return next;
  },

  async RecordVerification(
    state: ChainState,
    verificationId: string,
    did: string,
    purpose: string,
    faceSha256: string,
    faceCid: string,
    faceMatchScore: string,
    livenessScore: string,
    bundleHash: string,
    passed: string,
  ): Promise<VerificationRecord> {
    const key = keys.verification(need(verificationId, "verificationId"));
    if (await state.get(key)) throw new ChainError("already_recorded", `${verificationId} is already on chain`);
    if (purpose !== "signup" && purpose !== "login") throw new ChainError("invalid_argument", "purpose must be signup or login");
    const rec: VerificationRecord = {
      verificationId,
      did: need(did, "did"),
      purpose,
      faceSha256: need(faceSha256, "faceSha256"),
      faceCid: need(faceCid, "faceCid"),
      faceMatchScore: score(faceMatchScore, "faceMatchScore"),
      livenessScore: score(livenessScore, "livenessScore"),
      bundleHash: need(bundleHash, "bundleHash"),
      passed: passed === "true",
      recordedAt: state.timestamp,
    };
    await state.put(key, rec);
    return rec;
  },

  async GetEnrolment(state: ChainState, did: string): Promise<EnrolmentRecord> {
    const rec = await state.get<EnrolmentRecord>(keys.enrolment(need(did, "did")));
    if (!rec) throw new ChainError("not_found", `${did} has no enrolment`);
    return rec;
  },

  async GetVerification(state: ChainState, verificationId: string): Promise<VerificationRecord> {
    const rec = await state.get<VerificationRecord>(keys.verification(need(verificationId, "verificationId")));
    if (!rec) throw new ChainError("not_found", `${verificationId} is not on chain`);
    return rec;
  },

  async ListVerificationHistory(state: ChainState, verificationId: string): Promise<HistoryEntry<VerificationRecord>[]> {
    return state.history<VerificationRecord>(keys.verification(need(verificationId, "verificationId")));
  },
};

export type ContractName = "DIDRegistry" | "AssetPassport" | "PolicyRegistry" | "AuditTrail" | "IdentityVerification";

export const CONTRACTS = { DIDRegistry, AssetPassport, PolicyRegistry, AuditTrail, IdentityVerification } as const;

/** Dispatch `Contract:Function` with string args — the shape both runtimes speak. */
export async function invoke(state: ChainState, contract: ContractName, fn: string, args: string[]): Promise<unknown> {
  const c = CONTRACTS[contract] as Record<string, (s: ChainState, ...a: string[]) => Promise<unknown>>;
  const f = c?.[fn];
  if (!f) throw new ChainError("unknown_function", `${contract}:${fn} does not exist`);
  return f(state, ...args);
}

// ─── In-memory state (tests, dry runs) ───────────────────────────────────────

export class MemoryState implements ChainState {
  private store = new Map<string, unknown>();
  private hist = new Map<string, HistoryEntry[]>();
  private counter = 0;
  txId = "tx-0";
  timestamp = new Date(0).toISOString();

  begin(now = new Date()): void {
    this.counter += 1;
    this.txId = `tx-${this.counter}`;
    this.timestamp = now.toISOString();
  }
  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T) ?? null;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
    const list = this.hist.get(key) ?? [];
    list.push({ txId: this.txId, block: this.counter, timestamp: this.timestamp, value, deleted: false });
    this.hist.set(key, list);
  }
  async history<T>(key: string): Promise<HistoryEntry<T>[]> {
    return (this.hist.get(key) ?? []) as HistoryEntry<T>[];
  }
}
