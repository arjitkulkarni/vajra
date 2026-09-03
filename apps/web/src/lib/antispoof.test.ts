import { describe, expect, it } from "vitest";
import { liveProbability, medianLiveProbability, SPOOF_SCALE } from "./antispoof-core";
import { spoofCropBox } from "./antispoof";

/**
 * MiniFASNet decides on framing as much as on the face inside it, so the crop is not an
 * implementation detail that can drift — it is part of the model's input contract. These cases are
 * not invented: each one is a real detection from the upstream repository's own sample images, run
 * through its own `CropImage._get_new_box` (`minivision-ai/Silent-Face-Anti-Spoofing`), with the
 * rectangle that came out recorded here. If this port ever stops agreeing with them, the browser is
 * feeding the network something it was not trained on and the probabilities stop meaning what the
 * thresholds assume they mean.
 *
 * All three frames are 480x640, which is the aspect the upstream pipeline requires and close enough
 * to a webcam's to be the regime the checkpoint was tuned in.
 */
const REFERENCE_CROPS: { image: string; box: { x: number; y: number; width: number; height: number }; crop: [number, number, number, number] }[] = [
  { image: "image_T1.jpg (live)", box: { x: 106, y: 147, width: 207, height: 213 }, crop: [0, 7, 479, 499] },
  { image: "image_F1.jpg (spoof)", box: { x: 178, y: 136, width: 223, height: 225 }, crop: [0, 6, 479, 490] },
  { image: "image_F2.jpg (spoof)", box: { x: 120, y: 252, width: 252, height: 256 }, crop: [0, 136, 479, 623] },
];

describe("spoofCropBox", () => {
  for (const { image, box, crop } of REFERENCE_CROPS) {
    it(`matches the upstream crop for ${image}`, () => {
      expect(spoofCropBox(480, 640, box)).toEqual(crop);
    });
  }

  it("grows the box by the scale factor when there is room for it", () => {
    // A small box in the middle of a large frame is the only case where nothing clamps, so it is
    // the only case where the requested scale survives intact. The rectangle is 201 px across
    // rather than 200: both corners are inclusive, an off-by-one that lives in the upstream code
    // and is reproduced here on purpose, because the crop it produced is the crop the network was
    // trained on.
    const rect = spoofCropBox(1000, 1000, { x: 450, y: 450, width: 100, height: 100 }, 2)!;
    expect(rect).toEqual([400, 400, 600, 600]);
    expect(rect[2] - rect[0] + 1).toBe(201);
  });

  it("slides a crop that runs off an edge back into frame rather than clipping it", () => {
    // The upstream implementation shifts instead of truncating, which is what keeps the face at a
    // consistent size in the patch even when it is up against the edge of the frame.
    const rect = spoofCropBox(1000, 1000, { x: 0, y: 0, width: 100, height: 100 }, 2)!;
    expect(rect).toEqual([0, 0, 200, 200]);
    expect(rect[2] - rect[0] + 1).toBe(201);
  });

  it("caps the scale so the enlarged box still fits inside the frame", () => {
    // 2.7x of a 300px box is 810px, which does not fit in 640. The cap is what makes the crop the
    // whole frame instead of an impossible rectangle — and it is why a face filling the frame and a
    // face at arm's length can produce very similar patches.
    const rect = spoofCropBox(480, 640, { x: 90, y: 170, width: 300, height: 300 }, SPOOF_SCALE)!;
    expect(rect[0]).toBe(0);
    expect(rect[2]).toBe(479);
    expect(rect[2] - rect[0] + 1).toBeLessThanOrEqual(480);
    expect(rect[3] - rect[1] + 1).toBeLessThanOrEqual(640);
  });

  it("refuses a degenerate frame or box rather than returning a rectangle", () => {
    expect(spoofCropBox(0, 0, { x: 0, y: 0, width: 10, height: 10 })).toBeNull();
    expect(spoofCropBox(640, 480, { x: 10, y: 10, width: 0, height: 10 })).toBeNull();
  });
});

describe("liveProbability", () => {
  /**
   * Real logits, straight off the ONNX graph this app ships, for the three sample images above.
   * They pin down both halves of the reading: that class 1 is the live one, and that the model is
   * emphatic — a genuine face is not a 60/40 call, and neither is a printed one.
   */
  const CASES: [string, number[], number][] = [
    ["a live face", [-4.3636, 4.4966, -0.1358], 0.9902],
    ["a printed face", [0.5834, -3.5567, 2.975], 0.0013],
    ["a replayed face", [-3.3677, -1.9929, 5.3621], 0.0006],
  ];

  for (const [what, logits, expected] of CASES) {
    it(`scores ${what}`, () => {
      expect(liveProbability(Float32Array.from(logits))).toBeCloseTo(expected, 4);
    });
  }

  it("reads the row at an offset, so a batch can be scored in one pass", () => {
    const batch = Float32Array.from([...CASES[0]![1], ...CASES[1]![1]]);
    expect(liveProbability(batch, 0)).toBeCloseTo(0.9902, 4);
    expect(liveProbability(batch, 3)).toBeCloseTo(0.0013, 4);
  });
});

describe("medianLiveProbability", () => {
  it("has nothing to say about a session that scored nothing", () => {
    expect(medianLiveProbability([])).toBeNull();
  });

  it("averages the middle pair when the count is even", () => {
    expect(medianLiveProbability([0.1, 0.2, 0.3, 0.4])).toBeCloseTo(0.25, 6);
  });

  /**
   * The reason this is a median and not a mean. A capture is a moving head, and a frame caught
   * mid-turn or motion-blurred is one the model is entitled to be unsure about. Two such frames in
   * seven pull the mean down by nearly thirty points — enough to fail a deployment that raised its
   * floor — while leaving the median where the session actually sat.
   */
  it("is not moved by a minority of unsure frames", () => {
    const capture = [0.99, 0.98, 0.02, 0.97, 0.01, 0.96, 0.99];
    const mean = capture.reduce((a, b) => a + b, 0) / capture.length;
    expect(mean).toBeLessThan(0.75);
    expect(medianLiveProbability(capture)).toBeCloseTo(0.97, 6);
  });

  it("does say so when most of the session looks like an attack", () => {
    expect(medianLiveProbability([0.01, 0.02, 0.99, 0.03, 0.01])).toBeCloseTo(0.02, 6);
  });

  it("leaves the caller's array alone", () => {
    const samples = [0.9, 0.1, 0.5];
    medianLiveProbability(samples);
    expect(samples).toEqual([0.9, 0.1, 0.5]);
  });
});
