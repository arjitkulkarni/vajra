"use client";

/**
 * Face model loading and per-frame detection.
 *
 * Two detectors ship in the model bundle. SSD MobileNet v1 (~5.6 MB) is markedly more accurate at
 * the angles a liveness challenge deliberately provokes; TinyFaceDetector (~190 KB) is four to six
 * times faster. We open on Tiny because it is on disk in a blink, move up to SSD as soon as its
 * weights land, and drop back to Tiny for good if this machine cannot hold a usable frame rate —
 * the passive signals need a steady stream of frames more than the last percent of accuracy.
 *
 * Landmarks come from face_landmark_68, the identity descriptor from face_recognition (a 128-d
 * ResNet embedding), and the smile challenge from face_expression. The descriptor is the expensive
 * one, so it is sampled every few frames rather than every frame.
 *
 * Loading is staged so nobody watches a spinner for 13 MB: Tiny plus landmarks (~550 KB) is all the
 * camera needs to start, and the two heavy nets stream in behind the live preview. The whole thing
 * is built once per page and shared by the ID card read and the live capture, and `prefetchFaceEngine`
 * lets a page start it before the user asks for a camera.
 *
 * The weights are served from this origin (`/models`, put there by `pnpm models:fetch`) and every
 * frame is read, measured and dropped in the page. Nothing here makes a request off-origin.
 */
import type * as FaceApi from "@vladmandic/face-api";
import { adafaceAvailable, alignFace, embedOne, prefetchAdaFace } from "./adaface";
import { prefetchAntiSpoof } from "./antispoof";
import type { EmbeddingModel } from "./did";
import type { Point } from "./liveness";

export const MODEL_URL = "/models";
export type DetectorKind = "ssd" | "tiny";
type NetKey = DetectorKind | "landmarks" | "recognition" | "expression";

const MANIFESTS: Record<string, string> = {
  ssd: "ssd_mobilenetv1_model-weights_manifest.json",
  tiny: "tiny_face_detector_model-weights_manifest.json",
  landmarks: "face_landmark_68_model-weights_manifest.json",
  recognition: "face_recognition_model-weights_manifest.json",
  expression: "face_expression_model-weights_manifest.json",
};

interface TfBackend {
  setBackend(name: string): Promise<boolean>;
  getBackend(): string;
  ready(): Promise<void>;
}

export class ModelsUnavailableError extends Error {
  constructor(readonly missing: string[]) {
    super(`Face model weights missing (${missing.join(", ")}). Run: pnpm models:fetch`);
    this.name = "ModelsUnavailableError";
  }
}

export interface FaceSample {
  box: { x: number; y: number; width: number; height: number };
  score: number;
  points: Point[];
  faces: number;
  descriptor: Float32Array | null;
  happy: number;
  latencyMs: number;
}

/** Anything face-api can read a frame out of: the live video, or a still ID photo. */
export type FaceInput = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

export interface FaceEngine {
  readonly detector: DetectorKind;
  readonly backend: string;
  /** False while the 6.4 MB descriptor net is still arriving; detection runs regardless. */
  readonly descriptorsReady: boolean;
  /** Resolves when descriptors can be computed. Only the ID card read has to wait for this. */
  ensureDescriptors(): Promise<void>;
  detect(input: FaceInput, withDescriptor: boolean): Promise<FaceSample | null>;
}

async function manifestPresent(name: string): Promise<boolean> {
  try {
    const res = await fetch(`${MODEL_URL}/${name}`, { cache: "force-cache" });
    if (!res.ok) return false;
    // A dev server happily returns its 404 page with a 200 for unknown asset paths in some setups,
    // so confirm the body really is a weights manifest before trusting it.
    const body: unknown = await res.json();
    return Array.isArray(body) && body.length > 0;
  } catch {
    return false;
  }
}

export interface ModelProbe {
  ok: boolean;
  missing: string[];
  detectors: DetectorKind[];
}

let probePromise: Promise<ModelProbe> | null = null;

/**
 * Which nets are actually on disk. Memoised: the answer cannot change while the page is open, and
 * asking a second time used to cost five more round trips on the way into the camera.
 */
