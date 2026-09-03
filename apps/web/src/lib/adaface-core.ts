/**
 * The parts of the AdaFace runtime that both sides of the worker boundary need.
 *
 * `lib/adaface` spawns the worker, so the worker cannot import it back without the bundler pulling
 * a second copy of the worker into the worker. These four things — the shapes, the runtime
 * configuration and the forward pass — are all that is genuinely shared, and none of them touch the
 * DOM or the Worker API, so they live here instead.
 */
import type * as Ort from "onnxruntime-web";

/** AdaFace embeddings are 512-d, against face-api's 128. */
export const ADAFACE_DIM = 512;
/** The side of the aligned crop AdaFace was trained on. */
export const ALIGN_SIZE = 112;

/** A 1x3x112x112 NCHW tensor, BGR, scaled to [-1, 1) — exactly what the export was traced with. */
export type AlignedFace = Float32Array;

/**
 * Point onnxruntime at the wasm artefacts this origin serves and give it a sensible thread count.
 * Shared by the worker and the inline fallback, which have the same two things to decide.
 */
export function configureOrt(ort: typeof Ort, wasmPath: string): void {
  ort.env.wasm.wasmPaths = wasmPath;
  // Threads need a SharedArrayBuffer, which needs cross-origin isolation (COOP + COEP). VAJRA does
  // not set those headers — they would break the cross-origin calls to the gateway — so ask for one
  // thread unless the page happens to be isolated anyway. Asking for more than the browser will
  // grant is not a silent win: it makes onnxruntime attempt a threaded build it cannot instantiate.
  const isolated = typeof globalThis !== "undefined" && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
  const cores = typeof navigator === "undefined" ? 1 : navigator.hardwareConcurrency || 1;
  ort.env.wasm.numThreads = isolated ? Math.max(1, Math.min(4, cores)) : 1;
}

/** One batched forward pass, then L2-normalise. */
export async function runSession(
  ort: typeof Ort,
  session: Ort.InferenceSession,
  faces: AlignedFace[],
): Promise<Float32Array[]> {
  if (!faces.length) return [];
  const plane = 3 * ALIGN_SIZE * ALIGN_SIZE;
  const batch = new Float32Array(faces.length * plane);
  faces.forEach((face, i) => batch.set(face, i * plane));
  const tensor = new ort.Tensor("float32", batch, [faces.length, 3, ALIGN_SIZE, ALIGN_SIZE]);
  const output = await session.run({ [session.inputNames[0]!]: tensor });
  const data = output[session.outputNames[0]!]!.data as Float32Array;
  const out: Float32Array[] = [];
  for (let i = 0; i < faces.length; i++) out.push(l2normalise(data.slice(i * ADAFACE_DIM, (i + 1) * ADAFACE_DIM)));
  return out;
}

/**
 * The export already normalises, but only to within float error and only for this particular
 * export. Cosine similarity is meaningless if the norms drift, so we do not take it on trust.
 */
export function l2normalise(v: Float32Array): Float32Array {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
  return out;
}

/**
 * Mean of several AdaFace embeddings, re-normalised — a steadier enrolment template than any one
 * frame, and still a unit vector, so cosine similarity against it means what it says.
 */
export function averageEmbedding(samples: Float32Array[]): Float32Array | null {
  if (!samples.length) return null;
  const out = new Float32Array(samples[0]!.length);
  for (const s of samples) for (let i = 0; i < out.length; i++) out[i] += s[i]! / samples.length;
  return l2normalise(out);
}
