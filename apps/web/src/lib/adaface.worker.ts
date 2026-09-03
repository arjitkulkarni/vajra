/**
 * The AdaFace inference worker.
 *
 * The backbone is a large graph and a forward pass costs hundreds of milliseconds on a laptop CPU.
 * Both of those belong off the thread that is drawing the camera overlay, so the whole of
 * onnxruntime lives in here and the main thread only ever posts aligned 1x3x112x112 tensors across.
 *
 * The weights are fetched by hand rather than handed to `InferenceSession.create(url)` purely so the
 * download can be reported as a ratio — nobody should watch an unbounded spinner for a model this
 * size. Everything is fetched from this origin; the worker makes no off-origin request.
 */
import * as ort from "onnxruntime-web";
import { configureOrt, runSession, type AlignedFace } from "./adaface-core";

type Incoming =
  | { type: "init"; modelUrl: string; wasmPath: string }
  | { type: "embed"; id: number; faces: AlignedFace[] };

let session: ort.InferenceSession | null = null;

const post = (message: unknown, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(message, transfer ?? []);

/** Stream the graph in, reporting progress, so the UI can show a real bar. */
async function fetchWeights(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching the AdaFace weights.`);
  const total = Number(res.headers.get("content-length") ?? "0");
  // No body reader and no length: take the whole thing and report a single step.
  if (!res.body || !total) {
    const buffer = new Uint8Array(await res.arrayBuffer());
    post({ type: "progress", ratio: 1 });
    return buffer;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let announced = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const ratio = Math.min(1, received / total);
    // One message per whole percent; a message per chunk is thousands of postMessage calls.
    if (ratio - announced >= 0.01) {
      announced = ratio;
      post({ type: "progress", ratio });
    }
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  post({ type: "progress", ratio: 1 });
  return out;
}

async function init(modelUrl: string, wasmPath: string): Promise<void> {
  configureOrt(ort, wasmPath);
  const weights = await fetchWeights(modelUrl);
  session = await ort.InferenceSession.create(weights, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  post({ type: "ready" });
}

self.onmessage = (event: MessageEvent<Incoming>) => {
  const msg = event.data;
  if (msg.type === "init") {
    void init(msg.modelUrl, msg.wasmPath).catch((e: unknown) => post({ type: "failed", error: (e as Error).message }));
    return;
  }
  void (async () => {
    try {
      if (!session) throw new Error("The AdaFace session is not ready.");
      const embeddings = await runSession(ort, session, msg.faces);
      post({ type: "result", id: msg.id, embeddings }, embeddings.map((e) => e.buffer as ArrayBuffer));
    } catch (e) {
      post({ type: "error", id: msg.id, error: (e as Error).message });
    }
  })();
};
