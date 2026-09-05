import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { ChainError } from "@vajra/chain-logic";
import { loadConfig, type Config } from "./config";
import { createDb } from "./db/client";
import type { AppContext } from "./context";
import { kekFromSecret, keyPairFromSecret } from "./lib/crypto";
import { CONSOLE_KEY_HEADER } from "./lib/console-key";
import { ApiError } from "./lib/errors";
import { HealthService } from "./modules/health/service";
import { LiteLedger } from "./modules/ledger/lite";
import { OutboxWorker } from "./modules/ledger/outbox";
import type { LedgerDriver } from "./modules/ledger/types";
import { refreshProofsForAuditEvent } from "./modules/proof/service";
import { recomputeAssetTrustForVersion } from "./modules/trust/service";
import { riskHealth } from "./modules/risk/service";
import { createStorage } from "./modules/vault/storage";
import { registerRoutes } from "./routes/index";
import { SCENARIO_HEADER } from "./modules/demo/scenario";

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
  close: () => Promise<void>;
}

export async function buildApp(overrides: Partial<Record<keyof Config, string>> = {}): Promise<BuiltApp> {
  const config = loadConfig(overrides);
  const app = Fastify({
    logger:
      process.env.NODE_ENV === "test"
        ? false
        : { level: config.LOG_LEVEL, transport: process.stdout.isTTY ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } : undefined },
    bodyLimit: 30 * 1024 * 1024,
  });

  const dbHandle = await createDb(config, app.log);
  const storage = createStorage(config);
  const keyPair = keyPairFromSecret(config.PROOF_SIGNING_SEED);
  const health = new HealthService(config);

  let ledger: LedgerDriver;
  if (config.LEDGER_MODE === "fabric") {
    const { FabricLedger } = await import("./modules/ledger/fabric");
    ledger = new FabricLedger(config);
  } else {
    ledger = new LiteLedger(dbHandle.db);
  }

  const outbox = new OutboxWorker(dbHandle.db, () => ledger, app.log, config.OUTBOX_INTERVAL_MS, async () => {
    if (health.isSimulatedDown("ledger")) return false;
    return (await ledger.health()).ok;
  });

  const ctx: AppContext = {
    config,
    db: dbHandle.db,
    dbHandle,
    ledger,
    storage,
    keys: { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey, publicRaw: keyPair.publicRaw, issuerDid: config.ISSUER_DID },
    kek: kekFromSecret(config.MASTER_KEK),
    health,
    outbox,
    log: app.log,
  };

  health.wire({ dbHandle, ledger: () => ledger, storage, risk: () => riskHealth(ctx) });
  // Certificates cite the audit anchor; when the outbox commits, re-sign them with the tx id.
  // Anchoring also changes an asset's trust (verified origin, anchored versions), so recompute it.
  outbox.onAnchored(async (refTable, refId) => {
    if (refTable === "audit_events") await refreshProofsForAuditEvent(ctx, refId);
    if (refTable === "asset_versions") await recomputeAssetTrustForVersion(ctx, refId);
  });

  await app.register(import("@fastify/cors"), {
    origin: config.WEB_ORIGIN === "*" ? true : config.WEB_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
    exposedHeaders: ["x-vajra-manifest", "x-vajra-sha256", "content-disposition"],
    allowedHeaders: ["content-type", "authorization", "accept-language", SCENARIO_HEADER, CONSOLE_KEY_HEADER],
  });
  await app.register(import("@fastify/multipart"), { limits: { fileSize: 25 * 1024 * 1024, files: 2 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "validation_failed", message: "The request body did not validate.", details: err.flatten() } });
    if (err instanceof ChainError) return reply.status(409).send({ error: { code: err.code, message: err.message } });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 400) return reply.status(400).send({ error: { code: "bad_request", message: e.message ?? "Bad request." } });
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal_error", message: "Something went wrong inside the gateway." } });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: "route_not_found", message: "No such endpoint." } }));

  await registerRoutes(app, ctx);

  return {
    app,
    ctx,
    close: async () => {
      outbox.stop();
      await app.close();
      await ledger.close();
      await dbHandle.close();
    },
  };
}
