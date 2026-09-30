// Simple copy functions (unconditional overwrite).
// Single source of truth: scripts in payload/scripts/*.py are installed to .github/scripts/ in the user repo.
// All workflows call this path (python3 .github/scripts/*.py), so a missing script breaks the install at runtime.
import { join } from "node:path";
import { chmodSync, readFileSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { PATHS, PAYLOAD } from "../paths.js";
import { exists, copyFileSync } from "../fsutil.js";

export const SCRIPT_NAMES = ["version_manager.py", "changelog_manager.py", "truncate_release_notes.py", "issue_helper.py"];

// Computes what will happen per file (writes nothing), so the real copy and --dry-run share one decision.
// Returns: [{ name, action: "create" | "overwrite" | "unchanged" }]
export function planScripts(payloadRoot, targetRoot = ".") {
  const out = [];
  for (const name of SCRIPT_NAMES) {
    const src = join(payloadRoot, PAYLOAD.scriptsDir, name);
    if (!exists(src)) continue;
    const dst = join(targetRoot, PATHS.scriptsDir, name);
    const action = !exists(dst) ? "create"
      : readFileSync(dst).equals(readFileSync(src)) ? "unchanged" : "overwrite";
    out.push({ name, action });
  }
  return out;
}

// Scripts are always overwritten with the payload version (+chmod, meaningless but harmless on Windows).
// User-edited scripts are overwritten too, so per-file results are returned for the caller to log.
export function copyScripts(payloadRoot, targetRoot = ".") {
  const results = planScripts(payloadRoot, targetRoot);
  for (const { name } of results) {
    const dst = join(targetRoot, PATHS.scriptsDir, name);
    copyFileSync(join(payloadRoot, PAYLOAD.scriptsDir, name), dst);
    try { chmodSync(dst, 0o755); } catch { /* chmod is meaningless on Windows etc. */ }
  }
  return results;
}

// Older workflow versions committed bytecode left by script imports into bot commits.
// Generation is now prevented, but already committed pyc files do not vanish on update, so they are removed here.
// Scope is only the pyc files in the wizard scripts folder and its __pycache__; no other path is touched.
// Returns paths (relative to targetRoot) of files to remove (removed); the user commits the deletion with the installed files.
export function planScriptBytecode(targetRoot = ".") {
  const base = join(targetRoot, PATHS.scriptsDir);
  const list = (rel) => {
    try {
      return readdirSync(join(base, rel), { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".pyc"))
        .map((e) => [PATHS.scriptsDir, rel, e.name].filter(Boolean).join("/"));
    } catch { return []; }
  };
  return [...list(""), ...list("__pycache__")];
}

export function removeScriptBytecode(targetRoot = ".") {
  const removed = planScriptBytecode(targetRoot);
  for (const rel of removed) rmSync(join(targetRoot, rel), { force: true });
  if (removed.some((rel) => rel.includes("/__pycache__/"))) {
    // remove only when empty; leave it if other files exist
    try { rmdirSync(join(targetRoot, PATHS.scriptsDir, "__pycache__")); } catch { /* not empty */ }
  }
  return removed;
}
