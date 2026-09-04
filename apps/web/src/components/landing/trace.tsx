"use client";

/**
 * The decision trace, under a three-way switch. One request shape, three outcomes — and the same
 * five rows every time, because "every decision explains itself" is only a claim worth making if
 * the explanation has a FIXED shape a reader can learn once.
 *
 * The mockup is `DecisionTrace` out of `site/mockups.tsx`, which already holds a corpus whose
 * arithmetic adds to the score its stamp claims. Nothing is re-implemented here; this file is the
 * switch and the crossfade, and the crossfade is `.auth-panel` — the 260 ms entrance the auth
 * screen's tab panels already use, so the two places on the site that swap a panel do it the
 * same way.
 */
import { useState } from "react";
import { DecisionTrace } from "@/components/site/mockups";
import { cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n-client";

const TABS = [
  { id: "ALLOW", key: "allow" },
  { id: "STEP_UP", key: "stepUp" },
  { id: "DENY", key: "deny" },
] as const;

const TAB_TONE: Record<string, string> = {
  ALLOW: "border-verdigris-line bg-verdigris-soft text-verdigris",
  STEP_UP: "border-saffron-line bg-saffron-soft text-saffron",
  DENY: "border-oxide-line bg-oxide-soft text-oxide",
};

export function TraceSwitch() {
  const { t } = useI18n();
  const [active, setActive] = useState<(typeof TABS)[number]["id"]>("ALLOW");

  return (
    <div>
      <div role="tablist" aria-label={t("trace.title")} className="flex flex-wrap gap-1.5">
        {TABS.map((tab) => {
          const on = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(tab.id)}
              className={cx(
                "rounded-[var(--radius-pill)] border px-3.5 py-1.5 text-[0.8125rem] font-medium leading-5 transition-[color,background-color,border-color] duration-150 ease-out active:translate-y-px",
                on ? TAB_TONE[tab.id] : "border-line text-ink-3 hover:border-line-strong hover:bg-overlay-2 hover:text-ink",
              )}
            >
              {t(`site.page.decision.tabs.${tab.key}`)}
            </button>
          );
        })}
      </div>

      {/* Keyed by verdict so the panel remounts and replays its entrance on every switch. */}
      <div key={active} className="auth-panel mt-5">
        <DecisionTrace verdict={active} seed={active === "ALLOW" ? 3 : active === "STEP_UP" ? 11 : 19} label={t("site.features.trace.caption")} />
      </div>
    </div>
  );
}
