/**
 * @vajra/trust — pure trust mathematics. No I/O, fully unit-tested.
 *
 *  • identity trust  — persistent per person, decays on anomalies, recovers slowly
 *  • device trust    — persistent per device
 *  • asset trust     — recomputed from provenance/audit facts, with an explainable breakdown
 *  • request risk    — per-request score from contextual signals (explainable heuristics)
 *  • trust gates     — the floors each action class demands
 */
import {
  tierFor,
  type ActionClass,
  type RiskResult,
  type TrustBreakdownItem,
} from "@vajra/contracts";

export const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, Math.round(n)));

// ─── Trust gates ─────────────────────────────────────────────────────────────

export interface TrustGate {
  identity: { soft: number; hard: number };
  device: { soft: number; hard: number };
}

/** Soft floor ⇒ STEP_UP. Hard floor ⇒ DENY. */
export const TRUST_GATES: Record<ActionClass, TrustGate> = {
  low: { identity: { soft: 30, hard: 10 }, device: { soft: 20, hard: 0 } },
  medium: { identity: { soft: 50, hard: 30 }, device: { soft: 40, hard: 20 } },
  high: { identity: { soft: 65, hard: 45 }, device: { soft: 60, hard: 40 } },
  critical: { identity: { soft: 75, hard: 60 }, device: { soft: 70, hard: 50 } },
};

export type GateOutcome = "pass" | "step_up" | "deny";

export function gateOutcome(score: number, gate: { soft: number; hard: number }): GateOutcome {
  if (score < gate.hard) return "deny";
  if (score < gate.soft) return "step_up";
  return "pass";
}

// ─── Identity trust ──────────────────────────────────────────────────────────

export const IDENTITY_TRUST_INITIAL = 60;
export const IDENTITY_TRUST_CLEAN_CAP = 85;

export type IdentityTrustEvent =
  | "onboarded"
  | "liveness_success"
  | "liveness_failed"
  | "new_device"
  | "incident_opened"
  | "incident_false_positive"
  | "approval_received"
  | "clean_day"
  | "admin_attested"
  | "revoked";

export function applyIdentityTrust(current: number, event: IdentityTrustEvent): { next: number; delta: number } {
  let next = current;
  switch (event) {
    case "onboarded":
      next = IDENTITY_TRUST_INITIAL;
      break;
    case "liveness_success":
      next = current + 3;
      break;
    case "liveness_failed":
      next = current - 15;
      break;
    case "new_device":
      next = current - 8;
      break;
    case "incident_opened":
      next = current - 30;
      break;
    case "incident_false_positive":
      next = current + 30;
      break;
    case "approval_received":
      next = current + 5;
      break;
    case "clean_day":
      next = Math.min(current + 2, Math.max(current, IDENTITY_TRUST_CLEAN_CAP));
      break;
    case "admin_attested":
      next = Math.max(current, 80);
      break;
    case "revoked":
      next = 0;
      break;
  }
  next = clamp(next);
  return { next, delta: next - current };
}

// ─── Device trust ────────────────────────────────────────────────────────────

export const DEVICE_TRUST_INITIAL = 40;
export const DEVICE_TRUST_STEP_UP_CAP = 80;
export const DEVICE_TRUSTED_THRESHOLD = 60;

export type DeviceTrustEvent =
  | "first_seen"
  | "step_up_success"
  | "liveness_failed"
  | "impossible_travel"
  | "admin_trusted"
  | "owner_revoked";

export function applyDeviceTrust(current: number, event: DeviceTrustEvent): { next: number; delta: number } {
  let next = current;
  switch (event) {
    case "first_seen":
      next = DEVICE_TRUST_INITIAL;
      break;
    case "step_up_success":
      next = Math.min(current + 10, Math.max(current, DEVICE_TRUST_STEP_UP_CAP));
      break;
    case "liveness_failed":
      next = current - 20;
      break;
    case "impossible_travel":
      next = current - 25;
      break;
    case "admin_trusted":
      next = Math.max(current, 90);
      break;
    case "owner_revoked":
      next = 0;
      break;
  }
  next = clamp(next);
  return { next, delta: next - current };
}

export const isDeviceTrusted = (deviceTrust: number): boolean => deviceTrust >= DEVICE_TRUSTED_THRESHOLD;

// ─── Asset trust ─────────────────────────────────────────────────────────────

