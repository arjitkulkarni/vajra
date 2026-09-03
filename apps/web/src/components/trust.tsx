"use client";

/**
 * The pieces that make VAJRA's thinking visible: the decision trace, permission strip, trust gauges,
 * score breakdown, decay chart, step-up modal and the trust graph.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { AccessDecisionResponse, AttestationBody, DecisionTrace, TraceCheck } from "@vajra/contracts";
import { useI18n } from "@/lib/i18n-client";
import { api, type GraphData, type Narrative, type TrustEventRow } from "@/lib/api";
import { Button, Card, Chip, ConsolePanel, cx, Dialog, Icon, Meter, Spinner, toneForRisk, toneForTrust, toneForVerdict, type Tone } from "./ui";
import { LivenessCapture, type Challenge } from "./LivenessCapture";

// ─── Decision trace ──────────────────────────────────────────────────────────

const RESULT_TONE: Record<string, Tone> = { pass: "good", fail: "bad", warn: "warn", skip: "neutral" };
const RESULT_ICON: Record<string, string> = { pass: "✓", fail: "✗", warn: "⚠", skip: "·" };

export function TraceRow({ check, index }: { check: TraceCheck; index: number }) {
  const { t } = useI18n();
  const label = t(check.labelKey, check.params as Record<string, string | number> | undefined);
  const detail = check.detailKey ? t(check.detailKey, check.params as Record<string, string | number> | undefined) : null;
  const tone = RESULT_TONE[check.result] ?? "neutral";
  return (
    <li
      className={cx(
        "tick group relative flex items-start gap-3 border-b border-line-faint py-2.5 pl-1 pr-2 transition-[background-color] duration-150 ease-out last:border-0",
        // A failed check keeps its tint at rest AND deepens on hover — pointing at a failure must
        // never replace its signal with a brighter neutral lift.
        check.result === "fail" ? "bg-oxide-soft/60 hover:bg-oxide-soft" : "hover:bg-overlay-1",
      )}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      {/* The sequence rail: each check visibly hands off to the next one the engine ran. */}
      <span aria-hidden className="pointer-events-none absolute bottom-0 left-[14px] top-8 w-px bg-line-faint group-last:hidden" />
      <span
        className={cx(
          "relative mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-pill)] border text-[0.6875rem] font-semibold leading-none",
          tone === "good" && "border-verdigris-line bg-verdigris-soft text-verdigris",
          tone === "bad" && "border-oxide-line bg-oxide-soft text-oxide",
          tone === "warn" && "border-saffron-line bg-saffron-soft text-saffron",
          tone === "neutral" && "border-line bg-paper-2 text-ink-3",
        )}
        aria-label={t(`trace.result.${check.result}`)}
      >
        {RESULT_ICON[check.result]}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx("text-[0.875rem] leading-snug", check.result === "fail" ? "text-ink" : "text-ink-2")}>{label}</p>
        {detail && <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-3">{detail}</p>}
        {check.signals && check.signals.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {check.signals.map((s) => (
              <Chip key={s} tone="warn">
                {t(`risk.signals.${s}`)}
              </Chip>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

export function DecisionTracePanel({ trace, latencyMs, footer }: { trace: DecisionTrace; latencyMs?: number; footer?: React.ReactNode }) {
  const { t, n } = useI18n();
  const tone = toneForVerdict(trace.verdict);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper-2/60 px-5 py-3.5">
        <div>
          <p className="eyebrow">{t("trace.title")}</p>
          <p className="mt-0.5 text-[0.8125rem] text-ink-3">{t("trace.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2.5">
          {latencyMs !== undefined && <span className="tnum font-mono text-[0.75rem] text-ink-3">{t("access.decisionIn", { ms: n(latencyMs) })}</span>}
          <span
            className={cx(
              "stamp inline-flex items-center gap-2 rounded-[var(--radius-tag)] border px-3 py-1 font-display text-[0.9375rem] font-semibold uppercase tracking-[0.04em]",
              tone === "good" && "border-verdigris-line bg-verdigris-soft text-verdigris",
              tone === "bad" && "border-oxide-line bg-oxide-soft text-oxide",
              tone === "warn" && "border-saffron-line bg-saffron-soft text-saffron",
              tone === "steel" && "border-steel-line bg-steel-soft text-steel",
            )}
          >
            {trace.verdict === "ALLOW" ? Icon.check : trace.verdict === "DENY" ? Icon.cross : Icon.warn}
            {t(`verdict.${trace.verdict}`)}
          </span>
        </div>
      </div>
      <ol className="px-5 py-1.5">
        {trace.checks.map((check, i) => (
          <TraceRow key={`${check.id}-${i}`} check={check} index={i} />
        ))}
      </ol>
      {trace.policyVersion && (
        // The policy that decided this sits in the console well: machine-made material, and the
        // top rule keeps the well readable where the 6% fill difference alone would flatten.
        <div className="tnum border-t border-line bg-console px-5 py-2.5 font-mono text-[0.75rem] text-console-muted">
          {trace.policyVersion.key} v{trace.policyVersion.version} · {trace.policyVersion.hash.slice(0, 12)}…
        </div>
      )}
      {footer && <div className="border-t border-line px-5 py-3.5">{footer}</div>}
    </Card>
  );
}

// ─── Permission strip ────────────────────────────────────────────────────────

export function PermissionStrip({ permissions }: { permissions: Partial<Record<string, "allow" | "step_up" | "deny">> }) {
  const { t } = useI18n();
  const entries = Object.entries(permissions);
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="eyebrow mb-1">{t("permissions.title")}</p>
      <p className="mb-2.5 text-[0.8125rem] text-ink-3">{t("permissions.subtitle")}</p>
      <div className="flex flex-wrap gap-2">
        {entries.map(([action, state]) => (
          <span
            key={action}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 text-[0.8125rem] transition-[color,background-color,border-color] duration-150 ease-out",
              state === "allow" && "border-verdigris-line bg-verdigris-soft text-verdigris",
              state === "step_up" && "border-saffron-line bg-saffron-soft text-saffron",
              state === "deny" && "border-oxide-line bg-oxide-soft text-oxide line-through decoration-oxide/60",
            )}
          >
            {state === "allow" ? "✓" : state === "step_up" ? "⚠" : "✗"}
            <span className="font-medium">{t(`actions.${action}`)}</span>
            <span className="opacity-70">{t(`permissions.${state}`)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Trust & risk gauges ─────────────────────────────────────────────────────

export function TrustGauges({ trust, risk }: { trust: { identity: number; device: number; asset: number | null }; risk?: { score: number; tier: string; signals: string[] } }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="px-4 py-3.5 transition-[border-color] duration-150 ease-out hover:border-line-strong">
        <Meter label={t("trust.identity")} value={trust.identity} tone={toneForTrust(trust.identity)} />
      </Card>
      <Card className="px-4 py-3.5 transition-[border-color] duration-150 ease-out hover:border-line-strong">
        <Meter label={t("trust.device")} value={trust.device} tone={toneForTrust(trust.device)} />
      </Card>
      <Card className="px-4 py-3.5 transition-[border-color] duration-150 ease-out hover:border-line-strong">
        {trust.asset !== null ? <Meter label={t("trust.asset")} value={trust.asset} tone={toneForTrust(trust.asset)} /> : <Meter label={t("trust.asset")} value={0} tone="neutral" showValue={false} />}
      </Card>
      {risk && (
        <Card className="px-4 py-3.5 transition-[border-color] duration-150 ease-out hover:border-line-strong">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="eyebrow">{t("risk.label")}</span>
            <Chip tone={toneForRisk(risk.tier)}>{t(`risk.${risk.tier}`)}</Chip>
          </div>
          <Meter value={risk.score} tone={toneForRisk(risk.tier)} showValue />
        </Card>
      )}
    </div>
  );
}

export function ScoreBreakdown({ score, breakdown }: { score: number; breakdown: { key: string; points: number; max: number }[] }) {
  const { t, n } = useI18n();
  return (
    <div>
      <div className="mb-3.5 flex items-baseline gap-3">
        <span className="tnum font-display text-[2rem] font-semibold leading-none tracking-[-0.02em] text-ink">{n(score)}</span>
        <span className="text-[0.875rem] text-ink-3">{t("trust.breakdownTitle", { score: n(score) })}</span>
      </div>
      <ul className="space-y-2.5">
        {breakdown.map((b) => (
          <li key={b.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5">
            <span className="text-[0.875rem] text-ink-2">{t(`trust.components.${b.key}`)}</span>
            <span className={cx("tnum font-mono text-[0.8125rem]", b.points === b.max ? "text-verdigris" : b.points === 0 ? "text-oxide" : "text-saffron")}>
              +{n(b.points)} / {n(b.max)}
            </span>
            <div className="col-span-2 h-1 overflow-hidden rounded-[var(--radius-pill)] bg-paper-3">
              <div
                className={cx(
                  "h-full rounded-[var(--radius-pill)] transition-[width] duration-700 ease-out-soft",
                  b.points === b.max ? "bg-verdigris" : b.points === 0 ? "bg-oxide" : "bg-saffron",
                )}
                style={{ width: `${(b.points / b.max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Trust decay chart ───────────────────────────────────────────────────────

export function TrustDecayChart({ events, height = 120 }: { events: TrustEventRow[]; height?: number }) {
  const { t, time } = useI18n();
  const points = useMemo(() => [...events].reverse(), [events]);
  const fadeId = useId();
  if (points.length < 2) return null;
  const w = 640;
  const pad = 8;
  const stepX = (w - pad * 2) / (points.length - 1);
  const y = (score: number) => pad + (height - pad * 2) * (1 - score / 100);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${pad + i * stepX} ${y(p.scoreAfter)}`).join(" ");
  // The area is a separate path so the stroke can carry .draw without the fill dashing with it.
  const area = `${path} L ${pad + (points.length - 1) * stepX} ${height - pad} L ${pad} ${height - pad} Z`;
  return (
    <div>
      <p className="eyebrow mb-2">{t("trust.decay")}</p>
      {/* The plot lives in the console well — machine-made material — and keeps a hairline so the
          well still reads as its own layer where the fill difference alone would flatten. */}
      <div className="rounded-[var(--radius-panel)] border border-line bg-console px-2 py-1.5">
        <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} role="img" aria-label={t("trust.decay")}>
          <defs>
            <linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-steel)" stopOpacity="0.26" />
              <stop offset="100%" stopColor="var(--color-steel)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[25, 50, 75].map((line) => (
            <line key={line} x1={pad} x2={w - pad} y1={y(line)} y2={y(line)} stroke="var(--color-line)" strokeWidth="1" strokeDasharray="2 6" />
          ))}
          <path d={area} fill={`url(#${fadeId})`} stroke="none" />
          <path d={path} fill="none" stroke="var(--color-steel)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="draw" />
          {points.map((p, i) => (
            <g key={p.id}>
              <circle
                cx={pad + i * stepX}
                cy={y(p.scoreAfter)}
                r={p.delta < 0 ? 4 : 3}
                fill={p.delta < 0 ? "var(--color-oxide)" : p.delta > 0 ? "var(--color-verdigris)" : "var(--color-ink-3)"}
                stroke="var(--color-console)"
                strokeWidth="1.5"
              >
                <title>{`${time(p.createdAt)} · ${t(`trust.reasons.${p.reason}`)} · ${p.delta >= 0 ? "+" : ""}${p.delta} → ${p.scoreAfter}`}</title>
              </circle>
            </g>
          ))}
        </svg>
      </div>
      <ul className="mt-2.5 space-y-0.5">
        {points
          .filter((p) => p.delta !== 0)
          .slice(-5)
          .map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2.5 rounded-[var(--radius-tag)] px-1.5 py-1 font-mono text-[0.75rem] text-ink-3 transition-[background-color] duration-150 ease-out hover:bg-overlay-1"
            >
              <span className="tnum">{time(p.createdAt)}</span>
              <span className={cx("tnum font-medium", p.delta < 0 ? "text-oxide" : "text-verdigris")}>
                {p.delta > 0 ? "+" : ""}
                {p.delta}
              </span>
              <span className="truncate font-sans text-ink-2">{t(`trust.reasons.${p.reason}`)}</span>
              <span className="tnum ml-auto text-ink-2">{p.scoreAfter}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

// ─── Step-up modal ───────────────────────────────────────────────────────────

export function StepUpModal({
  open,
  onClose,
  nonce,
  challenge,
  title,
  body,
  demoRole,
  onAttested,
}: {
  open: boolean;
  onClose: () => void;
  nonce: string | null;
  challenge: Challenge[];
  title?: string;
  body?: string;
  /** When signed in as a seeded demo identity, the gateway holds the key and signs for us. */
  demoRole?: boolean;
  onAttested: (attestation: AttestationBody) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signViaGateway = useCallback(async () => {
    if (!nonce) return;
    setBusy(true);
    setError(null);
    try {
      const { signature, livenessMode } = await api.demoSign(nonce);
      onAttested({ nonce, signature, livenessMode });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [nonce, onAttested]);

  if (!nonce) return null;
  return (
    <Dialog open={open} onClose={onClose} title={title ?? t("access.stepUpTitle")}>
      {/* A step-up is an interruption, not a prompt: it opens on the saffron band that STEP_UP
          carries everywhere else, glyph and all. */}
      <div className="mb-4 flex items-start gap-3 rounded-[var(--radius-field)] border border-saffron-line bg-saffron-soft/60 px-3.5 py-3">
        <span aria-hidden className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-saffron-line bg-saffron-soft text-[0.6875rem] font-semibold leading-none text-saffron">
          ⚠
        </span>
        <p className="text-[0.875rem] leading-relaxed text-ink-2">{body ?? t("access.stepUpBody")}</p>
      </div>
      {demoRole ? (
        <div className="space-y-4">
          <div className="rounded-[var(--radius-field)] border border-line bg-paper-2 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-ink-2">{t("onboard.quickSignInNote")}</div>
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-field)] border border-oxide-line bg-oxide-soft px-3.5 py-2.5 text-[0.8125rem] text-oxide">
              <span aria-hidden className="font-semibold leading-5">
                ✗
              </span>
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void signViaGateway()}>
              {t("access.stepUpStart")}
            </Button>
          </div>
        </div>
      ) : (
        <LivenessCapture
          nonce={nonce}
          challenge={challenge}
          mode="verify"
          autoStart
          onCancel={onClose}
          onComplete={({ signature, livenessMode, livenessScore, livenessSignals, spoofCheck }) =>
            onAttested({ nonce, signature, livenessMode, livenessScore, livenessSignals, spoofCheck })
          }
        />
      )}
    </Dialog>
  );
}

// ─── Analyst narrative ───────────────────────────────────────────────────────

export function AnalystNote({ kind, id, label }: { kind: "decision" | "incident" | "passport"; id: string; label?: string }) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ loading: boolean; data: Narrative | null; error: string | null }>({ loading: false, data: null, error: null });
  const run = async () => {
    setState({ loading: true, data: null, error: null });
    try {
      const data = await api.explain({ kind, id, locale });
      setState({ loading: false, data, error: null });
    } catch (e) {
      setState({ loading: false, data: null, error: (e as Error).message });
    }
  };
  return (
    <div>
      {!state.data && (
        <Button size="sm" variant="ghost" onClick={() => void run()} loading={state.loading}>
          ✎ {label ?? t("analyst.explain")}
        </Button>
      )}
      {state.error && (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-field)] border border-oxide-line bg-oxide-soft px-3.5 py-2.5 text-[0.8125rem] text-oxide">
          <span aria-hidden className="font-semibold leading-5">
            ✗
          </span>
          {state.error}
        </p>
      )}
      {state.data && (
        <div className="rise rounded-[var(--radius-card)] border border-line bg-paper-2/70 px-4 py-3.5">
          <p className="text-[0.875rem] leading-relaxed text-ink">{state.data.text}</p>
          <p className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-faint pt-2.5 text-[0.6875rem] leading-relaxed text-ink-3">
            <Chip tone="neutral">{state.data.source === "claude" ? t("analyst.source.claude", { model: state.data.model ?? "" }) : t("analyst.source.template")}</Chip>
            {t("analyst.disclaimer")}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Trust graph ─────────────────────────────────────────────────────────────

/**
 * Re-derived for the well: the graph sits on --color-console, so every neutral node is an overlay
 * step above that ground rather than a second grey, and no node is left filled with the ground it
 * stands on. Hue is spent only where it means something — brass on the asset under inspection,
 * steel on identity, verdigris on the decision, oxide on the incident.
 */
const NODE_STYLE: Record<string, { fill: string; stroke: string; r: number }> = {
  asset: { fill: "var(--color-brass-soft)", stroke: "var(--color-brass)", r: 20 },
  person: { fill: "var(--color-steel-soft)", stroke: "var(--color-steel)", r: 16 },
  device: { fill: "var(--color-overlay-3)", stroke: "var(--color-line-strong)", r: 13 },
  policy: { fill: "var(--color-overlay-2)", stroke: "var(--color-ink-3)", r: 13 },
  request: { fill: "var(--color-overlay-1)", stroke: "var(--color-line-strong)", r: 11 },
  decision: { fill: "var(--color-verdigris-soft)", stroke: "var(--color-verdigris)", r: 12 },
  audit: { fill: "var(--color-overlay-2)", stroke: "var(--color-ink-2)", r: 10 },
  block: { fill: "var(--color-console-2)", stroke: "var(--color-console-accent)", r: 12 },
  incident: { fill: "var(--color-oxide-soft)", stroke: "var(--color-oxide)", r: 14 },
};

interface Sim {
  id: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A small force-directed layout — no charting library, and it reads well on a projector. */
export function TrustGraph({ data, height = 460 }: { data: GraphData; height?: number }) {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<Sim[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const raf = useRef(0);
  const W = 900;

  useEffect(() => {
    const seeded = data.nodes.map((n, i) => {
      const angle = (i / Math.max(data.nodes.length, 1)) * Math.PI * 2;
      const radius = n.kind === "asset" ? 0 : 120 + (i % 5) * 34;
      return { id: n.id, kind: n.kind, label: n.label, x: W / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius, vx: 0, vy: 0 };
    });
    const index = new Map(seeded.map((n, i) => [n.id, i]));
    let iterations = 0;
    const tick = () => {
      iterations += 1;
      for (let i = 0; i < seeded.length; i++) {
        const a = seeded[i]!;
        for (let j = i + 1; j < seeded.length; j++) {
          const b = seeded[j]!;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 1;
          }
          const force = 2600 / d2;
          const d = Math.sqrt(d2);
          a.vx -= (dx / d) * force;
          a.vy -= (dy / d) * force;
          b.vx += (dx / d) * force;
          b.vy += (dy / d) * force;
        }
      }
      for (const edge of data.edges) {
        const ai = index.get(edge.from);
        const bi = index.get(edge.to);
        if (ai === undefined || bi === undefined) continue;
        const a = seeded[ai]!;
        const b = seeded[bi]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const force = (d - 110) * 0.012;
        a.vx += (dx / d) * force;
        a.vy += (dy / d) * force;
        b.vx -= (dx / d) * force;
        b.vy -= (dy / d) * force;
      }
      for (const n of seeded) {
        n.vx += (W / 2 - n.x) * 0.004;
        n.vy += (height / 2 - n.y) * 0.006;
        n.vx *= 0.82;
        n.vy *= 0.82;
        n.x = Math.max(40, Math.min(W - 40, n.x + n.vx));
        n.y = Math.max(28, Math.min(height - 28, n.y + n.vy));
      }
      setNodes(seeded.map((n) => ({ ...n })));
      if (iterations < 220) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [data, height]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  if (data.nodes.length === 0) return <p className="text-[0.875rem] text-ink-3">{t("common.empty")}</p>;

  return (
    <div className="console-scroll overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-console">
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full min-w-[640px]" role="img" aria-label={t("passport.graphTitle")}>
        {data.edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const active = hover === e.from || hover === e.to;
          return (
            <g key={i}>
              {/* Pointing at a node does not just brighten its edges — it recedes the rest, so the
                  chain of custody around that node is the only thing still fully lit. */}
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? "var(--color-brass)" : "var(--color-line-strong)"}
                strokeWidth={active ? 1.75 : 1}
                strokeOpacity={hover && !active ? 0.35 : 1}
                className="transition-[stroke-width,stroke-opacity] duration-150 ease-out"
              />
              {active && (
                <text
                  x={(a.x + b.x) / 2}
                  y={(a.y + b.y) / 2 - 4}
                  textAnchor="middle"
                  className="fill-[var(--color-brass-deep)] font-mono text-[9px]"
                  stroke="var(--color-console)"
                  strokeWidth={3}
                  style={{ paintOrder: "stroke" }}
                >
                  {e.label}
                </text>
              )}
            </g>
          );
        })}
        {nodes.map((n) => {
          const style = NODE_STYLE[n.kind] ?? NODE_STYLE.request!;
          const on = hover === n.id;
          return (
            <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} className="cursor-default">
              <circle
                cx={n.x}
                cy={n.y}
                r={style.r}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={on ? 2.5 : 1.25}
                strokeOpacity={hover && !on ? 0.5 : 1}
                className="transition-[stroke-width,stroke-opacity] duration-150 ease-out"
              />
              {/* A halo of the well behind the label: node labels overlap edges constantly, and on
                  near-black an unhaloed 10px label disappears into whatever line crosses it. */}
              <text
                x={n.x}
                y={n.y + style.r + 12}
                textAnchor="middle"
                className={cx("text-[10px] transition-[fill] duration-150 ease-out", on ? "fill-[var(--color-ink)]" : "fill-[var(--color-ink-2)]")}
                stroke="var(--color-console)"
                strokeWidth={3}
                style={{ paintOrder: "stroke" }}
              >
                {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
              </text>
              <title>{`${n.kind} · ${n.label}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Decision result block, reused on /access and elsewhere ──────────────────

export function DecisionResult({ result, onStepUp, children }: { result: AccessDecisionResponse; onStepUp?: () => void; children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <DecisionTracePanel
        trace={result.trace}
        latencyMs={result.latencyMs}
        footer={
          <div className="flex flex-wrap items-center gap-3">
            {result.verdict === "STEP_UP" && onStepUp && (
              <Button variant="primary" size="sm" onClick={onStepUp}>
                {t("access.stepUpStart")}
              </Button>
            )}
            <AnalystNote kind="decision" id={result.requestId} label={t("access.explain")} />
          </div>
        }
      />
      <TrustGauges trust={result.trust} risk={result.risk} />
      <PermissionStrip permissions={result.effectivePermissions} />
      {children}
    </div>
  );
}

export function ProofChecks({ checks }: { checks: { id: string; ok: boolean; detailKey?: string }[] }) {
  const { t } = useI18n();
  return (
    <ul className="space-y-2">
      {checks.map((c, i) => (
        <li
          className={cx(
            "tick flex items-start gap-3 rounded-[var(--radius-field)] border px-3.5 py-2.5 transition-[background-color,border-color] duration-150 ease-out",
            // A failed proof carries its tone at rest and deepens under the pointer; a passing one
            // stays quiet and merely lifts, so the eye lands on the failure first.
            c.ok ? "border-line bg-overlay-1 hover:bg-overlay-2" : "border-oxide-line bg-oxide-soft/60 hover:bg-oxide-soft",
          )}
          key={c.id}
          style={{ animationDelay: `${i * 90}ms` }}
        >
          <span
            className={cx(
              "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-pill)] border text-[0.6875rem] font-semibold leading-none",
              c.ok ? "border-verdigris-line bg-verdigris-soft text-verdigris" : "border-oxide-line bg-oxide-soft text-oxide",
            )}
          >
            {c.ok ? "✓" : "✗"}
          </span>
          <div className="min-w-0">
            <p className="text-[0.875rem] leading-snug text-ink">{t(`verify.checks.${c.id}`)}</p>
            {c.detailKey && <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-3">{t(`verify.detail.${c.detailKey.replace("verify.", "")}`)}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function LedgerStrip({ txId, block, pendingLabel }: { txId: string | null; block: number | null; pendingLabel: string }) {
  if (!txId)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-line bg-paper-2/70 px-2 py-0.5 font-mono text-[0.75rem] text-ink-3">
        <span aria-hidden className="pulse text-[0.625rem] leading-none">
          ●
        </span>
        {pendingLabel}
      </span>
    );
  return (
    <span className="tnum inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-verdigris-line bg-verdigris-soft px-2 py-0.5 font-mono text-[0.75rem] text-ink-2">
      <span aria-hidden className="text-[0.625rem] leading-none text-verdigris">
        ●
      </span>
      {txId.slice(0, 10)}…{block !== null && ` · #${block}`}
    </span>
  );
}

export function ConsoleJson({ value, title }: { value: unknown; title?: string }) {
  return (
    <ConsolePanel title={title}>
      <pre className="tnum whitespace-pre-wrap break-all text-console-text">{JSON.stringify(value, null, 2)}</pre>
    </ConsolePanel>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef
      .current()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((e: Error) => alive && setState({ data: null, loading: false, error: e.message }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

export { Spinner };
