// full mode orchestrator: performs the actual install from the context settled by interactive/non-interactive mode.
// Copy order: workflows (+env substitution) -> flutter app files -> version.yml -> readme -> scripts -> gitignore (conditional)
// gitignore is updated only when conflict backup byproducts (.bak/.template.yaml) were actually created in this run.
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { writeText, findUnwritable } from "../core/fsutil.js";
import { CliError } from "../core/errors.js";
import { PATHS } from "../core/paths.js";
import { renderVersionYml, parseExisting, sameIgnoringTimestamps } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { existingMarkerInDir } from "../core/paths-resolve.js";
import { addVersionSectionToReadme, README_STATUS_LABEL } from "../core/copy/readme.js";
import { copyWorkflows, computeBaselineEntries, makeSrcText } from "../core/copy/workflows.js";
import { copyScripts, removeScriptBytecode } from "../core/copy/simple.js";
import { copyTypeAppFiles } from "../core/copy/app-files.js";
import { ensureGitignore } from "../core/copy/gitignore.js";
import { readBaseline, writeBaseline, appFileHash } from "../core/baseline.js";
import { scanUnsubstituted, classifySecrets, narrowSecretsBySshAuth } from "../core/verify.js";
import { cleanupOtherDeployWorkflows, payloadWorkflowNames, DEFAULT_DEPLOY_STYLE } from "../core/deploy-style.js";
import { hooksFor } from "../core/types.js";
import { findStaleWorkflows, cleanupStaleWorkflows } from "../core/removal-plan.js";
import { log, maskValue } from "../core/logger.js";
import { t } from "../i18n/index.js";

