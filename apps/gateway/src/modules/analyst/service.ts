/**
 * The Analyst — VAJRA's LLM layer. It NARRATES; it never DECIDES.
 *
 * Three uses, all optional, all labelled "AI-generated summary" in the UI:
 *   1. explain    — turn a DecisionTrace / incident timeline / passport into plain language
 *   2. query      — turn an audit question into a structured filter the gateway executes
 *   3. policyDraft— turn a description into a policy spec draft (activation still needs two people)
 *
 * ANALYST_MODE=template (default) produces deterministic sentences from the same inputs, so the demo
 * never depends on a network call. ANALYST_MODE=claude uses the Anthropic SDK with a user-supplied key.
 * Only DIDs, hashes, policy ids and signal names are ever sent — there is no biometric data anywhere.
 */
import { z } from "zod";
import type { DecisionTrace, Locale } from "@vajra/contracts";
import type { AppContext } from "../../context";
import { ApiError } from "../../lib/errors";

export const ANALYST_MODEL_DEFAULT = "claude-sonnet-5";

export const AuditQuerySchema = z.object({
  actorDid: z.string().optional(),
  assetUid: z.string().optional(),
  action: z.string().optional(),
  decision: z.enum(["ALLOW", "DENY", "STEP_UP", "PENDING_APPROVAL"]).optional(),
  eventType: z.string().optional(),
  sinceHours: z.number().int().min(1).max(24 * 365).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  intent: z.string().max(200).optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

const LANG: Record<Locale, string> = { en: "English", hi: "Hindi (Devanagari script)", kn: "Kannada (Kannada script)" };

const SYSTEM_EXPLAIN = `You are the analyst inside VAJRA, a zero-trust access platform. You explain security decisions to people who are not security engineers: auditors, managers, employees.

Rules you must follow:
- Explain only what the supplied JSON states. Never invent a fact, a name, a score or a rule.
- Never say a decision "should" have been different. You describe; the policy engine decides.
- Lead with the outcome, then the two or three reasons that actually drove it.
- Plain sentences. No bullet lists, no markdown, no headings. 3 to 5 sentences.
- Refer to hashes and identifiers only when they matter, and shorten them.
- Never claim biometric images or face data were stored: VAJRA never stores them.`;

const SYSTEM_QUERY = `You convert an auditor's question about access history into a JSON filter for VAJRA.
Return ONLY the filter object. Use only fields you are confident about; omit the rest. Never invent DIDs or asset ids that were not given to you.`;

const SYSTEM_POLICY = `You draft VAJRA access policies as JSON. A policy has: key (POL-NNN), name, subject.role[], action, resource{class[],sensitivity[]}, condition{hours:[start,end],deviceTrusted,maxRiskTier}, effect (allow|deny|step_up|require_approval), approval{approverRole,count,distinctFromRequester}, priority.
Return ONLY the JSON object. Prefer the most restrictive effect that satisfies the request. A draft is never active until two people approve it.`;

// ─── Templates (default, offline, deterministic) ─────────────────────────────

function templateDecision(trace: DecisionTrace, ctx: { action: string; assetName?: string; risk?: number; tier?: string }): string {
  const failed = trace.checks.filter((c) => c.result === "fail");
  const warned = trace.checks.filter((c) => c.result === "warn");
  const passed = trace.checks.filter((c) => c.result === "pass");
  const what = `${ctx.action.replace("asset.", "")}${ctx.assetName ? ` on ${ctx.assetName}` : ""}`;
  const policy = trace.policyVersion ? ` under policy ${trace.policyVersion.key} v${trace.policyVersion.version}` : "";
  const risk = ctx.risk !== undefined ? ` The request scored ${ctx.risk} out of 100 (${ctx.tier ?? "unknown"} risk).` : "";
  const reasonWord = (id: string) => id.replace(/^dependency:/, "the ").replace(/_/g, " ");
  if (trace.verdict === "DENY") {
    const why = failed.map((c) => reasonWord(c.id)).join(", ");
    return `The request to ${what} was denied${policy}. ${passed.length} check${passed.length === 1 ? "" : "s"} passed, but ${failed.length} failed: ${why}.${risk} Nothing was released, and the denial itself is recorded on the ledger as evidence.`;
  }
  if (trace.verdict === "STEP_UP") {
    const why = warned.length ? `because ${warned.map((c) => reasonWord(c.id)).join(" and ")} needed a second look` : "because this action is sensitive";
    return `The request to ${what} was allowed in principle${policy}, but a live identity check was required ${why}.${risk} Until the person proves they are present, the asset stays closed.`;
  }
  if (trace.verdict === "PENDING_APPROVAL") {
    return `The request to ${what} passed every check${policy} and the person proved they were live.${risk} It now waits for a second, different person to approve it — no one can complete this action alone.`;
  }
  return `The request to ${what} was allowed${policy}. All ${passed.length} checks passed — identity, role, device and context.${risk} A Proof-of-Action certificate was issued so anyone can verify this decision later without trusting our database.`;
}

function templateIncident(i: { incidentId: string; severity: string; peakRisk: number; signals: string[]; responses: string[]; events: number }): string {
  const sig = i.signals.length ? i.signals.map((s) => s.replace(/_/g, " ")).join(", ") : "no named signals";
  const res = i.responses.length ? i.responses.map((r) => r.replace(/_/g, " ")).join(", ") : "no automatic response";
  return `Incident ${i.incidentId} was opened at severity ${i.severity} after the risk engine saw ${sig}. Peak risk reached ${i.peakRisk} out of 100 across ${i.events} recorded events. VAJRA responded automatically: ${res}. Every step in that sequence is hash-chained and anchored, so the timeline can be replayed and independently verified.`;
}

function templatePassport(p: { name: string; assetUid: string; trust: number; breakdown: { key: string; points: number; max: number }[]; sensitivity: string; versions: number; owner: string }): string {
  const weak = p.breakdown.filter((b) => b.points < b.max).map((b) => `${b.key} (${b.points}/${b.max})`);
  const strong = p.breakdown.filter((b) => b.points === b.max).length;
  const why = weak.length ? `Points were lost on ${weak.join(", ")}.` : "Every component scored full marks.";
  return `${p.name} (${p.assetUid}) is classified ${p.sensitivity} and currently carries a trust score of ${p.trust} out of 100 across ${p.versions} anchored version${p.versions === 1 ? "" : "s"}. ${strong} of ${p.breakdown.length} components are fully verified. ${why} The asset is owned by ${p.owner}, and its ownership chain is recorded on the ledger rather than in a database an administrator could edit.`;
}

// ─── Claude client (lazy, optional) ──────────────────────────────────────────

async function callClaude(ctx: Pick<AppContext, "config" | "log">, system: string, user: string, maxTokens = 700): Promise<string | null> {
  if (ctx.config.ANALYST_MODE !== "claude" || !ctx.config.ANTHROPIC_API_KEY) return null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: ctx.config.ANTHROPIC_API_KEY });
    const response = await client.messages.create(
      {
        model: ctx.config.ANALYST_MODEL || ANALYST_MODEL_DEFAULT,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      },
      { timeout: 12_000 },
    );
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    return text || null;
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message }, "analyst: Claude call failed — falling back to the deterministic template");
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface Narrative {
  text: string;
  source: "template" | "claude";
  model?: string;
}

