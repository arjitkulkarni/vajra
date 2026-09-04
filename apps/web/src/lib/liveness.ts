/**
 * On-device liveness: the anti-spoofing engine behind the face check.
 *
 * A challenge on its own ("turn your head, then smile") proves very little — a video replay does
 * all of it. So the challenge is only half of what runs here. Alongside it, six passive signals are
 * measured continuously from the landmark geometry and the face crop, and combined into one score:
 *
 *   depth        out-of-plane structure. A best-fit affine map is solved between the reference
 *                frontal landmarks and the current ones over nine roughly coplanar points (jaw
 *                ends, chin, outer brows, eye corners). The nose tip is excluded from the fit, so
 *                its residual measures how far the nose stands out of the face plane. It is worth
 *                being precise about what this catches. A still image — printed, or held up on a
 *                phone — is planar: an affine map explains it exactly, the residual stays at zero,
 *                and because the nose never leaves the eye midpoint such an image cannot satisfy a
 *                head-turn challenge at all. A recorded video replayed on a screen does carry the
 *                real parallax of the head that was filmed, so depth does not catch that case;
 *                focus, texture and the single-use server nonce are what stand in its way.
 *   motion       non-rigid micro-motion. Shapes are normalised (translation, scale and in-plane
 *                rotation removed), then the brow, eyelid and mouth points are measured against
 *                their own session mean. A rigid object carried in front of the lens has none of
 *                this. Eyelids are in that set deliberately: a blink still counts here, as raw
 *                deformation the rigid pose cannot account for, rather than as an event some
 *                threshold has to catch in the one or two frames a webcam gives it. Measuring it
 *                this way needs no learned baseline, no noise floor and no duration window — which
 *                is what let the open-closed-open detector, and everything that made it fragile, go.
 *   response     reaction time. Each step of the challenge is timed from the moment it goes up in
 *                front of the operator to the moment it is satisfied. A step banked on the first
 *                frame it was shown was already satisfied before it was asked for; one answered a
 *                quarter of a second to a few seconds later is a person reading a prompt and doing
 *                what it says. This is what makes an active challenge worth anything: the steps and
 *                their order are drawn by the server per nonce, so a recording made in advance
 *                cannot have answered the one that is about to be asked.
 *   focus        Laplacian variance of the face crop. Rejects the blurry print and the low-grade
 *                replay, and doubles as a capture-quality gate.
 *   texture      screen-replay tell-tales: blown specular highlights and the narrowed chroma
 *                spread a re-photographed display tends to produce.
 *   consistency  one face in frame throughout, and one identity — the 128-d descriptors sampled
 *                across the session have to stay close to each other, so a face swapped in
 *                mid-challenge fails even if every other signal is perfect.
 *
 * Everything is pure geometry and arithmetic over data the caller supplies: no face-api types, no
 * DOM, no network. That keeps it testable, and it keeps the privacy claim literal — frames are
 * read, measured and dropped, and nothing but a score ever leaves this module.
 */

export type Challenge = "turn_left" | "turn_right" | "smile";
export type SignalId = "depth" | "motion" | "response" | "focus" | "texture" | "consistency";
export type HintId = "center" | "closer" | "steady" | "light" | "multiple";

export interface Point {
  x: number;
  y: number;
}

/** Everything one frame contributes. `crop` and `descriptor` may be sampled less often than landmarks. */
export interface Frame {
  t: number;
  points: Point[];
  score: number;
  faces: number;
  box: { x: number; y: number; width: number; height: number };
  frameWidth: number;
  frameHeight: number;
  /** RGBA pixels of the face crop, any square size. */
  crop?: { data: Uint8ClampedArray; width: number; height: number } | null;
  descriptor?: Float32Array | null;
  happy?: number;
}

export interface LivenessVerdict {
  /** 0-1 per signal, or null when this session could not measure it (e.g. no head turn was asked for). */
  signals: Record<SignalId, number | null>;
  /** Weighted mean over the measured signals. */
  score: number;
  passed: boolean;
}

