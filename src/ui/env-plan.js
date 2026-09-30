// @wizard env plan question UI - collects ask keys, prints field cards, lets the user keep all defaults or change some.
// io is injected - tests pass {select, multiselect, text} stubs. The default is the real readline-engine.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { stdin, stderr } from "node:process";
import { PAYLOAD, typeWorkflowDirs } from "../core/paths.js";
import { exists, listYamlFiles } from "../core/fsutil.js";
import { parseWizardLine, resolveToken, replaceProjectTokens } from "../core/wizard-env.js";
import { loadWizardPrompts, wfField, workflowDisplayName } from "../core/wizard-labels.js";
import { deployFilter, payloadWorkflowNames, NO_DEPLOY_STYLE } from "../core/deploy-style.js";
import { buildTypeRootFilter, readSavedDeployValues } from "../core/copy/workflows.js";
import * as engine from "./readline-engine.js";
import { t } from "../i18n/index.js";

const CANCEL = engine.CANCEL;

// Progress output goes to stderr (keeps stdout pipes clean).
const defaultLog = (s = "") => stderr.write(s + "\n");

// Build the usage string.
// usages: [{type, workflowName}] - with several types only "t1·t2", with one type "type name1·name2".
export function scopeString(usages = []) {
  const types = []; const names = [];
  for (const { type, workflowName } of usages) {
    if (!types.includes(type)) types.push(type);
    if (!names.includes(workflowName)) names.push(workflowName);
  }
  if (types.length > 1) return types.join("·");
  return `${types.join("·")} ${names.join("·")}`.trim();
}

// Collect ask KEYs - scans the same sources as the workflows that actually get installed.
// payloadRoot: package payload/ root. types: target types to install.
// opts:
//   resolvers    - resolves @-prefixed defaults (@repo etc.) at collection time
//   flutterStore - Flutter store targets (string[]|null). An array excludes workflows of deselected stores from the scan (null = current behaviour)
//   prompts      - parsed wizard-labels object (for workflow display names; falls back to the extension-stripped name when null)
//   saved        - Map<type, Map<key,value>>: values saved in the version.yml deploy block. When present they are shown as defaults
//                  (choosing "keep defaults" on an update must preserve the values answered at install time)
// Returns: { keys:[], defaults:Map<key,default>, typeDefaults:Map<"type|key",default>,
//        usages:Map<key,[{type,workflowName}]> }
export function collectAsks(payloadRoot, types = [], opts = {}) {
  const { resolvers = {}, deployStyle = "", flutterStore = null, prompts = null, saved = new Map() } = opts;
  // Do not ask about deploy workflows that will not be installed - the number of questions follows the install scope.
  const available = payloadWorkflowNames(payloadRoot);
  const keepDeploy = deployFilter(deployStyle, available);
  const baseDir = join(payloadRoot, PAYLOAD.workflowsDir);
  const keys = [];
  const defaults = new Map();
  const typeDefaults = new Map();
  const usages = new Map();

  // Scan units: [type, folder]. The top level of common/ is always installed regardless of the chosen types
  // (same rule as the copy engine), so it is always scanned.
  const units = [];
  const commonDir = join(baseDir, "common");
  if (exists(commonDir)) units.push(["common", commonDir, null]);
  for (const type of types) {
    const [typeDir, serverDeployDir] = typeWorkflowDirs(payloadRoot, type);
    if (!exists(typeDir)) continue;
    // Same folder layout as the copy engine: type root + server-deploy (only when deploy is not "none").
    // Types such as go, python and react keep server deploy workflows directly in the type root; they go
    // through the same deploy-style filter - with "no deploy", CD/PR-preview ask keys (DEPLOY_PORT, SSH_AUTH_METHOD, ...) are not asked.
    // Flutter also filters out deselected store workflows (PLAYSTORE, TESTFLIGHT) so the question scope equals the install scope.
    units.push([type, typeDir, buildTypeRootFilter(type, deployStyle, flutterStore, available)]);
    if (deployStyle !== NO_DEPLOY_STYLE) {
      units.push([type, serverDeployDir, keepDeploy]);
    }
  }

  for (const [type, dir, fileFilter] of units) {
    if (!exists(dir)) continue;
    for (const filename of listYamlFiles(dir)) {
      if (fileFilter && !fileFilter(filename)) continue;
      const content = readFileSync(join(dir, filename), "utf8");
      if (!content.includes("@wizard")) continue;
      const workflowName = workflowDisplayName(prompts, filename);
      for (const line of content.split(/\r?\n/)) {
        const p = parseWizardLine(line);
        if (!p || p.action !== "ask") continue;
        // Per-type default: resolved via resolver when @-prefixed, otherwise a literal
        const rawDefault = p.arg.startsWith("@")
          ? resolveToken(p.arg.slice(1), type, resolvers)
          : p.arg;
        // If a literal default embeds __PROJECT_NAME__ etc., expand it to the real repoName -
        // it must be the same substitution substituteEnv() applies to installed files, otherwise the
        // wizard display and the actual install result would diverge.
        const savedValue = saved.get(type)?.get(p.key);
        const typeDefault = savedValue != null && savedValue !== ""
          ? savedValue
          : replaceProjectTokens(rawDefault, resolveToken("repo", type, resolvers));
        typeDefaults.set(`${type}|${p.key}`, typeDefault);
        if (!defaults.has(p.key)) { keys.push(p.key); defaults.set(p.key, typeDefault); }
        const list = usages.get(p.key) || [];
        list.push({ type, workflowName });
        usages.set(p.key, list);
      }
    }
  }
  return { keys, defaults, typeDefaults, usages };
}

