# VAJRA — 5-Minute Demo Run-of-Show

Two laptops on stage if possible: **L1** (presenter, normal user + admin views), **L2** (the "attacker" — same user account, different device, VPN/IP override). Fabric, gateway, risk, web all on L1. Projector shows L1; L2 is only glanced at.

Before walking on: `pnpm demo:reset` · Fabric up · `GET /health` all green on the Proof Dashboard · camera permission pre-granted · face-api models cached · backup screen recording on a USB stick.

Reset state: users `engineer@`, `manager@`, `auditor@`, `admin@` seeded; policies POL-001 (view: allow), POL-009 (download HIGH: step_up), POL-011 (transfer HIGH: require_approval by manager); asset `DRDO_ENGINE_DESIGN_V1.cad` NOT yet uploaded (scene 2 creates it live).

---

## Scene 1 — Create identity (0:00 → 0:30)

**Do:** `/onboard` → volunteer looks at the camera → blink → turn left → DID card appears.

**Screen:** `Identity verified ✓ · DID created ✓ · did:key:z6Mk… · Biometric stored: 0 bytes`. Open the browser network tab for one beat: the only POST body is `{ did, publicKeyJwk, signature, deviceFingerprintHash }`.

**Say:** "Nothing about their face ever left this laptop. The server received a public key and a signature. There is no biometric database to breach."

## Scene 2 — Create a sensitive asset (0:30 → 1:00)

**Do:** `/vault` → upload `DRDO_ENGINE_DESIGN_V1.cad`, class *design*, sensitivity *HIGH*.

**Screen:** Asset Passport — `Owner ✓ · SHA-256 ✓ · Anchored on Fabric tx 3b9f… · Trust score 100 [Why?]`. Click *Why?* → the breakdown (origin 20, owner 20, versions 15, …).

**Say:** "This file now has a passport. It carries its own trust history, and the ledger holds its fingerprint."

## Scene 3 — Normal access (1:00 → 1:30)

**Do:** `/access` as the engineer on the trusted laptop, action *download*.

**Screen:** DecisionTrace panel — `✓ Identity · ✓ Role: engineer → download · ✓ Trusted device · ✓ Normal location · ✓ Working hours · Risk 12 / low` → **ALLOW** · latency `184 ms` · `Proof-of-Action PoA-…-0431 issued`.

**Say:** "Every decision explains itself — and mints a proof."

## Scene 4 — Attack (1:30 → 2:30)

**Do:** on **L2** (new device, Mumbai IP via VPN, system clock/context set to 02:00 in the demo context header), same engineer account → request *download* on the same asset; then click *download* 8 more times quickly.

**Screen (L1, `/access` + `/incidents` split):**
- Risk `91 / high` · signals `new_device · impossible_travel (BLR→BOM in 8 min) · odd_hours · burst`
- **DENY** with `✗ Device not trusted · ✗ Outside working hours · ⚠ Risk 91`
- Effective-permissions strip changes live: `VIEW ✓ · DOWNLOAD STEP-UP · TRANSFER ✗ · EXPORT ✗`
- Identity trust gauge drops `96 → 42`
- Incident `INC-2042` opens; after two failed step-ups: `Session locked · URLs expired · Security alerted`

**Say:** "The risk engine didn't just score the request — it changed the security posture. Privileges shrank, the session died, and every step is already on the ledger."

## Scene 5 — Try to bypass (2:30 → 3:00)

**Do:** in a terminal on L1: `docker stop peer0.org1.example.com`. As the *manager* on L1, request *transfer* of the asset.

**Screen:** **DENIED — `ledger_unavailable`. Sensitive action cannot continue.** Proof Dashboard shows Fabric ● red, everything else green.

**Say:** "No ledger, no sensitive action. VAJRA fails closed, not open."

Then `docker start peer0.org1.example.com` (takes ~5 s; the outbox drains — point at the `anchored` counter ticking up).

## Scene 6 — Attack replay (3:00 → 4:00)

**Do:** as *auditor*, `/incidents/INC-2042`.

**Screen:** timeline — `02:07 login · 02:08 new device (trust 61) · 02:09 failed liveness (42) · 02:10 failed liveness (27) · 02:11 impossible travel · 02:12 classified CAD requested · 02:12 risk 91 → DENY · 02:12 session locked · 02:12 anchored tx 8f2a…` with the trust-decay sparkline above it. Click **Generate evidence package** → signed JSON, `packageHash`.

**Say:** "Reconstructing this by hand across HR, IAM and ERP logs takes a forensic team days. VAJRA did it in one click, and the package is cryptographically linked end-to-end."

## Scene 7 — Proof (4:00 → 5:00)

**Do:** `/verify` → paste the Proof-of-Action from scene 3 → five checks light up: `hash ✓ · signature ✓ · chain ✓ · ledger ✓ · policy ✓` → **PROOF VALID**. Then `/timetravel` → `02:12`, the engineer's DID → card shows `role engineer · policy POL-009 v3 (hash 9c4e…) · identity trust 42 · device trust 27 · effective permissions: VIEW only`.

**Say:** "Anyone with this certificate can verify it against the ledger without trusting our database — and we can tell you exactly what the organisation believed at 02:12, under which policy version."

## Encore (if 30 s remain) — Revocation cascade

**Do:** `/admin/identities` → **Revoke** the engineer (admin step-up liveness). Back on `/access`: request *view*.

**Screen:** **DENY — `identity_revoked`** · audit event anchored.

**Say:** "One click: credential, sessions, devices, grants, live links — all gone, and the revocation itself is on the chain."

---

## Closing line

"Traditional firewalls protect networks. VAJRA protects the assets inside them — and proves every decision."

## Failure drills (rehearse each once)

| If | Then |
|---|---|
| Camera fails on stage | switch to the pre-recorded scene 1 clip; continue live from scene 2 |
| Fabric won't come back after scene 5 | flip `LEDGER_BACKEND=lite`, restart gateway (10 s); say so if asked |
| VPN/IP override fails on L2 | use the demo context header `X-Vajra-Demo-Context` to inject `ip`, `hour`, `deviceId` (documented, admin-only, off in production builds) |
| Venue Wi-Fi dead | Neon → local Postgres (`docker compose up db`), Pinata → local Kubo; both pre-tested |
