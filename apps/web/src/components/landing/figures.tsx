/**
 * THE BESPOKE FIGURES — the drawings this page needed and `site/mockups.tsx` does not have.
 *
 * Server components, every one. Their motion is CSS that runs without JavaScript (`.term`, `.flow`,
 * `.tick`) or it is a `Reveal` wrapper mounted around them by the caller, so nothing here ships a
 * byte to the browser. They take `t` as a prop rather than reaching for `useI18n`, which is what
 * keeps them on the server: the hook is a client hook, the lookup is not.
 *
 * Tokens only, no raw colours — so each of these also works dropped inside `.on-ink`, which the
 * formula and the chain split both are.
 */
import { Reveal, RevealGroup } from "@/components/ui";
import { CARD, Pip, Tick, cx } from "./kit";

type T = (path: string, params?: Record<string, string | number>) => string;

// ═════════════════════════════════════════════════════════════════════════════
// THE ACCESS EXPRESSION
// ═════════════════════════════════════════════════════════════════════════════

const TERMS = ["identity", "rbac", "abac", "risk", "liveproof"] as const;

/**
 * `Access = IdentityValid ∧ RBAC ∧ ABAC ∧ (Risk < Threshold) ∧ LiveProof`, set as five chips joined
 * by the logical AND — and taking their turn, left to right, at one second a term.
 *
 * The loop is `.term` in globals.css: colour only, five beats, one delay per chip written as a
 * custom property. There is no JavaScript here and no state; the conjunction lights in the order it
 * is evaluated because the delays say so.
 */
