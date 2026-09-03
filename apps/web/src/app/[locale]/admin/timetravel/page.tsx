"use client";

/**
 * Time travel.
 *
 * "What did VAJRA believe was true at 10:42?" — reconstructed from the append-only record rather
 * than from current rows, and shown beside the present so the difference is the answer. This is the
 * question an auditor asks months later, and the one an ordinary access-control system cannot answer.
 *
 * DAYLIGHT: the reconstruction controls wear the console's own FilterBar chrome rather than a bare
 * flex row, THEN is marked by a steel hairline instead of a full-strength steel rule (steel is
 * identity and provenance, and at full strength it reads as a state), and the delta list is a ruled
 * ledger of facts on the same rhythm as every KeyValues block on the page.
 */
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { ASSET_ACTIONS, baselineFor } from "@/lib/roles";
import { useI18n } from "@/lib/i18n-client";
import { useAsync } from "@/components/trust";
import { useEntity } from "@/components/EntityDrawer";
import { AccessMatrix, DataCell, DataRow, DataTable, FilterBar, IdTag, KeyValues, OpsHeader, Panel, SelectInput, StateDot, VerdictStamp } from "@/components/console";
import { Button, Chip, ErrorNote, HashValue, Skeleton } from "@/components/ui";
import type { PermissionState, Role } from "@vajra/contracts";

interface Reconstruction {
  at: string;
  policies?: { key: string; version: number; hash: string; spec: { effect: string; action: string } }[];
  user?: {
    did: string;
    existed: boolean;
    displayName?: string;
    role?: string;
    status?: string;
    identityTrust?: number;
    devices?: { id: string; fingerprint: string; deviceTrust: number; trusted: boolean }[];
    openIncident?: { incidentId: string; severity: string } | null;
    effectivePermissions?: Record<string, PermissionState>;
    decisionsNearby?: { id: string; at: string; action: string; assetUid: string | null; decision: string; reasons: string[]; risk: number }[];
  };
  asset?: {
    assetUid: string;
    existed: boolean;
    name?: string;
    sensitivity?: string;
    owner?: { did: string; displayName: string | null };
    version?: { version: number; sha256: string; anchored: boolean } | null;
    assetTrust?: number | null;
    transfersSoFar?: number;
  };
}

/** The console field recipe, matched to SelectInput/TextInput so the row reads as one instrument. */
const TIME_FIELD =
  "h-[32px] rounded-[var(--radius-control)] border border-line bg-paper-2/50 px-2 tnum font-mono text-[0.8125rem] text-ink transition-[border-color,background-color,box-shadow] duration-150 ease-out hover:border-line-strong focus:border-brass focus:bg-paper focus:shadow-arc";

