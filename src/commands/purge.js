// purge mode: on top of everything planRemoval identifies (workflows, scripts), also removes version.yml, the README
// AUTO-VERSION-SECTION block, auto-added .gitignore entries and the CHANGELOG created by the release
// workflow, restoring the pre-install state completely. Files the wizard did not create are never deleted.
// Hidden development/testing mode.
// Deleting the develop branch differs in nature from deleting files (it needs a run-time git state
// judgment), so it is not part of this plan and is handled directly in the purge branch of index.js.
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { PATHS } from "../core/paths.js";
import { planRemoval, backupArtifacts } from "../core/removal-plan.js";
import { executeRemoval } from "../core/removal-exec.js";
import { hasVersionSection } from "../core/copy/readme.js";
import { hasAutoAddedEntries } from "../core/copy/gitignore.js";
import { t } from "../i18n/index.js";

const CHANGELOG_FILES = ["CHANGELOG.json", "CHANGELOG.md"];

// Whether the CHANGELOG was created by changelog_manager.py: judged by content so a CHANGELOG.md the user
// wrote themselves is not deleted. CHANGELOG.json is recognized by its metadata/releases structure, and
// CHANGELOG.md by the header generate-md writes. If the JSON is ours, the MD is regenerated wholesale from
// the JSON on every release, so it is ours too.
// The header's label may be localized by the script, so both the Korean and English wording are accepted
// (the Korean label is written as escapes to keep this source free of Hangul).
const GENERATED_MD_HEADER = /^# Changelog\n\n\*\*(?:\uD604\uC7AC \uBC84\uC804|Current version):\*\*/;
function readText(targetRoot, f) {
  try { return readFileSync(join(targetRoot, f), "utf8").replace(/\r\n/g, "\n"); } catch { return null; }
}
function isGeneratedChangelogJson(targetRoot) {
  const text = readText(targetRoot, "CHANGELOG.json");
  if (text === null) return false;
  try {
    const data = JSON.parse(text);
    return !!data && typeof data.metadata === "object" && Array.isArray(data.releases);
  } catch { return false; }
}
function generatedChangelogFiles(targetRoot) {
  const jsonOurs = isGeneratedChangelogJson(targetRoot);
  const md = readText(targetRoot, "CHANGELOG.md");
  const mdOurs = md !== null && (jsonOurs || GENERATED_MD_HEADER.test(md));
  return CHANGELOG_FILES.filter((f) => (f === "CHANGELOG.json" ? jsonOurs : mdOurs));
}

// keepFlags: { versionYml, readme, changelog, workflows, scripts }: categories set to true are excluded from the candidates.
// Returns { workflows, scripts, versionYml, readmeSection, gitignore, changelog }: a pure function that deletes nothing.
export function planPurge(payloadRoot, targetRoot = ".", keepFlags = {}) {
  const removalPlan = planRemoval(payloadRoot, targetRoot);
  // If the workflows stay, so do their .bak/.template.yaml; removing the .gitignore entries too would surface the backup files in git status.
  const gitignoreKept = hasAutoAddedEntries(targetRoot) && keepFlags.workflows === true
    && backupArtifacts(removalPlan.workflows).length > 0;
  return {
    workflows: keepFlags.workflows ? [] : removalPlan.workflows,
    // The creation record of Flutter app files lives in the baseline, so they follow the same flag as the baseline.
    appFiles: keepFlags.workflows ? [] : removalPlan.appFiles,
    baseline: keepFlags.workflows ? [] : removalPlan.baseline,
    scripts: keepFlags.scripts ? [] : removalPlan.scripts,
    versionYml: !keepFlags.versionYml && existsSync(join(targetRoot, PATHS.versionFile)),
    readmeSection: !keepFlags.readme && hasVersionSection(targetRoot),
    gitignore: hasAutoAddedEntries(targetRoot) && !gitignoreKept,
    gitignoreKept,
    changelog: keepFlags.changelog ? [] : generatedChangelogFiles(targetRoot),
  };
}

// Summary printed before deletion; reused by both the dry-run preview and the summary before a real run.
export function printPurgePlan(plan, { dryRun = false } = {}) {
  const lines = ["",
    dryRun
      ? t("cmd.purge.headerDry")
      : t("cmd.purge.header"),
    ""];
  lines.push(t("cmd.purge.workflows", { n: plan.workflows.length }));
  for (const f of plan.workflows) lines.push(`  - ${f}`);
  lines.push(t("cmd.purge.scripts", { n: plan.scripts.length }));
  for (const f of plan.scripts) lines.push(`  - ${f}`);
  for (const f of plan.appFiles || []) lines.push(t("cmd.purge.appFile", { file: f }));
  if (plan.versionYml) lines.push(t("cmd.purge.versionYml"));
  if (plan.readmeSection) lines.push(t("cmd.purge.readmeSection"));
  if (plan.gitignore) lines.push(t("cmd.purge.gitignore"));
  if (plan.gitignoreKept) lines.push(t("cmd.purge.gitignoreKept"));
  for (const f of plan.changelog) lines.push(t("cmd.purge.file", { file: f }));
  lines.push("");
  console.log(lines.join("\n"));
}

// Performs the actual deletion: returns the same shape as planPurge() but reflecting what was really removed.
// Why the planRemoval result is not deleted as is: that list is always the full set, which does not fit
// the requirement to preserve selected categories via --keep-*.
// readmeSection does not echo the plan's decision but reflects the actual return value of
// removeVersionSectionFromReadme() (whether it was "removed"), so even if the plan and the real removal
// condition theoretically diverge, printPurgeResult never falsely reports "removed".
export function executePurge(payloadRoot, targetRoot = ".", keepFlags = {}) {
  const plan = planPurge(payloadRoot, targetRoot, keepFlags);
  const { readme, gitignore } = executeRemoval(targetRoot, { ...plan, readme: plan.readmeSection }, {
    logOrder: ["version", "gitignore", "changelog", "readme"],
    gitignoreDetail: (status) => (status === "removed" || status === "file-deleted" ? t("cmd.purge.gitignoreLog") : null),
  });
  return { ...plan, readmeSection: readme, gitignore };
}

// Prints the list actually removed after deletion, in exactly the same form as printPurgePlan (file names
// listed); printing only counts would not show what was deleted.
export function printPurgeResult(result) {
  const lines = ["", t("cmd.purge.removedHeading"), ""];
  lines.push(t("cmd.purge.workflows", { n: result.workflows.length }));
  for (const f of result.workflows) lines.push(`  - ${f}`);
  lines.push(t("cmd.purge.scripts", { n: result.scripts.length }));
  for (const f of result.scripts) lines.push(`  - ${f}`);
  for (const f of result.appFiles || []) lines.push(t("cmd.purge.appFile", { file: f }));
  if (result.versionYml) lines.push(t("cmd.purge.versionYml"));
  if (result.readmeSection) lines.push(t("cmd.purge.readmeSection"));
  if (result.gitignore) lines.push(t("cmd.purge.gitignore"));
  for (const f of result.changelog) lines.push(t("cmd.purge.file", { file: f }));
  lines.push("");
  console.log(lines.join("\n"));
}