export function probeModels(): Promise<ModelProbe> {
  return (probePromise ??= (async () => {
    const entries = Object.entries(MANIFESTS);
    const found = await Promise.all(entries.map(([, file]) => manifestPresent(file)));
    const have = new Set(entries.filter((_, i) => found[i]).map(([key]) => key));
    const detectors = (["ssd", "tiny"] as DetectorKind[]).filter((d) => have.has(d));
    const missing = entries.filter(([key]) => !have.has(key)).map(([key]) => key);
    return { ok: detectors.length > 0 && have.has("landmarks") && have.has("recognition"), missing, detectors };
  })().catch((e) => {
    probePromise = null;
    throw e;
  }));
}

/** On-disk weight of each net. Used only to report honest progress while they arrive. */
const NET_BYTES: Record<NetKey, number> = {
  tiny: 193_321,
  landmarks: 356_840,
  expression: 329_468,
  ssd: 5_616_957,
  recognition: 6_444_032,
};

export interface LoadProgress {
  /** 0-1 over the weights this machine actually has. */
  ratio: number;
  /** True once detection can run; the descriptor net and SSD may still be arriving behind it. */
  usable: boolean;
}

const listeners = new Set<(p: LoadProgress) => void>();
let progress: LoadProgress = { ratio: 0, usable: false };

/** Watch the weights arrive, so the UI can say something better than an unbounded spinner. */
export function onModelProgress(fn: (p: LoadProgress) => void): () => void {
  listeners.add(fn);
  fn(progress);
  return () => {
    listeners.delete(fn);
  };
}

function publish(next: LoadProgress) {
  progress = next;
  for (const fn of listeners) fn(next);
}

let enginePromise: Promise<FaceEngine> | null = null;

/**
 * The engine, built once per page. Both callers — the ID card read and the live capture — get the
 * same nets, the same WebGL context and the same compiled shaders; the second one pays nothing.
 * Throws ModelsUnavailableError when the weights are not there, so the caller can fall back cleanly.
 */
export function loadFaceEngine(): Promise<FaceEngine> {
  return (enginePromise ??= buildEngine().catch((e) => {
    enginePromise = null;
    throw e;
  }));
}

/**
 * Start the load without waiting for it. Call this the moment a face step becomes plausible: the
 * weights and the tfjs bundle then arrive while the user is still typing or picking a file, rather
 * than behind a spinner they are sitting and watching.
 */
export function prefetchFaceEngine(): void {
  void loadFaceEngine().catch(() => undefined);
  // The AdaFace backbone is by far the largest thing a face step needs and it is independent of
  // everything above, so it starts now too rather than after the camera is already open.
  prefetchAdaFace();
  // The anti-spoofing graph is small, but instantiating onnxruntime's wasm behind it is not, and
  // that cost lands mid-capture unless it is paid here.
  prefetchAntiSpoof();
}

