/**
 * Audit events → the headline an operator reads.
 *
 * The ledger records machine event types (`access.decision`, `asset.minted`). The console never
 * shows those raw: the stream, the activity page and the incident rail all funnel through here so
 * one event always reads the same way wherever it appears.
 */
import type { AuditEvent } from "./api";
import type { Tone } from "@/components/ui";

export interface EventHeadline {
  /** Key under `console.events.*`. */
  key: string;
  tone: Tone;
  verdict: string | null;
  action: string | null;
  risk: { score: number; tier: string } | null;
  policy: { key: string; version: number } | null;
  signals: string[];
  /** Broad bucket used by the activity filter. */
  kind: "decisions" | "assets" | "identity" | "policy" | "incident" | "other";
}

interface DecisionPayload {
  verdict?: string;
  action?: string;
  risk?: { score: number; tier: string };
  policy?: { key: string; version: number };
  signals?: string[];
  reasons?: string[];
  status?: string;
}

/** Accepts anything carrying an event type and payload — audit rows and incident timeline items alike. */
export function headlineFor(event: Pick<AuditEvent, "eventType" | "payload">): EventHeadline {
  const p = (event.payload ?? {}) as DecisionPayload;
  const verdict = typeof p.verdict === "string" ? p.verdict : null;
  const base: Omit<EventHeadline, "key" | "tone" | "kind"> = {
    verdict,
    action: typeof p.action === "string" ? p.action : null,
    risk: p.risk ?? null,
    policy: p.policy ?? null,
    signals: Array.isArray(p.signals) ? p.signals : Array.isArray(p.reasons) ? p.reasons : [],
  };

  switch (event.eventType) {
    case "access.decision":
    case "access.granted": {
      const key =
        verdict === "ALLOW" ? "accessAllowed" : verdict === "DENY" ? "accessDenied" : verdict === "STEP_UP" ? "stepUpRequired" : verdict === "PENDING_APPROVAL" ? "pendingApproval" : "other";
      const tone: Tone = verdict === "ALLOW" ? "good" : verdict === "DENY" ? "bad" : verdict === "PENDING_APPROVAL" ? "steel" : "warn";
      return { ...base, key, tone, kind: "decisions" };
    }
    case "approval.requested":
      return { ...base, key: "pendingApproval", tone: "steel", kind: "decisions" };
    case "approval.granted":
      return { ...base, key: "approvalGranted", tone: "good", kind: "decisions" };
    case "approval.rejected":
      return { ...base, key: "approvalRejected", tone: "bad", kind: "decisions" };
    case "asset.minted":
      return { ...base, key: "assetMinted", tone: "brass", kind: "assets" };
    case "asset.version_added":
      return { ...base, key: "assetVersion", tone: "brass", kind: "assets" };
    case "asset.transferred":
      return { ...base, key: "assetTransferred", tone: "steel", kind: "assets" };
    case "asset.deleted":
      return { ...base, key: "assetDeleted", tone: "bad", kind: "assets" };
    case "asset.content_delivered":
      return { ...base, key: "contentDelivered", tone: "neutral", kind: "assets" };
    case "provenance.unauthorised_derivative":
      return { ...base, key: "unauthorisedDerivative", tone: "bad", kind: "assets" };
    case "policy.version_created":
      return { ...base, key: "policyActivated", tone: "brass", kind: "policy" };
    case "identity.onboarded":
      return { ...base, key: "identityOnboarded", tone: "good", kind: "identity" };
    case "identity.signed_in":
      return { ...base, key: "signedIn", tone: "neutral", kind: "identity" };
    case "identity.revoked":
      return { ...base, key: "identityRevoked", tone: "bad", kind: "identity" };
    case "liveness.verified":
      return { ...base, key: "stepUpPassed", tone: "good", kind: "identity" };
    case "liveness.failed":
      return { ...base, key: "stepUpFailed", tone: "bad", kind: "identity" };
    case "incident.opened":
      return { ...base, key: "incidentOpened", tone: "bad", kind: "incident" };
    case "incident.closed":
      return { ...base, key: "incidentClosed", tone: "good", kind: "incident" };
    default:
      return { ...base, key: "other", tone: "neutral", kind: "other" };
  }
}

/** Denial reasons, ranked. Used by the posture panel and the incident summary. */
export function denialReasons(events: AuditEvent[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const p = (e.payload ?? {}) as DecisionPayload;
    if (p.verdict !== "DENY") continue;
    for (const reason of p.reasons ?? []) {
      // `dependency_down:ledger` and friends collapse to their family.
      const key = reason.split(":")[0] ?? reason;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

/** Outcome tally over a window of decisions. */
export function outcomeCounts(events: AuditEvent[]): { allowed: number; stepUp: number; denied: number; pending: number; total: number } {
  let allowed = 0;
  let stepUp = 0;
  let denied = 0;
  let pending = 0;
  for (const e of events) {
    if (e.eventType !== "access.decision") continue;
    const verdict = (e.payload as DecisionPayload).verdict;
    if (verdict === "ALLOW") allowed++;
    else if (verdict === "DENY") denied++;
    else if (verdict === "STEP_UP") stepUp++;
    else if (verdict === "PENDING_APPROVAL") pending++;
  }
  return { allowed, stepUp, denied, pending, total: allowed + stepUp + denied + pending };
}
