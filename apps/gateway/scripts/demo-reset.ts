import { buildApp } from "../src/app";
import { resetDemo } from "../src/modules/demo/seed";

const { ctx, close } = await buildApp({ LOG_LEVEL: "warn" });
const result = await resetDemo(ctx);
await ctx.outbox.drain();
console.log("VAJRA demo state rebuilt:");
for (const u of result.users) console.log(`  ${u.role.padEnd(9)} ${u.name.padEnd(14)} ${u.did}`);
console.log(`  policies: 7 · assets: 2 · ledger blocks written`);
await close();
process.exit(0);
