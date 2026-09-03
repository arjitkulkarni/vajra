import { describe, expect, it } from "vitest";
import { fitAffine, LivenessSession, planarityResidual, openness, TUNING, yaw, type Frame, type FrameResult, type Point } from "./liveness";

/**
 * A synthetic 68-point face, so the geometry can be checked without a camera.
 *
 * Points are laid out in a canonical frame with an interocular distance of 100 px, each carrying a
 * depth `z`. Rotating about the vertical axis and projecting is what separates the two cases the
 * depth signal exists to tell apart: a flat photo has z = 0 everywhere, a real head does not.
 */
function face(opts: { yaw?: number; noseZ?: number; ear?: number; jitter?: number; seed?: number } = {}): Point[] {
  const { yaw: theta = 0, noseZ = 0, ear = 0.3, jitter = 0, seed = 1 } = opts;
  const points: [number, number, number][] = Array.from({ length: 68 }, () => [0, 20, 0]);
  const h = ear * 15; // EAR = h/15 for the hexagon below
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

  it("reads a closed eye as low openness", () => {
    expect(openness(face({ ear: 0.3 }))).toBeCloseTo(0.3, 6);
    expect(openness(face({ ear: 0.08 }))).toBeLessThan(0.2);
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
  /** A head that turns, blinks and never holds perfectly still. */
  function livePass(): LivenessSession {
    const session = new LivenessSession(["blink", "turn_left"]);
    const descriptor = new Float32Array(128).fill(0.1);
    let t = 0;
    for (let i = 0; i < 60; i++) {
      t += 33;
      const blinking = i % 14 === 6 || i % 14 === 7;
      const turning = i > 30;
      session.push(
        frame(face({ yaw: turning ? 0.4 : 0, noseZ: 35, ear: blinking ? 0.08 : 0.3, jitter: 2, seed: i + 1 }), t, {
          descriptor: i % 12 === 0 ? descriptor : null,
        }),
      );
    }
    return session;
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
    const verdict = livePass().verdict();
    expect(verdict.signals.depth).toBe(1);
    expect(verdict.signals.blink).toBe(1);
    expect(verdict.signals.motion).toBeGreaterThan(0);
    expect(verdict.passed).toBe(true);
  });

  /**
   * Regression: narrow eyes. This face's *open* EAR is 0.23 — below the absolute `earOpen` of
   * 0.26 the session used to reopen on — so every closure was recorded and none was ever released:
   * `closedAt` never cleared, no blink was ever banked, and the blink step waited forever while the
   * operator sat there blinking at it. Thresholds now scale to the face, so this passes.
   */
  it("banks a blink from a face whose open eye never crosses the old absolute threshold", () => {
    const session = new LivenessSession(["blink"]);
    let last!: FrameResult;
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t += 33;
      const blinking = i >= 20 && i <= 21;
      last = session.push(frame(face({ ear: blinking ? 0.12 : 0.23, jitter: 2, seed: i + 1 }), t));
    }
    expect(0.23).toBeLessThan(TUNING.earOpen); // the precondition that used to break it
    expect(last.complete).toBe(true);
    expect(last.stepIndex).toBe(1);
    expect(session.verdict().signals.blink).toBe(1);
  });

  /**
   * Regression: the step says "Blink slowly", so a slow blink has to count. A deliberate ~800 ms
   * closure used to land outside the 700 ms window and be banked as a `badBlink`, which left the
   * step waiting on the one behaviour it had asked for.
   */
  it("accepts the deliberate slow blink the prompt asks for", () => {
    const session = new LivenessSession(["blink"]);
    let last!: FrameResult;
    let t = 0;
    for (let i = 0; i < 45; i++) {
      t += 33;
      const blinking = i >= 20 && i <= 43; // ~800 ms of closure
      last = session.push(frame(face({ ear: blinking ? 0.1 : 0.3, jitter: 1, seed: i + 1 }), t));
      if (last.complete) break;
    }
    expect(last.complete).toBe(true);
    expect(session.verdict().signals.blink).toBe(1);
  });

  /** But a closure long enough to be an occlusion is still refused, not merely un-banked. */
  it("refuses a closure long enough to be an occlusion", () => {
    const session = new LivenessSession(["blink"]);
    let last!: FrameResult;
    let t = 0;
    for (let i = 0; i < 90; i++) {
      t += 33;
      const covered = i >= 15 && i <= 75; // ~2 s — a hand, or a swapped photo
      last = session.push(frame(face({ ear: covered ? 0.1 : 0.3, jitter: 1, seed: i + 1 }), t));
    }
    expect(last.complete).toBe(false);
    expect(session.verdict().signals.blink).toBeLessThan(0.5);
  });

  /** A face held rigidly open still banks nothing — the adaptive baseline must not invent a blink. */
  it("does not invent a blink for a face that never closes its eyes", () => {
    const session = new LivenessSession(["blink"]);
    let last!: FrameResult;
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t += 33;
      last = session.push(frame(face({ ear: 0.23, jitter: 2, seed: i + 1 }), t));
    }
    expect(last.complete).toBe(false);
    expect(last.stepIndex).toBe(0);
    expect(session.verdict().signals.blink).toBe(0);
  });

  it("fails a flat photo attempting the same challenge", () => {
    const { session, last } = photoPass();
    // Rotating a flat image carries the nose exactly as far as it carries the eyes, so the turn
    // step is never satisfied however far the photo is tilted — the challenge never completes and
    // nothing is signed.
    expect(last.complete).toBe(false);
    expect(last.stepIndex).toBe(0);
    const verdict = session.verdict();
    // With no yaw there is also no parallax to measure, so depth reports honestly rather than
    // claiming a pass. What is measurable — no blink, no micro-motion — sinks the score anyway.
    expect(verdict.signals.depth).toBeNull();
    expect(verdict.signals.blink).toBe(0);
    expect(verdict.signals.motion).toBeLessThan(0.1);
    expect(verdict.score).toBeLessThan(0.3);
    expect(verdict.passed).toBe(false);
  });

  it("reports a signal it could not measure as null rather than zero", () => {
    // No turn was asked for and none happened, so depth is unmeasurable — and must not be scored as
    // a failure. Blink alone still carries the verdict.
    const session = new LivenessSession(["blink"]);
    const descriptor = new Float32Array(128).fill(0.1);
    for (let i = 0; i < 40; i++) {
      const blinking = i % 14 === 6 || i % 14 === 7;
      session.push(
        frame(face({ noseZ: 35, ear: blinking ? 0.08 : 0.3, jitter: 2, seed: i + 1 }), i * 33, { descriptor: i % 12 === 0 ? descriptor : null }),
      );
    }
    const verdict = session.verdict();
    expect(verdict.signals.depth).toBeNull();
    expect(verdict.signals.blink).toBe(1);
    expect(verdict.passed).toBe(true);
  });

  it("fails when a second face appears mid-challenge", () => {
    const session = new LivenessSession(["blink", "turn_left"]);
    for (let i = 0; i < 40; i++) {
      const blinking = i % 14 === 6 || i % 14 === 7;
      session.push(frame(face({ yaw: i > 20 ? 0.4 : 0, noseZ: 35, ear: blinking ? 0.08 : 0.3, jitter: 2, seed: i + 1 }), i * 33, { faces: i === 25 ? 2 : 1 }));
    }
    expect(session.verdict().signals.consistency).toBe(0);
  });

  it("drives the challenge steps in order", () => {
    const session = new LivenessSession(["blink", "turn_left"]);
    let last = session.push(frame(face(), 0));
    expect(last.stepIndex).toBe(0);
    for (let i = 1; i < 60; i++) {
      const blinking = i > 2 && i < 6;
      const turning = last.stepIndex > 0;
      last = session.push(frame(face({ yaw: turning ? 0.4 : 0, noseZ: 35, ear: blinking ? 0.08 : 0.3, jitter: 1, seed: i }), i * 33));
      if (last.complete) break;
    }
    expect(last.complete).toBe(true);
  });
});