// context: { version, types, paths:Map, branch, versionCode,
//            force, repoName, resolvers, now, today }
// payloadRoot: the package's payload/ root. targetRoot: the install target.
export function runFull(context, payloadRoot, targetRoot = ".", hooks = {}) {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    force = true, now, today, templateVersion = "unknown",
    includeSemverAuto } = context;

  // Check permissions before writing anything: stopping midway would leave a half-installed state.
  const blocked = findUnwritable(targetRoot,
    [".", PATHS.workflowsDir, PATHS.scriptsDir, ".github/.wizard"],
    [PATHS.versionFile, "README.md", ".gitignore", ".github/.wizard/baseline.json"]);
  if (blocked.length) {
    throw new CliError(t("cmd.full.noWritePermission", { list: blocked.map((p) => `  - ${p}`).join("\n") }));
  }

  // Compute the project_paths markers.
  // Use the file that actually exists in that folder, not the canonical marker name: writing "# build.gradle"
  // into version.yml of a repo that only has build.gradle.kts would be the same kind of lie as in the detection log.
  const pathMarkers = new Map();
  for (const [type, p] of paths) {
    const marker = existingMarkerInDir(type, join(targetRoot, p || "."));
    pathMarkers.set(type, marker);
    // If the file does not actually exist, the user picked the type by hand; citing the canonical file name as evidence would look like detection.
    const found = marker && existsSync(join(targetRoot, p || ".", marker));
    log.info("detect", "type", t("cmd.full.log.typeEvidence", { type, evidence: found ? marker : t("cmd.full.log.userChosen") }));
  }
  log.info("detect", "version", `${version}${context.versionSource ? ` (${context.versionSource})` : ""}`);
  log.info("detect", "branch", `${branch}${context.branches ? ` | main=${context.branches.main} develop=${context.branches.develop} mode=${context.branches.mode}` : ""}`);
  logChoices(context, types);
  for (const a of context.envAnswers || []) {
    log.info("prompt", a.isDefault ? "default" : "answer", `${a.key}=${maskValue(a.key, a.value)}`);
  }

  // 1. Copy workflows (+ env substitution) and collect the ask values for the deploy block.
  //    hooks.decisions: Map of interactive three-way conflict decisions (unset = skip, the current force behavior)
  const wfCounters = copyWorkflows(context, payloadRoot, targetRoot, hooks);
  const deployValues = wfCounters.deployValues || new Map(); // Map<type, Map<key,value>>

  // 1-1. Flutter app files (fastlane, ExportOptions): users fill these in, so create them only when missing.
  //      Runs after the workflow copy finishes (the workflows assume these files).
  const flutterApp = copyTypeAppFiles(context, payloadRoot, targetRoot, (tag, action, f) => {
    log.info(tag, action, action === "keep" ? t("cmd.full.log.keepExisting", { file: f }) : f);
  });

  // Preserve unknown top-level fields of an existing version.yml when regenerating it.
  const vyPath = join(targetRoot, PATHS.versionFile);
  const prevVy = existsSync(vyPath) ? readFileSync(vyPath, "utf8") : null;
  const extraTopLevel = prevVy != null ? parseExisting(prevVy).extraTopLevel : [];

  // 2. Generate version.yml (render payload/version.yml.template; full regeneration)
  //    A re-run where only the date lines differ does not rewrite it (idempotent).
  const vyText = renderVersionYml(context, readVersionYmlTemplate(payloadRoot), { pathMarkers, deployValues, extraTopLevel });
  if (prevVy == null || !sameIgnoringTimestamps(prevVy, vyText)) {
    writeText(vyPath, vyText);
    log.info("version", "write", `version.yml (v${version}, code=${versionCode})`);
  } else {
    log.info("version", "skip", t("cmd.full.log.versionUnchanged", { version, code: versionCode }));
  }

  // 3. README version section
  const readme = addVersionSectionToReadme(version, targetRoot);
  log.info("readme", readme === "added" ? "append" : "skip", README_STATUS_LABEL[readme] || readme);

  // 4. scripts (payload/scripts/*.py -> .github/scripts/): always overwritten, so also record that user edits are lost.
  const scripts = copyScripts(payloadRoot, targetRoot);
  for (const { name, action } of scripts) {
    log.info("script", action, `${PATHS.scriptsDir}/${name}${action === "overwrite" ? t("cmd.full.log.scriptOverwritten") : ""}`);
  }
  const bytecodeRemoved = removeScriptBytecode(targetRoot);
  for (const rel of bytecodeRemoved) log.info("script", "remove", t("cmd.full.log.bytecodeRemoved", { file: rel }));

  // 5. gitignore: updated only when conflict handling actually created .bak or .template.yaml files.
  //    Installs without conflicts (most first installs) do not touch .gitignore at all.
  const gitignoreUpdated0 = wfCounters.backupAdded > 0 || wfCounters.templateAdded > 0;

  // 6. Clean up the previous deploy style: reinstalling with a different style would leave the old CD and deploy twice.
  //    Now, while the old baseline is still alive, is the only time we can judge "did the user touch it?".
  const previousBaseline = readBaseline(targetRoot);
  const { cleanup, storeCleanup, staleCleanup } = cleanupWorkflows(context, payloadRoot, targetRoot, previousBaseline,
    { justWritten: wfCounters.copiedFiles || [] });
  // Drop removed files' reference points from the baseline too, or the next run mistakes them for "deleted by the user".
  for (const r of [cleanup, storeCleanup, staleCleanup]) {
    for (const f of [...r.removed, ...r.backedUp]) delete previousBaseline?.files?.[f];
  }

  for (const f of cleanup.removed || []) log.info("cleanup", "remove", `${f} (${t("cmd.dryRun.reason.cleanup")})`);
  for (const f of cleanup.backedUp || []) log.info("cleanup", "backup", `${f} → ${f}.bak`);
  for (const f of storeCleanup.removed) log.info("cleanup", "remove", `${f} (${t("cmd.dryRun.reason.storeCleanup")})`);
  for (const f of storeCleanup.backedUp) log.info("cleanup", "backup", `${f} → ${f}.bak`);
  for (const f of staleCleanup.removed) log.info("cleanup", "remove", `${f} (${t("cmd.dryRun.reason.staleCleanup")})`);
  for (const f of staleCleanup.backedUp) log.info("cleanup", "backup", `${f} → ${f}.bak`);
  const cleanupCount = (key) => [cleanup, storeCleanup, staleCleanup].reduce((n, r) => n + r[key].length, 0);

  const gitignoreUpdated = gitignoreUpdated0 || cleanup.backedUp.length > 0 || storeCleanup.backedUp.length > 0
    || staleCleanup.backedUp.length > 0;
  if (gitignoreUpdated) {
    const gi = ensureGitignore(targetRoot);
    log.info("gitignore", gi.created ? "create" : gi.added.length ? "append" : "skip",
      gi.added.length ? `.gitignore += ${gi.added.join(", ")}` : t("cmd.full.log.gitignoreExisting"));
  }

  // 7. Write the baseline: the reference point that tells "who changed it" on the next update.
  //    Hash only after env substitution is fully done so the on-disk content is final; that is why it is
  //    recorded here rather than inside copyWorkflows.
  //    The existing baseline is merged, so reference points for files not touched this time are not lost.
  writeBaseline(targetRoot, {
    templateVersion,
    installedAt: now || today || "",
    entries: computeBaselineEntries(
      wfCounters.baselineTargets || new Map(),
      join(targetRoot, PATHS.workflowsDir),
      makeSrcText(context.branches || null, context.deployStyle || ""),
      deployValues),
    previous: previousBaseline,
    // Record only newly created Flutter app files; existing user files (kept) are not candidates for full removal.
    appFiles: new Map(flutterApp.created.map((rel) => [rel, appFileHash(readFileSync(join(targetRoot, rel), "utf8"))])),
  });

  // 8. Post-install verification: re-read what was actually written to disk.
  //    Whether unsubstituted placeholders remain, and which Secrets the workflows need to run.
  //    It does not fail the install; the goal is to report facts and leave the judgment to the user.
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  const managed = [...(wfCounters.baselineTargets || new Map()).keys()];
  const unresolved = scanUnsubstituted(wfDir, managed);
  // Secrets that have a default or where either of two is enough are reported separately from the required ones.
  const secretSets = classifySecrets(wfDir, managed);
  const secrets = narrowSecretsBySshAuth(secretSets.required, firstDeployValue(deployValues, "SSH_AUTH_METHOD"));
  const optionalSecrets = secretSets.optional;

  // 9. Summary: append a result block at the end of the file so the outcome is visible from the tail alone.
  for (const u of unresolved) log.warn("verify", "unresolved", `${u.filename}:${u.line} ${u.token}`);
  for (const [name, users] of secrets) log.info("verify", "secret", `${name} ← ${users.join(", ")}`);
  for (const [name, users] of optionalSecrets) log.info("verify", "secret-opt", t("cmd.full.log.secretOptional", { name, users: users.join(", ") }));
  // copiedFiles also contains the auto-updated ones; without excluding them the same file is counted as both installed and auto-updated.
  const autoUpdated = new Set(wfCounters.autoUpdated || []);
  log.summary([
    [t("cmd.full.summary.installed"), t("cmd.full.summary.installedValue", { n: (wfCounters.copiedFiles || []).filter((f) => !autoUpdated.has(f)).length })],
    [t("cmd.full.summary.autoUpdated"), t("cmd.full.summary.autoUpdatedValue", { n: autoUpdated.size })],
    [t("cmd.full.summary.kept"), t("cmd.full.summary.keptValue", { n: (wfCounters.keptLocal || []).length })],
    [t("cmd.full.summary.unchanged"), t("cmd.full.summary.unchangedValue", { n: (wfCounters.unchangedFiles || []).length })],
    [t("cmd.full.summary.backup"), t("cmd.full.summary.backupValue", { n: wfCounters.backupAdded || 0 })],
    // Deploy style changes, store deselection and old-workflow cleanup also delete files or move them to .bak; counted separately from conflict backups.
    [t("cmd.full.summary.cleanup"), t("cmd.full.summary.cleanupValue", { removed: cleanupCount("removed"), backedUp: cleanupCount("backedUp") })],
    [t("cmd.full.summary.unresolved"), t(unresolved.length ? "cmd.full.summary.unresolvedActionValue" : "cmd.full.summary.unresolvedValue", { n: unresolved.length })],
    [t("cmd.full.summary.secrets"), t("cmd.full.summary.secretsValue", { n: secrets.size })],
    [t("cmd.full.summary.result"), unresolved.length ? t("cmd.full.summary.resultWarn", { n: unresolved.length }) : "OK"],
  ]);

  return { workflows: wfCounters, gitignoreUpdated, unresolved, secrets, cleanup, storeCleanup, staleCleanup, flutterApp, readme, scripts, bytecodeRemoved, optionalSecrets };
}

