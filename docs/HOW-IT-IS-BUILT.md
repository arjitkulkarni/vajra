# How VAJRA is built

*The engineering companion to [ARCHITECTURE.md](../ARCHITECTURE.md).*

`ARCHITECTURE.md` says **what** VAJRA is and **why** each part exists. `README.md` is the front door
— how to run it and what it claims. This document is for the person who has cloned the repository
and needs to know **how the code is actually put together**: what the boundaries are, which
decisions are load-bearing, and what a change has to respect.

Everything below describes code that exists in this repository today. Where something is a
deliberate simplification, it says so.

---

## 1. The shape of the repository

A pnpm workspace with three kinds of package:

```
apps/          things that run and do I/O
  gateway/       Trust Gateway — Fastify, the only writer of record
  web/           console + landing page — Next.js 15, three languages
  risk/          optional Python risk service (the gateway has an identical scorer built in)

packages/      pure logic, no I/O, unit-tested in isolation
  contracts/     zod schemas + inferred types shared across every boundary
  policy/        decide() — the decision engine as a pure function
  trust/         trust mathematics: gates, decay, recovery, asset trust, risk heuristics
  chain-logic/   the smart-contract logic, executed by BOTH runtimes

chaincode/     the Fabric adapter around chain-logic (5 contracts)
fabric/        scripts for a real two-org network
docs/          this file, ARCHITECTURE, BUILD-PLAN, demo script, pitch
```

`pnpm-workspace.yaml` includes `apps/*`, `packages/*` and `chaincode/*`.

### Packages ship source, not builds

Every workspace package points `main`, `types` and `exports` at `./src/index.ts`:

```jsonc
// packages/policy/package.json
"main": "./src/index.ts",
"types": "./src/index.ts",
"exports": { ".": "./src/index.ts" }
```

There is **no build step for the shared packages**. The gateway runs them through `tsx`; the web app
lists `@vajra/contracts` in `transpilePackages`. `pnpm build` in a package is an alias for
`tsc --noEmit` — it typechecks, it does not emit.

This is worth being explicit about because it is unusual, and it was chosen on purpose:

- a change to `packages/policy` is visible to the gateway on the next request, with no rebuild
- there is no `dist/` to go stale, and no chance of the gateway running last hour's decision engine
- the type boundary is enforced by `tsc` at the workspace level, not by a published artifact

The cost is that consumers must be able to compile TypeScript. Both of ours can. The Fabric
chaincode is the one exception — it has a real `tsc` build, because the Fabric peer runs plain
Node.

---

## 2. The rule that shapes everything: pure core, imperative shell

The single most important structural decision in the codebase:

> **Logic lives in `packages/`. I/O lives in `apps/`. Logic never imports I/O.**

`decide()` in `@vajra/policy` takes a plain object and returns a plain object. It does not read the
database, call the ledger, look at the clock (unless you hand it one), or throw for effect. The same
is true of `scoreRisk()`, `computeAssetTrust()` and every contract in `@vajra/chain-logic`.

```ts
// packages/policy/src/index.ts
export function decide(input: DecisionInput): DecisionOutput
```

The gateway's job is to *gather the facts*, call the pure function, and *record what happened*:

```ts
// apps/gateway/src/modules/access/service.ts — the trust loop for one request
// context → device → health → risk → policies → decide() → audit → (proof | step-up | approval) → incident rules
```

Three consequences follow, and they are the reason the pattern is worth the discipline:

1. **The decision engine is unit-testable with no database.** `packages/policy/src/index.test.ts`
   runs in milliseconds and covers the ordering of every gate.
2. **The same logic can run in two places.** See §5 — `chain-logic` executes inside Fabric *and*
   inside the gateway, because it depends on an interface, not on Fabric.
3. **An audit is a re-run.** Given the recorded inputs, `decide()` produces the recorded output.
   Time travel is not a reconstruction of a story; it is the same function over historical facts.

---

## 3. Five drivers, five environment variables

Every external dependency is behind an interface with at least two implementations, selected by one
environment variable, with a local default that needs nothing installed. This is what lets the whole
product run on a laptop with no Docker.

