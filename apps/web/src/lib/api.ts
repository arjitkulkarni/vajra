/**
 * Typed client for the Trust Gateway. The session JWT lives in a cookie so a page refresh keeps you
 * signed in; the DID private key never leaves IndexedDB (see lib/did.ts).
 */
"use client";

import type {
  AccessDecisionResponse,
  Action,
  AssetClass,
  AttestationBody,
  DemoScenario,
  EnrolmentDecideBody,
  EnrolmentStatus,
  EnrolmentSummary,
  Health,
  Locale,
  LoginCompleteResponse,
  LoginStartResponse,
  OnboardCompleteResponse,
  OnboardStartResponse,
  PolicyVersion,
  ProofOfAction,
  ProofVerification,
  Role,
  Sensitivity,
  SignupStartResponse,
  SignupSubmitResponse,
  VerificationCheck,
  Verdict,
} from "@vajra/contracts";

export const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";

const SESSION_COOKIE = "vajra_session";
const SCENARIO_KEY = "vajra_scenario";

export class GatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

// ─── session cookie ──────────────────────────────────────────────────────────

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}
export function writeCookie(name: string, value: string, maxAgeSeconds = 3600): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
}
export function clearCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; path=/; max-age=0`;
}

export const getSession = () => readCookie(SESSION_COOKIE);
export const setSession = (jwt: string) => writeCookie(SESSION_COOKIE, jwt, 3600);
export const clearSession = () => clearCookie(SESSION_COOKIE);

// ─── admin console key ───────────────────────────────────────────────────────

/**
 * The console key arrives once, in the URL the operator was given, and then lives in
 * `sessionStorage` and travels as a header.
 *
 * sessionStorage and not a cookie or localStorage, deliberately: it dies with the tab, so closing
 * the browser closes the console, and it is never attached to a request the page did not make. The
 * gateway re-derives and re-checks it on every admin call — this is transport, not the control.
 */
const CONSOLE_KEY_STORAGE = "vajra_console_key";
export const CONSOLE_KEY_HEADER = "x-vajra-console-key";
export const CONSOLE_KEY_PARAM = "k";

export function getConsoleKey(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return sessionStorage.getItem(CONSOLE_KEY_STORAGE);
  } catch {
    return null; // private mode, or site data blocked
  }
}

export function setConsoleKey(key: string | null): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (key) sessionStorage.setItem(CONSOLE_KEY_STORAGE, key);
    else sessionStorage.removeItem(CONSOLE_KEY_STORAGE);
  } catch {
    /* nothing to do: the gateway will refuse and the gate will say why */
  }
}

/**
 * Whether this tab holds anything the gateway will accept as a caller.
 *
 * Two credentials now qualify, and every "are we signed in?" check in the UI has to ask about both
 * or it will send an operator who followed the issued console link straight back to the login
 * screen. That was the exact shape of the bug: `!getSession()` is true for a console session — the
 * link never mints a cookie — so the console redirected to /login while the gateway was perfectly
 * willing to serve it.
 *
 * This is a courtesy check for routing and for skipping pointless fetches. It decides nothing: the
 * gateway re-derives both credentials on every single request.
 */
export const isAuthenticated = (): boolean => !!getSession() || !!getConsoleKey();

/**
 * The attestation a console session presents where a face would otherwise go.
 *
 * A console session is authenticated by the issued admin link, not by a login, so there is no
 * enrolled face to match and no browser-held private key in IndexedDB to sign the nonce with. The
 * gateway knows this and skips the signature check for such a session
 * (modules/identity/attestation.ts, `verifySessionAttestation`) — but the request body still has to
 * satisfy AttestationBodySchema, so this is the shape it satisfies it with.
 *
 * `livenessMode: "simulated"` is not a placeholder chosen for convenience. In this system's own
 * vocabulary "simulated" already means exactly this: no real capture was checked. Sending "faceapi"
 * would put a false claim into a decision trace an auditor reads later. The gateway records the
 * more precise `mode: "console"` on the attestation row itself.
 *
 * The signature field is a sentence rather than a fake signature, for the same reason.
 */
export function consoleAttestation(nonce: string): AttestationBody {
  return { nonce, signature: "authorised-by-issued-console-link", livenessMode: "simulated" };
}

export function getScenario(): DemoScenario | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SCENARIO_KEY);
    return raw ? (JSON.parse(raw) as DemoScenario) : null;
  } catch {
    return null;
  }
}
export function setScenario(s: DemoScenario | null): void {
  if (typeof localStorage === "undefined") return;
  if (s) localStorage.setItem(SCENARIO_KEY, JSON.stringify(s));
  else localStorage.removeItem(SCENARIO_KEY);
}

// ─── core request ────────────────────────────────────────────────────────────

interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  auth?: boolean;
  scenario?: boolean;
  locale?: Locale;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) {
    const token = getSession();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  if (opts.scenario !== false) {
    const scenario = getScenario();
    if (scenario) headers["x-vajra-demo-context"] = JSON.stringify(scenario);
  }
  // Presented on every call, not only the admin ones: the gateway decides what needs it, and a
  // page that guessed wrong would fail with a refusal the operator cannot act on.
  const consoleKey = getConsoleKey();
  if (consoleKey) headers[CONSOLE_KEY_HEADER] = consoleKey;
  if (opts.locale) headers["accept-language"] = opts.locale;
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${GATEWAY}${path}`, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: opts.signal,
    });
  } catch (e) {
    throw new GatewayError("network", (e as Error).message, 0);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details?: unknown } })?.error;
    throw new GatewayError(err?.code ?? "unknown", err?.message ?? res.statusText, res.status, err?.details);
  }
  return data as T;
}

