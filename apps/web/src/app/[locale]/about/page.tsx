"use client";

/**
 * The landing page: the complete explanation of VAJRA, ending in the demo.
 *
 * BLACKLIGHT NOTES
 * - The page is one dark instrument, not a brochure with a dark stripe in it. Bands alternate
 *   ground (paper) and a single overlay-1 wash; the console well is used ONCE, for the
 *   machine-made material, and it is the deepest layer on the page — which is why it takes a
 *   border-y as well as its fill (console sits only ~6% below paper and flattens without one).
 * - Type comes off the ramp: 64 hero / 44 section head / 20 lede / 16 body / 14 UI, with the
 *   tracking that goes with each rung. No 700 weights anywhere — light-on-dark blooms.
 * - Every interactive element carries hover, active and focus, on explicit transition properties.
 *   Nothing transitions `all`, and nothing animates a layout property: the problem-card rule grows
 *   by scaleX, not by width.
 * - The three verdicts in the firewall diagram are VerdictStamp, not hand-rolled bordered divs:
 *   they were carried by colour alone before and now keep their glyph.
 */
import Link from "next/link";
import { useI18n } from "@/lib/i18n-client";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Button, Card, Cell, Chip, cx, Eyebrow, Icon, Reveal, Row, Table } from "@/components/ui";
import { VerdictStamp } from "@/components/console";

const NAV = ["how", "capabilities", "architecture", "demo"] as const;
const PIPELINE = ["identity", "trust", "decision", "asset", "proof"] as const;
const PROBLEMS = ["passwords", "deepfakes", "provenance", "audits", "honeypot"] as const;
const HOW = ["onboard", "vault", "request", "reverify", "evidence"] as const;
const CAPABILITIES = [
  { id: "continuous", glyph: "◷" },
  { id: "passport", glyph: "◈" },
  { id: "proof", glyph: "❋" },
  { id: "insider", glyph: "◭" },
  { id: "timetravel", glyph: "◐" },
] as const;
const FIREWALL_INPUTS = ["person", "device", "location", "time", "role", "asset", "risk", "liveness", "policy"] as const;
const COMPARISON = ["factors", "liveness", "biometrics", "audit", "fees"] as const;
const OUTCOMES = [
  { verdict: "ALLOW", key: "allowShort" },
  { verdict: "STEP_UP", key: "stepUpShort" },
  { verdict: "DENY", key: "denyShort" },
] as const;
const SCENES = ["onboard", "vault", "normal", "attack", "failclosed", "replay", "proof"] as const;

/** The nine inputs fan in from the top edge of the diagram. Even spacing across the 320 viewBox. */
const RAYS = [8, 45, 82, 119, 156, 193, 230, 267, 304];

/** Section head — one ramp rung, one tracking value, used by every band on the page. */
const H2 = "text-[2.25rem] leading-[1.1] tracking-[-0.025em] sm:text-[2.75rem]";
/** Editorial card: rests on the ground, lifts one overlay step under the pointer. Never darkens. */
const CARD_HOVER = "transition-[border-color,background-color] duration-150 ease-out hover:border-line-strong hover:bg-overlay-1";

function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={cx("h-6 w-6", className)} fill="none" aria-hidden>
      <path d="M14 2.5 L20 10 L16.5 10 L21 25.5 L14 17 L7 25.5 L11.5 10 L8 10 Z" fill="currentColor" />
    </svg>
  );
}

