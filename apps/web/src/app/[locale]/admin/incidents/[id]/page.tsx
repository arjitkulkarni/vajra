"use client";

/**
 * Incident investigation, and the replay.
 *
 * The sequence is reconstructed from the audit chain and the trust ledger, so the replay is not an
 * animation of a story we wrote — it is the recorded evidence, played back one entry at a time with
 * the state VAJRA held at each step. The evidence package at the end is the same material, signed.
 */
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { api, consoleAttestation, type TimelineItem } from "@/lib/api";
import { headlineFor } from "@/lib/events";
import { useI18n } from "@/lib/i18n-client";
import { useConsoleBase } from "@/lib/nav";
import { useMe } from "@/components/AppShell";
import { useEntity } from "@/components/EntityDrawer";
import { AnalystNote, ProofChecks, StepUpModal, useAsync } from "@/components/trust";
import type { Challenge } from "@/components/LivenessCapture";
import {
  IdTag,
  KeyValues,
  OpsHeader,
  Panel,
  StatBand,
  StateDot,
  StepRail,
  TrustHistoryChart,
  VerdictStamp,
  type TimelineStep,
} from "@/components/console";
import { Button, Chip, Dialog, ErrorNote, Field, HashValue, Icon, Skeleton, cx, inputClass, type Tone } from "@/components/ui";

const SPEEDS = [1, 2, 4] as const;
const STEP_MS = 1100;