| Concern | Variable | Default (no setup) | Real option | Interface |
|---|---|---|---|---|
| Database | `DB_MODE` | `pglite` — embedded Postgres in a folder | `postgres` + `DATABASE_URL` | `DbHandle` |
| Ledger | `LEDGER_MODE` | `lite` — hash-chained blocks in Postgres | `fabric` | `LedgerDriver` |
| Blob storage | `STORAGE_MODE` | `fs` — content-addressed on disk | `ipfs`, `pinata` | `StorageDriver` |
| Risk scoring | `RISK_MODE` | `local` — in-process | `http` → `apps/risk` | function + probe |
| Narration | `ANALYST_MODE` | `template` — deterministic, offline | `claude` | function |

`apps/gateway/src/config.ts` is one zod schema over `process.env`. It is the *only* place that
reads the environment, it validates at boot, and it fails loudly:

```ts
const parsed = EnvSchema.safeParse(merged);
if (!parsed.success) throw new Error(`Invalid configuration: ${issues}`);
```

`loadConfig()` also takes overrides, which is how the e2e script boots a gateway in
`DB_MODE=memory` without touching your `.env`.

Each driver is a small interface. The ledger one, in full:

```ts
// apps/gateway/src/modules/ledger/types.ts
export interface LedgerDriver {
  readonly mode: "lite" | "fabric";
  submit(contract: ContractName, fn: string, args: string[]): Promise<SubmitResult>;
  evaluate(contract: ContractName, fn: string, args: string[]): Promise<unknown>;
  health(): Promise<{ ok: boolean; detail?: string }>;
  close(): Promise<void>;
}
```

Note the shape of the driver selection in `app.ts`: the Fabric driver is **dynamically imported**,
so the heavy `@hyperledger/fabric-gateway` and gRPC dependencies are never loaded in the default
path.

```ts
if (config.LEDGER_MODE === "fabric") {
  const { FabricLedger } = await import("./modules/ledger/fabric");
  ledger = new FabricLedger(config);
} else {
  ledger = new LiteLedger(dbHandle.db);
}
```

The database driver does the same for `pg` versus `@electric-sql/pglite`.

---

## 4. The gateway

### 4.1 One composition root

`apps/gateway/src/app.ts` exports `buildApp()`, and it is the only place where dependencies are
constructed and wired. It returns `{ app, ctx, close }`. Nothing else in the codebase calls a
constructor for a driver.

`AppContext` is the bag every module receives:

```ts
// apps/gateway/src/context.ts
export interface AppContext {
  config: Config;
  db: Db;              // drizzle handle
  dbHandle: DbHandle;  // ping/close, for health
  ledger: LedgerDriver;
  storage: StorageDriver;
  keys: SigningKeys;   // Ed25519 issuer key for proofs and VCs
  kek: Buffer;         // key-encryption key, derived from MASTER_KEK
  health: HealthService;
  outbox: OutboxWorker;
  log: FastifyBaseLogger;
}
```

There is no dependency-injection framework and no service locator. Modules are plain functions that
take `ctx` as their first argument:

```ts
export async function requestAccess(ctx: AppContext, session: Session, assetUid: string, ...)
export async function appendAudit(ctx: Pick<AppContext, "db">, input: AppendAuditInput, tx?: Db)
```

`appendAudit` taking `Pick<AppContext, "db">` is the house style for "this function only needs the
database" — it makes the dependency visible in the signature and keeps the function callable from
inside a transaction.

`server.ts` is deliberately thin: build the app, seed if the database is empty and `DEMO_MODE` is
on, start the outbox, listen, handle signals. Because `buildApp()` is separate from `server.ts`,
the test suite and the e2e script get a *real* gateway without a socket.

### 4.2 Modules, not layers

`apps/gateway/src/modules/` is organised by domain, not by technical layer — there is no
`controllers/`, `services/`, `repositories/` triple:

