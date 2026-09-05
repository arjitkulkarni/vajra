import { sql } from "drizzle-orm";
import { buildApp } from "./app";
import { consoleUrl } from "./lib/console-key";
import { users } from "./db/schema";
import { seedDemo } from "./modules/demo/seed";

const { app, ctx, close } = await buildApp();

/*
 * A fresh database with DEMO_MODE on seeds itself, so `pnpm dev` is genuinely one command.
 *
 * Seeding is deliberately not allowed to abort the boot. Against a managed Postgres the very first
 * queries of a deploy are the ones most likely to fail — a Neon branch resuming from cold answers
 * the migration and then drops the next connection — and a gateway that exits there is restarted
 * into exactly the same race. An unseeded gateway still serves every endpoint; a crash-looping one
 * serves none, so the failure is logged and the process carries on.
 */
if (ctx.config.DEMO_MODE) {
  try {
    const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(users);
    if ((count?.n ?? 0) === 0) {
      app.log.info("empty database with DEMO_MODE=true — seeding demo identities, policies and assets");
      await seedDemo(ctx);
    }
  } catch (e) {
    app.log.error({ err: (e as Error).message }, "demo seeding failed — starting with the database as it is");
  }
}

ctx.outbox.start();
// Fire-and-forget catch-up on boot: a backlog that cannot be drained now is not a reason to refuse
// to start, and the interval worker will pick the rows up.
ctx.outbox.drain().catch((e) => app.log.warn({ err: (e as Error).message }, "initial outbox drain failed"));

await app.listen({ port: ctx.config.PORT, host: ctx.config.HOST });
app.log.info(
  { db: ctx.config.DB_MODE, ledger: ctx.config.LEDGER_MODE, storage: ctx.config.STORAGE_MODE, risk: ctx.config.RISK_MODE, analyst: ctx.config.ANALYST_MODE, demo: ctx.config.DEMO_MODE },
  "VAJRA Trust Gateway ready",
);

/*
 * The last-resort net, installed only now that the listener is up.
 *
 * Node terminates the process on an unhandled rejection and on an 'error' event nobody is listening
 * for, which is the correct default for a script and the wrong one for a service: the gateway does
 * real work off the request path — the outbox worker, the anchoring handlers, a connection pool
 * holding sockets to a database somewhere else — and every one of those is a place a network
 * failure can surface with no caller left to catch it. Unguarded, a dropped connection is not a
 * logged warning but an exit, and a host that restarts on exit turns one bad socket into a crash
 * loop. Each known case is handled where it happens; this catches the ones that are left.
 *
 * It goes after `listen` on purpose. A failure *before* this point is a failure to start — bad
 * configuration, an unreachable database, a migration that will not apply — and those should stop
 * the deploy loudly rather than leave a process alive that answers nothing.
 */
process.on("unhandledRejection", (reason) => {
  app.log.error({ err: reason instanceof Error ? reason.message : String(reason) }, "unhandled promise rejection — the gateway is staying up");
});
process.on("uncaughtException", (err) => {
  app.log.error({ err: err.message, stack: err.stack }, "uncaught exception — the gateway is staying up");
});

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

/*
 * Shutdown runs far more often than it looks: a host redeploying sends SIGTERM, and so does a free
 * instance being put to sleep. So this path has to be incapable of failing. A rejected close() used
 * to escape as an unhandled rejection and exit non-zero, which a host reads as a crash rather than
 * a clean stop; and a close() that hangs on a socket to a database that has already gone away used
 * to sit there until it was killed. Whatever happens, exit zero, and exit promptly.
 */
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    setTimeout(() => process.exit(0), 5_000).unref();
    close().then(
      () => process.exit(0),
      (e) => {
        app.log.warn({ err: (e as Error).message }, "shutdown was not clean; exiting anyway");
        process.exit(0);
      },
    );
  });
}
