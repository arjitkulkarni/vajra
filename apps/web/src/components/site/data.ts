/**
 * The content model behind the marketing site.
 *
 * Pure data and pure functions — no JSX, no "use client". The landing page and the Evidence
 * Explorer are both server-rendered first, so everything here has to be identical on the server
 * and on the client: no Date.now(), no Math.random(), no module-level mutation. Every timestamp,
 * hash and block height below is a literal for exactly that reason. A single non-deterministic
 * value in this file becomes a hydration mismatch on the busiest page we have.
 *
 * Copy lives in i18n, not here. A record carries a `titleKey`, never a title; the only strings
 * this file spells out are ones a machine produced (hashes, ids, proof ids) or the proper names of
 * public standards (Ed25519, PostgreSQL), which are not translated in any locale.
 *
 * The Explorer's filtering and sorting live here too, so the Explorer component stays
 * presentational and the matching rules can be reasoned about — and changed — without opening a
 * file full of JSX.
 */

// ─── The vocabulary ──────────────────────────────────────────────────────────

export type Verdict = "ALLOW" | "STEP_UP" | "DENY";
export type AssetClass = "design" | "model" | "certificate" | "document";
export type Sector = "manufacturing" | "defence" | "healthcare" | "finance" | "media" | "research";
export type ActionKind = "open" | "download" | "transfer" | "sign";

/**
 * Every product visual the site can draw, as one closed union. `mockups.tsx` maps each member to a
 * component; a record names its visual by kind rather than importing one, which is what keeps this
 * file free of JSX and lets the two be written against each other rather than in sequence.
 */
export type MockupKind =
  | "browser"
  | "phone"
  | "console"
  | "passport"
  | "proof"
  | "trace"
  | "ledger"
  | "liveness"
  | "trust"
  | "hash"
  | "verdict"
  | "matrix"
  | "timeline"
  | "graph";

/**
 * One decision. Somebody asked to open, download, transfer or sign a protected asset; VAJRA
 * checked the live person, scored the moment, ruled, and wrote this.
 *
 * `trust`, `risk` and `checks` are not decoration — they are the inputs the verdict was derived
 * from, so they are kept coherent with it throughout the corpus below. An ALLOW at trust 30 would
 * say the scoring engine is broken, and a visitor reading the grid would be right to notice.
 */
export type EvidenceRecord = {
  /** The proof id an auditor quotes. Mono, uppercase — distinct from the r01…r36 corpus key. */
  id: string;
  assetUid: string;
  /** Resolves under `site.corpus.<key>.title`; the visible string is the locale's, never ours. */
  titleKey: string;
  assetClass: AssetClass;
  sector: Sector;
  action: ActionKind;
  verdict: Verdict;
  /** 0–100. */
  trust: number;
  /** 0–100. */
  risk: number;
  roleKey: "engineer" | "manager" | "auditor" | "admin";
  device: string;
  /** Fixed ISO 8601. Never derived at render time — see the file header. */
  at: string;
  sha256: string;
  anchored: boolean;
  /** Null exactly when `anchored` is false: the batch has not been cut yet. */
  block: number | null;
  /** How many of the five verifications passed. */
  checks: number;
  latencyMs: number;
  mockup: MockupKind;
};

// ─── Ordered facets ──────────────────────────────────────────────────────────
//
// Declared in the order the filter rail draws them, not alphabetically. Verdicts run
// ALLOW → STEP_UP → DENY so the pills read as an escalation rather than as a list, and sectors
// lead with the two the problem statement names first.

export const ASSET_CLASSES: readonly AssetClass[] = ["design", "model", "certificate", "document"];
export const VERDICTS: readonly Verdict[] = ["ALLOW", "STEP_UP", "DENY"];
export const SECTORS: readonly Sector[] = ["manufacturing", "defence", "healthcare", "finance", "media", "research"];
export const ACTIONS: readonly ActionKind[] = ["open", "download", "transfer", "sign"];

