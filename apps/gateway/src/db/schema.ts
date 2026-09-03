/**
 * Off-chain projections, policies, trust state and the hash-chained audit log.
 * Fabric (or the lite ledger) remains the source of truth; these tables are rebuildable caches
 * plus the operational state the ledger deliberately does not hold.
 */
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => text("id").primaryKey().default(sql`gen_random_uuid()`);

// ─── identity ────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: id(),
  did: text("did").notNull().unique(),
  /** The employee ID from the ID document. The login identifier; never a secret. */
  employeeId: text("employee_id").unique(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  /** pending → an admin has not decided yet | active | denied | suspended | revoked */
  status: text("status").notNull().default("active"),
  sessionVersion: integer("session_version").notNull().default(1),
  identityTrust: integer("identity_trust").notNull().default(60),
  publicKeyJwk: jsonb("public_key_jwk").$type<Record<string, string>>().notNull(),
  baseline: jsonb("baseline").$type<UserBaseline>().notNull(),
  livenessMode: text("liveness_mode").notNull().default("faceapi"),
  createdAt: ts("created_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
});

export interface UserBaseline {
  hours: [number, number];
  homeCity: string;
  homeGeo: { lat: number; lng: number };
  dailyAssets: number;
}

export const devices = pgTable(
  "devices",
  {
    id: id(),
    userId: text("user_id").notNull(),
    fingerprintHash: text("fingerprint_hash").notNull(),
    label: text("label"),
    deviceTrust: integer("device_trust").notNull().default(40),
    trusted: boolean("trusted").notNull().default(false),
    lastGeo: jsonb("last_geo").$type<{ lat: number; lng: number; city?: string }>(),
    lastIp: text("last_ip"),
    firstSeen: ts("first_seen").notNull().defaultNow(),
    lastSeen: ts("last_seen").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("devices_user_fp").on(t.userId, t.fingerprintHash)],
);

