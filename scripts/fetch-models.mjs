#!/usr/bin/env node
/**
 * Put the face model weights VAJRA needs into apps/web/public/models.
 *
 * The @vladmandic/face-api package ships the weights, so the normal path is a local copy with no
 * network at all — safe to run on venue Wi-Fi, or with no Wi-Fi. Only if the package is missing do
 * we fall back to downloading from the upstream repo.
 *
 * Five face-api nets, ~13 MB:
 *   ssd_mobilenetv1     detector, accurate       (default)
 *   tiny_face_detector  detector, fast           (automatic fallback on slow machines)
 *   face_landmark_68    68-point landmarks       (liveness geometry, and AdaFace alignment)
 *   face_recognition    128-d descriptor         (the `consistency` liveness signal, and the
 *                                                 fallback face match when AdaFace is absent)
 *   face_expression     expression head          (the smile challenge)
 *
 * Plus the identity model itself, which is what the face match actually runs on:
 *   adaface_ir50_ms1mv2.onnx   AdaFace IR-50, 512-d embedding, ~174 MB
 *
 * And the live AI check that runs beside the passive signals:
 *   minifasnet_v2.onnx         MiniFASNetV2 anti-spoofing, 3-class, ~1.7 MB
 *
 * AdaFace ships inside no dependency, so it is downloaded from Hugging Face the first time and
 * skipped forever after. `--skip-adaface` leaves it out: the app then falls back to the face-api
 * descriptor, visibly labelled as such in the capture UI. onnxruntime-web's wasm artefacts are
 * copied out of node_modules alongside it, so nothing is fetched off-origin at runtime.
 *
 * Without any of this the web app runs in NEXT_PUBLIC_LIVENESS_MODE=simulated, which keeps the whole
 * cryptographic path (key generation, nonce signing, server verification) and shows a SIMULATED badge.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NETS = ["ssd_mobilenetv1", "tiny_face_detector", "face_landmark_68", "face_recognition", "face_expression"];
const BASE = "https://raw.githubusercontent.com/vladmandic/face-api/master/model";

/**
 * AdaFace IR-50 trained on MS1MV2, exported to ONNX from the official checkpoint published at
 * https://github.com/mk-minchul/AdaFace. The AdaFace code is MIT; the weights derive from MS1MV2,
 * whose dataset licence is research-use — review it before any production deployment.
 */
const ADAFACE_FILE = "adaface_ir50_ms1mv2.onnx";
const ADAFACE_URL = `https://huggingface.co/globalnebula/adaface-ir50-ms1mv2-onnx/resolve/main/${ADAFACE_FILE}`;
const ADAFACE_MIN_BYTES = 150 * 1024 * 1024;

/**
 * Silent-Face-Anti-Spoofing's MiniFASNetV2, trained at a 2.7x crop on 80x80 patches, exported to
 * ONNX. Apache-2.0, from Beijing Mininglamp Vision Technology:
 * https://github.com/minivision-ai/Silent-Face-Anti-Spoofing
 *
 * This one is pinned by digest, which AdaFace above is not, and the difference is worth stating.
 * AdaFace is published by its own authors; this file is a third party's format conversion of
 * somebody else's weights, and "the ONNX on that Hugging Face repo" is not something anyone can
 * verify after the fact. The digest is: it names the exact file whose initialisers were checked
 * layer by layer against the upstream 2.7_80x80_MiniFASNetV2.pth (sha256 a5eb02e1...bec0), and
 * whose outputs were checked against the upstream pipeline on the sample images that repository
 * ships. If the bytes ever stop matching, the download fails rather than quietly installing a
 * different model into the path that decides whether somebody is locked out.
 * See apps/web/public/models/README.md.
 */
const SPOOF_FILE = "minifasnet_v2.onnx";
const SPOOF_URL = `https://huggingface.co/garciafido/minifasnet-v2-anti-spoofing-onnx/resolve/main/${SPOOF_FILE}`;
const SPOOF_SHA256 = "d7b3cd9ba8a7ceb13baa8c4720902e27ca3112eff52f926c08804af6b6eecc7b";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * The onnxruntime-web artefacts the AdaFace worker loads. Copied out of node_modules rather than
 * pulled from a CDN so a demo on venue Wi-Fi — or no Wi-Fi — behaves the same as one at a desk.
 *
 * These two are exactly what the default `onnxruntime-web` entry point requests at runtime; the
 * non-jsep pair beside them in dist is another 14 MB this build never asks for. If the import in
 * lib/adaface.ts ever changes to a different ort entry point, this list changes with it — a missing
 * artefact is a runtime failure with no error message.
 */
const ORT_FILES = ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"];

const skipAdaFace = process.argv.includes("--skip-adaface");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "apps/web/public/models");
await mkdir(dir, { recursive: true });

/** The package's own model folder, when the dependency is installed. */
function packageModelDir() {
  for (const from of [path.join(root, "apps/web/package.json"), path.join(root, "package.json")]) {
    try {
      const require = createRequire(from);
      return path.join(path.dirname(require.resolve("@vladmandic/face-api/package.json")), "model");
    } catch {
      /* try the next resolution root */
    }
  }
  return null;
}

