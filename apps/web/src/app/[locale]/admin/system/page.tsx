"use client";

/**
 * System health.
 *
 * The point of this page is to make the fail-closed posture visible: which dependencies the control
 * plane needs, what it does when one is gone, and whether Postgres and the ledger still agree. The
 * outage drills are here rather than on the overview because taking a dependency down is an action,
 * not a status.
 */
import { useState } from "react";
import type { Dependency } from "@vajra/contracts";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { useAsync } from "@/components/trust";
import { DataCell, DataRow, DataTable, IdTag, KeyValues, OpsHeader, Panel, StatBand, StateDot } from "@/components/console";
import { Button, Chip, ErrorNote, HashValue, Icon, Skeleton, cx } from "@/components/ui";

const DEPS: Dependency[] = ["db", "ledger", "risk", "storage"];

export default function SystemHealth() {
  const { t, dt, n } = useI18n();
  const health = useAsync(() => api.health(), []);
  const stats = useAsync(() => api.stats(), []);
  const chain = useAsync(() => api.auditVerify(), []);
  const ledger = useAsync(() => api.ledgerBlocks(12), []);
  const [busy, setBusy] = useState<string | null>(null);

  const toggleOutage = async (dep: Dependency, down: boolean) => {
    setBusy(dep);
    try {
      await api.demoOutage(dep, down);
      if (!down) await api.demoDrain();
      health.reload();
      stats.reload();
      ledger.reload();
    } finally {
      setBusy(null);
    }
  };

  const h = health.data;
  const s = stats.data;
  const downCount = Object.values(h?.deps ?? {}).filter((d) => !d?.ok).length;

  /**
   * Health and stats both feed the header verdict and the band above the fold, so a single note
   * carries whichever failed first — a page that reports outages must not itself become a stack of
   * identical red banners. Each panel below owns the note for the call that blinds only it.
   */
  const headError = health.error ?? stats.error;

  /**
   * A page whose whole job is to say whether things work must never answer from a call that never
   * returned. An unread /v1/stats is not "0 decisions, 0 pending anchors, 0 ms p95" — it is nothing
   * at all, and it says so with the same em dash the rest of this page uses for "not known".
   */
  const stat = (value: string) => (s ? value : "—");

  return (
    <>
      <OpsHeader
        title={t("console.system.title")}
        meta={<span>{t("console.system.subtitle")}</span>}
        status={
          // No health payload means the dependency map is unread, and an unread map has a down
          // count of zero — which would render as OPERATIONAL. That is the one verdict this page
          // is never allowed to invent, so without data it reports that it does not know.
          h ? (
            <Chip tone="neutral" icon={<StateDot tone={downCount === 0 ? "good" : "bad"} pulse={downCount > 0} />}>
              {downCount === 0 ? t("console.overview.operational") : downCount === 1 ? t("console.overview.degraded", { n: downCount }) : t("console.overview.degradedMany", { n: downCount })}
            </Chip>
          ) : (
            <Chip tone="neutral" icon={<StateDot tone="neutral" pulse={Boolean(health.error)} />}>
              {t("common.unknown")}
            </Chip>
          )
        }
        actions={
          <Button
            size="sm"
            onClick={() => {
              health.reload();
              stats.reload();
              ledger.reload();
              chain.reload();
            }}
          >
            {t("common.refresh")}
          </Button>
        }
      />

      {headError && (
        <ErrorNote
          message={headError}
          onRetry={() => {
            health.reload();
            stats.reload();
          }}
          retryLabel={t("common.retry")}
        />
      )}

      <StatBand
        className="rise mb-4"
        items={[
          { label: t("console.system.blockHeight"), value: stat(n(s?.ledgerBlocks ?? 0)) },
          { label: t("console.system.outbox"), value: stat(n(s?.pendingAnchors ?? 0)), tone: s ? (s.pendingAnchors > 0 ? "warn" : "good") : "neutral" },
          { label: t("dashboard.stats.decisions"), value: stat(n(s?.decisions24h ?? 0)) },
          { label: t("dashboard.stats.p95"), value: stat(`${n(s?.decisionP95Ms ?? 0)} ms`), tone: s ? (s.decisionP95Ms < 300 ? "good" : "warn") : "neutral" },
          {
            label: t("dashboard.stats.faceChecks"),
            value: stat(n(s?.faceChecks ?? 0)),
            tone: s ? (s.faceChecksRefused > 0 ? "warn" : "good") : "neutral",
            // The refusal hint is a claim about what the matcher did; without stats there is no claim.
            hint: s ? t("dashboard.stats.faceChecksHint", { refused: n(s.faceChecksRefused) }) : undefined,
          },
          { label: t("dashboard.stats.pendingEnrolments"), value: stat(n(s?.pendingEnrolments ?? 0)), tone: s && s.pendingEnrolments > 0 ? "warn" : "neutral" },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Panel title={t("console.system.dependencies")} flush>
            {health.loading && !h ? (
              <Skeleton className="h-40" />
            ) : !h ? (
              // Each row defaults `ok` to false, so an unread health check would paint all four
              // dependencies red and offer to "restore" them. Nothing is known here, and no drill
              // can be run against a state nobody has read; the note above the band carries the why.
              <p className="px-3 py-8 text-center text-[0.8125rem] text-ink-3">{t("common.unknown")}</p>
            ) : (
              <ul className="divide-y divide-line-faint">
                {DEPS.map((dep) => {
                  const state = h?.deps?.[dep];
                  const simulated = h?.simulatedOutage?.includes(dep);
                  const ok = state?.ok ?? false;
                  return (
                    <li
                      key={dep}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 transition-[background-color] duration-150 ease-out hover:bg-overlay-1"
                    >
                      <StateDot tone={ok ? "good" : "bad"} pulse={!ok} />
                      <span className="min-w-[110px] text-[0.875rem] font-medium text-ink">{t(`dashboard.deps.${dep}`)}</span>
                      <span className={cx("min-w-[92px] text-[0.75rem] font-semibold uppercase tracking-[0.07em]", ok ? "text-verdigris" : "text-oxide")}>
                        {ok ? t("console.system.operational") : simulated ? t("console.system.simulated") : t("console.system.down")}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-ink-3" title={state?.detail}>
                        {state?.detail ?? "—"}
                      </span>
                      <Button size="sm" variant={ok ? "ghost" : "primary"} loading={busy === dep} onClick={() => void toggleOutage(dep, ok)}>
                        {ok ? t("console.system.simulateOutage") : t("console.system.restore")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="border-t border-line px-3 py-2 text-[0.75rem] text-ink-3">{t("console.system.drillsBody")}</p>
          </Panel>

          <Panel title={t("console.system.recentBlocks")} flush>
            {ledger.loading && !ledger.data ? (
              <Skeleton className="h-56" />
            ) : ledger.error ? (
              // "The ledger returned no blocks" and "we could not reach the ledger" are opposite
              // findings. The empty state below is only ever allowed to mean the first one.
              <div className="px-3 py-3">
                <ErrorNote message={ledger.error} onRetry={ledger.reload} retryLabel={t("common.retry")} />
              </div>
            ) : !ledger.data || ledger.data.blocks.length === 0 ? (
              <p className="px-3 py-8 text-center text-[0.8125rem] text-ink-3">{t("common.empty")}</p>
            ) : (
              <DataTable
                minWidth={720}
                cols={[
                  { label: t("console.system.blockCols.number"), width: "80px" },
                  t("console.system.blockCols.tx"),
                  t("console.system.blockCols.contract"),
                  t("console.system.blockCols.fn"),
                  t("console.system.blockCols.at"),
                ]}
              >
                {ledger.data.blocks.map((b) => (
                  <DataRow key={b.txId}>
                    <DataCell mono strong>
                      #{n(b.number)}
                    </DataCell>
                    <DataCell mono>
                      <HashValue value={b.txId} chars={10} />
                    </DataCell>
                    <DataCell mono>{b.contract}</DataCell>
                    <DataCell mono>{b.fn}</DataCell>
                    <DataCell mono nowrap>
                      {dt(b.at, { dateStyle: "short", timeStyle: "medium" })}
                    </DataCell>
                  </DataRow>
                ))}
              </DataTable>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title={t("console.system.securityMode")}>
            <p className="flex items-center gap-2 text-oxide">
              {Icon.shield}
              <span className="font-display text-[1.25rem] font-semibold uppercase tracking-[0.02em]">{t("console.system.failClosed")}</span>
            </p>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-2">{t("console.system.failClosedBody")}</p>
            {h && (
              <p className="tnum mt-2 border-t border-line-faint pt-2 font-mono text-[0.6875rem] leading-relaxed text-ink-3">
                {Object.entries(h.modes ?? {})
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" · ")}
              </p>
            )}
          </Panel>

          <Panel title={t("console.system.ledger")}>
            <KeyValues
              items={[
                { k: t("console.system.blockHeight"), v: ledger.data || s ? n(ledger.data?.blocks[0]?.number ?? s?.ledgerBlocks ?? 0) : "—", mono: true },
                { k: t("console.system.lastAnchor"), v: ledger.data?.blocks[0] ? dt(ledger.data.blocks[0].at, { timeStyle: "medium", dateStyle: "short" }) : "—", mono: true },
                {
                  k: t("console.system.outbox"),
                  // "Outbox clear" is a finding about the anchor queue. Without stats there is none.
                  v: s ? (s.pendingAnchors > 0 ? t("console.system.outboxPending", { n: n(s.pendingAnchors) }) : t("console.system.outboxClear")) : "—",
                  mono: true,
                },
              ]}
            />
            <div className="mt-2 flex flex-wrap gap-2 border-t border-line pt-2">
              {/*
               * `verification.ok !== false` was reading an absent payload as consistent, so a ledger
               * we could not reach reported itself green. The retry lives with the blocks table this
               * same call feeds; here the claim is simply withdrawn.
               */}
              {ledger.error ? (
                <Chip tone="bad" icon={Icon.cross}>
                  {t("common.error")}
                </Chip>
              ) : ledger.data ? (
                <Chip tone={ledger.data.verification?.ok !== false ? "good" : "bad"} icon={ledger.data.verification?.ok !== false ? Icon.check : Icon.cross}>
                  {ledger.data.verification?.ok !== false ? t("console.system.consistent") : t("console.system.inconsistent", { block: n(ledger.data.verification?.brokenAt ?? 0) })}
                </Chip>
              ) : (
                <Chip tone="neutral">{t("common.unknown")}</Chip>
              )}
              {ledger.data?.mode && <IdTag tone="steel">{ledger.data.mode}</IdTag>}
            </div>
          </Panel>

          <Panel title={t("audit.title")}>
            {/*
             * Chain verification is the one answer on this page nobody may guess at. A failed
             * /v1/audit/verify is neither intact nor broken: it is a check that did not run, and it
             * gets its own note here — with a retry, because an operator will want to ask again.
             */}
            {chain.error ? (
              <ErrorNote message={chain.error} onRetry={chain.reload} retryLabel={t("common.retry")} />
            ) : chain.data ? (
              <Chip tone={chain.data.ok ? "good" : "bad"} icon={chain.data.ok ? Icon.check : Icon.cross}>
                {chain.data.ok ? t("console.system.chainIntact", { n: n(chain.data.checked) }) : t("console.system.chainBroken", { seq: n(chain.data.brokenAtSeq ?? 0) })}
              </Chip>
            ) : (
              <p className="text-[0.8125rem] text-ink-3">—</p>
            )}
            <KeyValues
              className="mt-2"
              items={[
                { k: t("dashboard.stats.proofs"), v: stat(n(s?.proofs ?? 0)), mono: true },
                { k: t("console.system.eventCount"), v: stat(n(s?.auditEvents ?? 0)), mono: true },
                { k: t("console.overview.postureItems.anchored"), v: stat(`${n(s && s.auditEvents > 0 ? Math.round((s.anchoredEvents / s.auditEvents) * 100) : 0)}%`), mono: true },
              ]}
            />
          </Panel>
        </div>
      </div>
    </>
  );
}
