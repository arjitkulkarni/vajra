/**
 * @vajra/contracts — the single source of truth for every shape that crosses a boundary:
 * web ↔ gateway, gateway ↔ ledger, gateway ↔ analyst. Zod schemas + inferred types.
 */
import { z } from "zod";

// ─── Enumerations ────────────────────────────────────────────────────────────

export const ROLES = ["engineer", "manager", "auditor", "admin"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const USER_STATUSES = ["pending", "active", "denied", "suspended", "revoked"] as const;
export const UserStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const ASSET_CLASSES = ["design", "model", "certificate", "document"] as const;
export const AssetClassSchema = z.enum(ASSET_CLASSES);
export type AssetClass = z.infer<typeof AssetClassSchema>;

export const SENSITIVITIES = ["low", "medium", "high"] as const;
export const SensitivitySchema = z.enum(SENSITIVITIES);
export type Sensitivity = z.infer<typeof SensitivitySchema>;

export const ACTIONS = [
  "asset.view",
  "asset.open",
  "asset.download",
  "asset.transfer",
  "asset.export",
  "asset.delete",
  "policy.edit",
  "identity.revoke",
] as const;
export const ActionSchema = z.enum(ACTIONS);
export type Action = z.infer<typeof ActionSchema>;

export const ACTION_CLASSES = ["low", "medium", "high", "critical"] as const;
export const ActionClassSchema = z.enum(ACTION_CLASSES);
export type ActionClass = z.infer<typeof ActionClassSchema>;

export const VERDICTS = ["ALLOW", "STEP_UP", "DENY", "PENDING_APPROVAL"] as const;
export const VerdictSchema = z.enum(VERDICTS);
export type Verdict = z.infer<typeof VerdictSchema>;

export const RISK_TIERS = ["low", "elevated", "high"] as const;
export const RiskTierSchema = z.enum(RISK_TIERS);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const CHECK_RESULTS = ["pass", "fail", "warn", "skip"] as const;
export const CheckResultSchema = z.enum(CHECK_RESULTS);
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const POLICY_EFFECTS = ["allow", "deny", "step_up", "require_approval"] as const;
export const PolicyEffectSchema = z.enum(POLICY_EFFECTS);
export type PolicyEffect = z.infer<typeof PolicyEffectSchema>;

export const LINEAGE_TYPES = ["root", "version", "derivative", "copy"] as const;
export const LineageTypeSchema = z.enum(LINEAGE_TYPES);
export type LineageType = z.infer<typeof LineageTypeSchema>;

export const INCIDENT_SEVERITIES = ["S1", "S2", "S3"] as const;
export const IncidentSeveritySchema = z.enum(INCIDENT_SEVERITIES);
export type IncidentSeverity = z.infer<typeof IncidentSeveritySchema>;

export const INCIDENT_STATUSES = ["open", "resolved", "false_positive"] as const;
export const IncidentStatusSchema = z.enum(INCIDENT_STATUSES);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const DEPENDENCIES = ["db", "ledger", "risk", "storage"] as const;
export const DependencySchema = z.enum(DEPENDENCIES);
export type Dependency = z.infer<typeof DependencySchema>;

export const LIVENESS_MODES = ["faceapi", "simulated"] as const;
export const LivenessModeSchema = z.enum(LIVENESS_MODES);
export type LivenessMode = z.infer<typeof LivenessModeSchema>;

/**
 * The five verifications, in the order they are evaluated. Both signup and login run all five;
 * a failure is still recorded, so the evidence shows what was checked, not only what passed.
 *
 * There is deliberately no device or fingerprint factor: the only biometric VAJRA looks at is the
 * face. `did_signature` is cryptographic possession of the enrolled key, not a biometric.
 */
export const VERIFICATION_GATES = ["employee_id", "id_document", "face_match", "liveness", "did_signature"] as const;
export const VerificationGateIdSchema = z.enum(VERIFICATION_GATES);
export type VerificationGateId = z.infer<typeof VerificationGateIdSchema>;

/**
 * Everything reported alongside the liveness gate, in the order the evidence displays it.
 *
 * The first six are the passive signals measured from the frame geometry and pixels on the
 * capturing device — hand-written measurements, each one naming the attack it refuses. `ai` is not
 * one of them: it is the live probability MiniFASNet returned for the same capture, a learned
 * classifier's opinion recorded beside the hand-written ones rather than averaged into them.
 *
 * A key absent from a record means that signal could not be measured on that device — an older
 * enrolment, no head turn to measure depth against, or no anti-spoofing weights installed — and is
 * displayed as unmeasured, never as a zero.
 */
export const LIVENESS_SIGNALS = ["depth", "motion", "blink", "focus", "texture", "consistency", "ai"] as const;
export const LivenessSignalIdSchema = z.enum(LIVENESS_SIGNALS);
export type LivenessSignalId = z.infer<typeof LivenessSignalIdSchema>;

export const ENROLMENT_STATUSES = ["pending", "approved", "denied"] as const;
export const EnrolmentStatusSchema = z.enum(ENROLMENT_STATUSES);
export type EnrolmentStatus = z.infer<typeof EnrolmentStatusSchema>;

export const VERIFICATION_PURPOSES = ["signup", "login"] as const;
export const VerificationPurposeSchema = z.enum(VERIFICATION_PURPOSES);
export type VerificationPurpose = z.infer<typeof VerificationPurposeSchema>;

export const LOCALES = ["en", "hi", "kn"] as const;
export const LocaleSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;

// ─── Decision trace (explainability contract) ────────────────────────────────

export const TraceParamSchema = z.union([z.string(), z.number(), z.boolean()]);

export const TraceCheckSchema = z.object({
  id: z.string(),
  labelKey: z.string(),
  params: z.record(TraceParamSchema).optional(),
  result: CheckResultSchema,
  detailKey: z.string().optional(),
  signals: z.array(z.string()).optional(),
});
export type TraceCheck = z.infer<typeof TraceCheckSchema>;

export const PolicyRefSchema = z.object({
  id: z.string(),
  key: z.string(),
  version: z.number().int(),
  hash: z.string(),
});
export type PolicyRef = z.infer<typeof PolicyRefSchema>;

export const DecisionTraceSchema = z.object({
  verdict: VerdictSchema,
  actionClass: ActionClassSchema,
  policyVersion: PolicyRefSchema.nullable(),
  checks: z.array(TraceCheckSchema),
  reasons: z.array(z.string()),
});
export type DecisionTrace = z.infer<typeof DecisionTraceSchema>;

// ─── Policy-as-code ──────────────────────────────────────────────────────────

export const PolicySpecSchema = z.object({
  key: z.string().regex(/^POL-\d{3,}$/, "Policy keys look like POL-009"),
  name: z.string().min(1).max(120),
  subject: z.object({ role: z.array(RoleSchema).min(1) }),
  action: ActionSchema,
  resource: z
    .object({
      class: z.array(AssetClassSchema).optional(),
      sensitivity: z.array(SensitivitySchema).optional(),
    })
    .default({}),
  condition: z
    .object({
      hours: z.tuple([z.number().int().min(0).max(24), z.number().int().min(0).max(24)]).optional(),
      deviceTrusted: z.boolean().optional(),
      maxRiskTier: RiskTierSchema.optional(),
    })
    .default({}),
  effect: PolicyEffectSchema,
  approval: z
    .object({
      approverRole: RoleSchema,
      count: z.number().int().min(1).max(3).default(1),
      distinctFromRequester: z.boolean().default(true),
    })
    .optional(),
  breakGlass: z
    .object({
      eligibleRoles: z.array(RoleSchema).min(1),
      ttlMinutes: z.number().int().min(1).max(120).default(15),
      approverRole: RoleSchema,
    })
    .optional(),
  priority: z.number().int().min(0).max(1000).default(100),
});
export type PolicySpec = z.infer<typeof PolicySpecSchema>;
export type PolicySpecInput = z.input<typeof PolicySpecSchema>;

export const PolicyVersionSchema = z.object({
  id: z.string(),
  key: z.string(),
  version: z.number().int(),
  hash: z.string(),
  spec: PolicySpecSchema,
  activeFrom: z.string(),
  activeTo: z.string().nullable(),
  ledgerTxId: z.string().nullable().optional(),
});
export type PolicyVersion = z.infer<typeof PolicyVersionSchema>;

// ─── Context, risk, trust ────────────────────────────────────────────────────

export const GeoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  city: z.string().optional(),
});
export type Geo = z.infer<typeof GeoSchema>;

