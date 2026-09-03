"use client";

/**
 * Sign in — the employee ID, then the same five verifications that enrolled them.
 *
 *   employee ID  →  the gateway returns the challenge and the template an administrator approved
 *   live capture →  the confidence score is recomputed here, against that template
 *   complete     →  the frame and both scores are stored and anchored; a session is issued
 *
 * A login is not a lighter check than a signup. It is the same bundle, judged the same way, and it
 * leaves the same evidence behind — which is the point: every entry into the product is provable.
 *
 * Renders the form only. The surrounding frame belongs to `AuthScreen`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { LoginStartResponse, VerificationBundle as Bundle } from "@vajra/contracts";
import { api, GatewayError, setSession } from "@/lib/api";
import { deviceFingerprint, loadIdentity } from "@/lib/did";
import { prefetchFaceEngine } from "@/lib/face";
import { useI18n } from "@/lib/i18n-client";
import { LivenessCapture, type Challenge, type LivenessResult } from "@/components/LivenessCapture";
import { VerificationBundle } from "@/components/VerificationBundle";
import { Button, Field, Icon, Spinner, cx, inputClass } from "@/components/ui";
import { AuthNote, describeError } from "./shared";

type Stage = "id" | "capture" | "completing" | "done";

export function LoginFlow() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("id");
  const [employeeId, setEmployeeId] = useState("");
  const [start, setStart] = useState<LoginStartResponse | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every sign-in ends at the camera, so the weights start arriving while the employee ID is typed.
  useEffect(() => prefetchFaceEngine(), []);

  /**
   * The approved template, as a typed array, built once per login rather than once per render.
   * LivenessCapture keys its capture on this identity: handing it a fresh Float32Array every render
   * would tear the camera down and start over on every keystroke.
   */
  const reference = useMemo(() => (start ? new Float32Array(start.faceTemplate) : null), [start]);

  const begin = useCallback(async () => {
    if (employeeId.trim().length < 3) return setError(t("signup.errors.employeeId"));
    setBusy(true);
    setError(null);
    setBundle(null);
    try {
      // The key never leaves IndexedDB, so a browser that has never enrolled cannot sign the nonce.
      // Say so here rather than letting the fifth gate fail after a liveness challenge.
      if (!(await loadIdentity())) {
        setError(t("login.errors.noIdentity"));
        return;
      }
      setStart(await api.loginStart(employeeId.trim()));
      setStage("capture");
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy(false);
    }
  }, [employeeId, t]);

  const complete = useCallback(
    async (result: LivenessResult) => {
      if (!start) return;
      setStage("completing");
      setError(null);
      try {
        const form = new FormData();
        form.append(
          "payload",
          JSON.stringify({
            employeeId: employeeId.trim(),
            deviceFingerprintHash: await deviceFingerprint(),
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
        if (result.faceImage) form.append("faceImage", result.faceImage, "capture.jpg");
        const res = await api.loginComplete(form);
        setBundle(res.verification);
        setSession(res.sessionJwt);
        setStage("done");
        // The gateway decides where this person belongs, not the browser.
        router.push(`/${locale}/${res.home}`);
        router.refresh();
      } catch (e) {
        if (e instanceof GatewayError && e.code === "verification_failed") setBundle(e.details as Bundle);
        setError(describeError(e, t));
        setStage("id");
      }
    },
    [employeeId, locale, router, start, t],
  );

  return (
    <div className="space-y-5">
      {error && <AuthNote tone="bad">{error}</AuthNote>}

      {stage === "id" && (
        <div className="space-y-4">
          <Field label={t("signup.employeeId")} hint={t("login.employeeIdHint")}>
            <input
              className={cx(inputClass, "tnum font-mono tracking-[0.01em]")}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void begin()}
              placeholder="CP-0042"
              autoComplete="username"
              autoFocus
            />
          </Field>
          <p className="text-[0.8125rem] leading-relaxed text-ink-3">{t("login.cameraPrompt")}</p>
          <Button variant="primary" className="w-full justify-center" loading={busy} onClick={() => void begin()}>
            {t("login.begin")}
          </Button>
        </div>
      )}

      {stage === "capture" && start && (
        <div>
          <p className="mb-1 text-[0.9375rem] font-medium text-ink">{t("login.welcomeBack", { name: start.displayName })}</p>
          <p className="mb-4 text-[0.875rem] leading-relaxed text-ink-2">{t("login.captureBody")}</p>
          <LivenessCapture
            nonce={start.nonce}
            challenge={start.challenge as Challenge[]}
            mode="verify"
            reference={reference}
            minMatchScore={start.faceMatchThreshold}
            mismatchRedirect={`/${locale}/login`}
            capture
            autoStart
            onCancel={() => setStage("id")}
            onComplete={(r) => void complete(r)}
          />
        </div>
      )}

      {/* The last beat of a sign-in. "completing" is work in progress and stays neutral with a
          brass spinner; "done" is a verdict, so it takes verdigris and the check glyph — the same
          pairing every ALLOW in the console uses, because this IS one. The router push follows
          within a frame or two, so this is the last thing seen before the console. */}
      {(stage === "completing" || stage === "done") && (
        <div
          className={cx(
            "auth-panel flex items-center gap-3 rounded-[var(--radius-field)] border px-4 py-3.5 transition-colors duration-150 ease-out",
            stage === "done" ? "border-verdigris-line bg-verdigris-soft" : "border-line bg-overlay-1",
          )}
        >
          {stage === "done" ? <span className="stamp text-verdigris">{Icon.check}</span> : <Spinner className="text-brass" />}
          <p className={cx("text-[0.9375rem]", stage === "done" ? "font-medium text-verdigris" : "text-ink-2")}>
            {stage === "done" ? t("login.signedIn") : t("login.completing")}
          </p>
        </div>
      )}

      {bundle && <VerificationBundle checks={bundle.checks} livenessSignals={bundle.livenessSignals} bundleHash={bundle.bundleHash} />}
    </div>
  );
}
