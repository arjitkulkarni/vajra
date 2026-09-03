/**
 * On-device liveness: the anti-spoofing engine behind the face check.
 *
 * A challenge on its own ("blink, then turn your head") proves very little — a video replay does
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
 *                rotation removed), then the brow and mouth points are measured against their own
 *                session mean. A rigid object carried in front of the lens has none of this.
 *   blink        a closure of human duration with a real open-closed-open transition, not a slow
 *                occlusion and not a single dropped frame. The closing half is measured against a
 *                threshold learned from this face; the opening half against the bottom of the
 *                closure itself, so a baseline that has drifted cannot hide an ordinary blink.
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

export type Challenge = "blink" | "turn_left" | "turn_right" | "smile";
export type SignalId = "depth" | "motion" | "blink" | "focus" | "texture" | "consistency";
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
   * Bootstrap thresholds only. Eye-aspect-ratio is NOT comparable between people: eye shape,
   * camera angle and the landmark model's own precision put a wide-open eye anywhere between
   * 0.20 and 0.35. Held as absolutes these two numbers fail closed on a whole class of faces —
   * anyone whose open eye rests below `earOpen` can close it fully and never cross back above,
   * so the blink is never banked and the step waits forever. After `earBaselineFrames` the
   * session switches to thresholds proportional to a baseline learned from THIS face.
   */
  earClose: 0.2,
  earOpen: 0.26,
  /** Fractions of the learned open-eye baseline. */
  earCloseRatio: 0.72,
  earOpenRatio: 0.86,
  /**
   * How far back up from the bottom of a closure the eye must come for it to count as reopened,
   * as a fraction of the distance from that bottom to the baseline.
   *
   * This exists because `earOpenRatio` alone measures recovery against the wrong thing. The
   * baseline is the 75th percentile of the recent window, so a face that was wide open while the
   * prompt was being read and has since settled to its normal openness has a baseline describing
   * the *earlier* face: the eye reopens completely, sits below `earOpenRatio` x baseline, and the
   * closure is never banked. What the operator sees is a blink that does nothing — and then, when
   * the window finally decays far enough to notice the eye is open, a closure lasting several
   * seconds, which is rejected as an occlusion. Half way back from the bottom is unambiguous
   * recovery no matter where the baseline has drifted to.
   */
  earReopenFraction: 0.5,
  /**
   * The most the closed-eye threshold may be dropped below the baseline, as a fraction of it.
   *
   * The noise term below is what stops landmark jitter being read as blinking, but it is unbounded,
   * and on a jittery camera it can put the threshold under a genuinely closed eye — at which point
   * no blink is detectable at all. A closed eye measures around 0.05-0.12 EAR against an open 0.3,
   * so refusing to go below 55% of the baseline keeps the gate reachable while still demanding a
   * real closure.
   */
  earCloseMaxDrop: 0.45,
  /** Frames of EAR history before the learned baseline replaces the absolutes. */
  earBaselineFrames: 8,
  /** The baseline is clamped so a face held permanently half-shut cannot lower its own bar. */
  earBaselineMin: 0.17,
  earBaselineMax: 0.45,
  /** Multiples of the EAR noise floor (MAD) a closure must clear to count as a real blink. */
  earNoiseK: 3,
  blinkMinMs: 60,
  /**
   * The prompt for this step reads "Blink slowly" — and it says that for a reason: a natural blink
   * is 100-150 ms, which at a 15 fps webcam is one or two frames and is missed as often as it is
   * caught. So the instruction asks for a deliberate closure, and a deliberate closure is 400 ms to
   * a bit over a second. At 700 ms the detector was rejecting the exact thing it had just told the
   * person to do, banking it as a `badBlink` and leaving the step waiting forever.
   *
   * 1200 ms accepts the instructed blink and still refuses an occlusion: swapping a face for a
   * photo, or covering the lens, takes seconds, not one.
   */
  blinkMaxMs: 1200,
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
  earRangeFloor: 0.02,
  earRangeCeil: 0.14,
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

const WEIGHTS: Record<SignalId, number> = { depth: 0.26, motion: 0.22, blink: 0.18, consistency: 0.12, focus: 0.12, texture: 0.1 };

export const DEFAULT_MIN_SCORE = 0.45;

// 68-point landmark indices (dlib convention, as face-api emits them).
const RIGHT_EYE = [36, 37, 38, 39, 40, 41];
const LEFT_EYE = [42, 43, 44, 45, 46, 47];
const NOSE_TIP = 30;
/** Roughly coplanar with the face plane — the fit basis for the depth signal. */
const PLANAR = [0, 8, 16, 17, 26, 36, 39, 42, 45];
/** Independently mobile — brows and mouth, where a living face never holds perfectly still. */
const MOBILE = [17, 19, 21, 22, 24, 26, 48, 51, 54, 57, 62, 66];