export const RequestContextSchema = z.object({
  deviceId: z.string().min(1).max(200),
  ip: z.string().max(64).optional(),
  geo: GeoSchema.optional(),
  localHour: z.number().int().min(0).max(23).optional(),
  userAgent: z.string().max(300).optional(),
  reason: z.string().max(500).optional(),
});
export type RequestContext = z.infer<typeof RequestContextSchema>;

export const RiskResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  tier: RiskTierSchema,
  signals: z.array(z.string()),
});
export type RiskResult = z.infer<typeof RiskResultSchema>;

export const TrustScoresSchema = z.object({
  identity: z.number().int().min(0).max(100),
  device: z.number().int().min(0).max(100),
  asset: z.number().int().min(0).max(100).nullable(),
});
export type TrustScores = z.infer<typeof TrustScoresSchema>;

export const TrustBreakdownItemSchema = z.object({
  key: z.string(),
  points: z.number().int(),
  max: z.number().int(),
});
export type TrustBreakdownItem = z.infer<typeof TrustBreakdownItemSchema>;

export const PermissionStateSchema = z.enum(["allow", "step_up", "deny"]);
export type PermissionState = z.infer<typeof PermissionStateSchema>;
export const EffectivePermissionsSchema = z.record(ActionSchema, PermissionStateSchema);
export type EffectivePermissions = Partial<Record<Action, PermissionState>>;

