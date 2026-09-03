import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Config } from "../config";
import { schema } from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  kind: "pglite" | "postgres" | "memory";
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const migrationsFolder = path.resolve(here, "../../drizzle");

export async function createDb(config: Config): Promise<DbHandle> {
  if (config.DB_MODE === "postgres") {
    if (!config.DATABASE_URL) throw new Error("DB_MODE=postgres requires DATABASE_URL");
    const { default: pg } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });
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
