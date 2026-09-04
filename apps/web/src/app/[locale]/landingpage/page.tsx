/**
 * /landingpage — the whole of VAJRA, on one page, for somebody who has five minutes and no login.
 *
 * ── IT IS A SERVER COMPONENT ────────────────────────────────────────────────────────────────────
 * Everything you can read renders on the server. Copy is resolved with `tFor(locale)` — the plain
 * `lookup()` out of `@/i18n`, not the client hook — and every product visual comes from
 * `site/mockups.tsx`, which was deliberately written without a `"use client"` directive so it could
 * render in exactly this position. Nine islands ship JavaScript, and each of them earns it:
 *
 *   LandingHeader   read progress and the scroll spy
 *   TrustFirewall   the sticky three-scenario sequence
 *   TraceSwitch     the ALLOW / STEP-UP / DENY switch
 *   TrustDecay      a path that measures itself and draws on arrival
 *   LayerStack      the pointer-following spine
 *   EvidenceWall    the facet filter over the sample corpus
 *   Questions       the accordion
 *   Numbers         the count-ups
 *   Reveal / RevealGroup  the one IntersectionObserver per band that everything else rides on
 *
 * ── EVERY NUMBER ON THIS PAGE IS COUNTABLE ──────────────────────────────────────────────────────
 * 117 unit tests, 87 end-to-end assertions, 59 endpoints, 27 tables, 5 contracts, 3 locales, and
 * ~35,109 lines — each re-derived against the working tree, not copied off a slide. The risk
 * weights, trust floors, trust deltas and audit-chain formula in the figures are literals out of
 * `packages/trust`, `packages/policy` and `apps/gateway/src/modules/audit`. Two numbers are NOT
 * measurements and are labelled where they appear: the sub-300 ms decision is a test ASSERTION made
 * in-process, and the pilot infrastructure cost is an ESTIMATE. The evidence corpus is sample data
 * and says so on every surface that renders it.
 *
 * ── AND IT MAKES NO NETWORK CALLS ───────────────────────────────────────────────────────────────
 * Nothing here imports `@/lib/api`. The gateway can be stopped, and the page is identical — which
 * matters, because the one thing worse than no demo is a landing page full of error notes.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Reveal, RevealGroup, VajraMark } from "@/components/ui";
import { EvidenceWall } from "@/components/landing/evidence";
import { ChainSplit, FiveGates, Formula, PrivacySplit, StepRail } from "@/components/landing/figures";
import { TrustFirewall } from "@/components/landing/firewall";
import { LandingHeader } from "@/components/landing/header";
import { Band, CARD, Caption, Head, LinkButton, Pip, Rule, Tick, cx, tFor } from "@/components/landing/kit";
import { LayerStack } from "@/components/landing/layers";
import { Numbers } from "@/components/landing/numbers";
import { Questions } from "@/components/landing/questions";
import { TrustDecay } from "@/components/landing/decay";
import { TraceSwitch } from "@/components/landing/trace";
import { TECHNOLOGIES } from "@/components/site/data";
import {
  AccessMatrixMini,
  BrowserFrame,
  ConsoleScreen,
  LedgerChain,
  LivenessGate,
  PassportCard,
  ProofCertificate,
  TimelineStrip,
  TrustGraphMini,
} from "@/components/site/mockups";
import { LOCALES, isLocale } from "@/i18n";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = tFor(locale);
  return {
    title: `${t("brand.name")} — ${t("brand.positioning")}`,
    description: t("brand.usp"),
  };
}

const PIPELINE = ["identity", "trust", "decision", "asset", "proof"] as const;
const PROBLEMS = ["passwords", "deepfakes", "provenance", "audits", "honeypot"] as const;
const CAPABILITIES = [
  { id: "continuous", glyph: "◷" },
  { id: "passport", glyph: "◈" },
  { id: "proof", glyph: "❋" },
  { id: "insider", glyph: "◭" },
  { id: "timetravel", glyph: "◐" },
] as const;
const COMPARISON = ["factors", "liveness", "biometrics", "audit", "fees"] as const;
const SCENES = ["onboard", "vault", "normal", "attack", "failclosed", "replay", "proof"] as const;
const PROOF_CHECKS = ["hash", "signature", "chain", "ledger", "policy"] as const;
const STACK = ["blockchain", "biometrics", "identity", "risk", "database", "frontend", "api", "storage"] as const;
const LIMITS = ["ledger", "kek", "client", "deepfake"] as const;
const INCIDENT_EFFECTS = ["sessions", "links", "grants", "freeze", "timeline", "decay", "evidence"] as const;
const STANDARDS = ["nist", "did", "iso", "dpdp"] as const;
const PAPERS = ["adaface", "minivision", "bpdac", "fabric"] as const;
const ARTEFACTS = ["architecture", "built", "script", "tests"] as const;

/** The six risk signals with their literal weights. `packages/trust/src/index.ts` RISK_WEIGHTS. */
const RISK_SIGNALS = [
  { id: "newDevice", points: 30 },
  { id: "impossibleTravel", points: 25 },
  { id: "failedLiveness", points: 25 },
  { id: "oddHours", points: 15 },
  { id: "burst", points: 15 },
  { id: "abnormalVolume", points: 15 },
] as const;

