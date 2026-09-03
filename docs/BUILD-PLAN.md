# VAJRA — Complete Build Plan: Frontend, Backend, Blockchain, LLM & API Integration

Companion to [ARCHITECTURE.md](../ARCHITECTURE.md) (which owns the *why* and the backend design). This document owns the *how*: the product surface, the design system, internationalisation, the integration contracts, and the exact build order with verification gates.

---

## 1. Ground truth — what runs where

| Fact (dev machine, 2026-08-31) | Consequence |
|---|---|
| Node 24, pnpm 10, npm registry reachable | TypeScript monorepo, pnpm workspaces |
| Python 3.14 | Risk service written in FastAPI, **but** an identical TypeScript scorer ships inside the gateway (`RISK_MODE=local` default) so nothing depends on Python |
| **No Docker, no WSL** | Hyperledger Fabric cannot run on this machine. `LEDGER_MODE=lite` (hash-chained simulated blocks in Postgres) is the default; `LEDGER_MODE=fabric` uses the real Fabric Gateway SDK on a machine with Docker. Chaincode is written and unit-tested with a stub context |
| No Postgres server | `DB_MODE=pglite` (embedded Postgres, WASM, real SQL/JSONB) is the default; `DB_MODE=postgres` + `DATABASE_URL` for Neon/local Postgres. Same drizzle schema, same migrations |
| No IPFS node | `STORAGE_MODE=fs` (content-addressed local store, CID = sha256 multihash-style) default; `ipfs` (Kubo HTTP API) and `pinata` optional |
| No LLM key on file | `ANALYST_MODE=template` default (deterministic explainer); `ANALYST_MODE=claude` when `ANTHROPIC_API_KEY` is set by the user |
| No accounts may be borrowed from other projects | Every external service is opt-in via `.env`; nothing is pre-wired |

Result: `pnpm install && pnpm dev` runs the whole product on a bare laptop; each real service is a one-line env switch.

---

## 2. Product surface

```
/[locale]                       Landing — complete explanation of VAJRA
/[locale]/demo                  Guided demo (7 scenes) — each scene deep-links into the app
/[locale]/verify                Public verifier — paste a Proof-of-Action / evidence package
/[locale]/app                   Proof Dashboard (home of the product)
/[locale]/app/onboard           Live face + liveness → DID
/[locale]/app/vault             Assets table + upload
/[locale]/app/assets/[uid]      Asset Passport (trust score, versions & lineage, custody, graph)
/[locale]/app/access            Request an action → explainable decision → step-up
/[locale]/app/approvals         Manager inbox (two-person rule)
/[locale]/app/audit             Hash-chained timeline + on-chain proof
/[locale]/app/incidents         Incidents list
/[locale]/app/incidents/[id]    Attack replay, trust-decay chart, evidence package
/[locale]/app/timetravel        Historical state reconstruction
/[locale]/app/admin/policies    Policy versions (edit ⇒ new version)
/[locale]/app/admin/identities  Users, trust, devices, revoke
/[locale]/app/settings          Language, demo scenario controls, session
```

Locales: `en` (default), `hi` (हिन्दी), `kn` (ಕನ್ನಡ). Adding a locale = one JSON file.

---

## 3. Design system — "Ledger & Seal"

> **Superseded.** This section records the design system as it was planned, and the token names in
> it are still the ones the code uses — but every *value* has been re-cut twice since: once to
> "Blacklight" (a near-black ground) and now to **"Daylight"**, a white editorial ground with
> near-black used as a material for machine-made payloads and for editorial destinations. The live
> specification is the header comment of `apps/web/src/app/globals.css`, which is the only place
> the tokens are defined. Read this section for the *intent*; read that file for the *values*.

The brand is the *vajra*: the thunderbolt — decisive, indestructible. The visual language is **ledger paper and a brass seal**: warm paper surfaces, ink typography, one brass accent used like a stamp, and dark "console" panels wherever cryptographic material (hashes, DIDs, transactions, proofs) appears. No gradients-on-black, no glassmorphism, no purple glow.

