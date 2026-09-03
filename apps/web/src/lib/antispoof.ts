"use client";

/**
 * MiniFASNet — the live AI check, running in this browser.
 *
 * The six passive signals in `lib/liveness` are hand-written physics: is the nose out of the face
 * plane, do the brows move independently, is the crop sharp, is the chroma spread what a screen
 * produces. They are explainable, they are cheap, and each one names the specific attack it refuses.
 * What they cannot do is generalise. A signal that measures blown highlights knows about *blown
 * highlights*; an attack that avoids them walks straight past it, and a face rendered by a model —
 * a deepfake played into a virtual camera, a re-animated portrait — is not something a Laplacian
 * variance was ever going to catch.
 *
 * So a second, independent opinion runs alongside them: Silent-Face-Anti-Spoofing
 * (https://github.com/minivision-ai/Silent-Face-Anti-Spoofing, Apache-2.0), the MiniFASNetV2
 * checkpoint trained at a 2.7x crop scale on 80x80 patches. It is a classifier trained end-to-end
 * on real presentation attacks — print, replay, mask, and the synthetic faces that share their
 * statistics — and it decides on the whole scene around the face rather than on any one cue.
 *
 * The two disagree in useful ways, which is the point of running both. The passive signals catch
 * the flat, still, badly-lit attack the model is least sure about; the model catches the well-shot
 * replay that satisfies every geometric signal. Neither is asked to overrule the other: the passive
 * composite scores the capture, and this one answers a separate question with a separate
 * consequence — the gateway treats a confident spoof verdict as a presentation attack, refuses the
 * action and opens an incident that locks the identity's sessions.
 *
 * Everything the rest of this codebase promises still holds. The weights are served from this
 * origin (`/models`, put there by `pnpm models:fetch`), the patch is built in a canvas in this page,
 * inference happens in a worker in this page, and what leaves the browser is one number between 0
 * and 1 — never a frame, never a patch.
 */
import type * as Ort from "onnxruntime-web";
import { configureSpoofOrt, runSpoofSession, SPOOF_SCALE, SPOOF_SIZE, type SpoofPatch } from "./antispoof-core";

export {
  medianLiveProbability,
  SPOOF_SCALE,
  SPOOF_SIZE,
  type SpoofPatch,
} from "./antispoof-core";

/** The name reported alongside the number, so the evidence says which model produced it. */
export const SPOOF_MODEL = "minifasnet_v2_2.7_80x80";
export const SPOOF_MODEL_FILE = "minifasnet_v2.onnx";
export const SPOOF_MODEL_URL = `/models/${SPOOF_MODEL_FILE}`;
/** Where `pnpm models:fetch` copies onnxruntime-web's wasm artefacts, so nothing is fetched off-origin. */
const ORT_WASM_PATH = "/ort/";

/**
 * A stalled fetch never rejects and a terminated worker answers nothing at all, so both awaits get
 * a deadline. This check is advisory to the flow — a capture whose AI check cannot run reports it
 * as unmeasured and carries on — so the deadlines are short: there is nothing to gain by making
 * someone wait for an opinion we are willing to proceed without.
 */
const READY_TIMEOUT_MS = 20_000;
const SCORE_TIMEOUT_MS = 10_000;

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AntiSpoofUnavailableError(new Error(`${what} timed out after ${ms} ms.`))), ms);
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

export class AntiSpoofUnavailableError extends Error {
  constructor(readonly reason?: unknown) {
    super("The anti-spoofing weights are not on this machine. Run: pnpm models:fetch");
    this.name = "AntiSpoofUnavailableError";
  }
}

// ─── the patch ───────────────────────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The crop rectangle, as `[left, top, right, bottom]` inclusive of both corners.
 *
 * A direct port of `CropImage._get_new_box` from the upstream repository, kept faithful down to the
 * truncation: the model's tell-tales live in the framing, so a crop that is merely *similar* to the
 * one it was trained on is a different input. The box is grown by `scale` about the face centre,
 * the scale is first capped so the enlarged box can still fit inside the frame, and a box that runs
 * off an edge is slid back in rather than clipped — which is why the returned rectangle keeps the
 * requested size wherever the frame allows it.
 */