export async function explainDecision(ctx: AppContext, input: { trace: DecisionTrace; action: string; assetName?: string; risk?: number; tier?: string; locale: Locale }): Promise<Narrative> {
  const fallback = templateDecision(input.trace, input);
  const prompt = `Explain this access decision in ${LANG[input.locale]}. Facts:\n${JSON.stringify(
    { verdict: input.trace.verdict, action: input.action, asset: input.assetName ?? null, policy: input.trace.policyVersion, risk: { score: input.risk, tier: input.tier }, checks: input.trace.checks, reasons: input.trace.reasons },
    null,
    2,
  )}`;
  const text = await callClaude(ctx, SYSTEM_EXPLAIN, prompt);
  return text ? { text, source: "claude", model: ctx.config.ANALYST_MODEL || ANALYST_MODEL_DEFAULT } : { text: fallback, source: "template" };
}

export async function explainIncident(ctx: AppContext, input: { incidentId: string; severity: string; peakRisk: number; signals: string[]; responses: string[]; events: number; timeline?: unknown; locale: Locale }): Promise<Narrative> {
  const fallback = templateIncident(input);
  const prompt = `Summarise this security incident for an auditor in ${LANG[input.locale]}. Say what happened, in what order, and what the system did about it. Facts:\n${JSON.stringify(
    { incidentId: input.incidentId, severity: input.severity, peakRisk: input.peakRisk, signals: input.signals, responses: input.responses, events: input.events, timeline: input.timeline },
    null,
    2,
  ).slice(0, 12_000)}`;
  const text = await callClaude(ctx, SYSTEM_EXPLAIN, prompt, 900);
  return text ? { text, source: "claude", model: ctx.config.ANALYST_MODEL || ANALYST_MODEL_DEFAULT } : { text: fallback, source: "template" };
}

