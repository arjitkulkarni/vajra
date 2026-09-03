# VAJRA — Pitch Notes

## Positioning

**VAJRA — A Cryptographic Trust Layer for Digital Assets.**
*Identity. Ownership. Access. Provenance. Evidence.*

Tagline (keep): *"Trust, Verified. Access, Controlled."*

One-line USP:

> VAJRA doesn't just control who can access an asset — it proves who accessed it, why they were allowed, what they did, and whether the asset can still be trusted.

The pipeline: **Identity → Trust → Decision → Asset → Proof**

The analogy: *"Traditional firewalls protect networks. VAJRA protects the assets inside them — and proves every decision."*

## The five bullets on the USP slide (never fifteen)

1. 🔐 **Continuous Trust** — identity and device trust are re-evaluated for every sensitive action, and privileges shrink automatically when trust drops.
2. 🧬 **Asset Passport** — every digital asset carries verifiable ownership, integrity, lineage and a live trust score.
3. 🧾 **Proof-of-Action** — every critical decision becomes independently verifiable cryptographic evidence.
4. 🕵️ **Autonomous Insider-Threat Response** — anomalous behaviour is grouped into incidents, locks sessions, and replays as a timeline in one click.
5. ⚖️ **Time-Travel Audit** — reconstruct who accessed what, under which policy version, risk state and approval, at any point in history.

## How it maps to SIH26125 (say this explicitly — it pre-empts "did they drift?")

| PS asks for | VAJRA primitive | What we built on top |
|---|---|---|
| Decentralised identities | `did:key` in the browser, JWT-VC, on-device liveness | continuous trust, revocation cascade |
| NFT-based asset ownership | `AssetPassport` chaincode (non-fungible record) | Asset Passport, lineage, chain of custody |
| Smart-contract governance | `PolicyRegistry`, `Transfer` refuses approver = requester | versioned policy-as-code, two-person rule, break-glass |
| RBAC | policy engine RBAC → ABAC → trust → risk | explainable decisions, adaptive privileges |
| Immutable activity records | hash-chained audit anchored on Fabric | Proof-of-Action, attack replay, evidence package, time-travel |

## Language rules

| Don't say | Say instead |
|---|---|
| "We turn CAD files into NFTs" | "We issue blockchain-backed **Asset Passports**." If asked: "technically a non-fungible asset record — each asset needs unique ownership and provenance." |
| "Our AI detects hackers" | "Our **risk engine continuously evaluates contextual trust signals**. Every point in the score has a named reason. The same interface accepts learned anomaly models later." |
| "Blockchain-based IAM" | "VAJRA makes every sensitive digital asset **independently trustworthy**." |
| "Immutable audit log" | "**Proof** — a certificate anyone can verify against the ledger without trusting our database." |
| "We combine DID + biometrics + RBAC + blockchain" | Name the *capability*: explainable decisions, trust that travels with the asset, attack replay. Features are expected; capabilities win. |

## Judge Q&A — prepared answers

**Why do I need VAJRA instead of Okta plus a blockchain audit log?**
Those give you access and logs. VAJRA gives you trust that travels with the asset, decisions that explain themselves, privileges that adapt to live trust, and proofs a regulator can verify without our database. Features versus capabilities.

**Why Hyperledger Fabric and not a public chain?**
Enterprise and government assets need permissioned membership, zero gas, and organisations as endorsers — on stage, Org2 is the auditor endorsing the platform's transactions. Only hashes, ownership and decisions go on chain; the asset bytes never do. Re-anchoring to another chain is additive (roadmap).

**Where are the biometrics stored?**
Nowhere. The face descriptor never leaves the device; the server only ever sees a public key, a signature and a nonce. We show the network tab in the demo.

**Isn't on-device matching spoofable by a tampered client?**
Yes — but the attacker still needs the enrolled DID key on that device, and then hits trust gates, step-up, two-person approval and the incident ladder. WebAuthn hardware co-signing is the hardening path and uses the same attestation format.

**Why heuristics and not machine learning?**
Explainability is the feature: every point in the risk score names a signal a judge or auditor can read. A model would hide that. The scorer is behind one interface, so a learned model slots in later without touching the decision engine.

**What happens when the blockchain is down?**
We stop it on stage. Sensitive actions deny with `ledger_unavailable`; nothing silently degrades; anchors queue and drain when it returns.

**Where is the smart-contract governance?**
`AssetPassport.Transfer` refuses `approverDid = fromDid` on high-sensitivity assets — the ledger enforces the two-person rule itself. Policy versions are hash-anchored, so a decision can prove which rules it ran under.

**How does this integrate with an existing organisation?**
API-first: HR/IAM/PLM push users and roles into VAJRA; assets keep living where they live — only hashes and passports come in. The mock HR connector (CSV) shows the shape. Days, not months.

**What about privacy law (DPDP)?**
No biometric data is processed server-side, so the highest-risk category never enters our systems. DIDs are pseudonymous; PII stays in the organisation's HR system of record.

**What's the cost?**
Zero gas. Neon and Pinata free tiers for the pilot; under ₹5,000/month at Q1 pilot scale; scales horizontally behind a load balancer with the risk workers scaled separately.

## The 5-minute demo (see demo-script.md)

Identity → Asset → Normal access (explained) → Attack (privileges shrink, session locks) → Bypass attempt (Fabric stopped → fail closed) → Attack replay + evidence package → Proof VALID + time-travel. Encore: revocation cascade.

## Slide order suggestion

1. Problem — one screen: passwords, spoofed face-ID, no proof of who touched a file, 120-hour audits, centralised biometric honeypots.
2. Idea — the Trust Firewall diagram; "trust that travels with the asset".
3. The five USPs.
4. Architecture — six components; on-chain vs off-chain rule; fail-closed.
5. Demo (live).
6. PS coverage map + what we deliberately cut.
7. Feasibility, cost, roadmap, references.