export interface AssetTrustInput {
  originVerified: boolean;
  ownerValid: boolean;
  transferChainConsistent: boolean;
  versionsAnchored: number;
  versionsTotal: number;
  incidentsLast30d: number;
  deniedAttempts: number;
  /** 0..1 share of accesses from trusted devices; null when there were no accesses yet */
  trustedDeviceShare: number | null;
  approvalsRequired: number;
  approvalsPresent: number;
  integrityOk: boolean;
  metadataComplete: boolean;
}

export interface AssetTrustResult {
  score: number;
  breakdown: TrustBreakdownItem[];
}

export function computeAssetTrust(i: AssetTrustInput): AssetTrustResult {
  const breakdown: TrustBreakdownItem[] = [];
  const add = (key: string, points: number, max: number) =>
    breakdown.push({ key, points: clamp(points, 0, max), max });

  add("origin", i.originVerified ? 20 : 0, 20);
  add("owner", i.ownerValid && i.transferChainConsistent ? 20 : i.ownerValid ? 10 : 0, 20);
  add(
    "versions",
    i.versionsTotal === 0 ? 0 : Math.round((15 * i.versionsAnchored) / i.versionsTotal),
    15,
  );
  add(
    "access",
    i.incidentsLast30d > 0 ? Math.max(0, 5 - i.incidentsLast30d) : Math.max(0, 15 - 2 * i.deniedAttempts),
    15,
  );
  add(
    "devices",
    i.trustedDeviceShare === null ? 10 : Math.round(10 * i.trustedDeviceShare),
    10,
  );
  add(
    "approvals",
    i.approvalsRequired === 0 ? 10 : Math.round((10 * Math.min(i.approvalsPresent, i.approvalsRequired)) / i.approvalsRequired),
    10,
  );
  add("integrity", (i.integrityOk ? 6 : 0) + (i.metadataComplete ? 4 : 0), 10);

  const score = clamp(breakdown.reduce((s, b) => s + b.points, 0));
  return { score, breakdown };
}

// ─── Request risk (explainable heuristics) ───────────────────────────────────

export interface RiskInput {
  newDevice: boolean;
  impossibleTravel: boolean;
  failedLivenessRecent: number;
  outsideBaselineHours: boolean;
  burstCount: number;
  volumeRatio: number;
  userAgeHours: number;
}

export const RISK_WEIGHTS = {
  new_device: 30,
  impossible_travel: 25,
  failed_liveness: 25,
  odd_hours: 15,
  burst: 15,
  abnormal_volume: 15,
} as const;

export const BURST_THRESHOLD = 10;
export const VOLUME_RATIO_THRESHOLD = 3;
export const NEW_USER_HOURS = 48;

export function scoreRisk(i: RiskInput): RiskResult {
  const signals: string[] = [];
  let score = 0;
  if (i.newDevice) {
    score += RISK_WEIGHTS.new_device;
    signals.push("new_device");
  }
  if (i.impossibleTravel) {
    score += RISK_WEIGHTS.impossible_travel;
    signals.push("impossible_travel");
  }
  if (i.failedLivenessRecent > 0) {
    score += RISK_WEIGHTS.failed_liveness;
    signals.push("failed_liveness");
  }
  if (i.outsideBaselineHours) {
    score += RISK_WEIGHTS.odd_hours;
    signals.push("odd_hours");
  }
  if (i.burstCount > BURST_THRESHOLD) {
    score += RISK_WEIGHTS.burst;
    signals.push("burst");
  }
  if (i.volumeRatio > VOLUME_RATIO_THRESHOLD) {
    score += RISK_WEIGHTS.abnormal_volume;
    signals.push("abnormal_volume");
  }
  score = clamp(score);
  let tier = tierFor(score);
  if (i.userAgeHours < NEW_USER_HOURS && tier === "low") {
    tier = "elevated";
    signals.push("new_user");
  }
  return { score, tier, signals };
}

/** Great-circle distance in km (haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const IMPOSSIBLE_TRAVEL_KMH = 500;

export function isImpossibleTravel(
  prev: { lat: number; lng: number; at: Date } | null,
  next: { lat: number; lng: number; at: Date },
): boolean {
  if (!prev) return false;
  const km = distanceKm(prev, next);
  if (km < 50) return false;
  const hours = Math.max((next.at.getTime() - prev.at.getTime()) / 3_600_000, 1 / 3600);
  return km / hours > IMPOSSIBLE_TRAVEL_KMH;
}
