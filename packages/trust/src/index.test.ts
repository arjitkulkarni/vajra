import { describe, expect, it } from "vitest";
import {
  applyDeviceTrust,
  applyIdentityTrust,
  computeAssetTrust,
  gateOutcome,
  isImpossibleTravel,
  scoreRisk,
  TRUST_GATES,
} from "./index";

describe("identity trust", () => {
  it("starts conservative and clamps within 0..100", () => {
    expect(applyIdentityTrust(0, "onboarded").next).toBe(60);
    expect(applyIdentityTrust(5, "liveness_failed").next).toBe(0);
    expect(applyIdentityTrust(99, "liveness_success").next).toBe(100);
  });
  it("decays on anomalies and recovers slowly", () => {
    let t = 96;
    t = applyIdentityTrust(t, "new_device").next; // 88
    t = applyIdentityTrust(t, "liveness_failed").next; // 73
    t = applyIdentityTrust(t, "incident_opened").next; // 43
    expect(t).toBe(43);
    t = applyIdentityTrust(t, "approval_received").next; // 48
    t = applyIdentityTrust(t, "clean_day").next; // 50
    expect(t).toBe(50);
  });
  it("clean days never push above the cap, but do not pull a higher score down", () => {
    expect(applyIdentityTrust(85, "clean_day").next).toBe(85);
    expect(applyIdentityTrust(92, "clean_day").next).toBe(92);
  });
  it("revocation zeroes trust; admin attestation sets a floor", () => {
    expect(applyIdentityTrust(70, "revoked").next).toBe(0);
    expect(applyIdentityTrust(40, "admin_attested").next).toBe(80);
    expect(applyIdentityTrust(90, "admin_attested").next).toBe(90);
  });
});

describe("device trust", () => {
  it("new devices start at 40 and earn trust through step-ups, capped at 80", () => {
    let d = applyDeviceTrust(0, "first_seen").next;
    expect(d).toBe(40);
    for (let i = 0; i < 6; i++) d = applyDeviceTrust(d, "step_up_success").next;
    expect(d).toBe(80);
  });
  it("loses trust on failed liveness and impossible travel", () => {
    expect(applyDeviceTrust(80, "liveness_failed").next).toBe(60);
    expect(applyDeviceTrust(60, "impossible_travel").next).toBe(35);
  });
});

describe("trust gates", () => {
  it("soft floor steps up, hard floor denies", () => {
    const g = TRUST_GATES.high.identity; // soft 65 hard 45
    expect(gateOutcome(70, g)).toBe("pass");
    expect(gateOutcome(50, g)).toBe("step_up");
    expect(gateOutcome(40, g)).toBe("deny");
  });
});

describe("asset trust", () => {
  const perfect = {
    originVerified: true,
    ownerValid: true,
    transferChainConsistent: true,
    versionsAnchored: 3,
    versionsTotal: 3,
    incidentsLast30d: 0,
    deniedAttempts: 0,
    trustedDeviceShare: 1,
    approvalsRequired: 2,
    approvalsPresent: 2,
    integrityOk: true,
    metadataComplete: true,
  };
  it("a fully verified asset scores 100 with a seven-part breakdown", () => {
    const r = computeAssetTrust(perfect);
    expect(r.score).toBe(100);
    expect(r.breakdown).toHaveLength(7);
    expect(r.breakdown.reduce((s, b) => s + b.max, 0)).toBe(100);
  });
  it("incidents and denied attempts reduce the access component", () => {
    expect(computeAssetTrust({ ...perfect, deniedAttempts: 3 }).score).toBe(94);
    expect(computeAssetTrust({ ...perfect, incidentsLast30d: 1 }).score).toBe(89);
  });
  it("a brand-new asset with no accesses is not penalised for having no device history", () => {
    const r = computeAssetTrust({ ...perfect, trustedDeviceShare: null, versionsAnchored: 1, versionsTotal: 1, approvalsRequired: 0, approvalsPresent: 0 });
    expect(r.score).toBe(100);
  });
});

describe("risk scoring", () => {
  const calm = {
    newDevice: false,
    impossibleTravel: false,
    failedLivenessRecent: 0,
    outsideBaselineHours: false,
    burstCount: 0,
    volumeRatio: 1,
    userAgeHours: 1000,
  };
  it("a calm request from a known device is low risk", () => {
    expect(scoreRisk(calm)).toEqual({ score: 0, tier: "low", signals: [] });
  });
  it("the insider scenario scores high with named signals", () => {
    const r = scoreRisk({ ...calm, newDevice: true, impossibleTravel: true, outsideBaselineHours: true, burstCount: 47, volumeRatio: 9 });
    expect(r.score).toBe(100);
    expect(r.tier).toBe("high");
    expect(r.signals).toEqual(["new_device", "impossible_travel", "odd_hours", "burst", "abnormal_volume"]);
  });
  it("new users get a conservative floor", () => {
    const r = scoreRisk({ ...calm, userAgeHours: 2 });
    expect(r.tier).toBe("elevated");
    expect(r.signals).toContain("new_user");
  });
});

describe("impossible travel", () => {
  const blr = { lat: 12.97, lng: 77.59 };
  const bom = { lat: 19.08, lng: 72.88 };
  it("Bengaluru to Mumbai in eight minutes is impossible", () => {
    const t0 = new Date("2026-08-26T02:00:00Z");
    const t1 = new Date("2026-08-26T02:08:00Z");
    expect(isImpossibleTravel({ ...blr, at: t0 }, { ...bom, at: t1 })).toBe(true);
  });
  it("the same trip over four hours is fine, and short hops are ignored", () => {
    const t0 = new Date("2026-08-26T02:00:00Z");
    const t1 = new Date("2026-08-26T06:00:00Z");
    expect(isImpossibleTravel({ ...blr, at: t0 }, { ...bom, at: t1 })).toBe(false);
    expect(isImpossibleTravel({ ...blr, at: t0 }, { lat: 12.98, lng: 77.6, at: new Date(t0.getTime() + 1000) })).toBe(false);
  });
});
