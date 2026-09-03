"use client";

/**
 * Request access — the enrolment side of the door.
 *
 *   employee ID card  →  read the face off it, here in the page
 *   live capture      →  challenge, five anti-spoof signals, and a match against that card
 *   submit            →  card, frame and both scores go up; the five gates are judged server-side
 *   wait              →  an administrator approves or declines; only then does an account exist
 *
 * The private key is minted in this browser and never leaves it. What is uploaded is the ID card,
 * the frame that was scored, the two confidence numbers, and a signature over the server's nonce.
 *
 * Renders the form only. The surrounding frame belongs to `AuthScreen`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EnrolmentStatus, Role, SignupStartResponse, VerificationBundle as Bundle } from "@vajra/contracts";
import { api, GatewayError } from "@/lib/api";
import { deviceFingerprint, getOrCreateIdentity } from "@/lib/did";
import { describeDocument, loadFaceEngine, ModelsUnavailableError, prefetchFaceEngine } from "@/lib/face";
import { useI18n } from "@/lib/i18n-client";
import { LivenessCapture, type Challenge, type LivenessResult } from "@/components/LivenessCapture";
import { VerificationBundle } from "@/components/VerificationBundle";
import { Button, Chip, Field, HashValue, Icon, Spinner, cx, inputClass } from "@/components/ui";
import { IdCardField } from "./IdCardField";
import { AuthNote, describeError } from "./shared";

type Stage = "form" | "reading" | "capture" | "submitting" | "waiting";
const ROLES: Role[] = ["engineer", "manager", "auditor", "admin"];
const POLL_MS = 4000;

export function SignupFlow({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
  const { t, locale } = useI18n();
  const [stage, setStage] = useState<Stage>("form");
  const [employeeId, setEmployeeId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("engineer");
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);
  const [reference, setReference] = useState<Float32Array | null>(null);
  const [start, setStart] = useState<SignupStartResponse | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [enrolmentId, setEnrolmentId] = useState<string | null>(null);
  const [status, setStatus] = useState<EnrolmentStatus>("pending");
  const [decisionReason, setDecisionReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  useEffect(() => () => void (previewRef.current && URL.revokeObjectURL(previewRef.current)), []);

  // The card read and the live check both need the same nets. Fetching them from the moment the
  // form appears means the ID card is usually scored the instant it is picked.
  useEffect(() => prefetchFaceEngine(), []);

  const pickFile = (file: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    setIdFile(file);
    previewRef.current = file ? URL.createObjectURL(file) : null;
    setIdPreview(previewRef.current);
  };

  /**
   * Read the face off the ID card before the camera opens. Doing it first means the live capture
   * has something to be scored against in the same session, and a card with no readable face is
   * rejected here rather than after someone has stood through a liveness challenge.
   */
  const begin = useCallback(async () => {
    if (!idFile) return setError(t("signup.errors.idRequired"));
    if (employeeId.trim().length < 3) return setError(t("signup.errors.employeeId"));
    setBusy(true);
    setError(null);
    setNotice(null);
    setStage("reading");
    try {
      try {
        const engine = await loadFaceEngine();
        const found = await describeDocument(engine, idFile);
        if (!found) {
          setError(t("signup.errors.noFaceOnCard"));
          setStage("form");
          return;
        }
        setReference(found.descriptor);
      } catch (e) {
        // No weights on this machine: carry on into the simulated path, visibly.
        if (!(e instanceof ModelsUnavailableError)) throw e;
        setReference(null);
        setNotice(t("onboard.modelsMissing"));
      }
      setStart(await api.signupStart());
      setStage("capture");
    } catch (e) {
      setError(describeError(e, t));
      setStage("form");
    } finally {
      setBusy(false);
    }
  }, [employeeId, idFile, t]);

  const submit = useCallback(
    async (result: LivenessResult) => {
      if (!start || !idFile) return;
      // The simulated path produces no template — there was no face to measure. An enrolment without
      // one is not something to paper over: it would register an identity nobody can later be
      // matched against. The gateway refuses it anyway, on the array bounds, but it does so with a
      // validation error that says nothing about the cause. Say the true thing here instead.
      if (!result.template?.length) {
        setError(t("signup.errors.noFaceTemplate"));
        setStage("form");
        return;
      }
      setStage("submitting");
      setError(null);
      try {
        const identity = await getOrCreateIdentity();
        const form = new FormData();
        form.append(
          "payload",
          JSON.stringify({
            employeeId: employeeId.trim(),
            displayName: name.trim() || employeeId.trim(),
            did: identity.did,
            publicKeyJwk: identity.publicKeyJwk,
            deviceFingerprintHash: await deviceFingerprint(),
            faceTemplate: result.template,
            faceTemplateSamples: result.templateSamples ?? 1,
            faceTemplateModel: result.templateModel ?? "faceapi",
            role,
            evidence: {
              nonce: start.nonce,
              signature: result.signature,
              faceMatchScore: result.faceMatchScore ?? 0,
              livenessMode: result.livenessMode,
              livenessScore: result.livenessScore,
              livenessSignals: result.livenessSignals,
              spoofCheck: result.spoofCheck,
            },
          }),
        );
        form.append("idDocument", idFile, idFile.name);
        if (result.faceImage) form.append("faceImage", result.faceImage, "capture.jpg");
        const res = await api.signupSubmit(form);
        setBundle(res.verification);
        setEnrolmentId(res.enrolment.id);
        setStatus(res.enrolment.status);
        setStage("waiting");
      } catch (e) {
        // A refusal carries the full bundle, so the person is told which gate stopped them.
        if (e instanceof GatewayError && e.code === "verification_failed") setBundle(e.details as Bundle);
        setError(describeError(e, t));
        setStage("form");
      }
    },
    [employeeId, idFile, name, role, start, t],
  );

  // Poll while an administrator decides. Cheap, and it means nobody has to refresh to find out.
  useEffect(() => {
    if (stage !== "waiting" || !enrolmentId || status !== "pending") return;
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.signupStatus(enrolmentId);
        if (!alive) return;
        setStatus(s.status);
        setDecisionReason(s.decisionReason);
      } catch {
        /* keep waiting; the next tick will try again */
      }
    };
    const id = setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enrolmentId, stage, status]);

  const steps = [
    { id: "id", done: stage !== "form", active: stage === "form" },
    { id: "read", done: stage === "capture" || stage === "submitting" || stage === "waiting", active: stage === "reading" },
    { id: "live", done: stage === "submitting" || stage === "waiting", active: stage === "capture" },
    { id: "approve", done: status === "approved", active: stage === "waiting" && status === "pending" },
  ] as const;

  return (
    <div className="space-y-5">
      {/* Four beats, so nobody wonders how much of this is left. The current beat breathes rather
          than merely sitting at a lower alpha: an enrolment stalls on a camera permission prompt or
          on an administrator who has gone to lunch, and a still bar at 45% is indistinguishable
          from a dead one. `.pulse` is already in the reduced-motion block, so it holds solid there
          and the state stays carried by fill. */}
      <ol className="flex items-center gap-1.5">
        {steps.map((s) => (
          <li key={s.id} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span
              className={cx(
                "h-[3px] rounded-[var(--radius-pill)] transition-colors duration-300 ease-out",
                s.done ? "bg-brass" : s.active ? "pulse bg-brass/55" : "bg-line",
              )}
            />
            <span
              className={cx(
                "truncate text-[0.6875rem] transition-colors duration-300 ease-out",
                s.active ? "font-medium text-ink" : s.done ? "text-ink-2" : "text-ink-3",
              )}
            >
              {t(`signup.steps.${s.id}`)}
            </span>
          </li>
        ))}
      </ol>

      {error && <AuthNote tone="bad">{error}</AuthNote>}
      {notice && <AuthNote tone="warn">{notice}</AuthNote>}

      {stage === "form" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("signup.employeeId")} hint={t("signup.employeeIdHint")}>
              <input
                className={cx(inputClass, "tnum font-mono tracking-[0.01em]")}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="CP-0042"
                autoComplete="off"
              />
            </Field>
            <Field label={t("signup.displayName")}>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("onboard.displayNamePlaceholder")} />
            </Field>
          </div>
          <Field label={t("onboard.role")}>
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("signup.idDocument")} hint={t("signup.idDocumentHint")}>
            <IdCardField file={idFile} preview={idPreview} onPick={pickFile} />
          </Field>
          <p className="text-[0.8125rem] leading-relaxed text-ink-3">{t("signup.cameraPrompt")}</p>
          <Button variant="primary" className="w-full justify-center" loading={busy} onClick={() => void begin()}>
            {t("signup.begin")}
          </Button>
        </div>
      )}

      {(stage === "reading" || stage === "submitting") && (
        <div className="auth-panel flex items-center gap-3 rounded-[var(--radius-field)] border border-line bg-overlay-1 px-4 py-3.5">
          <Spinner className="text-brass" />
          <p className="text-[0.9375rem] text-ink-2">{stage === "reading" ? t("signup.readingCard") : t("signup.submitting")}</p>
        </div>
      )}

      {stage === "capture" && start && (
        <div>
          <p className="mb-4 text-[0.875rem] leading-relaxed text-ink-2">{t("signup.captureBody")}</p>
          <LivenessCapture
            nonce={start.nonce}
            challenge={start.challenge as Challenge[]}
            mode="enrol"
            reference={reference}
            minMatchScore={start.faceMatchThreshold}
            mismatchRedirect={`/${locale}/login`}
            capture
            autoStart
            onCancel={() => setStage("form")}
            onComplete={(r) => void submit(r)}
          />
        </div>
      )}

      {/* The one place on the door that gets a card. Everything before it is a step in a form and
          belongs to the flat ground; this is where the flow STOPS, possibly for hours, and a
          bounded surface is what says "nothing further is being asked of you". */}
      {stage === "waiting" && (
        <div className="auth-panel rounded-[var(--radius-card)] border border-line bg-overlay-1 p-5">
          {status === "pending" && (
            <>
              {/* steel, not saffron: a pending approval is an identity waiting on a human, not an
                  elevated risk. Saffron here would say STEP_UP, which is a different thing that
                  happens elsewhere in this product to a different set of people. */}
              <Chip tone="steel" icon={Icon.dot} className="mb-4">
                {t("signup.pendingBadge")}
              </Chip>
              <h3 className="mb-2 font-display text-[1.25rem] tracking-[-0.015em]">{t("signup.pendingTitle")}</h3>
              <p className="mb-4 text-[0.9375rem] leading-relaxed text-ink-2">{t("signup.pendingBody")}</p>
              <div className="flex items-center gap-2 text-[0.8125rem] text-ink-3">
                <Spinner className="text-steel" /> {t("signup.polling")}
              </div>
            </>
          )}
          {status === "approved" && (
            <>
              {/* A 2px rule was a paper gesture. On near-black a saturated hairline plus its own
                  alpha wash reads heavier than a double-weight border ever did, and it stops the
                  stamp from blooming at the corners. */}
              <div className="stamp mb-4 inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-verdigris-line bg-verdigris-soft px-3 py-1.5 font-display text-[0.9375rem] font-semibold uppercase tracking-[0.04em] text-verdigris">
                {Icon.check} {t("signup.approvedTitle")}
              </div>
              <p className="mb-5 text-[0.9375rem] leading-relaxed text-ink-2">{t("signup.approvedBody")}</p>
              <Button variant="primary" onClick={onSwitchToLogin}>
                {t("signup.toLogin")} {Icon.arrow}
              </Button>
            </>
          )}
          {status === "denied" && (
            <>
              <Chip tone="bad" icon={Icon.cross} className="mb-4">
                {t("signup.deniedBadge")}
              </Chip>
              <h3 className="mb-2 font-display text-[1.25rem] tracking-[-0.015em]">{t("signup.deniedTitle")}</h3>
              <p className="mb-2 text-[0.9375rem] leading-relaxed text-ink-2">{t("signup.deniedBody")}</p>
              {/* The administrator's words, quoted. The oxide rail attributes the reason to the
                  refusal above without repainting the reason itself red — it is prose a person
                  typed, and it has to stay readable, not alarming. */}
              {decisionReason && (
                <p className="rounded-[var(--radius-field)] border border-line border-l-2 border-l-oxide bg-paper-2 px-3.5 py-2.5 text-[0.875rem] leading-relaxed text-ink-2">
                  {decisionReason}
                </p>
              )}
            </>
          )}
          {enrolmentId && (
            <div className="mt-5">
              <HashValue value={enrolmentId} label={t("signup.reference")} chars={10} />
            </div>
          )}
        </div>
      )}

      {bundle && <VerificationBundle checks={bundle.checks} livenessSignals={bundle.livenessSignals} bundleHash={bundle.bundleHash} />}

      {stage === "form" && <p className="text-[0.75rem] leading-relaxed text-ink-3">{t("signup.privacyBody")}</p>}
    </div>
  );
}
