import { describe, expect, it } from "vitest";
import { DEFAULT_MIN_SCORE, fitAffine, LivenessSession, planarityResidual, TUNING, yaw, type Frame, type FrameResult, type Point } from "./liveness";

/**
 * A synthetic 68-point face, so the geometry can be checked without a camera.
 *
 * Points are laid out in a canonical frame with an interocular distance of 100 px, each carrying a
 * depth `z`. Rotating about the vertical axis and projecting is what separates the two cases the
 * depth signal exists to tell apart: a flat photo has z = 0 everywhere, a real head does not.
 *
 * `ear` sets how far the eyelid points sit from the eye corners. Nothing measures it as an aspect
 * ratio any more — it is here because closing the lids is a deformation the micro-motion signal is
 * supposed to see.
 */
function face(opts: { yaw?: number; noseZ?: number; ear?: number; jitter?: number; seed?: number } = {}): Point[] {
  const { yaw: theta = 0, noseZ = 0, ear = 0.3, jitter = 0, seed = 1 } = opts;
  const points: [number, number, number][] = Array.from({ length: 68 }, () => [0, 20, 0]);
  const h = ear * 15;
  const eye = (cx: number): [number, number, number][] => [
    [cx - 15, 0, 0],
    [cx - 7, -h, 0],
    [cx + 7, -h, 0],
    [cx + 15, 0, 0],
    [cx + 7, h, 0],
    [cx - 7, h, 0],
  ];
  eye(-50).forEach((p, i) => (points[36 + i] = p));
  eye(50).forEach((p, i) => (points[42 + i] = p));
  points[0] = [-90, 60, 0];
  points[8] = [0, 120, 0];
  points[16] = [90, 60, 0];
  points[17] = [-80, -40, 0];
  points[19] = [-60, -45, 0];
  points[21] = [-30, -42, 0];
  points[22] = [30, -42, 0];
  points[24] = [60, -45, 0];
  points[26] = [80, -40, 0];
  points[30] = [0, 40, noseZ]; // the nose tip is the only point allowed out of the plane
  points[48] = [-35, 75, 0];
  points[51] = [0, 68, 0];
  points[54] = [35, 75, 0];
  points[57] = [0, 90, 0];
  points[62] = [0, 72, 0];
  points[66] = [0, 80, 0];

  // Deterministic pseudo-noise, so a "live" face wobbles the way a real one does and a photo does not.
  let s = seed;
  const noise = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return ((s / 2147483648) * 2 - 1) * jitter;
  };
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return points.map(([x, y, z]) => ({ x: 320 + (x * cos + z * sin) + noise(), y: 240 + y + noise() }));
}

const frame = (points: Point[], t: number, extra?: Partial<Frame>): Frame => ({
  t,
  points,
  score: 0.9,
  faces: 1,
  box: { x: 220, y: 120, width: 200, height: 240 },
  frameWidth: 640,
  frameHeight: 480,
  crop: null,
  descriptor: null,
  ...extra,
});

describe("geometry", () => {
  it("recovers a known affine map", () => {
    const src: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: 7, y: 3 },
    ];
    const dst = src.map((p) => ({ x: 2 * p.x + 0.5 * p.y + 3, y: -0.25 * p.x + 1.5 * p.y - 4 }));
    const A = fitAffine(src, dst)!;
    expect(A[0]).toBeCloseTo(2, 6);
    expect(A[1]).toBeCloseTo(0.5, 6);
    expect(A[2]).toBeCloseTo(3, 6);
    expect(A[3]).toBeCloseTo(-0.25, 6);
    expect(A[4]).toBeCloseTo(1.5, 6);
    expect(A[5]).toBeCloseTo(-4, 6);
  });

  it("reads a head turned to its own left as positive yaw", () => {
    expect(yaw(face())).toBeCloseTo(0, 6);
    expect(yaw(face({ yaw: 0.4, noseZ: 35 }))).toBeGreaterThan(TUNING.yaw);
    expect(yaw(face({ yaw: -0.4, noseZ: 35 }))).toBeLessThan(-TUNING.yaw);
    // A flat image rotated the same amount produces no yaw at all: the nose has nowhere to go.
    expect(yaw(face({ yaw: 0.4, noseZ: 0 }))).toBeCloseTo(0, 6);
  });
});

