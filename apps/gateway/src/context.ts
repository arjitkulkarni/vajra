import type { KeyObject } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "./config";
import type { Db, DbHandle } from "./db/client";
import type { HealthService } from "./modules/health/service";
import type { LedgerDriver } from "./modules/ledger/types";
import type { OutboxWorker } from "./modules/ledger/outbox";
import type { StorageDriver } from "./modules/vault/storage";

export interface SigningKeys {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicRaw: Buffer;
  issuerDid: string;
}

export interface AppContext {
  config: Config;
  db: Db;
  dbHandle: DbHandle;
  ledger: LedgerDriver;
  storage: StorageDriver;
  keys: SigningKeys;
  kek: Buffer;
  health: HealthService;
  outbox: OutboxWorker;
  log: FastifyBaseLogger;
}

/** Drizzle transactions are structurally PgDatabase instances; this keeps call sites tidy. */
export async function withTx<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx as unknown as Db));
}
