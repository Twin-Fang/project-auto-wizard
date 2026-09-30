// Path constants: install target (user repo) paths plus the payload's internal layout.
import { join } from "node:path";

export const PATHS = {
  versionFile: "version.yml",
  workflowsDir: ".github/workflows",
  scriptsDir: ".github/scripts",
};

// Layout inside payload/ (payload is the single source of truth)
export const PAYLOAD = {
  workflowsDir: "workflows",   // payload/workflows/{common,spring,flutter,...}
  scriptsDir: "scripts",       // payload/scripts/*.py
  configDir: "config",         // payload/config/wizard-prompts.yml etc. (for the wizard runtime)
};

// Source workflow folders of one type [directly under the type, under server-deploy]; callers check existence.
// Install, conflict scan, preview and deploy-style detection must all see the same folder layout so their results do not diverge.
export function typeWorkflowDirs(payloadRoot, type) {
  const typeDir = join(payloadRoot, PAYLOAD.workflowsDir, type);
  return [typeDir, join(typeDir, "server-deploy")];
}

export const WORKFLOW_PREFIX = "PROJECT";
export const WORKFLOW_COMMON_PREFIX = "PROJECT-COMMON";

// Path normalization: strips surrounding whitespace, converts \ to /, removes a trailing / and a leading ./, empty becomes "."
export function normalizePath(p) {
  let s = String(p).trim();
  s = s.replace(/\\/g, "/");
  s = s.replace(/\/+$/, "");   // trailing /
  s = s.replace(/^\.\//, "");  // leading ./
  return s === "" ? "." : s;
}

// Whether a normalized path stays inside the repo (relative, no '..'). A path pointing outside would create the
// installed files (fastlane etc.) in a neighboring repo, and the workflow paths filter would not work either.
export function isRepoRelativePath(p) {
  if (/^\//.test(p) || /^[A-Za-z]:/.test(p)) return false;
  return !p.split("/").includes("..");
}
