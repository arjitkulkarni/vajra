import { describe, expect, it } from "vitest";
import { LivenessSession, openness, type Frame, type Point } from "./liveness";

/** Minimal 68-point face with a controllable eye-aspect-ratio, copied from liveness.test.ts. */
function face(ear: number, seed: number): Point[] {
  const points: [number, number][] = Array.from({ length: 68 }, () => [0, 20]);
  const h = ear * 15;
  const eye = (cx: number): [number, number][] => [
    [cx - 15, 0],
    [cx - 7, -h],
    [cx + 7, -h],
    [cx + 15, 0],
    [cx + 7, h],
    [cx - 7, h],
  ];
  eye(-50).forEach((p, i) => (points[36 + i] = p));
  eye(50).forEach((p, i) => (points[42 + i] = p));
  points[30] = [0, 30];
  points[0] = [-90, 60];
  points[8] = [0, 110];
  points[16] = [90, 60];
  points[17] = [-70, -30];
  points[26] = [70, -30];
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 2;
  return points.map(([x, y]) => ({ x: x + rand() * 1.5 + 320, y: y + rand() * 1.5 + 240 }));
}

const frame = (points: Point[], t: number): Frame => ({
  t,
  points,
  score: 0.9,
  faces: 1,
  box: { x: 220, y: 140, width: 200, height: 200 },
  frameWidth: 640,
  frameHeight: 480,
});

describe("blink, as a real face actually behaves", () => {
  /**
   * Someone opens their eyes wide while the camera warms up and the prompt appears, then settles to
   * their normal openness before blinking. Every EAR here is plausible; nothing is a spoof.
   */
  it("banks a blink after the eyes relax from a wide-open start", () => {
    const session = new LivenessSession(["blink"]);
    let t = 0;
    const step = 66;
    const push = (ear: number, i: number) => session.push(frame(face(ear, i + 1), (t += step)));

    let i = 0;
    for (; i < 30; i++) push(0.36, i); // wide open, reading the prompt
    for (; i < 45; i++) push(0.26, i); // settled to normal
    for (; i < 50; i++) push(0.09, i); // a deliberate blink, ~330 ms
    let last = push(0.26, i++);
    for (; i < 70; i++) last = push(0.26, i); // eyes open again, at their normal openness

    expect(openness(face(0.26, 1))).toBeGreaterThan(0.2);
    expect(session.verdict().signals.blink).toBe(1);
    expect(last.stepIndex).toBe(1);
  });

  /** A camera with jittery landmarks must not push the closed-eye threshold out of reach. */
  it("banks a blink through landmark noise", () => {
    const session = new LivenessSession(["blink"]);
    let t = 0;
    const step = 66;
    // Alternating openness is what a noisy detector produces on a still face.
    let i = 0;
    let last;
    for (; i < 40; i++) last = session.push(frame(face(i % 2 ? 0.34 : 0.24, i + 1), (t += step)));
    for (; i < 46; i++) last = session.push(frame(face(0.1, i + 1), (t += step)));
    for (; i < 60; i++) last = session.push(frame(face(i % 2 ? 0.34 : 0.24, i + 1), (t += step)));

    expect(session.verdict().signals.blink).toBe(1);
    expect(last!.stepIndex).toBe(1);
  });
});
