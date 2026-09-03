"use client";

/**
 * Security overview — the first screen, and the one that has to say what is happening right now.
 *
 * Not a grid of capability cards: one band of figures, a live event stream on the left, the current
 * distribution of trust on the right, and the assets that need someone to look at them underneath.
 * Everything on this page is a link into an investigation.
 */
import Link from "next/link";
import { useMemo } from "react";
import { api, type AssetSummary } from "@/lib/api";
import { denialReasons, headlineFor, outcomeCounts } from "@/lib/events";
import { useI18n } from "@/lib/i18n-client";
import { linkable, useConsoleArea, useConsoleBase } from "@/lib/nav";
import { useAsync } from "@/components/trust";
import { useEntity } from "@/components/EntityDrawer";
import {
  DataCell,
  DataRow,
  DataTable,
  DistributionBar,
  EventStream,
  IdTag,
  KeyValues,
  OpsHeader,
  Panel,
  StatBand,
  StateDot,
  type StreamEvent,
} from "@/components/console";
import { Button, Chip, ErrorNote, Icon, Skeleton, cx, toneForTrust } from "@/components/ui";

const ATTENTION_THRESHOLD = 75;

/** A figure nobody could fetch is a dash, never a zero — the shell writes an unknown health the
 *  same way. "0 pending approvals" when the request never landed is the one lie this screen
 *  exists to prevent. */
const UNKNOWN = "—";

/**
 * A panel whose feed is dark says so where its figures would have been, in place of the empty state
 * it would otherwise have shown. The loud banner with the retry is rendered ONCE at the top of the
 * page — an expired session or a closed console gate takes every load down together, and seven red
 * slabs would bury the one line the operator has to read.
 */
function PanelError({ message, className }: { message: string; className?: string }) {
  return (
    <p className={cx("flex items-start gap-2 text-[0.8125rem] leading-snug text-oxide", className)}>
      {Icon.warn} {message}
    </p>
  );
}