async function buildEngine(): Promise<FaceEngine> {
  // The probe, the library import and the WebGL backend have nothing to say to each other, so they
  // run together. Serialising them used to add a round trip and a bundle parse to the critical path.
  const [probe, faceapi] = await Promise.all([
    probeModels(),
    import("@vladmandic/face-api") as Promise<typeof FaceApi>,
  ]);
  if (!probe.ok) throw new ModelsUnavailableError(probe.missing);

  // The bundled tf namespace carries the full tfjs-core backend controls at runtime; the shipped
  // .d.ts only re-declares the op subset face-api itself calls, so name them here.
  const tf = faceapi.tf as unknown as TfBackend;
  try {
    await tf.setBackend("webgl");
  } catch {
    await tf.setBackend("cpu").catch(() => undefined);
  }
  await tf.ready();

  const present = (key: NetKey) => !probe.missing.includes(key);
  const wanted = (Object.keys(NET_BYTES) as NetKey[]).filter(present);
  const total = wanted.reduce((sum, key) => sum + NET_BYTES[key], 0);
  const loaded = new Set<NetKey>();

  const load = (key: NetKey, net: { loadFromUri(uri: string): Promise<void> }) =>
    net.loadFromUri(MODEL_URL).then(() => {
      loaded.add(key);
      const done = [...loaded].reduce((sum, k) => sum + NET_BYTES[k], 0);
      publish({ ratio: Math.min(1, done / total), usable: progress.usable });
    });

  // Only two small nets stand between the user and a live overlay: a detector and the landmarks.
  // SSD (5.6 MB) and the descriptor net (6.4 MB) together weigh twelve times as much and neither is
  // needed to draw the first box, so they stream in behind the camera instead of in front of it.
  const first: DetectorKind = present("tiny") ? "tiny" : "ssd";
  const critical = Promise.all([
    load("landmarks", faceapi.nets.faceLandmark68Net),
    load(first, first === "tiny" ? faceapi.nets.tinyFaceDetector : faceapi.nets.ssdMobilenetv1),
  ]);

  const recognitionReady = load("recognition", faceapi.nets.faceRecognitionNet);
  const deferred: Promise<unknown>[] = [recognitionReady];
  if (present("expression")) deferred.push(load("expression", faceapi.nets.faceExpressionNet));
  if (first === "tiny" && present("ssd")) deferred.push(load("ssd", faceapi.nets.ssdMobilenetv1));
  // Nothing awaits these here; a failure must not become an unhandled rejection.
  for (const p of deferred) p.catch(() => undefined);

  await critical;
  publish({ ratio: progress.ratio, usable: true });

  const ssdOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4, maxResults: 4 });
  const tinyOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 });

  let detector: DetectorKind = first;
  /** Set once the latency guard has moved us to Tiny; it is never undone. */
  let pinnedToTiny = false;
  const latencies: number[] = [];

  const engine: FaceEngine = {
    get detector() {
      return detector;
    },
    get descriptorsReady() {
      return loaded.has("recognition");
    },
    backend: tf.getBackend(),
    ensureDescriptors: () => recognitionReady,
    async detect(input, withDescriptor) {
      // Move up to SSD once it has arrived — it is markedly better at the angles a liveness
      // challenge deliberately provokes — unless this machine has already failed to keep up with it.
      if (!pinnedToTiny && detector === "tiny" && loaded.has("ssd")) detector = "ssd";

      const started = performance.now();
      const options = detector === "ssd" ? ssdOptions : tinyOptions;
      // detectAllFaces, not detectSingleFace: a second face in frame is itself a liveness signal.
      const base = faceapi.detectAllFaces(input, options).withFaceLandmarks();
      const chain = loaded.has("expression") ? base.withFaceExpressions() : base;
      // A descriptor is only asked for once the net that computes it is here. Until then the frame
      // is still fully measured; it just contributes no sample to the template.
      const results = await (withDescriptor && loaded.has("recognition") ? chain.withFaceDescriptors() : chain);
      const latencyMs = performance.now() - started;

      // Whichever detector we are on, if a frame costs more than ~150 ms the signals starve.
      // One switch, one direction: SSD to Tiny, never back.
      latencies.push(latencyMs);
      if (latencies.length > 12) latencies.shift();
      if (detector === "ssd" && present("tiny") && latencies.length >= 8) {
        const median = [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length / 2)]!;
        if (median > 150) {
          detector = "tiny";
          pinnedToTiny = true;
          latencies.length = 0;
        }
      }

      if (!results.length) return null;
      // The subject is the largest face; the rest only matter as a count.
      const primary = results.reduce((best, r) =>
        r.detection.box.area > best.detection.box.area ? r : best,
      ) as (typeof results)[number] & { descriptor?: Float32Array; expressions?: { happy: number } };
      const { box, score } = primary.detection;
      return {
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        score,
        points: primary.landmarks.positions.map((p) => ({ x: p.x, y: p.y })),
        faces: results.length,
        descriptor: primary.descriptor ?? null,
        happy: primary.expressions?.happy ?? 0,
        latencyMs,
      };
    },
  };

  // The first inference on a WebGL backend pays for shader compilation — a second or more — and it
  // would otherwise be paid on the user's first real frame. Spend it here instead, on a blank
  // canvas, while the camera permission prompt and the remaining weights are still in flight.
  void (async () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await engine.detect(canvas, false);
    } catch {
      // A warm-up that fails costs nothing; the real frames compile the shaders instead.
    }
  })();

  return engine;
}
/**
 * Copy the face region into a small square canvas and read the pixels back.
 * The crop is what the focus and texture signals are measured on; it never leaves this function's
 * caller and is overwritten on the next frame.
 */
export function readFaceCrop(
  video: HTMLVideoElement,
  box: { x: number; y: number; width: number; height: number },
  canvas: HTMLCanvasElement,
  size = 112,
): { data: Uint8ClampedArray; width: number; height: number } | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  canvas.width = size;
  canvas.height = size;
  const side = Math.max(box.width, box.height);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const sx = Math.max(0, cx - side / 2);
  const sy = Math.max(0, cy - side / 2);
  const sw = Math.min(side, video.videoWidth - sx);
  const sh = Math.min(side, video.videoHeight - sy);
  if (sw <= 1 || sh <= 1) return null;
  try {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, size, size);
    const image = ctx.getImageData(0, 0, size, size);
    return { data: image.data, width: image.width, height: image.height };
  } catch {
    return null;
  }
}

