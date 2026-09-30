// status command: read-only install state check. No network access (local file comparison only).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseExisting, droppedPathLines } from "../core/version-yml.js";
import { OPTIONS } from "../core/options.js";
import { planWorkflows } from "../core/copy/workflows.js";
import { makeResolvers, detectRepoName, detectDefaultBranch } from "../core/detect-fs.js";
import { PATHS } from "../core/paths.js";
import { isDeployStyle, DEFAULT_DEPLOY_STYLE } from "../core/deploy-style.js";
import { findMissingScripts } from "../core/copy/simple.js";
import { findStaleWorkflows } from "../core/removal-plan.js";
import { readBaseline } from "../core/baseline.js";
import { hooksFor, mergeHookResults } from "../core/types.js";
import { t } from "../i18n/index.js";

// payloadRoot: the package's payload/ root. targetRoot: the repo whose state is checked.
export function runStatus(payloadRoot, targetRoot = ".") {
  const vyPath = join(targetRoot, PATHS.versionFile);
  if (!existsSync(vyPath)) return { installed: false };

  const existing = parseExisting(readFileSync(vyPath, "utf8"));
  const repoName = detectRepoName(targetRoot);
  // Apply the env mode, deploy mode and store selection substituted into the workflows at install time to the
  // comparison as well; otherwise unmodified files show up as drift and deselected store workflows as "deleted".
  const typeOptions = mergeHookResults(existing.types, "resolveOptions", { existing });
  const resolvers = makeResolvers(targetRoot, repoName, existing.paths, typeOptions);
  // Without a branches block in version.yml (install predating the feature, or hand-edited), makeSrcText(null)
  // cannot substitute {{MAIN_BRANCH}}/{{DEVELOP_BRANCH}} and every workflow is falsely reported as drift, so
  // fall back to defaults for the comparison (not the real saved values, but enough for drift detection).
  const branchesForCompare = existing.branches || { main: detectDefaultBranch(targetRoot) || "main", develop: "develop", mode: "pr-flow" };
  const context = {
    types: existing.types, paths: existing.paths,
    repoName, resolvers, branches: branchesForCompare,
    ...mergeHookResults(existing.types, "contextFields", typeOptions),
    // Compare using the deploy style chosen at install so nginx/traefik CD edits are caught as drift too.
    // If omitted, the default (simple) filters out the installed zero-downtime CD from the comparison.
    deployStyle: isDeployStyle(existing.options.deployStyle) ? existing.options.deployStyle : DEFAULT_DEPLOY_STYLE,
  };
  const plan = planWorkflows(context, payloadRoot, targetRoot);
  // Old workflows absent from the current version are cleaned up on the next update; until then they keep running on the old triggers.
  const stale = findStaleWorkflows(payloadRoot, targetRoot, readBaseline(targetRoot));

  return {
    installed: true,
    version: existing.version,
    templateVersion: existing.templateVersion,
    types: existing.types,
    branches: existing.branches,
    options: existing.options,
    // Files the user touched = real conflicts (changed) + upstream unchanged but locally edited (localOnly).
    // Without a baseline localOnly is always empty, so behavior is the same as before.
    modifiedFiles: [...plan.changed, ...plan.localOnly].map((f) => f.filename),
    // Buckets that preview what an update would do, so users no longer have to run git diff themselves for lack of information.
    buckets: {
      autoUpdatable: plan.upstreamOnly.map((f) => f.filename), // replaced with the latest without asking
      localKept: plan.localOnly.map((f) => f.filename),        // local edit kept without asking
      conflicts: plan.changed.map((f) => f.filename),          // changed on both sides; needs review
      removed: plan.removed.map((f) => f.filename),            // deleted by the user and not restored
    },
    staleFiles: stale,
    // Installed scripts the workflows need but the repo no longer has; the workflow comparison above cannot see them.
    missingScripts: findMissingScripts(payloadRoot, targetRoot),
    droppedPaths: existing.droppedPaths,
  };
}

export function printStatus(status) {
  const lines = ["", t("cmd.status.title"), ""];
  if (!status.installed) {
    lines.push(t("cmd.status.notInstalled"), "");
    console.log(lines.join("\n"));
    return;
  }
  lines.push(t("cmd.status.version", { value: status.version }));
  lines.push(t("cmd.status.templateVersion", { value: status.templateVersion }));
  lines.push(t("cmd.status.types", { value: status.types.join(", ") || t("cmd.status.none") }));
  if (status.branches) {
    lines.push(t("cmd.status.branchMode", { mode: status.branches.mode, main: status.branches.main, develop: status.branches.develop }));
  }
  // An unset option is shown with the value it resolves to on this (existing) install, i.e. its legacyDefault.
  const unsetLabel = (o) => t(o.legacyDefault ? "cmd.status.unsetDefaultTrue" : "cmd.status.unsetDefaultFalse");
  const optionLabels = OPTIONS.map((o) => `${o.key}=${status.options[o.name] ?? unsetLabel(o)}`).join(" ");
  const typeLabels = hooksFor(status.types, "statusLabels").map(({ hook }) => hook(status.options)).join("");
  const deployLabel = status.options.deployStyle ? ` deploy_style=${status.options.deployStyle}` : "";
  lines.push(t("cmd.status.options", { value: `${optionLabels}${deployLabel}${typeLabels}` }));
  if (status.modifiedFiles.length) {
    lines.push("", t("cmd.status.modified", { n: status.modifiedFiles.length }));
    for (const f of status.modifiedFiles) lines.push(`  - ${f}`);
  } else {
    lines.push("", t("cmd.status.unmodified"));
  }

  if (status.staleFiles?.length) {
    lines.push("", t("cmd.status.stale", { n: status.staleFiles.length }));
    for (const f of status.staleFiles) lines.push(`  - ${f}`);
  }

  if (status.missingScripts?.length) {
    lines.push("", t("cmd.status.missingScripts", { n: status.missingScripts.length, dir: PATHS.scriptsDir }));
    for (const f of status.missingScripts) lines.push(`  - ${f}`);
    lines.push(t("cmd.status.missingScriptsFix"));
  }
  if (status.droppedPaths?.length) {
    lines.push("", ...droppedPathLines(status.droppedPaths).map((l) => `⚠️  ${l}`));
  }

  // What an update would do. Installs without a baseline are all zeros, so nothing is printed.
  const b = status.buckets || { autoUpdatable: [], localKept: [], conflicts: [], removed: [] };
  if (b.autoUpdatable.length || b.localKept.length || b.conflicts.length || b.removed.length) {
    lines.push("", t("cmd.status.bucketsTitle"));
    lines.push(t("cmd.status.bucketAuto", { n: String(b.autoUpdatable.length).padStart(3) }));
    lines.push(t("cmd.status.bucketLocalKept", { n: String(b.localKept.length).padStart(3) }));
    lines.push(t("cmd.status.bucketConflicts", { n: String(b.conflicts.length).padStart(3) }));
    lines.push(t("cmd.status.bucketRemoved", { n: String(b.removed.length).padStart(3) }));
  }
  lines.push("");
  console.log(lines.join("\n"));
}