describe("depth signal", () => {
  const reference = face();

  it("finds no depth in a rotated flat photo", () => {
    // Every point is coplanar, so an affine map explains the whole rotation exactly.
    for (const angle of [0.2, 0.35, -0.3]) {
      expect(planarityResidual(reference, face({ yaw: angle, noseZ: 0 }))!).toBeLessThan(1e-6);
    }
  });

  it("finds depth in a rotated head", () => {
    const residual = planarityResidual(reference, face({ yaw: 0.35, noseZ: 35 }))!;
    // A nose 35 px proud of a 100 px interocular span, turned 20°: well past the 0.09 ceiling.
    expect(residual).toBeGreaterThan(0.09);
  });
});

describe("LivenessSession", () => {
  /**
   * A head that turns when asked, smiles when asked, blinks along the way and never holds perfectly
   * still. Nothing detects the blink any more — it arrives as eyelid deformation the rigid pose
   * cannot account for, which is all the micro-motion signal ever needed from it.
   */
  function livePass(): { session: LivenessSession; last: FrameResult } {
    const session = new LivenessSession(["turn_left", "smile"]);
    const descriptor = new Float32Array(128).fill(0.1);
    let last!: FrameResult;
    let step = 0;
    let promptedAt = 0;
    let t = 0;
    for (let i = 0; i < 80; i++) {
      t += 33;
      // Ten frames of settling so the frontal reference is banked, then the turn; the smile only
      // once the turn is accepted, and only after the pause a person takes to read the next prompt.
      const turning = step === 0 && i > 10;
      const smiling = step === 1 && i > promptedAt + 10;
      const blinking = i % 14 === 6 || i % 14 === 7;
      last = session.push(
        frame(face({ yaw: turning ? 0.4 : 0, noseZ: 35, ear: blinking ? 0.08 : 0.3, jitter: 2, seed: i + 1 }), t, {
          happy: smiling ? 0.9 : 0.05,
          descriptor: i % 12 === 0 ? descriptor : null,
        }),
      );
      if (last.stepIndex !== step) {
        step = last.stepIndex;
        promptedAt = i;
      }
      if (last.complete) break;
    }
    return { session, last };
  }

  /** The turn challenge attempted with a photograph — printed, or held up on a phone. */
  function photoPass(): { session: LivenessSession; last: FrameResult } {
    const session = new LivenessSession(["turn_left"]);
    const descriptor = new Float32Array(128).fill(0.1);
    let last!: FrameResult;
    let t = 0;
    for (let i = 0; i < 60; i++) {
      t += 33;
      last = session.push(
        frame(face({ yaw: i > 30 ? 0.4 : 0, noseZ: 0, ear: 0.3, jitter: 0.05, seed: i + 1 }), t, {
          descriptor: i % 12 === 0 ? descriptor : null,
        }),
      );
    }
    return { session, last };
  }

  it("passes a live face", () => {
    const { session, last } = livePass();
    const verdict = session.verdict();
    expect(last.complete).toBe(true);
    expect(verdict.signals.depth).toBe(1);
    expect(verdict.signals.response).toBe(1);
    expect(verdict.signals.motion).toBeGreaterThan(0);
    expect(verdict.passed).toBe(true);
  });

  /**
   * The eyelids are in the mobile set, so a blink is still worth something — as deformation, with no
   * threshold, no learned baseline and no duration window to miss it by a frame. That is what let
   * the open-closed-open detector be deleted rather than replaced.
   */
  it("reads a blink as micro-motion the rigid pose cannot explain", () => {
    const measure = (blinks: boolean) => {
      const session = new LivenessSession(["smile"]);
      for (let i = 0; i < 40; i++) {
        const closed = blinks && (i % 14 === 6 || i % 14 === 7);
        // A steady hand and a steady detector, so the lids are almost the only thing moving.
        session.push(frame(face({ ear: closed ? 0.08 : 0.3, jitter: 0.6, seed: i + 1 }), i * 33));
      }
      return session.verdict().signals.motion!;
    };
    expect(measure(true)).toBeGreaterThan(measure(false));
  });

  /**
   * A step banked on the first frame it was shown was being held before it was asked for — which is
   * what a recording of someone running through the poses looks like. It is scored down, not out: a
   * person can also happen to already be smiling.
   */
  it("marks down a step that was answered before it was asked", () => {
    const session = new LivenessSession(["turn_left"]);
    let last!: FrameResult;
    for (let i = 0; i < 20; i++) {
      last = session.push(frame(face({ yaw: 0.4, noseZ: 35, jitter: 1, seed: i + 1 }), i * 33));
      if (last.complete) break;
    }
    expect(last.complete).toBe(true);
    expect(session.verdict().signals.response).toBeCloseTo(TUNING.responseFastScore, 6);
  });

  /** Progress has to move while the head is on its way, not only once the threshold is crossed. */
  it("reports partial progress on a head part way through its turn", () => {
    const session = new LivenessSession(["turn_left"]);
    const points = face({ yaw: 0.25, noseZ: 35 });
    expect(yaw(points)).toBeLessThan(TUNING.yaw);
    const half = session.push(frame(points, 33));
    expect(half.stepProgress).toBeGreaterThan(0.4);
    expect(half.stepProgress).toBeLessThan(1);
  });

  it("fails a flat photo attempting the same challenge", () => {
    const { session, last } = photoPass();
    // Rotating a flat image carries the nose exactly as far as it carries the eyes, so the turn
    // step is never satisfied however far the photo is tilted — the challenge never completes and
    // nothing is signed.
    expect(last.complete).toBe(false);
    expect(last.stepIndex).toBe(0);
    const verdict = session.verdict();
    // With no yaw there is no parallax to measure, and with no step banked there is no reaction to
    // time, so both report honestly rather than claiming a pass. What is measurable — no
    // micro-motion at all, from brows, lids or mouth — sinks the score anyway.
    expect(verdict.signals.depth).toBeNull();
    expect(verdict.signals.response).toBeNull();
    expect(verdict.signals.motion).toBeLessThan(0.1);
    expect(verdict.score).toBeLessThan(DEFAULT_MIN_SCORE);
    expect(verdict.passed).toBe(false);
  });

  it("reports a signal it could not measure as null rather than zero", () => {
    // No turn was asked for and none happened, so depth is unmeasurable — and must not be scored as
    // a failure. What was asked for was answered, and that carries the verdict.
    const session = new LivenessSession(["smile"]);
    const descriptor = new Float32Array(128).fill(0.1);
    let last!: FrameResult;
    for (let i = 0; i < 40; i++) {
      const blinking = i % 14 === 6 || i % 14 === 7;
      last = session.push(
        frame(face({ noseZ: 35, ear: blinking ? 0.08 : 0.3, jitter: 2, seed: i + 1 }), i * 33, {
          happy: i > 10 ? 0.9 : 0.05,
          descriptor: i % 12 === 0 ? descriptor : null,
        }),
      );
      if (last.complete) break;
    }
    const verdict = session.verdict();
    expect(last.complete).toBe(true);
    expect(verdict.signals.depth).toBeNull();
    expect(verdict.signals.response).toBe(1);
    expect(verdict.passed).toBe(true);
  });

  it("fails when a second face appears mid-challenge", () => {
    const session = new LivenessSession(["turn_left", "smile"]);
    for (let i = 0; i < 40; i++) {
      session.push(frame(face({ yaw: i > 20 ? 0.4 : 0, noseZ: 35, jitter: 2, seed: i + 1 }), i * 33, { faces: i === 25 ? 2 : 1 }));
    }
    expect(session.verdict().signals.consistency).toBe(0);
  });

  it("drives the challenge steps in order", () => {
    const session = new LivenessSession(["turn_left", "smile"]);
    let last = session.push(frame(face(), 0));
    expect(last.stepIndex).toBe(0);
    for (let i = 1; i < 80; i++) {
      const turning = last.stepIndex === 0 && i > 2;
      last = session.push(
        frame(face({ yaw: turning ? 0.4 : 0, noseZ: 35, jitter: 1, seed: i }), i * 33, { happy: last.stepIndex >= 1 ? 0.9 : 0.05 }),
      );
      if (last.complete) break;
    }
    expect(last.complete).toBe(true);
  });
});