/**
 * The face on an employee ID card, as an embedding.
 *
 * This is the reference the signup match is scored against, and it is computed here in the page:
 * the card is read, measured and turned into numbers before anything is uploaded. AdaFace when its
 * weights are on this machine — the card photo is exactly the low-quality, off-angle image its
 * quality-adaptive margin was designed for — and face-api's 128-d descriptor when they are not, so
 * a laptop that has not run `pnpm models:fetch` still gets a working, honestly-labelled signup.
 *
 * Returns null when no face can be found, which is the truthful outcome for a photo of a desk.
 */
export interface DocumentFace {
  descriptor: Float32Array;
  model: EmbeddingModel;
  detectionScore: number;
}

export async function describeDocument(engine: FaceEngine, file: File): Promise<DocumentFace | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("The ID document could not be read as an image."));
      img.src = url;
    });

    const useAdaFace = await adafaceAvailable();
    // Landmarks are what AdaFace aligns on, so with it there is no reason to pay for face-api's
    // descriptor as well; without it that descriptor is the whole answer.
    await (useAdaFace ? Promise.resolve() : engine.ensureDescriptors());
    const sample = await engine.detect(image, !useAdaFace);
    if (!sample) return null;

    if (useAdaFace) {
      const aligned = alignFace(image, sample.points, document.createElement("canvas"));
      // A throw here is the *common* AdaFace failure — a worker that will not start, weights that
      // went away mid-read — and it has to reach the fallback below rather than escape the function.
      // Without this catch the documented fallback is only reachable when embedOne returns null.
      const embedding = aligned ? await embedOne(aligned).catch(() => null) : null;
      if (embedding) return { descriptor: embedding, model: "adaface", detectionScore: sample.score };
      // The weights are here but this particular card would not align or embed. Rather than fail the
      // signup outright, fall back to the descriptor net — visibly, via the model tag that travels
      // with the template, so nothing is later compared across the two spaces by accident.
      await engine.ensureDescriptors();
      const retry = await engine.detect(image, true);
      if (retry?.descriptor) return { descriptor: retry.descriptor, model: "faceapi", detectionScore: retry.score };
      return null;
    }

    if (!sample.descriptor) return null;
    return { descriptor: sample.descriptor, model: "faceapi", detectionScore: sample.score };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The frame that was actually scored, as a JPEG — the evidence the gateway stores and anchors. */
export function captureFrame(video: HTMLVideoElement, maxWidth = 480, quality = 0.82): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
  canvas.width = Math.round((video.videoWidth || maxWidth) * scale);
  canvas.height = Math.round((video.videoHeight || maxWidth * 0.75) * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

/**
 * A visibly-labelled stand-in for the frame, used only when the camera or the model weights are
 * missing. It is stored like any other capture, so the evidence trail says SIMULATED in the picture
 * as well as in the mode flag — there is no path where a placeholder passes for a real face.
 */
export function simulatedFrame(label = "SIMULATED"): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  // This is drawn INTO a JPEG that is stored as evidence, not onto the page, so it stays dark
  // regardless of the site's ground — a white placeholder would read as a broken image in the
  // capture strip. The two literals are the Daylight near-black and the on-dark saffron
  // (globals.css `.on-ink --color-saffron`), which is the system's "this is not the real thing"
  // signal and clears 11:1 against the frame it is stamped on.
  ctx.fillStyle = "#151515";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#f5c35c";
  ctx.lineWidth = 3;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  ctx.fillStyle = "#f5c35c";
  ctx.font = "bold 34px monospace";
  ctx.textAlign = "center";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 - 6);
  ctx.font = "15px monospace";
  ctx.fillText(new Date().toISOString(), canvas.width / 2, canvas.height / 2 + 26);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8));
}

/** Mean of several descriptors, L2-normalised — a steadier enrolment template than any one frame. */
export function averageDescriptor(samples: Float32Array[]): Float32Array | null {
  if (!samples.length) return null;
  const out = new Float32Array(samples[0]!.length);
  for (const s of samples) for (let i = 0; i < out.length; i++) out[i] += s[i]! / samples.length;
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  const reference = Math.sqrt(samples[0]!.reduce((sum, v) => sum + v * v, 0)) || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i]! / norm) * reference;
  return out;
}
