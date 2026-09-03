"use client";

/**
 * The enrolment queue — where an administrator lets someone into the product, or does not.
 *
 * The reviewer sees the two images the decision is actually about, side by side: the employee ID
 * card that was uploaded and the frame the live check scored. Underneath are the five gates as they
 * were evaluated, the confidence numbers, and the hashes — so approving is an informed act rather
 * than a click on a name.
 *
 * The decision itself carries the administrator's own liveness attestation and goes on chain
 * through the `IdentityVerification` contract, which refuses a second decision and refuses one made
 * by the person enrolling.
 */
import { useCallback, useEffect, useState } from "react";
import type { AttestationBody, EnrolmentSummary } from "@vajra/contracts";
import { api, consoleAttestation, GatewayError } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { useMe } from "@/components/AppShell";
import { useAsync } from "@/components/trust";
import { VerificationBundle } from "@/components/VerificationBundle";
import { LivenessCapture, type Challenge, type LivenessResult } from "@/components/LivenessCapture";
import { DataCell, DataRow, DataTable, Drawer, IdTag, KeyValues, OpsHeader, Panel, Segmented, StateDot } from "@/components/console";
import { Button, Card, Chip, cx, EmptyState, ErrorNote, Field, HashValue, Icon, inputClass, Meter, Skeleton, Spinner, toneForTrust } from "@/components/ui";

type Filter = "pending" | "approved" | "denied" | "all";