export function spoofCropBox(srcWidth: number, srcHeight: number, box: Box, scale = SPOOF_SCALE): [number, number, number, number] | null {
  if (!(srcWidth > 1) || !(srcHeight > 1) || !(box.width > 0) || !(box.height > 0)) return null;
  const capped = Math.min((srcHeight - 1) / box.height, Math.min((srcWidth - 1) / box.width, scale));
  const width = box.width * capped;
  const height = box.height * capped;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  let left = cx - width / 2;
  let top = cy - height / 2;
  let right = cx + width / 2;
  let bottom = cy + height / 2;
  if (left < 0) {
    right -= left;
    left = 0;
  }
  if (top < 0) {
    bottom -= top;
    top = 0;
  }
  if (right > srcWidth - 1) {
    left -= right - srcWidth + 1;
    right = srcWidth - 1;
  }
  if (bottom > srcHeight - 1) {
    top -= bottom - srcHeight + 1;
    bottom = srcHeight - 1;
  }
  // `|| 0` and not a bare trunc: a crop that was slid back from a negative edge truncates to -0,
  // which draws and compares as 0 everywhere except a deep-equality check against the reference
  // rectangles this is tested on. Normalising here keeps that comparison meaningful.
  const whole = (v: number) => Math.trunc(v) || 0;
  return [whole(left), whole(top), whole(right), whole(bottom)];
}

/**
 * Warp the frame into the 80x80 patch MiniFASNet expects: BGR, NCHW, and in [0, 255].
 *
 * The canvas is the caller's, reused frame to frame; the pixels are read back and dropped inside
 * this function. Returns null when there is no usable crop — a face at the very edge of frame, or a
 * video element that has gone away mid-read.
 */
export function readSpoofPatch(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  box: Box,
  canvas: HTMLCanvasElement,
  frame?: { width: number; height: number },
): SpoofPatch | null {
  const width = frame?.width ?? (input as HTMLVideoElement).videoWidth ?? (input as HTMLCanvasElement).width;
  const height = frame?.height ?? (input as HTMLVideoElement).videoHeight ?? (input as HTMLCanvasElement).height;
  const rect = spoofCropBox(width, height, box);
  if (!rect) return null;
  const [left, top, right, bottom] = rect;
  // Inclusive of both corners, exactly as the upstream slice is.
  const sw = right - left + 1;
  const sh = bottom - top + 1;
  if (sw <= 1 || sh <= 1) return null;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  canvas.width = SPOOF_SIZE;
  canvas.height = SPOOF_SIZE;
  try {
    ctx.drawImage(input, left, top, sw, sh, 0, 0, SPOOF_SIZE, SPOOF_SIZE);
  } catch {
    return null;
  }

  let pixels: ImageData;
  try {
    pixels = ctx.getImageData(0, 0, SPOOF_SIZE, SPOOF_SIZE);
  } catch {
    return null;
  }

  const plane = SPOOF_SIZE * SPOOF_SIZE;
  const out = new Float32Array(3 * plane);
  const rgba = pixels.data;
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    // BGR and un-normalised: see the note on SpoofPatch in antispoof-core.
    out[i] = rgba[p + 2]!;
    out[plane + i] = rgba[p + 1]!;
    out[2 * plane + i] = rgba[p]!;
  }
  return out;
}

// ─── the model ───────────────────────────────────────────────────────────────

let availability: Promise<boolean> | null = null;

/**
 * Whether the weights are actually served from this origin.
 *
 * Memoised the way `adafaceAvailable` is, and for the same reason: a definitive answer is kept, a
 * request that never got one is forgotten so a page opened before the dev server finished booting
 * is not pinned to "no AI check" for as long as it stays open.
 */
export function antispoofAvailable(): Promise<boolean> {
  return (availability ??= (async () => {
    let res: Response;
    try {
      res = await fetch(SPOOF_MODEL_URL, { method: "HEAD", cache: "force-cache" });
    } catch (e) {
      availability = null;
      throw new AntiSpoofUnavailableError(e);
    }
    if (!res.ok) return false;
    // A dev server that answers unknown paths with its 200 HTML shell would otherwise look like a
    // model. The graph is 1.7 MB; anything under a megabyte is not it.
    const length = Number(res.headers.get("content-length") ?? "0");
    const type = res.headers.get("content-type") ?? "";
    return length > 1_000_000 && !type.includes("text/html");
  })().catch((e) => {
    availability = null;
    if (e instanceof AntiSpoofUnavailableError) return false;
    throw e;
  }));
}

interface AntiSpoofBackend {
  readonly where: "worker" | "inline";
  /** True once this backend has failed for good. A dead backend is retired, never handed out again. */
  readonly dead: boolean;
  score(patches: SpoofPatch[]): Promise<number[]>;
}

let backendPromise: Promise<AntiSpoofBackend> | null = null;

/** Load the graph. One session is shared by every caller on the page. */
async function loadAntiSpoof(): Promise<AntiSpoofBackend> {
  const existing = backendPromise;
  if (existing) {
    const backend = await existing.catch(() => null);
    if (backend && !backend.dead) return backend;
    if (backendPromise === existing) backendPromise = null;
  }
  return (backendPromise ??= buildBackend().catch((e) => {
    backendPromise = null;
    throw e instanceof AntiSpoofUnavailableError ? e : new AntiSpoofUnavailableError(e);
  }));
}

