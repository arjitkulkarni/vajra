"use client";

/**
 * TRUST THROUGH AN INCIDENT — the chart that makes "continuous trust" a number rather than a claim.
 *
 * ── EVERY POINT IS AN ENGINE CONSTANT APPLIED TO THE POINT BEFORE IT ────────────────────────────
 * Nothing here is drawn to look like a decline. Each step is one event from `packages/trust`, with
 * its literal delta, applied to the previous value:
 *
 *   1  baseline                                       identity 96          device 88
 *   2  impossible_travel   device −25                 identity 96          device 63
 *   3  new_device          identity −8, device reset  identity 88          device 40  (first_seen)
 *   4  liveness_failed     identity −15, device −20   identity 73          device 20
 *   5  incident_opened     identity −30               identity 43          device 20
 *   6  admin_trusted       device max(·, 90)          identity 43          device 90
 *   7  clean_day           identity +2                identity 45          device 90
 *   8  approval_received   identity +5                identity 50          device 90
 *
 * The two dashed rules are the trust floors for a HIGH-sensitivity action, also literals: identity
 * soft 65 (below it, step up) and identity hard 45 (below it, deny). Point 5 lands at 43 — under
 * the hard floor — which is why the request in that moment is refused rather than merely
 * challenged. The asymmetry is the argument: one incident costs 30, and a clean day returns 2.
 *
 * ── THE DRAW, AND TWO TRAPS IN IT ───────────────────────────────────────────────────────────────
 * Both lines carry `pathLength={1}`, so `.trace-path` can dash them with a single unit-length value
 * that is correct regardless of how long either path really is.
 *
 * The two ways this goes wrong, both of which it went wrong in:
 *
 *   MEASURING INSTEAD.  `getTotalLength()` written to a `--len` custom property in an effect looks
 *   equivalent and is not: React rewrites the `style` attribute on the next render and silently
 *   drops any property set imperatively on an element that also carries a `style` prop. One line
 *   drew, the other was left permanently part-drawn.
 *
 *   `vector-effect: non-scaling-stroke`.  It is right for the rules and the dots — a hairline
 *   should stay a hairline at any size — and it is WRONG here, because Chrome then computes the
 *   dash pattern in screen space too. This chart draws at roughly 1.8× its viewBox, so one
 *   "normalised unit" of dash covered 1/1.8 of the path and the line stopped 58% along, every
 *   time, looking exactly like a transition that had not finished. The two animated paths scale
 *   their strokes with the drawing; nothing else in the figure does.
 */
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n-client";

const STEPS = ["baseline", "location", "device", "liveness", "denied", "trusted", "clean", "approval"] as const;
const IDENTITY = [96, 96, 88, 73, 43, 43, 45, 50];
const DEVICE = [88, 63, 40, 20, 20, 90, 90, 90];

/** The identity floors for a high-sensitivity action. `packages/trust/src/index.ts` TRUST_GATES. */
const SOFT = 65;
const HARD = 45;

const W = 660;
const H = 268;
const PAD = { l: 34, r: 16, t: 22, b: 58 };

const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / (STEPS.length - 1);
const y = (v: number) => PAD.t + ((100 - v) / 100) * (H - PAD.t - PAD.b);

/** A polyline through the points, as one `d`. Straight segments: a spline would invent values. */
const line = (series: number[]) => series.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

