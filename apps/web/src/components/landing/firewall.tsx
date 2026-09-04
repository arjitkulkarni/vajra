"use client";

/**
 * THE TRUST FIREWALL — the one scroll-driven figure on the page.
 *
 * A tall section holds a sticky viewport-height stage. Scrolling through it does not animate the
 * diagram; it CHANGES THE REQUEST. Three scenarios run through the identical machine — the same ten
 * inputs, the same gate, the same three outcomes — and the only thing that differs is what actually
 * happened. That is the argument the section makes, and a decorative animation would have made a
 * weaker one.
 *
 * ── THE NUMBERS ARE THE REAL ONES ───────────────────────────────────────────────────────────────
 * Every value below is a literal from the engines, not a plausible-looking figure:
 *
 *   risk weights   new_device 30 · impossible_travel 25 · failed_liveness 25 · odd_hours 15 ·
 *                  burst 15 · abnormal_volume 15                       packages/trust/src/index.ts
 *   risk tiers     low 0–29 · elevated 30–59 · high 60–100             packages/contracts/src
 *   trust floors   high: identity soft 65 / hard 45, device soft 60 / hard 40   packages/trust/src
 *   device trust   first_seen = 40 · impossible_travel −25             packages/trust/src
 *
 * So scene three sums to exactly 100 the way the insider test in `trust/src/index.test.ts` does, and
 * scene two is STEP_UP because a high-sensitivity download is a sensitive action class — which the
 * policy engine steps up unconditionally, before risk is even consulted.
 *
 * ── WHY THERE IS NO SCROLL LISTENER ─────────────────────────────────────────────────────────────
 * The stage does not need a continuous position, only which of three it is in — so it is read with
 * three sentinels and one IntersectionObserver whose root margin collapses the viewport to a single
 * line across its middle. Exactly one sentinel can cross that line, so the observer fires once per
 * boundary instead of once per frame, and the section costs nothing at all while it is off screen.
 * A `scroll` handler calling `getBoundingClientRect()` would be a forced layout on every frame of
 * every scroll on the page, to learn a number that changes three times.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { VerdictStamp } from "@/components/console";
import { cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n-client";

type Verdict = "ALLOW" | "STEP_UP" | "DENY";

/** The ten inputs, in the order the deck's chip rows read them. */
const INPUTS = ["person", "device", "location", "time", "role", "asset", "action", "risk", "liveness", "policy"] as const;
type Input = (typeof INPUTS)[number];

type Scene = {
  verdict: Verdict;
  /** What each input evaluated to, for this request. `tone` drives the chip, `value` is the reading. */
  values: Record<Input, { value: string; tone: "good" | "warn" | "bad" }>;
  trust: { identity: number; device: number };
  /** Named signals with their literal weights. Empty when nothing fired. */
  signals: { key: string; points: number }[];
  risk: number;
  latency: number;
  /** The ordered trace, exactly as the engine returns it: a check, a state, a value. */
  trace: { label: string; state: "pass" | "warn" | "fail"; value: string }[];
  outcome: string;
};