export async function explainPassport(ctx: AppContext, input: { name: string; assetUid: string; trust: number; breakdown: { key: string; points: number; max: number }[]; sensitivity: string; versions: number; owner: string; locale: Locale }): Promise<Narrative> {
  const fallback = templatePassport(input);
  const prompt = `Explain this asset's trust score in ${LANG[input.locale]} — what it means and where points were lost. Facts:\n${JSON.stringify(input, null, 2)}`;
  const text = await callClaude(ctx, SYSTEM_EXPLAIN, prompt);
  return text ? { text, source: "claude", model: ctx.config.ANALYST_MODEL || ANALYST_MODEL_DEFAULT } : { text: fallback, source: "template" };
}

/** Natural-language audit question → structured filter. The gateway executes it under the caller's role. */
export async function parseAuditQuery(ctx: AppContext, question: string, known: { dids: { did: string; name: string }[]; assets: { uid: string; name: string }[] }): Promise<AuditQuery> {
  const heuristic = heuristicQuery(question, known);
  if (ctx.config.ANALYST_MODE !== "claude") return heuristic;
  const prompt = `Question: ${question}\n\nKnown identities: ${JSON.stringify(known.dids)}\nKnown assets: ${JSON.stringify(known.assets)}\n\nReturn a JSON filter with any of: actorDid, assetUid, action (asset.view|asset.open|asset.download|asset.transfer|asset.export|asset.delete), decision (ALLOW|DENY|STEP_UP|PENDING_APPROVAL), eventType, sinceHours, limit, intent (a short restatement).`;
  const raw = await callClaude(ctx, SYSTEM_QUERY, prompt, 400);
  if (!raw) return heuristic;
  try {
    const json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    const parsed = AuditQuerySchema.safeParse(json);
    return parsed.success ? parsed.data : heuristic;
  } catch {
    return heuristic;
  }
}

