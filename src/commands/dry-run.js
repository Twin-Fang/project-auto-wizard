// --dry-run preview: computes what would change without writing any file.
// Supports the full/uninstall modes (partial-install and revert modes were removed).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../core/paths.js";
import { planWorkflows } from "../core/copy/workflows.js";
import { planTypeAppFiles } from "../core/copy/app-files.js";
import { planUninstall } from "./uninstall.js";
import { renderVersionYml, parseExisting, sameIgnoringTimestamps, droppedPathLines } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { existingMarkerInDir } from "../core/paths-resolve.js";
import { planScripts } from "../core/copy/simple.js";
import { planVersionSection } from "../core/copy/readme.js";
import { BASELINE_PATH, readBaseline } from "../core/baseline.js";
import { cleanupWorkflows } from "./full.js";
import { planGitignore } from "../core/copy/gitignore.js";
import { t } from "../i18n/index.js";

function versionYmlPreview(context, payloadRoot, targetRoot) {
  const { paths = new Map() } = context;
  const pathMarkers = new Map();
  for (const [t, p] of paths) pathMarkers.set(t, existingMarkerInDir(t, join(targetRoot, p || ".")));

  const vyPath = join(targetRoot, PATHS.versionFile);
  const existingRaw = existsSync(vyPath) ? readFileSync(vyPath, "utf8") : null;
  const extraTopLevel = existingRaw !== null ? parseExisting(existingRaw).extraTopLevel : [];

  // Use the same render function as the real install; assembling separately drifts the preview whenever an option is added.
  const wouldBe = renderVersionYml(context, readVersionYmlTemplate(payloadRoot), {
    pathMarkers, extraTopLevel,
  });
  // Compare by the same rule as the real install: if only the timestamp lines differ, the install does not rewrite the file either.
  return { existed: existingRaw !== null, changed: existingRaw === null || !sameIgnoringTimestamps(existingRaw, wouldBe) };
}

function existingDroppedPaths(targetRoot) {
  const vyPath = join(targetRoot, PATHS.versionFile);
  return existsSync(vyPath) ? parseExisting(readFileSync(vyPath, "utf8")).droppedPaths : [];
}

// mode: "full" | "uninstall". Read-only: writes no file.
export function planDryRun(mode, context, payloadRoot, targetRoot = ".") {
  if (mode === "uninstall") {
    return { mode, uninstall: planUninstall(payloadRoot, targetRoot, context.uninstallSelection) };
  }
  const workflows = planWorkflows(context, payloadRoot, targetRoot);
  // Run the same cleanup decision as the real run without touching files: files deleted or moved to .bak by a
  // deploy style change or a store deselection must not be missing from the preview. Files a non-interactive
  // run writes anew are the new and auto-updated ones.
  const justWritten = [...workflows.newFiles, ...workflows.upstreamOnly].map((f) => f.filename);
  const cleanup = cleanupWorkflows(context, payloadRoot, targetRoot, readBaseline(targetRoot), { justWritten, dryRun: true });
  // When a .bak appears, the real run ensures a backup-file entry in .gitignore. Non-interactive conflicts keep the existing file, so no .bak is made.
  const backedUp = Object.values(cleanup).some((r) => r.backedUp.length > 0);
  return {
    mode,
    workflows,
    cleanup,
    gitignore: backedUp ? planGitignore(targetRoot) : null,
    // Flutter store deploy files (Fastfile, ExportOptions.plist): existing files are kept, not overwritten.
    flutterApp: planTypeAppFiles(context, payloadRoot, targetRoot),
    versionYml: versionYmlPreview(context, payloadRoot, targetRoot),
    // Folders the rewrite would drop from version.yml (same type listed under two names with different folders).
    droppedPaths: existingDroppedPaths(targetRoot),
    // Files the real install also changes; scripts that overwrite existing files in particular must be shown in advance.
    scripts: planScripts(payloadRoot, targetRoot),
    readme: planVersionSection(targetRoot),
    baselineExists: existsSync(join(targetRoot, BASELINE_PATH)),
  };
}