// The type where KEY first appears - used for type-override priority when looking up labels
function firstTypeFor(usages, key) {
  return usages.get(key)?.[0]?.type ?? "";
}

// Final answer list - built here so the completion summary and the install log share the same data.
// isDefault means "left at the default". It is the first thing checked when a deploy later fails,
// so keeping only the value is not enough.
function buildAnswers(prompts, asks, values, useDefaults) {
  return asks.keys.map((key) => {
    const def = asks.defaults.get(key) ?? "";
    const chosen = useDefaults ? def : (values.get(key) ?? def);
    return {
      key,
      label: wfField(prompts, firstTypeFor(asks.usages, key), key, "label") || key,
      value: chosen,
      isDefault: chosen === def,
      scope: scopeString(asks.usages.get(key) || []),
    };
  });
}

// Print one KEY as a 'label, usage, description, example, default' card.
// info: { default, usages } - with idx/tot a "(i/t)" progress marker is shown. log is injectable (silences tests).
export function printFieldCard(prompts, key, info, idx = null, tot = null, log = defaultLog) {
  const type = info.usages?.[0]?.type ?? "";
  const label = wfField(prompts, type, key, "label");
  const help = wfField(prompts, type, key, "help");
  const ex = wfField(prompts, type, key, "example");
  const scope = scopeString(info.usages || []);
  const head = idx != null && tot != null
    ? `   ▸ (${idx}/${tot}) ${label}  [${scope}]`
    : `   ▸ ${label}  [${scope}]`;
  log(head);
  if (help) log(`       ${help}`);
  if (ex) log(t("ui.env-plan.card.example", { example: ex }));
  log(t("ui.env-plan.card.default", { value: info.default ?? "" }));
  log("");
}

// An ask field whose default is exactly "true"/"false" is treated as a boolean field.
// Decided from the literal value alone without changing the marker syntax (@wizard ask:...) - no separate type annotation needed.
function isBooleanDefault(value) {
  return value === "true" || value === "false";
}

// Validate ask values with a fixed format - a bad value passes install and only fails at deploy time, so re-ask at input time.
// Returns: the error message ("" when fine).
export function validateAskValue(key, value) {
  const v = String(value);
  if (/_PORT$/.test(key)) {
    const n = Number(v);
    return /^\d+$/.test(v) && n >= 1 && n <= 65535 ? "" : t("ui.env-plan.validate.port");
  }
  if (key === "SSH_AUTH_METHOD") {
    return v === "password" || v === "key" ? "" : t("ui.env-plan.validate.sshAuth");
  }
  if (key === "JAVA_VERSION") {
    return /^\d+(\.\d+)*$/.test(v) ? "" : t("ui.env-plan.validate.javaVersion");
  }
  return "";
}

// Prompt for the given KEYs one by one and record them in values.
// Empty input (Enter) / ESC keeps the KEY's shared default.
async function promptEach(io, prompts, asks, todoKeys, values, log) {
  const tot = todoKeys.length;
  if (tot === 0) return;
  log("");
  log(t("ui.env-plan.each.intro"));
  log("");
  let i = 0;
  for (const key of todoKeys) {
    i++;
    const def = asks.defaults.get(key) ?? "";
    printFieldCard(prompts, key, { default: def, usages: asks.usages.get(key) || [] }, i, tot, log);
    const label = wfField(prompts, firstTypeFor(asks.usages, key), key, "label");
    let input;
    if (isBooleanDefault(def)) {
      const answer = await io.confirm({ message: t("ui.env-plan.each.enable", { label }), initialValue: def === "true" });
      input = answer === CANCEL ? def : (answer ? "true" : "false");
    } else {
      for (;;) {
        input = await io.text({ message: t("ui.env-plan.each.input", { def }), defaultValue: def });
        if (input === CANCEL || input == null) { input = def; break; }
        input = String(input).trim();
        if (input === "") { input = def; break; }
        const problem = validateAskValue(key, input);
        if (!problem) break;
        log(t("ui.env-plan.each.invalid", { input, problem }));
      }
    }
    values.set(key, input);
    log(t("ui.env-plan.each.result", { label, input }));
    log("");
  }
}