export function Formula({ t }: { t: T }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-3">
        <span className="font-display text-[1.375rem] font-semibold tracking-[-0.02em] text-ink sm:text-[1.75rem]">
          {t("site.page.formula.lhs")}
        </span>
        <span aria-hidden className="font-mono text-[1.25rem] text-ink-3 sm:text-[1.5rem]">
          =
        </span>
        {TERMS.map((term, i) => (
          <span key={term} className="flex items-center gap-2.5">
            <span
              className="term rounded-[var(--radius-control)] border border-line px-3 py-1.5 font-mono text-[0.8125rem] leading-5 text-ink-2 sm:text-[0.9375rem]"
              style={{ "--term": i } as React.CSSProperties}
            >
              {t(`site.page.formula.terms.${term}`)}
            </span>
            {i < TERMS.length - 1 && (
              <span aria-hidden className="font-mono text-[1.125rem] leading-none text-ink-4">
                ∧
              </span>
            )}
          </span>
        ))}
      </div>
      <p className="mt-7 max-w-[56ch] text-[0.9375rem] leading-[1.65] text-ink-2">{t("site.page.formula.note")}</p>

      <dl className="mt-8 grid gap-3 sm:grid-cols-3">
        {(
          [
            { k: "allow", word: "ALLOW", tone: "verdigris" },
            { k: "stepUp", word: "STEP-UP", tone: "saffron" },
            { k: "deny", word: "DENY", tone: "oxide" },
          ] as const
        ).map((v) => (
          <div key={v.k} className="rounded-[var(--radius-card)] border border-line-faint bg-overlay-1 px-4 py-3.5">
            <dt
              className={cx(
                "font-mono text-[0.75rem] font-medium uppercase tracking-[0.12em]",
                v.tone === "verdigris" && "text-verdigris",
                v.tone === "saffron" && "text-saffron",
                v.tone === "oxide" && "text-oxide",
              )}
            >
              {v.word}
            </dt>
            <dd className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-2">{t(`site.page.formula.verdicts.${v.k}`)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// THE FIVE VERIFICATIONS
// ═════════════════════════════════════════════════════════════════════════════

const GATES = ["employee", "document", "match", "liveness", "signature"] as const;

/** The five gates as an ordered rail. The spine is a hairline; each gate is a numbered stop on it. */
export function FiveGates({ t }: { t: T }) {
  return (
    <RevealGroup as="ol" className="relative" stagger={70}>
      {GATES.map((gate, i) => (
        <li key={gate} className="relative flex gap-4 pb-6 last:pb-0">
          {/* The spine runs BETWEEN the pips, not through them: it stops short at both ends. */}
          {i < GATES.length - 1 && <span aria-hidden className="absolute bottom-1 left-[13px] top-8 w-px bg-line" />}
          <Pip n={String(i + 1).padStart(2, "0")} />
          <div className="min-w-0 pt-0.5">
            <h3 className="font-display text-[1.0625rem] font-semibold leading-snug tracking-[-0.015em]">
              {t(`site.page.gates.items.${gate}.title`)}
            </h3>
            <p className="mt-1.5 max-w-[54ch] text-[0.875rem] leading-[1.6] text-ink-2">{t(`site.page.gates.items.${gate}.body`)}</p>
          </div>
        </li>
      ))}
    </RevealGroup>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ON THE DEVICE / ON THE WIRE
// ═════════════════════════════════════════════════════════════════════════════

const STAYS = ["frame", "embedding", "key"] as const;
const CROSSES = ["match", "liveness", "signature"] as const;

/**
 * The privacy claim, drawn rather than asserted. Left: what the browser holds and never sends.
 * Right: the three bounded values that do cross. The strip between them is the wire — a dashed
 * hairline with three arrows marching along it, which is the `.flow` loop.
 *
 * Drawn as three grid columns rather than one SVG so it can restack on a phone without a second
 * viewBox: at `md` the wire is vertical between two cards, below it the wire becomes a row.
 */
export function PrivacySplit({ t }: { t: T }) {
  return (
    <div className="grid items-stretch gap-4 md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)] md:gap-0">
      {/* ── the device ── */}
      <div className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 20 20" className="h-4 w-4 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <rect x="2.5" y="4" width="15" height="10" rx="1.5" />
            <path d="M1 16.5h18" strokeLinecap="round" />
          </svg>
          <p className="eyebrow">{t("site.page.privacy.device")}</p>
        </div>
        <ul className="mt-4 space-y-2.5">
          {STAYS.map((k) => (
            <li key={k} className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="grid h-[1.125rem] w-[1.125rem] shrink-0 place-items-center rounded-[var(--radius-pill)] border border-steel-line bg-steel-soft text-[0.625rem] leading-none text-steel"
              >
                ▮
              </span>
              <span className="text-[0.875rem] leading-snug text-ink-2">{t(`site.page.privacy.deviceItems.${k}`)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── the wire ── */}
      <div aria-hidden className="relative flex items-center justify-center py-2 md:py-0">
        <svg viewBox="0 0 112 8" preserveAspectRatio="none" className="h-2 w-full md:hidden" fill="none">
          <path d="M0 4H112" stroke="var(--color-line-strong)" strokeWidth="1" className="flow" vectorEffect="non-scaling-stroke" />
        </svg>
        <svg viewBox="0 0 8 160" preserveAspectRatio="none" className="hidden h-full w-2 md:block" fill="none">
          <path d="M4 0V160" stroke="var(--color-line-strong)" strokeWidth="1" className="flow" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute rounded-[var(--radius-pill)] border border-line bg-paper px-2.5 py-1">
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-ink-3">{t("site.page.privacy.wire")}</span>
        </span>
      </div>

      {/* ── what crosses ── */}
      <div className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 20 20" className="h-4 w-4 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <rect x="3" y="3" width="14" height="6" rx="1.5" />
            <rect x="3" y="11" width="14" height="6" rx="1.5" />
            <path d="M6 6h.01M6 14h.01" strokeLinecap="round" />
          </svg>
          <p className="eyebrow">{t("site.page.privacy.wire")}</p>
        </div>
        <ul className="mt-4 space-y-2.5">
          {CROSSES.map((k) => (
            <li key={k} className="flex items-center gap-2.5">
              <Tick />
              <span className="font-mono text-[0.8125rem] leading-snug text-ink-2">{t(`site.page.privacy.wireItems.${k}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// THE SEVEN-STEP WORKFLOW
// ═════════════════════════════════════════════════════════════════════════════

const STEPS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"] as const;

/**
 * Seven steps, each carrying the artefact it leaves. The outcome line is verdigris and mono because
 * it is the EVIDENCE — the thing a machine produced — and it is what makes the step a step rather
 * than a stage name.
 */
export function StepRail({ t }: { t: T }) {
  return (
    <RevealGroup as="ol" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" stagger={55}>
      {STEPS.map((id, i) => (
        <li key={id} className={cx("h-full", i === 0 && "lg:col-span-1")}>
          <article className={cx("flex h-full flex-col p-5", CARD)}>
            <div className="flex items-center gap-2.5">
              <Pip n={String(i + 1).padStart(2, "0")} />
              {i < STEPS.length - 1 && <span aria-hidden className="h-px flex-1 bg-line" />}
            </div>
            <h3 className="mt-4 font-display text-[1.0625rem] font-semibold leading-snug tracking-[-0.015em]">
              {t(`site.page.steps.items.${id}.title`)}
            </h3>
            <p className="mt-2 flex-1 text-[0.875rem] leading-[1.6] text-ink-2">{t(`site.page.steps.items.${id}.body`)}</p>
            <p className="mt-5 flex gap-2 border-t border-line-faint pt-3 font-mono text-[0.75rem] leading-snug text-verdigris">
              <span aria-hidden>→</span>
              <span>{t(`site.page.steps.items.${id}.out`)}</span>
            </p>
          </article>
        </li>
      ))}
      {/* The eighth cell is the rule the seven steps exist to serve. It is not a step. */}
      <li className="h-full">
        <div className="on-ink flex h-full flex-col justify-between rounded-[var(--radius-card)] bg-paper p-5">
          <p className="eyebrow">{t("site.page.formula.eyebrow")}</p>
          <p className="mt-3 font-display text-[1.0625rem] font-semibold leading-snug tracking-[-0.015em] text-ink">
            {t("site.page.layers.rule")}
          </p>
        </div>
      </li>
    </RevealGroup>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ON CHAIN / OFF CHAIN
// ═════════════════════════════════════════════════════════════════════════════

const ON_CHAIN = ["hashes", "dids", "cids", "policies", "decisions"] as const;
const OFF_CHAIN = ["files", "faces", "names", "specs"] as const;

/** The division that the whole storage design falls out of, as two columns and one rule. */
export function ChainSplit({ t }: { t: T }) {
  return (
    <Reveal>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-verdigris-line bg-verdigris-soft/30 p-5">
          <p className="eyebrow text-verdigris">{t("site.page.chain.onChainTitle")}</p>
          <ul className="mt-4 space-y-2">
            {ON_CHAIN.map((k) => (
              <li key={k} className="flex items-center gap-2.5 font-mono text-[0.8125rem] text-ink-2">
                <Tick />
                {t(`site.page.chain.onChain.${k}`)}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-overlay-1 p-5">
          <p className="eyebrow">{t("site.page.chain.offChainTitle")}</p>
          <ul className="mt-4 space-y-2">
            {OFF_CHAIN.map((k) => (
              <li key={k} className="flex items-center gap-2.5 font-mono text-[0.8125rem] text-ink-3">
                <span
                  aria-hidden
                  className="grid h-[1.125rem] w-[1.125rem] shrink-0 place-items-center rounded-[var(--radius-pill)] border border-line bg-paper text-[0.625rem] leading-none text-ink-4"
                >
                  ▮
                </span>
                {t(`site.page.chain.offChain.${k}`)}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="type-meta mt-4 max-w-[70ch]">{t("site.page.chain.note")}</p>
    </Reveal>
  );
}