### 3.1 Colour tokens

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#F6F3EC` | page background |
| `--paper-2` | `#EEE9DF` | alternate rows, wells, hover |
| `--paper-3` | `#E4DDCF` | pressed / selected |
| `--ink` | `#1B1F24` | primary text, headings |
| `--ink-2` | `#4B5158` | secondary text |
| `--ink-3` | `#8A9098` | muted labels, placeholders |
| `--line` | `#D9D2C4` | 1 px borders, dividers |
| `--brass` | `#B4832E` | the accent: primary buttons, active nav, seals, focus rings |
| `--brass-deep` | `#8C6420` | hover/pressed accent |
| `--brass-soft` | `#F3E7CC` | accent tint backgrounds |
| `--steel` | `#2E5C7A` | links, "verified" chips, trust |
| `--steel-soft` | `#DCE8F0` | steel tint |
| `--verdigris` | `#2F7A5C` | ALLOW, success, anchored |
| `--verdigris-soft` | `#D8EDE3` | success tint |
| `--saffron` | `#D9822B` | STEP-UP, warnings, elevated risk |
| `--saffron-soft` | `#FBE7D0` | warning tint |
| `--oxide` | `#A8402F` | DENY, danger, high risk, revoked |
| `--oxide-soft` | `#F4DAD5` | danger tint |
| `--console` | `#14181D` | dark panels for hashes/proofs/replay |
| `--console-2` | `#1E242B` | console elevated |
| `--console-text` | `#D8DEE5` | console body text |
| `--console-muted` | `#7F8A96` | console labels |
| `--console-accent` | `#E2B45A` | console highlight (brass on dark) |

Semantic mapping is fixed across the product: **green = allowed/anchored, saffron = step-up/elevated, oxide = denied/high, steel = verified identity/ownership, brass = action/attention.** Never use colour alone: every state has an icon and a word.

### 3.2 Typography

| Role | Font (Google Fonts via `next/font`) | Fallback |
|---|---|---|
| Display / headings | **Fraunces** (variable, optical size, `wght 500–700`) | Georgia, serif |
| Body / UI | **IBM Plex Sans** | system-ui, sans-serif |
| Cryptographic material, code, timelines | **IBM Plex Mono** | ui-monospace, monospace |

Scale (rem): 3.5 / 2.5 / 1.75 / 1.25 / 1.0 / 0.875 / 0.75. Body 16 px, line-height 1.6. Section labels are small caps tracking `0.08em` in `--ink-3`. Hashes always render in mono, truncated `9c4e…8f2a`, with a copy button and full value on hover/focus.

### 3.3 Layout, shape, depth

- 8 px spacing grid; containers 1200 px (landing) / full-bleed with 240 px left nav (app).
- Radius 6 px on controls, 10 px on cards, 0 px on console panels (they are "printouts").
- Borders 1 px `--line`; shadows only on dialogs and the step-up modal.
- A faint paper grain (`data:` SVG noise at 3 % opacity) on the landing hero only.

### 3.4 Motion — "basics to good", never decorative for its own sake

| Pattern | Spec |
|---|---|
| Reveal on scroll | `opacity 0→1, translateY 12px→0`, 480 ms, `cubic-bezier(.2,.7,.2,1)`, siblings stagger 60 ms (IntersectionObserver hook) |
| Count-up numbers | trust/risk scores animate 0→value over 700 ms with easing; tabular figures |
| DecisionTrace | check rows appear sequentially (80 ms apart); verdict "stamps" in: `scale 1.15→1, opacity 0→1`, 220 ms, with a 2 px brass ring |
| Liveness ring | SVG stroke-dashoffset progress; challenge steps tick with a 160 ms check-draw |
| Anchoring | pulsing dot (`anchoring`) → solid dot + "block #1042" (`anchored`) |
| Trust decay | line chart draws left→right (stroke-dasharray) on mount |
| Page transitions | none beyond a 120 ms fade; nav highlights slide (2 px brass bar) |
| Reduced motion | all of the above collapse to instant under `prefers-reduced-motion` |

Implementation: CSS keyframes + one `useReveal()` hook + rAF count-up. No animation library.

### 3.5 Readability rules (this is a B2B product, judges and auditors read it)

1. Every screen answers "what is this, what do I do here" in one sentence under the title.
2. Every verdict has a sentence, not just a chip: *"Denied because the device is untrusted and the request is outside working hours."*
3. Every cryptographic value has a plain-language label ("Ledger transaction", not "txid").
4. Empty states teach: the empty vault explains what an Asset Passport is and offers the demo file.
5. Tables have ≤ 7 columns; details live in a drawer.
6. Colour contrast ≥ 4.5:1 for text; focus rings visible (brass, 2 px).
7. Numbers, dates and relative times formatted with `Intl` in the active locale.

