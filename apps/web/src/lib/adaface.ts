"use client";

/**
 * AdaFace — the identity embedding, computed in this browser.
 *
 * VAJRA's face match used to be face-api's 128-d ResNet descriptor. That net is a 2017-era dlib
 * port and it is the weakest link in the five-verification bundle: it degrades sharply on the
 * low-quality, off-angle, badly-lit images a real ID card and a real turnstile actually produce.
 * AdaFace (Kim, Jain & Liu, CVPR 2022 — https://github.com/mk-minchul/AdaFace) is trained with a
 * quality-adaptive margin that does the opposite: it down-weights unidentifiable images during
 * training rather than letting them drag the decision boundary around. On the IJB-B/C and TinyFace
 * benchmarks that stand in for this workload it is a different class of model.
 *
 * The backbone is IR-50 trained on MS1MV2, exported to ONNX and run here with onnxruntime-web.
 * Everything the old descriptor promised still holds: the weights are served from this origin
 * (`/models`, put there by `pnpm models:fetch`), the crop is built in a canvas in this page, and the
 * comparison happens in this page. Nothing computed here is uploaded during a *check* — the gateway
 * receives a 0-100 confidence, not an embedding. The one thing that does leave is the enrolment
 * template at signup, registered so a later login can be scored against what an administrator
 * approved; `docs/HOW-IT-IS-BUILT.md` sets out that trade and why it is made.
 *
 * Two things AdaFace needs that face-api did not:
 *
 *   1. A properly *aligned* crop. AdaFace, like every ArcFace-lineage model, is trained on faces
 *      warped onto a fixed five-point template at 112x112. Feeding it the loose square crop the
 *      liveness signals use throws away most of the accuracy that made it worth adopting, so
 *      `alignFace` solves the least-squares similarity transform from the 68 landmarks onto that
 *      template and warps the frame through it.
 *   2. BGR channel order and [-1, 1] scaling, which is what the export was traced with.
 *
 * Inference is far heavier than face-api's descriptor, so it does not run per frame. The capture
 * loop keeps a handful of aligned crops — a few hundred microseconds each — and the embeddings are
 * computed once, at the end, in a worker. See `embedAligned`.
 */
import type * as Ort from "onnxruntime-web";
import { ALIGN_SIZE, configureOrt, runSession, type AlignedFace } from "./adaface-core";

export { ADAFACE_DIM, ALIGN_SIZE, averageEmbedding, l2normalise, type AlignedFace } from "./adaface-core";

export const ADAFACE_MODEL_FILE = "adaface_ir50_ms1mv2.onnx";
export const ADAFACE_MODEL_URL = `/models/${ADAFACE_MODEL_FILE}`;
/** Where `pnpm models:fetch` copies onnxruntime-web's wasm artefacts, so nothing is fetched off-origin. */
export const ORT_WASM_PATH = "/ort/";

/**
 * How long to wait for the backbone to build, and for a batch to come back.
 *
 * Neither await can fail on its own: a stalled 174 MB fetch never rejects, and a worker terminated
 * mid-flight answers nothing at all. The capture's own 45 s deadline is only checked between frames,
 * so without these the embedding phase is the one place in the flow that can spin forever. A face
 * check that cannot run has to say so and let the caller fall back, not hang.
 */
const READY_TIMEOUT_MS = 120_000;
const EMBED_TIMEOUT_MS = 30_000;

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AdaFaceUnavailableError(new Error(`${what} timed out after ${ms} ms.`))), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}

/**
 * The ArcFace five-point template, in 112x112 coordinates. Every model in this lineage — ArcFace,
 * MagFace, AdaFace — is trained on faces warped onto these exact five points, so they are not a
 * tunable: change them and the embedding space changes with them.
 */
const TEMPLATE: readonly (readonly [number, number])[] = [
  [38.2946, 51.6963], // left eye
  [73.5318, 51.5014], // right eye
  [56.0252, 71.7366], // nose tip
  [41.5493, 92.3655], // left mouth corner
  [70.7299, 92.2041], // right mouth corner
];

export interface Point {
  x: number;
  y: number;
}

/** Mean of a slice of the 68-point landmark set. */
function centroid(points: Point[], from: number, to: number): Point {
  let x = 0;
  let y = 0;
  for (let i = from; i < to; i++) {
    x += points[i]!.x;
    y += points[i]!.y;
  }
  const n = to - from;
  return { x: x / n, y: y / n };
}