export interface FrameResult {
  stepIndex: number;
  stepProgress: number;
  complete: boolean;
  hint: HintId | null;
  verdict: LivenessVerdict;
}

// ─── Tuning ──────────────────────────────────────────────────────────────────
// Calibrated against 640x480 webcam input with a 112 px face crop. These are the knobs: raise the
// floors to make the check harsher, raise the ceilings to make a signal harder to max out.

export const TUNING = {
  /**
   * Reaction times for the `response` signal, in milliseconds.
   *
   * Under `responseMinMs` the step was satisfied on the very first frame it was shown, so the pose
   * was already being held when it was asked for. That is what a recording looks like — but it is
   * also what someone who happens to already be smiling looks like, so it scores a fraction rather
   * than a zero. From there to `responseComfortMs` is a person reading a prompt and doing what it
   * says. Past that the reaction is still human, only slow, so it decays towards
   * `responseSlowScore` at `responseSlowMs` rather than falling over a cliff.
   */
  responseMinMs: 250,
  responseFastScore: 0.35,
  responseComfortMs: 6000,
  responseSlowMs: 20000,
  responseSlowScore: 0.4,
  /** Nose-tip offset in interocular units. 0.13 is about a 20-degree turn on a typical face. */
  yaw: 0.13,
  yawHoldFrames: 4,
  smile: 0.55,
  /** Depth needs the head to actually move; below this yaw spread the signal is reported as null. */
  depthMinYawSpread: 0.12,
  depthFloor: 0.02,
  depthCeil: 0.09,
  motionFloor: 0.004,
  motionCeil: 0.03,
  focusLogFloor: 0.7,
  focusLogCeil: 2.0,
  glareCeil: 0.05,
  chromaFloor: 3,
  chromaCeil: 14,
  descriptorFloor: 0.3,
  descriptorCeil: 0.62,
  minFaceWidthRatio: 0.2,
  offCentre: 0.22,
  minDetectorScore: 0.5,
} as const;

const WEIGHTS: Record<SignalId, number> = { depth: 0.28, motion: 0.26, response: 0.16, consistency: 0.12, focus: 0.1, texture: 0.08 };

export const DEFAULT_MIN_SCORE = 0.45;

// 68-point landmark indices (dlib convention, as face-api emits them).
const RIGHT_EYE = [36, 37, 38, 39, 40, 41];
const LEFT_EYE = [42, 43, 44, 45, 46, 47];
const NOSE_TIP = 30;
/** Roughly coplanar with the face plane — the fit basis for the depth signal. */
const PLANAR = [0, 8, 16, 17, 26, 36, 39, 42, 45];
/**
 * Independently mobile — brows, eyelids and mouth, where a living face never holds perfectly still.
 *
 * The eyelid points here are the four per eye that are not corners: the corners (36, 39, 42, 45)
 * anchor the planar fit above and barely move, while the lids ride up and down over them. Including
 * them is what keeps a blink worth something now that nothing detects one — a closure is simply a
 * large residual the rigid pose cannot explain, and that is what this signal already measures.
 */
const MOBILE = [17, 19, 21, 22, 24, 26, 37, 38, 40, 41, 43, 44, 46, 47, 48, 51, 54, 57, 62, 66];

// ─── Small helpers ───────────────────────────────────────────────────────────

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Map a raw measurement onto 0-1 between a floor and a ceiling. */
const band = (v: number, floor: number, ceil: number) => clamp01((v - floor) / (ceil - floor));
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function centroid(points: Point[]): Point {
  return { x: mean(points.map((p) => p.x)), y: mean(points.map((p) => p.y)) };
}

/**
 * What one reaction time is worth. See the `response` notes in TUNING for why instant is not free.
 */