const SCENES: Scene[] = [
  {
    verdict: "ALLOW",
    values: {
      person: { value: "verified", tone: "good" },
      device: { value: "known · 41d", tone: "good" },
      location: { value: "Bengaluru", tone: "good" },
      time: { value: "14:32", tone: "good" },
      role: { value: "engineer", tone: "good" },
      asset: { value: "design · high", tone: "good" },
      action: { value: "open", tone: "good" },
      risk: { value: "0 · low", tone: "good" },
      liveness: { value: "0.96", tone: "good" },
      policy: { value: "asset.open v7", tone: "good" },
    },
    trust: { identity: 94, device: 88 },
    signals: [],
    risk: 0,
    latency: 88,
    trace: [
      { label: "Dependencies healthy", state: "pass", value: "db · risk" },
      { label: "Identity verified", state: "pass", value: "session ok" },
      { label: "Role permits open", state: "pass", value: "engineer" },
      { label: "Policy matched", state: "pass", value: "v7 · priority 100" },
      { label: "Within working hours", state: "pass", value: "08–20" },
      { label: "Trust above both floors", state: "pass", value: "94 / 88" },
      { label: "Risk overlay clear", state: "pass", value: "0 · low" },
    ],
    outcome: "Proof-of-Action issued · single-use link",
  },
  {
    verdict: "STEP_UP",
    values: {
      person: { value: "verified", tone: "good" },
      device: { value: "never seen", tone: "warn" },
      location: { value: "Bengaluru", tone: "good" },
      time: { value: "14:41", tone: "good" },
      role: { value: "engineer", tone: "good" },
      asset: { value: "design · high", tone: "good" },
      action: { value: "download", tone: "warn" },
      risk: { value: "30 · elevated", tone: "warn" },
      liveness: { value: "0.94", tone: "good" },
      policy: { value: "asset.download v7", tone: "good" },
    },
    trust: { identity: 94, device: 40 },
    signals: [{ key: "newDevice", points: 30 }],
    risk: 30,
    latency: 112,
    trace: [
      { label: "Dependencies healthy", state: "pass", value: "db · risk · ledger" },
      { label: "Identity verified", state: "pass", value: "session ok" },
      { label: "Role permits download", state: "pass", value: "engineer" },
      { label: "Policy matched", state: "pass", value: "v7 · priority 100" },
      { label: "Device unrecognised", state: "warn", value: "trust 40 < 60" },
      { label: "Risk overlay elevated", state: "warn", value: "30 · elevated" },
      { label: "Sensitive action class", state: "warn", value: "high" },
    ],
    outcome: "Re-verify the live person, then ALLOW",
  },
  {
    verdict: "DENY",
    values: {
      person: { value: "verified", tone: "good" },
      device: { value: "unenrolled", tone: "bad" },
      location: { value: "Mumbai", tone: "bad" },
      time: { value: "02:11", tone: "bad" },
      role: { value: "engineer", tone: "good" },
      asset: { value: "design · high", tone: "good" },
      action: { value: "transfer", tone: "bad" },
      risk: { value: "100 · high", tone: "bad" },
      liveness: { value: "failed", tone: "bad" },
      policy: { value: "asset.transfer v7", tone: "good" },
    },
    trust: { identity: 43, device: 15 },
    signals: [
      { key: "newDevice", points: 30 },
      { key: "impossibleTravel", points: 25 },
      { key: "oddHours", points: 15 },
      { key: "burst", points: 15 },
      { key: "abnormalVolume", points: 15 },
    ],
    risk: 100,
    latency: 96,
    trace: [
      { label: "Dependencies healthy", state: "pass", value: "db · risk · ledger" },
      { label: "Identity verified", state: "pass", value: "session ok" },
      { label: "Role permits transfer", state: "pass", value: "engineer" },
      { label: "Ownership unproven", state: "fail", value: "not_owner" },
      { label: "Device untrusted", state: "fail", value: "trust 15 < 40" },
      { label: "Trust below hard floor", state: "fail", value: "43 < 45" },
      { label: "Risk overlay high", state: "fail", value: "100 · high" },
    ],
    outcome: "Incident opened · sessions locked · grants revoked",
  },
];

const TONE_CHIP: Record<"good" | "warn" | "bad", string> = {
  good: "border-verdigris-line bg-verdigris-soft text-verdigris",
  warn: "border-saffron-line bg-saffron-soft text-saffron",
  bad: "border-oxide-line bg-oxide-soft text-oxide",
};
const TONE_STROKE: Record<"good" | "warn" | "bad", string> = {
  good: "var(--color-verdigris)",
  warn: "var(--color-saffron)",
  bad: "var(--color-oxide)",
};
const VERDICT_STROKE: Record<Verdict, string> = {
  ALLOW: "var(--color-verdigris)",
  STEP_UP: "var(--color-saffron)",
  DENY: "var(--color-oxide)",
};
const STATE_GLYPH = { pass: "✓", warn: "⚠", fail: "✗" } as const;
const STATE_TEXT = { pass: "text-verdigris", warn: "text-saffron", fail: "text-oxide" } as const;

/**
 * The fan. Ten rays leave the top edge at even spacing and curve into one point above the gate,
 * which then stems down into the verdict. Cubic rather than straight because ten straight lines
 * converging on a point is a starburst, and a starburst reads as decoration.
 */
