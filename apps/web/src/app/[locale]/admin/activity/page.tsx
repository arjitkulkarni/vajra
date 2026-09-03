"use client";

/**
 * Activity — the unfiltered stream.
 *
 * The overview shows the last forty events; this is where you narrow. Filters are the four things
 * an operator actually asks for (window, kind, person, asset), and every row opens the event drawer
 * rather than navigating away, so a scan does not lose its place.
 */
import { useMemo, useState } from "react";
import { api, type AuditEvent } from "@/lib/api";
import { headlineFor } from "@/lib/events";
import { useI18n } from "@/lib/i18n-client";
import { useAsync } from "@/components/trust";
import { useEntity } from "@/components/EntityDrawer";
import { EventStream, FilterBar, IdTag, LiveClock, OpsHeader, Panel, SelectInput, type StreamEvent } from "@/components/console";
import { Button, ErrorNote, Skeleton } from "@/components/ui";

const KINDS = ["all", "decisions", "assets", "identity", "policy", "incident"] as const;

export default function Activity() {
  const { t, time, n } = useI18n();
  const { open } = useEntity();
  const [hours, setHours] = useState("24");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [actorDid, setActorDid] = useState("");
  const [assetUid, setAssetUid] = useState("");

  const events = useAsync(
    () => api.audit({ sinceHours: hours === "all" ? undefined : hours, actorDid: actorDid || undefined, assetUid: assetUid || undefined, limit: 250 }),
    [hours, actorDid, assetUid],
  );
  const identities = useAsync(() => api.identities(), []);
  const assets = useAsync(() => api.assets(), []);

  // The two lookups exist only to put names on the person and asset filters. If one fails the stream
  // still reads — you just filter by raw DID and UID — so the page degrades rather than stops. What
  // it must not do is degrade quietly: an operator who sees a short filter list has to know the list
  // is short because we could not ask, not because there is nothing there. One note for the first
  // failure, and none at all when the stream itself is down, because that note already says it.
  const lookups = events.error ? null : identities.error ? identities : assets.error ? assets : null;

  const stream = useMemo<StreamEvent[]>(() => {
    const rows: AuditEvent[] = events.data ?? [];
    return rows
      .map((e) => ({ e, h: headlineFor(e) }))
      .filter(({ h }) => kind === "all" || h.kind === kind)
      .map(({ e, h }) => ({
        id: e.id,
        at: e.createdAt,
        headline: t(`console.events.${h.key}`),
        tone: h.tone,
        subject: (
          <>
            {e.assetUid && <IdTag tone="neutral">{e.assetUid}</IdTag>}
            {e.incidentId && (
              <IdTag tone="bad" title={e.incidentId}>
                {e.incidentId}
              </IdTag>
            )}
          </>
        ),
        detail: [
          h.action ? t(`actions.${h.action}`) : null,
          e.actorDid ? e.actorDid.slice(0, 24) + "…" : null,
          h.risk ? `${t("risk.label")} ${n(h.risk.score)} · ${t(`risk.${h.risk.tier}`)}` : null,
          h.policy ? `${h.policy.key} v${h.policy.version}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        trailing: (
          <span className="flex items-center gap-1.5">
            <IdTag tone="neutral">#{n(e.seq)}</IdTag>
            {e.block !== null && <IdTag tone="steel">▮{n(e.block)}</IdTag>}
          </span>
        ),
      }));
  }, [events.data, kind, n, t]);

  return (
    <>
      <OpsHeader
        title={t("console.activity.title")}
        status={<LiveClock />}
        meta={<span>{t("console.activity.subtitle")}</span>}
        actions={
          <Button size="sm" onClick={events.reload}>
            {t("common.refresh")}
          </Button>
        }
      />

      <FilterBar className="mb-3">
        <SelectInput
          label={t("console.activity.filterWindow")}
          value={hours}
          onChange={setHours}
          options={[
            { value: "24", label: t("audit.hours24") },
            { value: "168", label: t("audit.hours168") },
            { value: "all", label: t("audit.hoursAll") },
          ]}
        />
        <SelectInput
          label={t("console.activity.filterKind")}
          value={kind}
          onChange={(v) => setKind(v as (typeof KINDS)[number])}
          options={KINDS.map((k) => ({ value: k, label: t(`console.activity.kinds.${k}`) }))}
        />
        <SelectInput
          label={t("console.activity.filterActor")}
          value={actorDid}
          onChange={setActorDid}
          options={[{ value: "", label: t("common.all") }, ...(identities.data ?? []).map((i) => ({ value: i.did, label: i.displayName }))]}
        />
        <SelectInput
          label={t("console.activity.filterAsset")}
          value={assetUid}
          onChange={setAssetUid}
          options={[{ value: "", label: t("common.all") }, ...(assets.data ?? []).map((a) => ({ value: a.assetUid, label: a.name }))]}
        />
      </FilterBar>

      {lookups?.error && <ErrorNote message={lookups.error} onRetry={lookups.reload} retryLabel={t("common.retry")} />}

      <Panel title={t("console.activity.title")} meta={events.error ? undefined : t("console.activity.count", { n: n(stream.length) })} flush>
        {events.loading && !events.data ? (
          <Skeleton className="h-[520px]" />
        ) : events.error ? (
          // The note sits inside the panel, in place of the stream: a failed load is not an empty
          // window, and an operator must never read "no activity" when the answer is "we could not ask".
          <div className="p-3">
            <ErrorNote message={events.error} onRetry={events.reload} retryLabel={t("common.retry")} />
          </div>
        ) : (
          <EventStream events={stream} time={time} empty={t("console.activity.empty")} onSelect={(e) => open({ kind: "event", id: e.id })} />
        )}
      </Panel>
    </>
  );
}