function reactionScore(ms: number): number {
  if (ms < TUNING.responseMinMs) return TUNING.responseFastScore;
  if (ms <= TUNING.responseComfortMs) return 1;
  return 1 - (1 - TUNING.responseSlowScore) * band(ms, TUNING.responseComfortMs, TUNING.responseSlowMs);
}

export const interocular = (points: Point[]) =>
  dist(centroid(RIGHT_EYE.map((i) => points[i]!)), centroid(LEFT_EYE.map((i) => points[i]!))) || 1;

/**
 * Yaw proxy: the nose tip's offset from the eye midpoint, in interocular units.
 * The camera image is not mirrored, so the subject's own left side sits at larger x — turning your
 * head to your left carries the nose with it and the value goes positive.
 */
export function yaw(points: Point[]): number {
  const l = centroid(RIGHT_EYE.map((i) => points[i]!));
  const r = centroid(LEFT_EYE.map((i) => points[i]!));
  return (points[NOSE_TIP]!.x - (l.x + r.x) / 2) / interocular(points);
}

/**
 * Least-squares 2-D affine map src → dst, as [a, b, tx, c, d, ty].
 * Both coordinate rows share the same 3x3 normal matrix, so it is one inverse and two products.
 */
export function fitAffine(src: Point[], dst: Point[]): [number, number, number, number, number, number] | null {
  const n = Math.min(src.length, dst.length);
  if (n < 3) return null;
  let sxx = 0;
  let sxy = 0;
  let sx = 0;
  let syy = 0;
  let sy = 0;
  let bx0 = 0;
  let bx1 = 0;
  let bx2 = 0;
  let by0 = 0;
  let by1 = 0;
  let by2 = 0;
  for (let i = 0; i < n; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    sxx += x * x;
    sxy += x * y;
    sx += x;
    syy += y * y;
    sy += y;
    bx0 += x * u;
    bx1 += y * u;
    bx2 += u;
    by0 += x * v;
    by1 += y * v;
    by2 += v;
  }
  const m = [sxx, sxy, sx, sxy, syy, sy, sx, sy, n];
  const det =
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  // Inverse of the symmetric 3x3 normal matrix, by cofactors.
  const inv = [
    (m[4]! * m[8]! - m[5]! * m[7]!) / det,
    (m[2]! * m[7]! - m[1]! * m[8]!) / det,
    (m[1]! * m[5]! - m[2]! * m[4]!) / det,
    (m[5]! * m[6]! - m[3]! * m[8]!) / det,
    (m[0]! * m[8]! - m[2]! * m[6]!) / det,
    (m[2]! * m[3]! - m[0]! * m[5]!) / det,
    (m[3]! * m[7]! - m[4]! * m[6]!) / det,
    (m[1]! * m[6]! - m[0]! * m[7]!) / det,
    (m[0]! * m[4]! - m[1]! * m[3]!) / det,
  ];
  const solve = (b0: number, b1: number, b2: number): [number, number, number] => [
    inv[0]! * b0 + inv[1]! * b1 + inv[2]! * b2,
    inv[3]! * b0 + inv[4]! * b1 + inv[5]! * b2,
    inv[6]! * b0 + inv[7]! * b1 + inv[8]! * b2,
  ];
  const [a, b, tx] = solve(bx0, bx1, bx2);
  const [c, d, ty] = solve(by0, by1, by2);
  return [a, b, tx, c, d, ty];
}

const applyAffine = (A: number[], p: Point): Point => ({
  x: A[0]! * p.x + A[1]! * p.y + A[2]!,
  y: A[3]! * p.x + A[4]! * p.y + A[5]!,
});

/**
 * How far the nose tip sits outside the plane the rest of the face lies in, in interocular units.
 * Near zero for anything flat, however it is rotated or scaled.
 */
export function planarityResidual(reference: Point[], current: Point[]): number | null {
  const A = fitAffine(
    PLANAR.map((i) => reference[i]!),
    PLANAR.map((i) => current[i]!),
  );
  if (!A) return null;
  return dist(applyAffine(A, reference[NOSE_TIP]!), current[NOSE_TIP]!) / interocular(current);
}

