/**
 * The MiniFASNet inference worker.
 *
 * The graph is small — 1.7 MB, and a forward pass on an 80x80 patch is a couple of milliseconds —
 * so this worker is not here for the inference. It is here for the *build*: instantiating
 * onnxruntime's 27 MB wasm module takes a few hundred milliseconds, and paying that on the main
 * thread would stall the camera preview at exactly the moment the user has been asked to hold still.
 *
 * Everything is fetched from this origin; the worker makes no off-origin request.
 */
import * as ort from "onnxruntime-web";
import { configureSpoofOrt, runSpoofSession, type SpoofPatch } from "./antispoof-core";

type Incoming = { type: "init"; modelUrl: string; wasmPath: string } | { type: "score"; id: number; patches: SpoofPatch[] };

let session: ort.InferenceSession | null = null;

const post = (message: unknown) => (self as unknown as Worker).postMessage(message);

async function init(modelUrl: string, wasmPath: string): Promise<void> {
  configureSpoofOrt(ort, wasmPath);
  session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
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
      if (!session) throw new Error("The anti-spoofing session is not ready.");
      post({ type: "result", id: msg.id, scores: await runSpoofSession(ort, session, msg.patches) });
    } catch (e) {
      post({ type: "error", id: msg.id, error: (e as Error).message });
    }
  })();
};
