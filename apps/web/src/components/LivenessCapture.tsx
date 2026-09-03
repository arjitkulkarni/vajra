"use client";

/**
 * The one genuinely non-trivial client component: camera, on-device face verification, liveness,
 * and nonce signing.
 *
 * Everything here happens in the browser. The detector and landmarks come from `lib/face`, the
 * identity embedding from `lib/adaface`, the anti-spoofing signals and challenge state machine from
 * `lib/liveness`, and the live AI check from `lib/antispoof`. What leaves this page is a signature
 * over the server's nonce, the liveness score and its per-signal breakdown, the AI check's single
 * live probability, and the 0-100 face confidence — numbers, not an embedding.
 * Two exceptions are deliberate and visible in the props: `capture` uploads the scored frame as
 * evidence, and an enrolment registers its averaged template so a later login can be scored against
 * what an administrator approved. A *check* uploads neither.
 *
 * The identity embedding is AdaFace's, and it is deliberately *not* computed per frame: a forward
 * pass through IR-50 costs hundreds of milliseconds and would strand the overlay. Instead the loop
 * keeps a few aligned 112x112 crops — a few hundred microseconds each — and they are embedded in one
 * batch, in a worker, once the challenge is done. face-api's cheap 128-d descriptor still runs every
 * few frames, but only to feed the `consistency` liveness signal, which asks whether it is the same
 * person throughout rather than who they are.
 *
 * Three gates have to pass before the nonce is signed:
 *   1. the challenge (blink / turn / smile) completes,
 *   2. the passive liveness score clears NEXT_PUBLIC_LIVENESS_MIN_SCORE,
 *   3. in step-up mode, the live face matches the template enrolled in this browser.
 *
 * The live AI check is deliberately not a fourth gate here. MiniFASNet's verdict is reported, not
 * enforced, because enforcing it in the browser would mean an attacker's own page decides whether
 * the attack is ever recorded — so a capture the model calls a spoof still signs, still uploads its
 * evidence, and is refused by the gateway, which also opens the incident that locks the sessions.
 *
 * NEXT_PUBLIC_LIVENESS_MODE=simulated (or a missing camera, or missing model weights) keeps the
 * entire cryptographic path and shows a visible SIMULATED badge — never used on stage, always honest.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n-client";
import { getDescriptor, getOrCreateIdentity, matchFace, saveDescriptor, scoreMatch, signNonce, type EmbeddingModel } from "@/lib/did";
import { ADAFACE_DIM, adafaceAvailable, alignFace, averageEmbedding, embedAligned, onAdaFaceProgress, type AdaFaceProgress, type AlignedFace } from "@/lib/adaface";
import { antispoofAvailable, medianLiveProbability, readSpoofPatch, scoreLive, SPOOF_MODEL } from "@/lib/antispoof";
import {
  averageDescriptor,
  captureFrame,
  loadFaceEngine,
  ModelsUnavailableError,
  onModelProgress,
  prefetchFaceEngine,
  readFaceCrop,
  simulatedFrame,
  type DetectorKind,
  type FaceEngine,
  type LoadProgress,
} from "@/lib/face";
import { DEFAULT_MIN_SCORE, LivenessSession, type Challenge, type HintId, type LivenessVerdict, type SignalId } from "@/lib/liveness";
import { Button, Chip, cx, Icon, Meter, Spinner } from "./ui";

export type { Challenge };

export interface LivenessResult {
  signature: string;
  livenessMode: "faceapi" | "simulated";
  livenessScore?: number;
  livenessSignals?: Record<string, number>;
  /** 0-100 confidence against `reference`, present whenever one was supplied. */
  faceMatchScore?: number;
  /** The frame the scores were computed from, when `capture` is on. */
  faceImage?: Blob | null;
  /** The averaged embedding, so an enrolment can register a template server-side. */
  template?: number[];
  templateSamples?: number;
  /** Which net produced it. The two spaces are not comparable, so this travels with the numbers. */
  templateModel?: EmbeddingModel;
  /**
   * What the live AI check made of this capture: one number, and how many frames are behind it.
   *
   * Deliberately not folded into `livenessScore`. The passive composite is a weighted opinion that
   * moves a confidence up or down; this is a classifier's verdict on whether a presentation attack
   * is in front of the lens, and the gateway attaches a different consequence to it. Absent when
   * the weights are not on this machine, which the gateway records as unmeasured rather than as a
   * pass — see lib/antispoof.
   */
  spoofCheck?: { model: string; samples: number; liveProbability: number };
}

type Phase = "idle" | "loading" | "detect" | "challenge" | "embedding" | "signing" | "done" | "error";
/** Why we dropped to the simulated path, so the UI can say something true rather than generic. */
type SimReason = "configured" | "models" | "load" | "camera" | "timeout";

const SIGNAL_ORDER: SignalId[] = ["depth", "motion", "blink", "focus", "texture", "consistency"];
const DESCRIPTOR_INTERVAL_MS = 400;
const MIN_DESCRIPTORS = 3;
const CAPTURE_TIMEOUT_MS = 45_000;
/** How often an aligned crop is kept for AdaFace. Cheap enough to do often, pointless to do faster. */
const ALIGN_INTERVAL_MS = 500;
/** Five crops is where averaging stops buying much, and it is a 750 KB working set. */
const MAX_ALIGNED = 5;
const MIN_ALIGNED = 3;
/**
 * How long we keep waiting for crops after the challenge is already done. A face that will not
 * align — heavy glasses, an extreme angle held to the end — should not hold the flow hostage to the
 * full capture timeout; after this we embed what we have, or fall back to the descriptor net.
 */
const ALIGN_GRACE_MS = 3_000;
/**
 * How often a patch is scored by the anti-spoofing model, and how many scores make a verdict.
 *
 * One forward pass is a couple of milliseconds, so the interval is not about cost — it is about
 * independence. Two patches 60 ms apart are the same photograph of the same instant and the model
 * says the same thing about both; the median over them is no steadier than one of them. Six hundred
 * milliseconds apart they carry different poses, different light and different compression, which
 * is what makes a median worth taking.
 */
