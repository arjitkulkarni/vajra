import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/adaface-embeddings.json";
import { averageEmbedding, l2normalise } from "./adaface-core";
import {
  ADAFACE_SIMILARITY_THRESHOLD,
  confidenceFromDistance,
  confidenceFromSimilarity,
  cosineSimilarity,
  FACE_MATCH_THRESHOLD,
  modelOf,
  scoreMatch,
} from "./did";

/**
 * These are real AdaFace IR-50 (MS1MV2) embeddings, not synthetic vectors.
 *
 * They were produced by running the same alignment and preprocessing `lib/adaface.ts` runs in the
 * browser — the ArcFace five-point warp to 112x112, BGR, [-1, 1] — over LFW photographs: an
 * enrolment template averaged over five crops of one person, a second photograph of that same
 * person, and a photograph of someone else. Synthetic vectors would test the arithmetic; these test
 * whether the arithmetic is set to the right numbers.
 */
const decode = (b64: string): Float32Array => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
};

const enrolment = decode(fixture.enrolment);
const genuine = decode(fixture.genuine);
const impostor = decode(fixture.impostor);

describe("AdaFace embeddings", () => {
  it("are 512-d unit vectors", () => {
    for (const v of [enrolment, genuine, impostor]) {
      expect(v).toHaveLength(512);
      const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
      expect(norm).toBeCloseTo(1, 4);
    }
  });

  it("are recognised as AdaFace by dimension alone", () => {
    expect(modelOf(enrolment)).toBe("adaface");
    expect(modelOf(new Float32Array(128))).toBe("faceapi");
  });

  it("reproduce the similarities they were generated with", () => {
    expect(cosineSimilarity(enrolment, genuine)).toBeCloseTo(fixture.expected.genuineSimilarity, 4);
    expect(cosineSimilarity(enrolment, impostor)).toBeCloseTo(fixture.expected.impostorSimilarity, 4);
  });
});

describe("scoreMatch", () => {
  it("clears the floor for the same person and does not for a different one", () => {
    const same = scoreMatch(enrolment, genuine)!;
    const other = scoreMatch(enrolment, impostor)!;

    expect(same.model).toBe("adaface");
    expect(same.ok).toBe(true);
    expect(same.similarity!).toBeGreaterThan(ADAFACE_SIMILARITY_THRESHOLD);
    // 45 is the gateway's FACE_MATCH_MIN_SCORE default.
    expect(same.score).toBeGreaterThanOrEqual(45);

    expect(other.ok).toBe(false);
    expect(other.similarity!).toBeLessThan(ADAFACE_SIMILARITY_THRESHOLD);
    expect(other.score).toBeLessThan(45);

    // The whole point of the swap: a wide, unambiguous margin between the two.
    expect(same.score - other.score).toBeGreaterThan(50);
  });

  it("reports distance as 1 − cosine, so an auditor can recompute it", () => {
    const scored = scoreMatch(enrolment, genuine)!;
    expect(scored.distance).toBeCloseTo(1 - scored.similarity!, 10);
  });

  it("refuses to compare across embedding spaces rather than scoring them low", () => {
    // A 128-d face-api template against a 512-d AdaFace probe is not a weak match, it is not a
    // comparison at all. Returning a low score here would read as an impostor and lock someone out.
    expect(scoreMatch(new Float32Array(128).fill(0.1), genuine)).toBeNull();
    expect(scoreMatch(enrolment, new Float32Array(128).fill(0.1))).toBeNull();
  });

  it("still scores the face-api space in its own units", () => {
    const a = l2normalise(new Float32Array(128).fill(1));
    const scored = scoreMatch(a, a)!;
    expect(scored.model).toBe("faceapi");
    expect(scored.similarity).toBeNull();
    expect(scored.distance).toBeCloseTo(0, 6);
    expect(scored.ok).toBe(true);
  });
});

describe("the confidence curve", () => {
  it("puts both models' operating points on exactly 45", () => {
    // This is the contract with the gateway: FACE_MATCH_MIN_SCORE = 45 must mean the same decision
    // whichever net produced the numbers, so an operator raising the floor gets a stricter check
    // rather than an accidentally different one.
    expect(confidenceFromSimilarity(ADAFACE_SIMILARITY_THRESHOLD)).toBe(45);
    expect(confidenceFromDistance(FACE_MATCH_THRESHOLD)).toBe(45);
  });

  it("is monotonic and spans the full range", () => {
    expect(confidenceFromSimilarity(0)).toBe(0);
    expect(confidenceFromSimilarity(1)).toBe(100);
    let previous = -1;
    for (let s = 0; s <= 1.0001; s += 0.01) {
      const score = confidenceFromSimilarity(s);
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
  });

  it("is continuous across the hinge", () => {
    const t = ADAFACE_SIMILARITY_THRESHOLD;
    expect(confidenceFromSimilarity(t - 0.001)).toBeCloseTo(45, 0);
    expect(confidenceFromSimilarity(t + 0.001)).toBeCloseTo(45, 0);
  });

  it("clamps rather than going negative on an opposed embedding", () => {
    expect(confidenceFromSimilarity(-0.4)).toBe(0);
    expect(confidenceFromSimilarity(2)).toBe(100);
  });
});

describe("averageEmbedding", () => {
  it("returns a unit vector, so cosine against it still means what it says", () => {
    const averaged = averageEmbedding([enrolment, genuine])!;
    const norm = Math.sqrt(averaged.reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("sits between the samples it averages", () => {
    const averaged = averageEmbedding([enrolment, genuine])!;
    for (const sample of [enrolment, genuine]) {
      expect(cosineSimilarity(averaged, sample)).toBeGreaterThan(cosineSimilarity(enrolment, genuine));
    }
  });

  it("has nothing to average when given nothing", () => {
    expect(averageEmbedding([])).toBeNull();
  });
});