/** The identity trust floors, per action class. `packages/trust/src/index.ts` TRUST_GATES. */
const TRUST_FLOORS = [
  { id: "low", soft: 30, hard: 10 },
  { id: "medium", soft: 50, hard: 30 },
  { id: "high", soft: 65, hard: 45 },
  { id: "critical", soft: 75, hard: 60 },
] as const;

const COST_ROWS = [
  { id: "ledger", free: true },
  { id: "database", free: true },
  { id: "storage", free: true },
  { id: "compute", free: false },
] as const;

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = tFor(locale);

  const demo = `/${locale}/demo`;
  const login = `/${locale}/login`;
  const verify = `/${locale}/verify`;
  const about = `/${locale}/about`;
  const signup = `/${locale}/signup`;

  return (
    <div className="min-h-screen bg-paper">
      <a
        href="#problem"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-[var(--radius-control)] focus:border focus:border-line focus:bg-paper focus:px-4 focus:py-2"
      >
        {t("site.nav.skipToContent")}
      </a>

      <LandingHeader />

      <main>
        {/* ══ HERO ══════════════════════════════════════════════════════════════════════════════
            Three stacked atmospheres, each on its own element because `.grain` and `.auth-aurora`
            both own `::before`. All three are neutralised by the global reduced-motion block. */}
        <section className="relative overflow-hidden border-b border-line">
          <div aria-hidden className="auth-aurora pointer-events-none absolute inset-0 opacity-70" />
          <div aria-hidden className="auth-lattice pointer-events-none absolute inset-0" />
          <div aria-hidden className="grain pointer-events-none absolute inset-0" />

          <div className="shell relative pb-20 pt-16 lg:pb-28 lg:pt-24">
            <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
              <div>
                <p className="eyebrow lift" style={{ "--line": 0 } as React.CSSProperties}>
                  {t("site.hero.eyebrow")}
                </p>
                {/* Three lines, three delays. The one entrance on the site allowed to be noticed. */}
                <h1 className="type-display mt-6">
                  {(["titleLine1", "titleLine2", "titleLine3"] as const).map((line, i) => (
                    <span key={line} className="lift block" style={{ "--line": i + 1 } as React.CSSProperties}>
                      {t(`site.hero.${line}`)}
                    </span>
                  ))}
                </h1>
                <p className="type-lede lift mt-8 max-w-[52ch]" style={{ "--line": 4 } as React.CSSProperties}>
                  {t("site.hero.lede")}
                </p>
                <div className="lift mt-10 flex flex-wrap items-center gap-3" style={{ "--line": 5 } as React.CSSProperties}>
                  <LinkButton href={demo} variant="primary">
                    {t("site.hero.ctaPrimary")}
                  </LinkButton>
                  <LinkButton href="#evidence">{t("site.hero.ctaSecondary")}</LinkButton>
                </div>
                <p
                  className="lift mt-7 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-overlay-1 px-3 py-1.5 font-mono text-[0.75rem] text-ink-3"
                  style={{ "--line": 6 } as React.CSSProperties}
                >
                  <span aria-hidden className="block h-1.5 w-1.5 rounded-[var(--radius-pill)] bg-verdigris" />
                  {t("site.page.hero.badge")}
                </p>
              </div>

              {/* The hero figure. One browser, one console screen, one certificate laid over the
                  corner — the product, and the artefact the product leaves, in one picture. */}
              <div className="lift relative" style={{ "--line": 3 } as React.CSSProperties}>
                <BrowserFrame url="vajra.app/decisions" className="aspect-[4/3]">
                  <ConsoleScreen seed={7} />
                </BrowserFrame>
                <div className="absolute -bottom-8 -left-4 w-[62%] max-w-[19rem] sm:-left-8 lg:-left-10">
                  <div className="rounded-[var(--radius-card)] shadow-float">
                    <ProofCertificate seed={4} label={t("site.hero.figureCaption")} />
                  </div>
                </div>
              </div>
            </div>

            {/* The five stages, ticking in left to right. IDENTITY → TRUST → DECISION → ASSET → PROOF
                is the spine ARCHITECTURE.md repeats throughout; this is it, said once, at the top. */}
            <div className="mt-24 border-t border-line-faint pt-8 lg:mt-28">
              <div className="rail rail-until-sm edge-fade-x -mx-1 flex items-center gap-x-2 gap-y-3 px-1 sm:mx-0 sm:flex-wrap sm:px-0">
                {PIPELINE.map((stage, i) => (
                  <div key={stage} className="flex shrink-0 items-center gap-2">
                    <span
                      className="rounded-[var(--radius-control)] border border-line bg-paper px-3.5 py-2 font-display text-[0.9375rem] font-medium tracking-[-0.01em] text-ink shadow-lift"
                      style={{ animation: `vajra-tick 500ms ${400 + i * 140}ms both var(--ease-out-soft)` }}
                    >
                      {t(`landing.pipeline.${stage}`)}
                    </span>
                    {i < PIPELINE.length - 1 && (
                      <span aria-hidden className="text-ink-4">
                        →
                      </span>
                    )}
                  </div>
                ))}
                <p className="type-meta ml-0 shrink-0 sm:ml-4">{t("landing.pipelineNote")}</p>
              </div>
            </div>
          </div>
        </section>

        {/* ══ STANDARDS RAIL ════════════════════════════════════════════════════════════════════ */}
        <section className="overflow-hidden border-b border-line bg-overlay-1 py-8">
          <p className="shell type-meta mb-6 text-center">{t("site.logos.title")}</p>
          {/* One track, duplicated exactly once: `.marquee` translates −50%, so the seam never lands. */}
          <div className="marquee gap-10 px-5" aria-hidden>
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0 items-center gap-10 pr-10">
                {TECHNOLOGIES.map((tech) => (
                  <span key={tech.id} className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
                    <span className="font-display text-[1.0625rem] font-semibold tracking-[-0.015em] text-ink-2">{tech.label}</span>
                    <span className="font-mono text-[0.75rem] text-ink-4">{tech.note}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
          <p className="sr-only">{TECHNOLOGIES.map((tech) => tech.label).join(", ")}</p>
        </section>

        {/* ══ THE RULE ══════════════════════════════════════════════════════════════════════════ */}
        <Band tone="ink">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
            <Head eyebrow={t("site.page.formula.eyebrow")} title={t("site.page.formula.title")} lede={t("site.page.formula.lede")} />
            <Reveal delay={120}>
              <Formula t={t} />
            </Reveal>
          </div>
        </Band>

        <div id="problem" className="scroll-mt-20">
        {/* ══ THE PROBLEM ═══════════════════════════════════════════════════════════════════════ */}
        <Band tone="wash">
          <Head eyebrow={t("site.page.problem.eyebrow")} title={t("site.page.problem.title")} lede={t("site.page.problem.lede")} />
          <RevealGroup as="ul" className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" stagger={60}>
            {PROBLEMS.map((p) => (
              <li key={p} className="h-full">
                <article className={cx("group h-full px-5 py-5", CARD)}>
                  {/* Transform, not width: a width transition would animate layout. */}
                  <span
                    aria-hidden
                    className="mb-4 block h-1 w-8 origin-left rounded-[var(--radius-pill)] bg-oxide/50 transition-[transform,background-color] duration-300 ease-out-soft group-hover:scale-x-150 group-hover:bg-oxide"
                  />
                  <h3 className="font-display text-[1.0625rem] font-semibold leading-snug tracking-[-0.015em]">
                    {t(`landing.problems.${p}.title`)}
                  </h3>
                  <p className="mt-2.5 text-[0.875rem] leading-[1.6] text-ink-2">{t(`landing.problems.${p}.body`)}</p>
                </article>
              </li>
            ))}
            <li className="h-full">
              <div className="flex h-full flex-col justify-between rounded-[var(--radius-card)] border border-line-strong border-dashed bg-transparent px-5 py-5">
                <VajraMark className="h-6 w-6 text-brass" />
                <p className="mt-4 font-display text-[1.0625rem] font-semibold leading-snug tracking-[-0.015em]">{t("brand.tagline")}</p>
              </div>
            </li>
          </RevealGroup>
        </Band>

        {/* ══ WHAT MAKES IT DIFFERENT ═══════════════════════════════════════════════════════════ */}
        <Band>
          <Head
            eyebrow={t("landing.capabilitiesKicker")}
            title={t("landing.capabilitiesTitle")}
            lede={t("landing.capabilitiesNote")}
          />
          <RevealGroup as="ul" className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3" stagger={70}>
            {CAPABILITIES.map((c, i) => (
              <li key={c.id} className="h-full">
                <article className={cx("group h-full px-5 py-6", CARD)}>
                  <div className="flex items-start justify-between gap-3">
                    <span
                      aria-hidden
                      className="grid h-11 w-11 place-items-center rounded-[var(--radius-control)] border border-line bg-overlay-2 font-display text-[1.375rem] leading-none text-brass-deep transition-transform duration-200 ease-out-soft group-hover:-translate-y-0.5"
                    >
                      {c.glyph}
                    </span>
                    <span className="font-mono text-[0.75rem] tnum text-ink-4">{String(i + 1).padStart(2, "0")}</span>
                  </div>
                  <h3 className="mt-5 font-display text-[1.125rem] font-semibold leading-snug tracking-[-0.015em]">
                    {t(`landing.capabilities.${c.id}.title`)}
                  </h3>
                  <p className="mt-2.5 text-[0.875rem] leading-[1.6] text-ink-2">{t(`landing.capabilities.${c.id}.body`)}</p>
                </article>
              </li>
            ))}
          </RevealGroup>
        </Band>

        </div>

        <div id="engine" className="scroll-mt-20">
        {/* ══ THE TRUST FIREWALL ════════════════════════════════════════════════════════════════
            No `overflow-hidden` anywhere above the sticky stage — it would silently kill it. */}
        <section className="border-b border-line bg-overlay-1">
          <div className="shell band-tight">
            <Head eyebrow={t("site.page.firewall.eyebrow")} title={t("site.page.firewall.title")} lede={t("site.page.firewall.lede")} />
          </div>
          <TrustFirewall />
        </section>

        {/* ══ FIVE VERIFICATIONS ════════════════════════════════════════════════════════════════ */}
        <Band>
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start lg:gap-16">
            <div>
              <Head eyebrow={t("site.page.gates.eyebrow")} title={t("site.page.gates.title")} lede={t("site.page.gates.lede")} />
              <div className="mt-12">
                <FiveGates t={t} />
              </div>
              <div className="mt-10">
                <Rule>{t("site.page.gates.note")}</Rule>
              </div>
            </div>
            <Reveal delay={100} className="lg:sticky lg:top-24">
              <LivenessGate seed={5} label={t("site.features.liveness.caption")} />
              <Caption>{t("site.features.liveness.caption")}</Caption>
            </Reveal>
          </div>

          <Reveal className="mt-20">
            <h3 className="type-title">{t("site.page.privacy.title")}</h3>
          </Reveal>
          <Reveal delay={80} className="mt-8">
            <PrivacySplit t={t} />
            <p className="type-meta mt-6 max-w-[74ch]">{t("site.page.privacy.note")}</p>
          </Reveal>
        </Band>

        {/* ══ THE SEVEN STEPS ═══════════════════════════════════════════════════════════════════ */}
        <Band tone="wash">
          <Head eyebrow={t("site.page.steps.eyebrow")} title={t("site.page.steps.title")} lede={t("site.page.steps.lede")} />
          <div className="mt-14">
            <StepRail t={t} />
          </div>
        </Band>

        {/* ══ THE DECISION TRACE ════════════════════════════════════════════════════════════════ */}
        <Band tone="ink">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-16">
            <div>
              <Head eyebrow={t("site.page.decision.eyebrow")} title={t("site.page.decision.title")} lede={t("site.page.decision.lede")} />
              <p className="type-meta mt-8 max-w-[58ch]">{t("site.page.decision.note")}</p>
            </div>
            <Reveal delay={100}>
              <TraceSwitch />
            </Reveal>
          </div>
        </Band>

        {/* ══ THE SCORER ════════════════════════════════════════════════════════════════════════ */}
        <Band>
          <Head eyebrow={t("site.page.scoring.eyebrow")} title={t("site.page.scoring.title")} lede={t("site.page.scoring.lede")} />

          <div className="mt-14 grid gap-8 lg:grid-cols-2 lg:gap-12">
            {/* Six signals, each drawn at its own weight. The bar IS the weight — 30 is twice 15. */}
            <Reveal>
              <h3 className="eyebrow">{t("site.page.scoring.riskTitle")}</h3>
              <ul className="mt-5 space-y-3">
                {RISK_SIGNALS.map((s) => (
                  <li key={s.id} className="flex items-center gap-4">
                    <span className="w-[13rem] shrink-0 truncate text-[0.875rem] text-ink-2">
                      {t(`site.page.scoring.signals.${s.id}`)}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-[var(--radius-pill)] bg-paper-3">
                      <span
                        className="block h-full rounded-[var(--radius-pill)] bg-oxide/70"
                        style={{ width: `${(s.points / 30) * 100}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right font-mono text-[0.8125rem] font-medium tnum text-ink">+{s.points}</span>
                  </li>
                ))}
              </ul>
              <p className="type-meta mt-5 max-w-[52ch]">{t("site.page.scoring.riskNote")}</p>
            </Reveal>

            <Reveal delay={100}>
              <h3 className="eyebrow">{t("site.page.scoring.gatesTitle")}</h3>
              <div className="mt-5 overflow-hidden rounded-[var(--radius-panel)] border border-line">
                <table className="w-full border-collapse text-left text-[0.875rem]">
                  <thead>
                    <tr className="border-b border-line bg-paper-2">
                      {(["action", "soft", "hard"] as const).map((c) => (
                        <th
                          key={c}
                          className={cx(
                            "px-4 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3",
                            c !== "action" && "text-right",
                          )}
                        >
                          {t(`site.page.scoring.columns.${c}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TRUST_FLOORS.map((f) => (
                      <tr key={f.id} className="row-hover border-b border-line-faint last:border-0">
                        <td className="px-4 py-2.5 text-ink">{t(`site.page.scoring.classes.${f.id}`)}</td>
                        <td className="px-4 py-2.5 text-right font-mono tnum text-saffron">{f.soft}</td>
                        <td className="px-4 py-2.5 text-right font-mono tnum text-oxide">{f.hard}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="type-meta mt-5 max-w-[52ch]">{t("site.page.scoring.gatesNote")}</p>
            </Reveal>
          </div>
        </Band>

        {/* ══ CONTINUOUS TRUST ══════════════════════════════════════════════════════════════════ */}
        <Band tone="wash">
          <Head eyebrow={t("site.page.continuous.eyebrow")} title={t("site.page.continuous.title")} lede={t("site.page.continuous.lede")} />
          <Reveal className="mt-14">
            <div className="rounded-[var(--radius-card)] border border-line bg-paper p-5 sm:p-8">
              <TrustDecay />
            </div>
            <Caption>{t("site.page.continuous.caption")}</Caption>
          </Reveal>

          <div className="mt-14 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-12">
            <Reveal>
              <h3 className="type-title">{t("site.page.continuous.matrixTitle")}</h3>
              <p className="mt-4 max-w-[52ch] text-[0.9375rem] leading-[1.65] text-ink-2">
                {t("landing.capabilities.continuous.body")}
              </p>
            </Reveal>
            <Reveal delay={100}>
              <AccessMatrixMini seed={3} />
            </Reveal>
          </div>
        </Band>

        {/* ══ THE ASSET PASSPORT ════════════════════════════════════════════════════════════════ */}
        <Band>
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
            <div>
              <Head
                eyebrow={t("site.features.passport.eyebrow")}
                title={t("site.features.passport.title")}
                lede={t("site.features.passport.body")}
              />
              <Reveal delay={120} className="mt-10">
                <div className={cx("p-5", CARD)}>
                  <TrustGraphMini seed={2} />
                  <p className="type-meta mt-3">{t("landing.capabilities.passport.body")}</p>
                </div>
              </Reveal>
            </div>
            {/* The collage: one passport at full detail, a second and a third behind it at the
                compact variant, so the section shows a LINEAGE and not one card. */}
            <Reveal delay={100} className="relative">
              <div className="pointer-events-none absolute -top-6 right-2 w-[70%] opacity-45">
                <PassportCard compact seed={9} />
              </div>
              <div className="pointer-events-none absolute -top-3 right-0 w-[78%] opacity-70">
                <PassportCard compact seed={5} />
              </div>
              <div className="relative pt-16">
                <div className="rounded-[var(--radius-card)] shadow-media">
                  <PassportCard seed={1} />
                </div>
              </div>
              <Caption>{t("site.features.passport.caption")}</Caption>
            </Reveal>
          </div>
        </Band>

        {/* ══ PROOF-OF-ACTION ═══════════════════════════════════════════════════════════════════ */}
        <Band tone="ink">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:items-center lg:gap-16">
            <div>
              <Head eyebrow={t("verify.title")} title={t("landing.proofTitle")} lede={t("landing.proofBody")} />
              <RevealGroup as="ul" className="mt-10 space-y-2" stagger={70}>
                {PROOF_CHECKS.map((check) => (
                  <li
                    key={check}
                    className="flex items-center gap-3 rounded-[var(--radius-field)] border border-line-faint bg-overlay-1 px-4 py-2.5"
                  >
                    <Tick />
                    <span className="text-[0.875rem] text-ink-2">{t(`verify.checks.${check}`)}</span>
                  </li>
                ))}
              </RevealGroup>
              <Reveal delay={200} className="mt-8">
                <LinkButton href={verify}>{t("site.cta.secondary")}</LinkButton>
              </Reveal>
            </div>
            <Reveal delay={100}>
              <ProofCertificate seed={12} label={t("site.hero.figureCaption")} />
              <Caption>{t("site.hero.figureCaption")}</Caption>
            </Reveal>
          </div>
        </Band>

        {/* ══ THE LEDGER ════════════════════════════════════════════════════════════════════════ */}
        <Band>
          <Head eyebrow={t("site.features.ledger.eyebrow")} title={t("site.features.ledger.title")} lede={t("site.features.ledger.body")} />
          <Reveal className="mt-14">
            <div className={cx("p-5 sm:p-8", CARD)}>
              <LedgerChain seed={6} label={t("site.features.ledger.caption")} />
            </div>
            <Caption>{t("site.features.ledger.caption")}</Caption>
          </Reveal>
          <div className="mt-12">
            <ChainSplit t={t} />
          </div>
        </Band>

        {/* ══ INCIDENT RESPONSE AND TIME TRAVEL ═════════════════════════════════════════════════ */}
        <Band tone="wash">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <Head eyebrow={t("site.page.incident.eyebrow")} title={t("site.page.incident.title")} lede={t("site.page.incident.lede")} />
              {/* Seven effects, and seven is the number the revocation cascade actually performs —
                  `scripts/e2e.ts` asserts `steps.length === 7`. */}
              <RevealGroup as="ol" className="mt-10 space-y-2.5" stagger={55}>
                {INCIDENT_EFFECTS.map((e, i) => (
                  <li key={e} className="flex items-center gap-3">
                    <Pip n={String(i + 1)} tone="ink" />
                    <span className="text-[0.9375rem] leading-snug text-ink-2">{t(`site.page.incident.effects.${e}`)}</span>
                  </li>
                ))}
              </RevealGroup>
              <Reveal delay={200} className="mt-8">
                <Rule tone="oxide">{t("site.page.incident.note")}</Rule>
              </Reveal>
            </div>

            <div className="lg:pt-4">
              <Reveal delay={100}>
                <div className={cx("p-5 sm:p-6", CARD)}>
                  <TimelineStrip seed={4} />
                </div>
              </Reveal>
              <Reveal delay={160} className="mt-10">
                <h3 className="type-title">{t("site.page.timetravel.title")}</h3>
                <p className="mt-4 max-w-[54ch] text-[0.9375rem] leading-[1.65] text-ink-2">{t("site.page.timetravel.lede")}</p>
                <p className="mt-6 flex flex-wrap items-center gap-2 font-mono text-[0.8125rem] text-ink-3">
                  {["policy v3", "trust 42", "owner did:key:z6Mk…", "02:12 UTC"].map((chip) => (
                    <span key={chip} className="rounded-[var(--radius-tag)] border border-line bg-paper px-2 py-1">
                      {chip}
                    </span>
                  ))}
                </p>
              </Reveal>
            </div>
          </div>
        </Band>

        </div>

        <div id="build" className="scroll-mt-20">
        {/* ══ ARCHITECTURE ══════════════════════════════════════════════════════════════════════ */}
        <Band>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <Head eyebrow={t("site.page.layers.eyebrow")} title={t("site.page.layers.title")} lede={t("site.page.layers.lede")} />
              <Reveal delay={140} className="mt-10">
                <Rule>{t("site.page.layers.rule")}</Rule>
              </Reveal>
              <Reveal delay={200} className="mt-8">
                <LinkButton href={about}>{t("nav.readArchitecture")}</LinkButton>
              </Reveal>
            </div>
            <Reveal delay={100}>
              <LayerStack />
            </Reveal>
          </div>

          <Reveal className="mt-24">
            <h3 className="eyebrow">{t("site.page.stack.eyebrow")}</h3>
            <h4 className="type-title mt-3">{t("site.page.stack.title")}</h4>
          </Reveal>
          <RevealGroup as="ul" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" stagger={50}>
            {STACK.map((s) => (
              <li key={s} className="h-full">
                <article className={cx("h-full px-5 py-5", CARD)}>
                  <h5 className="font-display text-[1rem] font-semibold leading-snug tracking-[-0.015em]">
                    {t(`site.page.stack.items.${s}.title`)}
                  </h5>
                  <p className="mt-2 font-mono text-[0.75rem] leading-relaxed text-ink-3">{t(`site.page.stack.items.${s}.body`)}</p>
                </article>
              </li>
            ))}
          </RevealGroup>
        </Band>

        </div>

        <div id="evidence" className="scroll-mt-20">
        {/* ══ THE EVIDENCE WALL ═════════════════════════════════════════════════════════════════ */}
        <Band tone="wash">
          <Head eyebrow={t("site.page.evidence.eyebrow")} title={t("site.page.evidence.title")} lede={t("site.page.evidence.lede")} />
          <div className="mt-12">
            <EvidenceWall />
          </div>
          <p className="type-meta mt-8 max-w-[76ch]">{t("site.page.evidence.note")}</p>
        </Band>

        {/* ══ LEGACY IAM VERSUS VAJRA ═══════════════════════════════════════════════════════════ */}
        <Band>
          <Head eyebrow={t("site.comparison.eyebrow")} title={t("site.comparison.title")} lede={t("site.comparison.lede")} />
          <Reveal delay={100} className="mt-12">
            <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line">
              <table className="w-full min-w-[640px] border-collapse text-left text-[0.875rem]">
                <thead>
                  <tr className="border-b border-line bg-paper-2">
                    {(["dimension", "legacy", "vajra"] as const).map((h) => (
                      <th key={h} className="px-4 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">
                        {t(`landing.comparison.header.${h}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row) => (
                    <tr key={row} className="row-hover border-b border-line-faint last:border-0">
                      <td className="px-4 py-3 text-ink">{t(`landing.comparison.${row}.dimension`)}</td>
                      <td className="px-4 py-3 text-ink-3">{t(`landing.comparison.${row}.legacy`)}</td>
                      <td className="px-4 py-3 font-medium text-verdigris">{t(`landing.comparison.${row}.vajra`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </Band>

        {/* ══ THE HARD QUESTIONS ════════════════════════════════════════════════════════════════ */}
        <Band tone="wash">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-16">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <Head eyebrow={t("site.questions.eyebrow")} title={t("site.questions.title")} lede={t("site.questions.lede")} />
            </div>
            <Reveal delay={100}>
              <Questions />
            </Reveal>
          </div>
        </Band>

        </div>

        <div id="numbers" className="scroll-mt-20">
        {/* ══ THE NUMBERS ═══════════════════════════════════════════════════════════════════════ */}
        <Band>
          <Head eyebrow={t("site.page.numbers.eyebrow")} title={t("site.page.numbers.title")} lede={t("site.page.numbers.lede")} />
          <div className="mt-14">
            <Numbers />
          </div>
          <p className="type-meta mt-6 max-w-[80ch]">{t("site.page.numbers.note")}</p>

          <Reveal className="mt-16">
            <h3 className="type-title">{t("site.page.artefacts.title")}</h3>
          </Reveal>
          <RevealGroup as="ul" className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" stagger={55}>
            {ARTEFACTS.map((a) => (
              <li key={a} className="h-full">
                <div className={cx("h-full px-4 py-4", CARD)}>
                  <p className="font-mono text-[0.8125rem] font-medium text-ink">{t(`site.page.artefacts.items.${a}.name`)}</p>
                  <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-3">{t(`site.page.artefacts.items.${a}.note`)}</p>
                </div>
              </li>
            ))}
          </RevealGroup>
        </Band>

        {/* ══ LIMITS ════════════════════════════════════════════════════════════════════════════ */}
        <Band tone="wash">
          <Head eyebrow={t("site.page.limits.eyebrow")} title={t("site.page.limits.title")} lede={t("site.page.limits.lede")} />
          <RevealGroup as="ul" className="mt-14 grid gap-4 md:grid-cols-2" stagger={70}>
            {LIMITS.map((l) => (
              <li key={l} className="h-full">
                <article className="h-full rounded-[var(--radius-card)] border border-line bg-paper px-5 py-5">
                  <div className="flex items-start gap-3">
                    <span aria-hidden className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-[var(--radius-pill)] bg-oxide" />
                    <div>
                      <h3 className="font-display text-[1.0625rem] font-semibold leading-snug tracking-[-0.015em]">
                        {t(`site.page.limits.items.${l}.title`)}
                      </h3>
                      <p className="mt-2.5 text-[0.875rem] leading-[1.65] text-ink-2">{t(`site.page.limits.items.${l}.body`)}</p>
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </RevealGroup>
        </Band>

        {/* ══ FEASIBILITY AND ROADMAP ═══════════════════════════════════════════════════════════ */}
        <Band>
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <Head eyebrow={t("site.page.cost.eyebrow")} title={t("site.page.cost.title")} lede={t("site.page.cost.lede")} />
              <Reveal delay={100} className="mt-10">
                <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line">
                  <table className="w-full border-collapse text-left text-[0.875rem]">
                    <tbody>
                      {COST_ROWS.map((r) => (
                        <tr key={r.id} className="row-hover border-b border-line-faint">
                          <td className="px-4 py-2.5 text-ink-2">{t(`site.page.cost.rows.${r.id}`)}</td>
                          <td className={cx("px-4 py-2.5 text-right font-mono tnum", r.free ? "text-verdigris" : "text-ink")}>
                            {r.free ? t("site.page.cost.free") : t("site.page.cost.compute")}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-paper-2">
                        <td className="px-4 py-3 font-medium text-ink">{t("site.page.cost.rows.total")}</td>
                        <td className="px-4 py-3 text-right font-mono font-medium tnum text-ink">{t("site.page.cost.compute")}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="type-meta mt-4 max-w-[52ch]">{t("site.page.cost.note")}</p>
              </Reveal>
            </div>

            <div>
              <Head eyebrow={t("site.page.roadmap.eyebrow")} title={t("site.page.roadmap.title")} />
              <RevealGroup as="ol" className="mt-10 space-y-0" stagger={70}>
                {(["q1", "q2", "q4"] as const).map((q, i, arr) => (
                  <li key={q} className="relative flex gap-4 pb-7 last:pb-0">
                    {i < arr.length - 1 && <span aria-hidden className="absolute bottom-1 left-[13px] top-8 w-px bg-line" />}
                    <span
                      aria-hidden
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-brass-line bg-brass-soft font-mono text-[0.6875rem] font-medium leading-none text-brass-deep"
                    >
                      {i + 1}
                    </span>
                    <div className="pt-0.5">
                      <p className="font-mono text-[0.75rem] uppercase tracking-[0.12em] text-ink-3">
                        {t(`site.page.roadmap.items.${q}.when`)}
                      </p>
                      <p className="mt-1.5 text-[0.9375rem] leading-[1.6] text-ink-2">{t(`site.page.roadmap.items.${q}.what`)}</p>
                    </div>
                  </li>
                ))}
              </RevealGroup>
            </div>
          </div>
        </Band>

        {/* ══ STANDARDS AND REFERENCES ══════════════════════════════════════════════════════════ */}
        <Band tone="wash">
          <Head eyebrow={t("site.page.refs.eyebrow")} title={t("site.page.refs.title")} lede={t("site.page.refs.lede")} />
          <div className="mt-14 grid gap-10 lg:grid-cols-2 lg:gap-16">
            <RevealGroup as="ul" className="grid gap-3" stagger={60}>
              {STANDARDS.map((s) => (
                <li key={s}>
                  <div className={cx("flex items-start gap-4 px-5 py-4", CARD)}>
                    <Tick className="mt-1" />
                    <div>
                      <p className="font-display text-[1rem] font-semibold leading-snug tracking-[-0.015em]">
                        {t(`site.page.refs.items.${s}.name`)}
                      </p>
                      <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-2">{t(`site.page.refs.items.${s}.note`)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </RevealGroup>
            <RevealGroup as="ul" className="grid gap-3" stagger={60}>
              {PAPERS.map((p, i) => (
                <li key={p}>
                  <div className="flex items-start gap-4 px-5 py-4">
                    <span className="mt-0.5 shrink-0 font-mono text-[0.75rem] tnum text-ink-4">[{i + 1}]</span>
                    <div>
                      <p className="font-display text-[1rem] font-semibold leading-snug tracking-[-0.015em]">
                        {t(`site.page.refs.papers.${p}.name`)}
                      </p>
                      <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-3">{t(`site.page.refs.papers.${p}.note`)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </RevealGroup>
          </div>
        </Band>

        {/* ══ THE DEMO ══════════════════════════════════════════════════════════════════════════ */}
        <Band tone="ink">
          <Head eyebrow={t("site.page.demo.eyebrow")} title={t("site.page.demo.title")} lede={t("site.page.demo.lede")} />
          <RevealGroup as="ol" className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" stagger={50}>
            {SCENES.map((scene, i) => (
              <li key={scene} className="h-full">
                <a
                  href={demo}
                  className="flex h-full flex-col gap-1.5 rounded-[var(--radius-card)] border border-line bg-overlay-1 px-4 py-4 transition-[border-color,background-color] duration-150 ease-out hover:border-line-strong hover:bg-overlay-2 active:translate-y-px"
                >
                  <span className="font-mono text-[0.75rem] tnum text-brass">{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-display text-[0.9375rem] font-medium leading-snug text-ink">{t(`demo.scenes.${scene}.title`)}</span>
                  {/* `.body` — what the scene DOES — rather than `.watch`, whose first line quotes
                      the console's "Biometric data stored: 0 bytes". That is true of the descriptor
                      and not of the capture, which is retained encrypted, and the repository's own
                      notes correct the unqualified version of it. The precise claim is made in
                      "What actually crosses the wire" above; a card should not undo it. */}
                  <span className="mt-1 text-[0.8125rem] leading-snug text-ink-3">{t(`demo.scenes.${scene}.body`)}</span>
                </a>
              </li>
            ))}
            <li className="h-full">
              <div className="flex h-full flex-col justify-between rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-4">
                <VajraMark className="h-5 w-5 text-brass" />
                <p className="mt-3 text-[0.8125rem] leading-snug text-ink-3">{t("demo.subtitle")}</p>
              </div>
            </li>
          </RevealGroup>

          <Reveal delay={150} className="mt-14">
            <h3 className="type-display-sm max-w-[18ch]">{t("site.cta.title")}</h3>
            <p className="type-lede mt-6 max-w-[54ch]">{t("site.cta.body")}</p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <LinkButton href={demo} variant="primary">
                {t("nav.startDemo")}
              </LinkButton>
              <LinkButton href={signup}>{t("site.cta.primary")}</LinkButton>
              <LinkButton href={verify} variant="ghost">
                {t("site.cta.secondary")}
              </LinkButton>
            </div>
          </Reveal>
        </Band>
        </div>
      </main>

      {/* ══ FOOTER ══════════════════════════════════════════════════════════════════════════════ */}
      <footer className="on-ink bg-paper">
        <div className="shell py-14">
          <div className="flex flex-wrap items-start justify-between gap-10">
            <div className="max-w-md">
              <div className="flex items-center gap-2.5">
                <VajraMark className="h-6 w-6 text-brass" />
                <span className="font-display text-[1.0625rem] font-semibold tracking-[-0.015em] text-ink">{t("brand.name")}</span>
              </div>
              <p className="mt-4 font-display text-[1.375rem] font-semibold leading-snug tracking-[-0.02em] text-ink">
                {t("site.footer.statement")}
              </p>
              <p className="mt-4 text-[0.8125rem] leading-[1.6] text-ink-3">{t("brand.expansion")}</p>
            </div>

            <div className="grid gap-10 sm:grid-cols-2">
              <div>
                <p className="eyebrow">{t("site.footer.groups.product.label")}</p>
                <ul className="mt-4 space-y-2 text-[0.875rem]">
                  {(
                    [
                      { key: "overview", href: `/${locale}/landingpage` },
                      { key: "demo", href: demo },
                      { key: "verify", href: verify },
                      { key: "console", href: login },
                    ] as const
                  ).map((item) => (
                    <li key={item.key}>
                      <a
                        href={item.href}
                        className="text-ink-3 transition-colors duration-150 ease-out hover:text-ink"
                      >
                        {t(`site.footer.groups.product.items.${item.key}`)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="eyebrow">{t("site.footer.groups.company.label")}</p>
                <ul className="mt-4 space-y-2 text-[0.875rem] text-ink-3">
                  <li>{t("site.footer.groups.company.items.sih")}</li>
                  <li>{t("site.footer.groups.company.items.team")}</li>
                  <li>{t("site.footer.groups.company.items.university")}</li>
                </ul>
                <div className="mt-6">
                  <LocaleSwitcher compact />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-line-faint pt-6">
            <p className="type-meta">{t("site.footer.madeBy")}</p>
            <p className="type-meta">{t("site.footer.note")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
