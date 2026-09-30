// Removal-target detector - works out which files the wizard installed.
// Shared base of uninstall (item checklist) and purge (hidden dev mode); it deletes nothing.
//
// Principle: the union of (a) files whose name exactly matches one in the current payload and (b) installed
// workflow files that start with the wizard-managed marker (MANAGED_WORKFLOW_MARKER) is the removal target.
// (a) alone missed files installed by an older version whose payload filename was later renamed or deleted
// (the original bug). (b) alone would regress by missing every existing install made before the marker
// existed (whose filenames still match the current payload) - so both are used together as a union. The marker
// ships only in payload templates released after that fix, so what path (b) newly catches is only
// "renamed or deleted files that carry the marker".
// However, the marker follows a workflow the user copied and merely renamed. So (b) accepts only filenames
// recorded in the baseline, and only for old installs without a baseline falls back to the PROJECT-* prefix.
// User-made workflows, version.yml, README and .gitignore are not targets
// (version.yml is the user's version data - an artifact, not a removal target).
//
// This file used to be src/commands/revert.js. The revert mode was removed as a subset of uninstall,
// and only the detection logic remained, moved to core rather than commands.
import { join, isAbsolute } from "node:path";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { PATHS } from "./paths.js";
import { BASELINE_DIR, BASELINE_PATH, readBaseline, appFileHash, sha256 } from "./baseline.js";
import { LOG_DIR } from "./logger.js";
import { payloadWorkflowNames } from "./deploy-style.js";
import { SCRIPT_NAMES } from "./copy/simple.js";

// Fixed marker planted on the first line of payload/workflows/**/*.yaml - changing this value breaks matching with past installs.
export const MANAGED_WORKFLOW_MARKER = "# project-auto-wizard:managed-workflow";

// Set of filenames starting with the managed marker in the installed workflows directory (flat layout).
// .bak/.template.yaml backups are verbatim copies of the original text and keep the marker,
// so they are recognized the same way without inferring from extension or filename.
function markedWorkflowNames(wfDir) {
  const names = new Set();
  if (!existsSync(wfDir)) return names;
  for (const entry of readdirSync(wfDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const firstLine = readFileSync(join(wfDir, entry.name), "utf8").split("\n", 1)[0].replace(/\r$/, "");
    if (firstLine === MANAGED_WORKFLOW_MARKER) names.add(entry.name);
  }
  return names;
}

// Whether a marked file was installed by the wizard - .bak/.template.yaml backups are judged by the original filename.
// recorded: set of filenames in the baseline, null when there is no baseline.
function isInstalledName(name, recorded) {
  if (!recorded) return name.startsWith("PROJECT-");
  const stem = name.endsWith(".bak") ? name.slice(0, -".bak".length) : name;
  const candidates = [name, stem];
  if (stem.endsWith(".template.yaml")) {
    const base = stem.slice(0, -".template.yaml".length);
    candidates.push(base, base + ".yaml");
  }
  return candidates.some((c) => recorded.has(c));
}

// Backup-derived files created by conflict handling/cleanup (.bak/.template.yaml) - what the auto-added .gitignore entries hide.
// If these files remain after a removal that keeps the workflows, the .gitignore entries must stay too, or they show up in git status.
export const backupArtifacts = (names) => names.filter((n) => n.endsWith(".bak") || n.endsWith(".template.yaml"));

// Pure function that deletes nothing - shared by uninstall/purge/--dry-run.
export function planRemoval(payloadRoot, targetRoot = ".") {
  const removedWf = new Set();
  const removedScripts = [];
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  const baseline = readBaseline(targetRoot);
  if (existsSync(wfDir)) {
    // (a) Files whose name matches the current payload - marker or not (prevents regressing existing installs).
    for (const name of payloadWorkflowNames(payloadRoot)) {
      const p = join(wfDir, name);
      if (existsSync(p)) removedWf.add(name);
      const templateName = (name.endsWith(".yaml") ? name.slice(0, -".yaml".length) : name) + ".template.yaml";
      if (existsSync(join(wfDir, templateName))) removedWf.add(templateName);
      if (existsSync(p + ".bak")) removedWf.add(name + ".bak");
    }
    // (b) Files starting with the managed marker - also recognizes files renamed or deleted in the payload.
    const recorded = baseline ? new Set(Object.keys(baseline.files)) : null;
    for (const name of markedWorkflowNames(wfDir)) {
      if (isInstalledName(name, recorded)) removedWf.add(name);
    }
  }
  for (const s of SCRIPT_NAMES) {
    if (existsSync(join(targetRoot, PATHS.scriptsDir, s))) removedScripts.push(s);
  }
  // Flutter app files (Fastfile etc.) only if the wizard newly created them and the content is unchanged - a file with filled-in values belongs to the user.
  const appFiles = [];
  for (const [rel, hash] of Object.entries(baseline?.appFiles || {})) {
    if (rel.split(/[\\/]/).includes("..") || isAbsolute(rel)) continue; // paths outside the repo are not trusted
    const p = join(targetRoot, rel);
    if (existsSync(p) && appFileHash(readFileSync(p, "utf8")) === hash) appFiles.push(rel);
  }
  // The baseline is an internal state file made by the wizard - it must disappear along with the installed files.
  // If left, the next install would mistake everything for "files installed before and deleted by the user" and classify all as removed.
  // If only the run logs (.wizard/logs) remain, the whole folder goes too - a log folder left after all
  // installed files are gone is not a "complete removal".
  const baselineDirs = existsSync(join(targetRoot, BASELINE_PATH)) || existsSync(join(targetRoot, LOG_DIR)) ? [BASELINE_DIR] : [];
  return { workflows: [...removedWf], scripts: removedScripts, appFiles, baseline: baselineDirs };
}

// Old workflows to clean up on update - files the wizard installed (baseline record + managed marker) that are not in the payload now.
// They were renamed or dropped in the payload, so leaving them keeps running with the old triggers and procedure.
// Files not in the baseline are not targets - they may be workflows the user made by copying a wizard file.
export function findStaleWorkflows(payloadRoot, targetRoot = ".", baseline = null) {
  if (!baseline?.files) return [];
  const current = payloadWorkflowNames(payloadRoot);
  return [...markedWorkflowNames(join(targetRoot, PATHS.workflowsDir))]
    .filter((n) => /\.ya?ml$/.test(n) && !n.endsWith(".template.yaml") && !current.has(n) && baseline.files[n])
    .sort();
}

// Same rule as deploy-style cleanup - untouched files (installed hash matches) are deleted, touched files are moved to .bak
// to keep the content while switching off the trigger. With dryRun only the verdict is made and no file is touched (for the --dry-run preview).
export function cleanupStaleWorkflows(targetRoot, names, baseline, { dryRun = false } = {}) {
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  const removed = [];
  const backedUp = [];
  for (const name of names) {
    const p = join(wfDir, name);
    if (!existsSync(p)) continue;
    const known = baseline?.files?.[name]?.installed;
    if (known && sha256(readFileSync(p, "utf8")) === known) {
      if (!dryRun) rmSync(p, { force: true });
      removed.push(name);
    } else {
      if (!dryRun) renameSync(p, `${p}.bak`);
      backedUp.push(name);
    }
  }
  return { removed, backedUp };
}
