"use client";

/**
 * THE EVIDENCE WALL — thirty-six decisions, filterable, each drawn as the thing it produced.
 *
 * The corpus, the facet engine and the visuals all already exist: `site/data.ts` holds the records
 * and `filterRecords` / `sortRecords`, and `site/mockups.tsx` holds the fourteen product visuals a
 * record can name. This file is the wall they hang on and nothing else — no second filter
 * implementation, no second card design.
 *
 * Two behaviours worth naming:
 *
 *   FACETS AND ACROSS, OR WITHIN.  Two verdict pills widen the result; a verdict pill and a class
 *   pill narrow it. That is what `filterRecords` implements and it is the only combination that
 *   behaves the way a person expects when they click two pills in the same row.
 *
 *   TWELVE, THEN ALL.  Thirty-six mockups is thirty-six subtrees; the first twelve are what a
 *   reader actually looks at, and the rest arrive on request. The count above the grid always
 *   reports the FILTERED total, never the rendered one, so the button is an expansion and not a
 *   correction.
 */
import { useMemo, useState } from "react";
import { ASSET_CLASSES, EVIDENCE, VERDICTS, filterRecords, type AssetClass, type Verdict } from "@/components/site/data";
import { Mockup } from "@/components/site/mockups";
import { Button, Chip, cx, type Tone } from "@/components/ui";
import { useI18n } from "@/lib/i18n-client";

const VERDICT_TONE: Record<Verdict, Tone> = { ALLOW: "good", STEP_UP: "warn", DENY: "bad" };
const VERDICT_GLYPH: Record<Verdict, string> = { ALLOW: "✓", STEP_UP: "⚠", DENY: "✗" };