export function printDryRun(plan) {
  const lines = ["", t("cmd.dryRun.header", { mode: plan.mode }), ""];
  if (plan.mode === "uninstall") {
    const u = plan.uninstall;
    lines.push(t("cmd.dryRun.uninstall.workflows", { n: u.workflows.length }));
    for (const f of u.workflows) lines.push(`  - ${f}`);
    lines.push(t("cmd.dryRun.uninstall.scripts", { n: u.scripts.length }));
    for (const f of u.scripts) lines.push(`  - ${f}`);
    for (const f of u.appFiles || []) lines.push(t("cmd.dryRun.uninstall.appFile", { file: f }));
    if (u.readme) lines.push(t("cmd.dryRun.uninstall.readme"));
    if (u.gitignore) lines.push(t("cmd.dryRun.uninstall.gitignore"));
    if (u.versionYml) lines.push(t("cmd.dryRun.uninstall.versionYml"));
  } else {
    if (plan.workflows) {
      const w = plan.workflows;
      lines.push(t("cmd.dryRun.full.newFiles", { n: w.newFiles.length }));
      for (const f of w.newFiles) lines.push(`  + ${f.filename} [${f.type}]`);
      lines.push(t("cmd.dryRun.full.changed", { n: w.changed.length }));
      for (const f of w.changed) lines.push(`  ~ ${f.filename} [${f.type}]`);
      lines.push(t("cmd.dryRun.full.unchanged", { n: w.unchanged.length }));
      // Buckets that exist only with a baseline. The real run acts on each of them, so the preview lists them too
      // (only when non-empty, so installs without a baseline print exactly as before).
      if (w.upstreamOnly?.length) {
        lines.push(t("cmd.dryRun.full.autoUpdated", { n: w.upstreamOnly.length }));
        for (const f of w.upstreamOnly) lines.push(`  ~ ${f.filename} [${f.type}]`);
      }
      if (w.localOnly?.length) {
        lines.push(t("cmd.dryRun.full.localKept", { n: w.localOnly.length }));
        for (const f of w.localOnly) lines.push(`  = ${f.filename} [${f.type}]`);
      }
      if (w.removed?.length) {
        lines.push(t("cmd.dryRun.full.removed", { n: w.removed.length }));
        for (const f of w.removed) lines.push(`  - ${f.filename} [${f.type}]`);
      }
    }
    if (plan.cleanup) {
      const reasons = {
        cleanup: t("cmd.dryRun.reason.cleanup"), storeCleanup: t("cmd.dryRun.reason.storeCleanup"), staleCleanup: t("cmd.dryRun.reason.staleCleanup"),
      };
      const removed = [];
      const backedUp = [];
      for (const [key, reason] of Object.entries(reasons)) {
        for (const f of plan.cleanup[key]?.removed || []) removed.push(t("cmd.dryRun.cleanup.removedLine", { file: f, reason }));
        for (const f of plan.cleanup[key]?.backedUp || []) backedUp.push(t("cmd.dryRun.cleanup.backedUpLine", { file: f, reason }));
      }
      if (removed.length) lines.push(t("cmd.dryRun.cleanup.removedHeading", { n: removed.length }), ...removed);
      if (backedUp.length) lines.push(t("cmd.dryRun.cleanup.backedUpHeading", { n: backedUp.length }), ...backedUp);
    }
    if (plan.gitignore) {
      const g = plan.gitignore;
      lines.push(g.created
        ? t("cmd.dryRun.gitignore.created", { added: g.added.join(", ") })
        : g.added.length ? t("cmd.dryRun.gitignore.append", { added: g.added.join(", ") }) : t("cmd.dryRun.gitignore.unchanged"));
    }
    if (plan.flutterApp && (plan.flutterApp.created.length || plan.flutterApp.kept.length)) {
      const { created, kept } = plan.flutterApp;
      lines.push(t("cmd.dryRun.flutter.created", { n: created.length }));
      for (const f of created) lines.push(`  + ${f}`);
      lines.push(t("cmd.dryRun.flutter.kept", { n: kept.length }));
      for (const f of kept) lines.push(t("cmd.dryRun.flutter.keptLine", { file: f }));
    }
    if (plan.versionYml) {
      lines.push(plan.versionYml.existed
        ? (plan.versionYml.changed ? t("cmd.dryRun.versionYml.update") : t("cmd.dryRun.versionYml.unchanged"))
        : t("cmd.dryRun.versionYml.create"));
      // dry-run runs read-only without prompts, so it cannot compute @wizard ask deploy settings.
      // For types with a deploy block (spring etc.) say the preview may differ from the real install.
      lines.push(t("cmd.dryRun.versionYml.note"));
    }
    if (plan.droppedPaths?.length) lines.push(...droppedPathLines(plan.droppedPaths).map((l) => `⚠️  ${l}`));
    if (plan.scripts) {
      const mark = { create: "+", overwrite: "~", unchanged: "=" };
      const note = {
        create: t("cmd.dryRun.scripts.create"), overwrite: t("cmd.dryRun.scripts.overwrite"), unchanged: t("cmd.dryRun.scripts.unchanged"),
      };
      lines.push(t("cmd.dryRun.scripts.heading", { dir: PATHS.scriptsDir, n: plan.scripts.length }));
      for (const s of plan.scripts) lines.push(`  ${mark[s.action]} ${s.name} (${note[s.action]})`);
    }
    if (plan.readme) {
      lines.push({
        added: t("cmd.dryRun.readme.added"),
        "skip-no-readme": t("cmd.dryRun.readme.skipNoReadme"),
        "skip-marker": t("cmd.dryRun.readme.skipMarker"),
        "skip-version-line": t("cmd.dryRun.readme.skipVersionLine"),
        "heading-updated": t("cmd.dryRun.readme.headingUpdated"),
      }[plan.readme] || t("cmd.dryRun.readme.other", { status: plan.readme }));
    }
    if (plan.baselineExists !== undefined) {
      lines.push(t(plan.baselineExists ? "cmd.dryRun.baseline.update" : "cmd.dryRun.baseline.create", { path: BASELINE_PATH }));
    }
  }
  lines.push("");
  console.log(lines.join("\n"));
}