```
identity/    enrolment (the five verifications), sessions, VC issuance, nonces, attestation, revocation
policy/      the versioned policy store (decide() itself lives in packages/policy)
trust/       persisting trust events and recomputing scores
risk/        fact gathering + local/http scoring
access/      the request lifecycle, step-up, approvals
vault/       upload, encryption, content delivery, storage drivers
provenance/  passports, lineage, custody, the trust graph
proof/       Proof-of-Action build, sign, verify
incident/    detection, response ladder, timeline, evidence packages
audit/       the hash chain, time travel
ledger/      lite driver, fabric driver, outbox worker
analyst/     the LLM narrator (never on the decision path)
health/      dependency probes and simulated outages
demo/        seeding, scenario presets
```

Routes are one file — `src/routes/index.ts` — that maps HTTP to those module functions. It contains
no business logic: it validates, authenticates, calls one function, and returns.

### 4.3 Errors are typed and handled once

One error handler in `app.ts` translates four error families into the wire format:

| Thrown | Status | Wire `code` |
|---|---|---|
| `ApiError` (ours) | its own | its own |
| `ZodError` | 400 | `validation_failed` |
| `ChainError` (from chain-logic) | 409 | its own, e.g. `approver_is_requester` |
| anything else | 500 | `internal_error`, logged |

The response envelope is always `{ error: { code, message, details? } }`. The web client throws
`GatewayError` carrying that `code`, and the UI translates the code — not the message — into the
reader's language.

---

## 5. The chaincode, written once, executed twice

This is the part of the build most likely to be doubted, so it is worth showing plainly.

`@vajra/chain-logic` defines the world-state surface it needs, and nothing more:

```ts
export interface ChainState {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T): Promise<void>;
  history<T>(key: string): Promise<HistoryEntry<T>[]>;
  txId: string;
  timestamp: string;
}
```

Five contracts — `DIDRegistry`, `AssetPassport`, `PolicyRegistry`, `AuditTrail`, `IdentityVerification` — are written
against that interface, plus a dispatcher:

```ts
export async function invoke(state: ChainState, contract: ContractName, fn: string, args: string[]): Promise<unknown>
```

Two adapters implement `ChainState`:

- **`chaincode/vajra-cc/src/index.ts`** wraps `ctx.stub` — `getState`, `putState`,
  `getHistoryForKey`, `getTxID`, `getTxTimestamp`.
- **`apps/gateway/src/modules/ledger/lite.ts`** wraps three Postgres tables — `ledger_state`,
  `ledger_state_history`, `ledger_blocks`.

The `lite` driver seals each submission into a block:

```
txId      = sha256(number | prevHash | contract | fn | canonicalJson(args) | timestamp)
blockHash = sha256(prevHash | txId | sha256(result))
```

taken under `pg_advisory_xact_lock(4343)` so concurrent submissions cannot interleave block numbers.
`verifyChain()` recomputes the whole chain and reports the first broken block.

The claim this buys is precise, and the honest version of it is the one to make: **both runtimes
execute byte-identical rules**, because both import the same module. The two-person rule is enforced
by the contract, not by the API — a transfer whose approver is the requester is refused by
`AssetPassport` itself, in either runtime. What `lite` is *not* is consensus: it is one process
writing to one database, and `/v1/health` reports `mode: "lite"` so nobody can mistake it.

---

## 6. Every mutation writes through the audit chain

`appendAudit()` is the choke point. Nothing in the gateway changes state without an event.

```ts
payload_hash(n) = sha256(canonical_json(payload))
chain_hash(n)   = sha256(chain_hash(n-1) ∥ payload_hash(n))
```

Two implementation details carry weight:

**Canonical JSON.** `canonicalJson()` in `lib/crypto.ts` sorts object keys recursively before
serialising. Without it, two structurally identical payloads could hash differently depending on
insertion order, and the chain would be unverifiable by anyone but us.

**An advisory lock, not an optimistic retry.** `pg_advisory_xact_lock(4242)` serialises appends, so
`prevHash` is always the true tail. It costs concurrency on a single table; it buys a chain that
never forks.

Denials are events. So are step-ups, approvals, revocations and incident state changes. The audit
log is not a log of successes — it is the evidence, and a refused request is evidence.