export default function Landing() {
  const { t, locale } = useI18n();
  const app = `/${locale}/login`;
  const demo = `/${locale}/demo`;

  return (
    <main className="min-h-screen bg-paper">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] items-center gap-6 px-5 py-3">
          <Link href={`/${locale}`} className="group flex items-center gap-2.5 rounded-[var(--radius-control)] text-ink">
            <Mark className="text-brass transition-transform duration-200 ease-out-soft group-hover:scale-110" />
            <span className="font-display text-[1.0625rem] font-semibold tracking-[-0.015em]">{t("brand.name")}</span>
          </Link>
          <nav className="ml-2 hidden items-center gap-0.5 text-[0.875rem] md:flex">
            {NAV.map((item) => (
              <a
                key={item}
                href={`#${item}`}
                className="rounded-[var(--radius-control)] px-2.5 py-1.5 font-medium text-ink-3 transition-[color,background-color] duration-150 ease-out hover:bg-overlay-2 hover:text-ink active:translate-y-px"
              >
                {t(`nav.${item}`)}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <LocaleSwitcher compact />
            <Link href={app}>
              <Button variant="primary" size="sm">
                {t("nav.openApp")} {Icon.arrow}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────────
          Three stacked atmospheres, each on its own element because .grain and .auth-aurora both
          own ::before. All three are neutralised by the global reduced-motion block. */}
      <section className="relative overflow-hidden border-b border-line">
        <div aria-hidden className="auth-aurora pointer-events-none absolute inset-0 opacity-70" />
        <div aria-hidden className="auth-lattice pointer-events-none absolute inset-0" />
        <div aria-hidden className="grain pointer-events-none absolute inset-0" />

        <div className="relative mx-auto max-w-[1200px] px-5 py-24 lg:py-32">
          <Eyebrow>{t("landing.heroKicker")}</Eyebrow>
          <h1 className="mt-6 max-w-4xl text-[2.5rem] leading-[1.06] tracking-[-0.03em] sm:text-[3.25rem] lg:text-[4rem]">{t("landing.heroTitle")}</h1>
          <p className="mt-7 max-w-2xl text-[1.25rem] leading-[1.45] tracking-[-0.015em] text-ink-2">{t("brand.usp")}</p>
          <p className="mt-5 max-w-2xl text-[0.9375rem] leading-[1.65] text-ink-3">{t("landing.heroBody")}</p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href={demo}>
              <Button variant="primary">{t("nav.startDemo")} {Icon.arrow}</Button>
            </Link>
            <a href="#architecture">
              <Button>{t("nav.readArchitecture")}</Button>
            </a>
          </div>

          {/* The five stages, ticking in left to right. */}
          <div className="mt-16 border-t border-line-faint pt-8">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
              {PIPELINE.map((stage, i) => (
                <div key={stage} className="flex items-center gap-2">
                  <span
                    className="rounded-[var(--radius-control)] border border-line bg-overlay-1 px-3.5 py-2 font-display text-[0.9375rem] font-medium tracking-[-0.01em] text-ink shadow-lift"
                    style={{ animation: `vajra-tick 500ms ${i * 140}ms both var(--ease-out-soft)` }}
                  >
                    {t(`landing.pipeline.${stage}`)}
                  </span>
                  {i < PIPELINE.length - 1 && (
                    <span aria-hidden className="text-ink-3">
                      →
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-4 text-[0.8125rem] text-ink-3">{t("landing.pipelineNote")}</p>
          </div>
        </div>
      </section>

      {/* ── Problem ────────────────────────────────────────────────────────── */}
      <section className="border-b border-line bg-overlay-1">
        <div className="mx-auto max-w-[1200px] px-5 py-24">
          <Reveal>
            <Eyebrow>{t("landing.problemKicker")}</Eyebrow>
            <h2 className={cx("mt-4 max-w-3xl", H2)}>{t("landing.problemTitle")}</h2>
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PROBLEMS.map((p, i) => (
              <Reveal key={p} delay={i * 60} className="h-full">
                <Card className={cx("group h-full px-5 py-5", CARD_HOVER)}>
                  {/* Transform, not width: a width transition would animate layout. */}
                  <span
                    aria-hidden
                    className="mb-4 block h-1 w-8 origin-left rounded-[var(--radius-pill)] bg-oxide/50 transition-[transform,background-color] duration-300 ease-out-soft group-hover:scale-x-150 group-hover:bg-oxide"
                  />
                  <h3 className="font-display text-[1.0625rem] leading-snug">{t(`landing.problems.${p}.title`)}</h3>
                  <p className="mt-2.5 text-[0.875rem] leading-[1.6] text-ink-2">{t(`landing.problems.${p}.body`)}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section id="how" className="scroll-mt-16 border-b border-line">
        <div className="mx-auto max-w-[1200px] px-5 py-24">
          <Reveal>
            <Eyebrow>{t("landing.howKicker")}</Eyebrow>
            <h2 className={cx("mt-4 max-w-3xl", H2)}>{t("landing.howTitle")}</h2>
          </Reveal>
          <ol className="mt-12 grid gap-4 md:grid-cols-3 lg:grid-cols-5">
            {HOW.map((step, i) => (
              <Reveal key={step} delay={i * 70} className="h-full">
                <Card as="article" className={cx("flex h-full flex-col px-5 py-5", CARD_HOVER)}>
                  <span className="mb-4 grid h-7 w-7 place-items-center rounded-[var(--radius-pill)] border border-brass-line bg-brass-soft font-mono text-[0.75rem] font-medium tnum text-brass-deep">
                    {i + 1}
                  </span>
                  <h3 className="font-display text-[1.0625rem] leading-snug">{t(`landing.how.${step}.title`)}</h3>
                  <p className="mt-2.5 flex-1 text-[0.875rem] leading-[1.6] text-ink-2">{t(`landing.how.${step}.body`)}</p>
                  <p className="mt-5 flex gap-1.5 border-t border-line-faint pt-3 font-mono text-[0.75rem] leading-snug text-verdigris">
                    <span aria-hidden>→</span>
                    <span>{t(`landing.how.${step}.outcome`)}</span>
                  </p>
                </Card>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Capabilities ───────────────────────────────────────────────────── */}
      <section id="capabilities" className="scroll-mt-16 border-b border-line bg-overlay-1">
        <div className="mx-auto max-w-[1200px] px-5 py-24">
          <Reveal>
            <Eyebrow>{t("landing.capabilitiesKicker")}</Eyebrow>
            <h2 className={cx("mt-4 max-w-3xl", H2)}>{t("landing.capabilitiesTitle")}</h2>
            <p className="mt-5 max-w-2xl text-[1rem] leading-[1.6] text-ink-2">{t("landing.capabilitiesNote")}</p>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c, i) => (
              <Reveal key={c.id} delay={i * 70} className="h-full">
                <Card className={cx("group h-full px-5 py-5", CARD_HOVER)}>
                  <span
                    aria-hidden
                    className="grid h-11 w-11 place-items-center rounded-[var(--radius-control)] border border-line bg-overlay-2 font-display text-[1.375rem] leading-none text-brass-deep transition-transform duration-200 ease-out-soft group-hover:-translate-y-0.5"
                  >
                    {c.glyph}
                  </span>
                  <h3 className="mt-4 font-display text-[1.125rem] leading-snug">{t(`landing.capabilities.${c.id}.title`)}</h3>
                  <p className="mt-2.5 text-[0.875rem] leading-[1.6] text-ink-2">{t(`landing.capabilities.${c.id}.body`)}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust firewall ─────────────────────────────────────────────────── */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-24 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <Reveal>
            <h2 className={H2}>{t("landing.firewallTitle")}</h2>
            <p className="mt-5 text-[1rem] leading-[1.65] text-ink-2">{t("landing.firewallBody")}</p>
          </Reveal>
          <Reveal delay={120}>
            {/* The one editorial surface on this page that floats: it is a diagram, not a card of
                copy, so it takes shadow-panel and no second border treatment. */}
            <div className="rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-panel">
              <div className="flex flex-wrap justify-center gap-1.5">
                {FIREWALL_INPUTS.map((input) => (
                  <span
                    key={input}
                    className="rounded-[var(--radius-pill)] border border-line bg-overlay-2 px-2.5 py-1 text-[0.8125rem] leading-5 text-ink-2"
                  >
                    {t(`landing.firewallInputs.${input}`)}
                  </span>
                ))}
              </div>

              {/* Nine signals fan into one gate; the gate fans out into three verdicts, each drawn
                  in its own semantic hue so the diagram and the stamps below agree. */}
              <svg viewBox="0 0 320 112" className="my-4 h-28 w-full" aria-hidden>
                {RAYS.map((x) => (
                  <line key={x} x1={x} y1="4" x2="160" y2="42" stroke="var(--color-line-strong)" strokeWidth="1" />
                ))}
                <rect x="110" y="42" width="100" height="16" rx="4" fill="var(--color-brass-soft)" stroke="var(--color-brass-line)" strokeWidth="1" />
                <circle cx="160" cy="50" r="2.5" fill="var(--color-brass)" />
                <g fill="none" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" opacity="0.85">
                  <path d="M160 58 V72 H54 V106" stroke="var(--color-verdigris)" />
                  <path d="M160 58 V106" stroke="var(--color-saffron)" />
                  <path d="M160 58 V72 H266 V106" stroke="var(--color-oxide)" />
                </g>
              </svg>

              <div className="grid grid-cols-3 gap-2">
                {OUTCOMES.map((o) => (
                  <div key={o.verdict} className="flex justify-center">
                    <VerdictStamp verdict={o.verdict} label={t(`verdict.${o.key}`)} />
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Explainability + proof ─────────────────────────────────────────────
          The only console well on the page, and the deepest layer on it. console is barely 6%
          below paper, so it takes hairlines top and bottom rather than trusting its fill. */}
      <section className="border-y border-line bg-console text-console-text">
        <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-24 lg:grid-cols-2">
          <Reveal>
            <p className="eyebrow text-console-muted">{t("trace.title")}</p>
            <h2 className="mt-4 text-[1.875rem] leading-[1.15] tracking-[-0.02em] text-console-text">{t("landing.explainTitle")}</h2>
            <p className="mt-5 text-[0.9375rem] leading-[1.65] text-console-muted">{t("landing.explainBody")}</p>
            <div className="mt-7 rounded-[var(--radius-panel)] border border-line-faint bg-console-2 p-4 font-mono text-[0.8125rem]">
              {[
                { icon: "✓", text: t("trace.identity"), cls: "text-verdigris" },
                { icon: "✓", text: t("trace.role", { role: t("roles.engineer"), action: t("actions.asset.download") }), cls: "text-verdigris" },
                { icon: "✗", text: t("trace.device"), cls: "text-oxide" },
                { icon: "✗", text: t("trace.hours", { start: 8, end: 20 }), cls: "text-oxide" },
                { icon: "⚠", text: t("trace.risk", { score: 91, tier: t("risk.high") }), cls: "text-saffron" },
              ].map((row, i) => (
                <p key={i} className={cx("tick flex gap-2.5 py-1 leading-relaxed", row.cls)} style={{ animationDelay: `${i * 90}ms` }}>
                  <span aria-hidden className="w-3 shrink-0 text-center">
                    {row.icon}
                  </span>
                  <span className="text-console-text">{row.text}</span>
                </p>
              ))}
              <div className="mt-4 border-t border-line-faint pt-4">
                <VerdictStamp verdict="DENY" label={t("verdict.DENY")} />
              </div>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <p className="eyebrow text-console-muted">{t("verify.title")}</p>
            <h2 className="mt-4 text-[1.875rem] leading-[1.15] tracking-[-0.02em] text-console-text">{t("landing.proofTitle")}</h2>
            <p className="mt-5 text-[0.9375rem] leading-[1.65] text-console-muted">{t("landing.proofBody")}</p>
            <ul className="mt-7 space-y-2">
              {(["hash", "signature", "chain", "ledger", "policy"] as const).map((check, i) => (
                <li
                  key={check}
                  className="tick flex items-center gap-3 rounded-[var(--radius-field)] border border-line-faint bg-console-2 px-4 py-2.5"
                  style={{ animationDelay: `${i * 90}ms` }}
                >
                  <span
                    aria-hidden
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-verdigris-line bg-verdigris-soft text-[0.6875rem] font-semibold leading-none text-verdigris"
                  >
                    ✓
                  </span>
                  <span className="text-[0.875rem] text-console-text">{t(`verify.checks.${check}`)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 flex items-center gap-2 font-display text-[1.125rem] font-semibold tracking-[-0.015em] text-verdigris">
              {Icon.check} {t("verify.valid")}
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Architecture ───────────────────────────────────────────────────── */}
      <section id="architecture" className="scroll-mt-16 border-b border-line">
        <div className="mx-auto max-w-[1200px] px-5 py-24">
          <Reveal>
            <Eyebrow>{t("landing.architectureKicker")}</Eyebrow>
            <h2 className={cx("mt-4 max-w-3xl", H2)}>{t("landing.architectureTitle")}</h2>
            <p className="mt-5 max-w-2xl text-[1rem] leading-[1.65] text-ink-2">{t("landing.architectureBody")}</p>
          </Reveal>
          <Reveal delay={100}>
            <div className="mt-12 grid gap-3 md:grid-cols-3">
              {[
                { name: "Next.js console", role: "Camera, DID keys, tables, graph", tone: "steel" as const },
                { name: "Trust Gateway", role: "Decisions, trust, proofs, incidents", tone: "brass" as const },
                { name: "Risk engine", role: "Contextual signals → 0–100", tone: "neutral" as const },
                { name: "PostgreSQL", role: "Projections and hash-chained audit", tone: "neutral" as const },
                { name: "Content store", role: "AES-256-GCM blobs, addressed by CID", tone: "neutral" as const },
                { name: "Ledger", role: "DIDs, ownership, policy hashes, anchors", tone: "good" as const },
              ].map((c) => (
                <Card key={c.name} className={cx("px-5 py-4", CARD_HOVER)}>
                  <Chip tone={c.tone}>{c.name}</Chip>
                  <p className="mt-2.5 text-[0.8125rem] leading-[1.6] text-ink-2">{c.role}</p>
                </Card>
              ))}
            </div>
            {/* The rule that decides ties. A brass left rail because it is the system speaking. */}
            <p className="mt-6 rounded-[var(--radius-field)] border-l-2 border-brass bg-brass-soft/35 px-4 py-3.5 text-[0.9375rem] leading-[1.6] text-ink-2">
              {t("landing.architectureRule")}
            </p>
          </Reveal>

          <Reveal delay={140}>
            <h3 className="mt-16 font-display text-[1.375rem] leading-snug tracking-[-0.015em]">{t("landing.comparisonTitle")}</h3>
            <Table className="mt-5" head={(["dimension", "legacy", "vajra"] as const).map((h) => t(`landing.comparison.header.${h}`))}>
              {COMPARISON.map((row) => (
                <Row key={row}>
                  <Cell className="text-ink">{t(`landing.comparison.${row}.dimension`)}</Cell>
                  <Cell className="text-ink-3">{t(`landing.comparison.${row}.legacy`)}</Cell>
                  <Cell className="font-medium text-verdigris">{t(`landing.comparison.${row}.vajra`)}</Cell>
                </Row>
              ))}
            </Table>
          </Reveal>
        </div>
      </section>

      {/* ── Demo CTA ───────────────────────────────────────────────────────── */}
      <section id="demo" className="scroll-mt-16 border-b border-line bg-overlay-1">
        <div className="mx-auto max-w-[1200px] px-5 py-24">
          <Reveal>
            <h2 className={cx("max-w-3xl", H2)}>{t("landing.demoTitle")}</h2>
            <p className="mt-5 max-w-2xl text-[1rem] leading-[1.65] text-ink-2">{t("landing.demoBody")}</p>
          </Reveal>
          <Reveal delay={100}>
            <ol className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {SCENES.map((scene, i) => (
                <li key={scene} className="h-full">
                  <Link
                    href={demo}
                    className="flex h-full flex-col gap-1.5 rounded-[var(--radius-card)] border border-line bg-paper px-4 py-3.5 transition-[border-color,background-color,box-shadow] duration-150 ease-out hover:border-line-strong hover:bg-overlay-2 active:translate-y-px"
                  >
                    <span className="tnum font-mono text-[0.75rem] text-brass">{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-display text-[0.9375rem] font-medium leading-snug text-ink">{t(`demo.scenes.${scene}.title`)}</span>
                  </Link>
                </li>
              ))}
            </ol>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link href={demo}>
                <Button variant="primary">{t("nav.startDemo")} {Icon.arrow}</Button>
              </Link>
              <Link href={`/${locale}/verify`}>
                <Button>{t("verify.title")}</Button>
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-line bg-console text-console-muted">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-start justify-between gap-8 px-5 py-12">
          <div>
            <div className="flex items-center gap-2.5 text-console-text">
              <Mark className="text-console-accent" />
              <span className="font-display text-[1.0625rem] font-semibold tracking-[-0.015em]">{t("brand.name")}</span>
            </div>
            <p className="mt-3 max-w-md text-[0.8125rem] leading-[1.6]">{t("brand.expansion")}</p>
            <p className="mt-1.5 font-display text-[0.875rem] text-console-accent">{t("brand.tagline")}</p>
          </div>
          <div className="text-[0.8125rem] leading-[1.6]">
            <p>{t("landing.footerNote")}</p>
            <p className="mt-1">{t("landing.team")}</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
