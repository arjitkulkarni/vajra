/**
 * The normal baseline: what each role may attempt when nothing is degraded.
 *
 * Mirrors `ROLE_ACTIONS` in @vajra/policy. The gateway remains the authority — this table exists
 * only so the console can draw "now" against "normal" without a second round trip, and it is
 * deliberately the same short list the engine uses.
 */
import type { Action, PermissionState, Role } from "@vajra/contracts";

export const ROLE_BASELINE: Record<Role, Action[]> = {
  engineer: ["asset.view", "asset.open", "asset.download", "asset.transfer"],
  manager: ["asset.view", "asset.open", "asset.download", "asset.transfer", "asset.export"],
  auditor: ["asset.view"],
  admin: ["asset.view", "asset.open", "asset.download", "asset.transfer", "asset.export", "asset.delete", "policy.edit", "identity.revoke"],
};

/** The asset actions the console draws in the effective-access matrix, in escalating order. */
export const ASSET_ACTIONS: Action[] = ["asset.view", "asset.open", "asset.download", "asset.transfer", "asset.export"];

export function baselineFor(role: Role, action: Action): PermissionState {
  return ROLE_BASELINE[role].includes(action) ? "allow" : "deny";
}
