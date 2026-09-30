// uninstall mode: removes the files the wizard installed (as identified by planRemoval) and, optionally,
// README/.gitignore/version.yml too. Per-item opt-in via the interactive checklist or --force + --purge-*.
// core/removal-plan.js is only reused read-only (a pure function that deletes nothing).
import { join } from "node:path";
import { existsSync } from "node:fs";
import { PATHS } from "../core/paths.js";
import { planRemoval, backupArtifacts } from "../core/removal-plan.js";
import { executeRemoval } from "../core/removal-exec.js";
import { hasVersionSection } from "../core/copy/readme.js";
import { hasAutoAddedEntries } from "../core/copy/gitignore.js";
import { CANCEL } from "../ui/prompts.js";
import { t } from "../i18n/index.js";

// selection: { workflows, scripts, readme, gitignore, versionYml } (all booleans).
// Returns: boolean/array values under the same keys, telling what is actually a removal "target" (pure function, deletes nothing).
export function planUninstall(payloadRoot, targetRoot, selection) {
  const removalPlan = planRemoval(payloadRoot, targetRoot);
  return {
    workflows: selection.workflows ? removalPlan.workflows : [],
    // baseline records the workflow hashes, so it must disappear together with the workflows.
    // The creation record of Flutter app files also lives only in the baseline, so it goes under the same item.
    appFiles: selection.workflows ? removalPlan.appFiles : [],
    baseline: selection.workflows ? removalPlan.baseline : [],
    scripts: selection.scripts ? removalPlan.scripts : [],
    readme: selection.readme ? hasVersionSection(targetRoot) : false,
    // If the workflows stay, so do their backup files (.bak etc.); removing the .gitignore entries would surface them in git status, so keep them.
    gitignore: selection.gitignore
      ? hasAutoAddedEntries(targetRoot) && (selection.workflows || backupArtifacts(removalPlan.workflows).length === 0)
      : false,
    versionYml: selection.versionYml ? existsSync(join(targetRoot, PATHS.versionFile)) : false,
  };
}

// Returns: the same shape as planUninstall, the items actually removed.
export function runUninstall(context, payloadRoot, targetRoot, selection) {
  const plan = planUninstall(payloadRoot, targetRoot, selection);
  const { readme, gitignore } = executeRemoval(targetRoot, plan, {
    logOrder: ["readme", "gitignore", "version"],
    gitignoreDetail: (status) => t("cmd.uninstall.gitignoreDetail", { status }),
  });
  return { ...plan, readme, gitignore };
}

// ── Interactive checklist flow ────────────────────────────────────────
// Built lazily: labels are translated at use time, after the language is resolved.
const itemDefs = () => [
  // .github/.wizard holds baseline.json and the install logs (.wizard/logs); they disappear together
  // with the workflows, so the label says so.
  // Flutter app files are removed too, but only those the wizard created and the user did not modify.
  { key: "workflows", label: t("cmd.uninstall.item.workflows") },
  { key: "scripts", label: t("cmd.uninstall.item.scripts") },
  { key: "readme", label: t("cmd.uninstall.item.readme") },
  { key: "gitignore", label: t("cmd.uninstall.item.gitignore") },
  { key: "versionYml", label: t("cmd.uninstall.item.versionYml") },
];

// Default checked state: only the two "safe delete" items are checked; the rest (readme/gitignore/versionYml) are opt-in.
export const SAFE_ITEMS = ["workflows", "scripts"];

function detectAvailableItems(payloadRoot, targetRoot) {
  const removalPlan = planRemoval(payloadRoot, targetRoot);
  const presence = {
    workflows: removalPlan.workflows.length > 0,
    scripts: removalPlan.scripts.length > 0,
    readme: hasVersionSection(targetRoot),
    gitignore: hasAutoAddedEntries(targetRoot),
    versionYml: existsSync(join(targetRoot, PATHS.versionFile)),
  };
  return itemDefs().filter((d) => presence[d.key]).map((d) => ({ value: d.key, label: d.label }));
}

function toSelection(checkedKeys) {
  const set = new Set(checkedKeys);
  return {
    workflows: set.has("workflows"), scripts: set.has("scripts"),
    readme: set.has("readme"), gitignore: set.has("gitignore"), versionYml: set.has("versionYml"),
  };
}

function summarizeSelection(selection) {
  const labelOf = Object.fromEntries(itemDefs().map((d) => [d.key, d.label]));
  const chosen = Object.keys(selection).filter((k) => selection[k]).map((k) => `- ${labelOf[k]}`);
  return chosen.length ? chosen.join("\n") : t("cmd.uninstall.noneSelected");
}

function summarizeResult(result) {
  const lines = [];
  if (result.workflows.length) lines.push(t("cmd.uninstall.result.workflows", { n: result.workflows.length }));
  if (result.scripts.length) lines.push(t("cmd.uninstall.result.scripts", { n: result.scripts.length }));
  if (result.appFiles?.length) lines.push(t("cmd.uninstall.result.appFiles", { n: result.appFiles.length }));
  if (result.readme) lines.push(t("cmd.uninstall.result.readme"));
  if (result.gitignore) lines.push(t("cmd.uninstall.result.gitignore"));
  if (result.versionYml) lines.push(t("cmd.uninstall.result.versionYml"));
  return lines.length ? lines.join("\n") : t("cmd.uninstall.result.none");
}

// io contract: engineIo.multiselect({message,options,initialValues}), askYesNo(msg,def),
// note(text,title)?, cancelMessage(text)? - src/ui/prompts.js is the real one, tests inject stubs.
// preset: the CLI --purge-* flags { readme, gitignore, versionYml }, reflected in the checklist's initial selection.
export async function runUninstallFlow(payloadRoot, targetRoot, io, preset = {}) {
  const available = detectAvailableItems(payloadRoot, targetRoot);
  if (available.length === 0) {
    io.note?.(t("cmd.uninstall.flow.nothing"), t("cmd.uninstall.flow.title"));
    return null;
  }

  const checked = await io.engineIo.multiselect({
    message: t("cmd.uninstall.flow.select"),
    options: available,
    initialValues: available.map((o) => o.value).filter((v) => SAFE_ITEMS.includes(v) || preset[v] === true),
  });
  if (checked === CANCEL || !Array.isArray(checked) || checked.length === 0) {
    io.cancelMessage?.(t("cmd.uninstall.flow.cancelled"));
    return null;
  }

  const selection = toSelection(checked);
  io.note?.(summarizeSelection(selection), t("cmd.uninstall.flow.plannedTitle"));
  const ok = await io.askYesNo(t("cmd.uninstall.flow.confirm"), false);
  if (ok !== true) {
    io.cancelMessage?.(t("cmd.uninstall.flow.cancelled"));
    return null;
  }

  const result = runUninstall({}, payloadRoot, targetRoot, selection);
  io.note?.(summarizeResult(result), t("cmd.uninstall.flow.doneTitle"));
  return result;
}
