"use client";

/**
 * Policies — read as security policy, not as JSON.
 *
 * Each policy is a stack of immutable versions, so the page is built like a version history: pick a
 * policy, see what the active version actually says in words, walk back through its versions, diff
 * any two, and run a scenario through the conditions before anyone relies on them.
 */
import { useEffect, useMemo, useState } from "react";
import type { PolicySpec, PolicyVersion, RiskTier, Role, Sensitivity } from "@vajra/contracts";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { useMe } from "@/components/AppShell";
import { ConsoleJson, useAsync } from "@/components/trust";
import { IdTag, KeyValues, OpsHeader, Panel, SelectInput, StateDot, TextInput, VerdictStamp } from "@/components/console";
import { Button, Chip, ErrorNote, HashValue, Icon, Skeleton, cx } from "@/components/ui";

const ROLES: Role[] = ["engineer", "manager", "auditor", "admin"];
const TIERS: RiskTier[] = ["low", "elevated", "high"];
const SENSITIVITIES: Sensitivity[] = ["low", "medium", "high"];
const TIER_RANK: Record<RiskTier, number> = { low: 0, elevated: 1, high: 2 };

interface Scenario {
  role: Role;
  deviceTrusted: boolean;
  hour: number;
  riskTier: RiskTier;
  sensitivity: Sensitivity;
}

/**
 * The policy's own verdict for a scenario. The live engine additionally applies role tables,
 * ownership, trust gates and the risk overlay — the panel says so, and this stays honest about
 * covering only the conditions written into this version.
 */
function previewOutcome(spec: PolicySpec, s: Scenario): { applies: boolean; verdict: string; failing: string[] } {
  const applies = spec.subject.role.includes(s.role) && (!spec.resource.sensitivity || spec.resource.sensitivity.includes(s.sensitivity));
  if (!applies) return { applies: false, verdict: "—", failing: [] };
  if (spec.effect === "deny") return { applies: true, verdict: "DENY", failing: ["policy_deny"] };

  const failing: string[] = [];
  const c = spec.condition ?? {};
  if (c.hours) {
    const [start, end] = c.hours;
    const within = start === end ? true : start < end ? s.hour >= start && s.hour < end : s.hour >= start || s.hour < end;
    if (!within) failing.push("outside_hours");
  }
  if (c.deviceTrusted && !s.deviceTrusted) failing.push("device_untrusted");
  if (c.maxRiskTier && TIER_RANK[s.riskTier] > TIER_RANK[c.maxRiskTier]) failing.push("risk_above_policy");

  if (failing.length > 0) return { applies: true, verdict: "DENY", failing };
  const verdict = spec.effect === "require_approval" ? "PENDING_APPROVAL" : spec.effect === "step_up" ? "STEP_UP" : "ALLOW";
  return { applies: true, verdict, failing: [] };
}

/** Field-by-field difference between two versions, rendered like a changelog. */
function diffSpecs(a: PolicySpec, b: PolicySpec): { field: string; before: string; after: string }[] {
  const flat = (s: PolicySpec): Record<string, string> => ({
    "subject.role": s.subject.role.join(", "),
    action: s.action,
    "resource.class": s.resource.class?.join(", ") ?? "—",
    "resource.sensitivity": s.resource.sensitivity?.join(", ") ?? "—",
    "condition.hours": s.condition.hours ? `${s.condition.hours[0]}–${s.condition.hours[1]}` : "—",
    "condition.deviceTrusted": String(s.condition.deviceTrusted ?? false),
    "condition.maxRiskTier": s.condition.maxRiskTier ?? "—",
    effect: s.effect,
    approval: s.approval ? `${s.approval.approverRole} × ${s.approval.count}` : "—",
    priority: String(s.priority),
  });
  const fa = flat(a);
  const fb = flat(b);
  return Object.keys(fa)
    .filter((k) => fa[k] !== fb[k])
    .map((field) => ({ field, before: fa[field]!, after: fb[field]! }));
}