/**
 * Start the load without waiting for it. Called the moment a face step becomes plausible, so the
 * graph and onnxruntime's wasm are in place before the first patch is ever built.
 */
export function prefetchAntiSpoof(): void {
  void loadAntiSpoof().catch(() => undefined);
}

async function buildBackend(): Promise<AntiSpoofBackend> {
  if (!(await antispoofAvailable())) throw new AntiSpoofUnavailableError();
  return spawnWorker() ?? (await buildInline());
}

type WorkerMessage =
  | { type: "ready" }
  | { type: "failed"; error: string }
  | { type: "result"; id: number; scores: number[] }
  | { type: "error"; id: number; error: string };

function spawnWorker(): AntiSpoofBackend | null {
  if (typeof Worker === "undefined") return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./antispoof.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }

  let seq = 0;
  const pending = new Map<number, { resolve: (v: number[]) => void; reject: (e: Error) => void }>();
  let settle: { resolve: () => void; reject: (e: Error) => void } | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // Nothing awaits `ready` before a caller does, and a worker that dies before the first score
  // would otherwise be an unhandled rejection.
  ready.catch(() => undefined);

  let dead = false;
  /** Tear this backend down so the next caller builds a fresh one instead of reusing a corpse. */
  const discard = (reason: Error) => {
    if (dead) return;
    dead = true;
    for (const { reject } of pending.values()) reject(reason);
    pending.clear();
    try {
      worker.terminate();
    } catch {
      // Already gone. Nothing to do.
    }
  };

  worker.onmessage = (event: MessageEvent) => {
    const msg = event.data as WorkerMessage;
    switch (msg.type) {
      case "ready":
        settle?.resolve();
        return;
      case "failed": {
        const error = new AntiSpoofUnavailableError(new Error(msg.error));
        settle?.reject(error);
        discard(error);
        return;
      }
      case "result":
        pending.get(msg.id)?.resolve(msg.scores);
        pending.delete(msg.id);
        return;
      case "error":
        pending.get(msg.id)?.reject(new Error(msg.error));
        pending.delete(msg.id);
        return;
    }
  };
  const fail = (what: string) => () => {
    const error = new AntiSpoofUnavailableError(new Error(what));
    settle?.reject(error);
    discard(error);
  };
  worker.onmessageerror = fail("An anti-spoofing reply could not be read.");
  worker.onerror = fail("The anti-spoofing worker failed.");
  worker.postMessage({ type: "init", modelUrl: SPOOF_MODEL_URL, wasmPath: ORT_WASM_PATH });

  return {
    get dead() {
      return dead;
    },
    where: "worker",
    async score(patches) {
      // A terminated worker silently swallows postMessage, so a promise posted to one is never
      // settled by anything. Refuse up front rather than hand back a promise nothing can resolve.
      if (dead) throw new AntiSpoofUnavailableError(new Error("The anti-spoofing worker is gone."));
      try {
        await withTimeout(ready, READY_TIMEOUT_MS, "Loading the anti-spoofing model");
      } catch (e) {
        discard(e as Error);
        throw e;
      }
      if (!patches.length) return [];
      if (dead) throw new AntiSpoofUnavailableError(new Error("The anti-spoofing worker is gone."));
      const id = ++seq;
      const result = new Promise<number[]>((resolve, reject) => pending.set(id, { resolve, reject }));
      // The patches are transferred, not copied: after this the caller's Float32Arrays are detached,
      // which is exactly right — a patch is never wanted twice.
      worker.postMessage({ type: "score", id, patches }, patches.map((p) => p.buffer as ArrayBuffer));
      return withTimeout(result, SCORE_TIMEOUT_MS, "The anti-spoofing batch").catch((e: unknown) => {
        pending.delete(id);
        discard(e as Error);
        throw e as Error;
      });
    },
  };
}

/** The fallback path, on the main thread, for browsers that will not give us a module worker. */
async function buildInline(): Promise<AntiSpoofBackend> {
  const ort = (await import("onnxruntime-web")) as typeof Ort;
  configureSpoofOrt(ort, ORT_WASM_PATH);
  const session = await withTimeout(
    ort.InferenceSession.create(SPOOF_MODEL_URL, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }),
    READY_TIMEOUT_MS,
    "Loading the anti-spoofing model",
  );
  return {
    where: "inline",
    // The session is in this thread; there is no worker to lose, so it never dies on its own.
    dead: false,
    score: (patches) => runSpoofSession(ort, session, patches),
  };
}

/**
 * Score patches, as a live probability each. Throws AntiSpoofUnavailableError when the weights are
 * not on this machine — the caller reports the check as unmeasured and carries on.
 */
export async function scoreLive(patches: SpoofPatch[]): Promise<number[]> {
  const backend = await loadAntiSpoof();
  return backend.score(patches);
}