/** Variance of the Laplacian over the crop's luminance. High = sharp, low = blurred or reprinted. */
export function laplacianVariance(crop: { data: Uint8ClampedArray; width: number; height: number }): number {
  const { data, width: w, height: h } = crop;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (!n) return 0;
  return sumSq / n - (sum / n) ** 2;
}

/** Blown-highlight fraction and chroma spread — the two cheap screen-replay tells. */
export function cropStats(crop: { data: Uint8ClampedArray; width: number; height: number }): { glare: number; chroma: number } {
  const { data } = crop;
  const n = data.length / 4;
  if (!n) return { glare: 0, chroma: 0 };
  let blown = 0;
  let rg = 0;
  let gb = 0;
  let rgSq = 0;
  let gbSq = 0;
  for (let p = 0; p < data.length; p += 4) {
    const r = data[p]!;
    const g = data[p + 1]!;
    const b = data[p + 2]!;
    if (r > 240 && g > 240 && b > 240) blown++;
    const a = r - g;
    const c = g - b;
    rg += a;
    gb += c;
    rgSq += a * a;
    gbSq += c * c;
  }
  const varRg = Math.max(0, rgSq / n - (rg / n) ** 2);
  const varGb = Math.max(0, gbSq / n - (gb / n) ** 2);
  return { glare: blown / n, chroma: Math.sqrt((varRg + varGb) / 2) };
}

export function euclidean(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(sum);
}

// ─── The session ─────────────────────────────────────────────────────────────

/**
 * Fed one frame at a time, it drives the challenge and accumulates the passive signals.
 * A session is single-use: build one per capture attempt.
 */
export class LivenessSession {
  private readonly challenge: Challenge[];
  private readonly minScore: number;

  private index = 0;
  private hold = 0;
  private stepProgress = 0;
  /** When the step now in progress first went up in front of the operator. */
  private stepPromptedAt: number | null = null;
  /** One reaction time per satisfied step, in ms. The `response` signal is the mean of their scores. */
  private latencies: number[] = [];

  private reference: Point[] | null = null;
  private referenceScore = 0;
  private yawMin = Infinity;
  private yawMax = -Infinity;
  private depthPeak = 0;
  private depthMeasured = false;

  private residualFrames: Point[][] = [];
  private startedAt: number | null = null;

  private focusScores: number[] = [];
  private glares: number[] = [];
  private chromas: number[] = [];

  private descriptors: Float32Array[] = [];
  private sawCrowd = false;
  private frames = 0;

  constructor(challenge: Challenge[], opts?: { minScore?: number }) {
    this.challenge = challenge.length ? challenge : ["turn_left"];
    this.minScore = opts?.minScore ?? DEFAULT_MIN_SCORE;
  }

  /** Every descriptor seen this session — the caller averages them into an enrolment template. */
  get samples(): Float32Array[] {
    return this.descriptors;
  }

  push(frame: Frame): FrameResult {
    this.frames++;
    if (this.startedAt === null) this.startedAt = frame.t;
    // The first step is on screen from the first frame that carries a face. Every later one is
    // stamped the instant its predecessor is banked, down in `advance`.
    if (this.stepPromptedAt === null) this.stepPromptedAt = frame.t;
    if (frame.faces > 1) this.sawCrowd = true;
    if (frame.descriptor) this.descriptors.push(frame.descriptor);

    const points = frame.points;
    const y = yaw(points);
    this.yawMin = Math.min(this.yawMin, y);
    this.yawMax = Math.max(this.yawMax, y);

    this.trackReference(points, frame.score, y, frame.t);
    this.trackDepth(points, y);
    this.trackShape(points);
    if (frame.crop) this.trackPixels(frame.crop);

    const hint = this.hint(frame);
    this.advance(frame, y);

    return {
      stepIndex: this.index,
      stepProgress: this.stepProgress,
      complete: this.index >= this.challenge.length,
      hint,
      verdict: this.verdict(),
    };
  }