function toLocalInput(d: Date): string {
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TimeTravel() {
  const { t, dt, n } = useI18n();
  const { open } = useEntity();
  // Deliberately uncaught: a swallowed rejection turns "we could not ask" into "there is nobody and
  // nothing here", and the operator picks a subject from a dropdown that is empty for the wrong
  // reason. The rejection reaches useAsync and is stated on the page instead.
  const identities = useAsync(() => api.identities(), []);
  const assets = useAsync(() => api.assets(), []);
  const policies = useAsync(() => api.policies(), []);

  const [at, setAt] = useState(toLocalInput(new Date(Date.now() - 60 * 60 * 1000)));
  const [did, setDid] = useState("");
  const [assetUid, setAssetUid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Reconstruction | null>(null);

  /** Both pickers are one instrument: state the first blind list once, and retry every blind list. */
  const pickerError = identities.error ?? assets.error;
  const reloadPickers = () => {
    if (identities.error) identities.reload();
    if (assets.error) assets.reload();
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult((await api.timetravel({ at: new Date(at).toISOString(), did: did || undefined, assetUid: assetUid || undefined })) as unknown as Reconstruction);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const nowPerson = useMemo(() => (identities.data ?? []).find((i) => i.did === did), [identities.data, did]);
  const nowAsset = useMemo(() => (assets.data ?? []).find((a) => a.assetUid === assetUid), [assets.data, assetUid]);

  /** The delta between then and now, stated as a list of things that happened. */
  const changes = useMemo(() => {
    if (!result) return [];
    const out: { key: string; text: string }[] = [];
    if (result.user?.existed && nowPerson) {
      if ((result.user.identityTrust ?? 0) !== nowPerson.identityTrust)
        out.push({ key: "trust", text: t("console.timetravel.changes.trust", { from: n(result.user.identityTrust ?? 0), to: n(nowPerson.identityTrust) }) });
      if (result.user.status !== nowPerson.status) out.push({ key: "status", text: t("console.timetravel.changes.status", { status: nowPerson.status }) });
      if (result.user.openIncident) out.push({ key: "incident", text: t("console.timetravel.changes.incident", { id: result.user.openIncident.incidentId }) });
    }
    if (result.asset?.existed && nowAsset) {
      if ((result.asset.version?.version ?? 0) !== nowAsset.currentVersion) out.push({ key: "version", text: t("console.timetravel.changes.version", { version: n(nowAsset.currentVersion) }) });
      if (result.asset.owner?.did && result.asset.owner.did !== nowAsset.ownerDid) out.push({ key: "owner", text: t("console.timetravel.changes.owner") });
    }
    for (const then of result.policies ?? []) {
      const now = (policies.data ?? []).filter((p) => p.key === then.key && !p.activeTo)[0];
      if (now && now.version !== then.version) out.push({ key: `policy-${then.key}`, text: t("console.timetravel.changes.policy", { key: then.key, version: n(now.version) }) });
    }
    return out;
  }, [result, nowPerson, nowAsset, policies.data, t, n]);

  const matrixRows = useMemo(() => {
    if (!result?.user?.effectivePermissions || !result.user.role) return [];
    const role = result.user.role as Role;
    return ASSET_ACTIONS.map((a) => ({
      action: a,
      label: t(`actions.${a}`),
      now: (result.user!.effectivePermissions![a] ?? baselineFor(role, a)) as PermissionState,
      normal: baselineFor(role, a),
    }));
  }, [result, t]);

  return (
    <>
      <OpsHeader title={t("timetravel.title")} meta={<span>{t("console.timetravel.question")}</span>} />

      <div className="space-y-4">
        <Panel title={t("timetravel.subtitle")}>
          <FilterBar>
            <label className="flex flex-col gap-1">
              <span className="eyebrow">{t("timetravel.at")}</span>
              <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={TIME_FIELD} />
            </label>
            <SelectInput
              label={t("timetravel.person")}
              value={did}
              onChange={setDid}
              options={[{ value: "", label: "—" }, ...(identities.data ?? []).map((i) => ({ value: i.did, label: i.displayName }))]}
            />
            <SelectInput
              label={t("timetravel.asset")}
              value={assetUid}
              onChange={setAssetUid}
              options={[{ value: "", label: "—" }, ...(assets.data ?? []).map((a) => ({ value: a.assetUid, label: a.name }))]}
            />
            <Button size="sm" variant="primary" loading={busy} onClick={() => void run()}>
              {busy ? t("timetravel.reconstructing") : t("console.timetravel.reconstruct")}
            </Button>
          </FilterBar>
          {/* Sits under the controls, not at the top of the page: the operator is about to choose a
              subject from a dropdown that is short, and this is the sentence that says why. */}
          {pickerError && (
            <div className="mt-3">
              <ErrorNote message={pickerError} onRetry={reloadPickers} retryLabel={t("common.retry")} />
            </div>
          )}
        </Panel>

        {error && <ErrorNote message={error} />}
        {busy && <Skeleton className="h-64" />}

        {result && (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Then — steel marks the reconstructed record. A hairline rim, not a full-strength
                  rule: at 100% steel the panel reads as a state rather than as provenance. */}
              <Panel title={t("console.timetravel.stateThen", { time: dt(result.at, { dateStyle: "medium", timeStyle: "medium" }) })} className="border-steel-line">
                {result.user && (
                  <div className="mb-3">
                    <p className="eyebrow mb-1.5">{t("timetravel.person")}</p>
                    {!result.user.existed ? (
                      <p className="text-[0.8125rem] text-ink-3">{t("timetravel.didNotExist")}</p>
                    ) : (
                      <KeyValues
                        items={[
                          { k: t("console.identity.cols.person"), v: result.user.displayName ?? "—" },
                          { k: t("console.identity.cols.role"), v: result.user.role ? t(`roles.${result.user.role}`) : "—" },
                          { k: t("console.identity.cols.status"), v: result.user.status ?? "—" },
                          { k: t("trust.identity"), v: n(result.user.identityTrust ?? 0), mono: true },
                          { k: t("trust.device"), v: n(result.user.devices?.[0]?.deviceTrust ?? 0), mono: true },
                          ...(result.user.openIncident ? [{ k: t("console.shell.items.incidents"), v: result.user.openIncident.incidentId, mono: true }] : []),
                        ]}
                      />
                    )}
                  </div>
                )}
                {result.asset?.existed && (
                  <div className="border-t border-line pt-3">
                    <p className="eyebrow mb-1.5">{t("timetravel.asset")}</p>
                    <KeyValues
                      items={[
                        { k: t("timetravel.ownerThen"), v: result.asset.owner?.displayName ?? "—" },
                        { k: t("timetravel.versionThen"), v: `v${n(result.asset.version?.version ?? 0)}`, mono: true },
                        { k: t("timetravel.trustThen"), v: result.asset.assetTrust != null ? n(result.asset.assetTrust) : "—", mono: true },
                        { k: t("passport.versionColumns.sha"), v: result.asset.version ? <HashValue value={result.asset.version.sha256} chars={8} /> : "—", mono: true },
                      ]}
                    />
                  </div>
                )}
              </Panel>

              {/* Now */}
              <Panel title={t("console.timetravel.stateNow")}>
                {nowPerson && (
                  <div className="mb-3">
                    <p className="eyebrow mb-1.5">{t("timetravel.person")}</p>
                    <KeyValues
                      items={[
                        { k: t("console.identity.cols.person"), v: nowPerson.displayName },
                        { k: t("console.identity.cols.role"), v: t(`roles.${nowPerson.role}`) },
                        { k: t("console.identity.cols.status"), v: nowPerson.status },
                        { k: t("trust.identity"), v: n(nowPerson.identityTrust), mono: true },
                        { k: t("trust.device"), v: n(nowPerson.devices[0]?.deviceTrust ?? 0), mono: true },
                      ]}
                    />
                  </div>
                )}
                {nowAsset && (
                  <div className="border-t border-line pt-3">
                    <p className="eyebrow mb-1.5">{t("timetravel.asset")}</p>
                    <KeyValues
                      items={[
                        { k: t("passport.owner"), v: nowAsset.ownerName ?? "—" },
                        { k: t("passport.currentVersion"), v: `v${n(nowAsset.currentVersion)}`, mono: true },
                        { k: t("trust.asset"), v: n(nowAsset.assetTrust), mono: true },
                      ]}
                    />
                  </div>
                )}
                {!nowPerson && !nowAsset && <p className="py-4 text-[0.8125rem] text-ink-3">—</p>}
              </Panel>
            </div>

            <Panel title={t("console.timetravel.whatChanged")}>
              {/* The policy deltas — and the "→ vN" supersession arrows further down — are computed
                  against the live policy list. If that read failed the ledger is INCOMPLETE, not
                  short, so "nothing changed" here would be a claim we cannot make. One note, in the
                  panel the missing list actually damages. */}
              {policies.error && (
                <div className="mb-3">
                  <ErrorNote message={policies.error} onRetry={policies.reload} retryLabel={t("common.retry")} />
                </div>
              )}
              {changes.length === 0 ? (
                // "Nothing changed" is an assertion. We only make it when every list it rests on
                // was actually read; otherwise the note above is the whole of what we can say.
                !policies.error && <p className="text-[0.8125rem] text-ink-3">{t("console.timetravel.noChange")}</p>
              ) : (
                // Ruled on the same hairline rhythm as KeyValues: the delta is a ledger of facts,
                // and brass marks the entries as findings rather than as a severity.
                <ul>
                  {changes.map((c) => (
                    <li key={c.key} className="flex items-start gap-2.5 border-b border-line-faint py-1.5 text-[0.875rem] leading-snug text-ink last:border-0">
                      <StateDot tone="brass" className="mt-[0.45em]" />
                      {c.text}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {matrixRows.length > 0 && (
              <Panel title={t("console.timetravel.accessThen")} flush>
                <AccessMatrix
                  rows={matrixRows}
                  headings={{
                    action: t("console.effective.cols.action"),
                    now: t("console.timetravel.thenCol"),
                    normal: t("console.effective.cols.normal"),
                    allow: t("permissions.allow"),
                    step_up: t("permissions.step_up"),
                    deny: t("permissions.deny"),
                  }}
                />
              </Panel>
            )}

            {result.user?.decisionsNearby && result.user.decisionsNearby.length > 0 && (
              <Panel title={t("timetravel.decisionsNearby")} flush>
                <DataTable
                  minWidth={720}
                  cols={[
                    { label: t("console.request.cols.when"), width: "150px" },
                    t("console.request.cols.action"),
                    t("console.request.cols.asset"),
                    t("console.request.cols.decision"),
                    { label: t("console.request.cols.risk"), align: "right" },
                  ]}
                >
                  {result.user.decisionsNearby.map((d) => (
                    <DataRow key={d.id} tone={d.decision === "DENY" ? "bad" : d.decision === "STEP_UP" ? "warn" : undefined}>
                      <DataCell mono nowrap>
                        {dt(d.at, { dateStyle: "short", timeStyle: "medium" })}
                      </DataCell>
                      <DataCell strong>{t(`actions.${d.action}`)}</DataCell>
                      <DataCell mono>
                        {d.assetUid ? (
                          // Was a bare span with onClick: unreachable from the keyboard, and the row
                          // itself is not clickable here, so the asset link was the only way in.
                          <button
                            type="button"
                            onClick={() => d.assetUid && open({ kind: "asset", id: d.assetUid })}
                            className="-mx-1 rounded-[var(--radius-tag)] px-1 underline decoration-line-strong decoration-dotted underline-offset-2 transition-[color,background-color,text-decoration-color] duration-150 ease-out hover:bg-brass-soft/40 hover:text-brass-deep hover:decoration-brass-line active:translate-y-px"
                          >
                            {d.assetUid}
                          </button>
                        ) : (
                          "—"
                        )}
                      </DataCell>
                      <DataCell>
                        <VerdictStamp size="sm" verdict={d.decision} label={t(`verdict.${d.decision}`)} />
                      </DataCell>
                      <DataCell mono align="right">
                        {n(d.risk)}
                      </DataCell>
                    </DataRow>
                  ))}
                </DataTable>
              </Panel>
            )}

            {result.policies && result.policies.length > 0 && (
              <Panel title={t("console.timetravel.policiesThen")}>
                <div className="flex flex-wrap gap-1.5">
                  {result.policies.map((p) => {
                    const now = (policies.data ?? []).filter((x) => x.key === p.key && !x.activeTo)[0];
                    const superseded = now && now.version !== p.version;
                    return (
                      <IdTag key={`${p.key}-${p.version}`} tone={superseded ? "warn" : "neutral"} title={p.hash}>
                        {p.key} v{n(p.version)}
                        {superseded && (
                          <span className="ml-0.5 text-[0.6875rem] opacity-80">
                            <span aria-hidden>→</span> v{n(now.version)}
                          </span>
                        )}
                      </IdTag>
                    );
                  })}
                </div>
              </Panel>
            )}
          </div>
        )}

        {!result && !busy && (
          <Panel title={t("console.timetravel.question")}>
            <div className="py-10 text-center">
              <span
                aria-hidden
                className="mx-auto mb-2.5 grid h-9 w-9 place-items-center rounded-[var(--radius-pill)] border border-dashed border-line-strong font-mono text-[0.9375rem] leading-none text-ink-3"
              >
                ◆
              </span>
              <p className="text-[0.875rem] text-ink-3">{t("timetravel.subtitle")}</p>
            </div>
          </Panel>
        )}

        {result && (
          <p className="flex flex-wrap items-center gap-2 border-t border-line-faint pt-3 text-[0.75rem] text-ink-3">
            <Chip tone="steel">{t("console.shell.items.timetravel")}</Chip>
            {t("timetravel.subtitle")}
          </p>
        )}
      </div>
    </>
  );
}