/**
 * The five points AdaFace aligns on, read off face-api's 68.
 *
 * The eyes are the centroids of their six-point contours rather than any single landmark: an eye
 * corner moves with a blink, and the challenge deliberately asks for blinks.
 */
export function fivePoints(points: Point[]): [Point, Point, Point, Point, Point] | null {
  if (points.length < 68) return null;
  return [centroid(points, 36, 42), centroid(points, 42, 48), points[30]!, points[48]!, points[54]!];
}

/** cos, sin, tx, ty of the similarity transform that carries the source points onto the template. */
interface Similarity {
  c: number;
  s: number;
  tx: number;
  ty: number;
}

/**
 * Least-squares similarity transform (rotation, uniform scale, translation) from five detected
 * points onto the template — the 2-D closed form of Umeyama's solution. Reflection is deliberately
 * not in the family: a face is never mirrored into the template.
 */
function solveSimilarity(src: readonly Point[], dst: readonly (readonly [number, number])[]): Similarity | null {
  const n = src.length;
  let mpx = 0;
  let mpy = 0;
  let mqx = 0;
  let mqy = 0;
  for (let i = 0; i < n; i++) {
    mpx += src[i]!.x;
    mpy += src[i]!.y;
    mqx += dst[i]![0];
    mqy += dst[i]![1];
  }
  mpx /= n;
  mpy /= n;
  mqx /= n;
  mqy /= n;

  let dot = 0;
  let cross = 0;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i]!.x - mpx;
    const py = src[i]!.y - mpy;
    const qx = dst[i]![0] - mqx;
    const qy = dst[i]![1] - mqy;
    dot += px * qx + py * qy;
    cross += px * qy - py * qx;
    norm += px * px + py * py;
  }
  // A degenerate landmark set — every point on top of every other — has no transform to give.
  if (!(norm > 1e-6)) return null;
  const c = dot / norm;
  const s = cross / norm;
  return { c, s, tx: mqx - (c * mpx - s * mpy), ty: mqy - (s * mpx + c * mpy) };
}

/**
 * Warp a face onto the ArcFace template and turn it into AdaFace's input tensor.
 *
 * The canvas is the caller's, reused frame to frame; the pixels are read back and dropped inside
 * this function. Returns null when the landmarks are unusable — a face at the very edge of frame,
 * or a detection with no 68-point set behind it.
 */
export function alignFace(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  points: Point[],
  canvas: HTMLCanvasElement,
): AlignedFace | null {
  const five = fivePoints(points);
  if (!five) return null;
  const m = solveSimilarity(five, TEMPLATE);
  if (!m) return null;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  canvas.width = ALIGN_SIZE;
  canvas.height = ALIGN_SIZE;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // setTransform(a, b, c, d, e, f) maps x' = a*x + c*y + e, y' = b*x + d*y + f — so the rotation
  // matrix [[c, -s], [s, c]] lands as (c, s, -s, c) with the translation after it.
  ctx.setTransform(m.c, m.s, -m.s, m.c, m.tx, m.ty);
  try {
    ctx.drawImage(input, 0, 0);
  } catch {
    ctx.restore();
    return null;
  }
  ctx.restore();

  let pixels: ImageData;
  try {
    pixels = ctx.getImageData(0, 0, ALIGN_SIZE, ALIGN_SIZE);
  } catch {
    return null;
  }

  const plane = ALIGN_SIZE * ALIGN_SIZE;
  const out = new Float32Array(3 * plane);
  const rgba = pixels.data;
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    // BGR, not RGB: the checkpoint was trained through OpenCV and the export kept that order.
    out[i] = (rgba[p + 2]! - 127.5) / 127.5;
    out[plane + i] = (rgba[p + 1]! - 127.5) / 127.5;
    out[2 * plane + i] = (rgba[p]! - 127.5) / 127.5;
  }
  return out;
}

// ─── the model itself ────────────────────────────────────────────────────────

export class AdaFaceUnavailableError extends Error {
  constructor(readonly reason?: unknown) {
    super("AdaFace weights are not on this machine. Run: pnpm models:fetch");
    this.name = "AdaFaceUnavailableError";
  }
}

let availability: Promise<boolean> | null = null;

/**
 * Whether the backbone is actually served from this origin.
 *
 * Memoised, because a file that is there stays there and one that is absent stays absent — but only
 * a *definitive* answer is kept. A request that never got one is forgotten, so a page opened before
 * the dev server finished booting is not pinned to the fallback net for as long as it stays open.
 */