// ─── Evidence: Proof-of-Action & evidence packages ───────────────────────────

export const AuditAnchorSchema = z.object({
  eventId: z.string(),
  seq: z.number().int(),
  payloadHash: z.string(),
  prevHash: z.string(),
  chainHash: z.string(),
  ledgerTxId: z.string().nullable(),
  block: z.number().int().nullable(),
});
export type AuditAnchor = z.infer<typeof AuditAnchorSchema>;

export const ProofOfActionBodySchema = z.object({
  certId: z.string(),
  actor: z.string(),
  asset: z.string().nullable(),
  version: z.number().int().nullable(),
  action: z.string(),
  decision: VerdictSchema,
  decidedAt: z.string(),
  policy: PolicyRefSchema.nullable(),
  trust: TrustScoresSchema,
  risk: RiskResultSchema,
  device: z.string(),
  liveness: z
    .object({ attestationHash: z.string(), verified: z.boolean(), mode: LivenessModeSchema })
    .nullable(),
  approvals: z.array(z.object({ approver: z.string(), attestationHash: z.string() })),
  trace: DecisionTraceSchema,
  audit: AuditAnchorSchema,
  issuer: z.string(),
});
export type ProofOfActionBody = z.infer<typeof ProofOfActionBodySchema>;

export const ProofOfActionSchema = ProofOfActionBodySchema.extend({
  bodyHash: z.string(),
  signature: z.string(),
});
export type ProofOfAction = z.infer<typeof ProofOfActionSchema>;

export const ProofCheckSchema = z.object({
  id: z.enum(["hash", "signature", "chain", "ledger", "policy"]),
  ok: z.boolean(),
  detailKey: z.string().optional(),
});
export const ProofVerificationSchema = z.object({
  valid: z.boolean(),
  checks: z.array(ProofCheckSchema),
});
export type ProofVerification = z.infer<typeof ProofVerificationSchema>;

