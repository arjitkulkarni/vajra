"use client";

/**
 * Approval queue.
 *
 * The two-person rule is the product's strongest control, so the review screen shows the approver
 * everything the engine already knew — requester, trust, risk, the policy that demanded a second
 * person — and then asks them to prove they are live before their decision is recorded.
 */
import { useState } from "react";
import { api, consoleAttestation, type ApprovalItem } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { useMe } from "@/components/AppShell";
import { useEntity } from "@/components/EntityDrawer";
import { StepUpModal, useAsync } from "@/components/trust";
import type { Challenge } from "@/components/LivenessCapture";
import { DataCell, DataRow, DataTable, Drawer, IdTag, KeyValues, OpsHeader, Panel, StateDot, TextInput, VerdictStamp } from "@/components/console";
import { Button, Chip, ErrorNote, Skeleton, cx, toneForRisk, toneForTrust } from "@/components/ui";

const DEMO_IDENTITIES = ["Asha Rao", "Vikram Nair", "Meera Iyer", "Rohan Desai"];

export default function Approvals() {
  const { t, dt, n } = useI18n();
  const { me } = useMe();
  const { open } = useEntity();
  const data = useAsync(() => api.approvals(), []);

  const [review, setReview] = useState<ApprovalItem | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<{ approval: ApprovalItem; approve: boolean; reason: string } | null>(null);
  const [challenge, setChallenge] = useState<{ nonce: string; challenge: Challenge[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const isDemoIdentity = !!me && DEMO_IDENTITIES.includes(me.user.displayName);
  const inbox = (data.data?.inbox ?? []).filter((a) => a.status === "pending");
  const decided = (data.data?.inbox ?? []).filter((a) => a.status !== "pending");

  const begin = async (approval: ApprovalItem, approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const ch = await api.approvalChallenge(approval.id);
      const next = { approval, approve, reason };
      setPending(next);
      // A console session has no enrolled face and no browser-held key, so the step-up dialog would
      // open, ask for a capture, and have nothing to sign the nonce with. The gateway already
      // accepts the link itself as the authorisation — see lib/api.ts `consoleAttestation`.
      //
      // `next` is passed through explicitly rather than read back off state: setPending has not
      // committed yet at this point, and `decide` would find the previous value.
      if (me?.consoleSession) return void decide(consoleAttestation(ch.nonce), next);
      setChallenge({ nonce: ch.nonce, challenge: ch.challenge as Challenge[] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (
    attestation: { nonce: string; signature: string; livenessMode: "faceapi" | "simulated" },
    explicit?: { approval: ApprovalItem; approve: boolean; reason: string },
  ) => {
    const pendingNow = explicit ?? pending;
    if (!pendingNow) return;
    setChallenge(null);
    setBusy(true);
    try {
      const res = await api.approvalDecide(pendingNow.approval.id, { approve: pendingNow.approve, reason: pendingNow.reason || undefined, attestation });
      setDone(res.status === "approved" ? t("approvals.approved") : t("approvals.rejected"));
      setReview(null);
      setReason("");
      data.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <>
      <OpsHeader
        title={t("console.approvals.queue")}
        meta={<span>{t("approvals.subtitle")}</span>}
        status={<IdTag tone={inbox.length > 0 ? "steel" : "neutral"}>{t("console.approvals.pending", { n: n(inbox.length) })}</IdTag>}
      />

      {error && <ErrorNote message={error} />}
      {done && (
        <p role="status" className="tick mb-4 flex items-center gap-2 rounded-[var(--radius-field)] border border-verdigris-line bg-verdigris-soft px-3.5 py-2.5 text-[0.8125rem] text-verdigris">
          <span aria-hidden className="font-mono leading-none">
            ✓
          </span>
          {done}
        </p>
      )}
      {data.loading && !data.data && <Skeleton className="h-48" />}

      <Panel title={t("approvals.inbox")} flush className="mb-4">
        {inbox.length === 0 ? (
          <p className="m-3 rounded-[var(--radius-field)] border border-dashed border-line-strong bg-overlay-1 px-3 py-10 text-center text-[0.8125rem] text-ink-3">{t("console.approvals.emptyQueue")}</p>
        ) : (
          <ul className="divide-y divide-line-faint">
            {inbox.map((a, i) => (
              <li
                key={a.id}
                style={{ animationDelay: `${i * 40}ms` }}
                className="tick flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 transition-[background-color] duration-150 ease-out hover:bg-overlay-1"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-ink">{a.request ? t(`actions.${a.request.action}`) : "—"}</span>
                    {a.request?.assetUid && (
                      <button
                        type="button"
                        onClick={() => a.request?.assetUid && open({ kind: "asset", id: a.request.assetUid })}
                        className="rounded-[var(--radius-tag)] transition-[filter,transform] duration-150 ease-out hover:brightness-95 active:translate-y-px"
                      >
                        <IdTag tone="brass">{a.request.assetUid}</IdTag>
                      </button>
                    )}
                  </span>
                  <span className="truncate text-[0.75rem] text-ink-3">
                    {t("approvals.requestedBy")}: {a.requester.displayName ?? "—"}
                    {a.requester.role ? ` · ${t(`roles.${a.requester.role}`)}` : ""} · {t("trust.identity")} {n(a.requester.identityTrust ?? 0)}
                    {a.request?.toDid ? ` · ${t("console.approvals.requestedTo")} ${a.request.toDid.slice(0, 18)}…` : ""}
                  </span>
                </span>
                {a.request && (
                  <IdTag tone={toneForRisk(a.request.risk.tier)}>
                    {t("risk.label")} {n(a.request.risk.score)} · {t(`risk.${a.request.risk.tier}`)}
                  </IdTag>
                )}
                <IdTag tone="neutral">{t(`roles.${a.requiredRole}`)}</IdTag>
                <span className="tnum font-mono text-[0.6875rem] text-ink-3">{dt(a.createdAt, { dateStyle: "short", timeStyle: "short" })}</span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setReason("");
                    setReview(a);
                  }}
                >
                  {t("console.approvals.review")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {decided.length > 0 && (
        <Panel title={t("console.approvals.decided")} flush className="mb-4">
          <DataTable minWidth={640} cols={[t("console.request.cols.when"), t("console.request.cols.action"), t("console.request.cols.asset"), t("approvals.requestedBy"), t("console.incident.cols.status")]}>
            {decided.map((a) => (
              <DataRow key={a.id}>
                <DataCell mono nowrap>
                  {dt(a.decidedAt ?? a.createdAt, { dateStyle: "short", timeStyle: "short" })}
                </DataCell>
                <DataCell strong>{a.request ? t(`actions.${a.request.action}`) : "—"}</DataCell>
                <DataCell mono>{a.request?.assetUid ?? "—"}</DataCell>
                <DataCell>{a.requester.displayName ?? "—"}</DataCell>
                <DataCell>
                  <Chip tone={a.status === "approved" ? "good" : a.status === "rejected" ? "bad" : "neutral"}>{t(`approvals.${a.status}`)}</Chip>
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        </Panel>
      )}

      <Panel title={t("console.approvals.history")} flush>
        {(data.data?.mine ?? []).length === 0 ? (
          <p className="m-3 rounded-[var(--radius-field)] border border-dashed border-line-strong bg-overlay-1 px-3 py-8 text-center text-[0.8125rem] text-ink-3">{t("approvals.emptyMine")}</p>
        ) : (
          <DataTable minWidth={640} cols={[t("console.request.cols.when"), t("console.request.cols.action"), t("console.request.cols.asset"), t("console.approvals.approver"), t("console.incident.cols.status")]}>
            {(data.data?.mine ?? []).map((a) => (
              <DataRow key={a.id}>
                <DataCell mono nowrap>
                  {dt(a.createdAt, { dateStyle: "short", timeStyle: "short" })}
                </DataCell>
                <DataCell strong>{a.request ? t(`actions.${a.request.action}`) : "—"}</DataCell>
                <DataCell mono>{a.request?.assetUid ?? "—"}</DataCell>
                <DataCell mono>{a.approverDid ? a.approverDid.slice(0, 18) + "…" : t(`roles.${a.requiredRole}`)}</DataCell>
                <DataCell>
                  <Chip tone={a.status === "approved" ? "good" : a.status === "rejected" ? "bad" : a.status === "cancelled" ? "neutral" : "warn"}>{t(`approvals.${a.status}`)}</Chip>
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
      </Panel>

      {/* Review: everything the engine knew, then a live check. */}
      <Drawer
        open={!!review}
        onClose={() => setReview(null)}
        closeLabel={t("common.close")}
        title={review?.request ? t(`actions.${review.request.action}`) : t("console.approvals.review")}
        subtitle={review?.request?.assetUid ?? undefined}
        width={460}
        footer={
          review && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-[0.75rem] text-ink-3">
                <StateDot tone="warn" />
                {t("console.approvals.liveRequired")}
              </p>
              <div className="flex gap-2">
                <Button variant="primary" size="sm" className="flex-1" disabled={busy} onClick={() => void begin(review, true)}>
                  {t("console.approvals.verifyApprove")}
                </Button>
                <Button variant="danger" size="sm" className="flex-1" disabled={busy} onClick={() => void begin(review, false)}>
                  {t("console.approvals.verifyReject")}
                </Button>
              </div>
            </div>
          )
        }
      >
        {review && (
          <div className="space-y-4">
            <KeyValues
              items={[
                { k: t("console.approvals.requester"), v: review.requester.displayName ?? "—" },
                { k: t("console.approvals.approver"), v: t("console.approvals.you") },
                { k: t("console.request.cols.asset"), v: review.request?.assetUid ?? "—", mono: true },
                { k: t("console.approvals.requiredApproval"), v: t(`roles.${review.requiredRole}`) },
              ]}
            />

            <Panel title={t("console.approvals.whyRequest")}>
              <p className="text-[0.875rem] leading-relaxed text-ink">{review.reason?.trim() || t("console.approvals.noReason")}</p>
            </Panel>

            <Panel title={t("console.request.scores")}>
              <KeyValues
                items={[
                  { k: t("trust.identity"), v: n(review.request?.trust.identity ?? review.requester.identityTrust ?? 0), mono: true },
                  { k: t("trust.device"), v: n(review.request?.trust.device ?? 0), mono: true },
                  {
                    k: t("console.request.requestRisk"),
                    v: review.request ? (
                      <span className={cx(toneForRisk(review.request.risk.tier) === "bad" ? "text-oxide" : toneForRisk(review.request.risk.tier) === "warn" ? "text-saffron" : "text-verdigris")}>
                        {n(review.request.risk.score)} · {t(`risk.${review.request.risk.tier}`)}
                      </span>
                    ) : (
                      "—"
                    ),
                    mono: true,
                  },
                ]}
              />
              {review.request && review.request.risk.signals.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line-faint pt-2.5">
                  {review.request.risk.signals.map((s) => (
                    <Chip key={s} tone="warn">
                      {t(`risk.signals.${s}`)}
                    </Chip>
                  ))}
                </div>
              )}
            </Panel>

            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={(review.requester.identityTrust ?? 0) >= 65 ? "good" : "warn"}>
                {(review.requester.identityTrust ?? 0) >= 65 ? "✓" : "⚠"} {t("console.approvals.requesterVerified")}
              </Chip>
              <Chip tone="neutral">{t("console.approvals.distinct")}</Chip>
              {review.request && <VerdictStamp size="sm" verdict="PENDING_APPROVAL" label={t("verdict.PENDING_APPROVAL")} />}
            </div>

            <TextInput label={t("approvals.reason")} value={reason} onChange={setReason} placeholder={t("approvals.reasonPlaceholder")} />
          </div>
        )}
      </Drawer>

      <StepUpModal
        open={!!challenge}
        onClose={() => {
          setChallenge(null);
          setPending(null);
        }}
        nonce={challenge?.nonce ?? null}
        challenge={challenge?.challenge ?? []}
        title={t("console.approvals.yourVerification")}
        body={t("console.approvals.liveRequired")}
        demoRole={isDemoIdentity}
        onAttested={(a) => void decide(a)}
      />
    </>
  );
}