// Deploy env setup plan.
// Returns: { values: Map<key,value>, useDefaults: boolean, answers: [{key,label,value,isDefault,scope}] }
//  - useDefaults=true  -> the caller passes it straight to substituteEnv, taking the per-type default path
//  - useDefaults=false -> only keys in values are replaced with user-confirmed values, the rest use defaults
//    (WARNING: substituteEnv reads values only when useDefaults=false, so always pass this flag along)
// Arguments:
//   payloadRoot/types/resolvers/flutterStore - same meaning as collectAsks
//   targetRoot - first place to look for wizard-prompts.yml (default ".")
//   force      - when true, take all defaults without asking
//   io         - injected {select, multiselect, text} (default readline-engine). Test stub point.
//   log        - injected card/notice output function (default stderr)
export async function promptEnvPlan({
  payloadRoot, types = [], io = null, force = false, resolvers = {},
  deployStyle = "", flutterStore = null, targetRoot = ".", repoName = "", log = defaultLog,
} = {}) {
  const prompts = loadWizardPrompts(targetRoot, payloadRoot);
  const saved = readSavedDeployValues(targetRoot);
  const asks = collectAsks(payloadRoot, types, { resolvers, deployStyle, flutterStore, prompts, saved });
  const defaults = asks.defaults;

  // No collected keys -> nothing to ask
  if (asks.keys.length === 0) return { values: new Map(), useDefaults: true, answers: [] };

  // Non-interactive: force or (no io injected && non-TTY) -> all defaults
  // With io injected (tests / parent wizard) it runs interactively regardless of TTY.
  const interactive = !force && (io != null || stdin.isTTY);
  if (!interactive) {
    const values = new Map(defaults);
    return { values, useDefaults: true, answers: buildAnswers(prompts, asks, values, true) };
  }

  const ui = io ?? engine;

  // Print the full default-preview cards
  log("");
  log(t("ui.env-plan.intro.title"));
  log("");
  log(t("ui.env-plan.intro.line1"));
  log(t("ui.env-plan.intro.line2"));
  log("");
  const tot = asks.keys.length;
  asks.keys.forEach((key, i) => {
    printFieldCard(prompts, key, { default: defaults.get(key), usages: asks.usages.get(key) || [] }, i + 1, tot, log);
  });
  log(t("ui.env-plan.intro.rule"));

  const choice = await ui.select({
    message: t("ui.env-plan.choice.message"),
    options: [
      { value: "all", label: t("ui.env-plan.choice.all") },
      { value: "each", label: t("ui.env-plan.choice.each") },
      { value: "some", label: t("ui.env-plan.choice.some") },
    ],
  });
  // ESC/cancel -> all defaults
  if (choice === CANCEL || choice == null || choice === "all") {
    const values = new Map(defaults);
    return { values, useDefaults: true, answers: buildAnswers(prompts, asks, values, true) };
  }

  // Keep only user-confirmed keys in values - substituteEnv(useDefaults:false) fills keys
  // missing from values with the per-type defaults (same as overriding defaults with just the answered values).
  const values = new Map();
  if (choice === "each") {
    await promptEach(ui, prompts, asks, asks.keys, values, log);
    return { values, useDefaults: false, answers: buildAnswers(prompts, asks, values, false) };
  }

  // some: multi-select the items to change -> prompt only for those
  const options = asks.keys.map((key) => ({
    value: key,
    label: t("ui.env-plan.some.option", { label: wfField(prompts, firstTypeFor(asks.usages, key), key, "label"), def: defaults.get(key) }),
  }));
  const selected = await ui.multiselect({
    message: t("ui.env-plan.some.message"),
    options,
    initialValues: [],
  });
  // ESC/empty selection -> all defaults
  if (selected === CANCEL || !Array.isArray(selected) || selected.length === 0) {
    const values = new Map(defaults);
    return { values, useDefaults: true, answers: buildAnswers(prompts, asks, values, true) };
  }
  // Keep collection order + accept only collected keys
  const todo = asks.keys.filter((k) => selected.includes(k));
  await promptEach(ui, prompts, asks, todo, values, log);
  return { values, useDefaults: false, answers: buildAnswers(prompts, asks, values, false) };
}