export default function Overview() {
  const { t, locale, time, dt, n } = useI18n();
  const { open } = useEntity();
  const area = useConsoleArea();
  const base = useConsoleBase();

  // Nothing here swallows a rejection. A 401, a 403 from the console gate, a 500 or a dropped
  // connection reaches useAsync and becomes an `error` we render — an empty panel on this screen
  // now means the registry is genuinely empty, which is the only reading an administrator can act
  // on. It used to mean "we could not ask", and looked identical.
  const stats = useAsync(() => api.stats(), []);
  const health = useAsync(() => api.health(), []);
  const events = useAsync(() => api.audit({ sinceHours: 24, limit: 120 }), []);
  const assets = useAsync(() => api.assets(), []);
  const identities = useAsync(() => api.identities(), []);
  const incidents = useAsync(() => api.incidents(), []);
  const approvals = useAsync(() => api.approvals(), []);

  const reloadAll = () => {
    stats.reload();
    health.reload();
    events.reload();
    assets.reload();
    identities.reload();
    incidents.reload();
    approvals.reload();
  };

  /** These fail as a class far more often than they fail alone, so the page carries one banner. */
  const loadError = stats.error ?? health.error ?? events.error ?? assets.error ?? identities.error ?? incidents.error ?? approvals.error;

  const outcomes = useMemo(() => outcomeCounts(events.data ?? []), [events.data]);
  const denials = useMemo(() => denialReasons(events.data ?? []), [events.data]);

  const stream = useMemo<StreamEvent[]>(
    () =>
      (events.data ?? []).slice(0, 40).map((e) => {
        const h = headlineFor(e);
        return {
          id: e.id,
          at: e.createdAt,
          headline: t(`console.events.${h.key}`),
          tone: h.tone,
          subject: e.assetUid ? <IdTag tone="neutral">{e.assetUid}</IdTag> : undefined,
          detail: [
            h.action ? t(`actions.${h.action}`) : null,
            h.risk ? `${t("risk.label")} ${n(h.risk.score)}` : null,
            h.policy ? `${h.policy.key} v${h.policy.version}` : null,
            ...h.signals.slice(0, 2).map((s) => t(`risk.signals.${s}`)),
          ]
            .filter(Boolean)
            .join(" · "),
          trailing: e.block !== null ? <IdTag tone="steel">#{n(e.block)}</IdTag> : undefined,
        };
      }),
    [events.data, n, t],
  );

  // Trust distribution across the registry — the single number that answers "are we alright?".
  const trustBands = useMemo(() => {
    const list = assets.data ?? [];
    const healthy = list.filter((a) => a.assetTrust >= 75).length;
    const watch = list.filter((a) => a.assetTrust >= 45 && a.assetTrust < 75).length;
    const restricted = list.filter((a) => a.assetTrust < 45).length;
    return { healthy, watch, restricted, total: list.length };
  }, [assets.data]);

  const identityBands = useMemo(() => {
    const list = identities.data ?? [];
    const trusted = list.filter((i) => i.status === "active" && i.identityTrust >= 65).length;
    const degraded = list.filter((i) => i.status === "active" && i.identityTrust < 65).length;
    const revoked = list.filter((i) => i.status !== "active").length;
    const devices = list.flatMap((i) => i.devices);
    return {
      trusted,
      degraded,
      revoked,
      deviceTrusted: devices.filter((d) => d.trusted).length,
      deviceNew: devices.filter((d) => !d.trusted && d.deviceTrust >= 40).length,
      deviceBlocked: devices.filter((d) => !d.trusted && d.deviceTrust < 40).length,
    };
  }, [identities.data]);

  /** An asset earns a place here for a reason we can name, not because its number is small. */
  const attention = useMemo(() => {
    const byAsset = new Map<string, { denied: number; newDevice: boolean; incident: boolean }>();
    for (const e of events.data ?? []) {
      if (!e.assetUid) continue;
      const entry = byAsset.get(e.assetUid) ?? { denied: 0, newDevice: false, incident: false };
      const h = headlineFor(e);
      if (h.verdict === "DENY") entry.denied += 1;
      if (h.signals.includes("new_device")) entry.newDevice = true;
      if (e.incidentId) entry.incident = true;
      byAsset.set(e.assetUid, entry);
    }
    return (assets.data ?? [])
      .map((a) => {
        const signals = byAsset.get(a.assetUid);
        const reason = signals?.incident
          ? "incident"
          : (signals?.denied ?? 0) > 0
            ? "denied"
            : signals?.newDevice
              ? "newDevice"
              : a.assetTrust < ATTENTION_THRESHOLD
                ? "lowTrust"
                : null;
        return reason ? { asset: a, reason } : null;
      })
      .filter((row): row is { asset: AssetSummary; reason: string } => row !== null)
      .sort((a, b) => a.asset.assetTrust - b.asset.assetTrust)
      .slice(0, 8);
  }, [assets.data, events.data]);

  const s = stats.data;
  // Two panels read from more than one load; either one going dark makes the whole panel unsafe.
  const attentionError = assets.error ?? events.error;
  const postureError = stats.error ?? assets.error ?? identities.error ?? events.error;
  const openIncidents = (incidents.data ?? []).filter((i) => i.status === "open");
  const pendingApprovals = (approvals.data?.inbox ?? []).filter((a) => a.status === "pending").length;
  const trustedPct = trustBands.total > 0 ? Math.round((trustBands.healthy / trustBands.total) * 1000) / 10 : 0;
  const downDeps = Object.values(health.data?.deps ?? {}).filter((d) => !d?.ok).length;

  return (
    <>
      <OpsHeader
        title={t("console.overview.title")}
        status={
          // No health answer, no claim: a green "operational" chip drawn from a failed probe is the
          // same lie as an empty panel drawn from a failed load.
          health.data ? (
            <Chip tone="neutral" icon={<StateDot tone={downDeps === 0 ? "good" : "bad"} pulse={downDeps > 0} />}>
              {downDeps === 0 ? t("console.overview.operational") : downDeps === 1 ? t("console.overview.degraded", { n: downDeps }) : t("console.overview.degradedMany", { n: downDeps })}
            </Chip>
          ) : null
        }
        meta={
          <>
            <span>{t("console.shell.environment")}</span>
            <span>·</span>
            <span>{t("console.overview.today")}</span>
            {health.data && <span className="tnum font-mono">{t("console.overview.updated", { time: time(health.data.time) })}</span>}
          </>
        }
        actions={
          <Button size="sm" onClick={reloadAll}>
            {t("common.refresh")}
          </Button>
        }
      />

      {loadError && (
        <div className="mb-4">
          <ErrorNote message={loadError} onRetry={reloadAll} retryLabel={t("common.retry")} />
        </div>
      )}

      {/* Every figure here is a dash when its own feed failed, and drops to neutral with it: a green
          "0 incidents" or a quiet "0 approvals" computed from a rejected request is precisely the
          reassurance an administrator would act on and should not have been given. */}
      <StatBand
        className="rise mb-4"
        items={[
          { label: t("console.overview.stats.requests"), value: stats.error ? UNKNOWN : n(s?.decisions24h ?? 0) },
          { label: t("console.overview.stats.denied"), value: stats.error ? UNKNOWN : n(s?.denied24h ?? 0), tone: !stats.error && (s?.denied24h ?? 0) > 0 ? "bad" : "neutral" },
          { label: t("console.overview.stats.stepUp"), value: events.error ? UNKNOWN : n(outcomes.stepUp), tone: !events.error && outcomes.stepUp > 0 ? "warn" : "neutral" },
          {
            label: t("console.overview.stats.incidents"),
            value: incidents.error ? UNKNOWN : n(openIncidents.length),
            tone: incidents.error ? "neutral" : openIncidents.length > 0 ? "bad" : "good",
          },
          { label: t("console.overview.stats.approvals"), value: approvals.error ? UNKNOWN : n(pendingApprovals), tone: !approvals.error && pendingApprovals > 0 ? "steel" : "neutral" },
          {
            label: t("console.overview.stats.assetsTrusted"),
            value: assets.error ? UNKNOWN : `${n(trustedPct, { maximumFractionDigits: 1 })}%`,
            tone: assets.error ? "neutral" : trustedPct >= 90 ? "good" : trustedPct >= 70 ? "warn" : "bad",
            hint: assets.error ? undefined : `${n(trustBands.healthy)} / ${n(trustBands.total)}`,
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel
          title={t("console.overview.liveActivity")}
          meta={events.data ? t("console.activity.count", { n: n(events.data.length) }) : undefined}
          actions={
            <Link
              href={`${base}/activity`}
              className="rounded-[var(--radius-tag)] text-[0.75rem] font-medium text-brass transition-colors duration-150 ease-out hover:text-brass-deep active:translate-y-px"
            >
              {t("console.overview.viewAll")} {Icon.arrow}
            </Link>
          }
          flush
        >
          {events.error ? (
            <PanelError message={events.error} className="justify-center px-3 py-6 text-center" />
          ) : events.loading && !events.data ? (
            <Skeleton className="h-[420px]" />
          ) : (
            <EventStream events={stream} time={time} empty={t("console.overview.liveEmpty")} onSelect={(e) => open({ kind: "event", id: e.id })} />
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title={t("console.overview.trustDistribution")}>
            {assets.error ? (
              <PanelError message={assets.error} />
            ) : assets.loading && !assets.data ? (
              <Skeleton className="h-24" />
            ) : (
              <DistributionBar
                segments={[
                  { key: "healthy", value: trustBands.healthy, tone: "good", label: t("console.overview.healthy") },
                  { key: "watch", value: trustBands.watch, tone: "warn", label: t("console.overview.watch") },
                  { key: "restricted", value: trustBands.restricted, tone: "bad", label: t("console.overview.restricted") },
                ]}
              />
            )}
          </Panel>

          {/* Both panels are cuts of the one identities load, so both go dark together — a zeroed
              device count reads as "no unknown devices", which is the opposite of what we know. */}
          <Panel title={t("console.overview.identities")}>
            {identities.error ? (
              <PanelError message={identities.error} />
            ) : (
              <KeyValues
                items={[
                  { k: t("console.overview.identityTrusted"), v: n(identityBands.trusted), mono: true },
                  { k: t("console.overview.identityDegraded"), v: n(identityBands.degraded), mono: true },
                  { k: t("console.overview.identityRevoked"), v: n(identityBands.revoked), mono: true },
                ]}
              />
            )}
          </Panel>

          <Panel title={t("console.overview.devices")}>
            {identities.error ? (
              <PanelError message={identities.error} />
            ) : (
              <KeyValues
                items={[
                  { k: t("console.overview.deviceTrusted"), v: n(identityBands.deviceTrusted), mono: true },
                  { k: t("console.overview.deviceNew"), v: n(identityBands.deviceNew), mono: true },
                  { k: t("console.overview.deviceBlocked"), v: n(identityBands.deviceBlocked), mono: true },
                ]}
              />
            )}
          </Panel>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel title={t("console.overview.attention")} flush>
          {attentionError ? (
            // "Nothing needs you" is the single most dangerous sentence on this page to say wrongly.
            <PanelError message={attentionError} className="justify-center px-3 py-6 text-center" />
          ) : attention.length === 0 ? (
            <p className="px-3 py-6 text-center text-[0.8125rem] text-ink-3">{t("console.overview.attentionEmpty")}</p>
          ) : (
            <DataTable
              minWidth={480}
              cols={[t("console.overview.attentionCols.asset"), { label: t("console.overview.attentionCols.trust"), align: "right", width: "80px" }, t("console.overview.attentionCols.reason")]}
            >
              {attention.map(({ asset, reason }) => (
                <DataRow key={asset.assetUid} onClick={() => open({ kind: "asset", id: asset.assetUid })} tone={reason === "incident" ? "bad" : undefined}>
                  <DataCell strong>
                    {asset.name}
                    <span className="ml-2 font-mono text-[0.6875rem] text-ink-3">{asset.assetUid}</span>
                  </DataCell>
                  <DataCell mono align="right">
                    <span className={cx(toneForTrust(asset.assetTrust) === "good" ? "text-verdigris" : toneForTrust(asset.assetTrust) === "warn" ? "text-saffron" : "text-oxide")}>
                      {n(asset.assetTrust)}
                    </span>
                  </DataCell>
                  <DataCell>{t(`console.overview.reasons.${reason}`)}</DataCell>
                </DataRow>
              ))}
            </DataTable>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title={t("console.overview.accessControl")}>
            {events.error ? (
              <PanelError message={events.error} />
            ) : (
              <DistributionBar
                segments={[
                  { key: "allowed", value: outcomes.allowed, tone: "good", label: t("console.overview.outcomes.allowed") },
                  { key: "stepUp", value: outcomes.stepUp, tone: "warn", label: t("console.overview.outcomes.stepUp") },
                  { key: "pending", value: outcomes.pending, tone: "steel", label: t("console.overview.outcomes.pending") },
                  { key: "denied", value: outcomes.denied, tone: "bad", label: t("console.overview.outcomes.denied") },
                ]}
              />
            )}
          </Panel>

          <Panel title={t("console.overview.topDenials")}>
            {events.error ? (
              <PanelError message={events.error} />
            ) : denials.length === 0 ? (
              <p className="py-2 text-[0.8125rem] text-ink-3">{t("console.overview.noDenials")}</p>
            ) : (
              <ul className="space-y-1.5">
                {denials.slice(0, 5).map(({ reason, count }) => {
                  const total = denials.reduce((sum, d) => sum + d.count, 0) || 1;
                  const label = t(`console.overview.denialReasons.${reason}`);
                  return (
                    <li key={reason}>
                      <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
                        <span className="truncate text-ink-2">{label.startsWith("console.") ? reason : label}</span>
                        <span className="tnum shrink-0 font-mono text-[0.75rem] text-ink">{Math.round((count / total) * 100)}%</span>
                      </div>
                      <div className="mt-1 h-[3px] w-full overflow-hidden rounded-[var(--radius-pill)] bg-paper-3">
                        <div
                          className="h-full w-full origin-left rounded-[var(--radius-pill)] bg-oxide transition-transform duration-300 ease-out-soft"
                          style={{ transform: `scaleX(${count / total})` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title={t("console.overview.posture")}>
            {postureError ? (
              // Posture is four loads averaged into percentages that default to 100%, and the chain
              // line asserts a broken ledger from a stats object we never received. Both claims are
              // unsupportable the moment any one feed is dark, so the panel makes neither.
              <PanelError message={postureError} />
            ) : (
              <>
                <KeyValues
                  items={[
                    {
                      k: t("console.overview.postureItems.identityAssurance"),
                      v: `${n(identityBands.trusted + identityBands.degraded > 0 ? Math.round((identityBands.trusted / (identityBands.trusted + identityBands.degraded)) * 100) : 100)}%`,
                      mono: true,
                    },
                    { k: t("console.overview.postureItems.assetIntegrity"), v: `${n(trustBands.total > 0 ? Math.round((trustBands.healthy / trustBands.total) * 100) : 100)}%`, mono: true },
                    {
                      k: t("console.overview.postureItems.anchored"),
                      v: `${n(s && s.auditEvents > 0 ? Math.round((s.anchoredEvents / s.auditEvents) * 100) : 0)}%`,
                      mono: true,
                    },
                    { k: t("console.overview.postureItems.sensitiveVerified"), v: `${n(outcomes.total > 0 ? 100 : 0)}%`, mono: true },
                  ]}
                />
                <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5 border-t border-line pt-2 text-[0.75rem] text-ink-3">
                  <span className={cx("font-medium", s?.chainIntact ? "text-verdigris" : "text-oxide")}>
                    {s?.chainIntact ? `✓ ${t("dashboard.chainIntact")}` : `✗ ${t("dashboard.chainBroken")}`}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="tnum font-mono">
                    {n(s?.ledgerBlocks ?? 0)} {t("dashboard.stats.blocks").toLowerCase()}
                  </span>
                </p>
              </>
            )}
          </Panel>
        </div>
      </div>

      <p className="mt-4 text-[0.75rem] text-ink-3">
        {dt(new Date(), { dateStyle: "full" })}
        {linkable(area, "/system") && (
          <>
            {" · "}
            <Link
              href={`${base}/system`}
              className="rounded-[var(--radius-tag)] font-medium text-brass transition-colors duration-150 ease-out hover:text-brass-deep active:translate-y-px"
            >
              {t("console.shell.items.health")} {Icon.arrow}
            </Link>
          </>
        )}
      </p>
    </>
  );
}
