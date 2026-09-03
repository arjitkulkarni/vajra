"use client";

/**
 * Devices.
 *
 * Device trust is the signal that moves fastest in a real compromise — a new machine appears, and
 * privileges narrow within one request. Flattening every identity's devices into one table is how
 * an operator spots that appearing.
 */
import { useMemo, useState } from "react";
import { api, type IdentityRow } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { useAsync } from "@/components/trust";
import { useEntity } from "@/components/EntityDrawer";
import { DataCell, DataRow, DataTable, DistributionBar, FilterBar, OpsHeader, Panel, Segmented, StatBand, StateDot, TextInput } from "@/components/console";
import { Button, ErrorNote, HashValue, Skeleton, cx, toneForTrust } from "@/components/ui";

interface DeviceRow {
  id: string;
  label: string | null;
  deviceTrust: number;
  trusted: boolean;
  lastSeen: string;
  owner: IdentityRow;
}

export default function Devices() {
  const { t, dt, n } = useI18n();
  const { open } = useEntity();
  const identities = useAsync(() => api.identities(), []);
  const [term, setTerm] = useState("");
  const [state, setState] = useState("all");

  const devices = useMemo<DeviceRow[]>(
    () => (identities.data ?? []).flatMap((owner) => owner.devices.map((d) => ({ ...d, owner }))),
    [identities.data],
  );

  const bands = useMemo(
    () => ({
      trusted: devices.filter((d) => d.trusted).length,
      newly: devices.filter((d) => !d.trusted && d.deviceTrust >= 40).length,
      blocked: devices.filter((d) => !d.trusted && d.deviceTrust < 40).length,
    }),
    [devices],
  );

  const rows = useMemo(() => {
    const q = term.trim().toLowerCase();
    return devices
      .filter((d) => {
        if (state === "trusted" && !d.trusted) return false;
        if (state === "new" && (d.trusted || d.deviceTrust < 40)) return false;
        if (state === "blocked" && (d.trusted || d.deviceTrust >= 40)) return false;
        if (!q) return true;
        return [d.id, d.label, d.owner.displayName].some((f) => f && f.toLowerCase().includes(q));
      })
      .sort((a, b) => a.deviceTrust - b.deviceTrust);
  }, [devices, term, state]);

  return (
    <>
      <OpsHeader
        title={t("console.identity.devices")}
        meta={<span>{t("trust.device")}</span>}
        actions={
          <Button size="sm" onClick={identities.reload}>
            {t("common.refresh")}
          </Button>
        }
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_280px]">
        <StatBand
          className="rise"
          items={[
            { label: t("console.overview.deviceTrusted"), value: n(bands.trusted), tone: "good" },
            { label: t("console.overview.deviceNew"), value: n(bands.newly), tone: bands.newly > 0 ? "warn" : "neutral" },
            { label: t("console.overview.deviceBlocked"), value: n(bands.blocked), tone: bands.blocked > 0 ? "bad" : "neutral" },
          ]}
        />
        <Panel title={t("trust.device")}>
          <DistributionBar
            segments={[
              { key: "trusted", value: bands.trusted, tone: "good", label: t("console.overview.deviceTrusted") },
              { key: "new", value: bands.newly, tone: "warn", label: t("console.overview.deviceNew") },
              { key: "blocked", value: bands.blocked, tone: "bad", label: t("console.overview.deviceBlocked") },
            ]}
          />
        </Panel>
      </div>

      <FilterBar className="mb-3">
        <TextInput className="min-w-[220px]" label={t("console.audit.searchPlaceholder")} value={term} onChange={setTerm} mono />
        <Segmented
          value={state}
          onChange={setState}
          options={[
            { value: "all", label: t("common.all"), count: devices.length },
            { value: "trusted", label: t("console.overview.deviceTrusted"), count: bands.trusted },
            { value: "new", label: t("console.overview.deviceNew"), count: bands.newly },
            { value: "blocked", label: t("console.overview.deviceBlocked"), count: bands.blocked },
          ]}
        />
      </FilterBar>

      {identities.error && <ErrorNote message={identities.error} onRetry={identities.reload} retryLabel={t("common.retry")} />}
      {identities.loading && !identities.data && <Skeleton className="h-64" />}

      <Panel title={t("console.identity.devices")} meta={`${n(rows.length)} / ${n(devices.length)}`} flush>
        {rows.length === 0 ? (
          <p className="px-3 py-10 text-center text-[0.8125rem] text-ink-3">{t("common.empty")}</p>
        ) : (
          <DataTable
            minWidth={820}
            cols={[
              t("console.identity.cols.device"),
              t("console.identity.cols.owner"),
              t("console.identity.cols.state"),
              { label: t("console.identity.cols.deviceTrust"), align: "right", width: "110px" },
              t("console.identity.lastSeen"),
            ]}
          >
            {rows.map((d) => {
              const tone = toneForTrust(d.deviceTrust);
              return (
                <DataRow key={d.id} onClick={() => open({ kind: "device", id: d.id })} tone={!d.trusted && d.deviceTrust < 40 ? "bad" : !d.trusted ? "warn" : undefined}>
                  <DataCell strong>
                    <span className="flex flex-col items-start">
                      <span>{d.label ?? t("console.entity.device")}</span>
                      <span onClick={(e) => e.stopPropagation()}>
                        <HashValue value={d.id} chars={10} />
                      </span>
                    </span>
                  </DataCell>
                  <DataCell>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        open({ kind: "person", id: d.owner.did });
                      }}
                      className="rounded-[var(--radius-tag)] text-left underline decoration-line-strong decoration-dotted underline-offset-2 transition-[color,text-decoration-color] duration-150 ease-out hover:text-ink hover:decoration-brass active:translate-y-px"
                    >
                      {d.owner.displayName}
                    </button>
                  </DataCell>
                  <DataCell>
                    <span className="flex items-center gap-1.5">
                      <StateDot tone={d.trusted ? "good" : d.deviceTrust >= 40 ? "warn" : "bad"} />
                      {d.trusted ? t("console.overview.deviceTrusted") : d.deviceTrust >= 40 ? t("console.overview.deviceNew") : t("console.overview.deviceBlocked")}
                    </span>
                  </DataCell>
                  <DataCell mono align="right">
                    <span className={cx(tone === "good" ? "text-verdigris" : tone === "warn" ? "text-saffron" : "text-oxide")}>{n(d.deviceTrust)}</span>
                  </DataCell>
                  <DataCell mono nowrap>
                    {dt(d.lastSeen, { dateStyle: "short", timeStyle: "short" })}
                  </DataCell>
                </DataRow>
              );
            })}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