function Fan({ scene }: { scene: Scene }) {
  const paths = useMemo(
    () =>
      INPUTS.map((key, i) => {
        const x = 34 + i * 63.5;
        return { key, d: `M${x} 6 C${x} 58, 320 62, 320 112` };
      }),
    [],
  );

  return (
    <svg viewBox="0 0 640 208" className="h-auto w-full" fill="none" aria-hidden>
      {paths.map((p) => {
        const tone = scene.values[p.key].tone;
        return (
          <path
            key={p.key}
            d={p.d}
            stroke={TONE_STROKE[tone]}
            strokeOpacity={tone === "good" ? 0.42 : 0.9}
            strokeWidth={tone === "good" ? 1 : 1.6}
            className="flow transition-[stroke,stroke-width,stroke-opacity] duration-500 ease-out"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      {/* The gate. One bar, one pip, and the name of the thing that decides. */}
      <rect
        x="212"
        y="112"
        width="216"
        height="30"
        rx="6"
        fill="var(--color-brass-soft)"
        stroke="var(--color-brass-line)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx="320" cy="112" r="3.5" fill="var(--color-brass)" />
      <text
        x="320"
        y="132"
        textAnchor="middle"
        className="fill-[var(--color-brass-deep)] font-mono text-[11px] uppercase tracking-[0.14em]"
      >
        decide
      </text>

      {/* The stem. It is the only line on the figure whose colour is the verdict. */}
      <path
        d="M320 142 V178"
        stroke={VERDICT_STROKE[scene.verdict]}
        strokeWidth="2"
        className="transition-[stroke] duration-500 ease-out"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={
          scene.verdict === "ALLOW"
            ? "M320 178 H120 V200"
            : scene.verdict === "DENY"
              ? "M320 178 H520 V200"
              : "M320 178 V200"
        }
        stroke={VERDICT_STROKE[scene.verdict]}
        strokeWidth="2"
        strokeLinejoin="round"
        className="transition-[d] duration-500 ease-out"
        vectorEffect="non-scaling-stroke"
      />
      {/* The two roads not taken, kept visible so the diagram shows a CHOICE and not a pipeline. */}
      <g stroke="var(--color-line-strong)" strokeWidth="1" strokeDasharray="2 6" vectorEffect="non-scaling-stroke">
        {scene.verdict !== "ALLOW" && <path d="M320 178 H120 V200" />}
        {scene.verdict !== "STEP_UP" && <path d="M320 178 V200" />}
        {scene.verdict !== "DENY" && <path d="M320 178 H520 V200" />}
      </g>
    </svg>
  );
}

export function TrustFirewall() {
  const { t, n } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const sentinels = Array.from(el.querySelectorAll<HTMLElement>("[data-stage]"));
    if (sentinels.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const next = Number((entry.target as HTMLElement).dataset.stage);
          if (Number.isInteger(next)) setStage(next);
        }
      },
      // A zero-height root: the top and bottom margins collapse the viewport onto the line halfway
      // down it, so "intersecting" means "this third is what you are looking at".
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );
    sentinels.forEach((node) => io.observe(node));
    return () => io.disconnect();
  }, []);

  const scene = SCENES[stage]!;

  return (
    <div ref={track} className="relative h-[300vh]">
      {/* The three sentinels. Each owns a third of the track and nothing else; they are the only
          thing on the page that knows where the scroll is. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {SCENES.map((s, i) => (
          <div key={s.verdict} data-stage={i} className="h-1/3" />
        ))}
      </div>
      <div className="sticky top-0 flex min-h-screen items-center py-20">
        <div className="shell w-full">
          <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-center lg:gap-12">
            {/* ── the diagram ──────────────────────────────────────────────── */}
            <div className="min-w-0">
              <div
                className={cx(
                  "rail rail-until-lg edge-fade-x -mx-1 flex gap-1.5 px-1 pb-1",
                  // Past `lg` the row is a grid and each chip may wrap its value onto a second
                  // line, so the cells are stretched to a common height rather than left ragged.
                  "lg:mx-0 lg:grid lg:grid-cols-5 lg:items-stretch lg:px-0",
                )}
              >
                {INPUTS.map((key) => {
                  const v = scene.values[key];
                  return (
                    <span
                      key={key}
                      className={cx(
                        "flex shrink-0 flex-col gap-0.5 rounded-[var(--radius-control)] border px-2.5 py-1.5 transition-[color,background-color,border-color] duration-500 ease-out",
                        // In the grid a chip is a cell, not a scroller item: `shrink-0` plus the
                        // implicit `min-width:auto` would let the longest value widen its whole
                        // track and push the last column out of the row.
                        "lg:min-w-0 lg:shrink",
                        TONE_CHIP[v.tone],
                      )}
                    >
                      <span className="text-[0.6875rem] font-semibold uppercase leading-none tracking-[0.1em] opacity-80">
                        {t(`site.page.firewall.inputs.${key}`)}
                      </span>
                      <span className="font-mono text-[0.75rem] leading-tight tnum lg:break-words">{v.value}</span>
                    </span>
                  );
                })}
              </div>

              <Fan scene={scene} />

              <div className="flex flex-wrap items-center justify-center gap-2 sm:grid sm:grid-cols-3">
                {(
                  [
                    { v: "ALLOW", short: "allowShort" },
                    { v: "STEP_UP", short: "stepUpShort" },
                    { v: "DENY", short: "denyShort" },
                  ] as const
                ).map((o) => (
                  <div
                    key={o.v}
                    className={cx(
                      "flex justify-center transition-opacity duration-500 ease-out",
                      scene.verdict === o.v ? "opacity-100" : "opacity-30",
                    )}
                  >
                    <VerdictStamp verdict={o.v} label={t(`verdict.${o.short}`)} size={scene.verdict === o.v ? "lg" : "md"} />
                  </div>
                ))}
              </div>
              <p className="type-meta mt-5">{t("site.page.firewall.caption")}</p>
            </div>

            {/* ── the readout ──────────────────────────────────────────────── */}
            <div className="on-ink min-w-0 rounded-[var(--radius-card)] border border-line bg-paper p-5 shadow-media">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-faint pb-3">
                <div className="min-w-0">
                  <p className="eyebrow">{t("site.page.firewall.gate")}</p>
                  <p className="mt-1 font-mono text-[0.8125rem] text-ink-2 tnum">
                    {scene.values.role.value} · {scene.values.action.value} · {scene.latency} ms
                  </p>
                </div>
                <VerdictStamp verdict={scene.verdict} label={t(`verdict.${scene.verdict}`)} />
              </div>

              <ol className="mt-3">
                {scene.trace.map((row, i) => (
                  <li
                    key={`${stage}-${row.label}`}
                    className={cx(
                      "tick flex items-center gap-2.5 border-b border-line-faint py-[7px] last:border-0",
                      row.state === "fail" && "-mx-2 bg-oxide-soft/50 px-2",
                    )}
                    // Keyed by stage, so the ladder remounts and ticks in again on every change.
                    style={{ animationDelay: `${i * 55}ms` }}
                  >
                    <span aria-hidden className={cx("w-3 shrink-0 text-center text-[0.75rem]", STATE_TEXT[row.state])}>
                      {STATE_GLYPH[row.state]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-2">{row.label}</span>
                    <span className="shrink-0 font-mono text-[0.75rem] text-ink-3 tnum">{row.value}</span>
                  </li>
                ))}
              </ol>

              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line-faint pt-3">
                {[
                  { k: t("trust.identity"), v: scene.trust.identity, floor: 45 },
                  { k: t("trust.device"), v: scene.trust.device, floor: 40 },
                  { k: t("risk.label"), v: scene.risk, floor: null },
                ].map((m) => (
                  <div key={m.k}>
                    <p className="eyebrow truncate">{m.k}</p>
                    <p
                      className={cx(
                        "mt-1 font-mono text-[1.125rem] font-medium leading-none tnum transition-colors duration-500 ease-out",
                        m.floor === null
                          ? m.v >= 60
                            ? "text-oxide"
                            : m.v >= 30
                              ? "text-saffron"
                              : "text-verdigris"
                          : m.v < m.floor
                            ? "text-oxide"
                            : m.v < m.floor + 20
                              ? "text-saffron"
                              : "text-verdigris",
                      )}
                    >
                      {n(m.v)}
                    </p>
                  </div>
                ))}
              </div>

              {scene.signals.length > 0 && (
                <div className="mt-4 border-t border-line-faint pt-3">
                  <p className="eyebrow">{t("site.page.scoring.riskTitle")}</p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {scene.signals.map((s, i) => (
                      <li
                        key={`${stage}-${s.key}`}
                        className="tick inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-oxide-line bg-oxide-soft px-2.5 py-0.5 text-[0.75rem] font-medium leading-5 text-oxide"
                        style={{ animationDelay: `${i * 70}ms` }}
                      >
                        {t(`site.page.scoring.signals.${s.key}`)}
                        <span className="font-mono tnum opacity-70">+{s.points}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mt-4 flex items-start gap-2 border-t border-line-faint pt-3 font-mono text-[0.75rem] leading-relaxed text-ink-3">
                <span aria-hidden>→</span>
                <span>{scene.outcome}</span>
              </p>
            </div>
          </div>

          {/* The stage rail. Three dots, so a reader knows the section has an end. */}
          <div className="mt-8 flex items-center justify-center gap-2" aria-hidden>
            {SCENES.map((s, i) => (
              <span
                key={s.verdict}
                className={cx(
                  "h-1 rounded-[var(--radius-pill)] transition-[width,background-color] duration-300 ease-out-soft",
                  i === stage ? "w-8 bg-ink" : "w-3 bg-line-strong",
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