// Three workflow cleanups: the real install (runFull) and the --dry-run preview use the same decisions.
//   6   Deploy style cleanup: reinstalling with a different style would leave the old CD and deploy twice.
//   6-1 Deselected store workflow cleanup: reinstalling with fewer store targets would let the old workflows
//       keep running on every main push. Nothing is deleted when the selection is undecided (null) or Flutter is absent.
//       Fastfile and ExportOptions belong to the user and are not handled here.
//   6-2 Cleanup of old workflows that were renamed or dropped from the payload.
// The rules are the same for all (delete if unmodified, .bak if modified). The three sets never share file
// names, so the outcome is independent of order.
// Pass the pre-cleanup baseline: it is the only reference that can judge "did the user touch it?".
// With dryRun it only decides and leaves the files alone.
export function cleanupWorkflows(context, payloadRoot, targetRoot, baseline, { justWritten = [], dryRun = false } = {}) {
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const listDir = () => (existsSync(workflowsDir) ? readdirSync(workflowsDir) : []);
  const cleanup = cleanupOtherDeployWorkflows(workflowsDir, listDir(),
    context.deployStyle || DEFAULT_DEPLOY_STYLE, baseline,
    { available: payloadWorkflowNames(payloadRoot), justWritten, dryRun });
  const storeCleanup = { removed: [], backedUp: [] };
  for (const { hook } of hooksFor(context.types || [], "cleanupWorkflows")) {
    const r = hook(workflowsDir, listDir(), context, baseline, { dryRun });
    storeCleanup.removed.push(...r.removed);
    storeCleanup.backedUp.push(...r.backedUp);
  }
  const staleCleanup = cleanupStaleWorkflows(targetRoot, findStaleWorkflows(payloadRoot, targetRoot, baseline), baseline, { dryRun });
  return { cleanup, storeCleanup, staleCleanup };
}

