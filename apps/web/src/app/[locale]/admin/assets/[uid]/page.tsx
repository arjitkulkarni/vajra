"use client";

/**
 * Asset passport — the flagship record.
 *
 * Not a file-details page. This is the asset's identity document: who made it, who holds it now,
 * what it descends from, everything anyone has ever done to it, and the score that follows from
 * all of that. The score is never presented as an oracle — "Why?" opens the arithmetic.
 */
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { api, type CustodyEvent } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { useConsoleBase } from "@/lib/nav";
import { AnalystNote, LedgerStrip, TrustGraph, useAsync } from "@/components/trust";
import { useEntity } from "@/components/EntityDrawer";
import {
  DataCell,
  DataRow,
  DataTable,
  Drawer,
  FactorBreakdown,
  IdTag,
  KeyValues,
  LineageRail,
  OpsHeader,
  Panel,
  ScoreHead,
  StateDot,
  VerdictStamp,
  WhyButton,
  type Factor,
  type LineageNode,
} from "@/components/console";
import { Button, Chip, ErrorNote, HashValue, Icon, Skeleton, Tabs, cx, toneForTrust } from "@/components/ui";

const TABS = ["overview", "lineage", "custody", "access", "evidence"] as const;

export default function AssetPassport({ params }: { params: Promise<{ uid: string; locale: string }> }) {
  const { uid } = use(params);
  const { t, locale, dt, time, n, bytes } = useI18n();
  const base = useConsoleBase();
  const { open } = useEntity();
  const [tab, setTab] = useState<(typeof TABS)[number]>("overview");
  const [why, setWhy] = useState(false);
  const [node, setNode] = useState<string | null>(null);
  const [showGraph, setShowGraph] = useState(false);

  const passport = useAsync(() => api.passport(uid), [uid]);
  const custody = useAsync(() => (tab === "custody" || tab === "access" ? api.custody(uid) : Promise.resolve(null)), [uid, tab]);
  const graph = useAsync(() => (showGraph ? api.graph(uid) : Promise.resolve(null)), [uid, showGraph]);

  const p = passport.data;

  /** Versions form the spine; derivatives and copies branch off the version they were taken from. */
  const lineage = useMemo(() => {
    if (!p) return { spine: [] as LineageNode[], branches: {} as Record<string, LineageNode[]> };
    const spine: LineageNode[] = [...p.versions]
      .sort((a, b) => a.version - b.version)
      .map((v) => ({
        id: `v${v.version}`,
        label: `${p.assetUid} · v${v.version}`,
        sub: `${dt(v.createdAt, { dateStyle: "short", timeStyle: "short" })} · ${v.sha256.slice(0, 10)}…`,
        kind: v.version === p.currentVersion ? "current" : "ancestor",
      }));
    // Children hang off the newest version: that is the one they were derived from.
    const branches: Record<string, LineageNode[]> = {};
    const anchor = spine.length > 0 ? spine[spine.length - 1]!.id : "";
    if (anchor && p.lineage.children.length > 0) {
      branches[anchor] = p.lineage.children.map((c) => ({
        id: c.assetUid,
        label: c.name,
        sub: `${c.assetUid} · ${t(`sensitivity.${c.sensitivity}`)}`,
        kind: "descendant",
      }));
    }
    return { spine, branches };
  }, [p, dt, t]);

  const selectedVersion = useMemo(() => {
    if (!p || !node?.startsWith("v")) return null;
    return p.versions.find((v) => `v${v.version}` === node) ?? null;
  }, [p, node]);

  /** The score, expanded into the evidence behind each component. */
  const factors = useMemo<Factor[]>(() => {
    if (!p) return [];
    return p.trust.breakdown.map((b) => {
      const notes: Factor["notes"] = [];
      switch (b.key) {
        case "origin":
          notes.push({ ok: p.verification.origin, text: p.verification.origin ? t("console.passport.originOk") : t("console.passport.originBad") });
          notes.push({ ok: !!p.ledger.latestTxId, text: p.ledger.latestTxId ? t("console.passport.mintAnchored") : t("passport.notAnchoredYet") });
          break;
        case "owner":
          notes.push({ ok: p.verification.ownership, text: p.verification.ownership ? t("console.passport.ownerOk") : t("console.passport.ownerBad") });
          notes.push({ ok: p.transfers.every((tr) => tr.approverDid !== null) ? true : "warn", text: t("console.passport.transferChain", { n: n(p.transfers.length) }) });
          break;
        case "versions":
          notes.push({ ok: true, text: t("console.passport.versionsAnchored", { n: n(p.versions.length) }) });
          notes.push({ ok: p.verification.integrity, text: p.verification.integrity ? t("console.passport.noGaps") : t("console.passport.hashGap") });
          break;
        case "access":
          notes.push({ ok: b.points === b.max ? true : "warn", text: t("console.passport.accessNote", { n: n(p.stats.accessEvents) }) });
          if (p.stats.incidents30d > 0) notes.push({ ok: false, text: t("console.passport.incidentNote", { n: n(p.stats.incidents30d) }) });
          break;
        case "devices":
          notes.push({ ok: b.points === b.max ? true : "warn", text: t("console.passport.deviceNote") });
          break;
        case "approvals":
          notes.push({ ok: b.points === b.max, text: t("console.passport.approvalNote", { n: n(p.stats.approvals) }) });
          break;
        case "integrity":
          notes.push({ ok: p.verification.integrity, text: p.verification.integrity ? t("console.passport.integrityOk") : t("console.passport.integrityBad") });
          break;
      }
      return { key: b.key, label: t(`trust.components.${b.key}`), points: b.points, max: b.max, notes };
    });
  }, [p, n, t]);

  const accessEvents = useMemo(() => (custody.data ?? []).filter((c: CustodyEvent) => c.decision !== null), [custody.data]);

  if (passport.error) return <ErrorNote message={passport.error} onRetry={passport.reload} retryLabel={t("common.retry")} />;
  if (!p) return <Skeleton className="h-96" />;

  const trustTone = toneForTrust(p.trust.score);

  return (
    <>
      <div className="mb-2">
        <Link
          href={`${base}/vault`}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-tag)] text-[0.75rem] text-ink-3 transition-colors duration-150 ease-out hover:text-ink"
        >
          <span aria-hidden>←</span>
          {t("console.passport.backToRegistry")}
        </Link>
      </div>

      <OpsHeader
        title={p.name}
        id={<IdTag tone="brass">{p.assetUid}</IdTag>}
        status={
          <Chip tone={p.sensitivity === "high" ? "bad" : p.sensitivity === "medium" ? "warn" : "neutral"}>
            {t(`sensitivity.${p.sensitivity}`)} {t("vault.columns.sensitivity").toLowerCase()}
          </Chip>
        }
        meta={
          <>
            <span>{t(`assetClass.${p.class}`)}</span>
            <span>·</span>
            <span className="tnum font-mono">v{n(p.currentVersion)}</span>
            <span>·</span>
            <span>{t("passport.owner")}: {p.owner.displayName ?? "—"}</span>
          </>
        }
        actions={
          <>
            {/* The score readout is an instrument housing, not a card: panel radius, hairline over
                an overlay wash, no shadow — it rests on the ground, it does not float. */}
            <div className="flex items-center gap-2.5 rounded-[var(--radius-panel)] border border-line bg-overlay-1 px-3 py-1.5">
              <span className="eyebrow">{t("trust.asset")}</span>
              <span
                className={cx(
                  "font-display text-[1.5rem] font-semibold leading-none tracking-[-0.015em] tnum",
                  trustTone === "good" ? "text-verdigris" : trustTone === "warn" ? "text-saffron" : "text-oxide",
                )}
              >
                {n(p.trust.score)}
              </span>
              <WhyButton label={t("console.why.open", { score: n(p.trust.score) })} onClick={() => setWhy(true)} />
            </div>
            <Link href={`${base}/access?asset=${encodeURIComponent(p.assetUid)}`}>
              <Button size="sm" variant="primary">
                {t("access.submit")}
              </Button>
            </Link>
          </>
        }
      />

      {/* The assurance strip: four claims, each either verified or not. Hairline dividers rather
          than a gap over a border colour — one surface, ruled, the way StatBand is built. Each
          claim carries a disc, a glyph and a word, so none of the three is doing the work alone. */}
      <div className="mb-4 grid divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-paper sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        {[
          { key: "integrity", ok: p.verification.integrity, label: t("passport.integrity") },
          { key: "ownership", ok: p.verification.ownership, label: t("passport.ownership") },
          { key: "origin", ok: p.verification.origin, label: t("passport.origin") },
        ].map((row) => (
          <div key={row.key} className="flex items-center gap-2 px-3 py-2">
            <StateDot tone={row.ok ? "good" : "warn"} />
            <span className="text-[0.8125rem] text-ink-2">{row.label}</span>
            <span className={cx("ml-auto flex items-center gap-1 text-[0.75rem] font-semibold uppercase tracking-[0.06em]", row.ok ? "text-verdigris" : "text-saffron")}>
              {row.ok ? Icon.check : Icon.warn}
              {row.ok ? t("passport.verified") : t("passport.unverified")}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2 px-3 py-2">
          <StateDot tone="steel" />
          <span className="text-[0.8125rem] text-ink-2">{t("console.passport.provenance")}</span>
          <span className="tnum ml-auto font-mono text-[0.75rem] text-ink">
            {t("console.passport.hops", { n: n(p.versions.length + p.lineage.children.length + (p.lineage.parent ? 1 : 0)) })}
          </span>
        </div>
      </div>

      <Tabs tabs={TABS.map((id) => ({ id, label: t(`console.passport.tabs.${id}`) }))} active={tab} onChange={(id) => setTab(id as (typeof TABS)[number])} />

      {/* Keyed on the tab, so switching tabs re-runs the springy entrance. `.rise` is transform and
          opacity only and is already neutralised by the global reduced-motion block. */}
      <div key={tab} className="rise mt-4">
        {tab === "overview" && (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              <Panel title={t("console.passport.identity")}>
                <KeyValues
                  columns={2}
                  items={[
                    { k: t("passport.owner"), v: p.owner.displayName ?? "—" },
                    { k: t("passport.creator"), v: p.creator.displayName ?? "—" },
                    { k: t("passport.created"), v: dt(p.createdAt, { dateStyle: "medium", timeStyle: "short" }), mono: true },
                    { k: t("passport.currentVersion"), v: `v${n(p.currentVersion)}`, mono: true },
                    { k: t("passport.accessEvents"), v: n(p.stats.accessEvents), mono: true },
                    { k: t("passport.lastAccess"), v: p.stats.lastAccess ? dt(p.stats.lastAccess, { dateStyle: "short", timeStyle: "short" }) : t("common.never"), mono: true },
                    { k: t("passport.approvals"), v: n(p.stats.approvals), mono: true },
                    { k: t("passport.incidents"), v: n(p.stats.incidents30d), mono: true },
                  ]}
                />
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                  <HashValue value={p.owner.did} label={t("passport.owner")} chars={8} />
                  <HashValue value={p.creator.did} label={t("passport.creator")} chars={8} />
                  <span className="ml-auto">
                    <LedgerStrip txId={p.ledger.latestTxId} block={p.ledger.latestBlock} pendingLabel={t("passport.notAnchoredYet")} />
                  </span>
                </div>
              </Panel>

              {Object.keys(p.passportMeta).length > 0 && (
                <Panel title={p.class === "model" ? t("assetClass.model") : t("passport.title")}>
                  <KeyValues columns={2} items={Object.entries(p.passportMeta).map(([k, v]) => ({ k, v, mono: true }))} />
                </Panel>
              )}

              <AnalystNote kind="passport" id={p.assetUid} label={t("passport.explainThis")} />
            </div>

            <div className="space-y-4">
              <Panel title={t("console.why.assetTrust")} actions={<WhyButton label={t("console.why.openPlain")} onClick={() => setWhy(true)} />}>
                <p className="mb-3 flex items-baseline gap-2">
                  <span
                    className={cx(
                      "font-display text-[2.25rem] font-semibold leading-none tracking-[-0.025em] tnum",
                      trustTone === "good" ? "text-verdigris" : trustTone === "warn" ? "text-saffron" : "text-oxide",
                    )}
                  >
                    {n(p.trust.score)}
                  </span>
                  <span className="tnum font-mono text-[0.8125rem] text-ink-3">/ 100</span>
                </p>
                <FactorBreakdown n={n} factors={p.trust.breakdown.map((b) => ({ key: b.key, label: t(`trust.components.${b.key}`), points: b.points, max: b.max }))} />
                <p className="mt-3 border-t border-line pt-2 text-[0.75rem] text-ink-3">{t("console.why.basis")}</p>
              </Panel>

              <Panel title={t("passport.riskStatus")}>
                <div className="flex items-center gap-2">
                  <StateDot tone={p.stats.riskStatus === "high" ? "bad" : p.stats.riskStatus === "elevated" ? "warn" : "good"} />
                  <span className="text-[0.875rem] text-ink">{t(`risk.${p.stats.riskStatus}`)}</span>
                </div>
              </Panel>
            </div>
          </div>
        )}

        {tab === "lineage" && (
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <Panel title={t("console.passport.lineageTitle")} meta={t("console.passport.lineageHint")}>
              {p.lineage.parent && (
                <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-3">
                  <span className="eyebrow">{t("passport.lineageParent")}</span>
                  <Link
                    href={`${base}/assets/${encodeURIComponent(p.lineage.parent.assetUid)}`}
                    className="rounded-[var(--radius-tag)] font-mono text-[0.8125rem] text-brass transition-colors duration-150 ease-out hover:text-brass-deep"
                  >
                    {p.lineage.parent.name} · {p.lineage.parent.assetUid}
                  </Link>
                  <Chip tone={p.lineage.derivativeStatus === "unauthorised" ? "bad" : "good"}>
                    {p.lineage.derivativeStatus === "unauthorised" ? t("passport.derivativeUnauthorised") : t("passport.derivativeAuthorised")}
                  </Chip>
                </div>
              )}
              <p className="eyebrow mb-2">{t("console.passport.origin")}</p>
              <LineageRail
                spine={lineage.spine}
                branches={lineage.branches}
                selected={node ?? undefined}
                onSelect={(sel) => {
                  if (sel.kind === "descendant") open({ kind: "asset", id: sel.id });
                  else setNode(sel.id);
                }}
              />
              <div className="mt-4 border-t border-line pt-3">
                <Button size="sm" variant={showGraph ? "secondary" : "ghost"} onClick={() => setShowGraph((v) => !v)}>
                  {t("console.passport.openGraph")}
                </Button>
                <p className="mt-1.5 text-[0.75rem] text-ink-3">{t("console.passport.graphHint")}</p>
                {showGraph &&
                  (graph.loading ? (
                    <Skeleton className="mt-3 h-[420px]" />
                  ) : (
                    graph.data && (
                      <div className="rise mt-3">
                        <TrustGraph data={graph.data} />
                      </div>
                    )
                  ))}
              </div>
            </Panel>

            <Panel title={selectedVersion ? t("console.passport.versionDetail", { n: n(selectedVersion.version) }) : t("passport.tabs.versions")}>
              {!selectedVersion ? (
                <p className="py-4 text-[0.8125rem] text-ink-3">{t("console.passport.selectNode")}</p>
              ) : (
                <div className="space-y-3">
                  <KeyValues
                    items={[
                      { k: t("passport.versionColumns.sha"), v: <HashValue value={selectedVersion.sha256} chars={10} />, mono: true },
                      { k: t("passport.versionColumns.size"), v: bytes(selectedVersion.sizeBytes), mono: true },
                      { k: t("passport.versionColumns.at"), v: dt(selectedVersion.createdAt, { dateStyle: "short", timeStyle: "medium" }), mono: true },
                      { k: t("passport.creator"), v: <HashValue value={selectedVersion.createdBy} chars={8} />, mono: true },
                      { k: t("passport.lineageParent"), v: selectedVersion.parentSha256 ? <HashValue value={selectedVersion.parentSha256} chars={8} /> : "—", mono: true },
                      { k: t("passport.versionColumns.status"), v: selectedVersion.status, mono: true },
                    ]}
                  />
                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <Chip tone={selectedVersion.status === "anchored" ? "good" : "warn"}>
                      {selectedVersion.status === "anchored" ? `✓ ${t("passport.integrity")}` : `⚠ ${t("passport.notAnchoredYet")}`}
                    </Chip>
                    <LedgerStrip txId={selectedVersion.ledgerTxId} block={selectedVersion.block} pendingLabel={t("passport.notAnchoredYet")} />
                  </div>
                  <HashValue value={selectedVersion.cid} label="cid" chars={10} />
                </div>
              )}
            </Panel>
          </div>
        )}

        {tab === "custody" && (
          <Panel title={t("passport.tabs.custody")} meta={t("passport.custodyBody")} flush>
            {custody.loading && !custody.data ? (
              <Skeleton className="h-72" />
            ) : (
              <DataTable
                minWidth={900}
                cols={[
                  { label: t("passport.custodyColumns.when"), width: "150px" },
                  t("passport.custodyColumns.who"),
                  t("passport.custodyColumns.what"),
                  t("passport.custodyColumns.decision"),
                  t("passport.custodyColumns.policy"),
                  { label: t("passport.custodyColumns.risk"), align: "right" },
                  t("passport.custodyColumns.proof"),
                ]}
              >
                {(custody.data ?? []).map((c) => (
                  <DataRow key={c.seq} tone={c.decision === "DENY" ? "bad" : undefined}>
                    <DataCell mono nowrap>
                      {dt(c.at, { dateStyle: "short", timeStyle: "medium" })}
                    </DataCell>
                    <DataCell>
                      {c.who ? (
                        <button
                          type="button"
                          onClick={() => c.who && open({ kind: "person", id: c.who.did })}
                          className="rounded-[var(--radius-tag)] underline decoration-line-strong decoration-dotted underline-offset-2 transition-[color,text-decoration-color] duration-150 ease-out hover:text-brass-deep hover:decoration-brass active:translate-y-px"
                        >
                          {c.who.displayName ?? c.who.did.slice(0, 14)}
                        </button>
                      ) : (
                        "—"
                      )}
                    </DataCell>
                    <DataCell strong>{c.action ? t(`actions.${c.action}`) : c.eventType}</DataCell>
                    <DataCell>{c.decision ? <VerdictStamp size="sm" verdict={c.decision} label={t(`verdict.${c.decision}`)} /> : "—"}</DataCell>
                    <DataCell mono>{c.policy ? `${c.policy.key} v${c.policy.version}` : "—"}</DataCell>
                    <DataCell mono align="right">
                      {c.risk ? n(c.risk.score) : "—"}
                    </DataCell>
                    <DataCell mono>
                      <span className="flex items-center gap-1.5">
                        <HashValue value={c.chainHash} chars={6} />
                        {c.block !== null && <IdTag tone="steel">#{n(c.block)}</IdTag>}
                      </span>
                    </DataCell>
                  </DataRow>
                ))}
              </DataTable>
            )}
          </Panel>
        )}

        {tab === "access" && (
          <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
            <Panel title={t("console.passport.accessSummary")} flush>
              {custody.loading && !custody.data ? (
                <Skeleton className="h-64" />
              ) : accessEvents.length === 0 ? (
                <p className="px-3 py-8 text-center text-[0.8125rem] text-ink-3">{t("console.passport.noAccess")}</p>
              ) : (
                <DataTable
                  minWidth={720}
                  cols={[{ label: t("console.request.cols.when"), width: "150px" }, t("console.request.cols.action"), t("passport.custodyColumns.who"), t("console.request.cols.decision"), { label: t("console.request.cols.risk"), align: "right" }]}
                >
                  {accessEvents.map((c) => (
                    <DataRow key={c.seq} tone={c.decision === "DENY" ? "bad" : c.decision === "STEP_UP" ? "warn" : undefined}>
                      <DataCell mono nowrap>
                        {dt(c.at, { dateStyle: "short", timeStyle: "medium" })}
                      </DataCell>
                      <DataCell strong>{c.action ? t(`actions.${c.action}`) : c.eventType}</DataCell>
                      <DataCell>{c.who?.displayName ?? "—"}</DataCell>
                      <DataCell>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {c.decision && <VerdictStamp size="sm" verdict={c.decision} label={t(`verdict.${c.decision}`)} />}
                          {c.reasons.slice(0, 2).map((r) => (
                            <span key={r} className="text-[0.6875rem] text-ink-3">
                              {t(`console.overview.denialReasons.${r.split(":")[0]}`)}
                            </span>
                          ))}
                        </span>
                      </DataCell>
                      <DataCell mono align="right">
                        {c.risk ? n(c.risk.score) : "—"}
                      </DataCell>
                    </DataRow>
                  ))}
                </DataTable>
              )}
            </Panel>
            <Panel title={t("passport.tabs.custody")}>
              <KeyValues
                items={[
                  { k: t("passport.accessEvents"), v: n(p.stats.accessEvents), mono: true },
                  { k: t("passport.approvals"), v: n(p.stats.approvals), mono: true },
                  { k: t("passport.incidents"), v: n(p.stats.incidents30d), mono: true },
                  { k: t("passport.lastAccess"), v: p.stats.lastAccess ? time(p.stats.lastAccess) : t("common.never"), mono: true },
                ]}
              />
            </Panel>
          </div>
        )}

        {tab === "evidence" && (
          <div className="space-y-4">
            <Panel title={t("console.passport.evidenceTitle")} flush>
              <DataTable
                minWidth={860}
                cols={[
                  { label: t("passport.versionColumns.version"), width: "70px" },
                  t("passport.versionColumns.sha"),
                  { label: t("passport.versionColumns.size"), align: "right" },
                  t("passport.versionColumns.status"),
                  t("passport.versionColumns.tx"),
                  t("passport.versionColumns.at"),
                ]}
              >
                {p.versions.map((v) => (
                  <DataRow key={v.version} selected={v.version === p.currentVersion}>
                    <DataCell mono strong>
                      v{n(v.version)}
                    </DataCell>
                    <DataCell mono>
                      <HashValue value={v.sha256} chars={10} />
                    </DataCell>
                    <DataCell mono align="right">
                      {bytes(v.sizeBytes)}
                    </DataCell>
                    <DataCell>
                      <Chip tone={v.status === "anchored" ? "good" : "warn"}>{v.status}</Chip>
                    </DataCell>
                    <DataCell mono>
                      <LedgerStrip txId={v.ledgerTxId} block={v.block} pendingLabel={t("passport.notAnchoredYet")} />
                    </DataCell>
                    <DataCell mono nowrap>
                      {dt(v.createdAt, { dateStyle: "short", timeStyle: "short" })}
                    </DataCell>
                  </DataRow>
                ))}
              </DataTable>
            </Panel>

            {p.transfers.length > 0 && (
              <Panel title={t("passport.tabs.custody")} flush>
                <DataTable minWidth={760} cols={["From", "To", "Approver", t("passport.versionColumns.tx"), t("passport.versionColumns.at")]}>
                  {p.transfers.map((tr, i) => (
                    <DataRow key={i}>
                      <DataCell mono>
                        <HashValue value={tr.fromDid} chars={8} />
                      </DataCell>
                      <DataCell mono>
                        <HashValue value={tr.toDid} chars={8} />
                      </DataCell>
                      <DataCell mono>{tr.approverDid ? <HashValue value={tr.approverDid} chars={8} /> : "—"}</DataCell>
                      <DataCell mono>
                        <LedgerStrip txId={tr.ledgerTxId} block={tr.block} pendingLabel={t("passport.notAnchoredYet")} />
                      </DataCell>
                      <DataCell mono nowrap>
                        {dt(tr.at, { dateStyle: "short", timeStyle: "short" })}
                      </DataCell>
                    </DataRow>
                  ))}
                </DataTable>
              </Panel>
            )}

            <p className="text-[0.75rem] text-ink-3">
              <Link
                href={`${base}/audit?asset=${encodeURIComponent(p.assetUid)}`}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-tag)] font-medium text-brass transition-colors duration-150 ease-out hover:text-brass-deep"
              >
                {t("console.shell.items.audit")} {Icon.arrow}
              </Link>
            </p>
          </div>
        )}
      </div>

      <Drawer open={why} onClose={() => setWhy(false)} closeLabel={t("common.close")} title={t("console.why.assetTrust")} subtitle={p.assetUid} width={420}>
        <ScoreHead score={n(p.trust.score)} label={t("trust.asset")} tone={trustTone} />
        <FactorBreakdown factors={factors} n={n} />
        <p className="mt-4 border-t border-line pt-3 text-[0.75rem] text-ink-3">{t("console.why.basis")}</p>
      </Drawer>
    </>
  );
}
