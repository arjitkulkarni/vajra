"use client";

/**
 * The deep half of the auth landing.
 *
 * It would have been easy to put a stock photograph here. Instead it shows the one thing the
 * product actually does at the door: the five verifications, taking their turn. The rail advances
 * on a slow loop, so someone standing in front of the screen learns the shape of the check before
 * they have typed anything — and what they learn is true, because these are the real gate names in
 * the real order the gateway evaluates them.
 *
 * On Blacklight both halves of the door are dark, so this one can no longer be "the dark one". It
 * is the DEEP one instead, and it earns that four ways:
 *
 *   ground      the console well (#08090B) against the form's ground (#0E0F11). Only ~6% of
 *               luminance, which is beautiful on OLED and vanishes on a conference projector — so
 *               the seam is carried by an explicit hairline on the right edge, never by fill alone.
 *   atmosphere  every moving and textured thing on the screen lives here: two drifting light
 *               sources, the blueprint lattice, grain, the mark drawing itself. The form half is
 *               deliberately inert by comparison.
 *   accent      text in the well takes console-accent (#6FA3FF), half a step paler than brass,
 *               because the same blue on a darker ground reads a shade heavier than it should.
 *   memory      the rail no longer just blinks the current gate. Gates already passed keep a dim
 *               brass hairline, so the bundle visibly ACCUMULATES across the loop and resets — a
 *               five-beat phrase rather than five unrelated flashes.
 *
 * Everything moves on transform and opacity only, and the whole panel is static under
 * prefers-reduced-motion — in which case every gate reads as lit at once, which is the honest
 * still frame of "five checks, all of them".
 */
import { useEffect, useState } from "react";
import { VERIFICATION_GATES } from "@vajra/contracts";
import { useI18n } from "@/lib/i18n-client";
import { cx } from "@/components/ui";

const STEP_MS = 1500;

export function AuthAside() {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStill(true);
      return;
    }
    const id = setInterval(() => setActive((i) => (i + 1) % VERIFICATION_GATES.length), STEP_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className="grain relative isolate hidden overflow-hidden border-r border-line bg-console text-console-text lg:flex lg:flex-col">
      {/* Ambient field: two drifting light sources under a blueprint lattice. */}
      <div className="auth-aurora pointer-events-none absolute inset-0 -z-10 opacity-70" aria-hidden />
      <div className="auth-lattice pointer-events-none absolute inset-0 -z-10" aria-hidden />

      {/* The mark, oversized and quiet, drawing itself once on arrival. */}
      <svg
        viewBox="0 0 28 28"
        className="pointer-events-none absolute -right-16 -top-10 -z-10 h-[26rem] w-[26rem] text-brass opacity-[0.08]"
        fill="none"
        aria-hidden
      >
        <path
          d="M14 2.5 L20 10 L16.5 10 L21 25.5 L14 17 L7 25.5 L11.5 10 L8 10 Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="0.35"
          className={cx("auth-bolt-stroke", "auth-bolt-fill")}
        />
      </svg>

      <div className="relative flex flex-1 flex-col justify-between px-12 py-14 xl:px-16">
        <div>
          <p
            className="rise text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-console-accent"
            style={{ animationDelay: "80ms" }}
          >
            {t("brand.expansion")}
          </p>
          <h2
            className="rise mt-6 max-w-md font-display text-[2.25rem] leading-[1.1] tracking-[-0.025em] xl:text-[2.625rem]"
            style={{ animationDelay: "160ms" }}
          >
            {t("brand.tagline")}
          </h2>
          <p className="rise mt-5 max-w-md text-[0.9375rem] leading-relaxed text-console-muted" style={{ animationDelay: "240ms" }}>
            {t("auth.asideBody")}
          </p>
        </div>

        {/* The five gates, taking their turn. */}
        <div className="rise mt-14" style={{ animationDelay: "340ms" }}>
          <p className="mb-4 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-console-muted">{t("verify.bundle")}</p>
          <ol className="relative space-y-px">
            {/* The spine: it is the same five checks in the same fixed order every time, and a
                connecting hairline says "sequence" where five loose dots say "options". */}
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-4 left-[10px] top-4 w-px -translate-x-1/2 bg-line-faint"
            />
            {VERIFICATION_GATES.map((gate, i) => {
              const on = still || i === active;
              const passed = !still && i < active;
              return (
                <li key={gate} className="relative py-2.5">
                  {/* The lit row lifts one overlay step. It bleeds past the text column so the band
                      reads as a row and not as a highlighted word. */}
                  <span
                    aria-hidden
                    className={cx(
                      "pointer-events-none absolute -inset-x-3 inset-y-0 rounded-[var(--radius-panel)] transition-colors duration-300 ease-out",
                      on ? "bg-overlay-1" : "bg-transparent",
                    )}
                  />
                  <div className="relative flex items-center gap-3">
                    <span className="relative grid h-5 w-5 shrink-0 place-items-center">
                      <span
                        className={cx(
                          "h-1.5 w-1.5 rounded-[var(--radius-pill)] transition-[transform,background-color] duration-300 ease-out-soft",
                          on ? "scale-150 bg-brass" : passed ? "bg-brass/40" : "bg-console-3",
                        )}
                      />
                      {on && !still && (
                        <span className="auth-gate-halo absolute h-2 w-2 rounded-[var(--radius-pill)] bg-brass/40" aria-hidden />
                      )}
                    </span>
                    <span
                      className={cx(
                        "tnum font-mono text-[0.6875rem] transition-colors duration-300 ease-out",
                        on ? "text-console-accent" : "text-console-muted",
                      )}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={cx(
                        "text-[0.875rem] transition-colors duration-300 ease-out",
                        on ? "text-console-text" : "text-console-muted",
                      )}
                    >
                      {t(`verify.gates.${gate}`)}
                    </span>
                  </div>
                  {/* The hairline underneath fills for exactly one beat, then holds dim. It starts
                      at the text column — 20px dot plus a 12px gap — so the spine keeps the gutter
                      to itself. Linear on purpose: it is elapsed time, not a flourish. */}
                  <span className="absolute bottom-0 left-8 right-0 block h-px bg-line-faint" aria-hidden>
                    {on ? (
                      <span
                        key={`${gate}-${active}`}
                        className={cx("block h-px bg-brass", !still && "auth-gate-fill")}
                        style={{ animationDuration: `${STEP_MS}ms` }}
                      />
                    ) : (
                      passed && <span className="block h-px bg-brass/30" />
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <p className="rise mt-12 text-[0.75rem] leading-relaxed text-console-muted" style={{ animationDelay: "420ms" }}>
          {t("auth.asideFoot")}
        </p>
      </div>
    </aside>
  );
}
