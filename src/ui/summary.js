// Completion summary output. Everything goes to stderr.
// ctx: { mode, types:[], version, copiedFiles:[], branches?, gitignoreUpdated?, readme?, scripts? }
import { WORKFLOW_PREFIX, WORKFLOW_COMMON_PREFIX } from "../core/paths.js";
import { paint, A, colorEnabled } from "./ansi.js";
import { EITHER_SEP } from "../core/verify.js";
import { BUILD_NUMBER_TYPES } from "../core/types.js";
import { SCRIPT_NAMES } from "../core/copy/simple.js";
import { t } from "../i18n/index.js";

const SEPARATOR = "────────────────────────────────────────";

export function printSummary(ctx) {
  const { mode, types = [], version = "", versionCode = null, copiedFiles = [], autoUpdated = [], branches = null, gitignoreUpdated = false,
    // pr-flow but the develop branch could not be created on the remote - the layout line alone looks ready, so warn separately.
    developMissing = false,
    // Post-install verification and record
    answers = [], unresolved = [], secrets = new Map(), optionalSecrets = new Map(), logPath = "", legacyMdLogs = false, cleanup = null,
    // Flutter store deployment - app files created/kept and cleanup of deselected stores
    flutterApp = null, storeCleanup = null,
    // Actual outcome of this run - README version-section status (return value of addVersionSectionToReadme) and per-script results.
    // Printing fixed text would report "added" even when README.md was missing and nothing was done.
    readme = null, scripts = null } = ctx || {};
  const err = (s = "") => process.stderr.write(`${s}\n`);
  // Color is gated by the shared guard in ansi.js (NO_COLOR + stderr TTY)
  const enabled = colorEnabled(process.stderr);

  err("");
  err(SEPARATOR);
  err("");
  err(t("ui.summary.title"));
  err("");
  err(SEPARATOR);
  err("");
  err(t("ui.summary.features.title"));

  // Mention the automatic update only when the README version section really exists (added now or already there).
  const readmeTracked = readme === "added" || readme === "skip-marker" || readme === "skip-version-line";
  if (mode === "full") {
    err(t("ui.summary.features.versionSystem"));
    if (readmeTracked) err(t("ui.summary.features.readmeAuto"));
    err(t("ui.summary.features.workflows"));
    if (gitignoreUpdated) err(t("ui.summary.features.gitignore"));
  }

  // Branch mode + release-summary engine notes
  if (branches) {
    err("");
    err(t("ui.summary.branches.title"));
    if (branches.mode === "trunk-based") {
      err(t("ui.summary.branches.trunk", { main: branches.main }));
    } else {
      err(t("ui.summary.branches.prFlow", { develop: branches.develop, main: branches.main }));
      if (developMissing) {
        err(t("ui.summary.branches.developMissing", { develop: branches.develop }));
        err(t("ui.summary.branches.developHint", { main: branches.main, develop: branches.develop }));
      }
    }
  }
  if (mode === "full" || mode === "workflows") {
    err("");
    err(t("ui.summary.engine.title"));
    err(t("ui.summary.engine.chain"));
  }

  err("");
  err(t("ui.summary.files.title"));
  err(t("ui.summary.files.versionYml", { version, types: types.join(",") }));
  if (versionCode != null && types.some((ty) => BUILD_NUMBER_TYPES.has(ty))) {
    err(t("ui.summary.files.buildNumber", { code: versionCode }));
  }
  if (readme === "added") err(t("ui.summary.files.readmeAdded"));
  if (readme === "skip-no-readme") {
    err(t("ui.summary.files.readmeMissing"));
    err(t("ui.summary.files.readmeMissingHint"));
  }
  err("");
  err(t("ui.summary.workflows.title"));

  // Classify only files actually copied in this run (copiedFiles returned by copyWorkflows() -
  // rescanning the directory would show files skipped on a re-run as "newly installed").
  // Auto-updated files (unmodified files replaced with the latest) are also in copiedFiles - show them apart from new installs.
  const updated = new Set(autoUpdated);
  const commonWorkflows = [];
  const typeWorkflows = [];
  const typePrefixes = types.map((ty) => `${WORKFLOW_PREFIX}-${ty.toUpperCase()}-`);
  for (const filename of copiedFiles) {
    if (!filename.startsWith(`${WORKFLOW_PREFIX}-`)) continue; // PROJECT-* only
    if (updated.has(filename)) continue;
    if (filename.startsWith(`${WORKFLOW_COMMON_PREFIX}-`)) {
      commonWorkflows.push(filename);
    } else if (typePrefixes.some((p) => filename.startsWith(p))) {
      typeWorkflows.push(filename);
    }
  }

  if (commonWorkflows.length > 0 || typeWorkflows.length > 0) {
    err(t("ui.summary.workflows.installed", { count: commonWorkflows.length + typeWorkflows.length }));
    for (const wf of commonWorkflows) err(`     📌 ${wf}`);
    for (const wf of typeWorkflows) err(`     🎯 ${wf}`);
  }
  if (updated.size > 0) {
    err(t("ui.summary.workflows.updated", { count: updated.size }));
    for (const wf of updated) err(`     • ${wf}`);
  }

  err("");
  err("  🔧 .github/scripts/");
  const scriptRows = scripts
    ? scripts.map(({ name, action }) => (action === "overwrite" ? `${name} ${paint(t("ui.summary.scripts.overwritten"), A.dim, enabled)}` : name))
    : SCRIPT_NAMES;
  scriptRows.forEach((row, i) => err(`     ${i === scriptRows.length - 1 ? "└─" : "├─"} ${row}`));
  err("");

  // Environment values the user entered - a last chance to eyeball them. Answers used to vanish
  // into the workflow YAML, so a typo only surfaced after a deploy failed.
  if (answers.length) {
    err(t("ui.summary.answers.title"));
    for (const a of answers) {
      const mark = a.isDefault ? paint(t("ui.summary.answers.default"), A.dim, enabled) : "";
      err(`     • ${a.label}: ${paint(a.value, A.green, enabled)}${mark}`);
    }
    err("");
  }
  // When re-installed with a different deploy style, report how the previous CD was handled.
  printCleanup(err, enabled, t("ui.summary.cleanup.previousDeploy"), cleanup);
  // Same reporting when a store deploy target was deselected.
  printCleanup(err, enabled, t("ui.summary.cleanup.deselectedStores"), storeCleanup);
  // Fastfile and ExportOptions.plist are user-owned and only created when missing - show what was created vs. left alone.
  const { created: appCreated = [], kept: appKept = [] } = flutterApp || {};
  if (appCreated.length || appKept.length) {
    err(t("ui.summary.flutterApp.title"));
    for (const f of appCreated) err(`     • ${f} ${paint(t("ui.summary.flutterApp.created"), A.dim, enabled)}`);
    for (const f of appKept) err(`     • ${f} ${paint(t("ui.summary.flutterApp.kept"), A.dim, enabled)}`);
    if (appCreated.some((f) => f.endsWith("ExportOptions.plist"))) {
      err(t("ui.summary.flutterApp.plistHint"));
    }
    err("");
  }
  if (logPath) {
    err(t("ui.summary.log.path", { path: logPath }));
    err(t("ui.summary.log.hint"));
    err("");
  }
  if (legacyMdLogs) {
    err(t("ui.summary.legacyLogs"));
    err("     git rm -r --cached .github/.wizard/logs");
    err("");
  }

  // Per-type notes
  if (types.includes("spring")) {
    err(t("ui.summary.spring.title"));
    err(t("ui.summary.spring.sync"));
    err("");
  }

  err("  📖 REPO: https://github.com/Twin-Fang/project-auto-wizard");
  err("");

  // Required follow-up actions
  err(SEPARATOR);
  err("");
  err(paint(paint(t("ui.summary.todo.title"), A.yellow, enabled), A.bold, enabled));
  err("");

  let step = 0;
  const num = () => ["1️⃣ ", "2️⃣ ", "3️⃣ ", "4️⃣ ", "5️⃣ "][step++] || " •";

  // Unresolved placeholders - the affected workflow will not work as is, so report them first.
  if (unresolved.length) {
    err(`  ${num()} ${paint(t("ui.summary.todo.unresolved"), A.red, enabled)}`);
    for (const u of unresolved) {
      err(`     → ${u.filename}:${u.line}  ${paint(u.token, A.bold, enabled)}`);
    }
    err("");
  }

  // Secrets the installed workflows actually require - none used to be listed, so an install
  // "succeeded" yet deploys never ran.
  // "A or B" is a fallback pair where registering either one is enough, so it counts as one item.
  if (secrets.size) {
    err(`  ${num()} ${t("ui.summary.todo.secrets", { count: secrets.size })}`);
    err(t("ui.summary.todo.secretsPath"));
    for (const [name, users] of secrets) {
      const either = name.includes(EITHER_SEP) ? paint(t("ui.summary.todo.either"), A.dim, enabled) : "";
      err(`     → ${paint(name, A.bold, enabled)}${either}  ${paint(users.join(", "), A.dim, enabled)}`);
    }
    err("");
  }
  // Secrets that have a default or work without them - listed separately from the required count.
  if (optionalSecrets.size) {
    err(`  ${paint("ℹ️", A.dim, enabled)}  ${t("ui.summary.todo.optionalSecrets", { count: optionalSecrets.size })}`);
    for (const [name, users] of optionalSecrets) {
      err(`     · ${name}  ${paint(users.join(", "), A.dim, enabled)}`);
    }
    err("");
  }

  // Installed files are not committed yet. If develop was created in this run it is based on the pre-install commit and has no workflows -
  // committing to only one branch leaves the other without VERSION-CONTROL etc.
  if (branches) {
    err(`  ${num()} ${t("ui.summary.todo.commit", { main: branches.main })}`);
    if (branches.mode !== "trunk-based") {
      err(t("ui.summary.todo.commitDevelop", { develop: branches.develop }));
      err(t("ui.summary.todo.commitExample", { develop: branches.develop, main: branches.main }));
    }
    err(t("ui.summary.todo.changelogLink"));
    err("");
  }

  err(`  ${num()} ${t("ui.summary.todo.pat")}`);
  err(t("ui.summary.todo.patPath"));
  err(t("ui.summary.todo.patName"));
  err(t("ui.summary.todo.patAccount"));
  err(t("ui.summary.todo.patOptional"));
  err("");
  // Installed workflows declare the permissions they need themselves - report it by the same rule as the doctor guidance.
  err(`  ${num()} ${t("ui.summary.todo.permissions")}`);
  err(t("ui.summary.todo.permissionsRead"));
  err(t("ui.summary.todo.permissionsWrite"));
  err("");
  err(SEPARATOR);
  err("");
  err(paint(t("ui.summary.footer"), A.cyan, enabled));
  err("");
}

// One block of removal/backup cleanup results - previous-deploy cleanup and deselected-store cleanup share the format.
function printCleanup(err, enabled, title, cleanup) {
  if (!cleanup?.removed?.length && !cleanup?.backedUp?.length) return;
  err(`  🧹 ${title}:`);
  for (const f of cleanup.removed || []) err(`     • ${f} ${paint(t("ui.summary.cleanup.removed"), A.dim, enabled)}`);
  for (const f of cleanup.backedUp || []) err(`     • ${f} → ${f}.bak ${paint(t("ui.summary.cleanup.backedUp"), A.dim, enabled)}`);
  err("");
}
