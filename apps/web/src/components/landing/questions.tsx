"use client";

/**
 * The nine questions reviewers actually ask, as a single-open accordion.
 *
 * In place of testimonials nobody believes, the objections — attributed to the role that raises
 * them, answered in a line. The first is open on arrival so the pattern is legible before anything
 * is clicked.
 *
 * The panel does NOT animate its height. A height or grid-rows transition is an animated LAYOUT
 * property, which is the one thing the motion rules in globals.css forbid outright; the answer
 * arrives on `.auth-panel` instead — opacity and an 8px lift, the same 260 ms entrance the auth
 * screen uses — and the row below it simply moves.
 */
import { useState } from "react";
import { QUESTION_IDS } from "@/components/site/data";
import { cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n-client";

export function Questions() {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(QUESTION_IDS[0] ?? null);

  return (
    <ul className="border-t border-line">
      {QUESTION_IDS.map((id) => {
        const on = open === id;
        return (
          <li key={id} className="border-b border-line">
            <h3>
              <button
                type="button"
                aria-expanded={on}
                onClick={() => setOpen(on ? null : id)}
                className="group flex w-full items-start gap-4 py-5 text-left transition-[background-color] duration-150 ease-out hover:bg-overlay-1"
              >
                <span className="min-w-0 flex-1">
                  <span className="eyebrow block">{t(`site.questions.items.${id}.role`)}</span>
                  <span
                    className={cx(
                      "mt-1.5 block font-display text-[1.0625rem] font-semibold leading-snug tracking-[-0.015em] transition-colors duration-150 ease-out sm:text-[1.1875rem]",
                      on ? "text-ink" : "text-ink-2 group-hover:text-ink",
                    )}
                  >
                    {t(`site.questions.items.${id}.question`)}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cx(
                    "mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-pill)] border transition-[transform,color,background-color,border-color] duration-200 ease-out-soft",
                    on ? "rotate-45 border-brass-line bg-brass-soft text-brass-deep" : "border-line text-ink-3 group-hover:border-line-strong",
                  )}
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </span>
              </button>
            </h3>
            {on && (
              <div className="auth-panel pb-6 pr-11">
                <p className="max-w-[68ch] text-[0.9375rem] leading-[1.65] text-ink-2">{t(`site.questions.items.${id}.answer`)}</p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
