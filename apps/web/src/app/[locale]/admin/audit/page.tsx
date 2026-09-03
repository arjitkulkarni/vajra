"use client";

/**
 * Audit — a forensic search engine over the hash chain.
 *
 * Facets first, results dense, and every row opens the event drawer where the chain hash can be
 * recomputed and checked against the ledger. The natural-language box is a convenience that
 * compiles to the same facets, and it shows you what it decided you meant.
 *
 * DAYLIGHT: both filter wells share one chrome (FilterBar's shallow overlay inside the panel),
 * the sequence column is right-aligned tabular because it is a counter and not a label, and the
 * page runs on a single 16px vertical rhythm rather than three ad-hoc margins.
 */
import { useMemo, useState } from "react";
import { api, type AuditEvent } from "@/lib/api";
import { headlineFor } from "@/lib/events";
import { useI18n } from "@/lib/i18n-client";
import { useAsync } from "@/components/trust";
import { useEntity } from "@/components/EntityDrawer";
import { DataCell, DataRow, DataTable, FilterBar, IdTag, OpsHeader, Panel, SelectInput, StateDot, TextInput, VerdictStamp } from "@/components/console";
import { Button, Chip, ErrorNote, HashValue, Icon, Skeleton } from "@/components/ui";

const DECISIONS = ["", "ALLOW", "DENY", "STEP_UP", "PENDING_APPROVAL"] as const;