export const EvidencePackageBodySchema = z.object({
  packageId: z.string(),
  incidentId: z.string(),
  generatedAt: z.string(),
  incident: z.record(z.unknown()),
  events: z.array(z.record(z.unknown())),
  proofs: z.array(ProofOfActionSchema),
  policyVersions: z.array(PolicyVersionSchema),
  trustEvents: z.array(z.record(z.unknown())),
  issuer: z.string(),
});
export const EvidencePackageSchema = EvidencePackageBodySchema.extend({
  packageHash: z.string(),
  signature: z.string(),
});
export type EvidencePackage = z.infer<typeof EvidencePackageSchema>;

/**
 * What the live AI check made of a capture: one probability, and how many frames stand behind it.
 *
 * MiniFASNet is a classifier trained on real presentation attacks, so unlike the passive signals it
 * generalises past the specific cue each of those measures — which is what makes it worth carrying
 * separately rather than folding into the composite. `liveProbability` is the median over the
 * frames scored during the capture; `samples` is how many there were, because a verdict resting on
 * one frame and a verdict resting on eight are not the same evidence.
 *
 * It is a claim the attesting device makes, exactly like the numbers beside it. The gateway does not
 * take the device's word for what the number *means*: it applies its own ANTISPOOF_MIN_LIVE floor,
 * so a browser reporting a confident spoof is refused whatever it thinks about it. Absent means the
 * check could not run on that device, which is recorded as unmeasured and never as a pass.
 */
export const SpoofCheckSchema = z.object({
  /** Which checkpoint produced it — the two crop scales are different models with different floors. */
  model: z.string().min(1).max(64),
  samples: z.number().int().min(1).max(64),
  liveProbability: z.number().min(0).max(1),
});
export type SpoofCheck = z.infer<typeof SpoofCheckSchema>;

/**
 * What the browser's liveness check reports about itself, alongside the signature.
 *
 * Numbers only — an overall 0–1 score and the per-signal breakdown behind it. No image, no
 * landmarks and no face descriptor is ever sent, so this stays evidence about the check rather than
 * evidence about the face. The server cannot re-derive it, and treats it as a claim the attesting
 * device makes about itself: it is recorded in the audit trail, never used in place of the signature.
 */
export const LivenessEvidenceShape = {
  livenessScore: z.number().min(0).max(1).optional(),
  livenessSignals: z.record(z.number().min(0).max(1)).optional(),
  spoofCheck: SpoofCheckSchema.optional(),
};

// ─── API: identity ───────────────────────────────────────────────────────────

/**
 * The public half of the browser-generated Ed25519 key, as WebCrypto actually exports it.
 *
 * This used to be `z.record(z.string())`, which no real JWK can satisfy:
 * `crypto.subtle.exportKey("jwk", …)` returns `ext: true` (a boolean) and `key_ops: ["verify"]`
 * (an array) alongside the key material, so every enrolment failed validation before it reached a
 * single verification — the one error a person cannot act on, because nothing they typed was wrong.
 *
 * Only `kty`, `crv` and `x` are ever read (`publicKeyFromJwk`, `didKeyFromJwk`, and `x` again for
 * the DID-registry hash). So those three are validated and everything else is dropped by zod's
 * default strip, which also keeps the parsed value a clean `Record<string, string>` for the jsonb
 * column and the crypto helpers.
 */
export const PublicKeyJwkSchema = z
  .object({
    kty: z.string(),
    crv: z.string(),
    x: z.string().min(1),
  })
  .refine((jwk) => jwk.kty === "OKP" && jwk.crv === "Ed25519", {
    message: "expected an Ed25519 OKP public key (kty OKP, crv Ed25519)",
  });
export type PublicKeyJwk = z.infer<typeof PublicKeyJwkSchema>;

