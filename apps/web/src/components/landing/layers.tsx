"use client";

/**
 * THE SIX LAYERS, as a stack you can point at.
 *
 * The deck draws this as six stacked boxes with the trust engine highlighted. A stack of six boxes
 * is a list; what makes it an ARCHITECTURE is the direction of travel and the one rule at the
 * bottom, so this version keeps the stack but adds the spine: a hairline running down the left,
 * with a brass segment that follows the pointer. Hover or focus a layer and the spine says how far
 * down the request has got.
 *
 * Interaction is genuinely progressive: with no pointer and no keyboard the stack is a legible
 * static diagram, every note is visible, and nothing is hidden behind a hover.
 */
import { useState } from "react";
import { cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n-client";

const LAYERS = ["l1", "l2", "l3", "l4", "l5", "l6"] as const;

/** The one layer the deck highlights: everything above it collects, everything below it records. */
const PIVOT = "l4";

export function LayerStack() {
  const { t } = useI18n();
  const [hot, setHot] = useState<string | null>(null);
  const hotIndex = hot ? LAYERS.indexOf(hot as (typeof LAYERS)[number]) : -1;

  return (
    <ol className="relative" onMouseLeave={() => setHot(null)}>
      {/* The spine and the travelled segment. `scaleY` on a fixed-height rail, so nothing lays out. */}
      <span aria-hidden className="absolute bottom-6 left-[13px] top-6 w-px bg-line" />
      <span
        aria-hidden
        className="absolute left-[13px] top-6 w-px origin-top bg-brass transition-transform duration-300 ease-out-soft"
        style={{ height: "calc(100% - 3rem)", transform: `scaleY(${hotIndex < 0 ? 0 : (hotIndex + 1) / LAYERS.length})` }}
      />

      {LAYERS.map((id, i) => {
        const on = hot === id;
        const pivot = id === PIVOT;
        return (
          <li key={id}>
            <div
              tabIndex={0}
              onMouseEnter={() => setHot(id)}
              onFocus={() => setHot(id)}
              onBlur={() => setHot(null)}
              className={cx(
                "group relative flex items-start gap-4 rounded-[var(--radius-card)] border px-4 py-4 transition-[border-color,background-color,transform] duration-200 ease-out-soft",
                on ? "border-line-strong bg-overlay-1" : "border-transparent",
                on && "translate-x-1",
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "relative z-10 mt-0.5 grid h-[27px] w-[27px] shrink-0 place-items-center rounded-[var(--radius-pill)] border font-mono text-[0.6875rem] font-medium leading-none tnum transition-[color,background-color,border-color] duration-200 ease-out",
                  on || pivot ? "border-brass-line bg-brass-soft text-brass-deep" : "border-line bg-paper text-ink-3",
                )}
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="flex flex-wrap items-center gap-2 font-display text-[1.0625rem] font-semibold leading-snug tracking-[-0.015em]">
                  {t(`site.page.layers.items.${id}.name`)}
                  {pivot && (
                    <span className="rounded-[var(--radius-pill)] border border-brass-line bg-brass-soft px-2 py-px text-[0.6875rem] font-medium leading-5 text-brass-deep">
                      {t("verdict.allowShort")} · {t("verdict.stepUpShort")} · {t("verdict.denyShort")}
                    </span>
                  )}
                </h3>
                <p className="mt-1.5 font-mono text-[0.8125rem] leading-relaxed text-ink-3">{t(`site.page.layers.items.${id}.note`)}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