  /**
   * The frontal frame everything else is measured against: the most confident one in the opening
   * second and a half. It is frozen after that, so depth and micro-motion residuals stay comparable
   * across the whole session rather than stepping every time a better frame arrives.
   */
  private trackReference(points: Point[], score: number, y: number, t: number): void {
    if (this.reference && t - (this.startedAt ?? t) > 1500) return;
    if (Math.abs(y) > 0.06 || score <= this.referenceScore) return;
    this.reference = points.map((p) => ({ ...p }));
    this.referenceScore = score;
  }

  private trackDepth(points: Point[], y: number): void {
    if (!this.reference || Math.abs(y) < TUNING.yaw * 0.7) return;
    const residual = planarityResidual(this.reference, points);
    if (residual === null || !Number.isFinite(residual)) return;
    this.depthMeasured = true;
    this.depthPeak = Math.max(this.depthPeak, residual);
  }

  /**
   * Where the brows, eyelids and mouth sit once the whole rigid pose is mapped away.
   *
   * The same affine map the depth signal uses is fitted on the coplanar points, then applied to the
   * reference positions of the mobile ones. Whatever is left over is movement the pose cannot
   * explain. That distinction is the point: rotating a photograph moves every landmark by exactly
   * this affine, so its residual stays flat, while a face that is blinking, talking, breathing or
   * reacting does not.
   */
  private trackShape(points: Point[]): void {
    if (!this.reference) return;
    const reference = this.reference;
    const A = fitAffine(
      PLANAR.map((i) => reference[i]!),
      PLANAR.map((i) => points[i]!),
    );
    if (!A) return;
    const scale = interocular(points);
    this.residualFrames.push(
      MOBILE.map((i) => {
        const predicted = applyAffine(A, reference[i]!);
        return { x: (points[i]!.x - predicted.x) / scale, y: (points[i]!.y - predicted.y) / scale };
      }),
    );
    if (this.residualFrames.length > 240) this.residualFrames.shift();
  }

  private trackPixels(crop: NonNullable<Frame["crop"]>): void {
    this.focusScores.push(band(Math.log10(laplacianVariance(crop) + 1), TUNING.focusLogFloor, TUNING.focusLogCeil));
    const { glare, chroma } = cropStats(crop);
    this.glares.push(glare);
    this.chromas.push(chroma);
    if (this.focusScores.length > 240) {
      this.focusScores.shift();
      this.glares.shift();
      this.chromas.shift();
    }
  }

  private hint(frame: Frame): HintId | null {
    if (frame.faces > 1) return "multiple";
    if (frame.box.width / frame.frameWidth < TUNING.minFaceWidthRatio) return "closer";
    const cx = (frame.box.x + frame.box.width / 2) / frame.frameWidth;
    const cy = (frame.box.y + frame.box.height / 2) / frame.frameHeight;
    if (Math.abs(cx - 0.5) > TUNING.offCentre || Math.abs(cy - 0.5) > TUNING.offCentre) return "center";
    if (frame.score < TUNING.minDetectorScore) return "steady";
    if (this.focusScores.length > 8 && mean(this.focusScores.slice(-8)) < 0.2) return "light";
    return null;
  }