export const OnboardStartResponseSchema = z.object({
  nonce: z.string(),
  challenge: z.array(z.enum(["turn_left", "turn_right", "smile"])),
  expiresAt: z.string(),
});
export type OnboardStartResponse = z.infer<typeof OnboardStartResponseSchema>;

export const OnboardCompleteBodySchema = z.object({
  did: z.string().startsWith("did:key:"),
  publicKeyJwk: PublicKeyJwkSchema,
  nonce: z.string(),
  signature: z.string(), // base64url Ed25519 signature over the nonce bytes
  deviceFingerprintHash: z.string().min(16).max(128),
  displayName: z.string().min(1).max(80),
  livenessMode: LivenessModeSchema,
  ...LivenessEvidenceShape,
  role: RoleSchema.optional(), // honoured only in DEMO_MODE
});
export type OnboardCompleteBody = z.infer<typeof OnboardCompleteBodySchema>;

export const PublicUserSchema = z.object({
  id: z.string(),
  did: z.string(),
  displayName: z.string(),
  role: RoleSchema,
  status: UserStatusSchema,
  identityTrust: z.number().int(),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const OnboardCompleteResponseSchema = z.object({
  user: PublicUserSchema,
  vcJwt: z.string(),
  sessionJwt: z.string(),
  device: z.object({ id: z.string(), deviceTrust: z.number().int(), trusted: z.boolean() }),
});
export type OnboardCompleteResponse = z.infer<typeof OnboardCompleteResponseSchema>;

export const AttestationBodySchema = z.object({
  nonce: z.string(),
  signature: z.string(),
  livenessMode: LivenessModeSchema,
  ...LivenessEvidenceShape,
});
export type AttestationBody = z.infer<typeof AttestationBodySchema>;

// ─── API: enrolment (signup, login, admin decision) ──────────────────────────

/**
 * Employee IDs are what a person types at the login screen, so the format is deliberately liberal:
 * letters, digits, dashes and slashes. The gateway upper-cases before it compares.
 */
export const EmployeeIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/, "An employee ID is letters, digits, dashes or slashes.");

export const VerificationCheckSchema = z.object({
  id: VerificationGateIdSchema,
  result: z.enum(["pass", "fail"]),
  /** 0-100 where the gate produces a confidence; null where it is a yes/no. */
  score: z.number().int().min(0).max(100).nullable(),
  required: z.number().int().min(0).max(100).nullable(),
  detailKey: z.string(),
});
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;

export const VerificationBundleSchema = z.object({
  checks: z.array(VerificationCheckSchema),
  passed: z.boolean(),
  faceMatchScore: z.number().int().min(0).max(100),
  livenessScore: z.number().int().min(0).max(100),
  livenessSignals: z.record(z.number().min(0).max(1)),
  bundleHash: z.string(),
});
export type VerificationBundle = z.infer<typeof VerificationBundleSchema>;

/** The confidence numbers and the attestation the browser reports for one face check. */
export const FaceEvidenceSchema = z.object({
  nonce: z.string(),
  signature: z.string(),
  /** Descriptor distance turned into a 0-100 confidence, computed on-device. */
  faceMatchScore: z.number().int().min(0).max(100),
  livenessMode: LivenessModeSchema,
  ...LivenessEvidenceShape,
});
export type FaceEvidence = z.infer<typeof FaceEvidenceSchema>;

export const SignupStartResponseSchema = z.object({
  nonce: z.string(),
  challenge: z.array(z.enum(["turn_left", "turn_right", "smile"])),
  expiresAt: z.string(),
  faceMatchThreshold: z.number().int().min(0).max(100),
  livenessThreshold: z.number().int().min(0).max(100),
});
export type SignupStartResponse = z.infer<typeof SignupStartResponseSchema>;

/**
 * Which face model produced an embedding. AdaFace (512-d, compared by cosine similarity) is what
 * VAJRA verifies against; face-api (128-d, euclidean) remains only for machines without the AdaFace
 * weights and for enrolments made before the switch.
 */
export const EmbeddingModelSchema = z.enum(["adaface", "faceapi"]);
export type EmbeddingModel = z.infer<typeof EmbeddingModelSchema>;

/** How wide each space is. The dimension is what the browser reads the model off, so they must agree. */
export const EMBEDDING_DIMS: Record<EmbeddingModel, number> = { adaface: 512, faceapi: 128 };

/** Multipart: an `idDocument` file and a `faceImage` file, plus this JSON in the `payload` field. */
export const SignupPayloadSchema = z.object({
  employeeId: EmployeeIdSchema,
  displayName: z.string().min(1).max(80),
  did: z.string().startsWith("did:key:"),
  publicKeyJwk: PublicKeyJwkSchema,
  deviceFingerprintHash: z.string().min(16).max(128),
  /** The averaged face embedding — 512 floats from AdaFace, 128 from face-api. Encrypted at rest. */
  faceTemplate: z.array(z.number()).min(64).max(512),
  faceTemplateSamples: z.number().int().min(1).max(500).default(1),
  /**
   * Which net produced it. The two embedding spaces are not comparable, so this travels with the
   * numbers and is handed back at login; a template with the wrong tag is a re-enrolment, not a
   * failed match. Defaults to face-api so an older client keeps working unchanged.
   */
  faceTemplateModel: EmbeddingModelSchema.default("faceapi"),
  role: RoleSchema.optional(), // honoured only in DEMO_MODE
  evidence: FaceEvidenceSchema,
}).superRefine((payload, ctx) => {
  // The browser reads which space to score a login in off the *length* of the template it is handed
  // back. If the tag and the length were ever allowed to disagree, that decision would be made on a
  // lie — so they are checked against each other here, at the one point where both are present,
  // rather than the tag being a column nothing ever reads.
  const expected = EMBEDDING_DIMS[payload.faceTemplateModel];
  if (payload.faceTemplate.length !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["faceTemplate"],
      message: `A ${payload.faceTemplateModel} template is ${expected}-dimensional, not ${payload.faceTemplate.length}.`,
    });
  }
});
export type SignupPayload = z.infer<typeof SignupPayloadSchema>;