const source = packageModelDir();
let names = [];
if (source) {
  const all = await readdir(source).catch(() => []);
  names = all.filter((f) => NETS.some((net) => f.startsWith(`${net}_model`)));
}
// No package on disk: fall back to the canonical single-shard file names upstream publishes.
if (names.length === 0) names = NETS.flatMap((net) => [`${net}_model-weights_manifest.json`, `${net}_model.bin`]);

const present = async (file) => {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
};

let copied = 0;
let downloaded = 0;
let skipped = 0;
for (const name of names) {
  const target = path.join(dir, name);
  if (await present(target)) {
    skipped += 1;
    console.log(`  · ${name} (already present)`);
    continue;
  }
  if (source && (await present(path.join(source, name)))) {
    await copyFile(path.join(source, name), target);
    copied += 1;
    console.log(`  → ${name} (copied from node_modules)`);
    continue;
  }
  process.stdout.write(`  ↓ ${name} … `);
  try {
    const res = await fetch(`${BASE}/${name}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(target, Buffer.from(await res.arrayBuffer()));
    downloaded += 1;
    console.log("ok");
  } catch (e) {
    console.log(`failed (${e.message})`);
    process.exitCode = 1;
  }
}

// ─── onnxruntime-web's wasm, next to the model that needs it ─────────────────

const ortDir = path.join(root, "apps/web/public/ort");
// `require.resolve` is no use here: onnxruntime-web does not expose its own package.json through
// `exports`, so the install is found by looking where either linker would have put it.
const ortSource = await (async () => {
  for (const base of [path.join(root, "apps/web/node_modules"), path.join(root, "node_modules")]) {
    const candidate = path.join(base, "onnxruntime-web/dist");
    if (await present(path.join(candidate, ORT_FILES[0]))) return candidate;
  }
  return null;
})();

if (ortSource) {
  await mkdir(ortDir, { recursive: true });
  for (const name of ORT_FILES) {
    const target = path.join(ortDir, name);
    if (await present(target)) {
      skipped += 1;
      continue;
    }
    if (!(await present(path.join(ortSource, name)))) continue;
    await copyFile(path.join(ortSource, name), target);
    copied += 1;
    console.log(`  → ort/${name} (copied from node_modules)`);
  }
} else {
  console.log("  · onnxruntime-web is not installed; run `pnpm install` before the AdaFace step.");
}

// ─── AdaFace ─────────────────────────────────────────────────────────────────

const adaTarget = path.join(dir, ADAFACE_FILE);
const adaSize = await stat(adaTarget).then((s) => s.size, () => 0);
if (adaSize >= ADAFACE_MIN_BYTES) {
  skipped += 1;
  console.log(`  · ${ADAFACE_FILE} (already present)`);
} else if (skipAdaFace) {
  console.log(`  · ${ADAFACE_FILE} skipped (--skip-adaface); the face match falls back to face-api.`);
} else {
  // A partial file from an interrupted run would pass a naive existence check and then fail to parse
  // as a graph in the browser, so it is written aside and only moved into place once it is whole.
  const partial = `${adaTarget}.partial`;
  process.stdout.write(`  ↓ ${ADAFACE_FILE} (~174 MB, once) … `);
  try {
    const res = await fetch(ADAFACE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < ADAFACE_MIN_BYTES) throw new Error(`short read (${bytes.length} bytes)`);
    await writeFile(partial, bytes);
    await rename(partial, adaTarget);
    downloaded += 1;
    console.log("ok");
  } catch (e) {
    await rm(partial, { force: true }).catch(() => {});
    console.log(`failed (${e.message})`);
    console.log("    The app will fall back to the face-api descriptor, labelled as such in the UI.");
  }
}

// ─── the anti-spoofing model ─────────────────────────────────────────────────

const spoofTarget = path.join(dir, SPOOF_FILE);
const spoofDigest = await readFile(spoofTarget).then(sha256, () => null);
if (spoofDigest === SPOOF_SHA256) {
  skipped += 1;
  console.log(`  · ${SPOOF_FILE} (already present)`);
} else {
  if (spoofDigest) console.log(`  ! ${SPOOF_FILE} is on disk but is not the pinned model; replacing it.`);
  process.stdout.write(`  ↓ ${SPOOF_FILE} (1.7 MB, once) … `);
  try {
    const res = await fetch(SPOOF_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const digest = sha256(bytes);
    // Refuse rather than install. This model's whole job is to decide whether a session is banned,
    // and a file that is not the one that was verified has no business making that call.
    if (digest !== SPOOF_SHA256) throw new Error(`digest mismatch (got ${digest})`);
    await writeFile(spoofTarget, bytes);
    downloaded += 1;
    console.log("ok");
  } catch (e) {
    console.log(`failed (${e.message})`);
    console.log("    The live AI check will report itself unmeasured; the six passive signals are unaffected.");
  }
}

console.log(`\n${copied} copied, ${downloaded} downloaded, ${skipped} already present → ${dir}`);
if (process.exitCode) {
  console.log("Some files are missing. Run `pnpm install` first — the weights ship inside @vladmandic/face-api.");
  console.log("Until then the app runs with NEXT_PUBLIC_LIVENESS_MODE=simulated.");
}