export default function Audit() {
  const { t, dt, n } = useI18n();
  const { open } = useEntity();

  const [hours, setHours] = useState("24");
  const [actorDid, setActorDid] = useState("");
  const [assetUid, setAssetUid] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("asset") ?? ""));
  const [decision, setDecision] = useState("");
  const [term, setTerm] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ filter: Record<string, unknown>; events: AuditEvent[]; count: number } | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const events = useAsync(
    () => api.audit({ sinceHours: hours === "all" ? undefined : hours, actorDid: actorDid || undefined, assetUid: assetUid || undefined, limit: 250 }),
    [hours, actorDid, assetUid],
  );
  const chain = useAsync(() => api.auditVerify(), []);
  const identities = useAsync(() => api.identities(), []);
  const assets = useAsync(() => api.assets(), []);

  // Three loads sit beside the search itself: the two name lookups behind the person and asset
  // facets, and the chain check behind the header stamp. None of them stops the search — the facets
  // fall back to raw DIDs and UIDs, the stamp simply does not appear — but a silent degradation
  // reads as "nothing to show", and in a forensic tool that is the one answer we must never fake.
  // One note for the first of them, and none while the stream note below is already up.
  const streamBlind = !!events.error && !answer;
  const aside = streamBlind ? null : events.error ? events : identities.error ? identities : assets.error ? assets : chain.error ? chain : null;

  const ask = async () => {
    if (!question.trim()) return;
    setAsking(true);
    setAskError(null);
    try {
      setAnswer(await api.ask(question));
    } catch (e) {
      // Dropping the answer on the floor left the table showing the unfiltered stream, which the
      // operator reads as the answer to their question. Keep the failure and say it out loud.
      setAnswer(null);
      setAskError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  // Free text matches identifiers and hashes as well as event types — an operator usually pastes one.
  const rows = useMemo(() => {
    const source = answer?.events ?? events.data ?? [];
    const q = term.trim().toLowerCase();
    return source.filter((e) => {
      const h = headlineFor(e);
      if (decision && h.verdict !== decision) return false;
      if (!q) return true;
      return [e.id, e.eventType, e.actorDid, e.assetUid, e.chainHash, e.ledgerTxId, e.incidentId, String(e.seq)].some((f) => f && f.toLowerCase().includes(q));
    });
  }, [answer, events.data, term, decision]);

  const reset = () => {
    setAnswer(null);
    setAskError(null);
    setQuestion("");
    setTerm("");
    setDecision("");
    setActorDid("");
    setAssetUid("");
  };

  return (
    <>
      <OpsHeader
        title={t("console.audit.title")}
        meta={<span>{t("console.audit.subtitle")}</span>}
        status={
          chain.data && (
            <Chip tone={chain.data.ok ? "good" : "bad"} icon={chain.data.ok ? Icon.check : Icon.cross}>
              {chain.data.ok ? t("audit.chainIntact", { n: n(chain.data.checked) }) : t("audit.chainBroken", { seq: n(chain.data.brokenAtSeq ?? 0) })}
            </Chip>
          )
        }
      />

      <div className="space-y-4">
        <Panel title={t("console.audit.facets")}>
          <FilterBar>
            <TextInput className="min-w-[220px] flex-1" label={t("console.audit.searchPlaceholder")} value={term} onChange={setTerm} placeholder="AST-… · did:key:… · a83f…" mono />
            <SelectInput
              label={t("console.audit.facetWindow")}
              value={hours}
              onChange={setHours}
              options={[
                { value: "24", label: t("audit.hours24") },
                { value: "168", label: t("audit.hours168") },
                { value: "all", label: t("audit.hoursAll") },
              ]}
            />
            <SelectInput
              label={t("console.audit.facetPerson")}
              value={actorDid}
              onChange={setActorDid}
              options={[{ value: "", label: t("common.all") }, ...(identities.data ?? []).map((i) => ({ value: i.did, label: i.displayName }))]}
            />
            <SelectInput
              label={t("console.audit.facetAsset")}
              value={assetUid}
              onChange={setAssetUid}
              options={[{ value: "", label: t("common.all") }, ...(assets.data ?? []).map((a) => ({ value: a.assetUid, label: a.name }))]}
            />
            <SelectInput
              label={t("console.audit.facetDecision")}
              value={decision}
              onChange={setDecision}
              options={DECISIONS.map((d) => ({ value: d, label: d === "" ? t("common.all") : t(`verdict.${d}`) }))}
            />
            <Button size="sm" variant="ghost" onClick={reset}>
              {t("console.audit.clear")}
            </Button>
          </FilterBar>

          {/* The question box compiles down to the facets above, so it wears the same shallow well
              rather than reading as a separate feature bolted onto the panel. */}
          <div className="mt-2 rounded-[var(--radius-panel)] border border-line-faint bg-paper-2/40 p-2">
            <p className="eyebrow mb-1.5">{t("audit.askTitle")}</p>
            <div className="flex flex-wrap items-end gap-2">
              <TextInput className="min-w-[280px] flex-1" value={question} onChange={setQuestion} placeholder={t("audit.askPlaceholder")} onEnter={() => void ask()} />
              <Button size="sm" variant="primary" loading={asking} onClick={() => void ask()}>
                {t("console.audit.run")}
              </Button>
            </div>
            {answer && (
              // `tick` is the existing 200ms slide the reduced-motion block already neutralises: the
              // interpretation arrives rather than materialising under the operator's cursor.
              <div className="tick mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line-faint pt-2">
                <span className="eyebrow">{t("audit.interpreted")}</span>
                {Object.entries(answer.filter)
                  .filter(([, v]) => v !== undefined && v !== null && v !== "")
                  .map(([k, v]) => (
                    <IdTag key={k} tone="steel">
                      {k}: {String(v).slice(0, 32)}
                    </IdTag>
                  ))}
                <IdTag tone="neutral">{t("console.audit.results", { n: n(answer.count) })}</IdTag>
              </div>
            )}
            {askError && (
              <div className="mt-2">
                <ErrorNote message={askError} onRetry={() => void ask()} retryLabel={t("common.retry")} />
              </div>
            )}
            <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-3">{t("audit.askNote")}</p>
          </div>
        </Panel>

        {aside?.error && <ErrorNote message={aside.error} onRetry={aside.reload} retryLabel={t("common.retry")} />}

        {/* An answered question carries its own event set, so it still has something true to show
            even when the background stream is down — the stream note only takes over the table when
            there is nothing else in it. */}
        <Panel title={t("console.audit.title")} meta={streamBlind ? undefined : t("console.audit.results", { n: n(rows.length) })} flush>
          {events.loading && !events.data && !answer ? (
            <Skeleton className="h-96" />
          ) : streamBlind && events.error ? (
            // In place of the results, never beside them: a search that could not run must not be
            // dressed as a search that found nothing.
            <div className="p-3">
              <ErrorNote message={events.error} onRetry={events.reload} retryLabel={t("common.retry")} />
            </div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-12 text-center">
              <span
                aria-hidden
                className="mx-auto mb-2.5 grid h-8 w-8 place-items-center rounded-[var(--radius-pill)] border border-dashed border-line-strong font-mono text-[0.875rem] leading-none text-ink-3"
              >
                ◆
              </span>
              <p className="text-[0.8125rem] text-ink-3">{t("console.activity.empty")}</p>
            </div>
          ) : (
            <DataTable
              minWidth={980}
              cols={[
                { label: t("audit.columns.seq"), width: "64px", align: "right" },
                { label: t("audit.columns.when"), width: "150px" },
                t("audit.columns.event"),
                t("audit.columns.actor"),
                t("audit.columns.asset"),
                t("audit.columns.chain"),
                t("audit.columns.anchor"),
              ]}
            >
              {rows.map((e) => {
                const h = headlineFor(e);
                return (
                  <DataRow key={e.id} onClick={() => open({ kind: "event", id: e.id })} tone={h.verdict === "DENY" ? "bad" : h.verdict === "STEP_UP" ? "warn" : undefined}>
                    {/* A chain sequence is a counter, not a label: right-aligned and tabular, so a
                        gap in the chain shows up as a ragged edge instead of having to be read. */}
                    <DataCell mono muted align="right">
                      {n(e.seq)}
                    </DataCell>
                    <DataCell mono nowrap>
                      {dt(e.createdAt, { dateStyle: "short", timeStyle: "medium" })}
                    </DataCell>
                    <DataCell>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[0.75rem] font-semibold uppercase tracking-[0.07em] text-ink">{t(`console.events.${h.key}`)}</span>
                        <span className="font-mono text-[0.6875rem] text-ink-3">{e.eventType}</span>
                        {h.verdict && <VerdictStamp size="sm" verdict={h.verdict} label={t(`verdict.${h.verdict}`)} />}
                      </span>
                    </DataCell>
                    <DataCell mono>{e.actorDid ? <HashValue value={e.actorDid} chars={7} /> : "—"}</DataCell>
                    <DataCell mono>{e.assetUid ?? "—"}</DataCell>
                    <DataCell mono>
                      <HashValue value={e.chainHash} chars={6} />
                    </DataCell>
                    <DataCell mono nowrap>
                      {e.ledgerTxId ? (
                        <span className="flex items-center gap-1.5">
                          <StateDot tone="good" />
                          <IdTag tone="steel">#{n(e.block ?? 0)}</IdTag>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-ink-3">
                          <StateDot tone="neutral" pulse />
                          {t("audit.notAnchored")}
                        </span>
                      )}
                    </DataCell>
                  </DataRow>
                );
              })}
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}
