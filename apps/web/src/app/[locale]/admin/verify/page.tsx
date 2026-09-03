"use client";

/**
 * Proof-of-Action.
 *
 * Deliberately styled as an official certificate rather than a crypto artefact: an action, an actor,
 * a decision, the policy version it was taken under, the scores at the time, and the ledger
 * coordinates — then a signature check that runs against the document and the ledger alone.
 *
 * DAYLIGHT: the certificate is the one editorial surface in the console, so it sits at the card
 * radius while every panel around it stays at the tighter instrument rung. Its frame is a hairline,
 * not a 2px rule — the document reads as a document because of its rhythm and its seal, not because
 * it is outlined twice, and on white a heavy border would fence it off from the page rather than
 * lift it off one. The seal carries the same three cues as a VerdictStamp (rim, wash, glyph) and
 * strikes when a verdict actually lands.
 */
import { useEffect, useState } from "react";
import type { ProofOfAction } from "@vajra/contracts";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { ProofChecks, useAsync } from "@/components/trust";
import { useEntity } from "@/components/EntityDrawer";
import { IdTag, KeyValues, OpsHeader, Panel, StateDot, TextInput, VerdictStamp } from "@/components/console";
import { Button, Chip, ErrorNote, HashValue, Icon, Skeleton, cx } from "@/components/ui";

/** Cross-reference links inside the certificate: brass is agency, so it brightens and never darkens. */
const CERT_LINK =
  "-mx-1 inline-flex items-center rounded-[var(--radius-tag)] px-1 font-mono text-[0.9375rem] text-brass transition-[color,background-color] duration-150 ease-out hover:bg-brass-soft/40 hover:text-brass-deep active:translate-y-px";