### 6.1 Anchoring is asynchronous, via an outbox

Anchoring to a ledger inside a request would make every decision as slow as the slowest peer, and
would fail the request when the ledger is merely late. So the gateway uses the transactional outbox
pattern:

1. Inside the *same database transaction* as the fact, `enqueueLedger()` writes a row to
   `ledger_outbox`. If the transaction rolls back, so does the intent to anchor.
2. `OutboxWorker` polls (`OUTBOX_INTERVAL_MS`, default 500 ms), submits to the ledger, and patches
   the referencing row with `tx id`, `block`, `anchored_at`.
3. Deterministic chaincode rejections are marked `failed` and never retried — retrying a
   `ChainError` would just fail again. Transport failures retry with backoff.
4. The worker asks `isLedgerAvailable()` first, so a simulated outage stops the queue draining
   rather than burning retries.

Because anchoring happens *after* the response, two things need to be repaired when it lands. The
composition root wires exactly that:

```ts
outbox.onAnchored(async (refTable, refId) => {
  if (refTable === "audit_events")   await refreshProofsForAuditEvent(ctx, refId);
  if (refTable === "asset_versions") await recomputeAssetTrustForVersion(ctx, refId);
});
```

A certificate issued before its anchor existed gets re-signed with the transaction id; an asset
whose version has just been anchored gets its trust recomputed, because "anchored versions" is one
of the seven components of asset trust.

---

## 7. Fail-closed, implemented rather than asserted

`HealthService` holds one probe per dependency, caches results for 3 seconds, and supports simulated
outages when `DEMO_MODE` is on.

The policy engine takes health as an *input*, and refuses at the top of the pipeline:

```ts
// packages/policy/src/index.ts — step 1 of decide()
for (const dep of REQUIRED_DEPS[actionClass]) {
  const ok = input.health[dep] !== false;
  if (ok) checks.push(check); else fail(check, `dependency_down:${dep}`);
}
```

`REQUIRED_DEPS` escalates with the action class — a `view` needs the database; a `download` of a
high-sensitivity asset needs database, risk *and* ledger. So a stopped ledger does not take the
product down; it takes the *dangerous* actions down and leaves the safe ones working.

The risk path fails closed too, in two places. If the risk dependency is unavailable the gateway
substitutes the worst case rather than skipping the check:

```ts
if (!health.risk) risk = { score: 100, tier: "high", signals: ["risk_unavailable"] };
```

and a timeout in `RISK_MODE=http` forces the tier to `high` rather than defaulting to `low`. A
scorer that cannot answer must never make a request look safer.

---

## 8. The data layer

Drizzle ORM over Postgres, with 27 tables in one schema file (`src/db/schema.ts`). Migrations are
generated (`drizzle-kit generate`) into `apps/gateway/drizzle/` and **applied at boot** by
`createDb()`, for both drivers. There is no separate migrate step to forget before a demo.

`Db` is deliberately typed as the generic drizzle interface:

```ts
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
```

which is what makes `withTx(db, tx => ...)` work — a transaction is structurally the same type as
the database, so any module function that accepts `Db` can be called inside or outside a
transaction without a second code path.

Table groups, roughly: identity (`users`, `devices`, `credentials`, `liveness_nonces`,
`liveness_attestations`), trust (`trust_events`), policy (`policies`, `policy_versions`), assets
(`assets`, `asset_versions`, `asset_transfers`, `grants`), access (`access_requests`, `approvals`,
`break_glass_grants`), evidence (`audit_events`, `proof_certificates`, `incidents`,
`evidence_packages`), ledger (`ledger_outbox`, `ledger_blocks`, `ledger_state`,
`ledger_state_history`) and `demo_identities`.

---

## 9. Cryptography: what, where, and why

Every primitive comes from Node's built-in `crypto`, with base58/base32 encoders written by hand
because the standard library has neither. The only cryptographic dependency is `jose`, used for
JWTs — session tokens and the verifiable credential. `apps/gateway/src/lib/crypto.ts` is the rest of
the inventory.

