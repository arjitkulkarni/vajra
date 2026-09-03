/**
 * The parts of the anti-spoofing runtime that both sides of the worker boundary need.
 *
 * `lib/antispoof` spawns the worker, so the worker cannot import it back without the bundler pulling
 * a second copy of the worker into the worker. The shapes, the class semantics and the forward pass
 * live here instead; none of them touch the DOM or the Worker API.
 */
import type * as Ort from "onnxruntime-web";

/** The side of the patch MiniFASNet was trained on. */
export const SPOOF_SIZE = 80;

/**
 * How much context around the face box the model expects, and it is not a tunable.
 *
 * The upstream checkpoints encode it in their own file names — `2.7_80x80_MiniFASNetV2` — because
 * each was trained on patches cropped at exactly that scale. The tell-tales it learned are mostly
 * *around* the face: the bezel of a phone, the edge of a print, the reflection on a screen. Crop
 * tighter and those disappear from the input; crop wider and they land somewhere the model was
 * never trained to look.
 */
export const SPOOF_SCALE = 2.7;

/**
 * A 1x3x80x80 NCHW tensor, BGR, in [0, 255].
 *
 * Not [0, 1]. Every ArcFace-lineage model in this codebase — AdaFace included — scales to [-1, 1)
 * or [0, 1], and every published description of this one says `pixel / 255` too. The upstream
 * repository vendored torchvision's `to_tensor` and commented the `.div(255)` out of it
 * (`src/data_io/functional.py`), so the weights were trained on raw 0-255 values and the published
 * description is wrong. Fed [0, 1] the network does not fail loudly: it saturates, returns roughly
 * the same near-certain "spoof" for every input including a genuine face, and an integration that
 * trusted the documentation would ban everyone. See `public/models/README.md`.
 */
export type SpoofPatch = Float32Array;

/**
 * MiniFASNet's three classes, in the order the checkpoint was trained with.
 *
 * Index 1 is the live face; 0 and 2 are two families of presentation attack the training set
 * separated (print and replay). Only the live probability is used, so the split between the two
 * attack classes never has to be interpreted.
 */
export const LIVE_CLASS = 1;
export const SPOOF_CLASSES = 3;

/**
 * Point onnxruntime at the wasm artefacts this origin serves and give it a sensible thread count.
 * Shared by the worker and the inline fallback, which have the same two things to decide.
 */
export function configureSpoofOrt(ort: typeof Ort, wasmPath: string): void {
  ort.env.wasm.wasmPaths = wasmPath;
  // One thread unless the page is cross-origin isolated. Same reasoning as lib/adaface-core: threads
  // need a SharedArrayBuffer, VAJRA does not set COOP/COEP, and asking for threads the browser will
  // not grant makes onnxruntime attempt a build it cannot instantiate. This graph is 1.7 MB and one
  // forward pass is a couple of milliseconds, so there is nothing to win here anyway.
  const isolated = typeof globalThis !== "undefined" && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
  ort.env.wasm.numThreads = isolated ? Math.max(1, Math.min(2, typeof navigator === "undefined" ? 1 : navigator.hardwareConcurrency || 1)) : 1;
}

/** Softmax over one row of logits, returning the live-class probability. */
export function liveProbability(logits: Float32Array, offset = 0): number {
  let max = -Infinity;
  for (let i = 0; i < SPOOF_CLASSES; i++) max = Math.max(max, logits[offset + i]!);
  let sum = 0;
  for (let i = 0; i < SPOOF_CLASSES; i++) sum += Math.exp(logits[offset + i]! - max);
  return sum > 0 ? Math.exp(logits[offset + LIVE_CLASS]! - max) / sum : 0;
}

/** One batched forward pass, as a live probability per patch. */
export async function runSpoofSession(ort: typeof Ort, session: Ort.InferenceSession, patches: SpoofPatch[]): Promise<number[]> {
  if (!patches.length) return [];
  const plane = 3 * SPOOF_SIZE * SPOOF_SIZE;
  const batch = new Float32Array(patches.length * plane);
  patches.forEach((patch, i) => batch.set(patch, i * plane));
  const tensor = new ort.Tensor("float32", batch, [patches.length, 3, SPOOF_SIZE, SPOOF_SIZE]);
  const output = await session.run({ [session.inputNames[0]!]: tensor });
  const data = output[session.outputNames[0]!]!.data as Float32Array;
  const out: number[] = [];
  for (let i = 0; i < patches.length; i++) out.push(liveProbability(data, i * SPOOF_CLASSES));
  return out;
}

/**
 * The session's verdict: the median live probability over the patches that were scored.
 *
 * The median and not the mean, and that choice is doing real work. A capture is a few seconds of a
 * moving head, and one frame in five can be caught mid-turn, half out of frame or motion-blurred —
 * inputs the model has every right to be unsure about. A mean lets one such frame drag an honest
 * capture toward a ban; the median needs *most* of the session to look like an attack before it
 * says so, which is the right bar for a decision that locks someone out.
 */
export function medianLiveProbability(samples: number[]): number | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