export const credentials = pgTable("credentials", {
  id: id(),
  userId: text("user_id").notNull(),
  vcJwt: text("vc_jwt").notNull(),
  vcHash: text("vc_hash").notNull(),
  status: text("status").notNull().default("active"),
  issuedAt: ts("issued_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
  revokeReason: text("revoke_reason"),
  ledgerTxId: text("ledger_tx_id"),
  block: integer("block"),
});

export const livenessNonces = pgTable("liveness_nonces", {
  nonce: text("nonce").primaryKey(),
  userId: text("user_id"),
  purpose: text("purpose").notNull(), // onboard | step_up | approval | revoke | close_incident
  refId: text("ref_id"),
  challenge: jsonb("challenge").$type<string[]>().notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const livenessAttestations = pgTable("liveness_attestations", {
  id: id(),
  userId: text("user_id").notNull(),
  nonce: text("nonce").notNull(),
  purpose: text("purpose").notNull(),
  refId: text("ref_id"),
  signature: text("signature").notNull(),
  attestationHash: text("attestation_hash").notNull(),
  mode: text("mode").notNull(),
  verified: boolean("verified").notNull(),
  deviceId: text("device_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/**
 * One row per signup request: the employee ID document, the live face capture, the five verification
 * gates that ran over them, and the admin decision that follows.
 *
 * The blobs themselves live in content-addressed storage, encrypted with a per-enrolment data key
 * exactly like an asset version. What is kept here is the *address* and the hashes — which is also
 * what goes on chain, so an auditor can prove the bytes an admin approved are the bytes still stored.
 */
export const enrolments = pgTable(
  "enrolments",
  {
    id: id(),
    userId: text("user_id").notNull(),
    employeeId: text("employee_id").notNull(),
    did: text("did").notNull(),
    displayName: text("display_name").notNull(),
    requestedRole: text("requested_role").notNull().default("engineer"),

    // employee ID document
    idDocMime: text("id_doc_mime").notNull(),
    idDocSizeBytes: integer("id_doc_size_bytes").notNull(),
    idDocSha256: text("id_doc_sha256").notNull(),
    idDocCipherSha256: text("id_doc_cipher_sha256").notNull(),
    idDocCid: text("id_doc_cid").notNull(),
    idDocDekWrapped: text("id_doc_dek_wrapped").notNull(),
    idDocIv: text("id_doc_iv").notNull(),

    /** The signup face capture, as a face_verifications row. */
    verificationId: text("verification_id").notNull(),
    faceMatchScore: integer("face_match_score").notNull(),
    livenessScore: integer("liveness_score").notNull(),

    /** The five gates, in order, exactly as they were evaluated. */
    checks: jsonb("checks").$type<VerificationCheck[]>().notNull().default([]),
    bundleHash: text("bundle_hash").notNull(),

    status: text("status").notNull().default("pending"), // pending | approved | denied
    decidedBy: text("decided_by"),
    decidedByDid: text("decided_by_did"),
    decidedAt: ts("decided_at"),
    decisionReason: text("decision_reason"),
    attestationId: text("attestation_id"),

    ledgerTxId: text("ledger_tx_id"),
    block: integer("block"),
    auditEventId: text("audit_event_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("enrolments_employee_id").on(t.employeeId), index("enrolments_status").on(t.status, t.createdAt)],
);

/** One gate of the five-verification bundle, as recorded. */
export interface VerificationCheck {
  id: "employee_id" | "id_document" | "face_match" | "liveness" | "did_signature";
  result: "pass" | "fail";
  /** 0-100 where the gate produces a confidence; null where it is a yes/no. */
  score: number | null;
  required: number | null;
  detailKey: string;
}

/**
 * Every face check the product has ever run — the signup capture and each login after it.
 * The captured frame is encrypted and content-addressed; its hash and the two confidence scores
 * are anchored on chain, so a login can be proved to have happened against a specific image.
 */
export const faceVerifications = pgTable(
  "face_verifications",
  {
    id: id(),
    userId: text("user_id"),
    did: text("did").notNull(),
    employeeId: text("employee_id"),
    purpose: text("purpose").notNull(), // signup | login

    imageMime: text("image_mime").notNull().default("image/jpeg"),
    imageSizeBytes: integer("image_size_bytes").notNull(),
    imageSha256: text("image_sha256").notNull(),
    imageCipherSha256: text("image_cipher_sha256").notNull(),
    imageCid: text("image_cid").notNull(),
    imageDekWrapped: text("image_dek_wrapped").notNull(),
    imageIv: text("image_iv").notNull(),

    faceMatchScore: integer("face_match_score").notNull(),
    livenessScore: integer("liveness_score").notNull(),
    livenessSignals: jsonb("liveness_signals").$type<Record<string, number>>().notNull().default({}),
    livenessMode: text("liveness_mode").notNull().default("faceapi"),

    checks: jsonb("checks").$type<VerificationCheck[]>().notNull().default([]),
    bundleHash: text("bundle_hash").notNull(),
    passed: boolean("passed").notNull(),

    nonce: text("nonce").notNull(),
    signature: text("signature").notNull(),
    deviceId: text("device_id"),
    ip: text("ip"),

    ledgerTxId: text("ledger_tx_id"),
    block: integer("block"),
    anchoredAt: ts("anchored_at"),
    auditEventId: text("audit_event_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("face_verifications_did").on(t.did, t.createdAt), index("face_verifications_purpose").on(t.purpose, t.createdAt)],
);

/**
 * The enrolment face template: the embedding averaged over the ID photo and the live frames.
 *
 * Kept encrypted at rest under the same KEK as everything else, and handed back to the browser at
 * the start of a login so the match can run on-device — the server never computes a face match.
 */
export const faceTemplates = pgTable("face_templates", {
  userId: text("user_id").primaryKey(),
  did: text("did").notNull(),
  /**
   * Which net produced it: `adaface` (512-d, cosine) or `faceapi` (128-d, euclidean). The two spaces
   * are not comparable, so this is handed back with the template and a mismatch is a re-enrolment
   * rather than a failed match. Rows written before AdaFace landed are face-api's, which is the
   * default this column carries.
   */
  model: text("model").notNull().default("faceapi"),
  /** AES-256-GCM over the JSON embedding array. */
  templateWrapped: text("template_wrapped").notNull(),
  templateIv: text("template_iv").notNull(),
  templateDekWrapped: text("template_dek_wrapped").notNull(),
  templateHash: text("template_hash").notNull(),
  samples: integer("samples").notNull().default(1),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const trustEvents = pgTable(
  "trust_events",
  {
    id: id(),
    subjectType: text("subject_type").notNull(), // identity | device | asset
    subjectId: text("subject_id").notNull(),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    scoreAfter: integer("score_after").notNull(),
    refId: text("ref_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("trust_events_subject").on(t.subjectType, t.subjectId, t.createdAt)],
);

// ─── policy (versioned, immutable) ───────────────────────────────────────────

export const policies = pgTable("policies", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const policyVersions = pgTable(
  "policy_versions",
  {
    id: id(),
    policyId: text("policy_id").notNull(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    specHash: text("spec_hash").notNull(),
    activeFrom: ts("active_from").notNull().defaultNow(),
    activeTo: ts("active_to"),
    createdBy: text("created_by"),
    ledgerTxId: text("ledger_tx_id"),
    block: integer("block"),
  },
  (t) => [uniqueIndex("policy_versions_key_version").on(t.key, t.version)],
);

// ─── assets & provenance ─────────────────────────────────────────────────────

export const assets = pgTable("assets", {
  id: id(),
  assetUid: text("asset_uid").notNull().unique(),
  name: text("name").notNull(),
  mime: text("mime").notNull().default("application/octet-stream"),
  class: text("class").notNull(),
  sensitivity: text("sensitivity").notNull(),
  ownerDid: text("owner_did").notNull(),
  currentVersion: integer("current_version").notNull().default(1),
  parentAssetId: text("parent_asset_id"),
  lineageType: text("lineage_type").notNull().default("root"),
  assetTrust: integer("asset_trust").notNull().default(0),
  trustBreakdown: jsonb("trust_breakdown").$type<{ key: string; points: number; max: number }[]>().notNull().default([]),
  passportMeta: jsonb("passport_meta").$type<Record<string, string>>().notNull().default({}),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export const assetVersions = pgTable(
  "asset_versions",
  {
    id: id(),
    assetId: text("asset_id").notNull(),
    version: integer("version").notNull(),
    sha256Plain: text("sha256_plain").notNull(),
    sha256Cipher: text("sha256_cipher").notNull(),
    cid: text("cid").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    dekWrapped: text("dek_wrapped").notNull(),
    iv: text("iv").notNull(),
    parentSha256: text("parent_sha256"),
    ledgerTxId: text("ledger_tx_id"),
    block: integer("block"),
    status: text("status").notNull().default("anchoring"),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("asset_versions_asset_version").on(t.assetId, t.version), index("asset_versions_sha").on(t.sha256Plain)],
);

export const assetTransfers = pgTable("asset_transfers", {
  id: id(),
  assetId: text("asset_id").notNull(),
  fromDid: text("from_did").notNull(),
  toDid: text("to_did").notNull(),
  requestId: text("request_id"),
  approvalId: text("approval_id"),
  approverDid: text("approver_did"),
  ledgerTxId: text("ledger_tx_id"),
  block: integer("block"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const grants = pgTable("grants", {
  id: id(),
  assetId: text("asset_id").notNull(),
  userId: text("user_id").notNull(),
  permission: text("permission").notNull(),
  grantedBy: text("granted_by").notNull(),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ─── decisions & approvals ───────────────────────────────────────────────────

export const accessRequests = pgTable(
  "access_requests",
  {
    id: id(),
    userId: text("user_id").notNull(),
    actorDid: text("actor_did").notNull(),
    assetId: text("asset_id"),
    assetUid: text("asset_uid"),
    action: text("action").notNull(),
    actionClass: text("action_class").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().notNull(),
    deviceId: text("device_id"),
    policyVersionId: text("policy_version_id"),
    identityTrust: integer("identity_trust").notNull(),
    deviceTrust: integer("device_trust").notNull(),
    assetTrust: integer("asset_trust"),
    riskScore: integer("risk_score").notNull(),
    riskTier: text("risk_tier").notNull(),
    riskSignals: jsonb("risk_signals").$type<string[]>().notNull().default([]),
    decision: text("decision").notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    trace: jsonb("trace").$type<Record<string, unknown>>().notNull(),
    stepUpRequired: boolean("step_up_required").notNull().default(false),
    stepUpOk: boolean("step_up_ok"),
    approvalId: text("approval_id"),
    certId: text("cert_id"),
    contentToken: text("content_token"),
    contentUsed: boolean("content_used").notNull().default(false),
    toDid: text("to_did"),
    auditEventId: text("audit_event_id"),
    incidentId: text("incident_id"),
    expiresAt: ts("expires_at"),
    latencyMs: integer("latency_ms").notNull().default(0),
    decidedAt: ts("decided_at").notNull().defaultNow(),
    finalizedAt: ts("finalized_at"),
  },
  (t) => [index("access_requests_actor").on(t.actorDid, t.decidedAt), index("access_requests_asset").on(t.assetUid, t.decidedAt)],
);

export const approvals = pgTable("approvals", {
  id: id(),
  requestId: text("request_id").notNull(),
  kind: text("kind").notNull().default("two_person"),
  requiredRole: text("required_role").notNull(),
  requiredCount: integer("required_count").notNull().default(1),
  requesterDid: text("requester_did").notNull(),
  approverId: text("approver_id"),
  approverDid: text("approver_did"),
  status: text("status").notNull().default("pending"),
  reason: text("reason"),
  attestationId: text("attestation_id"),
  decidedAt: ts("decided_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const breakGlassGrants = pgTable("break_glass_grants", {
  id: id(),
  userId: text("user_id").notNull(),
  approvalId: text("approval_id"),
  reason: text("reason").notNull(),
  startsAt: ts("starts_at"),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ─── evidence ────────────────────────────────────────────────────────────────

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    actorDid: text("actor_did"),
    assetUid: text("asset_uid"),
    requestId: text("request_id"),
    incidentId: text("incident_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    prevHash: text("prev_hash").notNull(),
    chainHash: text("chain_hash").notNull(),
    ledgerTxId: text("ledger_tx_id"),
    block: integer("block"),
    anchoredAt: ts("anchored_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("audit_events_seq").on(t.seq),
    index("audit_events_actor").on(t.actorDid, t.seq),
    index("audit_events_asset").on(t.assetUid, t.seq),
    index("audit_events_incident").on(t.incidentId, t.seq),
  ],
);

export const proofCertificates = pgTable("proof_certificates", {
  id: id(),
  certId: text("cert_id").notNull().unique(),
  requestId: text("request_id"),
  auditEventId: text("audit_event_id").notNull(),
  body: jsonb("body").$type<Record<string, unknown>>().notNull(),
  bodyHash: text("body_hash").notNull(),
  signature: text("signature").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const incidents = pgTable("incidents", {
  id: id(),
  incidentId: text("incident_id").notNull().unique(),
  actorDid: text("actor_did").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull().default("open"),
  openedAt: ts("opened_at").notNull().defaultNow(),
  closedAt: ts("closed_at"),
  closedBy: text("closed_by"),
  closeReason: text("close_reason"),
  peakRisk: integer("peak_risk").notNull().default(0),
  summary: text("summary").notNull().default(""),
  signals: jsonb("signals").$type<string[]>().notNull().default([]),
  responses: jsonb("responses").$type<string[]>().notNull().default([]),
  ledgerTxId: text("ledger_tx_id"),
  block: integer("block"),
});

export const evidencePackages = pgTable("evidence_packages", {
  id: id(),
  packageId: text("package_id").notNull().unique(),
  incidentId: text("incident_id").notNull(),
  body: jsonb("body").$type<Record<string, unknown>>().notNull(),
  packageHash: text("package_hash").notNull(),
  signature: text("signature").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ─── ledger plumbing ─────────────────────────────────────────────────────────

export const ledgerOutbox = pgTable(
  "ledger_outbox",
  {
    id: id(),
    contract: text("contract").notNull(),
    fn: text("fn").notNull(),
    args: jsonb("args").$type<string[]>().notNull(),
    refTable: text("ref_table"),
    refId: text("ref_id"),
    attempts: integer("attempts").notNull().default(0),
    status: text("status").notNull().default("pending"), // pending | committed | failed
    lastError: text("last_error"),
    txId: text("tx_id"),
    block: integer("block"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("ledger_outbox_status").on(t.status, t.createdAt)],
);

/** lite ledger: one simulated block per transaction, hash-chained. */
export const ledgerBlocks = pgTable("ledger_blocks", {
  number: bigint("number", { mode: "number" }).primaryKey(),
  prevHash: text("prev_hash").notNull(),
  blockHash: text("block_hash").notNull(),
  txId: text("tx_id").notNull(),
  contract: text("contract").notNull(),
  fn: text("fn").notNull(),
  args: jsonb("args").$type<string[]>().notNull(),
  result: jsonb("result"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const ledgerState = pgTable("ledger_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  txId: text("tx_id").notNull(),
  block: bigint("block", { mode: "number" }).notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const ledgerStateHistory = pgTable(
  "ledger_state_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    key: text("key").notNull(),
    value: jsonb("value"),
    txId: text("tx_id").notNull(),
    block: bigint("block", { mode: "number" }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("ledger_state_history_key").on(t.key, t.id)],
);

// ─── demo ────────────────────────────────────────────────────────────────────

/** DEMO_MODE only: seeded identities whose keys live server-side so one laptop can play every role. */
export const demoIdentities = pgTable("demo_identities", {
  id: id(),
  userId: text("user_id").notNull().unique(),
  role: text("role").notNull(),
  privateKeyJwk: jsonb("private_key_jwk").$type<Record<string, string>>().notNull(),
  deviceFingerprintHash: text("device_fingerprint_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const schema = {
  users,
  devices,
  credentials,
  enrolments,
  faceVerifications,
  faceTemplates,
  livenessNonces,
  livenessAttestations,
  trustEvents,
  policies,
  policyVersions,
  assets,
  assetVersions,
  assetTransfers,
  grants,
  accessRequests,
  approvals,
  breakGlassGrants,
  auditEvents,
  proofCertificates,
  incidents,
  evidencePackages,
  ledgerOutbox,
  ledgerBlocks,
  ledgerState,
  ledgerStateHistory,
  demoIdentities,
};