// ─── Small helpers ───────────────────────────────────────────────────────────

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Map a raw measurement onto 0-1 between a floor and a ceiling. */
const band = (v: number, floor: number, ceil: number) => clamp01((v - floor) / (ceil - floor));
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function centroid(points: Point[]): Point {
  return { x: mean(points.map((p) => p.x)), y: mean(points.map((p) => p.y)) };
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = clamp01(q) * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** Eye aspect ratio over the six points around one eye. Low = closed. */
export function eyeAspectRatio(points: Point[], idx: number[]): number {
  const p = idx.map((i) => points[i]);
  if (p.some((q) => !q)) return 1;
  const horizontal = 2 * dist(p[0]!, p[3]!);
  return horizontal === 0 ? 1 : (dist(p[1]!, p[5]!) + dist(p[2]!, p[4]!)) / horizontal;
}

export const openness = (points: Point[]) => (eyeAspectRatio(points, RIGHT_EYE) + eyeAspectRatio(points, LEFT_EYE)) / 2;

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
  private blinkArmed = false;

  private reference: Point[] | null = null;
  private referenceScore = 0;
  private yawMin = Infinity;
  private yawMax = -Infinity;
  private depthPeak = 0;
  private depthMeasured = false;

  private residualFrames: Point[][] = [];
  private ears: number[] = [];
  private startedAt: number | null = null;

  private closedAt: number | null = null;
  /** The deepest EAR reached during the closure in progress — what recovery is measured from. */
  private closedMin = 1;
  /** The gates as they stood when the closure in progress began. See `trackBlink`. */
  private closedGates: { close: number; open: number; base: number } | null = null;
  private goodBlinks = 0;
  private badBlinks = 0;
  /** goodBlinks as of the start of the current step — a blink step needs one banked after this. */
  private blinksAtStep = 0;

  private focusScores: number[] = [];
  private glares: number[] = [];
  private chromas: number[] = [];

  private descriptors: Float32Array[] = [];
  private sawCrowd = false;
  private frames = 0;

  constructor(challenge: Challenge[], opts?: { minScore?: number }) {
    this.challenge = challenge.length ? challenge : ["blink"];
    this.minScore = opts?.minScore ?? DEFAULT_MIN_SCORE;
  }

  /** Every descriptor seen this session — the caller averages them into an enrolment template. */
  get samples(): Float32Array[] {
    return this.descriptors;
  }

  push(frame: Frame): FrameResult {
    this.frames++;
    if (this.startedAt === null) this.startedAt = frame.t;
    if (frame.faces > 1) this.sawCrowd = true;
    if (frame.descriptor) this.descriptors.push(frame.descriptor);

    const points = frame.points;
    const y = yaw(points);
    const ear = openness(points);
    this.ears.push(ear);
    this.yawMin = Math.min(this.yawMin, y);
    this.yawMax = Math.max(this.yawMax, y);

    this.trackReference(points, frame.score, y, frame.t);
    this.trackDepth(points, y);
    this.trackShape(points);
    this.trackBlink(ear, frame.t);
    if (frame.crop) this.trackPixels(frame.crop);

    const hint = this.hint(frame);
    this.advance(frame, ear, y);

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
   * Where the brows and mouth sit once the whole rigid pose is mapped away.
   *
   * The same affine map the depth signal uses is fitted on the coplanar points, then applied to the
   * reference brow and mouth positions. Whatever is left over is movement the pose cannot explain.
   * That distinction is the point: rotating a photograph moves every landmark by exactly this
   * affine, so its residual stays flat, while a face that is talking, breathing or reacting does not.
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

  /**
   * Blink thresholds fitted to the face in front of us.
   *
   * The baseline is the 75th percentile of recent EARs — high enough to sit in the open state even
   * if a quarter of the window is mid-blink, low enough not to chase one wide-eyed outlier. It is
   * windowed to the last 90 frames so a session that starts squinting and then relaxes re-learns
   * rather than averaging the two forever.
   *
   * Making the gate relative buys a second problem: on a low-EAR face the eye hexagon is only a few
   * pixels tall, so ordinary landmark wobble is large *as a fraction of the baseline* and a purely
   * proportional gate will bank phantom blinks out of noise. So the closure must clear BOTH the
   * proportional drop and this camera's own noise floor, measured as the median absolute deviation
   * of the same window. A steady camera keeps the proportional gate; a jittery one has to see a
   * closure that genuinely stands out from its wobble.
   */
  private earGates(): { close: number; open: number; base: number } {
    const w = this.ears.length > 90 ? this.ears.slice(-90) : this.ears;
    if (w.length < TUNING.earBaselineFrames) return { close: TUNING.earClose, open: TUNING.earOpen, base: TUNING.earOpen / TUNING.earOpenRatio };
    const sorted = [...w].sort((a, b) => a - b);
    const base = Math.min(Math.max(quantile(sorted, 0.75), TUNING.earBaselineMin), TUNING.earBaselineMax);
    const median = quantile(sorted, 0.5);
    const mad = quantile(
      w.map((e) => Math.abs(e - median)).sort((a, b) => a - b),
      0.5,
    );
    const drop = Math.min(Math.max(base * (1 - TUNING.earCloseRatio), TUNING.earNoiseK * mad), base * TUNING.earCloseMaxDrop);
    return { close: base - drop, open: base * TUNING.earOpenRatio, base };
  }

  /**
   * The open-closed-open transition, judged against the closure it actually saw.
   *
   * The closing half is a threshold: the eye has to get below `close`, which is where the noise
   * floor and the learned baseline do their work. The opening half deliberately is not. Recovery is
   * measured from the bottom of *this* closure back towards the baseline, and either that or the
   * baseline-relative `open` is enough — whichever the eye reaches first. Requiring the baseline
   * alone is what made a completely normal blink invisible on a face whose baseline had drifted
   * above where its eyes now rest.
   */
  private trackBlink(ear: number, t: number): void {
    const live = this.earGates();
    // The gates are frozen for the duration of a closure, and that is the whole reason an occlusion
    // is still refused. The baseline is a quantile of the recent window, so a closure that lasts
    // seconds ends up *in* that window and drags it down — a two-second hand over the lens pulled
    // the baseline from 0.30 to the 0.17 clamp, taking `open` down to 0.146, which is below what the
    // covered lens itself was reading. The occlusion then looked like an open eye: it broke into
    // fragments, and the last fragment was short enough to pass for a blink. A reference for "how
    // open is this eye normally" must not be learned from frames where the eye is shut, so once a
    // closure starts, the gates it started under are the gates it is judged by.
    const gates = this.closedGates ?? live;
    if (ear < gates.close) {
      if (this.closedAt === null) {
        this.closedAt = t;
        this.closedMin = ear;
        this.closedGates = live;
      } else if (ear < this.closedMin) {
        this.closedMin = ear;
      }
      return;
    }
    if (this.closedAt === null) return;
    const recovered = Math.min(gates.open, this.closedMin + (gates.base - this.closedMin) * TUNING.earReopenFraction);
    if (ear <= recovered) return;
    const ms = t - this.closedAt;
    this.closedAt = null;
    this.closedGates = null;
    if (ms >= TUNING.blinkMinMs && ms <= TUNING.blinkMaxMs) this.goodBlinks++;
    else this.badBlinks++;
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
  private advance(frame: Frame, ear: number, y: number): void {
    const step = this.challenge[this.index];
    if (!step) return;
    let satisfied = false;

    if (step === "blink") {
      // trackBlink has already validated the whole open→closed→open transition and its duration
      // this frame, so the step is satisfied the instant it banks one. Re-deriving the transition
      // here only added a frame of lag and a second chance to disagree with the signal.
      const { close, open } = this.earGates();
      if (ear < close) this.blinkArmed = true;
      satisfied = this.goodBlinks > this.blinksAtStep;
      this.stepProgress = satisfied ? 1 : this.blinkArmed ? 0.7 : clamp01(1 - ear / (open / TUNING.earOpenRatio));
    } else if (step === "turn_left" || step === "turn_right") {
      const wanted = step === "turn_left" ? y > TUNING.yaw : y < -TUNING.yaw;
      this.hold = wanted ? this.hold + 1 : 0;
      this.stepProgress = Math.min(this.hold / TUNING.yawHoldFrames, 1);
      satisfied = this.hold >= TUNING.yawHoldFrames;
    } else if (step === "smile") {
      const happy = frame.happy ?? 0;
      this.stepProgress = clamp01(happy / TUNING.smile);
      satisfied = happy > TUNING.smile;
    }

    if (!satisfied) return;
    this.blinkArmed = false;
    this.hold = 0;
    this.stepProgress = 0;
    this.index++;
    // Bank the count so a later blink step needs a NEW blink rather than inheriting this one.
    this.blinksAtStep = this.goodBlinks;
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
    const sortedEars = [...this.ears].sort((a, b) => a - b);
    const earRange = quantile(sortedEars, 0.9) - quantile(sortedEars, 0.1);
    return clamp01(
      0.6 * band(deviation, TUNING.motionFloor, TUNING.motionCeil) + 0.4 * band(earRange, TUNING.earRangeFloor, TUNING.earRangeCeil),
    );
  }

  private blinkSignal(): number | null {
    if (this.frames < 8) return null;
    if (this.goodBlinks > 0) return 1;
    // A closure of implausible length is worse than no closure at all: it is what an occlusion looks like.
    return this.badBlinks > 0 ? 0.15 : 0;
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
      blink: this.blinkSignal(),
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