### 3.6 Component inventory (`apps/web/src/components`)

`AppShell` (nav, top bar, locale switcher, scenario badge) · `PageHeader` · `Card` · `Stat` · `Chip` (state chips) · `Button` (primary/secondary/ghost/danger) · `Field` (input/select/textarea) · `DataTable` · `Drawer` · `Dialog` · `Tabs` · `Timeline` · `HashValue` · `ConsolePanel` · `TrustGauge` · `ScoreBreakdown` · `DecisionTrace` · `PermissionStrip` · `LivenessCapture` (client) · `StepUpModal` (client) · `TrustGraph` (client) · `TrustDecayChart` · `Reveal` · `CountUp` · `LocaleSwitcher` · `ScenarioPicker` · `EmptyState` · `Toast`.

---

## 4. Internationalisation

- Route segment `/[locale]/…`; middleware picks the locale from the URL, then the `vajra_locale` cookie, then `Accept-Language`, else `en`.
- Dictionaries at `apps/web/src/i18n/{en,hi,kn}.json`, nested by page; the `en` file defines the type (`Dictionary`), other locales are checked against it at build time (missing keys fail the typecheck via a generated key list).
- `getDictionary(locale)` on the server, `useT()` on the client (context). Messages use ICU-style placeholders `{name}`; never concatenate strings.
- Numbers/dates via `Intl.NumberFormat` / `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` with the active locale.
- The gateway accepts `Accept-Language`; DecisionTrace labels are returned as **keys + params** and rendered by the client dictionary, so explanations translate too. LLM narratives are requested in the active locale.
- Fonts: Fraunces/Plex cover Latin; Devanagari and Kannada fall back to **Noto Sans Devanagari** / **Noto Sans Kannada** (loaded only for those locales).

---

## 5. Frontend architecture

- **Next.js 15 (App Router, React 19), TypeScript, Tailwind CSS v4** (tokens declared in CSS `@theme`), no state library, no component library.
- **Data layer:** `lib/api.ts` — typed client over `fetch` using the zod schemas from `packages/contracts`; base URL `NEXT_PUBLIC_GATEWAY_URL`. Session JWT in a cookie (`vajra_session`) set by the client after onboarding; sent as `Authorization: Bearer`. DID private key never leaves IndexedDB (`lib/did.ts`).
- **Demo scenario:** a `ScenarioPicker` sets an `X-Vajra-Demo-Context` header (`deviceId`, `ip`, `hour`, `geo`) — honoured by the gateway only when `DEMO_MODE=true`. This is how "attacker at 02:00 from Mumbai on a new device" is reproduced on one laptop.
- **Client components** (everything else is a server component or plain markup): `LivenessCapture`, `StepUpModal`, `TrustGraph`, `TrustDecayChart`, `DataTable` filters, forms, `Reveal`/`CountUp`.
- **Liveness:** `@vladmandic/face-api` (TensorFlow.js) loaded dynamically, models from `/models/` (fetched by `pnpm models:fetch`). `NEXT_PUBLIC_LIVENESS_MODE=faceapi|simulated` — simulated mode keeps the full cryptographic flow (key generation, nonce signing) and shows a visible **SIMULATED** badge; it exists for machines without a camera, never for the stage.
- **States:** every data view has loading (skeleton), empty (teaching), and error (with retry) states.
- **Security:** no secrets in the client; CSP-friendly (no inline eval); all external calls go to the gateway.

---

## 6. Page specifications

### 6.1 Landing (`/[locale]`)