const SPOOF_INTERVAL_MS = 600;
const MIN_SPOOF_SAMPLES = 3;
/**
 * How long we keep waiting for those scores once the challenge is already done. The AI check is an
 * opinion the flow is willing to proceed without, so it never holds a capture open for long: after
 * this we report what came back, or report the check as unmeasured.
 */
const SPOOF_GRACE_MS = 2_500;

const MIN_SCORE = Number(process.env.NEXT_PUBLIC_LIVENESS_MIN_SCORE ?? "") || DEFAULT_MIN_SCORE;
/** Mirrors the gateway's FACE_MATCH_MIN_SCORE default; the caller passes the server's own value. */
const DEFAULT_MIN_MATCH = 45;
/** "block" refuses to sign when the passive score fails; "warn" reports it and carries on. */
const ENFORCE = (process.env.NEXT_PUBLIC_LIVENESS_ENFORCE ?? "block") !== "warn";
/**
 * Where the AI check's chip turns from verdigris to oxide. Presentation only.
 *
 * The floor that decides anything is the gateway's ANTISPOOF_MIN_LIVE, applied to the number this
 * capture reports. The browser deliberately does not refuse on its own here: a capture that looks
 * like an attack still signs and still submits, because the refusal has to happen where the evidence
 * can be stored and the incident opened. A client that quietly declined to send would protect the
 * attacker from the record.
 */
const SPOOF_CHIP_FLOOR = 0.5;
/**
 * How long the refusal card stays up before the browser is sent back to the door.
 *
 * Long enough to read the verdict and the score underneath it, short enough that a face which did
 * not match is never left sitting one click away from a live camera and a half-finished sign-in.
 */
const MISMATCH_REDIRECT_SECONDS = 5;

interface Props {
  nonce: string;
  challenge: Challenge[];
  /** Enrolment stores the template; step-up matches against it. */
  mode: "enrol" | "verify";
  /**
   * An embedding to score this capture against — the face on the employee ID card at signup, the
   * enrolled template at login. When supplied it replaces the browser-held template entirely, which
   * is what lets a login be judged against what an administrator actually approved.
   *
   * Its length decides which space the comparison happens in, so a capture always produces a
   * template the reference can actually be compared to, even when that means the older net.
   */
  reference?: Float32Array | null;
  /** Confidence floor, 0-100, matching the gateway's FACE_MATCH_MIN_SCORE. */
  minMatchScore?: number;
  /**
   * Where to send the browser when the face is refused: a full navigation, after a short countdown
   * spent on the refusal card. The door — `/{locale}/login` — for both flows that judge a capture
   * against a reference. Left unset, as the console's own step-ups leave it, a refusal is reported
   * in place and the capture can simply be retried.
   */
  mismatchRedirect?: string;
  /** Keep the scored frame as a JPEG, for the gateway to encrypt, store and anchor. */
  capture?: boolean;
  onComplete: (result: LivenessResult) => void;
  onCancel?: () => void;
  autoStart?: boolean;
}

/** Drop the unmeasured signals and round the rest — this is what goes into the attestation. */
function reportable(verdict: LivenessVerdict): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(verdict.signals)) if (value !== null) out[id] = Math.round(value * 100) / 100;
  return out;
}

