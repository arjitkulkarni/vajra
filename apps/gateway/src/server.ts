import { eq, sql } from "drizzle-orm";
import { buildApp } from "./app";
import { consoleUrl } from "./lib/console-key";
import { users } from "./db/schema";
import { seedDemo } from "./modules/demo/seed";

const { app, ctx, close } = await buildApp();

// A fresh database with DEMO_MODE on seeds itself, so `pnpm dev` is genuinely one command.
if (ctx.config.DEMO_MODE) {
  const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(users);
  if ((count?.n ?? 0) === 0) {
    app.log.info("empty database with DEMO_MODE=true — seeding demo identities, policies and assets");
    await seedDemo(ctx);
  }
}

ctx.outbox.start();
void ctx.outbox.drain();

await app.listen({ port: ctx.config.PORT, host: ctx.config.HOST });
app.log.info(
  { db: ctx.config.DB_MODE, ledger: ctx.config.LEDGER_MODE, storage: ctx.config.STORAGE_MODE, risk: ctx.config.RISK_MODE, analyst: ctx.config.ANALYST_MODE, demo: ctx.config.DEMO_MODE },
  "VAJRA Trust Gateway ready",
);

/*
 * The console link, printed where the operator already is.
 *
 * It goes to stderr rather than through the logger on purpose: pino would fold it into a JSON line
 * that is a nuisance to select with a mouse, and this exists to be copied. It is also the one place
 * the key is ever written down — after this, it lives in the browser's session storage and travels
 * as a header.
 */
{
  const url = consoleUrl(ctx.config.WEB_ORIGIN, ctx.config.ADMIN_CONSOLE_SECRET);
  const rotate = ctx.config.ADMIN_CONSOLE_SECRET === "dev-only-admin-console-secret-change-me" ? "  (default secret — set ADMIN_CONSOLE_SECRET before anyone else can reach this host)" : "";
  process.stderr.write(`\n  Admin console → ${url}${rotate}\n  Reprint any time with: pnpm admin:url\n\n`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.log.info("shutting down");
    void close().then(() => process.exit(0));
  });
}
void eq;
