// Infers platforms from the file names of already-installed store deploy workflows.
// Targets existing installs whose version.yml has no flutter_store value: treating a missing value as "nothing
// selected" would make the deselection cleanup rule delete store workflows that were working fine.
import { existsSync, readdirSync } from "node:fs";
import { STORE_PLATFORMS, STORE_WORKFLOWS } from "./flutter-options.js";

// Returns the platforms with at least one store workflow installed (in STORE_PLATFORMS order).
export function inferInstalledStores(workflowsDir) {
  if (!existsSync(workflowsDir)) return [];
  const installed = new Set(readdirSync(workflowsDir));
  return STORE_PLATFORMS.filter((platform) => STORE_WORKFLOWS[platform].some((file) => installed.has(file)));
}
