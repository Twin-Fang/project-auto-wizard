// Shared removal executor for uninstall and purge - the two commands only turn options into a removal plan,
// and the actual deletion and logging happen here in one place. Target detection is done by removal-plan.js (read-only).
import { join, posix } from "node:path";
import { readdirSync, rmdirSync } from "node:fs";
import { PATHS } from "./paths.js";
import { remove } from "./fsutil.js";
import { removeVersionSectionFromReadme } from "./copy/readme.js";
import { removeAutoAddedEntriesFromGitignore } from "./copy/gitignore.js";
import { logRemovals } from "./logger.js";
import { t } from "../i18n/index.js";

// After deleting files, clean up the parent folders that became empty, up to just below the repo root (fastlane/ etc. made by the wizard).
// It stops at the first non-empty folder, so folders still holding user files are left alone.
export function pruneEmptyDirs(targetRoot, relDir) {
  let rel = relDir;
  while (rel && rel !== "." && rel !== "/") {
    const abs = join(targetRoot, rel);
    try {
      if (readdirSync(abs).length) break;
      rmdirSync(abs);
    } catch { break; }
    rel = posix.dirname(rel);
  }
}

// Remove Flutter app files - only unmodified ones enter the plan, so delete them as-is and tidy empty folders.
// Logs are written all at once after deletion finishes, so entries to record are collected in done.
export function removeAppFiles(targetRoot, appFiles, done = []) {
  for (const rel of appFiles) {
    remove(join(targetRoot, rel));
    pruneEmptyDirs(targetRoot, posix.dirname(rel));
    done.push(["remove", "flutter-app", rel]);
  }
}

// Clean up .github/workflows and .github/scripts (and .github) that became empty after removing installed files.
// Only when something was deleted from that folder this run - folders that were empty to begin with are not touched.
export function pruneInstallDirs(targetRoot, plan) {
  if (plan.workflows.length || plan.baseline?.length) pruneEmptyDirs(targetRoot, PATHS.workflowsDir);
  if (plan.scripts.length) pruneEmptyDirs(targetRoot, PATHS.scriptsDir);
}

// plan: { workflows, scripts, appFiles, baseline, versionYml, readme, gitignore, changelog } - each is a "to delete" flag/list.
// options.logOrder: record order of the trailing entries (version, readme, gitignore, changelog) - each command keeps its existing order.
// options.gitignoreDetail(status): the .gitignore log text. Returning null means nothing is recorded.
// Returns: what was actually removed - readme/gitignore may be safely given up (skip-*) even if the plan targeted them, so the actual result overrides.
export function executeRemoval(targetRoot, plan, { logOrder, gitignoreDetail }) {
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  const done = [];
  for (const name of plan.workflows) { remove(join(wfDir, name)); done.push(["remove", "workflow", name]); }
  for (const name of plan.scripts) { remove(join(targetRoot, PATHS.scriptsDir, name)); done.push(["remove", "script", name]); }
  removeAppFiles(targetRoot, plan.appFiles, done);
  for (const p of plan.baseline || []) { remove(join(targetRoot, p)); done.push(["remove", "metadata", p]); }
  pruneInstallDirs(targetRoot, plan);

  const entries = { version: [], readme: [], gitignore: [], changelog: [] };
  const readme = !!plan.readme && removeVersionSectionFromReadme(targetRoot) === "removed";
  const gitignoreStatus = plan.gitignore ? removeAutoAddedEntriesFromGitignore(targetRoot) : null;
  const gitignore = gitignoreStatus === "removed" || gitignoreStatus === "file-deleted";
  if (plan.versionYml) { remove(join(targetRoot, PATHS.versionFile)); entries.version.push(["remove", "version", PATHS.versionFile]); }
  for (const f of plan.changelog || []) { remove(join(targetRoot, f)); entries.changelog.push(["remove", "changelog", f]); }
  if (readme) entries.readme.push(["remove", "readme", t("core.removalExec.readmeSection")]);
  const detail = gitignoreStatus && gitignoreDetail(gitignoreStatus);
  if (detail) entries.gitignore.push(["remove", "gitignore", detail]);
  for (const k of logOrder) done.push(...entries[k]);
  logRemovals(targetRoot, done);
  return { readme, gitignore };
}