// ─── The corpus ──────────────────────────────────────────────────────────────
/**
 * Thirty-six records, r01…r36, newest first and strictly descending in time across roughly six
 * weeks ending 2026-03-02. Newest-first is load-bearing: it makes the default "Newest" sort a
 * no-op, so the state the page loads in costs neither a copy nor a comparison.
 *
 * The distribution is deliberate, not sampled. ~60/25/15 ALLOW/STEP_UP/DENY is what a healthy
 * deployment actually looks like — a system that denies a third of its traffic is a system nobody
 * uses. Nine records per asset class, six per sector and nine per action, so no filter combination
 * a visitor tries lands on an empty grid by accident.
 *
 * The three most recent records are unanchored with a null block. Ledger batches are cut on an
 * interval, so the newest decisions genuinely are still pending — and the Explorer's "pending
 * anchor" state needs something real to render rather than a state we describe but never show.
 *
 * Out-of-hours timestamps and the device strings on the DENY rows carry the reason: a Tor exit, an
 * unenrolled laptop, an emulator, impossible travel. A denial the reader cannot explain to
 * themselves from the card looks arbitrary, which is the opposite of the claim we are making.
 */
export const EVIDENCE: EvidenceRecord[] = [
  {
    id: "PoA-8F31C2", assetUid: "ast_9c41f0b7", titleKey: "site.corpus.r01.title",
    assetClass: "design", sector: "manufacturing", action: "open", verdict: "ALLOW",
    trust: 96, risk: 6, checks: 5, roleKey: "engineer", device: "MacBook Pro · Bengaluru",
    at: "2026-03-02T09:14:00Z", anchored: false, block: null, latencyMs: 88,
    sha256: "7c4af19b2e8d05a36b71cc9e4d208f3a91e6b4d708cf2a553bd9107e6a2f84c1", mockup: "passport",
  },
  {
    id: "PoA-4B07AE", assetUid: "ast_2ea75d13", titleKey: "site.corpus.r02.title",
    assetClass: "model", sector: "research", action: "download", verdict: "ALLOW",
    trust: 92, risk: 9, checks: 5, roleKey: "engineer", device: "ThinkPad P16 · Pune",
    at: "2026-03-02T08:41:00Z", anchored: false, block: null, latencyMs: 124,
    sha256: "b3e07f529a1c6d8420fb3e97c5d81a0674e2b9f31d0a5c68e93b47d28f610c3b", mockup: "hash",
  },
  {
    id: "PoA-C25D19", assetUid: "ast_58b0c6f4", titleKey: "site.corpus.r03.title",
    assetClass: "certificate", sector: "healthcare", action: "sign", verdict: "STEP_UP",
    trust: 68, risk: 41, checks: 4, roleKey: "manager", device: "Unenrolled iPad Pro · Mumbai",
    at: "2026-03-01T17:52:00Z", anchored: false, block: null, latencyMs: 268,
    sha256: "41d9a20e6c83f7b5db02e4913a7c58d690fe1b4725a3c80d6bf49e12c7085d3a", mockup: "liveness",
  },
  {
    id: "PoA-71E0B6", assetUid: "ast_c17d3a09", titleKey: "site.corpus.r04.title",
    assetClass: "document", sector: "finance", action: "transfer", verdict: "ALLOW",
    trust: 89, risk: 12, checks: 5, roleKey: "manager", device: "Dell Latitude · Hyderabad",
    at: "2026-02-28T16:20:00Z", anchored: true, block: 1309884, latencyMs: 141,
    sha256: "e58c31b7042fa96d8b7e2c50f31da6489c05e7b26a41d83f27be509c1f6a4dbb", mockup: "ledger",
  },
  {
    id: "PoA-3A9D48", assetUid: "ast_4f92be61", titleKey: "site.corpus.r05.title",
    assetClass: "design", sector: "defence", action: "open", verdict: "ALLOW",
    trust: 97, risk: 4, checks: 5, roleKey: "engineer", device: "ThinkPad T14 · Chennai",
    at: "2026-02-28T14:05:00Z", anchored: true, block: 1309817, latencyMs: 73,
    sha256: "96a2f40b7d3e18c9c1508b6e24af97d30b6c5e21f849a3d75e2701bc3daf68e4", mockup: "browser",
  },
  {
    id: "PoA-E64F21", assetUid: "ast_a3061d8e", titleKey: "site.corpus.r06.title",
    assetClass: "model", sector: "media", action: "transfer", verdict: "STEP_UP",
    trust: 61, risk: 47, checks: 3, roleKey: "manager", device: "MacBook Air · Colombo",
    at: "2026-02-27T11:38:00Z", anchored: true, block: 1309240, latencyMs: 312,
    sha256: "2f7be0915ac348d2e60fb17589d42c3e4b1a6f80c37e29d510f8b46ad259e7c3", mockup: "trust",
  },
  {
    id: "PoA-0D5B93", assetUid: "ast_7b5ec240", titleKey: "site.corpus.r07.title",
    assetClass: "design", sector: "defence", action: "download", verdict: "DENY",
    trust: 12, risk: 94, checks: 1, roleKey: "engineer", device: "Unrecognised device · Tor exit",
    at: "2026-02-26T22:47:00Z", anchored: true, block: 1308976, latencyMs: 197,
    sha256: "c04e7a2d3b91f568a72c05be6d8341f9e2b70c145f3a9d8608c6e2b1947dfa30", mockup: "verdict",
  },
  {
    id: "PoA-9C2807", assetUid: "ast_e08f4c92", titleKey: "site.corpus.r08.title",
    assetClass: "document", sector: "manufacturing", action: "sign", verdict: "ALLOW",
    trust: 91, risk: 8, checks: 5, roleKey: "manager", device: "Surface Laptop · Noida",
    at: "2026-02-26T13:12:00Z", anchored: true, block: 1308655, latencyMs: 106,
    sha256: "58b1c9e40a2d7f3691e8b530cd4726af7b3f04e926a1d85cb04c39f7e6512a8d", mockup: "proof",
  },
  {
    id: "PoA-52AE6D", assetUid: "ast_16d2a7fb", titleKey: "site.corpus.r09.title",
    assetClass: "certificate", sector: "finance", action: "open", verdict: "ALLOW",
    trust: 88, risk: 11, checks: 5, roleKey: "auditor", device: "iMac · Bengaluru",
    at: "2026-02-25T10:26:00Z", anchored: true, block: 1308102, latencyMs: 152,
    sha256: "a71f0c38e5942bd63c80af517d2e6b94f01358ca8b6d24e75920fc3b4ea1d706", mockup: "passport",
  },
  {
    id: "PoA-B8130F", assetUid: "ast_bd4903e5", titleKey: "site.corpus.r10.title",
    assetClass: "model", sector: "healthcare", action: "download", verdict: "STEP_UP",
    trust: 72, risk: 33, checks: 4, roleKey: "engineer", device: "Pixel 8 · Delhi",
    at: "2026-02-24T15:44:00Z", anchored: true, block: 1307744, latencyMs: 241,
    sha256: "6de3b08517c94af2b8206d3e5f41ea970c73b2d8a96e150f34d8c7b6e021f95a", mockup: "liveness",
  },
  {
    id: "PoA-2F6CA4", assetUid: "ast_302cf68a", titleKey: "site.corpus.r11.title",
    assetClass: "design", sector: "media", action: "sign", verdict: "ALLOW",
    trust: 94, risk: 7, checks: 5, roleKey: "manager", device: "iPhone 15 · Pune",
    at: "2026-02-24T09:58:00Z", anchored: true, block: 1307488, latencyMs: 97,
    sha256: "3b9c62f084e15da7d20b47c96f38a105e7c4029b15da8e63a840f2d7c93b06e5", mockup: "phone",
  },
  {
    id: "PoA-D40E75", assetUid: "ast_95ea1b74", titleKey: "site.corpus.r12.title",
    assetClass: "document", sector: "research", action: "transfer", verdict: "ALLOW",
    trust: 86, risk: 14, checks: 5, roleKey: "engineer", device: "MacBook Pro · Gurugram",
    at: "2026-02-23T12:33:00Z", anchored: true, block: 1307015, latencyMs: 168,
    sha256: "f24a80d16b03e97c5c8b1d4a92f7e3060d61ba85c3452ef97ea09b3418d5c6f2", mockup: "timeline",
  },
  {
    id: "PoA-671BC8", assetUid: "ast_6c73d0af", titleKey: "site.corpus.r13.title",
    assetClass: "certificate", sector: "manufacturing", action: "transfer", verdict: "ALLOW",
    trust: 90, risk: 10, checks: 5, roleKey: "manager", device: "Latitude 7440 · Visakhapatnam",
    at: "2026-02-21T18:09:00Z", anchored: true, block: 1306341, latencyMs: 133,
    sha256: "09e7d3b6c81f542a6b90ae37f45c208d3a7e91cb2d06f85eb1c439a075e2d68f", mockup: "ledger",
  },
  {
    id: "PoA-AE3092", assetUid: "ast_d81b52e6", titleKey: "site.corpus.r14.title",
    assetClass: "design", sector: "finance", action: "download", verdict: "STEP_UP",
    trust: 66, risk: 38, checks: 4, roleKey: "engineer", device: "Galaxy S24 · Jaipur",
    at: "2026-02-20T11:21:00Z", anchored: true, block: 1305702, latencyMs: 287,
    sha256: "d51b8e073f2a6c9408b7f13dea695c2047c3d9b896e0125f2ba48d7c3e17f0a6", mockup: "trace",
  },
  {
    id: "PoA-15D7B3", assetUid: "ast_47a9ecd3", titleKey: "site.corpus.r15.title",
    assetClass: "model", sector: "defence", action: "open", verdict: "ALLOW",
    trust: 95, risk: 5, checks: 5, roleKey: "auditor", device: "ThinkPad X1 · Ahmedabad",
    at: "2026-02-19T16:47:00Z", anchored: true, block: 1305118, latencyMs: 81,
    sha256: "8a34e2c9b70d5f1642c9018e6df3ab57c085b249137ae6d09f52c8b3e40716da", mockup: "console",
  },
  {
    id: "PoA-F80A26", assetUid: "ast_f2503b18", titleKey: "site.corpus.r16.title",
    assetClass: "certificate", sector: "healthcare", action: "transfer", verdict: "DENY",
    trust: 21, risk: 88, checks: 2, roleKey: "manager", device: "Windows 11 VM · unknown ASN",
    at: "2026-02-19T03:12:00Z", anchored: true, block: 1304893, latencyMs: 214,
    sha256: "4e0b96a25d17c3f8b3620e5d07af41c98c95d276e13b0a4f6a2d78e5902fc1b7", mockup: "trace",
  },
  {
    id: "PoA-4C69E1", assetUid: "ast_0ab6e79c", titleKey: "site.corpus.r17.title",
    assetClass: "document", sector: "media", action: "download", verdict: "ALLOW",
    trust: 87, risk: 13, checks: 5, roleKey: "engineer", device: "MacBook Air · Kochi",
    at: "2026-02-18T10:05:00Z", anchored: true, block: 1304470, latencyMs: 147,
    sha256: "71ca3d05e92b476f1806bd53c4a7f29e3d51806b8f2ec9a405b7d4316e0a2f9c", mockup: "browser",
  },
  {
    id: "PoA-93B25D", assetUid: "ast_83c40de2", titleKey: "site.corpus.r18.title",
    assetClass: "model", sector: "manufacturing", action: "sign", verdict: "ALLOW",
    trust: 93, risk: 8, checks: 5, roleKey: "manager", device: "ThinkPad T14 · Chennai",
    at: "2026-02-17T14:30:00Z", anchored: true, block: 1303986, latencyMs: 112,
    sha256: "bd6208e543f19a7c96d0c31b2e587f04a1b3496d70ce825ad8f40b175c93e26a", mockup: "graph",
  },
  {
    id: "PoA-0781FA", assetUid: "ast_5e17b9a0", titleKey: "site.corpus.r19.title",
    assetClass: "design", sector: "research", action: "transfer", verdict: "STEP_UP",
    trust: 58, risk: 51, checks: 3, roleKey: "engineer", device: "ThinkPad T14 · Singapore",
    at: "2026-02-16T09:47:00Z", anchored: true, block: 1303441, latencyMs: 334,
    sha256: "0f8dc471a26e30597b14e8d2c50396fa62b8d17e4931ac05e8620b3df704a5c8", mockup: "matrix",
  },
  {
    id: "PoA-B5E43C", assetUid: "ast_ca2d6f38", titleKey: "site.corpus.r20.title",
    assetClass: "certificate", sector: "defence", action: "sign", verdict: "ALLOW",
    trust: 98, risk: 3, checks: 5, roleKey: "admin", device: "MacBook Pro · Bengaluru",
    at: "2026-02-14T13:18:00Z", anchored: true, block: 1302589, latencyMs: 69,
    sha256: "5c1e70b9d84a2f3620e5b8c196f3407dab7c25e40d19638f3e5a0cd7c862b91e", mockup: "proof",
  },
  {
    id: "PoA-2C90D7", assetUid: "ast_71904ecb", titleKey: "site.corpus.r21.title",
    assetClass: "document", sector: "healthcare", action: "open", verdict: "ALLOW",
    trust: 85, risk: 15, checks: 5, roleKey: "auditor", device: "iPad Pro · Mumbai",
    at: "2026-02-13T15:56:00Z", anchored: true, block: 1302067, latencyMs: 174,
    sha256: "e3702a6c195bd8f4c7a04e238b61f0954d2c73ba6e05918df2b3ce470a94d651", mockup: "console",
  },
  {
    id: "PoA-6ADF08", assetUid: "ast_be36a15d", titleKey: "site.corpus.r22.title",
    assetClass: "model", sector: "finance", action: "transfer", verdict: "DENY",
    trust: 34, risk: 71, checks: 3, roleKey: "engineer", device: "Rooted Android 14 · emulator",
    at: "2026-02-12T11:02:00Z", anchored: true, block: 1301744, latencyMs: 386,
    sha256: "9b45f10e6d28c7033a0eb597d1c68a2405fe3b9d84a72c61b39d05ea7f16c428", mockup: "verdict",
  },
  {
    id: "PoA-E31654", assetUid: "ast_249fd07e", titleKey: "site.corpus.r23.title",
    assetClass: "design", sector: "media", action: "download", verdict: "ALLOW",
    trust: 92, risk: 9, checks: 5, roleKey: "manager", device: "MacBook Pro · Coimbatore",
    at: "2026-02-11T17:24:00Z", anchored: true, block: 1301302, latencyMs: 118,
    sha256: "2a68d5c0f307b4918e5a1d764b09c2ef61d3907ac2481be507f6a3d9be25104c", mockup: "passport",
  },
  {
    id: "PoA-58074B", assetUid: "ast_a70c8b34", titleKey: "site.corpus.r24.title",
    assetClass: "document", sector: "research", action: "sign", verdict: "STEP_UP",
    trust: 70, risk: 35, checks: 4, roleKey: "engineer", device: "Surface Laptop · Noida",
    at: "2026-02-10T08:36:00Z", anchored: true, block: 1300815, latencyMs: 254,
    sha256: "c7e910435a862bd70f34e18b96d7250ae4c8b3613b09df528a175ec4d602f7ab", mockup: "phone",
  },
  {
    id: "PoA-A2FC1E", assetUid: "ast_3fd51e96", titleKey: "site.corpus.r25.title",
    assetClass: "certificate", sector: "manufacturing", action: "open", verdict: "ALLOW",
    trust: 89, risk: 12, checks: 5, roleKey: "auditor", device: "Dell OptiPlex · Nagpur",
    at: "2026-02-09T12:49:00Z", anchored: true, block: 1300288, latencyMs: 139,
    sha256: "46b0e3d8c19f5724b6203a8e0d75c1f992ea486b5c37021daf84e6c571b9308f", mockup: "hash",
  },
  {
    id: "PoA-70B385", assetUid: "ast_08b2c74a", titleKey: "site.corpus.r26.title",
    assetClass: "design", sector: "defence", action: "transfer", verdict: "DENY",
    trust: 9, risk: 96, checks: 1, roleKey: "engineer", device: "Unenrolled ThinkPad · unknown network",
    at: "2026-02-07T23:58:00Z", anchored: true, block: 1299617, latencyMs: 178,
    sha256: "f108b57a62d3ec094917f2b88ac05d633e6b90d407c2af18d5931e6b2604fa8c", mockup: "trace",
  },
  {
    id: "PoA-1E4D60", assetUid: "ast_d6e3095f", titleKey: "site.corpus.r27.title",
    assetClass: "model", sector: "healthcare", action: "sign", verdict: "ALLOW",
    trust: 94, risk: 6, checks: 5, roleKey: "manager", device: "iPhone 15 Pro · Lucknow",
    at: "2026-02-06T14:11:00Z", anchored: true, block: 1299130, latencyMs: 101,
    sha256: "83d61c0f2b47a95e70e9b284c1035fd66a2d8e07b9f41c35042e7ba9e58d16c2", mockup: "trust",
  },
  {
    id: "PoA-C6529A", assetUid: "ast_6205af71", titleKey: "site.corpus.r28.title",
    assetClass: "document", sector: "finance", action: "open", verdict: "STEP_UP",
    trust: 63, risk: 44, checks: 3, roleKey: "auditor", device: "MacBook Pro · Dubai",
    at: "2026-02-05T10:40:00Z", anchored: true, block: 1298644, latencyMs: 301,
    sha256: "1e57c9b308a6d240fd3b8e715490c6a227b1e05d6c83f4a9903ed21b7af5680e", mockup: "matrix",
  },
  {
    id: "PoA-3D08F7", assetUid: "ast_91cb4d28", titleKey: "site.corpus.r29.title",
    assetClass: "certificate", sector: "media", action: "download", verdict: "ALLOW",
    trust: 91, risk: 10, checks: 5, roleKey: "admin", device: "iMac · Bengaluru",
    at: "2026-02-04T16:03:00Z", anchored: true, block: 1298201, latencyMs: 126,
    sha256: "b62409ea7c15fd3825b0473c9e8a61d5c30fb72841d695028fe3a1c60b74d29f", mockup: "ledger",
  },
  {
    id: "PoA-89A61B", assetUid: "ast_4d80e35c", titleKey: "site.corpus.r30.title",
    assetClass: "design", sector: "research", action: "sign", verdict: "ALLOW",
    trust: 83, risk: 17, checks: 5, roleKey: "engineer", device: "MacBook Pro · Bengaluru",
    at: "2026-02-03T09:27:00Z", anchored: true, block: 1297698, latencyMs: 181,
    sha256: "507fa3d19b28e64c3c07d5b261ea8f90d4b25703aec1864927309fb5e0c4a71d", mockup: "passport",
  },
  {
    id: "PoA-45C2E0", assetUid: "ast_ef17206b", titleKey: "site.corpus.r31.title",
    assetClass: "model", sector: "manufacturing", action: "open", verdict: "STEP_UP",
    trust: 74, risk: 29, checks: 4, roleKey: "engineer", device: "New MacBook Pro · Bengaluru",
    at: "2026-02-02T13:55:00Z", anchored: true, block: 1297155, latencyMs: 226,
    sha256: "a94c07e63d81b25f08fc63d95b207ae4e61d38c072af9d154c8b0e6391d5f720", mockup: "liveness",
  },
  {
    id: "PoA-D1739E", assetUid: "ast_7a3c95d0", titleKey: "site.corpus.r32.title",
    assetClass: "document", sector: "defence", action: "download", verdict: "ALLOW",
    trust: 96, risk: 5, checks: 5, roleKey: "admin", device: "Latitude 7440 · Visakhapatnam",
    at: "2026-01-30T11:16:00Z", anchored: true, block: 1295982, latencyMs: 76,
    sha256: "6f2b58a0e4d13c97b805f26e3a91d74007c5b3e8d269a1f45e30879bc1a4602d", mockup: "timeline",
  },
  {
    id: "PoA-0B5A26", assetUid: "ast_1b6f48ae", titleKey: "site.corpus.r33.title",
    assetClass: "certificate", sector: "research", action: "open", verdict: "ALLOW",
    trust: 88, risk: 13, checks: 5, roleKey: "auditor", device: "ThinkPad X1 · Ahmedabad",
    at: "2026-01-28T15:39:00Z", anchored: true, block: 1295114, latencyMs: 158,
    sha256: "34e1b7d905c8a26f92b40e137d6fc850ba03e59c481d276ae6c9034b2f708da1", mockup: "proof",
  },
  {
    id: "PoA-96E4D3", assetUid: "ast_c94e0273", titleKey: "site.corpus.r34.title",
    assetClass: "document", sector: "media", action: "transfer", verdict: "DENY",
    trust: 27, risk: 83, checks: 2, roleKey: "engineer", device: "iPhone 13 · impossible travel",
    at: "2026-01-26T02:44:00Z", anchored: true, block: 1294366, latencyMs: 231,
    sha256: "e0937b2c5f14ad68c2b70e39806d51fa47e3c9201ba85d0639f27c4ed51068ba", mockup: "verdict",
  },
  {
    id: "PoA-27F851", assetUid: "ast_50d8ba19", titleKey: "site.corpus.r35.title",
    assetClass: "model", sector: "finance", action: "sign", verdict: "STEP_UP",
    trust: 56, risk: 52, checks: 3, roleKey: "manager", device: "iPhone 15 · Hyderabad",
    at: "2026-01-22T10:52:00Z", anchored: true, block: 1292880, latencyMs: 348,
    sha256: "728d4e1b0c39fa56ad6120b7f584c0936e2b71d4890a5fc3b17e3d284062c9ae", mockup: "graph",
  },
  {
    id: "PoA-BC0942", assetUid: "ast_2673fc84", titleKey: "site.corpus.r36.title",
    assetClass: "certificate", sector: "healthcare", action: "download", verdict: "ALLOW",
    trust: 84, risk: 16, checks: 5, roleKey: "manager", device: "MacBook Air · Kochi",
    at: "2026-01-19T14:08:00Z", anchored: true, block: 1291503, latencyMs: 163,
    sha256: "cb0574e28f6193ad4d20e7b5137c0af690b48d215ec3760b2af9c1846d305e7b", mockup: "hash",
  },
];