export default function ProofsPage() {
  const { t, dt, n } = useI18n();
  const { open } = useEntity();

  const [certId, setCertId] = useState("");
  const [proof, setProof] = useState<ProofOfAction | null>(null);
  const [loading, setLoading] = useState(false);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ valid: boolean; checks: { id: string; ok: boolean; detailKey?: string }[]; kind: "proof" | "evidence"; meta?: string } | null>(null);

  // Recent certificates give the page something to show before anyone pastes anything. The failure
  // is not swallowed: an empty shortlist that actually means "we could not ask" would have an
  // auditor conclude no certificates were ever issued, which is the one wrong answer this page
  // exists to prevent.
  const recent = useAsync(() => api.requests(40), []);
  const issued = (recent.data ?? []).filter((r) => r.certId);

  const load = async (id: string) => {
    if (!id.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const p = await api.proof(id.trim());
      setProof(p);
      setRaw(JSON.stringify(p, null, 2));
    } catch (e) {
      setProof(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("cert");
    if (wanted) {
      setCertId(wanted);
      void load(wanted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if ("packageHash" in parsed) {
        const res = await api.verifyEvidence(parsed);
        setResult({ valid: res.valid, checks: res.checks, kind: "evidence", meta: `${res.packageId} · ${res.events} events · ${res.proofs} proofs` });
      } else {
        const res = await api.verifyProof(parsed);
        setResult({ valid: res.valid, checks: res.checks, kind: "proof", meta: String(parsed.certId ?? "") });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <OpsHeader
        title={t("console.proofs.title")}
        meta={<span>{t("console.proofs.subtitle")}</span>}
        actions={
          <span className="flex items-end gap-2">
            <TextInput label={t("console.proofs.lookup")} value={certId} onChange={setCertId} placeholder={t("console.proofs.lookupPlaceholder")} onEnter={() => void load(certId)} mono />
            <Button size="sm" variant="primary" loading={loading} onClick={() => void load(certId)}>
              {t("console.proofs.open")}
            </Button>
          </span>
        }
      />

      {error && <ErrorNote message={error} />}

      <div className={cx("grid gap-4 lg:grid-cols-[1fr_360px]", error && "mt-4")}>
        <div className="space-y-4">
          {loading && <Skeleton className="h-96" />}

          {proof && (
            <article className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper-2/70 px-5 py-3.5">
                <div>
                  <p className="eyebrow">{t("console.proofs.certificate")}</p>
                  <p className="mt-0.5 tnum font-mono text-[0.9375rem] font-medium text-ink">{proof.certId}</p>
                </div>
                <VerdictStamp size="lg" verdict={proof.decision} label={t(`verdict.${proof.decision}`)} />
              </header>

              <div className="grid gap-x-8 gap-y-5 px-5 py-5 sm:grid-cols-2">
                <section>
                  <p className="eyebrow mb-1.5">{t("console.proofs.action")}</p>
                  <p className="text-[1.0625rem] leading-tight text-ink">{t(`actions.${proof.action}`)}</p>
                  <p className="mt-1 tnum font-mono text-[0.75rem] text-ink-3">{dt(proof.decidedAt, { dateStyle: "medium", timeStyle: "medium" })}</p>
                </section>

                <section>
                  <p className="eyebrow mb-1.5">{t("console.proofs.subject")}</p>
                  {proof.asset ? (
                    <button type="button" onClick={() => proof.asset && open({ kind: "asset", id: proof.asset })} className={CERT_LINK}>
                      {proof.asset}
                      {proof.version !== null && <span className="text-ink-3"> · v{n(proof.version)}</span>}
                    </button>
                  ) : (
                    <p className="text-ink-3">—</p>
                  )}
                </section>

                <section>
                  <p className="eyebrow mb-1.5">{t("console.proofs.actor")}</p>
                  <HashValue value={proof.actor} chars={12} />
                  <p className="mt-1 tnum font-mono text-[0.75rem] text-ink-3">{proof.device.slice(0, 20)}…</p>
                </section>

                <section>
                  <p className="eyebrow mb-1.5">{t("console.proofs.policy")}</p>
                  {proof.policy ? (
                    <>
                      <button type="button" onClick={() => proof.policy && open({ kind: "policy", id: proof.policy.id })} className={CERT_LINK}>
                        {proof.policy.key} · v{n(proof.policy.version)}
                      </button>
                      <p className="mt-1">
                        <HashValue value={proof.policy.hash} chars={8} />
                      </p>
                    </>
                  ) : (
                    <p className="text-ink-3">—</p>
                  )}
                </section>

                <section>
                  <p className="eyebrow mb-1.5">{t("console.proofs.trust")}</p>
                  <KeyValues
                    items={[
                      { k: t("trust.identity"), v: n(proof.trust.identity), mono: true },
                      { k: t("trust.device"), v: n(proof.trust.device), mono: true },
                      { k: t("trust.asset"), v: proof.trust.asset !== null ? n(proof.trust.asset) : "—", mono: true },
                    ]}
                  />
                </section>

                <section>
                  <p className="eyebrow mb-1.5">{t("console.proofs.risk")}</p>
                  {/* oxide / saffron / verdigris are the risk tiers themselves — the word beside the
                      number is what carries the tier for anyone who cannot separate the hues. */}
                  <p
                    className={cx(
                      "font-display text-[1.5rem] font-semibold leading-none tnum",
                      proof.risk.tier === "high" ? "text-oxide" : proof.risk.tier === "elevated" ? "text-saffron" : "text-verdigris",
                    )}
                  >
                    {n(proof.risk.score)}
                    <span className="ml-2 font-sans text-[0.8125rem] font-medium uppercase tracking-[0.06em]">{t(`risk.${proof.risk.tier}`)}</span>
                  </p>
                  {proof.risk.signals.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {proof.risk.signals.map((s) => (
                        <Chip key={s} tone="warn">
                          {t(`risk.signals.${s}`)}
                        </Chip>
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  <p className="eyebrow mb-1.5">{t("console.proofs.liveProof")}</p>
                  {proof.liveness ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <StateDot tone={proof.liveness.verified ? "good" : "bad"} />
                      <span className={cx("text-[0.875rem]", proof.liveness.verified ? "text-ink" : "text-oxide")}>
                        {proof.liveness.verified ? t("console.proofs.liveVerified") : t("verify.invalid")}
                      </span>
                      <IdTag tone="neutral">{proof.liveness.mode}</IdTag>
                    </span>
                  ) : (
                    <p className="text-[0.875rem] text-ink-3">{t("console.proofs.liveNone")}</p>
                  )}
                </section>

                <section>
                  <p className="eyebrow mb-1.5">{t("console.proofs.approval")}</p>
                  {proof.approvals.length === 0 ? (
                    <p className="text-[0.875rem] text-ink-3">{t("console.proofs.noApproval")}</p>
                  ) : (
                    <ul className="space-y-1">
                      {proof.approvals.map((a) => (
                        <li key={a.approver} className="flex items-center gap-2">
                          <StateDot tone="good" />
                          <HashValue value={a.approver} chars={8} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              {/* The ledger coordinates are the machine half of the document: one overlay step off
                  the ground, which is the rest rung of the elevation ladder. */}
              <div className="border-t border-line bg-overlay-1 px-5 py-4">
                <p className="eyebrow mb-2">{t("console.proofs.ledgerSection")}</p>
                <KeyValues
                  columns={2}
                  items={[
                    { k: t("console.proofs.eventHash"), v: <HashValue value={proof.audit.chainHash} chars={10} />, mono: true },
                    { k: t("console.proofs.prevHash"), v: <HashValue value={proof.audit.prevHash} chars={10} />, mono: true },
                    { k: t("console.proofs.transaction"), v: proof.audit.ledgerTxId ? <HashValue value={proof.audit.ledgerTxId} chars={10} /> : t("audit.notAnchored"), mono: true },
                    { k: t("console.proofs.block"), v: proof.audit.block !== null ? `#${n(proof.audit.block)}` : "—", mono: true },
                  ]}
                />
              </div>

              <footer className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
                {/* Keyed on the outcome so the seal re-strikes when a verdict arrives instead of
                    silently swapping colour under the operator's eye. */}
                <span
                  key={result === null ? "idle" : result.valid ? "valid" : "invalid"}
                  className={cx(
                    "stamp inline-flex items-center gap-2 rounded-[var(--radius-tag)] border-2 px-3 py-1 font-display text-[0.9375rem] font-semibold uppercase tracking-[0.05em]",
                    result === null
                      ? "border-line-strong bg-paper-2 text-ink-3"
                      : result.valid
                        ? "border-verdigris bg-verdigris-soft/50 text-verdigris"
                        : "border-oxide bg-oxide-soft/50 text-oxide",
                  )}
                >
                  {result === null ? Icon.shield : result.valid ? Icon.check : Icon.cross}
                  {result === null ? t("console.proofs.signatureValid") : result.valid ? t("verify.valid") : t("verify.invalid")}
                </span>
                <Button size="sm" variant="primary" loading={busy} onClick={() => void verify()}>
                  {t("console.proofs.verifyIndependently")}
                </Button>
                <a
                  className="inline-flex rounded-[var(--radius-control)]"
                  href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(proof, null, 2))}`}
                  download={`${proof.certId}.json`}
                >
                  <Button size="sm" variant="ghost" tabIndex={-1}>
                    {t("console.proofs.download")}
                  </Button>
                </a>
                <span className="ml-auto font-mono text-[0.6875rem] text-ink-3">{proof.issuer}</span>
              </footer>
            </article>
          )}

          {!proof && !loading && (
            <Panel title={t("console.proofs.certificate")}>
              <div className="py-10 text-center">
                <span
                  aria-hidden
                  className="mx-auto mb-2.5 grid h-9 w-9 place-items-center rounded-[var(--radius-pill)] border border-dashed border-line-strong font-mono text-[0.9375rem] leading-none text-ink-3"
                >
                  ◆
                </span>
                <p className="text-[0.875rem] text-ink-3">{t("console.proofs.orPaste")}</p>
              </div>
              {recent.error && (
                <div className="border-t border-line pt-3">
                  <ErrorNote message={recent.error} onRetry={recent.reload} retryLabel={t("common.retry")} />
                </div>
              )}
              {issued.length > 0 && (
                <ul className="border-t border-line pt-1.5">
                  {issued.slice(0, 8).map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setCertId(r.certId!);
                          void load(r.certId!);
                        }}
                        className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2 py-1.5 text-left transition-[color,background-color] duration-150 ease-out hover:bg-paper-2 active:translate-y-px active:bg-paper-3"
                      >
                        <span className="tnum font-mono text-[0.75rem] text-brass">{r.certId}</span>
                        <span className="truncate text-[0.75rem] text-ink-3">{t(`actions.${r.action}`)}</span>
                        <span className="ml-auto shrink-0 tnum font-mono text-[0.6875rem] text-ink-3">{dt(r.decidedAt, { dateStyle: "short", timeStyle: "short" })}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title={t("verify.title")} meta={t("verify.subtitle")}>
            {/* The well is only ~6% below the ground, so it takes its own hairline rather than
                relying on fill alone, and focus lands the brass rim instead of a soft halo ring. */}
            <textarea
              className="console-scroll h-64 w-full resize-none rounded-[var(--radius-control)] border border-line bg-console px-2.5 py-2 font-mono text-[0.6875rem] leading-relaxed text-console-text transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-console-muted hover:border-line-strong focus:border-brass focus:shadow-arc"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={t("verify.placeholder")}
              spellCheck={false}
            />
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="primary" loading={busy} disabled={!raw.trim()} onClick={() => void verify()}>
                {busy ? t("verify.verifying") : t("verify.verify")}
              </Button>
              {raw && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRaw("");
                    setResult(null);
                    setError(null);
                  }}
                >
                  {t("common.reset")}
                </Button>
              )}
            </div>
          </Panel>

          {result && (
            <Panel title={result.kind === "evidence" ? t("incidents.generateEvidence") : t("console.proofs.certificate")} meta={result.meta}>
              <div
                className={cx(
                  "mb-3 flex items-center gap-2 rounded-[var(--radius-field)] border px-3 py-2",
                  result.valid ? "border-verdigris-line bg-verdigris-soft/50" : "border-oxide-line bg-oxide-soft/60",
                )}
              >
                <StateDot tone={result.valid ? "good" : "bad"} />
                <span className={cx("text-[0.875rem] font-semibold uppercase tracking-[0.05em]", result.valid ? "text-verdigris" : "text-oxide")}>
                  {result.valid ? t("verify.valid") : t("verify.invalid")}
                </span>
                <span aria-hidden className={cx("ml-auto font-mono text-[0.875rem] leading-none", result.valid ? "text-verdigris" : "text-oxide")}>
                  {result.valid ? Icon.check : Icon.cross}
                </span>
              </div>
              <ProofChecks checks={result.checks} />
              <p className="mt-3 text-[0.75rem] leading-snug text-ink-3">{t("verify.tryTampering")}</p>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
