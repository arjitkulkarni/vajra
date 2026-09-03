/**
 * @vajra/policy — the decision engine as a pure function.
 *
 *   decide(input) → { verdict, trace, reasons, policyVersion, approval, actionClass }
 *
 * Order (see ARCHITECTURE.md §4.2):
 *   1 fail-closed gate · 2 identity gate · 3 RBAC · 4 explicit denies · 5 ABAC ·
 *   6 trust gates · 7 risk overlay · 8 approval overlay · 9 (caller) emit audit event.
 *
 * Every check is recorded in a DecisionTrace so the UI can explain the verdict verbatim.
 */
import {
  tierRank,
  type Action,
  type ActionClass,
  type AssetClass,
  type DecisionTrace,
  type Dependency,
  type EffectivePermissions,
  type IncidentSeverity,
  type PolicyVersion,
  type RiskResult,
  type RiskTier,
  type Role,
  type Sensitivity,
  type TraceCheck,
  type UserStatus,
  type Verdict,
} from "@vajra/contracts";
import { gateOutcome, TRUST_GATES } from "@vajra/trust";

// ─── Static tables ───────────────────────────────────────────────────────────

/** What each role may attempt at all. Policies refine this; they never widen it. */
export const ROLE_ACTIONS: Record<Role, Action[]> = {
  engineer: ["asset.view", "asset.open", "asset.download", "asset.transfer"],
  manager: ["asset.view", "asset.open", "asset.download", "asset.transfer", "asset.export"],
  auditor: ["asset.view"],
  admin: [
    "asset.view",
    "asset.open",
    "asset.download",
    "asset.transfer",
    "asset.export",
    "asset.delete",
    "policy.edit",
    "identity.revoke",
  ],
};

export function actionClassFor(action: Action, sensitivity: Sensitivity): ActionClass {
  switch (action) {
    case "asset.view":
      return "low";
    case "asset.open":
      return sensitivity === "high" ? "medium" : "low";
    case "asset.download":
      return sensitivity === "high" ? "high" : "medium";
    case "asset.transfer":
    case "asset.export":
      return sensitivity === "low" ? "medium" : "high";
    case "asset.delete":
    case "policy.edit":
    case "identity.revoke":
      return "critical";
  }
}

export const REQUIRED_DEPS: Record<ActionClass, Dependency[]> = {
  low: ["db"],
  medium: ["db", "risk"],
  high: ["db", "risk", "ledger"],
  critical: ["db", "risk", "ledger"],
};

export const isSensitiveClass = (c: ActionClass): boolean => c === "high" || c === "critical";

// ─── Input / output ──────────────────────────────────────────────────────────

export interface DecisionInput {
  user: { did: string; role: Role; status: UserStatus; vcRevoked: boolean };
  sessionValid: boolean;
  asset: { uid: string; class: AssetClass; sensitivity: Sensitivity; ownerDid: string } | null;
  action: Action;
  context: { localHour: number; deviceTrusted: boolean };
  trust: { identity: number; device: number };
  risk: RiskResult;
  policies: PolicyVersion[];
  health: Partial<Record<Dependency, boolean>>;
  incidentSeverity?: IncidentSeverity | null;
  hasGrant?: boolean;
  now?: Date;
}

export interface ApprovalRequirement {
  approverRole: Role;
  count: number;
  distinctFromRequester: boolean;
}