export const EnrolmentSummarySchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  displayName: z.string(),
  did: z.string(),
  requestedRole: RoleSchema,
  status: EnrolmentStatusSchema,
  faceMatchScore: z.number().int(),
  livenessScore: z.number().int(),
  checks: z.array(VerificationCheckSchema),
  bundleHash: z.string(),
  idDocSha256: z.string(),
  idDocCid: z.string(),
  faceSha256: z.string(),
  faceCid: z.string(),
  ledgerTxId: z.string().nullable(),
  block: z.number().int().nullable(),
  decidedBy: z.string().nullable(),
  decisionReason: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type EnrolmentSummary = z.infer<typeof EnrolmentSummarySchema>;

export const SignupSubmitResponseSchema = z.object({
  enrolment: EnrolmentSummarySchema,
  verification: VerificationBundleSchema,
});
export type SignupSubmitResponse = z.infer<typeof SignupSubmitResponseSchema>;

export const LoginStartResponseSchema = z.object({
  nonce: z.string(),
  challenge: z.array(z.enum(["turn_left", "turn_right", "smile"])),
  expiresAt: z.string(),
  did: z.string(),
  displayName: z.string(),
  /** The enrolment template, so the confidence score is recomputed in the browser. */
  faceTemplate: z.array(z.number()),
  /** Which net produced that template, so the browser scores it in the right space. */
  faceTemplateModel: EmbeddingModelSchema,
  faceMatchThreshold: z.number().int().min(0).max(100),
  livenessThreshold: z.number().int().min(0).max(100),
  accountStatus: UserStatusSchema,
});
export type LoginStartResponse = z.infer<typeof LoginStartResponseSchema>;

export const LoginCompletePayloadSchema = z.object({
  employeeId: EmployeeIdSchema,
  deviceFingerprintHash: z.string().min(16).max(128),
  evidence: FaceEvidenceSchema,
});
export type LoginCompletePayload = z.infer<typeof LoginCompletePayloadSchema>;