| Section | Content | Motion |
|---|---|---|
| Header | wordmark, nav (How it works · Capabilities · Architecture · Demo), locale switcher, CTA *Open the demo* | sticky, hairline border on scroll |
| Hero | "Trust that travels with the asset." + one-line USP; two CTAs (*Start the live demo*, *Read the architecture*); a five-stage pipeline diagram `IDENTITY → TRUST → DECISION → ASSET → PROOF` | stages light up in sequence, then loop slowly |
| The problem | four cards from the deck: static passwords, deepfake face-ID, no proof of who touched a file, 120-hour audits, central biometric honeypots | reveal |
| How it works | five steps (Onboard, Vault, Request, Re-verify, Evidence) with one-line outcomes | reveal stagger |
| Capabilities | the five USPs, each with a micro-illustration (pure SVG) and a two-line explanation | reveal |
| Trust Firewall | the `PERSON + DEVICE + … → ALLOW / STEP-UP / DENY` diagram | inputs converge into the verdict |
| Explainable decision | a live-looking DecisionTrace mock cycling ALLOW / STEP-UP / DENY | rows tick in |
| Proof | a Proof-of-Action card with the five verification checks | checks tick |
| Architecture | six components and the on-chain/off-chain rule; link to ARCHITECTURE.md | — |
| Legacy vs VAJRA | comparison table (from the deck's impact slide) | — |
| Demo | the 7 scenes as a horizontal stepper; CTA into `/demo` | — |
| Footer | PS id, team, university, references | — |

### 6.2 Guided demo (`/[locale]/demo`)

A left rail with the seven scenes and a right pane that explains each scene, shows what to look for, and has a **Go** button deep-linking into the app page with the right scenario preset. Progress persists in `localStorage`. Scene 5 (fail closed) includes a **Simulate ledger outage** switch (gateway `DEMO_MODE` toggle) so it works without Docker.

### 6.3 App pages

| Page | Data | Key interactions |
|---|---|---|
| Dashboard | `/health`, counters, recent decisions | seven proof rows; dependency status dots |
| Onboard | `/onboard/start`, `/onboard/complete` | camera, challenge steps, DID reveal, "biometric stored: 0 bytes", copy DID |
| Vault | assets list, `POST /assets` | upload dialog (class, sensitivity, optional parent), trust column |
| Asset | passport, custody, lineage, graph | tabs; Why-score breakdown; Open / Download / Transfer buttons → access flow |
| Access | `POST /assets/:uid/request`, step-up | scenario strip; DecisionTrace; permission strip; proof link |
| Approvals | `/approvals`, decide | approve/reject with step-up |
| Audit | audit events, `/audit/:id/proof` | filters; Verify on chain drawer |
| Incidents | list, timeline, evidence | replay timeline; decay chart; generate/verify evidence; close |
| Verify | `/verify/proof`, `/verify/evidence` | paste JSON → five checks |
| Time-travel | `/timetravel` | timestamp + subject → state card |
| Policies | versions, create | JSON editor with validation; Analyst draft (optional) |
| Identities | users, revoke | revoke with step-up; cascade result |
| Settings | locale, scenario, session | — |

---

## 7. Backend (Trust Gateway) — module and endpoint list

Full design in ARCHITECTURE.md §3–§8. Implementation modules: `identity`, `policy`, `trust`, `risk`, `approvals`, `provenance`, `proof`, `incident`, `audit`, `vault`, `ledger`, `health`, `analyst` (LLM), `demo` (seed/reset/scenario). Fastify 5 + zod validation + OpenAPI at `/docs`. Drizzle ORM; PGlite or Postgres; migrations run at boot.

Modes (all in `.env`): `DB_MODE`, `LEDGER_MODE`, `STORAGE_MODE`, `RISK_MODE`, `ANALYST_MODE`, `DEMO_MODE`.

---

## 8. Blockchain integration

```
LedgerDriver { submit(contract, fn, args) → { txId, block }, evaluate(contract, fn, args), health() }
```

- **`lite` driver:** simulated blocks in Postgres — every submission becomes a transaction (`txId = sha256(contract|fn|args|prevBlockHash)`) sealed into a block with `blockNumber`, `prevBlockHash`, `blockHash`; queries run the same chaincode logic in-process. Tx ids and block numbers in the UI are therefore real hashes, not placeholders.
- **`fabric` driver:** `@hyperledger/fabric-gateway` over gRPC; identity/cert/key/TLS paths from env; submits to `vajrachannel`, chaincode `vajra-cc`.
- **Outbox worker:** polls `ledger_outbox` every 500 ms; at-least-once; on commit patches `fabric_tx_id`/`block` on the referencing row (`audit_events`, `asset_versions`, `asset_transfers`, `policy_versions`, `incidents`). Health of the driver feeds fail-closed.
- **Chaincode (`chaincode/vajra-cc`):** `fabric-contract-api`, four contracts (`DIDRegistry`, `AssetPassport`, `PolicyRegistry`, `AuditTrail`); unit-tested with an in-memory stub. `Transfer` refuses `approverDid === fromDid` on high-sensitivity assets.
- **`fabric/`:** scripts for a Docker/WSL2 machine — `network-up.sh`, `deploy-cc.sh`, `enroll-app-user.sh`, connection profile template.

---

## 9. LLM integration — the "Analyst" (never in the decision path)

The LLM narrates; it never decides. Three uses, all optional, all labelled *AI-generated summary*:

| Endpoint | Input | Output | Guardrail |
|---|---|---|---|
| `POST /v1/analyst/explain` | `{ kind: decision \| incident \| passport, id, locale }` | plain-language narrative in the locale | built from the DecisionTrace / timeline only; no free-form data |
| `POST /v1/analyst/query` | natural-language audit question | structured filter (`actorDid`, `assetUid`, `action`, `decision`, time range`) via tool-use JSON schema, executed by the gateway under the caller's role | LLM emits filters, never SQL; results scoped like any other read |
| `POST /v1/analyst/policy-draft` | NL description | a policy spec draft validated by zod | draft only; activation goes through the two-person policy flow |

- `ANALYST_MODE=template` (default): deterministic sentences from the same inputs — the demo never depends on a network call.
- `ANALYST_MODE=claude`: Anthropic SDK, model from `ANALYST_MODEL` (default the latest Sonnet), max 600 output tokens, temperature 0, 8 s timeout → falls back to template.
- Privacy: inputs contain DIDs, hashes, policy ids and signal names only — there is no biometric data anywhere to leak.

---

## 10. API integration map (web → gateway)

| Page | Endpoints |
|---|---|
| Onboard | `POST /v1/onboard/start`, `POST /v1/onboard/complete` |
| Vault | `GET /v1/assets`, `POST /v1/assets` |
| Asset | `GET /v1/assets/:uid/passport`, `/custody`, `/lineage`, `/graph` |
| Access | `GET /v1/me/permissions`, `POST /v1/assets/:uid/request`, `POST /v1/requests/:id/step-up`, `GET /v1/assets/:uid/content` |
| Approvals | `GET /v1/approvals`, `POST /v1/approvals/:id/decide` |
| Audit | `GET /v1/audit`, `GET /v1/audit/:id/proof` |
| Incidents | `GET /v1/incidents`, `GET /v1/incidents/:id/timeline`, `GET /v1/incidents/:id/evidence`, `POST /v1/incidents/:id/close` |
| Verify | `POST /v1/verify/proof`, `POST /v1/verify/evidence` |
| Time-travel | `GET /v1/timetravel` |
| Policies | `GET /v1/policies`, `POST /v1/policies/:key/versions` |
| Identities | `GET /v1/identities`, `POST /v1/identities/:did/revoke` |
| Dashboard | `GET /v1/health`, `GET /v1/stats` |
| Analyst | `POST /v1/analyst/*` |
| Demo | `POST /v1/demo/reset`, `POST /v1/demo/login` (seeded role sessions), `POST /v1/demo/outage` |

Errors are uniform: `{ error: { code, message, details? } }` with HTTP status; codes are dictionary keys so the UI translates them.

---

## 11. Build order and verification gates

| Gate | Deliverable | Verified by |
|---|---|---|
| G0 | Monorepo root, workspace, tsconfig, env example | `pnpm install` succeeds |
| G1 | `packages/contracts`, `packages/policy`, `packages/trust` | unit tests green |
| G2 | Gateway: db, audit chain, identity, vault, ledger-lite, policy+trust+risk, approvals, provenance, proof, incident, timetravel, analyst, demo | vitest integration tests on PGlite; `scripts/e2e.ts` runs the whole trust loop |
| G3 | Chaincode + tests; fabric scripts; risk service | chaincode tests green; risk service imports cleanly |
| G4 | Web: design system, i18n, AppShell, landing, demo guide | `next build` clean; pages render |
| G5 | Web: app pages wired to the gateway | manual flow through onboard → vault → access → approvals → audit → incidents → verify → timetravel |
| G6 | Docs: README, run instructions, env matrix | fresh clone runs with `pnpm i && pnpm dev` |

---

## 12. Definition of done (for this build)

- `pnpm install`, `pnpm test`, `pnpm build` succeed on a bare Windows/macOS/Linux laptop with no Docker.
- `pnpm dev` starts the gateway (embedded DB, lite ledger) and the web app; the landing page, guided demo and every app page work in `en`, `hi`, `kn`.
- The full trust loop runs end to end: onboard → passport → explainable decision → step-up → two-person approval → anchored audit → Proof VALID → incident replay → evidence VALID → time-travel → revocation cascade.
- Real Fabric, Postgres, IPFS and Claude are each one env switch away, with scripts and instructions.