// ─── Honest social proof ─────────────────────────────────────────────────────

/**
 * The logo rail. This is a hackathon entry, so there are no customers to name — the honest
 * equivalent is what VAJRA is genuinely built on. Every one of these is a public standard or a
 * shipped runtime we actually call, which is a stronger claim than a wall of borrowed marks.
 *
 * `label` and `note` are English literals on purpose: "Ed25519" and "PostgreSQL" are proper names
 * with no translation in any locale, and routing them through i18n would invite one. The heading
 * above the rail is prose, so that one does come from i18n.
 */
export const TECHNOLOGIES: { id: string; label: string; note: string }[] = [
  { id: "did", label: "W3C DID", note: "decentralised identifiers" },
  { id: "fabric", label: "Hyperledger Fabric", note: "permissioned ledger" },
  { id: "ed25519", label: "Ed25519", note: "detached signatures" },
  { id: "sha256", label: "SHA-256", note: "content addressing" },
  { id: "onnx", label: "ONNX Runtime", note: "on-device inference" },
  { id: "adaface", label: "AdaFace", note: "face recognition" },
  { id: "webcrypto", label: "Web Crypto API", note: "keys never leave" },
  { id: "postgres", label: "PostgreSQL", note: "the queryable cache" },
];

/**
 * The nine questions an auditor, a CISO, a regulator and a judge actually ask. Ids only: the
 * question, its answer and the role it is attributed to are all copy, and the masonry needs
 * varied lengths per locale — which only i18n can give it.
 */
