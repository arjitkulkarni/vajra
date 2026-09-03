"use client";

/** Incident queue. Open first, severity ordered, one click into the investigation. */
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { useConsoleBase } from "@/lib/nav";
import { useAsync } from "@/components/trust";
import { useEntity } from "@/components/EntityDrawer";
import { DataCell, DataRow, DataTable, IdTag, OpsHeader, Panel, Segmented, StatBand, StateDot } from "@/components/console";
import { Chip, ErrorNote, HashValue, Skeleton, type Tone } from "@/components/ui";

const SEVERITY_TONE: Record<string, Tone> = { S1: "steel", S2: "warn", S3: "bad" };

export default function Incidents() {
  const { t, locale, dt, n } = useI18n();
  const base = useConsoleBase();
  const router = useRouter();
  const { open } = useEntity();
  const [status, setStatus] = useState("open");
  const incidents = useAsync(() => api.incidents(), []);

  const all = useMemo(() => incidents.data ?? [], [incidents.data]);
  const counts = useMemo(
    () => ({
      all: all.length,
      open: all.filter((i) => i.status === "open").length,
      resolved: all.filter((i) => i.status === "resolved").length,
      false_positive: all.filter((i) => i.status === "false_positive").length,
    }),
    [all],
  );
  const rows = useMemo(
    () =>
      all
        .filter((i) => status === "all" || i.status === status)
        .sort((a, b) => (a.status === b.status ? b.peakRisk - a.peakRisk : a.status === "open" ? -1 : 1)),
    [all, status],
  );

  return (
    <>
      <OpsHeader title={t("incidents.title")} meta={<span>{t("incidents.subtitle")}</span>} />

      <StatBand
        className="mb-4"
        items={[
          { label: t("console.incident.cols.status"), value: n(counts.open), tone: counts.open > 0 ? "bad" : "good", hint: t("incidents.open") },
          { label: t("incidents.resolved"), value: n(counts.resolved), tone: "good" },
          { label: t("incidents.false_positive"), value: n(counts.false_positive) },
          { label: t("console.incident.peakRisk"), value: n(Math.max(0, ...all.filter((i) => i.status === "open").map((i) => i.peakRisk))), tone: "warn" },
        ]}
      />

      <div className="mb-3">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: "open", label: t("incidents.open"), count: counts.open },
            { value: "resolved", label: t("incidents.resolved"), count: counts.resolved },
            { value: "false_positive", label: t("incidents.false_positive"), count: counts.false_positive },
            { value: "all", label: t("console.incident.statusAll"), count: counts.all },
          ]}
        />
      </div>

      {incidents.error && <ErrorNote message={incidents.error} onRetry={incidents.reload} retryLabel={t("common.retry")} />}

      <Panel title={t("incidents.title")} meta={`${n(rows.length)} / ${n(all.length)}`} flush>
        {incidents.loading && !incidents.data ? (
          <Skeleton className="h-56" />
        ) : rows.length === 0 ? (
          <p className="px-3 py-12 text-center text-[0.8125rem] text-ink-3">{t("console.incident.empty")}</p>
        ) : (
          <DataTable
            minWidth={860}
            cols={[
              { label: t("console.incident.cols.id"), width: "110px" },
              t("console.incident.cols.severity"),
              t("console.incident.cols.status"),
              t("console.incident.cols.summary"),
              t("console.incident.cols.actor"),
              { label: t("console.incident.cols.peak"), align: "right" },
              t("console.incident.cols.opened"),
            ]}
          >
            {rows.map((i) => (
              <DataRow key={i.incidentId} onClick={() => router.push(`${base}/incidents/${i.incidentId}`)} tone={i.status === "open" ? "bad" : undefined}>
                <DataCell mono strong nowrap>
                  {i.incidentId}
                </DataCell>
                <DataCell>
                  <IdTag tone={SEVERITY_TONE[i.severity] ?? "neutral"}>{i.severity}</IdTag>
                </DataCell>
                <DataCell>
                  <span className="flex items-center gap-1.5">
                    <StateDot tone={i.status === "open" ? "bad" : i.status === "false_positive" ? "neutral" : "good"} pulse={i.status === "open"} />
                    {t(`incidents.${i.status}`)}
                  </span>
                </DataCell>
                <DataCell>{i.summary}</DataCell>
                <DataCell mono>
                  <span
                    className="inline-flex max-w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      open({ kind: "person", id: i.actorDid });
                    }}
                  >
                    <HashValue value={i.actorDid} chars={7} />
                  </span>
                </DataCell>
                <DataCell mono align="right">
                  <span className={i.peakRisk >= 60 ? "text-oxide" : i.peakRisk >= 30 ? "text-saffron" : "text-ink-2"}>{n(i.peakRisk)}</span>
                </DataCell>
                <DataCell mono nowrap>
                  {dt(i.openedAt, { dateStyle: "short", timeStyle: "medium" })}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
      </Panel>

      {rows.some((i) => i.status === "open") && (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-field)] border border-line-faint bg-overlay-1 px-3 py-2 text-[0.75rem] leading-relaxed text-ink-3">
          <Chip tone="bad">{t("console.incident.currentState")}</Chip>
          {t("permissions.subtitle")}
        </p>
      )}
    </>
  );
}