const PAGE = 12;

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "shrink-0 rounded-[var(--radius-pill)] border px-3 py-1.5 text-[0.8125rem] font-medium leading-5 transition-[color,background-color,border-color] duration-150 ease-out active:translate-y-px",
        on ? "border-brass-line bg-brass-soft text-brass-deep" : "border-line text-ink-3 hover:border-line-strong hover:bg-overlay-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function EvidenceWall() {
  const { t, n, dt } = useI18n();
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [classes, setClasses] = useState<AssetClass[]>([]);
  const [all, setAll] = useState(false);

  const toggle = <T,>(list: T[], set: (v: T[]) => void, value: T) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const counts = useMemo(() => {
    const byVerdict = {} as Record<Verdict, number>;
    for (const v of VERDICTS) byVerdict[v] = 0;
    for (const r of EVIDENCE) byVerdict[r.verdict] += 1;
    return byVerdict;
  }, []);

  const results = useMemo(
    () => filterRecords(EVIDENCE, "", { verdicts, assetClasses: classes }),
    [verdicts, classes],
  );
  const visible = all ? results : results.slice(0, PAGE);
  const clear = verdicts.length > 0 || classes.length > 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-line py-4">
        <div className="rail rail-until-sm edge-fade-x -mx-1 flex gap-1.5 px-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {VERDICTS.map((v) => (
            <Pill key={v} on={verdicts.includes(v)} onClick={() => toggle(verdicts, setVerdicts, v)}>
              <span aria-hidden className="mr-1.5 opacity-60">
                {VERDICT_GLYPH[v]}
              </span>
              {t(`verdict.${v === "ALLOW" ? "allowShort" : v === "DENY" ? "denyShort" : "stepUpShort"}`)}
              <span className="ml-1.5 font-mono text-[0.75rem] tnum opacity-60">{n(counts[v])}</span>
            </Pill>
          ))}
          <span aria-hidden className="mx-1 w-px shrink-0 self-stretch bg-line" />
          {ASSET_CLASSES.map((c) => (
            <Pill key={c} on={classes.includes(c)} onClick={() => toggle(classes, setClasses, c)}>
              {t(`assetClass.${c}`)}
            </Pill>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* The corpus is written, not captured. Every surface that shows it says so. */}
          <span className="hidden shrink-0 rounded-[var(--radius-pill)] border border-line-strong px-2.5 py-0.5 font-mono text-[0.6875rem] uppercase leading-5 tracking-[0.1em] text-ink-3 sm:inline-flex">
            {t("site.page.evidence.sample")}
          </span>
          <p className="type-meta whitespace-nowrap">
            {results.length === 1 ? t("site.explorer.resultsOne") : t("site.explorer.results", { n: n(results.length) })}
          </p>
          {clear && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setVerdicts([]);
                setClasses([]);
              }}
            >
              {t("site.explorer.clearFilters")}
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-overlay-1 px-6 py-14 text-center">
          <p className="font-display text-[1.25rem] font-semibold tracking-[-0.015em]">{t("site.explorer.emptyTitle")}</p>
          <p className="mx-auto mt-2 max-w-md text-[0.875rem] leading-relaxed text-ink-2">{t("site.explorer.emptyBody")}</p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((r, i) => (
            <li key={r.id}>
              <article
                className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper transition-[border-color,box-shadow] duration-200 ease-out hover:border-line-strong hover:shadow-panel"
                // A short, capped stagger: the twelfth card should not wait three quarters of a
                // second for its turn, so the ladder stops climbing after six.
                style={{ animation: `vajra-rise 460ms ${Math.min(i, 6) * 45}ms var(--ease-out-soft) both` }}
              >
                <div className="aspect-[4/3] w-full overflow-hidden border-b border-line bg-paper-2">
                  <div className="media-zoom h-full w-full">
                    <Mockup kind={r.mockup} seed={i + 1} verdict={r.verdict} />
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 text-[0.9375rem] font-medium leading-snug text-ink">{t(r.titleKey)}</h3>
                    <Chip tone={VERDICT_TONE[r.verdict]} className="shrink-0">
                      <span aria-hidden>{VERDICT_GLYPH[r.verdict]}</span>
                      {t(`verdict.${r.verdict === "ALLOW" ? "allowShort" : r.verdict === "DENY" ? "denyShort" : "stepUpShort"}`)}
                    </Chip>
                  </div>
                  <p className="type-meta mt-1.5">
                    {t(`roles.${r.roleKey}`)} · {t(`site.explorer.actions.${r.action}`)} · {t(`site.explorer.sectors.${r.sector}`)}
                  </p>

                  <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line-faint pt-3">
                    {[
                      { k: t("trust.identity"), v: n(r.trust), tone: r.trust >= 70 ? "text-verdigris" : r.trust >= 40 ? "text-saffron" : "text-oxide" },
                      { k: t("risk.label"), v: n(r.risk), tone: r.risk >= 60 ? "text-oxide" : r.risk >= 30 ? "text-saffron" : "text-verdigris" },
                      { k: "latency", v: `${n(r.latencyMs)}ms`, tone: "text-ink-2" },
                    ].map((s) => (
                      <div key={s.k} className="min-w-0">
                        <dt className="eyebrow truncate">{s.k}</dt>
                        <dd className={cx("mt-0.5 font-mono text-[0.875rem] font-medium leading-none tnum", s.tone)}>{s.v}</dd>
                      </div>
                    ))}
                  </dl>

                  <p className="mt-auto flex items-center justify-between gap-2 pt-4 font-mono text-[0.6875rem] text-ink-3">
                    <span className="truncate">{r.id}</span>
                    <span className={cx("shrink-0", r.anchored ? "text-verdigris" : "text-saffron")}>
                      {r.anchored ? `#${n(r.block ?? 0)}` : t("site.common.pending")}
                    </span>
                  </p>
                  <p className="type-meta mt-1 truncate font-mono">
                    {dt(r.at, { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      {!all && results.length > PAGE && (
        <div className="mt-8 flex justify-center">
          <Button size="lg" pill onClick={() => setAll(true)}>
            {t("site.explorer.viewAll")}
            <span aria-hidden className="font-mono text-[0.8125rem] tnum opacity-60">
              +{n(results.length - PAGE)}
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}
