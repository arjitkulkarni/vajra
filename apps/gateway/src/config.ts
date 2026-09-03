import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/**
 * `pnpm gateway` runs with the cwd set to apps/gateway, but the workspace keeps one `.env` at its
 * root — so load both, nearest first. dotenv never overwrites a value that is already set, which
 * makes the precedence read the way you would expect: real environment, then the app's own `.env`,
 * then the workspace's.
 */
for (const dir of [process.cwd(), path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."), path.resolve(process.cwd(), "../..")]) {
  const file = path.join(dir, ".env");
  if (existsSync(file)) loadDotenv({ path: file });
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === undefined ? undefined : ["1", "true", "yes", "on"].includes(v.toLowerCase()));

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z.string().default("info"),

  DB_MODE: z.enum(["pglite", "postgres", "memory"]).default("pglite"),
  PGLITE_DIR: z.string().default("./data/pglite"),
  DATABASE_URL: z.string().optional(),

  LEDGER_MODE: z.enum(["lite", "fabric"]).default("lite"),
  FABRIC_CHANNEL: z.string().default("vajrachannel"),
  FABRIC_CHAINCODE: z.string().default("vajra-cc"),
  FABRIC_MSP_ID: z.string().default("Org1MSP"),
  FABRIC_PEER_ENDPOINT: z.string().default("localhost:7051"),
  FABRIC_PEER_HOST_ALIAS: z.string().default("peer0.org1.example.com"),
  FABRIC_CERT_PATH: z.string().optional(),
  FABRIC_KEY_PATH: z.string().optional(),
  FABRIC_TLS_CERT_PATH: z.string().optional(),

  STORAGE_MODE: z.enum(["fs", "ipfs", "pinata", "memory"]).default("fs"),
  STORAGE_DIR: z.string().default("./storage"),
  IPFS_API_URL: z.string().default("http://127.0.0.1:5001"),
  PINATA_JWT: z.string().optional(),

  RISK_MODE: z.enum(["local", "http"]).default("local"),
  RISK_SERVICE_URL: z.string().default("http://127.0.0.1:8100"),
  RISK_TIMEOUT_MS: z.coerce.number().default(150),

  ANALYST_MODE: z.enum(["template", "claude"]).default("template"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANALYST_MODEL: z.string().optional(),

  SESSION_JWT_SECRET: z.string().default("dev-only-session-secret-change-me"),
  SESSION_TTL_MINUTES: z.coerce.number().default(15),
  MASTER_KEK: z.string().default("dev-only-master-kek-change-me"),
  PROOF_SIGNING_SEED: z.string().default("dev-only-proof-signing-seed-change-me"),
  ISSUER_DID: z.string().default("did:web:vajra.local"),

  /**
   * The two confidence floors the five-verification bundle enforces, as integers 0-100.
   *
   * `FACE_MATCH_MIN_SCORE` is a descriptor distance turned inside out — score = (1 − distance) × 100
   * — so the default of 45 is the 0.55 match distance the enrolment template was tuned for.
   * `LIVENESS_MIN_SCORE` is the passive anti-spoof composite over depth, motion, blink, focus and
   * texture. Raise either to be harsher; both are recorded on every check whatever they are set to.
   */
  FACE_MATCH_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(45),
  LIVENESS_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(45),

  /**
   * The live AI check's floor, as an integer 0-100: the live probability MiniFASNet must give a
   * capture for it not to be treated as a presentation attack.
   *
   * This one is not a confidence dial like the two above, and it should not be tuned as though it
   * were. The model is trained with a softmax over three classes and it is emphatic in both
   * directions — a genuine face measures in the high nineties, a print or a replay measures under
   * one. Almost nothing lands in between, so 50 sits in the empty middle of that distribution and
   * every value from about 10 to about 90 classifies the same captures the same way. Raising it
   * towards 90 does not buy sensitivity, it just moves the cliff closer to where honest captures
   * occasionally sit; lowering it towards 5 stops catching the few attacks the model is unsure of.
   *
   * A capture that clears it is not thereby *trusted* — the five verifications still have to pass.
   * A capture that fails it is refused and escalated: see modules/identity/attestation.
   */
  ANTISPOOF_MIN_LIVE: z.coerce.number().int().min(0).max(100).default(50),

  /**
   * Which network addresses may reach the administrative plane. Comma-separated; entries may be
   * `loopback`, a single IPv4/IPv6 address, or an IPv4 CIDR range. Empty means unrestricted, which
   * is the default so a laptop demo need not know its own address.
   *
   * Checked against the socket peer, never against X-Forwarded-For — see lib/net.ts.
   */
  ADMIN_IP_ALLOWLIST: z.string().default(""),

  /**
   * Derives the console key — the third, independent control on the administrative plane, alongside
   * the role check and the allowlist above. The key is a keyed digest of this value, so changing it
   * and restarting revokes every console URL ever handed out. `pnpm admin:url` prints the current
   * one, and the gateway logs it at boot.
   */
  ADMIN_CONSOLE_SECRET: z.string().default("dev-only-admin-console-secret-change-me"),

  DEMO_MODE: bool.default("true"),
  OUTBOX_INTERVAL_MS: z.coerce.number().default(500),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(overrides: Partial<Record<keyof Config, string>> = {}): Config {
  const merged: Record<string, string | undefined> = { ...process.env };
  for (const [k, v] of Object.entries(overrides)) merged[k] = v;
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
