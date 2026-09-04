# VAJRA

**A Cryptographic Trust Layer for High-Value Digital Assets**
*Identity · Ownership · Access · Provenance · Evidence*

> VAJRA doesn't just control who can access an asset — it proves who accessed it, why they were allowed, what they did, and whether the asset can still be trusted.

Smart India Hackathon 2026 · PS **SIH26125** (Blockchain-Based Secure Platform for Identity, Access Control, and Digital Asset Management) · Theme: Blockchain & Cybersecurity · Team **The CodePool**, Dayananda Sagar University.

---

## Run it

No Docker. No database server. No accounts.

```bash
pnpm install
pnpm dev
```

- Gateway → http://localhost:4000 (`/v1/health`)
- Console → http://localhost:3000

On first boot the gateway creates an embedded Postgres, runs the migrations, and seeds four
identities, seven policies and two assets. The console opens on the landing page; **Start the live
demo** walks the seven scenes.

Optional, before a real demo:

```bash
pnpm models:fetch     # 13 MB of face-api weights out of node_modules, plus the 174 MB AdaFace
                      # backbone and the 1.7 MB anti-spoofing model, downloaded once.
                      # `--skip-adaface` leaves the big one out.
pnpm demo:reset       # rebuild identities, policies, assets and the ledger from scratch
```