| Purpose | Primitive | Notes |
|---|---|---|
| Identity keys | Ed25519 | generated **in the browser**, private key never leaves IndexedDB |
| DID format | `did:key` | base58btc over the multicodec-prefixed raw public key |
| Nonce signing | Ed25519 detached | single-use, TTL-bounded, replay-refused |
| Proof signing | Ed25519 | issuer key derived from `PROOF_SIGNING_SEED` |
| Sessions, VC | EdDSA JWT (`jose`) | `SESSION_TTL_MINUTES`, default 15 |
| Audit chain | SHA-256 | over canonical JSON |
| Blob encryption | AES-256-GCM | fresh data key per asset *version* |
| Key wrapping | AES-256-GCM | DEK wrapped by a KEK derived from `MASTER_KEK`, with AAD |
| Content address | CIDv1 raw, sha2-256 | so `fs` and `ipfs` agree on the identifier |

`canonicalJson()` is small but load-bearing: sorted keys, recursively, `undefined` dropped, `Date`
normalised to ISO. Every hash in the system goes through it, which is what lets a third party
recompute a chain hash or a certificate hash without our source code.

**What is stored, and what is not.** The user's private key is never uploaded: it is minted in the
browser as a non-extractable `CryptoKey` and only ever produces signatures. Face *matching* is never
uploaded either — the embedding comparison runs in the page, and what crosses the wire is a 0-100
confidence, not an embedding. The model doing the matching is
[AdaFace](https://github.com/mk-minchul/AdaFace) IR-50 (MS1MV2), run through `onnxruntime-web` in a
worker on a 112x112 crop aligned to the ArcFace five-point template; face-api's older 128-d
descriptor remains for the `consistency` liveness signal and as the fallback on a machine without
the AdaFace weights, and the capture UI names which one it used.

**The live AI check.** Six of the anti-spoof signals are hand-written physics — nose depth out of the
face plane, non-rigid micro-motion, blink duration, focus, chroma spread, one-identity consistency —
and their virtue is that each one names the attack it refuses. Their limit is the same thing: a
signal that measures blown highlights knows about blown highlights, and a face a model rendered is
not something a Laplacian variance was ever going to catch. So a seventh opinion runs beside them,
from a different kind of model:
[Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing)'s
MiniFASNetV2 (Apache-2.0), 1.7 MB, in a worker, on an 80x80 patch taken at the 2.7x crop scale it
was trained at, scored every 600 ms through the capture. The session reports the median live
probability over its frames.

Three things about it are worth stating plainly, because each was a decision rather than a default:

- **It is a gate, not a weight.** The six signals average into a confidence that moves up and down;
  this one answers whether a presentation attack is in front of the lens, and the answer has its own
  consequence. It is reported separately (`spoofCheck`), judged separately (`ANTISPOOF_MIN_LIVE`),
  and displayed separately.
- **The browser reports; the gateway decides.** The capture does not refuse on its own even when the
  model is certain — it signs, submits, and is refused server-side. A client that quietly declined to
  send would be the attacker's page choosing whether the attack gets recorded.
- **A missing model is unmeasured, not passed.** No weights on the device means no number, and the
  gateway records the absence rather than crediting it.

The preprocessing has a trap in it that is worth documenting where people will hit it: the model
takes `[0, 255]` BGR input, **not** the `[0, 1]` that every published description of it states —
upstream vendored torchvision's `to_tensor` and commented the `.div(255)` out. Fed `[0, 1]` the
network saturates and calls everything a spoof, confidently, including real faces. The verification
that established this, and the digest pin that keeps the downloaded file honest, are in
`apps/web/public/models/README.md`.

What *is* stored, deliberately, is the evidence a decision was made on: the employee ID card and the
single frame each face check was scored from. Both are AES-256-GCM encrypted under a per-capture data
key, addressed by content, and their SHA-256 plus both confidence scores are anchored on chain. That
is the trade the enrolment flow makes and it is worth naming: an administrator who approves someone
must be able to be shown, later, exactly what they approved, and a refused attempt is worth keeping
for the same reason. `/v1/stats` reports the true footprint — `faceChecks`, `faceChecksRefused`,
`faceImageBytesStored`, `faceImagesEncrypted` — instead of a zero that is no longer true.

The enrolment *template* (a 512-d AdaFace embedding, averaged over several frames of the live
capture) is kept
encrypted so a login can be scored against what was approved rather than against whatever that
browser happens to hold. It is returned to the browser at the start of a login, which is a real
disclosure: anyone who knows an employee ID can obtain that identity's template. Every such lookup is
written to the audit chain as `identity.login_started`.

---

## 10. The web app

Next.js 15 App Router, React 19, Tailwind v4, static-exported per locale.

### 10.1 The browser never gets the decision engine

`apps/web/package.json` depends on `@vajra/contracts` — and not on `@vajra/policy` or
`@vajra/trust`. That is a boundary, not an oversight: the client renders decisions, it does not make
them. Where the console needs to show a role's *normal* baseline for the effective-access matrix, it
uses a small mirror table in `src/lib/roles.ts` that says so in its header comment. The gateway
remains the authority.

### 10.2 Two design languages, on purpose

- **`src/components/ui.tsx`** — the editorial voice: display serif, 10px radii, generous spacing.
  The public site.
- **`src/components/console.tsx`** — the operational voice: 4px radii, hairline borders, dense rows,
  tabular numerals, monospace for anything a machine produced, colour reserved for state.

Console components take their labels as props and never call `useI18n()` themselves, which keeps
them locale-free and testable. Pages supply the strings.

The console is composed from a handful of primitives — `Panel`, `StatBand`, `DataTable`,
`EventStream`, `Drawer`, `FactorBreakdown`, `AccessMatrix`, `StepRail`, `LineageRail`,
`VerdictStamp` — plus two global behaviours: a ⌘K command palette over every entity ID, and an
`EntityProvider` drawer so an investigation can move sideways (event → actor → device → asset →
incident) without ever losing the page it started on.

### 10.3 Raw event types never reach the screen

The ledger records `access.decision`; the operator reads **ACCESS DENIED**. One module,
`src/lib/events.ts`, maps event type + payload to a headline key, a tone and a filter bucket, so the
same event reads identically in the overview stream, the activity page, the audit table and the
incident rail.

### 10.4 i18n is a typed dictionary, not a runtime lookup

`src/i18n/en.ts` is the source of truth; its shape *is* the `Dictionary` type:

```ts
type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> };
export type Dictionary = DeepString<typeof en>;
```

`hi.ts` and `kn.ts` are declared `: Dictionary`, so **a missing translation key is a compile error**.
`lookup()` returns the dotted path when a key is absent, so any gap that does slip through is
visible in review rather than silently blank.

The important half: the gateway returns **keys and parameters**, not sentences. A `DecisionTrace`
check carries `labelKey: "trace.hours"` and `params: { hour, start, end }`. The reasoning is
therefore rendered in whatever language the reader chose, and adding a language never touches the
backend.

### 10.5 Data fetching

There is no data-fetching library. `useAsync(fn, deps)` in `components/trust.tsx` is about twenty
lines: it tracks `{ data, loading, error }`, guards against setting state after unmount, and exposes
`reload()`. Every page composes a few of those. The session JWT lives in a cookie; the DID private
key lives in IndexedDB and never travels.

Pages avoid `useSearchParams()` and read `window.location.search` in a mount effect instead, so
every locale route stays statically prerenderable without a Suspense boundary.

---

## 11. How it is verified

```bash
pnpm typecheck   # every workspace project, strict, noUncheckedIndexedAccess
pnpm test        # unit tests: policy, trust, chain-logic, liveness geometry, AdaFace
                 # calibration, anti-spoof crop geometry, gateway invariants
pnpm e2e         # 87 assertions: the whole trust loop against a real gateway, driven with real
                 # AdaFace embeddings
pnpm build       # gateway typecheck + real Next production build
```

The unit tests cover the pure packages, which is exactly where the pure/impure split pays off —
`decide()` has no test doubles because it has nothing to double.

`pnpm e2e` (`apps/gateway/scripts/e2e.ts`) is the load-bearing one. It calls `buildApp()` with
`DB_MODE=memory` and the `lite` ledger, then drives the product through eight scenes with real HTTP
semantics and real cryptography — onboarding with a browser-equivalent key pair, a replayed nonce
that must be refused, a passport minted and anchored, an explainable ALLOW under 300 ms, a
two-person transfer where the requester is refused their own approval, an attack that opens an
incident and locks the session, a stopped ledger that denies a transfer and drains when it returns,
an evidence package that verifies, a tampered certificate that fails the hash check, a revocation
cascade, and a time-travel query.

It is the honest answer to "does it actually work", and it runs in seconds on a laptop with nothing
installed.

---

## 12. Conventions to follow when adding code

1. **Put logic in a package, I/O in an app.** If a new rule can be expressed as a pure function,
   it belongs in `packages/` with a unit test, not in a service.
2. **Cross a boundary only through `@vajra/contracts`.** If web and gateway need to agree on a
   shape, it is a zod schema there. Do not hand-copy an interface.
3. **Every mutation goes through `appendAudit()`.** If a change to state is worth making, it is
   worth being able to prove later.
4. **Anchor through the outbox, never inline.** `enqueueLedger()` inside the same transaction.
5. **Fail closed.** A dependency that cannot answer must make the request *less* permitted, never
   more. Substitute the worst case; never skip the check.
6. **Return keys, not sentences.** Anything a human will read gets a dictionary key and parameters.
7. **New dependency? Give it a driver, a default that needs no setup, a health probe, and one
   environment variable.** The product must still run on a bare laptop.
8. **Semantics never rely on colour alone.** Every state in the UI carries an icon and a word too.

---

## 13. Command reference

```bash
pnpm install
pnpm dev              # gateway :4000 + console :3000, in parallel
pnpm gateway          # gateway only  (tsx watch)
pnpm web              # console only  (next dev)

pnpm typecheck        # all workspace projects
pnpm test             # unit tests
pnpm e2e              # full trust loop, in-memory
pnpm build            # typecheck + production build

pnpm demo:reset       # rebuild identities, policies, assets, ledger from scratch
pnpm models:fetch     # 13 MB of face-api weights out of node_modules, plus AdaFace (174 MB, once)
                      # and the 1.7 MB anti-spoofing model (digest-pinned)

# inside apps/gateway
pnpm db:generate      # regenerate drizzle migrations after a schema change
```

---

## 14. What the build deliberately does not do

Stated here rather than discovered later:

- **`lite` is not consensus.** One process, one database, real hash-chained blocks and real
  chaincode logic — a development and fail-over driver. `/v1/health` says `mode: lite`.
- **The KEK is an environment variable.** Per-version data keys are wrapped correctly; the key that
  wraps them belongs in a KMS or HSM in production.
- **On-device face matching trusts the client.** A tampered browser could report any confidence it
  likes — but still needs the enrolled DID key on that device, and then still faces trust gates,
  step-up, two-person approval and the incident ladder. What makes the claim checkable rather than
  merely asserted is that the frame it was computed from is stored and anchored beside it, so an
  auditor can re-run the match over exactly those bytes. WebAuthn hardware co-signing is the
  hardening path, and it uses the same attestation format.
- **A login discloses the enrolment template.** `POST /v1/auth/login/start` returns the enrolled
  embedding for the employee ID it was given, because the match runs in the browser. Every lookup is
  audited; rate limiting and a pre-flight proof of key possession are the obvious hardening.
- **The pre-enrolment `/v1/onboard` path is DEMO_MODE-only.** It issues an active identity with no
  administrator in the loop, which is exactly what the enrolment flow exists to prevent, so outside
  DEMO_MODE it is refused.
- **Liveness is blink and head-pose.** It defeats printed photos and simple replay; real-time
  deepfake video is a roadmap item.
- **The audit chain serialises on an advisory lock.** Correct, and a bottleneck at a scale this
  build is not trying to reach.
- **Shared packages ship TypeScript source.** Fine for this monorepo; it would need a build step to
  be consumed by anything outside it.

---

*The CodePool · Dayananda Sagar University · Bengaluru*