// ─── shapes the UI consumes ──────────────────────────────────────────────────

export interface Me {
  user: { id: string; did: string; displayName: string; role: Role; status: string; identityTrust: number; createdAt: string };
  device: { id: string; deviceTrust: number; trusted: boolean; label: string | null } | null;
  permissions: Partial<Record<Action, "allow" | "step_up" | "deny">>;
  incident: IncidentSummary | null;
  fresh: boolean;
  /** False when this connection is outside ADMIN_IP_ALLOWLIST; the gateway still enforces it. */
  adminNetwork: boolean;
  /** False when this tab did not arrive through the issued console link. Also gateway-enforced. */
  adminConsole: boolean;
  /**
   * True when the issued console link is what authenticated this call — there is no face-verified
   * login behind it. Distinct from `adminConsole`, which only says the link was PRESENTED: an
   * administrator who signed in with their face and then opened the console has `adminConsole:
   * true` and `consoleSession: false`, and must still be asked for liveness proofs, because they
   * can give one.
   *
   * The console reads this to skip a step-up dialog that would otherwise open, ask for a face and
   * find no browser-held key to sign the nonce with.
   */
  consoleSession: boolean;
}

export interface AssetSummary {
  assetUid: string;
  name: string;
  class: AssetClass;
  sensitivity: Sensitivity;
  ownerDid: string;
  ownerName: string | null;
  owned: boolean;
  currentVersion: number;
  lineageType: string;
  assetTrust: number;
  createdAt: string;
}

export interface Passport {
  assetUid: string;
  name: string;
  mime: string;
  class: AssetClass;
  sensitivity: Sensitivity;
  owner: { did: string; displayName: string | null; status: string };
  creator: { did: string; displayName: string | null };
  createdAt: string;
  currentVersion: number;
  versions: { version: number; sha256: string; sha256Cipher: string; cid: string; sizeBytes: number; status: string; ledgerTxId: string | null; block: number | null; createdBy: string; createdAt: string; parentSha256: string | null }[];
  lineage: {
    type: string;
    parent: { assetUid: string; name: string; sensitivity: string } | null;
    children: { assetUid: string; name: string; lineageType: string; sensitivity: string }[];
    derivativeStatus: string;
  };
  transfers: { fromDid: string; toDid: string; approverDid: string | null; ledgerTxId: string | null; block: number | null; at: string }[];
  trust: { score: number; breakdown: { key: string; points: number; max: number }[] };
  verification: { integrity: boolean; ownership: boolean; origin: boolean };
  stats: { accessEvents: number; lastAccess: string | null; approvals: number; incidents30d: number; riskStatus: string };
  passportMeta: Record<string, string>;
  ledger: { record: unknown; latestTxId: string | null; latestBlock: number | null };
}

export interface CustodyEvent {
  seq: number;
  at: string;
  eventType: string;
  who: { did: string; displayName: string | null; role: string | null } | null;
  action: string | null;
  decision: string | null;
  reasons: string[];
  policy: { key: string; version: number; hash: string } | null;
  risk: { score: number; tier: string } | null;
  approval: { status: string; approverDid: string | null } | null;
  chainHash: string;
  ledgerTxId: string | null;
  block: number | null;
  incidentId: string | null;
  payload: Record<string, unknown>;
}

export interface GraphData {
  nodes: { id: string; kind: string; label: string; meta?: Record<string, unknown> }[];
  edges: { from: string; to: string; label: string }[];
}