export default function IncidentDetail({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id } = use(params);
  const { t, locale, dt, time, n } = useI18n();
  const base = useConsoleBase();
  const { me } = useMe();
  const { open } = useEntity();
  const timeline = useAsync(() => api.incidentTimeline(id), [id]);

  const [cursor, setCursor] = useState<number | null>(null);
  const [replay, setReplay] = useState<{ active: boolean; playing: boolean; speed: number }>({ active: false, playing: false, speed: 1 });
  const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null);
  const [verification, setVerification] = useState<{ valid: boolean; checks: { id: string; ok: boolean; detailKey: string }[]; events: number; proofs: number; packageId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeForm, setCloseForm] = useState<{ status: "resolved" | "false_positive"; reason: string }>({ status: "resolved", reason: "" });
  const [challenge, setChallenge] = useState<{ nonce: string; challenge: Challenge[] } | null>(null);

  const isDemoIdentity = !!me && ["Asha Rao", "Vikram Nair", "Meera Iyer", "Rohan Desai"].includes(me.user.displayName);
  const items = useMemo(() => timeline.data?.items ?? [], [timeline.data]);

  /** One rail entry per recorded item, with the number that moved at that moment. */
  const steps = useMemo<TimelineStep[]>(
    () =>
      items.map((item: TimelineItem, i) => {
        if (item.kind === "trust") {
          return {
            id: `trust-${i}`,
            at: item.at,
            label: t(`trust.reasons.${item.reason}`),
            tone: (item.delta < 0 ? "bad" : "good") as Tone,
            metric: { label: t("trust.identity"), value: `${item.scoreAfter}`, direction: item.delta < 0 ? ("down" as const) : ("up" as const) },
          };
        }
        const h = headlineFor(item);
        const risk = h.risk;
        return {
          id: `audit-${i}`,
          at: item.at,
          label: t(`console.events.${h.key}`),
          tone: (item.inIncident ? h.tone : h.tone === "neutral" ? "neutral" : h.tone) as Tone,
          detail: (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {h.action && <span>{t(`actions.${h.action}`)}</span>}
              {item.assetUid && <IdTag tone="neutral">{item.assetUid}</IdTag>}
              {h.verdict && <VerdictStamp size="sm" verdict={h.verdict} label={t(`verdict.${h.verdict}`)} />}
              {item.block !== null && <IdTag tone="steel">#{item.block}</IdTag>}
            </span>
          ),
          metric: risk ? { label: t("risk.label"), value: `${risk.score}`, direction: "up" as const } : undefined,
        };
      }),
    [items, t],
  );

  // The replay cursor. Stops of its own accord at the last entry.
  useEffect(() => {
    if (!replay.active || !replay.playing) return;
    const timer = setInterval(() => {
      setCursor((c) => {
        const next = (c ?? -1) + 1;
        if (next >= steps.length) {
          setReplay((r) => ({ ...r, playing: false }));
          return steps.length - 1;
        }
        return next;
      });
    }, STEP_MS / replay.speed);
    return () => clearInterval(timer);
  }, [replay.active, replay.playing, replay.speed, steps.length]);

  const startReplay = () => {
    setCursor(-1);
    setReplay({ active: true, playing: true, speed: replay.speed });
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setEvidence(await api.incidentEvidence(id));
      setVerification(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!evidence) return;
    setBusy(true);
    try {
      setVerification(await api.verifyEvidence(evidence));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const beginClose = async () => {
    setBusy(true);
    try {
      const ch = await api.incidentCloseChallenge(id);
      // A console session has no face to capture and no key to sign the nonce with; the gateway
      // takes the issued link as the authorisation instead. See lib/api.ts `consoleAttestation`.
      if (me?.consoleSession) return void doClose(consoleAttestation(ch.nonce));
      setChallenge({ nonce: ch.nonce, challenge: ch.challenge as Challenge[] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doClose = async (attestation: { nonce: string; signature: string; livenessMode: "faceapi" | "simulated" }) => {
    setChallenge(null);
    setBusy(true);
    try {
      await api.incidentClose(id, { ...closeForm, attestation });
      setClosing(false);
      timeline.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (timeline.error) return <ErrorNote message={timeline.error} onRetry={timeline.reload} retryLabel={t("common.retry")} />;
  if (!timeline.data) return <Skeleton className="h-96" />;
  const { incident } = timeline.data;

  const trustPoints = items.filter((i): i is Extract<TimelineItem, { kind: "trust" }> => i.kind === "trust").map((p) => ({ at: p.at, score: p.scoreAfter }));
  const affectedAssets = [...new Set(items.filter((i) => i.kind === "audit" && i.assetUid).map((i) => (i as Extract<TimelineItem, { kind: "audit" }>).assetUid!))];
  const severityTone: Tone = incident.severity === "S3" ? "bad" : incident.severity === "S2" ? "warn" : "steel";
  const shownCursor = replay.active ? cursor : null;
  const current = shownCursor !== null && shownCursor >= 0 ? steps[shownCursor] : null;
  const trustAtCursor =
    shownCursor !== null && shownCursor >= 0
      ? [...items.slice(0, shownCursor + 1)].reverse().find((i): i is Extract<TimelineItem, { kind: "trust" }> => i.kind === "trust")?.scoreAfter ?? null
      : null;

  return (
    <>
      <div className="mb-2">
        <Link
          href={`${base}/incidents`}
          className="-ml-1.5 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 py-1 text-[0.75rem] text-ink-3 transition-[color,background-color] duration-150 ease-out hover:bg-overlay-2 hover:text-ink active:translate-y-px"
        >
          <span aria-hidden>←</span>
          {t("console.shell.items.incidents")}
        </Link>
      </div>

      <OpsHeader
        title={incident.summary}
        id={<IdTag tone={severityTone}>{incident.incidentId}</IdTag>}
        status={
          <span className="flex items-center gap-1.5">
            <Chip tone={severityTone}>{t(`incidents.severity.${incident.severity}`)}</Chip>
            <Chip tone={incident.status === "open" ? "bad" : incident.status === "false_positive" ? "neutral" : "good"}>{t(`incidents.${incident.status}`)}</Chip>
          </span>
        }
        meta={
          <>
            <span>
              {t("console.incident.started")} <span className="tnum font-mono text-ink-2">{dt(incident.openedAt, { dateStyle: "short", timeStyle: "medium" })}</span>
            </span>
            <span>·</span>
            <button type="button" onClick={() => open({ kind: "person", id: incident.actorDid })} className="rounded-[var(--radius-tag)] underline decoration-line-strong decoration-dotted underline-offset-[3px] transition-[color,text-decoration-color] duration-150 ease-out hover:text-ink hover:decoration-brass active:translate-y-px">
              {t("console.incident.affectedIdentity")}
            </button>
          </>
        }
        actions={
          <>
            <Button size="sm" variant={replay.active ? "secondary" : "primary"} onClick={replay.active ? () => setReplay({ ...replay, active: false, playing: false }) : startReplay}>
              {replay.active ? t("console.incident.exitReplay") : `▶ ${t("console.incident.replay")}`}
            </Button>
            {incident.status === "open" && me?.user.role === "admin" && (
              <Button size="sm" onClick={() => setClosing(true)}>
                {t("incidents.closeIncident")}
              </Button>
            )}
          </>
        }
      />

      {error && <ErrorNote message={error} />}

      <StatBand
        className="mb-4"
        items={[
          { label: t("console.incident.peakRisk"), value: n(incident.peakRisk), tone: "bad" },
          { label: t("console.incident.eventCount"), value: n(items.filter((i) => i.kind === "audit").length) },
          { label: t("console.incident.affectedAssets"), value: n(affectedAssets.length), tone: affectedAssets.length > 0 ? "warn" : "neutral" },
          {
            label: t("console.incident.currentState"),
            value: (
              <span className="text-[1.125rem]">
                {incident.status === "open" ? (incident.responses[0] ? t(`incidents.responseLabels.${incident.responses[0]}`) : t("console.incident.frozen")) : t(`incidents.${incident.status}`)}
              </span>
            ),
            tone: incident.status === "open" ? "bad" : "good",
          },
          { label: t("audit.columns.anchor"), value: incident.ledgerTxId ? `#${n(incident.block ?? 0)}` : "—", tone: incident.ledgerTxId ? "good" : "warn" },
        ]}
      />

      {/* Replay head: the state VAJRA held at the cursor, reconstructed from the same records. */}
      {replay.active && (
        <Panel
          className={cx("relative mb-4 border-brass-line shadow-panel", replay.playing && "scan")}
          title={t("console.incident.replaying")}
          meta={t("console.incident.replayStep", { n: n(Math.max((shownCursor ?? 0) + 1, 0)), total: n(steps.length) })}
          actions={
            <span className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setReplay((r) => ({ ...r, playing: !r.playing }))}>
                {replay.playing ? `❚❚ ${t("console.incident.pause")}` : `▶ ${t("console.incident.resume")}`}
              </Button>
              <Button size="sm" variant="ghost" onClick={startReplay}>
                {t("console.incident.restart")}
              </Button>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setReplay((r) => ({ ...r, speed: s }))}
                  aria-pressed={replay.speed === s}
                  className={cx(
                    "rounded-[var(--radius-tag)] border px-1.5 py-px font-mono text-[0.6875rem] leading-5",
                    "transition-[color,background-color,border-color] duration-150 ease-out active:translate-y-px",
                    replay.speed === s
                      ? "border-brass-line bg-brass-soft text-brass-deep"
                      : "border-line text-ink-3 hover:border-line-strong hover:bg-overlay-2 hover:text-ink-2",
                  )}
                >
                  ×{s}
                </button>
              ))}
            </span>
          }
        >
          {current ? (
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div key={current.id} className="tick min-w-0">
                <p className="tnum font-mono text-[0.75rem] text-ink-3">{time(current.at)}</p>
                <p className="mt-1 font-display text-[1.25rem] font-semibold leading-tight tracking-[-0.015em] text-ink">{current.label}</p>
                {current.detail && <div className="mt-1.5">{current.detail}</div>}
              </div>
              {trustAtCursor !== null && (
                <div className="min-w-[120px] border-l border-line pl-4">
                  <p className="eyebrow">{t("trust.identity")}</p>
                  <p className="mt-1 flex items-baseline gap-2">
                    <StateDot tone={trustAtCursor < 45 ? "bad" : trustAtCursor < 75 ? "warn" : "good"} />
                    <span
                      key={trustAtCursor}
                      className={cx(
                        "tick tnum font-display text-[2rem] font-semibold leading-none tracking-[-0.02em]",
                        trustAtCursor < 45 ? "text-oxide" : trustAtCursor < 75 ? "text-saffron" : "text-verdigris",
                      )}
                    >
                      {n(trustAtCursor)}
                    </span>
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="py-3 text-[0.875rem] text-ink-3">{t("console.incident.replaying")}…</p>
          )}
          {shownCursor !== null && shownCursor >= steps.length - 1 && !replay.playing && (
            <p className="mt-3 flex items-center gap-2 border-t border-line-faint pt-2 text-[0.8125rem] text-verdigris">
              {Icon.check}
              {t("console.incident.replayDone")}
            </p>
          )}
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel title={t("console.incident.timeline")} meta={t("incidents.timelineBody")}>
          <StepRail steps={steps} time={time} cursor={shownCursor} onCursor={(i) => setCursor(i)} revealUpTo={replay.active ? Math.max(shownCursor ?? 0, 0) : undefined} />
        </Panel>

        <div className="space-y-4">
          {trustPoints.length > 1 && (
            <Panel title={t("incidents.trustDecay")}>
              <TrustHistoryChart points={trustPoints} tone="bad" time={time} />
            </Panel>
          )}

          <Panel title={t("console.incident.signals")}>
            <div className="flex flex-wrap gap-1.5">
              {incident.signals.map((s) => (
                <Chip key={s} tone="warn">
                  {t(`risk.signals.${s}`)}
                </Chip>
              ))}
            </div>
          </Panel>

          <Panel title={t("console.incident.responses")}>
            <ol className="divide-y divide-line-faint">
              {incident.responses.map((r, i) => (
                <li key={r} className="flex items-baseline gap-2.5 py-1.5 text-[0.8125rem] text-ink-2 first:pt-0 last:pb-0">
                  <span className="tnum w-3.5 shrink-0 text-right font-mono text-[0.6875rem] text-ink-3">{n(i + 1)}</span>
                  <StateDot tone="bad" />
                  <span className="min-w-0">{t(`incidents.responseLabels.${r}`)}</span>
                </li>
              ))}
            </ol>
          </Panel>

          {affectedAssets.length > 0 && (
            <Panel title={t("console.incident.affectedAssets")}>
              <ul className="space-y-1">
                {affectedAssets.map((uid) => (
                  <li key={uid}>
                    <button
                      type="button"
                      onClick={() => open({ kind: "asset", id: uid })}
                      className="-mx-1 block w-full rounded-[var(--radius-tag)] px-1 py-0.5 text-left font-mono text-[0.75rem] text-brass transition-[color,background-color] duration-150 ease-out hover:bg-brass-soft/40 hover:text-brass-deep active:translate-y-px"
                    >
                      {uid}
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title={t("console.incident.evidence")}>
            {!evidence ? (
              <Button variant="primary" size="sm" className="w-full" loading={busy} onClick={() => void generate()}>
                {t("incidents.generateEvidence")}
              </Button>
            ) : (
              <div className="space-y-2.5">
                <p className="text-[0.8125rem] text-ink-2">
                  {t("incidents.evidenceReady", { id: String(evidence.packageId), events: String((evidence.events as unknown[]).length), proofs: String((evidence.proofs as unknown[]).length) })}
                </p>
                <HashValue value={String(evidence.packageHash)} label="hash" chars={10} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" loading={busy} onClick={() => void verify()}>
                    {t("incidents.verifyEvidence")}
                  </Button>
                  <a href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(evidence, null, 2))}`} download={`${incident.incidentId}-evidence.json`}>
                    <Button size="sm" variant="ghost">
                      {t("incidents.downloadEvidence")}
                    </Button>
                  </a>
                </div>
                {verification && (
                  <div className="space-y-2 border-t border-line-faint pt-2.5">
                    <Chip tone={verification.valid ? "good" : "bad"} icon={verification.valid ? Icon.check : Icon.cross}>
                      {verification.valid ? t("verify.valid") : t("verify.invalid")}
                    </Chip>
                    <ProofChecks checks={verification.checks} />
                  </div>
                )}
              </div>
            )}
          </Panel>

          <AnalystNote kind="incident" id={incident.incidentId} label={t("incidents.explain")} />
        </div>
      </div>

      <Dialog open={closing} onClose={() => setClosing(false)} title={t("incidents.closeIncident")}>
        <div className="space-y-4">
          <Field label={t("incidents.closeAs")}>
            <select className={inputClass} value={closeForm.status} onChange={(e) => setCloseForm((f) => ({ ...f, status: e.target.value as "resolved" | "false_positive" }))}>
              <option value="resolved">{t("incidents.resolved")}</option>
              <option value="false_positive">{t("incidents.false_positive")}</option>
            </select>
          </Field>
          <Field label={t("incidents.closeReason")}>
            <input className={inputClass} value={closeForm.reason} onChange={(e) => setCloseForm((f) => ({ ...f, reason: e.target.value }))} />
          </Field>
          <p className="text-[0.8125rem] text-ink-3">{t("incidents.closeNote")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setClosing(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} disabled={closeForm.reason.trim().length < 3} onClick={() => void beginClose()}>
              {t("common.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>

      <StepUpModal
        open={!!challenge}
        onClose={() => setChallenge(null)}
        nonce={challenge?.nonce ?? null}
        challenge={challenge?.challenge ?? []}
        title={t("incidents.closeIncident")}
        body={t("incidents.closeNote")}
        demoRole={isDemoIdentity}
        onAttested={(a) => void doClose(a)}
      />
    </>
  );
}