export function TrustDecay() {
  const wrap = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const { t, n } = useI18n();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -15% 0px", threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={wrap} className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full overflow-visible"
        fill="none"
        role="img"
        aria-label={t("site.page.continuous.caption")}
      >
        {/* The band under the hard floor: the region in which a sensitive action is refused. */}
        <rect x={PAD.l} y={y(HARD)} width={W - PAD.l - PAD.r} height={y(0) - y(HARD)} fill="var(--color-oxide-soft)" opacity="0.5" />

        {/* Horizontal ruling at 0/25/50/75/100, faint enough to read as paper. */}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} stroke="var(--color-line-faint)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <text x={PAD.l - 8} y={y(v) + 3.5} textAnchor="end" className="fill-[var(--color-ink-4)] font-mono text-[10px]">
              {v}
            </text>
          </g>
        ))}

        {/* The two floors. Labelled at the LEFT edge: the right edge is where the last reading sits,
            and a floor label there lands on top of its value. */}
        {[
          { v: SOFT, stroke: "var(--color-saffron)", label: t("verdict.stepUpShort") },
          { v: HARD, stroke: "var(--color-oxide)", label: t("verdict.denyShort") },
        ].map((f) => (
          <g key={f.v}>
            <line x1={PAD.l} y1={y(f.v)} x2={W - PAD.r} y2={y(f.v)} stroke={f.stroke} strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            <text
              x={PAD.l + 6}
              y={y(f.v) - 5}
              textAnchor="start"
              className="font-mono text-[9.5px] uppercase tracking-[0.1em]"
              fill={f.stroke}
              stroke="var(--color-paper)"
              strokeWidth="3"
              style={{ paintOrder: "stroke" }}
            >
              {f.label} · {f.v}
            </text>
          </g>
        ))}

        {/* Device trust: the quieter of the two, so it is a hairline and it sits behind. */}
        <path
          d={line(DEVICE)}
          pathLength={1}
          data-shown={shown}
          className="trace-path [transition-delay:180ms]"
          stroke="var(--color-steel)"
          strokeWidth="0.9"
          strokeOpacity="0.55"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Identity trust: the line the floors are about. */}
        <path
          d={line(IDENTITY)}
          pathLength={1}
          data-shown={shown}
          className="trace-path"
          stroke="var(--color-ink)"
          strokeWidth="1.35"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* The readings. Each dot takes the tone of the floor it is above — or below. */}
        {IDENTITY.map((v, i) => {
          const tone = v < HARD ? "var(--color-oxide)" : v < SOFT ? "var(--color-saffron)" : "var(--color-verdigris)";
          const last = i === IDENTITY.length - 1;
          return (
            <g
              key={i}
              className={cx("transition-opacity duration-500 ease-out", shown ? "opacity-100" : "opacity-0")}
              style={{ transitionDelay: `${600 + i * 70}ms` }}
            >
              <circle cx={x(i)} cy={y(v)} r="4.5" fill="var(--color-paper)" stroke={tone} strokeWidth="2" vectorEffect="non-scaling-stroke" />
              <text
                x={last ? x(i) + 2 : x(i)}
                y={y(v) - 13}
                textAnchor={last ? "end" : "middle"}
                className="font-mono text-[11px] font-medium"
                fill={tone}
                stroke="var(--color-paper)"
                strokeWidth="3"
                style={{ paintOrder: "stroke" }}
              >
                {n(v)}
              </text>
            </g>
          );
        })}

        {/* Event labels along the foot, on two alternating baselines. Eight labels of this length
            cannot share one line at this width — "clean activity" and "manager approval" collide by
            about twenty units — and staggering them is legible where truncating them is not. */}
        {STEPS.map((s, i) => (
          <g key={s}>
            <line
              x1={x(i)}
              y1={y(0)}
              x2={x(i)}
              y2={H - (i % 2 === 0 ? 40 : 24)}
              stroke="var(--color-line-faint)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={x(i)}
              y={H - (i % 2 === 0 ? 30 : 14)}
              textAnchor={i === 0 ? "start" : i === STEPS.length - 1 ? "end" : "middle"}
              className="fill-[var(--color-ink-3)] font-mono text-[9.5px]"
            >
              {t(`site.page.continuous.events.${s}`)}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        {[
          { label: t("trust.identity"), cls: "bg-ink" },
          { label: t("trust.device"), cls: "bg-steel/60" },
        ].map((k) => (
          <span key={k.label} className="flex items-center gap-2 text-[0.8125rem] text-ink-3">
            <span aria-hidden className={cx("block h-0.5 w-5 rounded-[var(--radius-pill)]", k.cls)} />
            {k.label}
          </span>
        ))}
      </div>
    </div>
  );
}