export function LivenessCapture({ nonce, challenge, mode, reference, minMatchScore, mismatchRedirect, capture, onComplete, onCancel, autoStart }: Props) {
  const { t, n } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const cropRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  /** Set only when this capture must be abandoned: unmount, or the cancel button. */
  const abortRef = useRef(false);
  /**
   * Which capture is the live one.
   *
   * `abortRef` alone cannot answer "is this closure still current", and it needs to: React's
   * StrictMode starts a capture, tears it down and starts another, and the first one is still
   * sitting inside `await getUserMedia()` when the second resets the abort flag. Without a
   * generation to compare against, both resume and two capture loops run against one video element.
   * Every run takes a number on entry and every await checks it is still the number in the ref.
   */
  const runRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [simulated, setSimulated] = useState(process.env.NEXT_PUBLIC_LIVENESS_MODE === "simulated");
  const [message, setMessage] = useState<string | null>(null);
  const [faceFound, setFaceFound] = useState(false);
  const [hint, setHint] = useState<HintId | null>(null);
  const [verdict, setVerdict] = useState<LivenessVerdict | null>(null);
  const [engineInfo, setEngineInfo] = useState<{ detector: DetectorKind; backend: string } | null>(null);
  const [loadProgress, setLoadProgress] = useState<LoadProgress>({ ratio: 0, usable: false });
  const [matchDistance, setMatchDistance] = useState<number | null>(null);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [embedModel, setEmbedModel] = useState<EmbeddingModel | null>(null);
  const [adaProgress, setAdaProgress] = useState<AdaFaceProgress>({ ratio: 0, ready: false });
  const [liveProbability, setLiveProbability] = useState<number | null>(null);
  /** Set once, and only by a face that did not match: the refusal card is a terminal state. */
  const [rejected, setRejected] = useState(false);
  const [countdown, setCountdown] = useState(MISMATCH_REDIRECT_SECONDS);
  const alignRef = useRef<HTMLCanvasElement | null>(null);
  const patchRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * Let the camera go. This is what a *finished* capture does: the challenge is over, the frames
   * have been scored, and there is no reason to keep a light on someone's face while the embedding
   * is computed. It deliberately does not touch `abortRef` — scoring, saving and signing all still
   * have to happen after it.
   */
  const releaseCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  /**
   * Abandon the capture. Everything downstream checks `abortRef` and gives up, so this is only ever
   * for a cancel, an unmount or a restart — conflating it with the ordinary end of a capture is
   * exactly how the whole flow silently dead-ends after the last frame.
   */
  const stop = useCallback(() => {
    abortRef.current = true;
    // Retire the generation too, so anything mid-await abandons rather than racing the next run.
    runRef.current += 1;
    releaseCamera();
  }, [releaseCamera]);

  useEffect(() => () => stop(), [stop]);

  const finish = useCallback(
    async (run: number, livenessMode: "faceapi" | "simulated", result?: LivenessVerdict, extra?: Pick<LivenessResult, "faceMatchScore" | "faceImage" | "template" | "templateSamples" | "templateModel" | "spoofCheck">) => {
      setPhase("signing");
      try {
        // Enrolment mints the key pair here, before anything is signed with it. Doing this any later
        // is what used to leave a first-time volunteer staring at "no identity in this browser".
        if (mode === "enrol") await getOrCreateIdentity();
        const signature = await signNonce(nonce);
        // Cancel stays live through the embedding and signing phases, and both of the awaits above
        // can outlast a click. Reporting a completion after the user has walked away — or from a
        // capture that has already been superseded — is the one outcome this must never produce.
        if (abortRef.current || runRef.current !== run) return;
        stop();
        setPhase("done");
        onComplete({
          signature,
          livenessMode,
          livenessScore: result ? Math.round(result.score * 100) / 100 : undefined,
          livenessSignals: result ? reportable(result) : undefined,
          ...extra,
        });
      } catch (e) {
        setMessage((e as Error).message);
        setPhase("error");
      }
    },
    [mode, nonce, onComplete, stop],
  );

  const runSimulated = useCallback(
    async (run: number, reason: SimReason) => {
      // Reached only from inside a capture, so the run is the caller's. Check it before touching any
      // state: a superseded run that got here through a denied camera would otherwise stamp the
      // SIMULATED badge and "camera denied" over a live capture that is running perfectly well — and
      // this component's whole contract is that the badge tells the truth.
      if (abortRef.current || runRef.current !== run) return;
      setSimulated(true);
      setVerdict(null);
      if (reason === "models") setMessage(t("onboard.modelsMissing"));
      else if (reason === "camera") setMessage(t("onboard.cameraDenied"));
      else if (reason !== "configured") setMessage(t("onboard.simulatedNote"));
      setPhase("challenge");
      for (let i = 0; i < challenge.length; i++) {
        if (abortRef.current || runRef.current !== run) return;
        setStepIndex(i);
        setProgress(0);
        await new Promise<void>((resolve) => {
          const start = performance.now();
          const tick = () => {
            const p = Math.min((performance.now() - start) / 900, 1);
            setProgress(p);
            if (p < 1) rafRef.current = requestAnimationFrame(tick);
            else resolve();
          };
          rafRef.current = requestAnimationFrame(tick);
        });
      }
      setStepIndex(challenge.length);
      // No camera and no weights means no face was measured. The capture is a labelled placeholder
      // and the confidence is reported as exactly the floor — never above it — so a simulated run
      // can carry the flow without ever looking like a stronger match than a real one.
      await finish(run, "simulated", undefined, {
        faceMatchScore: reference || capture ? (minMatchScore ?? DEFAULT_MIN_MATCH) : undefined,
        faceImage: capture ? await simulatedFrame() : undefined,
      });
    },
    [capture, challenge, finish, minMatchScore, reference, t],
  );

  const draw = useCallback((box: { x: number; y: number; width: number; height: number } | null, points: { x: number; y: number }[]) => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!box) return;
    // An instrument reticle rather than a photo-booth rectangle: four corner brackets in the
    // console accent, so the frame reads as a measurement being taken and the sides of the face
    // are never boxed in by a line that competes with the landmarks inside it.
    const arm = Math.max(6, Math.min(box.width, box.height) * 0.22);
    ctx.strokeStyle = "rgba(111,163,255,0.9)"; // --color-console-accent
    ctx.lineWidth = Math.max(2, canvas.width / 320);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const bracket = (ax: number, ay: number, bx: number, by: number, dx: number, dy: number) => {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(dx, dy);
      ctx.stroke();
    };
    const { x, y, width, height } = box;
    bracket(x, y + arm, x, y, x + arm, y);
    bracket(x + width - arm, y, x + width, y, x + width, y + arm);
    bracket(x + width, y + height - arm, x + width, y + height, x + width - arm, y + height);
    bracket(x + arm, y + height, x, y + height, x, y + height - arm);
    // Landmarks sit a step dimmer than the bracket: they are texture, the bracket is the readout.
    ctx.fillStyle = "rgba(111,163,255,0.55)";
    const r = Math.max(1, canvas.width / 400);
    for (const p of points) ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  }, []);

  const start = useCallback(async () => {
    // Supersede whatever came before, and remember which run this closure is.
    const run = ++runRef.current;
    const stale = () => abortRef.current || runRef.current !== run;
    abortRef.current = false;
    setMessage(null);
    setVerdict(null);
    setMatchDistance(null);
    setMatchScore(null);
    setLiveProbability(null);
    setStepIndex(0);
    setProgress(0);
    setPhase("loading");
    if (process.env.NEXT_PUBLIC_LIVENESS_MODE === "simulated") return runSimulated(run, "configured");

    // The camera permission prompt and the weights have no reason to queue behind one another.
    // Asking for both at once means the preview is usually live before the nets finish arriving.
    // `navigator.mediaDevices` is undefined on any insecure origin except localhost — which is
    // exactly how this gets demoed, from a phone or a projector pointed at a laptop over http. The
    // property read throws synchronously there, so the .catch below would never run and the whole
    // capture would die before it could fall back. Ask whether the API is there before touching it.
    const camera: Promise<{ stream: MediaStream | null }> = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices
          .getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false })
          .then((s) => ({ stream: s as MediaStream | null }))
          .catch(() => ({ stream: null }))
      : Promise.resolve({ stream: null });

    let engine: FaceEngine;
    try {
      engine = await loadFaceEngine();
    } catch (e) {
      // Nothing will read from a camera we are about to abandon.
      void camera.then(({ stream }) => stream?.getTracks().forEach((track) => track.stop()));
      return runSimulated(run, e instanceof ModelsUnavailableError ? "models" : "load");
    }
    if (stale()) {
      void camera.then(({ stream }) => stream?.getTracks().forEach((track) => track.stop()));
      return;
    }
    setEngineInfo({ detector: engine.detector, backend: engine.backend });
    setSimulated(false);

    const { stream } = await camera;
    if (!stream) return runSimulated(run, "camera");
    if (stale()) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    if (!cropRef.current) cropRef.current = document.createElement("canvas");
    if (!alignRef.current) alignRef.current = document.createElement("canvas");
    if (!patchRef.current) patchRef.current = document.createElement("canvas");

    setPhase("detect");
    const session = new LivenessSession(challenge, { minScore: MIN_SCORE });
    const deadline = performance.now() + CAPTURE_TIMEOUT_MS;
    let lastDescriptorAt = 0;
    let challengeDone = false;
    // Whether the AdaFace weights are on this machine. Decided once, before the first frame, so the
    // loop never changes its mind halfway through a capture.
    // Which embedding space this capture happens in is decided once, here, rather than after the
    // fact — otherwise the label under the preview advertises AdaFace for a capture that was never
    // going to use it, and README promises that label is honest.
    //
    // A reference settles it: a 128-d one (an ID card read by the fallback net, or an enrolment made
    // before AdaFace) forces the older space. With no reference — a step-up — the template already
    // in this browser settles it instead. That second case matters more than it looks: choosing
    // AdaFace here purely because the weights are present, against a browser holding a 128-d
    // template, produces a probe that cannot be compared to it and fails the step-up closed every
    // time, permanently, with nothing the user can do about it.
    const stored = reference ? null : await getDescriptor().catch(() => null);
    const space = reference ?? stored;
    const useAdaFace = (await adafaceAvailable()) && (!space || space.length === ADAFACE_DIM);
    if (stale()) return;
    setEmbedModel(useAdaFace ? "adaface" : "faceapi");
    /** The best few aligned crops seen this session, newest kept by detection score. */
    const crops: { score: number; face: AlignedFace }[] = [];
    let lastAlignAt = 0;
    let challengeDoneAt = 0;

    // Whether the anti-spoofing weights are on this machine. Decided once, before the first frame,
    // so the loop never changes its mind halfway through a capture — and so a capture that could
    // never run the check reports it as unmeasured from the start rather than looking like one that
    // ran it and found nothing.
    const useAntiSpoof = await antispoofAvailable();
    if (stale()) return;
    /** Live probabilities, one per scored patch. */
    const liveProbs: number[] = [];
    let lastSpoofAt = 0;
    /**
     * Only ever one patch in flight.
     *
     * The scoring is deliberately not awaited inside the frame loop — a round trip to the worker is
     * milliseconds, but it is milliseconds the overlay would spend not being drawn. Letting a second
     * patch go while the first is out would queue them behind each other in the worker and hand back
     * scores for frames that are already history, so the loop simply skips its turn instead.
     */
    let spoofInFlight = false;

    const loop = async () => {
      try {
        await frame();
      } catch (e) {
        // A frame can throw for reasons that have nothing to do with the user: a WebGL context lost
        // when a laptop sleeps, a video element that went away mid-read. Unhandled, the rAF chain
        // simply stops — camera on, no pending await, and the retry button hidden because it only
        // renders for "idle" and "error". Landing in "error" is what makes that recoverable.
        if (stale()) return;
        releaseCamera();
        setMessage((e as Error).message);
        setPhase("error");
      }
    };

    const frame = async () => {
      if (stale() || !videoRef.current) return;
      if (performance.now() > deadline) {
        // releaseCamera, not stop: this run continues into the simulated path, and stop() would
        // retire the generation the very next line is about to check.
        releaseCamera();
        return runSimulated(run, "timeout");
      }

      const now = performance.now();
      const wantDescriptor = now - lastDescriptorAt > DESCRIPTOR_INTERVAL_MS;
      const sample = await engine.detect(videoRef.current, wantDescriptor);
      if (stale()) return;
      if (wantDescriptor && sample?.descriptor) lastDescriptorAt = now;
      setEngineInfo((prev) => (prev && prev.detector === engine.detector ? prev : { detector: engine.detector, backend: engine.backend }));

      if (!sample) {
        setFaceFound(false);
        draw(null, []);
        rafRef.current = requestAnimationFrame(() => void loop());
        return;
      }
      setFaceFound(true);
      draw(sample.box, sample.points);
      if (phaseRef.current === "detect") setPhase("challenge");

      const result = session.push({
        t: now,
        points: sample.points,
        score: sample.score,
        faces: sample.faces,
        box: sample.box,
        frameWidth: videoRef.current.videoWidth || 640,
        frameHeight: videoRef.current.videoHeight || 480,
        crop: readFaceCrop(videoRef.current, sample.box, cropRef.current!),
        descriptor: sample.descriptor,
        happy: sample.happy,
      });
      setStepIndex(result.stepIndex);
      setProgress(result.stepProgress);
      setHint(result.hint);
      setVerdict(result.verdict);
      if (result.complete && !challengeDone) {
        challengeDone = true;
        challengeDoneAt = now;
      }

      // A second face in frame makes it ambiguous whose embedding this would be, and the liveness
      // signals already treat that as suspicious — so those frames contribute no crop.
      if (useAdaFace && sample.faces === 1 && now - lastAlignAt > ALIGN_INTERVAL_MS) {
        const face = alignFace(videoRef.current, sample.points, alignRef.current!);
        if (face) {
          lastAlignAt = now;
          crops.push({ score: sample.score, face });
          if (crops.length > MAX_ALIGNED) {
            let worst = 0;
            for (let i = 1; i < crops.length; i++) if (crops[i]!.score < crops[worst]!.score) worst = i;
            crops.splice(worst, 1);
          }
        }
      }

      // The live AI check. Every frame is eligible, including the ones with a second face in
      // shot: a phone held up beside a head is exactly the scene MiniFASNet was trained to
      // recognise, so excluding those frames would blind the model to its best evidence.
      if (useAntiSpoof && !spoofInFlight && now - lastSpoofAt > SPOOF_INTERVAL_MS) {
        const patch = readSpoofPatch(videoRef.current, sample.box, patchRef.current!, {
          width: videoRef.current.videoWidth || 640,
          height: videoRef.current.videoHeight || 480,
        });
        if (patch) {
          lastSpoofAt = now;
          spoofInFlight = true;
          void scoreLive([patch])
            .then(([live]) => {
              if (stale() || live === undefined) return;
              liveProbs.push(live);
              setLiveProbability(medianLiveProbability(liveProbs));
            })
            .catch(() => {
              // The worker died, or the weights went away mid-capture. The rest of the check is
              // unaffected and the verdict will simply rest on fewer samples — or on none, which is
              // reported as unmeasured rather than as a pass.
            })
            .finally(() => {
              spoofInFlight = false;
            });
        }
      }

      // Keep sampling after the last challenge step until there is enough to average into a
      // template — one frame's embedding is far noisier than five.
      //
      // The two requirements time out differently on purpose. Descriptors are cheap and arrive on a
      // fixed cadence, so too few of them means the capture genuinely is not finished and we wait,
      // exactly as this loop always has. Aligned crops are the new requirement and a face that will
      // simply not align — heavy glasses, an extreme angle held to the end — must not hold the flow
      // open until the capture timeout; after the grace window we embed the crops we have, or fall
      // back to the descriptor net.
      const shortOfDescriptors = session.samples.length < MIN_DESCRIPTORS;
      const shortOfCrops = useAdaFace && crops.length < MIN_ALIGNED && now - challengeDoneAt < ALIGN_GRACE_MS;
      const shortOfSpoof = useAntiSpoof && liveProbs.length < MIN_SPOOF_SAMPLES && now - challengeDoneAt < SPOOF_GRACE_MS;
      if (!challengeDone || shortOfDescriptors || shortOfCrops || shortOfSpoof) {
        rafRef.current = requestAnimationFrame(() => void loop());
        return;
      }

      // The frame that is about to be scored is the evidence, so it is taken while the stream is
      // still live rather than relying on the video element holding its last decoded frame after
      // the tracks are stopped.
      const frame = capture ? await captureFrame(videoRef.current) : undefined;
      // Order matters: releaseCamera touches the shared rAF handle and stream, so a superseded run
      // reaching here would tear down whichever capture is actually live.
      if (stale()) return;
      releaseCamera();

      const final = session.verdict();
      setVerdict(final);
      if (ENFORCE && !final.passed) {
        setMessage(t("onboard.spoofBody", { score: Math.round(final.score * 100) }));
        setPhase("error");
        return;
      }

      // face-api's average is computed either way: it is the fallback when AdaFace is not on this
      // machine, when no crop would align, and when the reference we must be judged against is
      // itself an older 128-d template.
      const legacyTemplate = averageDescriptor(session.samples);

      let template: Float32Array | null = null;
      let templateModel: EmbeddingModel = "faceapi";
      let templateSamples = session.samples.length;
      if (useAdaFace && crops.length) {
        setPhase("embedding");
        try {
          const embeddings = await embedAligned(crops.map((c) => c.face));
          const averaged = averageEmbedding(embeddings);
          if (averaged) {
            template = averaged;
            templateModel = "adaface";
            templateSamples = embeddings.length;
          }
        } catch {
          // The worker died, or the weights went away mid-capture. The descriptor net is still here.
        }
      }
      if (!template) {
        template = legacyTemplate;
        templateModel = "faceapi";
        templateSamples = session.samples.length;
      }
      if (stale()) return;
      setEmbedModel(templateModel);
      // Unreachable in practice — the completion gate above will not let the loop exit with fewer
      // than MIN_DESCRIPTORS samples, so averageDescriptor always has something to average — but a
      // capture that somehow reached here with nothing must not sign a nonce for an empty template.
      if (!template) {
        return runSimulated(run, "timeout");
      }

      let faceMatchScore: number | undefined;
      try {
        if (reference) {
          // Scored against what was supplied: the ID card's face at signup, the approved template
          // at login. Either way the comparison happens here and only the number is sent.
          const scored = scoreMatch(reference, template);
          if (!scored) {
            // The reference and this capture are in different embedding spaces. That is a stale
            // enrolment, not a failed match, and saying so is the only honest thing to do.
            setMessage(t("verify.modelMismatch"));
            setPhase("error");
            return;
          }
          faceMatchScore = scored.score;
          setMatchDistance(scored.distance);
          setMatchScore(faceMatchScore);
          if (faceMatchScore < (minMatchScore ?? DEFAULT_MIN_MATCH)) {
            setMessage(t("verify.matchTooLow", { score: faceMatchScore, required: minMatchScore ?? DEFAULT_MIN_MATCH }));
            setPhase("error");
            setRejected(true);
            return;
          }
          // Both modes write the template back, and that is the repair path for a browser whose
          // stored template is in the other space. A login is scored against what an administrator
          // approved, so a passing match is proof this capture belongs in that space — and without
          // writing it back, a device holding an older 128-d template would fail every later
          // step-up closed, with no way to fix it from the browser it is stuck in.
          if (stale()) return;
          await getOrCreateIdentity();
          await saveDescriptor(template, templateSamples, templateModel);
        } else if (mode === "enrol") {
          await getOrCreateIdentity();
          await saveDescriptor(template, templateSamples, templateModel);
        } else {
          const match = await matchFace(template);
          setMatchDistance(match.distance);
          if (match.mismatchedModel) {
            // The template in this browser came from the other net, so there is nothing to compare
            // against. A step-up that cannot check the face must not proceed as though it had.
            setMessage(t("verify.modelMismatch"));
            setPhase("error");
            return;
          }
          if (!match.ok) {
            setMessage(t("onboard.mismatch", { distance: match.distance?.toFixed(2) ?? "—" }));
            setPhase("error");
            setRejected(true);
            return;
          }
        }
      } catch (e) {
        setMessage((e as Error).message);
        setPhase("error");
        return;
      }
      // One number and its sample count. The gateway judges it against its own floor — a browser
      // that reported a confident spoof is not asked whether it minded.
      const live = medianLiveProbability(liveProbs);
      const spoofCheck = live === null ? undefined : { model: SPOOF_MODEL, samples: liveProbs.length, liveProbability: Math.round(live * 1000) / 1000 };
      await finish(run, "faceapi", final, { faceMatchScore, faceImage: frame, template: Array.from(template), templateSamples, templateModel, spoofCheck });
    };
    void loop();
  }, [capture, challenge, draw, finish, minMatchScore, mode, reference, releaseCamera, runSimulated, t]);

  const phaseRef = useRef<Phase>("idle");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  /**
   * A refused face is a verdict, not a hint, so it takes the screen and then takes the browser back
   * to the door. The navigation is a full one on purpose: it drops the nonce, the reference and
   * every frame this capture is still holding, rather than routing into a flow that remembers them.
   */
  useEffect(() => {
    if (!rejected || !mismatchRedirect) return;
    const deadline = Date.now() + MISMATCH_REDIRECT_SECONDS * 1000;
    setCountdown(MISMATCH_REDIRECT_SECONDS);
    document.body.style.overflow = "hidden";
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setCountdown(left);
      if (left === 0) {
        clearInterval(id);
        // replace, not assign: the failed capture is not somewhere the back button should return to.
        window.location.replace(mismatchRedirect);
      }
    }, 250);
    return () => {
      clearInterval(id);
      document.body.style.overflow = "";
    };
  }, [mismatchRedirect, rejected]);

  // Whether or not this capture has been started yet, the weights can be on their way.
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_LIVENESS_MODE !== "simulated") prefetchFaceEngine();
    const unsubscribeModels = onModelProgress(setLoadProgress);
    // The AdaFace backbone is the largest single thing a face step downloads, and it arrives on its
    // own schedule behind the face-api nets. Without this the biggest wait in the flow is the one
    // the UI says nothing about.
    const unsubscribeAda = onAdaFaceProgress(setAdaProgress);
    return () => {
      unsubscribeModels();
      unsubscribeAda();
    };
  }, []);

  /**
   * Auto-start, exactly once per mount.
   *
   * Two things make this fiddly. React 18+ StrictMode mounts, unmounts and remounts every effect in
   * development, and the unmount aborts the capture that was just started — so a `started` flag that
   * survived it would refuse to start the second one and leave the camera stuck on "loading" with no
   * retry button, which is to say the whole flow would work only in a production build. And `start`
   * is rebuilt on every render by any parent that passes an inline `onComplete`, so depending on its
   * identity here would tear the camera down and restart it on every keystroke. Hence: the effect
   * keys on `autoStart` alone and reaches the current `start` through a ref.
   */
  /**
   * Start, with nowhere for a rejection to hide.
   *
   * `start` is fired and forgotten from an effect and from a click handler, so anything it throws
   * before the frame loop takes over — a camera API that is not there, a probe that rejects — would
   * otherwise be an unhandled rejection that leaves the phase on "loading" with no button to press.
   */
  const startSafely = useCallback(() => {
    void start().catch((e: unknown) => {
      if (abortRef.current) return;
      releaseCamera();
      setMessage((e as Error).message);
      setPhase("error");
    });
  }, [releaseCamera, start]);

  const startRef = useRef(startSafely);
  useEffect(() => {
    startRef.current = startSafely;
  });
  useEffect(() => {
    if (!autoStart) return;
    startRef.current();
  }, [autoStart]);

  const steps: Challenge[] = challenge;
  const active = phase === "challenge" || phase === "detect";
  const scorePercent = verdict ? Math.round(verdict.score * 100) : 0;
  // Resolved up here so the caption's ground is only painted when there is something to read: an
  // empty scrim pill hovering over the preview is a smudge on the lens.
  const caption = !faceFound ? t("onboard.steps.detect") : hint ? t(`onboard.hints.${hint}`) : "";
  const failed = phase === "error";

  return (
    <div className="space-y-4">
      {/* The housing. Border + panel shadow, no third cue: the console well is only ~6% below the
          ground, so it needs an explicit rim to read as a separate layer at all. The rim brightens
          to the accent the moment a face is acquired — the one piece of feedback that has to be
          readable from across a room. */}
      <div
        className={cx(
          "relative mx-auto aspect-[4/3] w-full max-w-sm overflow-hidden rounded-[var(--radius-card)] border bg-console shadow-panel",
          "transition-[border-color] duration-150 ease-out",
          faceFound && !simulated ? "border-brass-line" : "border-line",
        )}
      >
        <video ref={videoRef} playsInline muted className={cx("h-full w-full scale-x-[-1] object-cover transition-opacity duration-300 ease-out", simulated && "opacity-0")} />
        <canvas ref={overlayRef} className={cx("pointer-events-none absolute inset-0 h-full w-full scale-x-[-1] object-cover", simulated && "hidden")} aria-hidden />
        {simulated && (
          <div className="grain absolute inset-0 flex flex-col items-center justify-center gap-3 text-console-muted">
            <svg viewBox="0 0 64 64" className="h-16 w-16" fill="none" aria-hidden>
              <circle cx="32" cy="24" r="11" stroke="currentColor" strokeWidth="2" />
              <path d="M12 54c2.6-10.5 10.4-16 20-16s17.4 5.5 20 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <Chip tone="warn" icon={Icon.warn} className="stamp">
              {t("onboard.simulatedBadge")}
            </Chip>
          </div>
        )}
        {active && (
          <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
            <circle cx="50" cy="50" r="34" fill="none" stroke="var(--color-line)" strokeWidth="1.5" />
            <circle
              cx="50"
              cy="50"
              r="34"
              fill="none"
              stroke="var(--color-console-accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 34}
              strokeDashoffset={2 * Math.PI * 34 * (1 - (stepIndex + progress) / Math.max(steps.length, 1))}
              transform="rotate(-90 50 50)"
              style={{ transition: "stroke-dashoffset var(--dur-fast) linear" }}
            />
            {/* One graduation per challenge step, latched to verdigris as each one is banked. The
                arc alone says how far along; the ticks say how many gates there were. */}
            {steps.map((_, i) => {
              const a = ((i / Math.max(steps.length, 1)) * 360 - 90) * (Math.PI / 180);
              const banked = i < stepIndex;
              return (
                <line
                  key={`tick-${i}`}
                  x1={50 + Math.cos(a) * 30}
                  y1={50 + Math.sin(a) * 30}
                  x2={50 + Math.cos(a) * 38}
                  y2={50 + Math.sin(a) * 38}
                  stroke={banked ? "var(--color-verdigris)" : "var(--color-line-strong)"}
                  strokeWidth="1.25"
                  strokeLinecap="round"
                  style={{ transition: "stroke var(--dur-fast) var(--ease-out)" }}
                />
              );
            })}
          </svg>
        )}
        {active && !simulated && caption && (
          <p className="absolute inset-x-0 bottom-3 flex justify-center px-3">
            <span className="rounded-[var(--radius-pill)] bg-scrim px-3 py-1 text-center font-mono text-[0.75rem] text-console-accent">{caption}</span>
          </p>
        )}
      </div>

      {engineInfo && !simulated && (
        <p className="text-center font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-ink-3">
          {t(`onboard.detector.${engineInfo.detector}`)} · {t(`onboard.embedNet.${embedModel ?? "faceapi"}`)} · {engineInfo.backend}
        </p>
      )}

      <ol className="space-y-1.5">
        {steps.map((step, i) => {
          const state = i < stepIndex ? "done" : i === stepIndex && active ? "active" : "pending";
          return (
            <li
              key={`${step}-${i}`}
              // Every row carries a transparent rim so the active row's accent hairline arrives
              // without nudging the column half a pixel sideways.
              className={cx(
                "flex items-center gap-2.5 rounded-[var(--radius-control)] border px-3 py-2 text-[0.875rem]",
                "transition-[color,background-color,border-color] duration-150 ease-out",
                state === "active" ? "border-brass-line bg-brass-soft" : "border-transparent",
                state === "done" && "text-ink-3",
              )}
            >
              <span
                className={cx(
                  "tnum grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-pill)] border font-mono text-[0.6875rem] leading-none",
                  "transition-[color,background-color,border-color] duration-150 ease-out",
                  state === "done"
                    ? "border-verdigris bg-verdigris text-paper"
                    : state === "active"
                      ? "border-brass text-brass"
                      : "border-line text-ink-3",
                )}
              >
                {state === "done" ? <span className="tick">✓</span> : i + 1}
              </span>
              <span className={cx(state === "active" && "font-medium text-ink")}>{t(`onboard.steps.${step}`)}</span>
              <span
                className={cx(
                  "ml-auto text-[0.6875rem] font-medium uppercase tracking-[0.1em]",
                  state === "done" ? "text-verdigris" : state === "active" ? "text-brass-deep" : "text-ink-3",
                )}
              >
                {state === "done" ? t("onboard.stepDone") : state === "active" ? t("onboard.stepActive") : t("onboard.stepPending")}
              </span>
            </li>
          );
        })}
      </ol>

      {verdict && !simulated && (
        // The panel owns the rim; its header takes a bottom rule and one overlay step, never a
        // border of its own. Two adjacent surfaces do not both draw a line.
        <div className="rise overflow-hidden rounded-[var(--radius-field)] border border-line bg-paper">
          <div className="flex items-center gap-2 border-b border-line bg-paper-2 px-4 py-2">
            <p className="eyebrow">{t("onboard.livenessScore")}</p>
            <Chip
              tone={verdict.passed ? "good" : scorePercent > 25 ? "warn" : "bad"}
              icon={verdict.passed ? Icon.check : scorePercent > 25 ? Icon.warn : Icon.cross}
              className="ml-auto tnum stamp"
            >
              {n(scorePercent)}%
            </Chip>
          </div>
          <div className="px-4 py-3">
            <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
              {SIGNAL_ORDER.map((id) => {
                const value = verdict.signals[id];
                return (
                  <div key={id} className="flex items-center gap-2.5">
                    <span className="w-[5.5rem] shrink-0 text-[0.75rem] text-ink-2" title={t(`onboard.signalHelp.${id}`)}>
                      {t(`onboard.signals.${id}`)}
                    </span>
                    {value === null ? (
                      <span className="text-[0.6875rem] uppercase tracking-[0.1em] text-ink-3">{t("onboard.signalUnmeasured")}</span>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1">
                          <Meter value={Math.round(value * 100)} tone={value > 0.6 ? "good" : value > 0.3 ? "warn" : "bad"} showValue={false} />
                        </span>
                        {/* The rail is the shape of the signal; the numeral is the evidence. It is
                            machine-made, so it is mono and column-aligned. */}
                        <span className="tnum w-8 shrink-0 text-right font-mono text-[0.6875rem] text-ink-3">{n(Math.round(value * 100))}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-2.5 text-[0.75rem] leading-relaxed text-ink-3">{t("onboard.livenessNote")}</p>
          </div>
          {/* The model's own opinion, kept visually apart from the six signals above it. Those are a
              weighted composite; this is a second, independent verdict, and running the two together
              in one grid would read as though it were a seventh weight. */}
          {liveProbability !== null && (
            <div className="flex items-center gap-2 border-t border-line bg-paper-2 px-4 py-2">
              <p className="eyebrow" title={t("onboard.aiCheckHelp")}>
                {t("onboard.aiCheck")}
              </p>
              <span className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-ink-3">{t("onboard.aiCheckModel")}</span>
              <Chip
                tone={liveProbability >= SPOOF_CHIP_FLOOR ? "good" : "bad"}
                icon={liveProbability >= SPOOF_CHIP_FLOOR ? Icon.check : Icon.cross}
                className="ml-auto tnum stamp"
              >
                {n(Math.round(liveProbability * 100))}%
              </Chip>
            </div>
          )}
          {matchScore !== null ? (
            <div className="flex items-center gap-2 border-t border-line bg-paper-2 px-4 py-2">
              <p className="eyebrow">{t("verify.matchScore")}</p>
              <Chip
                tone={matchScore >= (minMatchScore ?? DEFAULT_MIN_MATCH) ? "good" : "bad"}
                icon={matchScore >= (minMatchScore ?? DEFAULT_MIN_MATCH) ? Icon.check : Icon.cross}
                className="ml-auto tnum"
              >
                {n(matchScore)}%
              </Chip>
              <span className="tnum font-mono text-[0.6875rem] text-ink-3">d={matchDistance?.toFixed(2) ?? "—"}</span>
            </div>
          ) : (
            matchDistance !== null && (
              <p className="tnum border-t border-line px-4 py-2 font-mono text-[0.75rem] text-ink-3">{t("onboard.matchDistance", { distance: matchDistance.toFixed(2) })}</p>
            )
          )}
        </div>
      )}

      {message && (
        // A note and a refusal are not the same event. saffron is louder than oxide on a dark
        // ground, so the glyph — not the hue — carries which one this is.
        <p
          role="status"
          className={cx(
            "rise flex items-start gap-2 rounded-[var(--radius-field)] border px-3 py-2 text-[0.8125rem]",
            failed ? "border-oxide-line bg-oxide-soft text-oxide" : "border-saffron-line bg-saffron-soft text-saffron",
          )}
        >
          <span aria-hidden className="leading-5">
            {failed ? "✗" : "⚠"}
          </span>
          <span className="min-w-0 flex-1">{message}</span>
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-line-faint pt-4">
        {onCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              stop();
              onCancel();
            }}
          >
            {t("common.cancel")}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {phase === "embedding" && (
            <span className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
              <Spinner /> {t("onboard.embedding")}
            </span>
          )}
          {phase === "signing" && (
            <span className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
              <Spinner /> {t("access.verifying")}
            </span>
          )}
          {phase === "done" && (
            <Chip tone="good" icon={Icon.check} className="stamp">
              {t("onboard.stepDone")}
            </Chip>
          )}
          {(phase === "idle" || phase === "error") && (
            <Button variant="primary" onClick={startSafely}>
              {phase === "error" ? t("onboard.retry") : t("onboard.start")}
            </Button>
          )}
          {phase === "loading" && (
            <span className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
              <Spinner /> {t("onboard.loadingModels")}
              <span className="tnum font-mono text-[0.75rem] text-ink-3">{n(Math.round(loadProgress.ratio * 100))}%</span>
            </span>
          )}
          {/* The backbone keeps arriving behind the live preview, so this outlives the loading phase. */}
          {!simulated && adaProgress.ratio > 0 && !adaProgress.ready && phase !== "done" && phase !== "error" && (
            <span className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
              <Spinner /> {t("onboard.loadingAdaFace")}
              <span className="tnum font-mono text-[0.75rem] text-ink-3">{n(Math.round(adaProgress.ratio * 100))}%</span>
            </span>
          )}
        </div>
      </div>

      {/* The refusal. Everything that produced it is still on the page underneath — the six signals,
          the AI check, the score and the distance — because the evidence is the point; but the flow
          is over, so the verdict occludes it and the door closes behind it on its own. No scrim
          click and no Escape: this is not a panel someone dismisses back onto a live camera.
          Portalled to the body: a `.stamp` anywhere above this would otherwise become the containing
          block for `fixed` and hang the verdict off the middle of a card. */}
      {rejected &&
        mismatchRedirect &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-scrim p-4 backdrop-blur-[3px]">
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="face-rejected-title"
              className="stamp w-full max-w-md rounded-[var(--radius-card)] bg-paper-raised p-6 text-center shadow-float"
            >
              <span
                aria-hidden
                className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-oxide-line bg-oxide-soft text-[1.625rem] leading-none text-oxide"
              >
                ✗
              </span>
              <Chip tone="bad" icon={Icon.cross} className="mb-3">
                {t("verify.refused")}
              </Chip>
              <h2 id="face-rejected-title" className="mb-2 font-display text-[1.375rem] tracking-[-0.015em] text-ink">
                {t("verify.rejectedTitle")}
              </h2>
              <p className="mb-4 text-[0.9375rem] leading-relaxed text-ink-2">{t("verify.rejectedBody")}</p>
              {/* The sentence the panel underneath is already showing — the score, and the floor it
                  fell short of. A refusal that does not carry its own number is an assertion. */}
              {message && (
                <p className="mb-4 rounded-[var(--radius-field)] border border-oxide-line bg-oxide-soft px-3.5 py-2.5 text-left text-[0.8125rem] leading-relaxed text-oxide">
                  {message}
                </p>
              )}
              <p role="status" className="mb-2 text-[0.8125rem] text-ink-3">
                {t("verify.rejectedRedirect", { seconds: n(countdown) })}
              </p>
              {/* The countdown, drawn: a rail that runs out is the one part of this card that can be
                  read without being read. */}
              <div aria-hidden className="mb-5 h-1 w-full overflow-hidden rounded-[var(--radius-pill)] bg-paper-3">
                <div
                  className="h-full rounded-[var(--radius-pill)] bg-oxide transition-[width] duration-1000 ease-linear"
                  style={{ width: `${(countdown / MISMATCH_REDIRECT_SECONDS) * 100}%` }}
                />
              </div>
              <Button variant="primary" autoFocus className="w-full justify-center" onClick={() => window.location.replace(mismatchRedirect)}>
                {t("verify.rejectedNow")}
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