export default function Policies() {
  const { t, dt, n } = useI18n();
  const { me } = useMe();
  const policies = useAsync(() => api.policies(), []);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [compareWith, setCompareWith] = useState<number | null>(null);
  const [scenario, setScenario] = useState<Scenario>({ role: "engineer", deviceTrusted: true, hour: 14, riskTier: "low", sensitivity: "high" });

  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<{ draft: Record<string, unknown>; valid: boolean; issues: string[]; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Versions of one policy, newest first. */
  const byKey = useMemo(() => {
    const map = new Map<string, PolicyVersion[]>();
    for (const p of policies.data ?? []) {
      const list = map.get(p.key) ?? [];
      list.push(p);
      map.set(p.key, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.version - a.version);
    return map;
  }, [policies.data]);

  useEffect(() => {
    if (selectedKey || byKey.size === 0) return;
    const fromUrl = new URLSearchParams(window.location.search).get("key");
    const first = fromUrl && byKey.has(fromUrl) ? fromUrl : [...byKey.keys()][0]!;
    setSelectedKey(first);
  }, [byKey, selectedKey]);

  const versions = selectedKey ? (byKey.get(selectedKey) ?? []) : [];
  const active = versions.find((v) => !v.activeTo) ?? versions[0] ?? null;
  const shown = versions.find((v) => v.version === selectedVersion) ?? active;
  const other = compareWith !== null ? versions.find((v) => v.version === compareWith) : undefined;
  const diff = shown && other ? diffSpecs(other.spec, shown.spec) : [];
  const preview = shown ? previewOutcome(shown.spec, scenario) : null;

  const makeDraft = async () => {
    setBusy(true);
    setError(null);
    try {
      setDraft(await api.draftPolicy(description));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!draft?.valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.createPolicy(draft.draft);
      setDraft(null);
      setDescription("");
      policies.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const c = shown?.spec.condition ?? {};

  return (
    <>
      <OpsHeader
        title={t("console.policy.title")}
        meta={<span>{t("console.policy.subtitle")}</span>}
        actions={shown && <IdTag tone={shown.activeTo ? "neutral" : "good"}>{shown.activeTo ? t("console.policy.superseded") : t("console.policy.active")}</IdTag>}
      />

      {error && <ErrorNote message={error} />}
      {policies.loading && !policies.data && <Skeleton className="h-64" />}

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <Panel title={t("policies.columns.key")} flush>
          <ul className="divide-y divide-line-faint">
            {[...byKey.entries()].map(([key, list]) => {
              const head = list.find((v) => !v.activeTo) ?? list[0]!;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedKey(key);
                      setSelectedVersion(null);
                      setCompareWith(null);
                    }}
                    className={cx(
                      "w-full border-l-2 px-3 py-2 text-left transition-[background-color,border-color] duration-150 ease-out active:translate-y-px",
                      selectedKey === key ? "border-brass bg-brass-soft" : "border-transparent hover:border-line-strong hover:bg-paper-2",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <StateDot tone={head.activeTo ? "neutral" : "good"} />
                      <span className="font-mono text-[0.8125rem] text-ink">{key}</span>
                      <span className="tnum ml-auto font-mono text-[0.6875rem] text-ink-3">v{n(head.version)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[0.75rem] text-ink-3">{head.spec.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="space-y-4">
          {shown && (
            <>
              <Panel
                key={shown.id}
                className="rise"
                title={shown.spec.name}
                meta={`${shown.key} v${n(shown.version)}`}
                actions={<HashValue value={shown.hash} chars={8} />}
              >
                <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="eyebrow mb-1">{t("console.policy.who")}</p>
                    <ul className="space-y-0.5 text-[0.8125rem] text-ink">
                      {shown.spec.subject.role.map((r) => (
                        <li key={r}>{t(`roles.${r}`)}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="eyebrow mb-1">{t("console.policy.what")}</p>
                    <p className="text-[0.8125rem] text-ink">{t(`actions.${shown.spec.action}`)}</p>
                    <p className="mt-1 text-[0.75rem] text-ink-3">
                      {t("console.policy.priority")} {n(shown.spec.priority)}
                    </p>
                  </div>
                  <div>
                    <p className="eyebrow mb-1">{t("console.policy.asset")}</p>
                    <p className="text-[0.8125rem] text-ink">{shown.spec.resource.class?.map((cl) => t(`assetClass.${cl}`)).join(", ") ?? t("console.policy.anyClass")}</p>
                    <p className="text-[0.8125rem] text-ink-2">{shown.spec.resource.sensitivity?.map((sv) => t(`sensitivity.${sv}`)).join(", ") ?? t("console.policy.anySensitivity")}</p>
                  </div>
                  <div>
                    <p className="eyebrow mb-1">{t("console.policy.conditions")}</p>
                    <ul className="space-y-0.5 text-[0.8125rem] text-ink">
                      <li className="tnum font-mono text-[0.75rem]">
                        {c.hours ? `${String(c.hours[0]).padStart(2, "0")}:00 — ${String(c.hours[1]).padStart(2, "0")}:00` : "—"}
                      </li>
                      <li>{c.deviceTrusted ? t("console.policy.deviceTrusted") : t("console.policy.deviceAny")}</li>
                      <li>{c.maxRiskTier ? t("console.policy.maxRisk", { tier: t(`risk.${c.maxRiskTier}`) }) : t("console.policy.anyRisk")}</li>
                    </ul>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                  <span className="flex items-center gap-2">
                    <span className="eyebrow">{t("console.policy.ifFail")}</span>
                    <Chip tone={shown.spec.effect === "deny" ? "bad" : shown.spec.effect === "allow" ? "good" : shown.spec.effect === "require_approval" ? "steel" : "warn"}>
                      {t(`policies.effects.${shown.spec.effect}`)}
                    </Chip>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="eyebrow">{t("console.policy.requiresApproval")}</span>
                    <span className="text-[0.8125rem] text-ink">
                      {shown.spec.approval ? `${t(`roles.${shown.spec.approval.approverRole}`)} × ${n(shown.spec.approval.count)}` : t("console.policy.noApproval")}
                    </span>
                  </span>
                  {shown.spec.approval?.distinctFromRequester && <Chip tone="neutral">{t("console.policy.distinct")}</Chip>}
                </div>
              </Panel>

              <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                {/* Version rail — a policy's history reads like a commit log. */}
                <Panel title={t("console.policy.versionsTitle")} meta={t("console.policy.versionsHint")}>
                  <ol className="space-y-0">
                    {[...versions].reverse().map((v, i, arr) => {
                      const isShown = v.version === shown.version;
                      return (
                        <li key={v.id} className="flex gap-3">
                          <div className="flex w-4 shrink-0 flex-col items-center">
                            <span className={cx("w-px flex-1", i === 0 ? "bg-transparent" : "bg-line-strong")} />
                            <span className={cx("my-1 h-2.5 w-2.5 shrink-0 rounded-[var(--radius-pill)] border-2", !v.activeTo ? "border-verdigris bg-verdigris" : isShown ? "border-brass bg-brass" : "border-line-strong bg-paper")} />
                            <span className={cx("w-px flex-1", i === arr.length - 1 ? "bg-transparent" : "bg-line-strong")} />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedVersion(v.version);
                              setCompareWith(null);
                            }}
                            className={cx(
                              "my-0.5 min-w-0 flex-1 rounded-[var(--radius-panel)] border px-2.5 py-1.5 text-left transition-[background-color,border-color] duration-150 ease-out active:translate-y-px",
                              isShown ? "border-brass-line bg-brass-soft/60" : "border-transparent hover:border-line hover:bg-overlay-1",
                            )}
                          >
                            <span className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-mono text-[0.8125rem] font-medium text-ink">v{n(v.version)}</span>
                              {!v.activeTo && <span className="eyebrow text-verdigris">{t("console.policy.active")}</span>}
                              <span className="tnum ml-auto font-mono text-[0.6875rem] text-ink-3">
                                {v.ledgerTxId ? `✓ ${t("console.policy.anchored")}` : t("console.policy.notAnchored")}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[0.75rem] text-ink-3">
                              {v.activeTo
                                ? t("console.policy.activePeriod", { from: dt(v.activeFrom, { dateStyle: "short" }), to: dt(v.activeTo, { dateStyle: "short" }) })
                                : t("console.policy.activeSince", { from: dt(v.activeFrom, { dateStyle: "short" }) })}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>

                  {versions.length > 1 && (
                    <div className="mt-3 border-t border-line pt-3">
                      <SelectInput
                        label={t("console.policy.compareWith")}
                        value={compareWith === null ? "" : String(compareWith)}
                        onChange={(v) => setCompareWith(v === "" ? null : Number(v))}
                        options={[{ value: "", label: "—" }, ...versions.filter((v) => v.version !== shown.version).map((v) => ({ value: String(v.version), label: `v${v.version}` }))]}
                      />
                      {other && (
                        <div className="mt-2.5 overflow-hidden rounded-[var(--radius-panel)] border border-line font-mono text-[0.75rem]">
                          {diff.length === 0 ? (
                            <p className="px-2.5 py-2 text-ink-3">{t("console.policy.noChange")}</p>
                          ) : (
                            diff.map((d) => (
                              <div key={d.field} className="border-b border-line-faint last:border-0">
                                <p className="bg-paper-2/60 px-2.5 py-1 text-[0.6875rem] uppercase tracking-[0.06em] text-ink-3">{d.field}</p>
                                <p className="bg-oxide-soft/40 px-2.5 py-1 text-oxide">− {d.before}</p>
                                <p className="bg-verdigris-soft/40 px-2.5 py-1 text-verdigris">+ {d.after}</p>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Panel>

                {/* Preview — what will this policy actually do? */}
                <Panel title={t("console.policy.simulator")}>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <SelectInput label={t("console.policy.scenarioRole")} value={scenario.role} onChange={(v) => setScenario((s) => ({ ...s, role: v as Role }))} options={ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))} />
                    <SelectInput
                      label={t("console.policy.scenarioDevice")}
                      value={scenario.deviceTrusted ? "1" : "0"}
                      onChange={(v) => setScenario((s) => ({ ...s, deviceTrusted: v === "1" }))}
                      options={[
                        { value: "1", label: t("console.policy.deviceTrustedOpt") },
                        { value: "0", label: t("console.policy.deviceUntrustedOpt") },
                      ]}
                    />
                    <SelectInput
                      label={t("console.policy.scenarioHour")}
                      value={String(scenario.hour)}
                      onChange={(v) => setScenario((s) => ({ ...s, hour: Number(v) }))}
                      options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }))}
                    />
                    <SelectInput label={t("console.policy.scenarioRisk")} value={scenario.riskTier} onChange={(v) => setScenario((s) => ({ ...s, riskTier: v as RiskTier }))} options={TIERS.map((r) => ({ value: r, label: t(`risk.${r}`) }))} />
                    <SelectInput
                      label={t("console.policy.scenarioSensitivity")}
                      value={scenario.sensitivity}
                      onChange={(v) => setScenario((s) => ({ ...s, sensitivity: v as Sensitivity }))}
                      options={SENSITIVITIES.map((sv) => ({ value: sv, label: t(`sensitivity.${sv}`) }))}
                    />
                  </div>

                  <div className="mt-3 border-t border-line pt-3">
                    <p className="eyebrow mb-1.5">{t("console.policy.outcome")}</p>
                    {!preview?.applies ? (
                      <p className="text-[0.875rem] text-ink-3">{t("console.policy.noMatch")}</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-3">
                          <VerdictStamp verdict={preview.verdict} label={t(`verdict.${preview.verdict}`)} />
                          <span className="text-[0.8125rem] text-ink-3">{t("console.policy.matches")}</span>
                        </div>
                        {preview.failing.length > 0 && (
                          <>
                            <p className="eyebrow mt-3 mb-1">{t("console.policy.failing")}</p>
                            <ul className="space-y-0.5">
                              {preview.failing.map((f) => (
                                <li key={f} className="flex items-center gap-2 text-[0.8125rem] text-oxide">
                                  <span aria-hidden className="font-mono">✗</span>
                                  {t(`console.overview.denialReasons.${f}`)}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                    <p className="mt-3 border-t border-line pt-2 text-[0.75rem] leading-relaxed text-ink-3">{t("console.policy.simulatorHint")}</p>
                  </div>
                </Panel>
              </div>

              <Panel title={t("policies.columns.hash")}>
                <KeyValues
                  columns={2}
                  items={[
                    { k: t("policies.columns.version"), v: `v${n(shown.version)}`, mono: true },
                    { k: t("policies.columns.active"), v: shown.activeTo ? dt(shown.activeTo, { dateStyle: "medium", timeStyle: "short" }) : t("policies.activeNow"), mono: true },
                    { k: "hash", v: <HashValue value={shown.hash} chars={10} />, mono: true },
                    { k: t("passport.versionColumns.tx"), v: shown.ledgerTxId ? <HashValue value={shown.ledgerTxId} chars={10} /> : t("console.policy.notAnchored"), mono: true },
                  ]}
                />
              </Panel>
            </>
          )}

          {me?.user.role === "admin" && (
            <Panel title={t("console.policy.draftSection")}>
              <p className="mb-2 text-[0.8125rem] text-ink-2">{t("policies.draftBody")}</p>
              <div className="space-y-2.5">
                <TextInput value={description} onChange={setDescription} placeholder={t("policies.draftPlaceholder")} />
                <Button variant="primary" size="sm" loading={busy} disabled={description.trim().length < 5} onClick={() => void makeDraft()}>
                  {busy ? t("policies.drafting") : t("policies.draft")}
                </Button>
                {draft && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={draft.valid ? "good" : "warn"} icon={draft.valid ? Icon.check : Icon.warn}>
                        {draft.valid ? t("policies.draftValid") : t("policies.draftInvalid")}
                      </Chip>
                      <Chip tone="neutral">{draft.source === "claude" ? t("analyst.source.claude", { model: "Claude" }) : t("analyst.source.template")}</Chip>
                    </div>
                    {draft.issues.length > 0 && (
                      <ul className="list-inside list-disc rounded-[var(--radius-field)] border border-oxide-line bg-oxide-soft px-3.5 py-2.5 text-[0.8125rem] text-oxide">
                        {draft.issues.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    )}
                    <ConsoleJson value={draft.draft} title="policy draft" />
                    <Button variant="primary" size="sm" loading={busy} disabled={!draft.valid} onClick={() => void create()}>
                      {busy ? t("policies.creating") : t("policies.create")}
                    </Button>
                    <p className="text-[0.75rem] text-ink-3">{t("analyst.disclaimer")}</p>
                  </div>
                )}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