export function adafaceAvailable(): Promise<boolean> {
  return (availability ??= (async () => {
    let res: Response;
    try {
      res = await fetch(ADAFACE_MODEL_URL, { method: "HEAD", cache: "force-cache" });
    } catch (e) {
      // The request never got an answer — offline, a dropped connection, a dev server still coming
      // up. That is not "the weights are absent", and memoising it would silently pin this page to
      // the fallback net for as long as it stays open, so forget it and let the next caller ask.
      availability = null;
      throw new AdaFaceUnavailableError(e);
    }
    if (!res.ok) return false;
    // A dev server that answers unknown paths with its 200 HTML shell would otherwise look like a
    // model; an ONNX graph is neither HTML nor a few hundred bytes long.
    const length = Number(res.headers.get("content-length") ?? "0");
    const type = res.headers.get("content-type") ?? "";
    return length > 1_000_000 && !type.includes("text/html");
  })().catch((e) => {
    availability = null;
    // A caller that only wants to know whether to bother is answered honestly: not right now.
    if (e instanceof AdaFaceUnavailableError) return false;
    throw e;
  }));
}

/** How much of the backbone has arrived, 0-1, so the UI can say something better than "loading". */
export interface AdaFaceProgress {
  ratio: number;
  ready: boolean;
}

const listeners = new Set<(p: AdaFaceProgress) => void>();
let progress: AdaFaceProgress = { ratio: 0, ready: false };

export function onAdaFaceProgress(fn: (p: AdaFaceProgress) => void): () => void {
  listeners.add(fn);
  fn(progress);
  return () => {
    listeners.delete(fn);
  };
}

function publish(next: AdaFaceProgress) {
  progress = next;
  for (const fn of listeners) fn(next);
}

/**
 * The embedding backend. A worker when the browser will give us one — a large graph and a
 * hundreds-of-milliseconds forward pass have no business on the thread drawing the camera overlay —
 * and the same code inline when it will not.
 */
export interface AdaFaceBackend {
  readonly where: "worker" | "inline";
  /** True once this backend has failed for good. A dead backend is retired, never handed out again. */
  readonly dead: boolean;
  embed(faces: AlignedFace[]): Promise<Float32Array[]>;
}

let backendPromise: Promise<AdaFaceBackend> | null = null;

/**
 * Load the backbone. Both callers — the ID card read and the live capture — share one session, one
 * copy of the weights and one set of compiled kernels; the second one pays nothing.
 */
export async function loadAdaFace(): Promise<AdaFaceBackend> {
  const existing = backendPromise;
  if (existing) {
    const backend = await existing.catch(() => null);
    if (backend && !backend.dead) return backend;
    // The worker died, or the build failed. Retire it rather than handing out a corpse forever —
    // but only if nothing has already replaced it while we were awaiting.
    if (backendPromise === existing) backendPromise = null;
  }
  return (backendPromise ??= buildBackend().catch((e) => {
    backendPromise = null;
    publish({ ratio: 0, ready: false });
    throw e instanceof AdaFaceUnavailableError ? e : new AdaFaceUnavailableError(e);
  }));
}

/**
 * Start the load without waiting for it. Called the moment a face step becomes plausible, so the
 * weights are arriving while the user is still typing or picking a file.
 */
export function prefetchAdaFace(): void {
  void loadAdaFace().catch(() => undefined);
}

async function buildBackend(): Promise<AdaFaceBackend> {
  if (!(await adafaceAvailable())) throw new AdaFaceUnavailableError();
  return spawnWorker() ?? (await buildInline());
}

type WorkerMessage =
  | { type: "progress"; ratio: number }
  | { type: "ready" }
  | { type: "failed"; error: string }
  | { type: "result"; id: number; embeddings: Float32Array[] }
  | { type: "error"; id: number; error: string };