export interface AuditEvent {
  id: string;
  seq: number;
  eventType: string;
  actorDid: string | null;
  assetUid: string | null;
  requestId: string | null;
  incidentId: string | null;
  payload: Record<string, unknown>;
  payloadHash: string;
  prevHash: string;
  chainHash: string;
  ledgerTxId: string | null;
  block: number | null;
  anchoredAt: string | null;
  createdAt: string;
}

export interface IncidentSummary {
  incidentId: string;
  actorDid: string;
  severity: "S1" | "S2" | "S3";
  status: "open" | "resolved" | "false_positive";
  openedAt: string;
  closedAt: string | null;
  closedBy: string | null;
  closeReason: string | null;
  peakRisk: number;
  summary: string;
  signals: string[];
  responses: string[];
  ledgerTxId: string | null;
  block: number | null;
}

export type TimelineItem =
  | { at: string; kind: "audit"; eventType: string; seq: number; chainHash: string; ledgerTxId: string | null; block: number | null; assetUid: string | null; requestId: string | null; inIncident: boolean; payload: Record<string, unknown> }
  | { at: string; kind: "trust"; reason: string; delta: number; scoreAfter: number };

export interface ApprovalItem {
  id: string;
  requestId: string;
  status: string;
  requiredRole: string;
  requester: { did: string; displayName: string | null; role: string | null; identityTrust: number | null };
  approverDid: string | null;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  request: { action: string; assetUid: string | null; toDid: string | null; risk: { score: number; tier: string; signals: string[] }; trust: { identity: number; device: number }; trace: unknown; decidedAt: string } | null;
}

/** One recorded face check, as the admin console reads it back. */
export interface FaceVerificationRow {
  id: string;
  did: string;
  employeeId: string | null;
  purpose: "signup" | "login";
  passed: boolean;
  faceMatchScore: number;
  livenessScore: number;
  livenessSignals: Record<string, number>;
  livenessMode: string;
  checks: VerificationCheck[];
  bundleHash: string;
  imageSha256: string;
  imageCid: string;
  imageSizeBytes: number;
  ledgerTxId: string | null;
  block: number | null;
  anchoredAt: string | null;
  auditEventId: string | null;
  createdAt: string;
}

export interface Stats {
  decisions24h: number;
  denied24h: number;
  auditEvents: number;
  anchoredEvents: number;
  pendingAnchors: number;
  openIncidents: number;
  assets: number;
  identities: number;
  proofs: number;
  ledgerBlocks: number;
  decisionP95Ms: number;
  chainIntact: boolean;
  pendingEnrolments: number;
  faceChecks: number;
  faceChecksRefused: number;
  faceImageBytesStored: number;
  faceImagesEncrypted: boolean;
}

export interface IdentityRow {
  id: string;
  did: string;
  displayName: string;
  role: Role;
  status: string;
  identityTrust: number;
  createdAt: string;
  devices: { id: string; label: string | null; deviceTrust: number; trusted: boolean; lastSeen: string }[];
  credential: { status: string; vcHash: string; issuedAt: string; ledgerTxId: string | null } | null;
}

export interface Narrative {
  text: string;
  source: "template" | "claude";
  model?: string;
  locale: Locale;
  disclaimer: string;
}

export interface RequestRow {
  id: string;
  actorDid: string;
  assetUid: string | null;
  action: string;
  actionClass: string;
  decision: Verdict;
  reasons: string[];
  trace: unknown;
  risk: { score: number; tier: string; signals: string[] };
  trust: { identity: number; device: number; asset: number | null };
  policyVersionId: string | null;
  stepUpRequired: boolean;
  stepUpOk: boolean | null;
  approvalId: string | null;
  certId: string | null;
  incidentId: string | null;
  latencyMs: number;
  decidedAt: string;
  finalizedAt: string | null;
  context: { deviceId: string | null; localHour: number | null; city: string | null };
}

// ─── endpoints ───────────────────────────────────────────────────────────────

