import { describe, expect, it } from "vitest";
import type { PolicyVersion, RiskResult } from "@vajra/contracts";
import { actionClassFor, decide, effectivePermissions, type DecisionInput } from "./index";

const pv = (n: number, spec: Partial<PolicyVersion["spec"]> & { key: string; action: PolicyVersion["spec"]["action"]; effect: PolicyVersion["spec"]["effect"] }): PolicyVersion => ({
  id: `pv-${n}`,
  key: spec.key,
  version: 1,
  hash: `hash-${n}`,
  activeFrom: "2026-01-01T00:00:00Z",
  activeTo: null,
  spec: {
    name: spec.key,
    subject: { role: ["engineer", "manager", "admin"] },
    resource: {},
    condition: {},
    priority: 100,
    ...spec,
  },
});

const POLICIES: PolicyVersion[] = [
  pv(1, { key: "POL-001", action: "asset.view", effect: "allow" }),
  pv(2, { key: "POL-002", action: "asset.open", effect: "allow" }),
  pv(9, {
    key: "POL-009",
    action: "asset.download",
    effect: "step_up",
    condition: { hours: [8, 20], deviceTrusted: true, maxRiskTier: "elevated" },
  }),
  pv(11, {
    key: "POL-011",
    action: "asset.transfer",
    effect: "require_approval",
    subject: { role: ["engineer", "manager", "admin"] },
    approval: { approverRole: "manager", count: 1, distinctFromRequester: true },
  }),
];

const lowRisk: RiskResult = { score: 12, tier: "low", signals: [] };

const base = (over: Partial<DecisionInput> = {}): DecisionInput => ({
  user: { did: "did:key:zA", role: "engineer", status: "active", vcRevoked: false },
  sessionValid: true,
  asset: { uid: "CAD-1", class: "design", sensitivity: "high", ownerDid: "did:key:zA" },
  action: "asset.view",
  context: { localHour: 11, deviceTrusted: true },
  trust: { identity: 88, device: 75 },
  risk: lowRisk,
  policies: POLICIES,
  health: { db: true, risk: true, ledger: true, storage: true },
  ...over,
});

describe("action classes", () => {
  it("scale with sensitivity", () => {
    expect(actionClassFor("asset.download", "high")).toBe("high");
    expect(actionClassFor("asset.download", "low")).toBe("medium");
    expect(actionClassFor("policy.edit", "low")).toBe("critical");
  });
});

describe("decide()", () => {
  it("allows a calm view by a trusted engineer and explains every check", () => {
    const d = decide(base());
    expect(d.verdict).toBe("ALLOW");
    expect(d.trace.checks.every((c) => c.result === "pass")).toBe(true);
    expect(d.trace.policyVersion?.key).toBe("POL-001");
  });

  it("steps up a high-sensitivity download even when everything is calm", () => {
    const d = decide(base({ action: "asset.download" }));
    expect(d.verdict).toBe("STEP_UP");
    expect(d.afterStepUp).toBe("ALLOW");
    expect(d.reasons).toEqual([]);
  });

  it("denies outside working hours and names the reason", () => {
    const d = decide(base({ action: "asset.download", context: { localHour: 2, deviceTrusted: true } }));
    expect(d.verdict).toBe("DENY");
    expect(d.reasons).toContain("outside_hours");
    expect(d.trace.checks.find((c) => c.id === "hours")?.result).toBe("fail");
  });

  it("denies on high risk with the signals attached", () => {
    const d = decide(
      base({
        action: "asset.download",
        context: { localHour: 2, deviceTrusted: false },
        trust: { identity: 42, device: 27 },
        risk: { score: 91, tier: "high", signals: ["new_device", "impossible_travel", "odd_hours"] },
      }),
    );
    expect(d.verdict).toBe("DENY");
    expect(d.reasons).toEqual(
      expect.arrayContaining(["outside_hours", "device_untrusted", "risk_high", "trust_identity_low", "trust_device_low"]),
    );
    expect(d.trace.checks.find((c) => c.id === "risk")?.signals).toContain("impossible_travel");
  });

  it("fails closed when the ledger is down for a sensitive action, but not for a view", () => {
    const health = { db: true, risk: true, ledger: false, storage: true };
    expect(decide(base({ action: "asset.transfer", user: { did: "did:key:zA", role: "manager", status: "active", vcRevoked: false }, health })).reasons).toContain(
      "dependency_down:ledger",
    );
    expect(decide(base({ action: "asset.view", health })).verdict).toBe("ALLOW");
  });

  it("routes transfers through step-up then two-person approval", () => {
    const d = decide(base({ action: "asset.transfer", user: { did: "did:key:zA", role: "manager", status: "active", vcRevoked: false } }));
    expect(d.verdict).toBe("STEP_UP");
    expect(d.afterStepUp).toBe("PENDING_APPROVAL");
    expect(d.approval).toEqual({ approverRole: "manager", count: 1, distinctFromRequester: true });
  });

  it("refuses transfers by non-owners and roles that lack the action", () => {
    const notOwner = decide(
      base({
        action: "asset.transfer",
        user: { did: "did:key:zB", role: "manager", status: "active", vcRevoked: false },
      }),
    );
    expect(notOwner.reasons).toContain("not_owner");
    const auditor = decide(base({ action: "asset.transfer", user: { did: "did:key:zA", role: "auditor", status: "active", vcRevoked: false } }));
    expect(auditor.reasons).toContain("role_forbids");
  });

  it("a revoked identity is denied before anything else matters", () => {
    const d = decide(base({ user: { did: "did:key:zA", role: "engineer", status: "revoked", vcRevoked: true } }));
    expect(d.verdict).toBe("DENY");
    expect(d.reasons).toEqual(["identity_revoked"]);
  });

  it("explicit deny policies win by priority", () => {
    const deny = { ...POLICIES[1]!, id: "pv-deny", key: "POL-099", spec: { ...POLICIES[1]!.spec, key: "POL-099", effect: "deny" as const, priority: 500 } };
    const d = decide(base({ action: "asset.open", policies: [...POLICIES, deny] }));
    expect(d.verdict).toBe("DENY");
    expect(d.reasons).toContain("policy_deny:POL-099");
  });

  it("an open S2 incident freezes sensitive actions and steps up the rest", () => {
    const frozen = decide(base({ action: "asset.download", incidentSeverity: "S2" }));
    expect(frozen.reasons).toContain("incident_active");
    const stepped = decide(base({ action: "asset.open", incidentSeverity: "S2" }));
    expect(stepped.verdict).toBe("STEP_UP");
  });
});

describe("effectivePermissions()", () => {
  it("shrinks privileges as trust drops", () => {
    const normal = effectivePermissions({ role: "manager", trust: { identity: 90, device: 85 }, riskTier: "low" });
    expect(normal["asset.view"]).toBe("allow");
    expect(normal["asset.transfer"]).toBe("step_up");
    const anomaly = effectivePermissions({ role: "manager", trust: { identity: 42, device: 27 }, riskTier: "elevated" });
    expect(anomaly["asset.view"]).toBe("step_up");
    expect(anomaly["asset.transfer"]).toBe("deny");
  });
  it("revocation denies everything", () => {
    const r = effectivePermissions({ role: "admin", trust: { identity: 100, device: 100 }, riskTier: "low", revoked: true });
    expect(Object.values(r).every((v) => v === "deny")).toBe(true);
  });
});