/** The worker path: the graph is fetched, built and run entirely off the main thread. */
function spawnWorker(): AdaFaceBackend | null {
  if (typeof Worker === "undefined") return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./adaface.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }

  let seq = 0;
  const pending = new Map<number, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>();
  let settle: { resolve: () => void; reject: (e: Error) => void } | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // Nothing may await `ready` before a caller does, and a worker that dies before the first embed
  // would otherwise be an unhandled rejection.
  ready.catch(() => undefined);

  worker.onmessage = (event: MessageEvent) => {
    const msg = event.data as WorkerMessage;
    switch (msg.type) {
      case "progress":
        publish({ ratio: msg.ratio, ready: progress.ready });
        return;
      case "ready":
        publish({ ratio: 1, ready: true });
        settle?.resolve();
        return;
      case "failed":
        settle?.reject(new AdaFaceUnavailableError(new Error(msg.error)));
        discard(new AdaFaceUnavailableError(new Error(msg.error)));
        return;
      case "result":
        pending.get(msg.id)?.resolve(msg.embeddings);
        pending.delete(msg.id);
        return;
      case "error":
        pending.get(msg.id)?.reject(new Error(msg.error));
        pending.delete(msg.id);
        return;
    }
  };
  worker.onmessageerror = () => {
    // A reply we cannot deserialise is a reply that will never arrive.
    discard(new AdaFaceUnavailableError(new Error("An AdaFace reply could not be read.")));
  };
  worker.onerror = () => {
    const error = new AdaFaceUnavailableError(new Error("The AdaFace worker failed."));
    settle?.reject(error);
    // Anything already posted will never be answered now, so fail it here rather than leave the
    // caller awaiting a promise nothing will ever settle.
    discard(error);
  };
  worker.postMessage({ type: "init", modelUrl: ADAFACE_MODEL_URL, wasmPath: ORT_WASM_PATH });

  /** Tear this backend down so the next caller builds a fresh one instead of reusing a corpse. */
  let dead = false;
  const discard = (reason: Error) => {
    if (dead) return;
    dead = true;
    publish({ ratio: 0, ready: false });
    for (const { reject } of pending.values()) reject(reason);
    pending.clear();
    try {
      worker.terminate();
    } catch {
      // Already gone. Nothing to do.
    }
  };

  return {
    get dead() {
      return dead;
    },
    where: "worker",
    async embed(faces) {
      // A terminated worker silently swallows postMessage, so a promise posted to one is never
      // settled by anything. Refuse up front rather than hand back a promise nothing can resolve.
      if (dead) throw new AdaFaceUnavailableError(new Error("The AdaFace worker is gone."));
      try {
        await withTimeout(ready, READY_TIMEOUT_MS, "Loading the AdaFace backbone");
      } catch (e) {
        // The graph never built. Drop this backend so the next caller gets a fresh one.
        discard(e as Error);
        throw e;
      }
      if (!faces.length) return [];
      if (dead) throw new AdaFaceUnavailableError(new Error("The AdaFace worker is gone."));
      const id = ++seq;
      const buffers = faces.map((f) => f.buffer as ArrayBuffer);
      const result = new Promise<Float32Array[]>((resolve, reject) => pending.set(id, { resolve, reject }));
      // The tensors are transferred, not copied: after this the caller's Float32Arrays are detached,
      // which is exactly right — an aligned face is never wanted twice.
      worker.postMessage({ type: "embed", id, faces }, buffers);
      return withTimeout(result, EMBED_TIMEOUT_MS, "The AdaFace batch").catch((e: unknown) => {
        pending.delete(id);
        // A batch that timed out left the worker mid-inference on tensors we have already given up
        // on. Handing that worker to the next caller only queues them behind it, so retire it and
        // let the next loadAdaFace build a clean one.
        discard(e as Error);
        throw e as Error;
      });
    },
  };
}

/** The fallback path, on the main thread, for browsers that will not give us a module worker. */
async function buildInline(): Promise<AdaFaceBackend> {
  const ort = (await import("onnxruntime-web")) as typeof Ort;
  configureOrt(ort, ORT_WASM_PATH);
  // Same deadline as the worker: a stalled fetch of the backbone never rejects on its own, and this
  // path has no worker to terminate, so without it the inline fallback is the one place left that
  // can spin forever behind the "computing the face embedding" spinner.
  const session = await withTimeout(
    ort.InferenceSession.create(ADAFACE_MODEL_URL, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }),
    READY_TIMEOUT_MS,
    "Loading the AdaFace backbone",
  );
  publish({ ratio: 1, ready: true });
  return {
    where: "inline",
    // The session is in this thread; there is no worker to lose, so it never dies on its own.
    dead: false,
    embed: (faces) => runSession(ort, session, faces),
  };
}

/** Embed a set of aligned crops. Throws AdaFaceUnavailableError when the weights are not here. */
export async function embedAligned(faces: AlignedFace[]): Promise<Float32Array[]> {
  const backend = await loadAdaFace();
  return backend.embed(faces);
}

/** Embed exactly one aligned crop — the ID card read, and nothing else. */
export async function embedOne(face: AlignedFace): Promise<Float32Array | null> {
  const [embedding] = await embedAligned([face]);
  return embedding ?? null;
}