export const QUESTION_IDS: readonly string[] = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9"];

// ─── Site structure ──────────────────────────────────────────────────────────

/**
 * The scroll-driven story. Four steps, each with the one visual that carries it: the face gate,
 * the score, the ruling, and the anchored chain that makes a replay years later possible at all.
 */
export const STORY_STEPS: { id: "s1" | "s2" | "s3" | "s4"; mockup: MockupKind }[] = [
  { id: "s1", mockup: "liveness" },
  { id: "s2", mockup: "trust" },
  { id: "s3", mockup: "verdict" },
  { id: "s4", mockup: "ledger" },
];

/**
 * Header navigation. `href` carries no locale — the header prefixes it, so one table serves all
 * three locales and a link can never be built against the wrong one.
 *
 * `key` is a full i18n path rather than a bare word so the two destinations that already have copy
 * reuse it instead of growing a second, divergent translation under `site.*`.
 */
export const SITE_NAV: { key: string; href: string }[] = [
  { key: "site.nav.product", href: "" },
  { key: "site.nav.explore", href: "/explore" },
  { key: "nav.architecture", href: "/about" },
  { key: "nav.demo", href: "/demo" },
];

// ─── The Explorer engine ─────────────────────────────────────────────────────

export type SortKey = "newest" | "trust" | "risk";

