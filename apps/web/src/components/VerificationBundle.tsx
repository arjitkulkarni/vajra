"use client";

/**
 * The five verifications, rendered.
 *
 * The same component is used in three places — the signup result, the login result, and the
 * administrator's review — because they are looking at the same object. A refusal is shown in full
 * rather than collapsed to "denied": which gate failed, what the number was, and what it had to
 * beat. That is the difference between a system that says no and one that can be argued with.
 */
import { VERIFICATION_GATES, LIVENESS_SIGNALS, type VerificationCheck, type VerificationGateId } from "@vajra/contracts";
import { useI18n } from "@/lib/i18n-client";
import { IdTag, StateDot } from "@/components/console";
import { Chip, HashValue, Icon, Meter, cx } from "@/components/ui";

export function VerificationBundle({
  checks,
  livenessSignals,
  bundleHash,
  compact,
}: {
  checks: VerificationCheck[];
  livenessSignals?: Record<string, number>;
  bundleHash?: string;
  compact?: boolean;
}) {
  const { t, n } = useI18n();
  // Render every gate in the canonical order, even one the server did not reach.
  const byId = new Map(checks.map((c) => [c.id, c]));
  const passed = checks.length > 0 && checks.every((c) => c.result === "pass");

  return (
    // Console register: the panel radius, not the card radius. This is an evidence readout that
    // sits inside decision surfaces, and a 16px fillet on a 28px gate row turns a ledger into a
    // greeting card. The panel owns the rim; the header takes one overlay step and a bottom rule.
    <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-paper">
      <div className="flex items-center gap-2 border-b border-line bg-paper-2 px-3 py-2">
        <p className="eyebrow">{t("verify.bundle")}</p>
        <Chip tone={passed ? "good" : "bad"} icon={passed ? Icon.check : Icon.cross} className="ml-auto stamp">
          {passed ? t("verify.allPassed") : t("verify.refused")}
        </Chip>
      </div>

      <ol className="divide-y divide-line-faint">
        {VERIFICATION_GATES.map((id: VerificationGateId, i) => {
          const check = byId.get(id);
          const state = !check ? "skip" : check.result;
          return (
            // The refusal band. A failed gate keeps its dot, its word and its number — the tint and
            // the left rail exist so an operator can find it at the edge of vision without reading.
            <li
              key={id}
              className={cx(
                "flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 px-3 py-2",
                state === "fail" ? "border-l-oxide bg-oxide-soft/40" : "border-l-transparent",
              )}
            >
              <span className="tnum w-4 shrink-0 text-center font-mono text-[0.6875rem] text-ink-3">{i + 1}</span>
              <StateDot tone={state === "pass" ? "good" : state === "fail" ? "bad" : "neutral"} />
              <span className={cx("text-[0.8125rem]", state === "fail" ? "font-medium text-ink" : "text-ink-2")}>{t(`verify.gates.${id}`)}</span>
              <span className="ml-auto flex items-center gap-2">
                {check?.score !== null && check?.score !== undefined && (
                  <span className="tnum font-mono text-[0.75rem] text-ink-2">
                    {n(check.score)}
                    {check.required !== null && check.required !== undefined && <span className="text-ink-3"> / {n(check.required)}</span>}
                  </span>
                )}
                <IdTag tone={state === "pass" ? "good" : state === "fail" ? "bad" : "neutral"}>
                  {state === "skip" ? t("verify.notReached") : t(`verify.${state}`)}
                </IdTag>
              </span>
              {check && <p className="w-full pl-7 text-[0.75rem] leading-relaxed text-ink-3">{t(check.detailKey)}</p>}
            </li>
          );
        })}
      </ol>

      {!compact && livenessSignals && Object.keys(livenessSignals).length > 0 && (
        <div className="border-t border-line px-3 py-2.5">
          <p className="eyebrow mb-2">{t("verify.signals")}</p>
          <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
            {LIVENESS_SIGNALS.map((id) => {
              const value = livenessSignals[id];
              return (
                <div key={id} className="flex items-center gap-2.5">
                  <span className="w-[5rem] shrink-0 text-[0.75rem] text-ink-2" title={t(`onboard.signalHelp.${id}`)}>
                    {t(`onboard.signals.${id}`)}
                  </span>
                  {value === undefined ? (
                    <span className="text-[0.6875rem] uppercase tracking-[0.1em] text-ink-3">{t("onboard.signalUnmeasured")}</span>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1">
                        <Meter value={Math.round(value * 100)} tone={value > 0.6 ? "good" : value > 0.3 ? "warn" : "bad"} showValue={false} />
                      </span>
                      {/* The rail carries the shape, the numeral carries the evidence. Machine-made,
                          so it is mono and column-aligned against its neighbour in the other column. */}
                      <span className="tnum w-8 shrink-0 text-right font-mono text-[0.6875rem] text-ink-3">{n(Math.round(value * 100))}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {bundleHash && (
        // The hash drops into the console well: it is the one thing on this panel a machine wrote,
        // and the well plus the top rule is what keeps that legible as a separate layer.
        <div className="border-t border-line bg-console px-3 py-2">
          <HashValue value={bundleHash} label={t("verify.bundleHash")} chars={10} />
        </div>
      )}
    </div>
  );
}
