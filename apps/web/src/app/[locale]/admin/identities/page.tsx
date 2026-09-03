"use client";

/**
 * People.
 *
 * A directory that answers the operator's questions in the row itself: is this identity trusted,
 * how many devices does it carry, is the credential still valid — and, for an administrator, what
 * a revocation would actually cascade to before they run it.
 */
import { useMemo, useState } from "react";
import type { AttestationBody } from "@vajra/contracts";
import { api, consoleAttestation, type IdentityRow } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { useMe } from "@/components/AppShell";
import { useEntity } from "@/components/EntityDrawer";
import { StepUpModal, useAsync } from "@/components/trust";
import type { Challenge } from "@/components/LivenessCapture";
import { DataCell, DataRow, DataTable, FilterBar, IdTag, OpsHeader, Panel, SelectInput, StatBand, StateDot, TextInput } from "@/components/console";
import { Button, Dialog, ErrorNote, Field, HashValue, Skeleton, cx, inputClass, toneForTrust } from "@/components/ui";

const DEMO_IDENTITIES = ["Asha Rao", "Vikram Nair", "Meera Iyer", "Rohan Desai"];

export default function Identities() {
  const { t, dt, n } = useI18n();
  const { me } = useMe();
  const { open } = useEntity();
  const identities = useAsync(() => api.identities(), []);

  const [term, setTerm] = useState("");
  const [role, setRole] = useState("");
  const [target, setTarget] = useState<IdentityRow | null>(null);
  const [reason, setReason] = useState("");
  const [challenge, setChallenge] = useState<{ nonce: string; challenge: Challenge[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ steps: { step: string; count: number }[] } | null>(null);

  const isDemoIdentity = !!me && DEMO_IDENTITIES.includes(me.user.displayName);
  const all = useMemo(() => identities.data ?? [], [identities.data]);
  const rows = useMemo(() => {
    const q = term.trim().toLowerCase();
    return all.filter((i) => {
      if (role && i.role !== role) return false;
      if (!q) return true;
      return [i.displayName, i.did, i.role].some((f) => f && f.toLowerCase().includes(q));
    });
  }, [all, term, role]);

  const bands = useMemo(
    () => ({
      active: all.filter((i) => i.status === "active").length,
      degraded: all.filter((i) => i.status === "active" && i.identityTrust < 65).length,
      revoked: all.filter((i) => i.status !== "active").length,
      devices: all.reduce((sum, i) => sum + i.devices.length, 0),
    }),
    [all],
  );

  const begin = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const ch = await api.revokeChallenge(target.did);
      // A console session has no face to capture and no key to sign the nonce with; the gateway
      // takes the issued link as the authorisation instead. See lib/api.ts `consoleAttestation`.
      if (me?.consoleSession) return void revoke(consoleAttestation(ch.nonce));
      setChallenge({ nonce: ch.nonce, challenge: ch.challenge as Challenge[] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (attestation: AttestationBody) => {
    if (!target) return;
    setChallenge(null);
    setBusy(true);
    try {
      const res = await api.revoke(target.did, { reason, attestation });
      setDone({ steps: res.steps });
      setTarget(null);
      setReason("");
      identities.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <OpsHeader title={t("console.identity.title")} meta={<span>{t("identities.subtitle")}</span>} />

      {error && <ErrorNote message={error} />}
      {done && (
        <Panel className="mb-3 border-oxide-line" title={t("identities.revoked", { steps: String(done.steps.length) })}>
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {done.steps.map((s) => (
              <li key={s.step} className="flex items-baseline justify-between gap-3 border-b border-line-faint py-1.5 text-[0.8125rem] text-oxide last:border-0">
                <span className="flex min-w-0 items-baseline gap-2">
                  <StateDot tone="bad" />
                  <span className="truncate">{t(`identities.cascadeSteps.${s.step}`)}</span>
                </span>
                <span className="tnum shrink-0 font-mono text-[0.75rem]">{n(s.count)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <StatBand
        className="mb-4"
        items={[
          { label: t("console.overview.identityTrusted"), value: n(bands.active - bands.degraded), tone: "good" },
          { label: t("console.overview.identityDegraded"), value: n(bands.degraded), tone: bands.degraded > 0 ? "warn" : "neutral" },
          { label: t("console.overview.identityRevoked"), value: n(bands.revoked), tone: bands.revoked > 0 ? "bad" : "neutral" },
          { label: t("console.identity.devices"), value: n(bands.devices) },
        ]}
      />

      <FilterBar className="mb-3">
        <TextInput className="min-w-[200px]" label={t("console.audit.searchPlaceholder")} value={term} onChange={setTerm} placeholder="did:key:… " mono />
        <SelectInput
          label={t("console.identity.cols.role")}
          value={role}
          onChange={setRole}
          options={[{ value: "", label: t("common.all") }, ...(["engineer", "manager", "auditor", "admin"] as const).map((r) => ({ value: r, label: t(`roles.${r}`) }))]}
        />
      </FilterBar>

      {identities.loading && !identities.data && <Skeleton className="h-64" />}

      <Panel title={t("console.identity.people")} meta={`${n(rows.length)} / ${n(all.length)}`} flush>
        <DataTable
          minWidth={940}
          cols={[
            t("console.identity.cols.person"),
            t("console.identity.cols.role"),
            t("console.identity.cols.status"),
            { label: t("console.identity.cols.trust"), align: "right", width: "80px" },
            t("console.identity.cols.devices"),
            t("console.identity.cols.credential"),
            t("console.identity.cols.enrolled"),
            "",
          ]}
        >
          {rows.map((i) => {
            const tone = toneForTrust(i.identityTrust);
            return (
              <DataRow key={i.did} onClick={() => open({ kind: "person", id: i.did })} tone={i.status !== "active" ? "bad" : undefined}>
                <DataCell strong>
                  <span className="flex flex-col">
                    <span>{i.displayName}</span>
                    <HashValue value={i.did} chars={10} />
                  </span>
                </DataCell>
                <DataCell>{t(`roles.${i.role}`)}</DataCell>
                <DataCell>
                  <span className="flex items-center gap-1.5">
                    <StateDot tone={i.status === "active" ? "good" : "bad"} />
                    {i.status === "active" ? t("identities.statusActive") : i.status === "suspended" ? t("identities.statusSuspended") : t("identities.statusRevoked")}
                  </span>
                </DataCell>
                <DataCell mono align="right">
                  <span className={cx(tone === "good" ? "text-verdigris" : tone === "warn" ? "text-saffron" : "text-oxide")}>{n(i.identityTrust)}</span>
                </DataCell>
                <DataCell>
                  <span className="flex flex-wrap gap-1">
                    {i.devices.length === 0 && <span className="text-ink-3">—</span>}
                    {i.devices.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        title={d.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          open({ kind: "device", id: d.id });
                        }}
                        className="rounded-[var(--radius-tag)] transition-[filter] duration-150 ease-out hover:brightness-95 active:translate-y-px"
                      >
                        <IdTag tone={d.trusted ? "good" : "warn"}>
                          <StateDot tone={d.trusted ? "good" : "warn"} />
                          {n(d.deviceTrust)}
                        </IdTag>
                      </button>
                    ))}
                  </span>
                </DataCell>
                <DataCell mono>{i.credential ? <HashValue value={i.credential.vcHash} chars={6} /> : "—"}</DataCell>
                <DataCell mono nowrap>
                  {dt(i.createdAt, { dateStyle: "short" })}
                </DataCell>
                <DataCell align="right">
                  {me?.user.role === "admin" && i.status === "active" && i.did !== me.user.did && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTarget(i);
                      }}
                    >
                      {t("identities.revoke")}
                    </Button>
                  )}
                </DataCell>
              </DataRow>
            );
          })}
        </DataTable>
      </Panel>

      <p className="mt-3 rounded-[var(--radius-field)] border border-line-faint bg-overlay-1 px-3 py-2 text-[0.75rem] leading-relaxed text-ink-3">{t("console.identity.revokeCascade")}</p>

      <Dialog open={!!target} onClose={() => setTarget(null)} title={target ? t("identities.revokeTitle", { name: target.displayName }) : ""}>
        <div className="space-y-4">
          <p className="text-[0.875rem] leading-relaxed text-ink-2">{t("identities.revokeBody")}</p>
          <Field label={t("identities.revokeReason")}>
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <p className="text-[0.8125rem] text-ink-3">{t("identities.revokeNote")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => void begin()}>
              {t("identities.revokeConfirm")}
            </Button>
          </div>
        </div>
      </Dialog>

      <StepUpModal
        open={!!challenge}
        onClose={() => setChallenge(null)}
        nonce={challenge?.nonce ?? null}
        challenge={challenge?.challenge ?? []}
        title={t("identities.revokeConfirm")}
        body={t("identities.revokeNote")}
        demoRole={isDemoIdentity}
        onAttested={(a) => void revoke(a)}
      />
    </>
  );
}