// Record the choices that shaped the install result (deploy style, auto bump, Copilot, type-specific options).
// Values picked interactively converge here too, so "why was it installed like this?" can later be traced from the log alone.
function logChoices(context, types) {
  if (context.deployStyle) log.info("option", "deploy", context.deployStyle);
  if (context.includeSemverAuto != null) log.info("option", "semver", context.includeSemverAuto ? "on" : "off");
  if (context.includeCopilotAi != null) log.info("option", "copilot", context.includeCopilotAi ? "on" : "off");
  for (const { hook } of hooksFor(types, "logChoices")) {
    for (const [name, value] of hook(context)) log.info("option", name, value);
  }
}

// Facts to report separately from the completion summary: if a non-interactive run passes silently, users believe they received the whole update.
// interactive: in interactive mode the user picked the conflict outcome, so omit the conflict notice and report only the cleanup result.
export function postInstallNotices(result, { interactive = false } = {}) {
  const lines = [];
  const stale = result?.staleCleanup || { removed: [], backedUp: [] };
  if (stale.removed.length || stale.backedUp.length) {
    lines.push(t("cmd.full.notice.staleHeading"));
    for (const f of stale.removed) lines.push(t("cmd.full.notice.staleRemoved", { file: f }));
    for (const f of stale.backedUp) lines.push(t("cmd.full.notice.staleBackedUp", { file: f }));
  }
  const kept = interactive ? [] : result?.workflows?.conflictKept || [];
  if (kept.length) {
    lines.push(t("cmd.full.notice.conflictKept", { n: kept.length, files: kept.join(", ") }));
    lines.push(t("cmd.full.notice.conflictHint"));
  }
  return lines;
}

// deployValues is Map<type, Map<key,value>>; used when only the first value is needed regardless of type.
function firstDeployValue(deployValues, key) {
  for (const [, asks] of deployValues) {
    const v = asks.get(key);
    if (v) return v;
  }
  return "";
}