function heuristicQuery(q: string, known: { dids: { did: string; name: string }[]; assets: { uid: string; name: string }[] }): AuditQuery {
  const lower = q.toLowerCase();
  const out: AuditQuery = { intent: q.slice(0, 200) };
  for (const a of known.assets) if (lower.includes(a.uid.toLowerCase()) || (a.name.length > 3 && lower.includes(a.name.toLowerCase()))) out.assetUid = a.uid;
  for (const d of known.dids) {
    const first = d.name.split(" ")[0]?.toLowerCase() ?? "";
    if (lower.includes(d.did.toLowerCase()) || (first.length > 2 && lower.includes(first))) out.actorDid = d.did;
  }
  if (/\bdenied?\b|\brefus|\bblocked?\b/.test(lower)) out.decision = "DENY";
  else if (/\ballow|\bgranted?\b|\bsucce/.test(lower)) out.decision = "ALLOW";
  if (/download/.test(lower)) out.action = "asset.download";
  else if (/transfer/.test(lower)) out.action = "asset.transfer";
  else if (/export/.test(lower)) out.action = "asset.export";
  else if (/open|view|access/.test(lower)) out.action = undefined;
  const hours = lower.match(/last\s+(\d+)\s*(hour|day|week|month)/);
  if (hours) {
    const n = Number(hours[1]);
    const unit = hours[2]!;
    out.sinceHours = unit === "hour" ? n : unit === "day" ? n * 24 : unit === "week" ? n * 168 : n * 720;
  } else if (/today|24 hours/.test(lower)) out.sinceHours = 24;
  return out;
}

export async function draftPolicy(ctx: AppContext, description: string): Promise<{ draft: Record<string, unknown>; source: "template" | "claude" }> {
  if (ctx.config.ANALYST_MODE === "claude") {
    const raw = await callClaude(ctx, SYSTEM_POLICY, `Draft a policy for: ${description}`, 700);
    if (raw) {
      try {
        return { draft: JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")), source: "claude" };
      } catch {
        /* fall through to the template */
      }
    }
  }
  const lower = description.toLowerCase();
  const action = /transfer/.test(lower) ? "asset.transfer" : /export/.test(lower) ? "asset.export" : /delete/.test(lower) ? "asset.delete" : /download/.test(lower) ? "asset.download" : /open/.test(lower) ? "asset.open" : "asset.view";
  const roles = (["engineer", "manager", "auditor", "admin"] as const).filter((r) => lower.includes(r));
  const effect = /two[- ]person|approval|approve/.test(lower) ? "require_approval" : /deny|block|forbid/.test(lower) ? "deny" : /step.?up|liveness|re-?verify/.test(lower) ? "step_up" : "allow";
  const hours = lower.match(/(\d{1,2})\s*(?:to|-|–|until)\s*(\d{1,2})/);
  const draft: Record<string, unknown> = {
    key: "POL-NEW",
    name: description.slice(0, 60),
    subject: { role: roles.length ? roles : ["manager"] },
    action,
    resource: /high|sensitive|classified/.test(lower) ? { sensitivity: ["high"] } : {},
    condition: {
      ...(hours ? { hours: [Number(hours[1]), Number(hours[2])] } : {}),
      ...(/trusted device/.test(lower) ? { deviceTrusted: true } : {}),
      ...(/low risk/.test(lower) ? { maxRiskTier: "low" } : {}),
    },
    effect,
    ...(effect === "require_approval" ? { approval: { approverRole: "manager", count: 1, distinctFromRequester: true } } : {}),
    priority: 100,
  };
  return { draft, source: "template" };
}

export function analystHealth(ctx: Pick<AppContext, "config">): { mode: string; ready: boolean; detail: string } {
  if (ctx.config.ANALYST_MODE === "claude") {
    const ready = !!ctx.config.ANTHROPIC_API_KEY;
    return { mode: "claude", ready, detail: ready ? `${ctx.config.ANALYST_MODEL || ANALYST_MODEL_DEFAULT}` : "ANTHROPIC_API_KEY is not set — falling back to templates" };
  }
  return { mode: "template", ready: true, detail: "deterministic explanations, no network calls" };
}

export function requireAnalystEnabled(ctx: Pick<AppContext, "config">): void {
  if (ctx.config.ANALYST_MODE === "claude" && !ctx.config.ANTHROPIC_API_KEY) throw ApiError.unavailable("analyst_unconfigured", "ANALYST_MODE=claude needs ANTHROPIC_API_KEY.");
}
