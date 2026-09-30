// Wiring for the breaking-changes confirmation flow.
// collectBreaking (pure comparison) is in breaking.js - this module handles loading (bundled copy), display and the confirmation gate.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { collectBreaking } from "./breaking.js";
import { parseExisting } from "./version-yml.js";
import { t } from "../i18n/index.js";

// Reads only the payload/config copy bundled with the package. Reading remote (main) would make results
// differ per run even for the same package version, and add a network request during install. null on read failure (silent skip).
export function loadBreakingJson(payloadRoot) {
  try {
    const p = join(payloadRoot, "config", "breaking-changes.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  } catch { /* bundle read failed - skip */ }
  return null;
}

// Returns: true = proceed, false = user cancelled.
// opts:
//   cwd             - integration target root (current template version is read from the existing version.yml)
//   payloadRoot     - package payload/ root (where the bundled breaking-changes.json lives)
//   templateVersion - template version being installed (the actual package version, not a fixed value)
//   askYesNo        - async(message, defaultYes)->bool. null = non-interactive: print the warning and proceed
//   loader          - injected by tests (default loadBreakingJson)
export async function runBreakingCheck({ cwd, payloadRoot, templateVersion, askYesNo = null, loader = loadBreakingJson }) {
  const vy = join(cwd, "version.yml");
  if (!existsSync(vy)) return true; // New integration - nothing to compare against
  const { templateVersion: current, types } = parseExisting(readFileSync(vy, "utf8"));
  if (!current) return true; // No template metadata (unknown) - nothing to compare against, skip

  const json = await loader(payloadRoot);
  if (!json) return true;

  const { critical, warnings } = collectBreaking(json, current, templateVersion, types);
  if (critical.length === 0 && warnings.length === 0) return true;

  // Box display
  const e = (s = "") => process.stderr.write(s + "\n");
  e("");
  e("╔══════════════════════════════════════════════════════════════════╗");
  e(`║  ⚠️  BREAKING CHANGES (v${current} → v${templateVersion})`);
  e("╠══════════════════════════════════════════════════════════════════╣");
  for (const c of critical) { e("║"); e(`║  [CRITICAL] ${c.version} - ${c.title || ""}`); e(`║  → ${c.message || ""}`); }
  for (const w of warnings) { e("║"); e(`║  [WARNING] ${w.version} - ${w.title || ""}`); e(`║  → ${w.message || ""}`); }
  e("║");
  e("╚══════════════════════════════════════════════════════════════════╝");
  e("");

  if (critical.length > 0) {
    if (askYesNo) {
      // Interactive: abort without explicit confirmation (default N)
      const ok = await askYesNo(t("core.breakingCheck.confirm"), false);
      if (ok !== true) return false;
    } else {
      // Non-interactive (--force): do not kill CI with a gate, warn and proceed (CI friendly)
      e(t("core.breakingCheck.nonInteractive"));
    }
  }
  return true;
}