export const api = {
  health: () => request<Health & { analyst: { mode: string; ready: boolean; detail: string }; pendingAnchors: number }>("/v1/health", { auth: false, scenario: false }),
  stats: () => request<Stats>("/v1/stats", { auth: false, scenario: false }),

  onboardStart: () => request<OnboardStartResponse>("/v1/onboard/start", { method: "POST", auth: false }),
  onboardComplete: (body: unknown) => request<OnboardCompleteResponse>("/v1/onboard/complete", { body, auth: false }),

  // ── enrolment: signup → admin decision → login ──
  signupStart: () => request<SignupStartResponse>("/v1/auth/signup/start", { method: "POST", auth: false }),
  signupSubmit: (form: FormData) => request<SignupSubmitResponse>("/v1/auth/signup/submit", { form, auth: false }),
  signupStatus: (id: string) =>
    request<{ id: string; employeeId: string; status: EnrolmentStatus; decidedAt: string | null; decisionReason: string | null }>(
      `/v1/auth/signup/${encodeURIComponent(id)}/status`,
      { auth: false },
    ),
  loginStart: (employeeId: string) => request<LoginStartResponse>("/v1/auth/login/start", { body: { employeeId }, auth: false }),
  loginComplete: (form: FormData) => request<LoginCompleteResponse>("/v1/auth/login/complete", { form, auth: false }),

  enrolments: (status?: string) => request<EnrolmentSummary[]>(`/v1/admin/enrolments${status ? `?status=${status}` : ""}`),
  enrolmentChallenge: (id: string) => request<{ nonce: string; challenge: string[]; expiresAt: string }>(`/v1/admin/enrolments/${id}/challenge`, { method: "POST" }),
  enrolmentDecide: (id: string, body: EnrolmentDecideBody) => request<EnrolmentSummary>(`/v1/admin/enrolments/${id}/decide`, { body }),
  /** Authenticated image fetch: the session lives in a cookie the <img> tag cannot send as a bearer. */
  enrolmentImage: async (id: string, which: "id-document" | "face"): Promise<string> => {
    const res = await fetch(`${GATEWAY}/v1/admin/enrolments/${id}/image/${which}`, {
      headers: { authorization: `Bearer ${getSession() ?? ""}`, [CONSOLE_KEY_HEADER]: getConsoleKey() ?? "" },
    });
    if (!res.ok) throw new GatewayError("image_unavailable", `${res.status}`, res.status);
    return URL.createObjectURL(await res.blob());
  },
  verifications: (params: { did?: string; purpose?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.did) q.set("did", params.did);
    if (params.purpose) q.set("purpose", params.purpose);
    if (params.limit) q.set("limit", String(params.limit));
    return request<FaceVerificationRow[]>(`/v1/admin/verifications?${q.toString()}`);
  },
  me: () => request<Me>("/v1/me"),
  myTrust: () => request<{ identity: TrustEventRow[]; device: TrustEventRow[] }>("/v1/me/trust"),

  assets: () => request<AssetSummary[]>("/v1/assets"),
  uploadAsset: (form: FormData) => request<{ assetUid: string; name: string; sensitivity: string; class: string; version: number; sha256: string; cid: string; trust: number; derivativeStatus: string }>("/v1/assets", { form }),
  passport: (uid: string) => request<Passport>(`/v1/assets/${encodeURIComponent(uid)}/passport`),
  custody: (uid: string) => request<CustodyEvent[]>(`/v1/assets/${encodeURIComponent(uid)}/custody`),
  lineage: (uid: string) => request<unknown>(`/v1/assets/${encodeURIComponent(uid)}/lineage`),
  graph: (uid: string) => request<GraphData>(`/v1/assets/${encodeURIComponent(uid)}/graph`),

  requestAccess: (uid: string, body: { action: Action; context: { deviceId: string; ip?: string; localHour?: number; reason?: string; geo?: { lat: number; lng: number; city?: string } }; toDid?: string }) =>
    request<AccessDecisionResponse>(`/v1/assets/${encodeURIComponent(uid)}/request`, { body }),
  stepUp: (requestId: string, body: AttestationBody) => request<AccessDecisionResponse>(`/v1/requests/${requestId}/step-up`, { body }),
  requests: (limit = 50) => request<RequestRow[]>(`/v1/requests?limit=${limit}`),

  approvals: () => request<{ inbox: ApprovalItem[]; mine: ApprovalItem[] }>("/v1/approvals"),
  approvalChallenge: (id: string) => request<{ nonce: string; challenge: string[]; expiresAt: string }>(`/v1/approvals/${id}/challenge`, { method: "POST" }),
  approvalDecide: (id: string, body: { approve: boolean; reason?: string; attestation: AttestationBody }) =>
    request<{ approvalId: string; status: string; verdict: Verdict; certId?: string; contentUrl?: string | null; latencyMs: number }>(`/v1/approvals/${id}/decide`, { body }),

  policies: () => request<PolicyVersion[]>("/v1/policies"),
  createPolicy: (spec: unknown) => request<PolicyVersion>("/v1/policies", { body: spec }),

  audit: (params: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
    return request<AuditEvent[]>(`/v1/audit?${q.toString()}`);
  },
  auditProof: (id: string) =>
    request<{ event: AuditEvent; recomputedChainHash: string; chainIntact: boolean; onChain: unknown; onChainMatches: boolean; ledgerError: string | null }>(`/v1/audit/${id}/proof`),
  auditVerify: () => request<{ ok: boolean; checked: number; brokenAtSeq: number | null }>("/v1/audit/verify"),

  proof: (certId: string) => request<ProofOfAction>(`/v1/proofs/${encodeURIComponent(certId)}`),
  verifyProof: (proof: unknown) => request<ProofVerification>("/v1/verify/proof", { body: { proof } }),
  verifyEvidence: (pkg: unknown) => request<{ valid: boolean; checks: { id: string; ok: boolean; detailKey: string }[]; packageId: string; incidentId: string; events: number; proofs: number }>("/v1/verify/evidence", { body: { package: pkg } }),

  incidents: (params: { status?: string; mine?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.mine) q.set("mine", "true");
    return request<IncidentSummary[]>(`/v1/incidents?${q.toString()}`);
  },
  incidentTimeline: (id: string) => request<{ incident: IncidentSummary; items: TimelineItem[] }>(`/v1/incidents/${encodeURIComponent(id)}/timeline`),
  incidentEvidence: (id: string) => request<Record<string, unknown>>(`/v1/incidents/${encodeURIComponent(id)}/evidence`),
  incidentCloseChallenge: (id: string) => request<{ nonce: string; challenge: string[]; expiresAt: string }>(`/v1/incidents/${encodeURIComponent(id)}/close/challenge`, { method: "POST" }),
  incidentClose: (id: string, body: { status: "resolved" | "false_positive"; reason: string; attestation: AttestationBody }) =>
    request<IncidentSummary>(`/v1/incidents/${encodeURIComponent(id)}/close`, { body }),

  timetravel: (params: { at: string; did?: string; assetUid?: string }) => {
    const q = new URLSearchParams({ at: params.at });
    if (params.did) q.set("did", params.did);
    if (params.assetUid) q.set("assetUid", params.assetUid);
    return request<Record<string, unknown>>(`/v1/timetravel?${q.toString()}`);
  },

  identities: () => request<IdentityRow[]>("/v1/identities"),
  revokeChallenge: (did: string) => request<{ nonce: string; challenge: string[]; expiresAt: string }>(`/v1/identities/${encodeURIComponent(did)}/revoke/challenge`, { method: "POST" }),
  revoke: (did: string, body: { reason: string; attestation: AttestationBody }) =>
    request<{ did: string; steps: { step: string; count: number }[]; auditEventId: string }>(`/v1/identities/${encodeURIComponent(did)}/revoke`, { body }),

  explain: (body: { kind: "decision" | "incident" | "passport"; id: string; locale: Locale }) => request<Narrative>("/v1/analyst/explain", { body }),
  ask: (question: string) => request<{ filter: Record<string, unknown>; events: AuditEvent[]; count: number; disclaimer: string }>("/v1/analyst/query", { body: { question } }),
  draftPolicy: (description: string) => request<{ draft: Record<string, unknown>; source: string; valid: boolean; issues: string[]; disclaimer: string }>("/v1/analyst/policy-draft", { body: { description } }),

  ledgerBlocks: (limit = 12) =>
    request<{ mode: string; blocks: { number: number; txId: string; prevHash: string; blockHash: string; contract: string; fn: string; at: string }[]; verification: { ok: boolean; blocks: number; brokenAt: number | null } | null; pending: number }>(`/v1/ledger/blocks?limit=${limit}`),

  demoPresets: () => request<{ presets: Record<string, DemoScenario & { label: string }> }>("/v1/demo/presets", { auth: false }),
  demoReset: () => request<{ ok: boolean; users: { role: Role; did: string; name: string }[] }>("/v1/demo/reset", { method: "POST", auth: false }),
  demoLogin: (role: Role) => request<{ sessionJwt: string; user: Me["user"]; device: { id: string; deviceTrust: number; trusted: boolean } }>("/v1/demo/login", { body: { role }, auth: false }),
  demoSign: (nonce: string) => request<{ signature: string; livenessMode: "simulated" }>("/v1/demo/sign", { body: { nonce } }),
  demoOutage: (dependency: "db" | "ledger" | "risk" | "storage", down: boolean) => request<Health>("/v1/demo/outage", { body: { dependency, down }, auth: false }),
  demoDrain: () => request<{ committed: number; pending: number }>("/v1/demo/drain", { method: "POST", auth: false }),
};

export interface TrustEventRow {
  id: string;
  subjectType: string;
  subjectId: string;
  delta: number;
  reason: string;
  scoreAfter: number;
  refId: string | null;
  createdAt: string;
}

export const contentUrl = (path: string): string => `${GATEWAY}${path}`;