  /** Judge the current challenge step and move on when it is satisfied. */
  private advance(frame: Frame, y: number): void {
    const step = this.challenge[this.index];
    if (!step) return;
    let satisfied = false;

    if (step === "turn_left" || step === "turn_right") {
      // Measured towards the side that was asked for, so progress can be shown while the head is
      // still on its way rather than only once the threshold is crossed. Turns carry most of the
      // challenge now, and an operator given no feedback until the very end either overshoots or
      // gives up a few degrees short. The partial reading stops below 1 so that a full ring is only
      // ever the hold actually completing.
      const towards = step === "turn_left" ? y : -y;
      const wanted = towards > TUNING.yaw;
      this.hold = wanted ? this.hold + 1 : 0;
      this.stepProgress = wanted ? Math.min(this.hold / TUNING.yawHoldFrames, 1) : clamp01(towards / TUNING.yaw) * 0.8;
      satisfied = this.hold >= TUNING.yawHoldFrames;
    } else if (step === "smile") {
      const happy = frame.happy ?? 0;
      this.stepProgress = clamp01(happy / TUNING.smile);
      satisfied = happy > TUNING.smile;
    }

    if (!satisfied) return;
    this.latencies.push(frame.t - (this.stepPromptedAt ?? frame.t));
    // The next step goes up the moment this one is banked, so that is where its clock starts.
    this.stepPromptedAt = frame.t;
    this.hold = 0;
    this.stepProgress = 0;
    this.index++;
  }

  // ─── Scoring ───────────────────────────────────────────────────────────────

  private depthSignal(): number | null {
    const spread = this.yawMax - this.yawMin;
    if (!this.depthMeasured || !Number.isFinite(spread) || spread < TUNING.depthMinYawSpread) return null;
    return band(this.depthPeak, TUNING.depthFloor, TUNING.depthCeil);
  }

  private motionSignal(): number | null {
    if (this.residualFrames.length < 12) return null;
    const k = this.residualFrames[0]!.length;
    // Subtracting the session mean drops any constant misfit, leaving only variation over time.
    const avg: Point[] = Array.from({ length: k }, (_, j) => ({
      x: mean(this.residualFrames.map((f) => f[j]!.x)),
      y: mean(this.residualFrames.map((f) => f[j]!.y)),
    }));
    const deviation = mean(this.residualFrames.map((f) => mean(f.map((p, j) => dist(p, avg[j]!)))));
    return band(deviation, TUNING.motionFloor, TUNING.motionCeil);
  }

  /**
   * Unmeasurable until the first step is banked — before that there is no reaction to time, and
   * scoring a challenge that has not been answered yet as a failure would sink every capture in its
   * opening second.
   */
  private responseSignal(): number | null {
    if (!this.latencies.length) return null;
    return mean(this.latencies.map(reactionScore));
  }

  private consistencySignal(): number | null {
    if (this.sawCrowd) return 0;
    if (this.descriptors.length < 2) return this.frames > 8 ? 0.6 : null;
    let worst = 0;
    for (let i = 1; i < this.descriptors.length; i++) worst = Math.max(worst, euclidean(this.descriptors[0]!, this.descriptors[i]!));
    return 1 - band(worst, TUNING.descriptorFloor, TUNING.descriptorCeil);
  }

  private textureSignal(): number | null {
    if (this.glares.length < 6) return null;
    const glare = 1 - band(mean(this.glares), 0, TUNING.glareCeil);
    const chroma = band(mean(this.chromas), TUNING.chromaFloor, TUNING.chromaCeil);
    return clamp01(0.5 * glare + 0.5 * chroma);
  }

  verdict(): LivenessVerdict {
    const signals: Record<SignalId, number | null> = {
      depth: this.depthSignal(),
      motion: this.motionSignal(),
      response: this.responseSignal(),
      focus: this.focusScores.length ? mean(this.focusScores) : null,
      texture: this.textureSignal(),
      consistency: this.consistencySignal(),
    };
    // Unmeasurable signals drop out and the remaining weights are renormalised, so a challenge with
    // no head turn is judged on what it could actually observe rather than punished for the gap.
    let weighted = 0;
    let total = 0;
    for (const [id, value] of Object.entries(signals) as [SignalId, number | null][]) {
      if (value === null) continue;
      weighted += WEIGHTS[id] * value;
      total += WEIGHTS[id];
    }
    const score = total > 0 ? weighted / total : 0;
    return { signals, score, passed: total > 0 && score >= this.minScore };
  }
}
