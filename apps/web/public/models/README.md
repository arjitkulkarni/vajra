# Face model weights

Run `pnpm models:fetch` from the repo root to put the weights VAJRA needs into this folder.

## The identity model

| model                      | size    | what it does                                     |
| -------------------------- | ------- | ------------------------------------------------ |
| `adaface_ir50_ms1mv2.onnx` | 174 MB  | AdaFace IR-50 — the 512-d embedding, the face match |

[AdaFace](https://github.com/mk-minchul/AdaFace) (Kim, Jain & Liu, CVPR 2022) is what the face
match actually runs on. It is trained with a quality-adaptive margin, which is why it holds up on
the low-quality, off-angle, badly-lit images an employee ID card and a real turnstile produce —
exactly where the older descriptor net fell over. It runs in the browser through
`onnxruntime-web`, in a worker, on a 112×112 crop aligned to the ArcFace five-point template.

It ships inside no dependency, so the fetch script downloads it once from Hugging Face and skips it
forever after. `pnpm models:fetch --skip-adaface` leaves it out; the app then falls back to the
face-api descriptor below, visibly labelled as such under the camera preview.

**Licensing:** the AdaFace code is MIT. The weights derive from the **MS1MV2** dataset, which
carries its own research-use terms — review them before any production deployment.

The `onnxruntime-web` wasm artefacts are copied out of `node_modules` into `../ort/` by the same
script, so nothing is fetched off-origin at runtime.

## The live AI check

| model                | size    | what it does                                        |
| -------------------- | ------- | --------------------------------------------------- |
| `minifasnet_v2.onnx` | 1.7 MB  | MiniFASNetV2 — presentation-attack detection         |

[Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) (Beijing
Mininglamp Vision Technology, **Apache-2.0**) — the `2.7_80x80_MiniFASNetV2` checkpoint. It is a
three-class classifier over an 80×80 patch: live, print attack, replay attack.

It answers a different question from the six passive liveness signals, which is why it runs beside
them rather than as a seventh one. Those signals are hand-written measurements — nose depth out of
the face plane, non-rigid micro-motion, blink duration, focus, chroma spread — and each refuses one
specific thing. This is a network trained end-to-end on real attacks, judging the whole scene: the
bezel of a phone, the edge of a print, the sheen of a screen. It generalises where a Laplacian
variance cannot, and a confident spoof verdict is escalated as a presentation attack rather than
folded into a score.

### Preprocessing — read this before changing anything

**Input is `[0, 255]`, not `[0, 1]`, and BGR, not RGB.**

Every published description of this model — including the Hugging Face card the file is downloaded
from — says to divide by 255. That is wrong, and it is wrong in the worst possible way: the
upstream repository vendored torchvision's `to_tensor` and **commented the `.div(255)` out of it**
(`src/data_io/functional.py`), so the weights were trained on raw 0-255 values. Fed `[0, 1]` the
network does not fail loudly. It saturates and returns roughly the same near-certain *spoof* for
every input, including genuine faces — an integration that trusted the documentation would ban
everybody, and would look like it was working while it did.

The crop matters as much as the scaling. The `2.7` in the checkpoint's name is the scale factor the
patch was trained at: the face box is grown 2.7× about its centre (capped so it still fits the
frame, slid back in rather than clipped at the edges), then resized to 80×80. The tell-tales live in
that surrounding context, so a tighter crop throws them away. `lib/antispoof.ts` ports the upstream
`CropImage._get_new_box` exactly, and `lib/antispoof.test.ts` pins it against rectangles produced by
the original Python.

### Provenance

`pnpm models:fetch` downloads a third party's ONNX conversion and **verifies its SHA-256 against a
pinned digest**, which the AdaFace download does not do. The difference is that AdaFace is published
by its own authors, while this is somebody's format conversion of somebody else's weights. The
pinned file is the one that was checked:

| | |
| --- | --- |
| upstream weights | `2.7_80x80_MiniFASNetV2.pth`, sha256 `a5eb02e1…bec0` |
| ONNX | `minifasnet_v2.onnx`, sha256 `d7b3cd9b…cc7b`, opset 11, exported by torch 2.2.2 |
| source | [`garciafido/minifasnet-v2-anti-spoofing-onnx`](https://huggingface.co/garciafido/minifasnet-v2-anti-spoofing-onnx) |

What "checked" means:

1. All 49 convolution layers in the ONNX equal the upstream `.pth` weights with their following
   BatchNorm folded in (float32 tolerance), and the final `BatchNorm1d` parameters are bit-identical.
   The graph is those weights, not another model wearing the name.
2. Its outputs match the upstream PyTorch pipeline to ~1e-9 on the sample images that repository
   ships, and reproduce that pipeline's published verdicts: `image_T1` live at 0.99, `image_F1` and
   `image_F2` spoof.
3. `onnxruntime-web` — the runtime the browser actually uses — returns the same logits as Python's
   ONNX Runtime on the same tensor.

If the bytes ever stop matching the digest, the fetch fails rather than installing a different model
into the path that decides whether somebody is locked out.

Upstream ships a second checkpoint, `4_0_0_80x80_MiniFASNetV1SE`, and its demo sums the two models'
softmax outputs. Only the 2.7 model has a published ONNX export, so only that one runs here. It
classifies all three upstream samples correctly on its own; the ensemble is a little more confident
on the attacks, not differently minded about them.

## The face-api nets

| net                  | size    | what it does                                     |
| -------------------- | ------- | ------------------------------------------------ |
| `ssd_mobilenetv1`    | 5.6 MB  | detector, accurate — the default                 |
| `tiny_face_detector` | 190 KB  | detector, fast — automatic fallback if slow      |
| `face_landmark_68`   | 360 KB  | 68 landmarks — liveness geometry, AdaFace alignment |
| `face_recognition`   | 6.4 MB  | 128-d descriptor — the `consistency` liveness signal, and the fallback face match |
| `face_expression`    | 330 KB  | the smile challenge                              |

~13 MB in total. These ship inside `@vladmandic/face-api`, so the fetch script copies them out of
`node_modules` with no network at all — it only falls back to downloading if the dependency is not
installed. Safe to run on venue Wi-Fi, or with none.

Nothing in this folder is committed.

Without any of it the app runs in `NEXT_PUBLIC_LIVENESS_MODE=simulated`, which keeps the whole
cryptographic path (key generation, nonce signing, server verification) and shows a SIMULATED badge.

A missing `minifasnet_v2.onnx` on its own is not that case: the passive signals and the face match
carry on exactly as before, and the live AI check reports itself **unmeasured**, which the gateway
records as unmeasured and never as a pass.
