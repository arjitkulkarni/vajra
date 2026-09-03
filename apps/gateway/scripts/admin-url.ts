/**
 * Print the current admin console link.
 *
 * Derived, not stored: the same keyed digest the gateway recomputes on every admin request, so this
 * agrees with a running server by construction and there is nothing to get out of sync. Change
 * ADMIN_CONSOLE_SECRET and every link printed before that moment stops working.
 *
 * This link now SIGNS YOU IN. It used to be a second factor layered on top of a face-verified admin
 * session; it is now the credential itself, so that a fresh database has some way to approve its
 * own first enrolment — see src/modules/identity/console-session.ts for the whole argument. The two
 * warnings below are therefore not hygiene advice any more. They are the controls that remain.
 */
import { loadConfig } from "../src/config";
import { consoleKey, consoleUrl } from "../src/lib/console-key";

const config = loadConfig();
const isDefault = config.ADMIN_CONSOLE_SECRET === "dev-only-admin-console-secret-change-me";
const out = (line: string) => process.stdout.write(`${line}\n`);

out("");
out(`  ${consoleUrl(config.WEB_ORIGIN, config.ADMIN_CONSOLE_SECRET)}`);
out("");
out(`  key      ${consoleKey(config.ADMIN_CONSOLE_SECRET)}`);
out(`  origin   ${config.WEB_ORIGIN}`);
out(`  network  ${config.ADMIN_IP_ALLOWLIST || "(unrestricted — set ADMIN_IP_ALLOWLIST)"}`);
out("");
out("  Anyone who opens this link is an administrator. No face check, no sign-in.");
out("");

if (isDefault) {
  out("  !  This is the shipped default secret, which means it is not a secret — and it is");
  out("     now the whole credential. Every copy of this repository derives the same link.");
  out("     Set ADMIN_CONSOLE_SECRET in .env before this host is reachable by anyone else:");
  out(`       node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`);
  out("");
}

if (!config.ADMIN_IP_ALLOWLIST) {
  out("  !  ADMIN_IP_ALLOWLIST is empty, so the link is the only thing standing in front of");
  out("     the control plane. Fine on a laptop; set it on anything reachable by others.");
  out("");
}