The face match itself is [AdaFace](https://github.com/mk-minchul/AdaFace) IR-50 — a 512-d embedding
computed in the browser, in a worker, on a crop aligned to the ArcFace five-point template. No frame
and no embedding is uploaded during a *check*: the comparison runs on-device and only a 0-100
confidence is sent. The enrolment template is a deliberate exception — it is registered at signup so
a login can be scored against what an administrator actually approved, and it is encrypted at rest
and handed back only to the browser doing the login.

Alongside the six hand-written anti-spoof signals runs a second, independent opinion: the live AI
check, [Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing)'s
MiniFASNetV2, also in the browser. The six signals are physics — is the nose out of the face plane,
do the brows move independently, is the chroma spread what a screen produces — and each one refuses
one specific thing. The model is a classifier trained on real presentation attacks that judges the
whole scene, so it catches what a hand-written measurement was never written for: the well-shot
replay, the phone held up to the lens, the face a model rendered.

It is not another number in the composite. A capture the model calls an attack is refused **and**
escalated: the gateway opens an S3 incident, which locks every session on that identity, expires its
content URLs and revokes its temporary grants. The identity itself is not revoked — that stays an
administrator's decision, made against the incident. Deliberately, the browser does not refuse on its
own: it signs and submits anyway, because a client that quietly declined to send would keep the
attack out of the record.

Without the model weights the app runs in simulated-liveness mode: the entire cryptographic path —
key generation, nonce signing, server-side verification — is unchanged, and a visible **SIMULATED**
badge says so. Without AdaFace specifically, the match falls back to the older face-api descriptor
and says which net it used under the camera preview. Without the anti-spoofing model, the AI check
reports itself unmeasured — which the gateway records as unmeasured, never as a pass.

## Verify it

```bash
pnpm test    # policy, trust, chaincode logic, liveness geometry, AdaFace calibration,
             # anti-spoof crop geometry, gateway invariants (117 unit tests)
pnpm e2e     # 87 assertions covering the full trust loop, end to end
```

`pnpm e2e` is the honest answer to "does it actually work". It runs the real gateway against an
in-memory database and asserts every claim VAJRA makes on stage:

```
Scene 1 — Onboard              DID issued, replayed nonce refused, trust starts conservative
Scene 2 — Vault                passport minted, anchored, a renamed copy recognised as the original
Scene 3 — Normal access        ALLOW in <300 ms, explained, Proof-of-Action issued, link single-use
Scene 3b — Two-person rule     requester cannot approve their own transfer; the ledger records both
Scene 4 — Attack               risk 100, DENY with reasons, incident opened, session locked
Scene 5 — Fail closed          ledger stopped → transfer denied; anchors drain when it returns
Scene 6 — Attack replay        ordered timeline, trust decay, evidence package verifies
Scene 7 — Proof + time travel  five checks pass; a tampered certificate fails the hash check
Scene 8 — Revocation cascade   one click, seven cascaded effects, next request denied
```

## What's here

```
apps/
  gateway/   Trust Gateway — every write, every decision, every proof (Fastify + TypeScript)
  web/       The console and landing page (Next.js 15, three languages)
  risk/      Optional Python risk service (the gateway has an identical scorer built in)
packages/
  contracts/    zod schemas shared by web and gateway — the two can never drift
  policy/       decide() as a pure function, unit-tested with no I/O
  trust/        trust mathematics: decay, recovery, asset-trust breakdown, risk heuristics
  chain-logic/  the smart-contract logic, executed by BOTH the Fabric chaincode and the lite ledger
chaincode/vajra-cc/   the Fabric adapter around chain-logic (4 contracts)
fabric/               scripts and instructions for a real two-org network
docs/                 ARCHITECTURE, BUILD-PLAN, demo script, pitch notes
```

## How it works

Five stages, each leaving evidence:

```
IDENTITY  →  TRUST  →  DECISION  →  ASSET  →  PROOF
```

**Identity.** Signing up means an employee ID card, a live face check and an administrator's
decision — five verifications in that order, and the same five again on every sign-in: the employee
ID, the ID document, the face-match confidence, the liveness composite — which the live AI check can
fail on its own — and an Ed25519 signature over a single-use server nonce. The key pair is generated in the browser and never leaves it; face
matching and the anti-spoof signals are computed on-device, so what crosses the wire is a confidence
score, not an embedding. The ID card and the frame each check was scored from *are* kept —
encrypted per capture, addressed by content, hashed onto the ledger — because an approval nobody can
re-examine is not evidence.

**Trust ≠ risk.** Risk answers *how suspicious is this request* (per request, from named signals).
Trust answers *how trustworthy is this identity, device or asset right now* (persistent, decaying,
recovering). Both are evaluated, and both are shown. Effective permissions are
`rolePermissions ∩ trustGates(currentTrust)` — so when trust drops, privileges shrink on screen.

**Decision.** `decide()` is a pure function: fail-closed gate → identity → RBAC → explicit denies →
ABAC → trust gates → risk overlay → approval overlay. It returns a `DecisionTrace` — every check it
ran, in order, with the values that drove it. That trace is what the UI renders, what the auditor
reads months later, and what the Proof-of-Action certificate embeds.

**Asset.** Files are hashed, encrypted (AES-256-GCM, per-version key), and stored by content address.
Only the hash reaches the ledger. Each asset carries a passport: ownership, versions, lineage, chain
of custody, and a trust score with a seven-part breakdown you can interrogate. Identical bytes
uploaded under a new name resolve to the asset they already are.

**Proof.** Audit events are hash-chained (`chain_hash(n) = sha256(chain_hash(n−1) ∥ payload_hash(n))`)
and anchored on the ledger. A Proof-of-Action is self-contained JSON: re-hash it, check the issuer
signature, recompute the chain link, ask the ledger, match the policy hash. Five checks, and none of
them require trusting our database.

Full design: [ARCHITECTURE.md](ARCHITECTURE.md). How the code is put together:
[docs/HOW-IT-IS-BUILT.md](docs/HOW-IT-IS-BUILT.md). Build plan: [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md).

## Switching on the real thing

Every external service is one environment variable, and each has a local default so a bare laptop
runs the whole product.

| Variable | Default | Real option |
|---|---|---|
| `DB_MODE` | `pglite` (embedded Postgres) | `postgres` + `DATABASE_URL` (Neon, RDS, anything) |
| `LEDGER_MODE` | `lite` (hash-chained blocks in Postgres) | `fabric` → [fabric/README.md](fabric/README.md) |
| `STORAGE_MODE` | `fs` (content-addressed, real CIDv1) | `ipfs` (Kubo) or `pinata` |
| `RISK_MODE` | `local` (in-process scorer) | `http` → [apps/risk](apps/risk) |
| `ANALYST_MODE` | `template` (deterministic, offline) | `claude` + your own `ANTHROPIC_API_KEY` |

Copy `.env.example` to `.env` and fill in only what you want to change. Generate your own secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The `lite` ledger deserves a word of honesty: it executes **the same chaincode logic** as the Fabric
deployment (both import `@vajra/chain-logic`), sealed into hash-chained blocks with real transaction
hashes. It is a development and fail-over driver, not a consensus network, and `/v1/health` says so.
The two-person rule is enforced identically in both — the ledger itself refuses a transfer whose
approver is the requester.

## Deploy it

Two hosts, because the halves are different shapes. The web app is a Next.js build and goes to
Vercel; the gateway is a process — listener, outbox worker, embedded Postgres, asset store — and
goes to Render from the blueprint in [render.yaml](render.yaml), or to any host that runs Node. The
two URLs point at each other: `NEXT_PUBLIC_GATEWAY_URL` on the web side, `WEB_ORIGIN` on the
gateway's. Both sides step by step, including what the free tier forgets between naps:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## The LLM, and where it is not

The Analyst narrates; it never decides. It turns a `DecisionTrace` into plain language, an incident
into a summary, an auditor's question into a structured filter, and a description into a policy
*draft* that still needs a human to activate. It is off the decision path entirely — pull the plug and
every access decision is unchanged. `ANALYST_MODE=template` (the default) produces deterministic
sentences with no network call, so a demo never depends on an API being up.

## Three languages

English, हिन्दी and ಕನ್ನಡ, at `/en`, `/hi`, `/kn`. Decision explanations translate too: the gateway
returns dictionary *keys and parameters*, not sentences, so the UI renders the reasoning in whatever
language the reader has chosen. Adding a language is one file — and the typecheck fails if a key is
missing.

## Known limits

Said plainly, because a demo that hides them is worse than one that doesn't:

- **On-device face matching trusts the client.** A tampered browser could skip the match — but it
  still needs the enrolled DID key on that device, and then faces trust gates, step-up, two-person
  approval and the incident ladder. WebAuthn hardware co-signing is the hardening path and uses the
  same attestation format.
- **Liveness is blink and head-pose.** It defeats printed photos and simple replay. Real-time deepfake
  video defence is a roadmap item, and we say so rather than claim otherwise.
- **The KEK lives in an environment variable.** Per-version data keys are wrapped properly; a KMS or
  HSM is the production answer.
- **`lite` is not consensus.** See above.

---

*The CodePool · Dayananda Sagar University · Bengaluru*