/**
 * One facet per pill group. An absent or empty list means "no constraint", which is what lets the
 * `All` pill be the absence of a selection rather than a fifth value everything has to be tested
 * against.
 */
export type ExplorerFacets = {
  assetClasses?: readonly AssetClass[];
  verdicts?: readonly Verdict[];
  sectors?: readonly Sector[];
  actions?: readonly ActionKind[];
  /** The `Saved` pill. `saved` is the persisted id list; it is only read when this is true. */
  savedOnly?: boolean;
  saved?: readonly string[];
};

/**
 * Everything a query is tested against. `action`, `sector` and `roleKey` are lowercase literals by
 * construction and `assetUid`/`sha256` are lowercase hex, so none of them needs a per-row
 * `toLowerCase()` — at 36 rows × 6 fields × a keystroke that is the difference between zero
 * allocations and a few hundred.
 *
 * A hash is matched by prefix only. Nobody types the middle of a SHA-256, and `includes` on a
 * 64-character string would let a stray "ab" match most of the corpus.
 *
 * Asset class is deliberately absent: it has its own row of pills, and letting the free-text box
 * shadow a facet control makes the two disagree about what "design" currently means.
 */
function matchesQuery(record: EvidenceRecord, needle: string, titles?: Record<string, string>): boolean {
  if (record.sha256.startsWith(needle)) return true;
  if (record.assetUid.includes(needle)) return true;
  if (record.action.includes(needle)) return true;
  if (record.sector.includes(needle)) return true;
  if (record.roleKey.includes(needle)) return true;
  if (record.id.toLowerCase().includes(needle)) return true;
  const title = titles?.[record.id];
  return title !== undefined && title.toLowerCase().includes(needle);
}