export default function Signups() {
  const { t, dt, n } = useI18n();
  const [filter, setFilter] = useState<Filter>("pending");
  const [selected, setSelected] = useState<EnrolmentSummary | null>(null);
  const list = useAsync(() => api.enrolments(filter === "all" ? undefined : filter), [filter]);

  const rows = list.data ?? [];

  return (
    <>
      <OpsHeader
        title={t("admin.signups.title")}
        meta={<span>{t("admin.signups.meta")}</span>}
        actions={
          <Button size="sm" onClick={list.reload}>
            {t("common.refresh")}
          </Button>
        }
      />

      {list.error && <ErrorNote message={list.error} onRetry={list.reload} retryLabel={t("common.retry")} />}

      <div className="mb-3">
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={[
            { value: "pending", label: t("admin.signups.filters.pending"), count: filter === "pending" ? rows.length : undefined },
            { value: "approved", label: t("admin.signups.filters.approved") },
            { value: "denied", label: t("admin.signups.filters.denied") },
            { value: "all", label: t("admin.signups.filters.all") },
          ]}
        />
      </div>

      {list.loading && !list.data ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState title={t("admin.signups.emptyTitle")} body={t("admin.signups.emptyBody")} />
      ) : (
        <Panel flush>
          <DataTable
            minWidth={880}
            cols={[
              t("signup.employeeId"),
              t("signup.displayName"),
              t("onboard.role"),
              { label: t("verify.matchScore"), align: "right" },
              { label: t("verify.gates.liveness"), align: "right" },
              t("admin.signups.status"),
              t("admin.signups.submitted"),
            ]}
          >
            {rows.map((e) => (
              <DataRow key={e.id} onClick={() => setSelected(e)} tone={e.status === "denied" ? "bad" : undefined}>
                <DataCell mono strong>
                  {e.employeeId}
                </DataCell>
                <DataCell>{e.displayName}</DataCell>
                <DataCell>{t(`roles.${e.requestedRole}`)}</DataCell>
                <DataCell mono align="right">
                  {n(e.faceMatchScore)}
                </DataCell>
                <DataCell mono align="right">
                  {n(e.livenessScore)}
                </DataCell>
                <DataCell>
                  <IdTag tone={e.status === "approved" ? "good" : e.status === "denied" ? "bad" : "warn"}>
                    <StateDot tone={e.status === "approved" ? "good" : e.status === "denied" ? "bad" : "warn"} pulse={e.status === "pending"} />
                    {t(`admin.signups.filters.${e.status}`)}
                  </IdTag>
                </DataCell>
                <DataCell mono muted nowrap>
                  {dt(e.createdAt, { dateStyle: "short", timeStyle: "short" })}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        </Panel>
      )}

      <Review
        enrolment={selected}
        onClose={() => setSelected(null)}
        onDecided={() => {
          setSelected(null);
          list.reload();
        }}
      />
    </>
  );
}

// ─── review drawer ───────────────────────────────────────────────────────────

type Phase = "review" | "attest" | "saving";

function Review({ enrolment, onClose, onDecided }: { enrolment: EnrolmentSummary | null; onClose: () => void; onDecided: () => void }) {
  const { t, dt, n } = useI18n();
  const { me } = useMe();
  const [phase, setPhase] = useState<Phase>("review");
  const [approve, setApprove] = useState(true);
  const [reason, setReason] = useState("");
  const [challenge, setChallenge] = useState<{ nonce: string; challenge: Challenge[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<{ card: string | null; face: string | null }>({ card: null, face: null });

  // Fetch and decrypt both images with the session token, then hand the page object URLs.
  useEffect(() => {
    if (!enrolment) return;
    let card: string | null = null;
    let face: string | null = null;
    let alive = true;
    void (async () => {
      const [c, f] = await Promise.all([
        api.enrolmentImage(enrolment.id, "id-document").catch(() => null),
        api.enrolmentImage(enrolment.id, "face").catch(() => null),
      ]);
      card = c;
      face = f;
      if (alive) setImages({ card: c, face: f });
    })();
    return () => {
      alive = false;
      if (card) URL.revokeObjectURL(card);
      if (face) URL.revokeObjectURL(face);
      setImages({ card: null, face: null });
    };
  }, [enrolment]);

  useEffect(() => {
    setPhase("review");
    setReason("");
    setApprove(true);
    setError(null);
    setChallenge(null);
  }, [enrolment?.id]);

  /**
   * Post the decision. Split out from `decide` because the two callers hold different things: the
   * capture path has a LivenessResult to unpack, and a console session has nothing to unpack.
   */
  const submit = useCallback(
    async (attestation: AttestationBody) => {
      if (!enrolment) return;
      setPhase("saving");
      try {
        await api.enrolmentDecide(enrolment.id, { approve, reason: reason.trim(), attestation });
        onDecided();
      } catch (e) {
        setError(e instanceof GatewayError ? e.message : (e as Error).message);
        setPhase("review");
      }
    },
    [approve, enrolment, onDecided, reason],
  );

  const beginAttest = useCallback(async () => {
    if (!enrolment) return;
    if (reason.trim().length < 3) return setError(t("admin.signups.reasonRequired"));
    setError(null);
    try {
      const c = await api.enrolmentChallenge(enrolment.id);
      // A console session has no enrolled face and no browser-held key, so the capture step would
      // ask for a proof it cannot produce. The gateway takes the issued link as the authorisation
      // instead — see lib/api.ts `consoleAttestation`.
      if (me?.consoleSession) return void submit(consoleAttestation(c.nonce));
      setChallenge({ nonce: c.nonce, challenge: c.challenge as Challenge[] });
      setPhase("attest");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [enrolment, me, reason, submit, t]);

  const decide = useCallback(
    async (result: LivenessResult) => {
      if (!challenge) return;
      await submit({
        nonce: challenge.nonce,
        signature: result.signature,
        livenessMode: result.livenessMode,
        livenessScore: result.livenessScore,
        livenessSignals: result.livenessSignals,
        spoofCheck: result.spoofCheck,
      });
    },
    [challenge, submit],
  );

  if (!enrolment) return null;
  const decided = enrolment.status !== "pending";

  return (
    <Drawer open onClose={onClose} closeLabel={t("common.close")} title={enrolment.employeeId} subtitle={enrolment.displayName} width={560}>
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}

        <Panel title={t("admin.signups.evidence")}>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["card", t("signup.idDocument"), enrolment.idDocSha256],
                ["face", t("admin.signups.capture"), enrolment.faceSha256],
              ] as const
            ).map(([key, label, hash]) => (
              <figure key={key} className="min-w-0">
                <p className="eyebrow mb-1">{label}</p>
                <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-[var(--radius-panel)] border border-line bg-console">
                  {images[key] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={images[key]!} alt={label} className="h-full w-full object-contain" />
                  ) : (
                    <Spinner className="text-console-muted" />
                  )}
                </div>
                <figcaption className="mt-1">
                  <HashValue value={hash} chars={8} />
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="mt-3 grid gap-3 border-t border-line-faint pt-3 sm:grid-cols-2">
            <Meter label={t("verify.matchScore")} value={enrolment.faceMatchScore} tone={toneForTrust(enrolment.faceMatchScore)} />
            <Meter label={t("verify.gates.liveness")} value={enrolment.livenessScore} tone={toneForTrust(enrolment.livenessScore)} />
          </div>
        </Panel>

        <KeyValues
          columns={2}
          items={[
            { k: t("onboard.role"), v: t(`roles.${enrolment.requestedRole}`) },
            { k: t("admin.signups.submitted"), v: dt(enrolment.createdAt, { dateStyle: "medium", timeStyle: "short" }), mono: true },
            { k: t("onboard.yourDid"), v: <HashValue value={enrolment.did} chars={10} /> },
            { k: t("admin.signups.anchor"), v: enrolment.ledgerTxId ? <HashValue value={enrolment.ledgerTxId} chars={8} /> : t("admin.signups.notAnchored"), mono: true },
          ]}
        />

        <VerificationBundle checks={enrolment.checks} bundleHash={enrolment.bundleHash} />

        {decided ? (
          <Card className={cx("px-4 py-3", enrolment.status === "approved" ? "border-verdigris-line" : "border-oxide-line")}>
            <div className="mb-1.5 flex items-center gap-2">
              <Chip tone={enrolment.status === "approved" ? "good" : "bad"}>
                {enrolment.status === "approved" ? Icon.check : "✕"} {t(`admin.signups.filters.${enrolment.status}`)}
              </Chip>
              {enrolment.decidedAt && <span className="font-mono text-[0.75rem] text-ink-3">{dt(enrolment.decidedAt, { dateStyle: "medium", timeStyle: "short" })}</span>}
            </div>
            {enrolment.decidedBy && <p className="text-[0.8125rem] text-ink-2">{t("admin.signups.decidedBy", { name: enrolment.decidedBy })}</p>}
            {enrolment.decisionReason && <p className="mt-1 text-[0.8125rem] text-ink-3">{enrolment.decisionReason}</p>}
          </Card>
        ) : phase === "attest" && challenge ? (
          <Panel title={t("admin.signups.attestTitle")}>
            <p className="mb-3 text-[0.8125rem] leading-relaxed text-ink-2">{t("admin.signups.attestBody")}</p>
            <LivenessCapture
              nonce={challenge.nonce}
              challenge={challenge.challenge}
              mode="verify"
              autoStart
              onCancel={() => setPhase("review")}
              onComplete={(r) => void decide(r)}
            />
          </Panel>
        ) : phase === "saving" ? (
          <div className="flex items-center gap-2 rounded-[var(--radius-field)] border border-line bg-overlay-1 px-4 py-3 text-[0.8125rem] text-ink-2">
            <Spinner /> {t("admin.signups.saving")}
          </div>
        ) : (
          <Panel title={t("admin.signups.decide")}>
            <div className="space-y-3">
              <Segmented
                value={approve ? "approve" : "deny"}
                onChange={(v) => setApprove(v === "approve")}
                options={[
                  { value: "approve", label: t("admin.signups.approve") },
                  { value: "deny", label: t("admin.signups.deny") },
                ]}
              />
              <Field label={t("admin.signups.reason")} hint={t("admin.signups.reasonHint")}>
                <textarea className={`${inputClass} min-h-[84px] resize-y leading-relaxed`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              </Field>
              <Button variant={approve ? "primary" : "danger"} className="w-full" onClick={() => void beginAttest()}>
                {approve ? t("admin.signups.approveAction") : t("admin.signups.denyAction")}
              </Button>
            </div>
          </Panel>
        )}
      </div>
    </Drawer>
  );
}
