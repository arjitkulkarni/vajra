"use client";

/**
 * Access decision — the security decision debugger.
 *
 * A request is not a button that returns a colour. The operator sees the context the engine will
 * judge, every gate it runs in order, the verdict, the numbered reasons behind it, the exact policy
 * version and hash that produced it, and what the decision did to their effective privileges.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { AccessDecisionResponse, Action, PermissionState } from "@vajra/contracts";
import { api, consoleAttestation, contentUrl, getScenario, setScenario } from "@/lib/api";
import { ASSET_ACTIONS, baselineFor } from "@/lib/roles";
import { deviceFingerprint } from "@/lib/did";
import { useI18n } from "@/lib/i18n-client";
import { useConsoleBase } from "@/lib/nav";
import { useMe } from "@/components/AppShell";
import { useEntity } from "@/components/EntityDrawer";
import { AnalystNote, StepUpModal, TraceRow, useAsync } from "@/components/trust";
import type { Challenge } from "@/components/LivenessCapture";
import {
  AccessMatrix,
  DataCell,
  DataRow,
  DataTable,
  IdTag,
  KeyValues,
  OpsHeader,
  Panel,
  SelectInput,
  StateDot,
  TextInput,
  VerdictStamp,
} from "@/components/console";
import { Button, Chip, ErrorNote, HashValue, Icon, Skeleton, cx, toneForRisk, toneForTrust } from "@/components/ui";

const ACTIONS: Action[] = ["asset.view", "asset.open", "asset.download", "asset.transfer", "asset.export"];
const DEMO_IDENTITIES = ["Asha Rao", "Vikram Nair", "Meera Iyer", "Rohan Desai"];

export default function AccessPage() {
  const { t, locale, dt, n } = useI18n();
  const base = useConsoleBase();
  const { me } = useMe();
  const { open } = useEntity();

  // Nothing here swallows a rejection: an operator who cannot see the asset list must be told the
  // list could not be fetched, never shown an empty picker that reads as "there are no assets".
  const assets = useAsync(() => api.assets(), []);
  const presets = useAsync(() => api.demoPresets(), []);
  const identities = useAsync(() => api.identities(), []);
  const history = useAsync(() => api.requests(12), []);

  const [assetUid, setAssetUid] = useState("");
  const [action, setAction] = useState<Action>("asset.download");
  const [toDid, setToDid] = useState("");
  const [reason, setReason] = useState("");
  const [presetKey, setPresetKey] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccessDecisionResponse | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    void deviceFingerprint().then(setFingerprint);
  }, []);
  // Deep link from the passport: /access?asset=AST-…. Read once on mount so the page stays
  // statically renderable (no useSearchParams suspense boundary needed).
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("asset");
    if (wanted) setAssetUid(wanted);
  }, []);
  useEffect(() => {
    if (!assetUid && assets.data?.length) setAssetUid(assets.data[0]!.assetUid);
  }, [assets.data, assetUid]);
  useEffect(() => {
    const current = getScenario();
    if (current && presets.data) {
      const match = Object.entries(presets.data.presets).find(([, v]) => v.deviceId === current.deviceId && v.localHour === current.localHour);
      if (match) setPresetKey(match[0]);
    }
  }, [presets.data]);

  const scenario = getScenario();
  const asset = assets.data?.find((a) => a.assetUid === assetUid);
  // Three loads fill the request form — assets, scenario presets, transfer recipients. One blind
  // form says so once, on the first thing that failed, rather than stacking three identical banners.
  const formLoad = [assets, presets, identities].find((l) => l.error);
  const isDemoIdentity = !!me && DEMO_IDENTITIES.includes(me.user.displayName);

  const applyPreset = (key: string) => {
    setPresetKey(key);
    if (!key || !presets.data) return setScenario(null);
    const { label: _label, ...rest } = presets.data.presets[key]!;
    setScenario(rest);
  };

  const submit = async () => {
    if (!assetUid) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setDownloadUrl(null);
    try {
      const res = await api.requestAccess(assetUid, {
        action,
        context: { deviceId: fingerprint || "browser", ...(reason.trim() ? { reason: reason.trim() } : {}) },
        ...(action === "asset.transfer" && toDid ? { toDid } : {}),
      });
      setResult(res);
      history.reload();
      if (res.contentUrl) setDownloadUrl(contentUrl(res.contentUrl));
      if (res.verdict === "STEP_UP") {
        // The engine still decides — a console session gets a real STEP_UP when policy says so,
        // and that is the whole point of this screen. What changes is how the step-up is CLEARED:
        // there is no enrolled face behind a console session and no browser-held key to sign the
        // nonce with, so the dialog would ask for a proof it cannot produce. The gateway accepts
        // the issued link in its place — see lib/api.ts `consoleAttestation`.
        //
        // `res.requestId` is threaded through explicitly: setResult has not committed yet, and
        // `onAttested` reading it off state would find the previous decision.
        if (me?.consoleSession && res.stepUp) void onAttested(consoleAttestation(res.stepUp.nonce), res.requestId);
        else setStepUpOpen(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onAttested = async (
    attestation: { nonce: string; signature: string; livenessMode: "faceapi" | "simulated" },
    explicitRequestId?: string,
  ) => {
    const requestId = explicitRequestId ?? result?.requestId;
    if (!requestId) return;
    setStepUpOpen(false);
    setBusy(true);
    try {
      const res = await api.stepUp(requestId, attestation);
      setResult(res);
      history.reload();
      if (res.contentUrl) setDownloadUrl(contentUrl(res.contentUrl));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // "Now" comes from the last decision when there is one, otherwise from the session.
  const permissions = (result?.effectivePermissions ?? me?.permissions ?? {}) as Partial<Record<Action, PermissionState>>;
  const matrixRows = useMemo(() => {
    if (!me) return [];
    return ASSET_ACTIONS.map((a) => ({
      action: a,
      label: t(`actions.${a}`),
      now: (permissions[a] ?? baselineFor(me.user.role, a)) as PermissionState,
      normal: baselineFor(me.user.role, a),
    }));
  }, [me, permissions, t]);
  const restricted = matrixRows.filter((r) => r.now !== r.normal);

  const localHour = scenario?.localHour ?? new Date().getHours();
  const deviceTrust = result?.trust.device ?? me?.device?.deviceTrust ?? 0;
  const deviceTrusted = me?.device?.trusted ?? false;
  const failedChecks = result?.trace.checks.filter((c) => c.result === "fail") ?? [];

  return (
    <>
      <OpsHeader
        title={t("console.request.title")}
        meta={<span>{t("console.request.subtitle")}</span>}
        actions={
          me && (
            <span className="flex items-center gap-2">
              <IdTag tone={toneForTrust(me.user.identityTrust)}>
                {t("trust.identity")} {n(me.user.identityTrust)}
              </IdTag>
              <IdTag tone={toneForTrust(deviceTrust)}>
                {t("trust.device")} {n(deviceTrust)}
              </IdTag>
            </span>
          )
        }
      />

      {!me && <ErrorNote message={t("errors.session_missing")} onRetry={() => location.assign(`/${locale}/login`)} retryLabel={t("app.signIn")} />}
      {error && <ErrorNote message={error} />}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <Panel title={t("console.request.form")}>
            <div className="space-y-2.5">
              {formLoad?.error && <ErrorNote message={formLoad.error} onRetry={formLoad.reload} retryLabel={t("common.retry")} />}
              <SelectInput
                label={t("access.chooseAsset")}
                value={assetUid}
                onChange={setAssetUid}
                options={(assets.data ?? []).map((a) => ({ value: a.assetUid, label: `${a.name} · ${t(`sensitivity.${a.sensitivity}`)}` }))}
              />
              <SelectInput label={t("access.chooseAction")} value={action} onChange={(v) => setAction(v as Action)} options={ACTIONS.map((a) => ({ value: a, label: t(`actions.${a}`) }))} />
              {action === "asset.transfer" && (
                <SelectInput
                  label={t("access.recipient")}
                  value={toDid}
                  onChange={setToDid}
                  options={[
                    { value: "", label: "—" },
                    ...(identities.data ?? []).filter((i) => i.did !== me?.user.did && i.status === "active").map((i) => ({ value: i.did, label: `${i.displayName} · ${t(`roles.${i.role}`)}` })),
                  ]}
                />
              )}
              <TextInput label={t("console.request.reason")} value={reason} onChange={setReason} placeholder={t("console.request.reasonPlaceholder")} />
              <SelectInput
                label={t("access.scenario")}
                value={presetKey}
                onChange={applyPreset}
                options={[{ value: "", label: t("common.none") }, ...Object.entries(presets.data?.presets ?? {}).map(([key, p]) => ({ value: key, label: p.label }))]}
              />
              <Button variant="primary" className="w-full" loading={busy} disabled={!assetUid || !me} onClick={() => void submit()}>
                {busy ? t("access.deciding") : t("access.submit")}
              </Button>
              {asset && (
                <p className="text-[0.75rem] text-ink-3">
                  <Link className="rounded-[var(--radius-tag)] font-medium text-brass transition-[color] duration-150 ease-out hover:text-brass-deep" href={`${base}/assets/${encodeURIComponent(asset.assetUid)}`}>
                    {t("passport.title")} {Icon.arrow}
                  </Link>
                </p>
              )}
            </div>
          </Panel>

          <Panel title={t("console.request.context")}>
            <ul className="space-y-1.5">
              <ContextRow ok={!!me && me.user.status === "active"} label={t("console.request.contextItems.identity")} value={me?.user.displayName ?? "—"} />
              <ContextRow
                ok={deviceTrusted}
                label={t("console.request.contextItems.device")}
                value={deviceTrusted ? t("console.request.deviceKnown") : t("console.request.deviceFirstSeen")}
              />
              <ContextRow ok={true} label={t("console.request.contextItems.location")} value={scenario?.geo?.city ?? "—"} />
              <ContextRow
                ok={localHour >= 8 && localHour < 20}
                label={t("console.request.contextItems.time")}
                value={`${String(localHour).padStart(2, "0")}:00 · ${localHour >= 8 && localHour < 20 ? t("console.request.insideHours") : t("console.request.outsideHours")}`}
              />
              <ContextRow ok={!!me?.fresh} label={t("console.request.contextItems.session")} value={me?.fresh ? t("passport.verified") : t("passport.unverified")} />
            </ul>
          </Panel>

          <Panel title={t("console.request.scores")}>
            <KeyValues
              items={[
                { k: t("trust.identity"), v: n(result?.trust.identity ?? me?.user.identityTrust ?? 0), mono: true },
                { k: t("trust.device"), v: n(deviceTrust), mono: true },
                { k: t("trust.asset"), v: result?.trust.asset !== undefined && result?.trust.asset !== null ? n(result.trust.asset) : asset ? n(asset.assetTrust) : "—", mono: true },
                {
                  k: t("console.request.requestRisk"),
                  v: result ? (
                    <span className={cx(toneForRisk(result.risk.tier) === "bad" ? "text-oxide" : toneForRisk(result.risk.tier) === "warn" ? "text-saffron" : "text-verdigris")}>
                      {n(result.risk.score)} · {t(`risk.${result.risk.tier}`)}
                    </span>
                  ) : (
                    "—"
                  ),
                  mono: true,
                },
              ]}
            />
          </Panel>
        </div>

        <div className="space-y-4">
          {!result ? (
            <Panel title={t("console.request.decision")}>
              <p className="rounded-[var(--radius-field)] border border-dashed border-line-strong bg-overlay-1 px-4 py-10 text-center text-[0.875rem] text-ink-3">{t("console.request.awaiting")}</p>
            </Panel>
          ) : (
            <>
              <Panel
                key={`trace-${result.requestId}`}
                className="rise"
                title={t("trace.title")}
                meta={t("access.decisionIn", { ms: n(result.latencyMs) })}
                actions={<VerdictStamp verdict={result.verdict} label={t(`verdict.${result.verdict}`)} />}
              >
                <ol>
                  {result.trace.checks.map((check, i) => (
                    <TraceRow key={`${check.id}-${i}`} check={check} index={i} />
                  ))}
                </ol>
              </Panel>

              {/* Why, stated as numbered conditions rather than a tone of voice. */}
              <Panel key={`why-${result.requestId}`} className="rise" title={t("console.why.decision")}>
                <div className="flex flex-wrap items-center gap-3">
                  <VerdictStamp size="lg" verdict={result.verdict} label={t(`verdict.${result.verdict}`)} />
                  {failedChecks.length > 0 && (
                    <span className="text-[0.875rem] text-ink-2">
                      {failedChecks.length === 1 ? t("console.why.conditionsFailed", { n: n(1) }) : t("console.why.conditionsFailedMany", { n: n(failedChecks.length) })}
                    </span>
                  )}
                </div>

                {result.trace.reasons.length > 0 && (
                  <>
                    <p className="eyebrow mt-4 mb-1.5">{t("console.why.because")}</p>
                    <ol className="space-y-1">
                      {result.trace.reasons.map((r, i) => {
                        const label = t(`console.overview.denialReasons.${r.split(":")[0]}`);
                        return (
                          <li key={r} className="flex items-baseline gap-2 text-[0.875rem] text-ink">
                            <span className="tnum shrink-0 font-mono text-[0.75rem] text-ink-3">{n(i + 1)}.</span>
                            <span>{label.startsWith("console.") ? r : label}</span>
                          </li>
                        );
                      })}
                    </ol>
                  </>
                )}

                <div className="mt-4 grid gap-x-6 border-t border-line pt-3 sm:grid-cols-2">
                  <KeyValues
                    items={[
                      { k: t("console.audit.drawer.policy"), v: result.trace.policyVersion ? `${result.trace.policyVersion.key} v${result.trace.policyVersion.version}` : "—", mono: true },
                      { k: t("risk.label"), v: `${n(result.risk.score)} · ${t(`risk.${result.risk.tier}`)}`, mono: true },
                    ]}
                  />
                  <KeyValues
                    items={[
                      { k: "hash", v: result.trace.policyVersion ? <HashValue value={result.trace.policyVersion.hash} chars={8} /> : "—", mono: true },
                      { k: t("audit.columns.when"), v: dt(new Date(), { timeStyle: "medium", dateStyle: "short" }), mono: true },
                    ]}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  {result.verdict === "STEP_UP" && (
                    <Button variant="primary" size="sm" onClick={() => setStepUpOpen(true)}>
                      {t("access.stepUpStart")}
                    </Button>
                  )}
                  {result.trace.policyVersion && (
                    <Button size="sm" variant="ghost" onClick={() => result.trace.policyVersion && open({ kind: "policy", id: result.trace.policyVersion.id })}>
                      {t("console.why.viewPolicy", { key: result.trace.policyVersion.key, version: n(result.trace.policyVersion.version) })}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => open({ kind: "event", id: result.auditEventId })}>
                    {t("console.why.viewTrace")}
                  </Button>
                  <AnalystNote kind="decision" id={result.requestId} label={t("access.explain")} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {result.certId && (
                    <Link href={`${base}/verify?cert=${encodeURIComponent(result.certId)}`} className="inline-flex rounded-[var(--radius-pill)] transition-[filter,transform] duration-150 ease-out hover:brightness-95 active:translate-y-px">
                      <Chip tone="steel" icon={Icon.check}>
                        {t("access.proofIssued", { certId: result.certId })}
                      </Chip>
                    </Link>
                  )}
                  {result.incidentId && (
                    <Link href={`${base}/incidents/${result.incidentId}`} className="inline-flex rounded-[var(--radius-pill)] transition-[filter,transform] duration-150 ease-out hover:brightness-95 active:translate-y-px">
                      <Chip tone="bad" icon={Icon.warn}>
                        {t("access.incidentOpened", { id: result.incidentId })}
                      </Chip>
                    </Link>
                  )}
                  {result.approvalId && (
                    <Link href={`${base}/approvals`} className="inline-flex rounded-[var(--radius-pill)] transition-[filter,transform] duration-150 ease-out hover:brightness-95 active:translate-y-px">
                      <Chip tone="steel">{t("access.pendingBody", { role: t("roles.manager") })}</Chip>
                    </Link>
                  )}
                  {downloadUrl && (
                    <a href={downloadUrl} className="inline-flex">
                      <Button size="sm" variant="primary">
                        {t("access.download")}
                      </Button>
                    </a>
                  )}
                </div>
              </Panel>
            </>
          )}

          <Panel title={t("console.effective.title")} meta={t("console.effective.subtitle")} flush>
            {!me ? (
              <Skeleton className="h-32" />
            ) : (
              <>
                <AccessMatrix
                  rows={matrixRows}
                  headings={{
                    action: t("console.effective.cols.action"),
                    now: t("console.effective.cols.now"),
                    normal: t("console.effective.cols.normal"),
                    allow: t("permissions.allow"),
                    step_up: t("permissions.step_up"),
                    deny: t("permissions.deny"),
                  }}
                />
                <div className="border-t border-line px-3 py-2.5">
                  {restricted.length === 0 ? (
                    <p className="text-[0.8125rem] text-ink-3">{t("console.effective.unchanged")}</p>
                  ) : (
                    <>
                      <p className="eyebrow mb-1.5">{t("console.effective.whyChanged")}</p>
                      <ul className="space-y-1 text-[0.8125rem]">
                        {!deviceTrusted && (
                          <li className="flex items-center gap-2">
                            <StateDot tone="warn" />
                            {t("trust.device")} <span className="tnum font-mono text-ink">{n(deviceTrust)}</span>
                            <span className="text-saffron">↓</span>
                          </li>
                        )}
                        {result && result.risk.tier !== "low" && (
                          <li className="flex items-center gap-2">
                            <StateDot tone="bad" />
                            {t("risk.label")} <span className="tnum font-mono text-ink">{n(result.risk.score)}</span>
                            <span className="text-oxide">↑</span>
                          </li>
                        )}
                        {me.incident && (
                          <li className="flex items-center gap-2">
                            <StateDot tone="bad" pulse />
                            <Link href={`${base}/incidents/${me.incident.incidentId}`} className="rounded-[var(--radius-tag)] font-mono text-[0.75rem] text-brass transition-[color] duration-150 ease-out hover:text-brass-deep">
                              {me.incident.incidentId}
                            </Link>
                            <span className="text-ink-3">· {t(`incidents.severity.${me.incident.severity}`)}</span>
                          </li>
                        )}
                      </ul>
                      <p className="mt-2 text-[0.75rem] text-ink-3">{t("console.effective.restore")}</p>
                    </>
                  )}
                </div>
              </>
            )}
          </Panel>

          <Panel title={t("console.request.history")} flush>
            {/* The history panel owns its own failure: "no requests yet" and "we could not read the
                request log" are opposite facts and must never share a rendering. */}
            {history.error ? (
              <div className="px-3 py-3">
                <ErrorNote message={history.error} onRetry={history.reload} retryLabel={t("common.retry")} />
              </div>
            ) : history.loading && !history.data ? (
              <Skeleton className="h-40" />
            ) : (history.data ?? []).length === 0 ? (
              <p className="px-3 py-6 text-center text-[0.8125rem] text-ink-3">{t("console.request.historyEmpty")}</p>
            ) : (
              <DataTable
                minWidth={780}
                cols={[
                  { label: t("console.request.cols.when"), width: "150px" },
                  t("console.request.cols.action"),
                  t("console.request.cols.asset"),
                  t("console.request.cols.decision"),
                  { label: t("console.request.cols.risk"), align: "right" },
                  t("console.request.cols.policy"),
                  { label: t("console.request.cols.latency"), align: "right" },
                ]}
              >
                {(history.data ?? []).map((r) => (
                  <DataRow key={r.id} tone={r.decision === "DENY" ? "bad" : r.decision === "STEP_UP" ? "warn" : undefined}>
                    <DataCell mono nowrap>
                      {dt(r.decidedAt, { dateStyle: "short", timeStyle: "medium" })}
                    </DataCell>
                    <DataCell strong>{t(`actions.${r.action}`)}</DataCell>
                    <DataCell mono>{r.assetUid ?? "—"}</DataCell>
                    <DataCell>
                      <VerdictStamp size="sm" verdict={r.decision} label={t(`verdict.${r.decision}`)} />
                    </DataCell>
                    <DataCell mono align="right">
                      {n(r.risk.score)}
                    </DataCell>
                    <DataCell mono>{r.policyVersionId ? r.policyVersionId.slice(0, 10) : "—"}</DataCell>
                    <DataCell mono align="right">
                      {n(r.latencyMs)} ms
                    </DataCell>
                  </DataRow>
                ))}
              </DataTable>
            )}
          </Panel>
        </div>
      </div>

      <StepUpModal
        open={stepUpOpen}
        onClose={() => setStepUpOpen(false)}
        nonce={result?.stepUp?.nonce ?? null}
        challenge={(result?.stepUp?.challenge ?? []) as Challenge[]}
        demoRole={isDemoIdentity}
        onAttested={(a) => void onAttested(a)}
      />
    </>
  );
}

function ContextRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <li className="flex items-baseline gap-2 border-b border-line-faint py-1.5 last:border-0 text-[0.8125rem]">
      <span aria-hidden className={cx("font-mono text-[0.75rem]", ok ? "text-verdigris" : "text-saffron")}>
        {ok ? "✓" : "⚠"}
      </span>
      <span className="text-ink-3">{label}</span>
      <span className="ml-auto truncate text-right text-ink">{value}</span>
    </li>
  );
}