export interface DecisionOutput {
  verdict: Verdict;
  actionClass: ActionClass;
  sensitive: boolean;
  trace: DecisionTrace;
  reasons: string[];
  policyVersion: PolicyVersion | null;
  approval: ApprovalRequirement | null;
  /** What the verdict becomes once a STEP_UP attestation is verified. */
  afterStepUp: Verdict;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isActiveAt(p: PolicyVersion, now: Date): boolean {
  const from = new Date(p.activeFrom).getTime();
  const to = p.activeTo ? new Date(p.activeTo).getTime() : Number.POSITIVE_INFINITY;
  const t = now.getTime();
  return from <= t && t < to;
}

function policyMatches(p: PolicyVersion, input: DecisionInput): boolean {
  const s = p.spec;
  if (s.action !== input.action) return false;
  if (!s.subject.role.includes(input.user.role)) return false;
  if (input.asset) {
    if (s.resource.class && !s.resource.class.includes(input.asset.class)) return false;
    if (s.resource.sensitivity && !s.resource.sensitivity.includes(input.asset.sensitivity)) return false;
  }
  return true;
}

function withinHours(localHour: number, window: [number, number]): boolean {
  const [start, end] = window;
  if (start === end) return true;
  if (start < end) return localHour >= start && localHour < end;
  // overnight window, e.g. [22, 6)
  return localHour >= start || localHour < end;
}

const ref = (p: PolicyVersion) => ({ id: p.id, key: p.key, version: p.version, hash: p.hash });

// ─── The decision ────────────────────────────────────────────────────────────

export function decide(input: DecisionInput): DecisionOutput {
  const now = input.now ?? new Date();
  const checks: TraceCheck[] = [];
  const reasons: string[] = [];
  let stepUp = false;
  let approval: ApprovalRequirement | null = null;
  let effective: PolicyVersion | null = null;

  const sensitivity: Sensitivity = input.asset?.sensitivity ?? "high";
  const actionClass = actionClassFor(input.action, sensitivity);
  const sensitive = isSensitiveClass(actionClass);

  const fail = (check: TraceCheck, reason: string) => {
    checks.push({ ...check, result: "fail" });
    reasons.push(reason);
  };

  // 1 ── fail-closed gate
  for (const dep of REQUIRED_DEPS[actionClass]) {
    const ok = input.health[dep] !== false;
    const check: TraceCheck = { id: `dependency:${dep}`, labelKey: "trace.dependency", params: { dep }, result: "pass" };
    if (ok) checks.push(check);
    else fail(check, `dependency_down:${dep}`);
  }

  // 2 ── identity gate
  {
    const check: TraceCheck = { id: "identity", labelKey: "trace.identity", result: "pass" };
    if (!input.sessionValid) fail({ ...check, detailKey: "trace.detail.session_invalid" }, "session_invalid");
    else if (input.user.status === "revoked" || input.user.vcRevoked)
      fail({ ...check, detailKey: "trace.detail.identity_revoked" }, "identity_revoked");
    else if (input.user.status === "suspended")
      fail({ ...check, detailKey: "trace.detail.identity_suspended" }, "identity_suspended");
    else checks.push(check);
  }

  // 3 ── RBAC: role table ∩ matching active policies
  const roleAllows = ROLE_ACTIONS[input.user.role].includes(input.action);
  const matching = input.policies.filter((p) => isActiveAt(p, now) && policyMatches(p, input));
  const nonDeny = matching.filter((p) => p.spec.effect !== "deny");
  {
    const check: TraceCheck = {
      id: "role",
      labelKey: "trace.role",
      params: { role: input.user.role, action: input.action },
      result: "pass",
    };
    if (!roleAllows) fail({ ...check, detailKey: "trace.detail.role_forbids" }, "role_forbids");
    else if (nonDeny.length === 0) fail({ ...check, detailKey: "trace.detail.no_policy" }, "no_policy");
    else checks.push(check);
  }

  // 4 ── explicit denies (highest priority wins)
  const top = [...matching].sort((a, b) => b.spec.priority - a.spec.priority)[0] ?? null;
  if (top && top.spec.effect === "deny") {
    fail(
      { id: "policy", labelKey: "trace.policy_deny", params: { key: top.key, version: top.version }, result: "fail" },
      `policy_deny:${top.key}`,
    );
  } else {
    effective = [...nonDeny].sort((a, b) => b.spec.priority - a.spec.priority)[0] ?? null;
    if (effective)
      checks.push({
        id: "policy",
        labelKey: "trace.policy",
        params: { key: effective.key, version: effective.version },
        result: "pass",
      });
  }

  // ownership for transfer / delete
  if (input.asset && (input.action === "asset.transfer" || input.action === "asset.delete")) {
    const owner = input.asset.ownerDid === input.user.did;
    const check: TraceCheck = { id: "ownership", labelKey: "trace.ownership", result: "pass" };
    if (owner || input.user.role === "admin" || input.hasGrant) checks.push(check);
    else fail({ ...check, detailKey: "trace.detail.not_owner" }, "not_owner");
  }

  // 5 ── ABAC conditions of the effective policy
  if (effective) {
    const c = effective.spec.condition;
    if (c.hours) {
      const ok = withinHours(input.context.localHour, c.hours);
      const check: TraceCheck = {
        id: "hours",
        labelKey: "trace.hours",
        params: { hour: input.context.localHour, start: c.hours[0], end: c.hours[1] },
        result: "pass",
      };
      if (ok) checks.push(check);
      else fail({ ...check, detailKey: "trace.detail.outside_hours" }, "outside_hours");
    }
    if (c.deviceTrusted) {
      const check: TraceCheck = { id: "device", labelKey: "trace.device", result: "pass" };
      if (input.context.deviceTrusted) checks.push(check);
      else fail({ ...check, detailKey: "trace.detail.device_untrusted", params: { trust: input.trust.device } }, "device_untrusted");
    }
    if (c.maxRiskTier && tierRank(input.risk.tier) > tierRank(c.maxRiskTier)) {
      fail(
        {
          id: "policy_risk",
          labelKey: "trace.policy_risk",
          params: { tier: input.risk.tier, max: c.maxRiskTier },
          result: "fail",
        },
        "risk_above_policy",
      );
    }
  }

  // 6 ── trust gates
  {
    const gate = TRUST_GATES[actionClass];
    const idOutcome = gateOutcome(input.trust.identity, gate.identity);
    const idCheck: TraceCheck = {
      id: "trust_identity",
      labelKey: "trace.trust_identity",
      params: { score: input.trust.identity, soft: gate.identity.soft, hard: gate.identity.hard },
      result: "pass",
    };
    if (idOutcome === "deny") fail({ ...idCheck, detailKey: "trace.detail.trust_identity_low" }, "trust_identity_low");
    else if (idOutcome === "step_up") {
      checks.push({ ...idCheck, result: "warn", detailKey: "trace.detail.trust_identity_soft" });
      stepUp = true;
    } else checks.push(idCheck);

    const devOutcome = gateOutcome(input.trust.device, gate.device);
    const devCheck: TraceCheck = {
      id: "trust_device",
      labelKey: "trace.trust_device",
      params: { score: input.trust.device, soft: gate.device.soft, hard: gate.device.hard },
      result: "pass",
    };
    if (devOutcome === "deny") fail({ ...devCheck, detailKey: "trace.detail.trust_device_low" }, "trust_device_low");
    else if (devOutcome === "step_up") {
      checks.push({ ...devCheck, result: "warn", detailKey: "trace.detail.trust_device_soft" });
      stepUp = true;
    } else checks.push(devCheck);
  }

  // 7 ── risk overlay
  {
    const check: TraceCheck = {
      id: "risk",
      labelKey: "trace.risk",
      params: { score: input.risk.score, tier: input.risk.tier },
      signals: input.risk.signals,
      result: "pass",
    };
    if (input.risk.tier === "high") fail({ ...check, detailKey: "trace.detail.risk_high" }, "risk_high");
    else if (input.risk.tier === "elevated") {
      checks.push({ ...check, result: "warn", detailKey: "trace.detail.risk_elevated" });
      stepUp = true;
    } else checks.push(check);
  }

  // incident overlay (adaptive privileges while an incident is open)
  if (input.incidentSeverity) {
    const check: TraceCheck = {
      id: "incident",
      labelKey: "trace.incident",
      params: { severity: input.incidentSeverity },
      result: "pass",
    };
    if (input.incidentSeverity === "S1") {
      checks.push({ ...check, result: "warn", detailKey: "trace.detail.incident_step_up" });
      stepUp = true;
    } else if (sensitive) fail({ ...check, detailKey: "trace.detail.incident_frozen" }, "incident_active");
    else {
      checks.push({ ...check, result: "warn", detailKey: "trace.detail.incident_step_up" });
      stepUp = true;
    }
  }

  // sensitive actions always require a fresh liveness proof
  if (sensitive) stepUp = true;
  if (effective?.spec.effect === "step_up") stepUp = true;

  // 8 ── approval overlay
  if (effective?.spec.effect === "require_approval") {
    const a = effective.spec.approval ?? { approverRole: "manager" as Role, count: 1, distinctFromRequester: true };
    approval = { approverRole: a.approverRole, count: a.count, distinctFromRequester: a.distinctFromRequester };
  } else if (actionClass === "critical") {
    approval = { approverRole: input.user.role === "admin" ? "admin" : "manager", count: 1, distinctFromRequester: true };
  }
  if (approval) {
    stepUp = true;
    checks.push({
      id: "approval",
      labelKey: "trace.approval",
      params: { role: approval.approverRole, count: approval.count },
      result: "warn",
      detailKey: "trace.detail.approval_required",
    });
  }

  // verdict
  let verdict: Verdict;
  if (reasons.length > 0) verdict = "DENY";
  else if (stepUp) verdict = "STEP_UP";
  else verdict = "ALLOW";
  const afterStepUp: Verdict = reasons.length > 0 ? "DENY" : approval ? "PENDING_APPROVAL" : "ALLOW";

  const trace: DecisionTrace = {
    verdict,
    actionClass,
    policyVersion: effective ? ref(effective) : null,
    checks,
    reasons,
  };

  return { verdict, actionClass, sensitive, trace, reasons, policyVersion: effective, approval, afterStepUp };
}

// ─── Effective permissions (adaptive privileges) ─────────────────────────────

export interface PermissionInput {
  role: Role;
  trust: { identity: number; device: number };
  riskTier: RiskTier;
  incidentSeverity?: IncidentSeverity | null;
  sensitivity?: Sensitivity;
  revoked?: boolean;
}

/** What the user can do *right now*, under current trust conditions. */
export function effectivePermissions(p: PermissionInput): EffectivePermissions {
  const out: EffectivePermissions = {};
  const sens = p.sensitivity ?? "high";
  for (const action of ROLE_ACTIONS[p.role]) {
    if (p.revoked) {
      out[action] = "deny";
      continue;
    }
    const cls = actionClassFor(action, sens);
    const gate = TRUST_GATES[cls];
    const id = gateOutcome(p.trust.identity, gate.identity);
    const dev = gateOutcome(p.trust.device, gate.device);
    let state: "allow" | "step_up" | "deny" = "allow";
    if (id === "deny" || dev === "deny" || p.riskTier === "high") state = "deny";
    else if (p.incidentSeverity && p.incidentSeverity !== "S1" && isSensitiveClass(cls)) state = "deny";
    else if (id === "step_up" || dev === "step_up" || p.riskTier === "elevated" || isSensitiveClass(cls) || p.incidentSeverity)
      state = "step_up";
    out[action] = state;
  }
  return out;
}
