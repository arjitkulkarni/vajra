import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Config } from "../config";
import { schema } from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Just the sliver of the Fastify logger the pool needs, so this module stays free of app imports. */
export interface PoolLog {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface DbHandle {
  db: Db;
  kind: "pglite" | "postgres" | "memory";
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const migrationsFolder = path.resolve(here, "../../drizzle");

export async function createDb(config: Config, log?: PoolLog): Promise<DbHandle> {
  if (config.DB_MODE === "postgres") {
    if (!config.DATABASE_URL) throw new Error("DB_MODE=postgres requires DATABASE_URL");
    const { default: pg } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    /*
     * Managed Postgres (Neon and friends) closes connections that have been idle for a few minutes,
     * and a pooled client that has been hung up on fails the next query with "Connection terminated
     * unexpectedly". Retire our own clients well before the server does, and keep the TCP session
     * warm, so a background worker never picks up a dead one.
     */
    const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000, keepAlive: true });
    /*
     * A Pool with no `error` listener rethrows: an idle client dropped by the server becomes an
     * unhandled 'error' event and takes the gateway down. The pool has already discarded the client
     * by this point, so logging is the whole job — the next checkout opens a fresh connection.
     */
    pool.on("error", (err) => {
      log?.warn({ err: err.message }, "idle postgres client dropped; it has been removed from the pool");
    });
    /*
     * That listener only covers clients sitting idle in the pool: pg-pool takes its own `error`
     * handler off a client while the client is checked out. A socket dropped mid-query therefore
     * emits on a client nobody is listening to, and Node makes an unhandled 'error' event fatal —
     * which is how a reset during the startup migration took the whole gateway down. The query
     * itself already rejects with this error and the caller reports it, so this listener has one
     * job: keep an expected network failure from being an exit.
     */
    pool.on("connect", (client) => client.on("error", () => {}));
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    return {
      db: db as unknown as Db,
      kind: "postgres",
      ping: async () => {
        try {
          await pool.query("select 1");
          return true;
        } catch {
          return false;
        }
      },
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  let client: InstanceType<typeof PGlite>;
  if (config.DB_MODE === "memory") {
    client = new PGlite();
  } else {
    const dir = path.resolve(config.PGLITE_DIR);
    mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return {
    db: db as unknown as Db,
    kind: config.DB_MODE === "memory" ? "memory" : "pglite",
    ping: async () => {
      try {
        await client.query("select 1");
        return true;
      } catch {
        return false;
      }
    },
    close: () => client.close(),
  };
}