/**
 * Facets AND across groups, OR within one: picking `design` and `model` widens the result, picking
 * `design` and `DENY` narrows it. That is the only combination that behaves the way a person
 * expects when they click two pills in the same row.
 *
 * `titles` is a pre-resolved `record.id` → translated-title map. Translation is a hook, this file
 * is not a component, and the search has to match what the visitor can actually read — so the
 * Explorer resolves the titles once per locale and hands them down rather than this file reaching
 * for `t`.
 *
 * With nothing to narrow, the input array is returned unchanged — same reference, same order, no
 * copy. That is the state the page loads in, so it is the one worth making free.
 */
export function filterRecords(
  records: EvidenceRecord[],
  query: string,
  facets?: ExplorerFacets,
  titles?: Record<string, string>,
): EvidenceRecord[] {
  const needle = query.trim().toLowerCase();
  const classes = facets?.assetClasses;
  const verdicts = facets?.verdicts;
  const sectors = facets?.sectors;
  const actions = facets?.actions;
  const savedOnly = facets?.savedOnly === true;

  const narrowing =
    needle.length > 0 ||
    savedOnly ||
    (classes !== undefined && classes.length > 0) ||
    (verdicts !== undefined && verdicts.length > 0) ||
    (sectors !== undefined && sectors.length > 0) ||
    (actions !== undefined && actions.length > 0);
  if (!narrowing) return records;

  // Built once per call rather than once per row: `Saved` is the one facet whose list grows with
  // use, so it is the only one where a linear scan per record would eventually be felt.
  const saved = savedOnly ? new Set(facets?.saved ?? []) : null;

  return records.filter((record) => {
    if (classes !== undefined && classes.length > 0 && !classes.includes(record.assetClass)) return false;
    if (verdicts !== undefined && verdicts.length > 0 && !verdicts.includes(record.verdict)) return false;
    if (sectors !== undefined && sectors.length > 0 && !sectors.includes(record.sector)) return false;
    if (actions !== undefined && actions.length > 0 && !actions.includes(record.action)) return false;
    if (saved !== null && !saved.has(record.id)) return false;
    return needle.length === 0 || matchesQuery(record, needle, titles);
  });
}

/**
 * `newest` returns the input untouched: EVIDENCE is stored newest-first and `filterRecords`
 * preserves order, so the default sort is already sorted and costs nothing.
 *
 * The other two copy before sorting — `Array.prototype.sort` mutates in place, and the caller is
 * holding a reference to EVIDENCE itself whenever no facet is active. Ties are left to the stable
 * sort, which keeps equal scores in time order; a `localeCompare` tiebreak would have made the
 * ordering depend on the visitor's locale, which is exactly the wrong thing for a list of ids.
 */
export function sortRecords(records: EvidenceRecord[], sort: SortKey): EvidenceRecord[] {
  if (sort === "newest") return records;
  const sorted = records.slice();
  sorted.sort(sort === "trust" ? (a, b) => b.trust - a.trust : (a, b) => b.risk - a.risk);
  return sorted;
}