export const LoginCompleteResponseSchema = z.object({
  user: PublicUserSchema,
  sessionJwt: z.string(),
  vcJwt: z.string(),
  device: z.object({ id: z.string(), deviceTrust: z.number().int(), trusted: z.boolean() }),
  verification: VerificationBundleSchema,
  verificationId: z.string(),
  /** Where the console sends this person: admins to the control plane, everyone else to the workspace. */
  home: z.enum(["admin", "app"]),
});
export type LoginCompleteResponse = z.infer<typeof LoginCompleteResponseSchema>;

export const EnrolmentDecideBodySchema = z.object({
  approve: z.boolean(),
  reason: z.string().min(3).max(500),
  attestation: AttestationBodySchema,
});
export type EnrolmentDecideBody = z.infer<typeof EnrolmentDecideBodySchema>;

// ─── API: access ─────────────────────────────────────────────────────────────

export const AccessRequestBodySchema = z.object({
  action: ActionSchema,
  context: RequestContextSchema,
  toDid: z.string().optional(), // for transfers
});
export type AccessRequestBody = z.infer<typeof AccessRequestBodySchema>;

export const StepUpChallengeSchema = z.object({
  nonce: z.string(),
  challenge: z.array(z.enum(["turn_left", "turn_right", "smile"])),
  expiresAt: z.string(),
});

export const AccessDecisionResponseSchema = z.object({
  requestId: z.string(),
  verdict: VerdictSchema,
  trace: DecisionTraceSchema,
  risk: RiskResultSchema,
  trust: TrustScoresSchema,
  effectivePermissions: EffectivePermissionsSchema,
  stepUp: StepUpChallengeSchema.nullable(),
  approvalId: z.string().nullable(),
  contentUrl: z.string().nullable(),
  certId: z.string().nullable(),
  auditEventId: z.string(),
  incidentId: z.string().nullable(),
  latencyMs: z.number(),
});
export type AccessDecisionResponse = z.infer<typeof AccessDecisionResponseSchema>;

export const ApprovalDecideBodySchema = z.object({
  approve: z.boolean(),
  reason: z.string().max(500).optional(),
  attestation: AttestationBodySchema,
});
export type ApprovalDecideBody = z.infer<typeof ApprovalDecideBodySchema>;

// ─── API: assets ─────────────────────────────────────────────────────────────

export const AssetUploadMetaSchema = z.object({
  name: z.string().min(1).max(200),
  class: AssetClassSchema,
  sensitivity: SensitivitySchema,
  parentUid: z.string().optional(),
  lineageType: LineageTypeSchema.optional(),
  passportMeta: z.record(z.string()).optional(),
});
export type AssetUploadMeta = z.infer<typeof AssetUploadMetaSchema>;

// ─── API: misc ───────────────────────────────────────────────────────────────

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const DemoScenarioSchema = z.object({
  deviceId: z.string().optional(),
  ip: z.string().optional(),
  geo: GeoSchema.optional(),
  localHour: z.number().int().min(0).max(23).optional(),
  burst: z.number().int().min(0).max(100).optional(),
});
export type DemoScenario = z.infer<typeof DemoScenarioSchema>;

export const HealthSchema = z.object({
  ok: z.boolean(),
  deps: z.record(DependencySchema, z.object({ ok: z.boolean(), detail: z.string().optional() })),
  modes: z.record(z.string()),
  simulatedOutage: z.array(DependencySchema),
  time: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

// ─── Helpers ────────────────────────────────────────────────────────────────

export const TIER_ORDER: Record<RiskTier, number> = { low: 0, elevated: 1, high: 2 };
export function tierRank(t: RiskTier): number {
  return TIER_ORDER[t];
}
export function tierFor(score: number): RiskTier {
  if (score >= 60) return "high";
  if (score >= 30) return "elevated";
  return "low";
}
