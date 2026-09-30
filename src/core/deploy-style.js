// Deploy style: the server-deploy CD workflows are alternatives to each other.
// Nginx zero-downtime and Traefik zero-downtime are never used together, so only one is installed.
// The chosen one is installed with its push trigger enabled, so nothing is installed that then never runs.
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { sha256 } from "./baseline.js";
import { PAYLOAD, typeWorkflowDirs } from "./paths.js";
import { SINGLE_SERVER_CD_FILES } from "./types.js";
import { t } from "../i18n/index.js";

// Identified by file name suffix, because the type prefix (PROJECT-SPRING- etc.) differs per type.
// label is a getter so the text follows the language resolved after import.
export const DEPLOY_STYLES = [
  { value: "simple", suffix: "-SIMPLE-CICD.yaml", get label() { return t("core.deploy.label.simple"); } },
  { value: "nginx", suffix: "-NONSTOP-NGINX-CICD.yaml", get label() { return t("core.deploy.label.nginx"); } },
  { value: "traefik", suffix: "-NONSTOP-TRAEFIK-CICD.yaml", get label() { return t("core.deploy.label.traefik"); } },
];

export const DEFAULT_DEPLOY_STYLE = "simple";

// Value for projects that do no server deploy at all (frontend-only, libraries, etc.).
// Not put into DEPLOY_STYLES: isDeployWorkflow/suffixOf iterate that array, and an empty suffix would make
// endsWith("") always true, so every file would be misjudged as CD and cleanupOtherDeployWorkflows would
// delete all installed workflows (a regression).
export const NO_DEPLOY_STYLE = "none";

export const isDeployStyle = (v) => v === NO_DEPLOY_STYLE || DEPLOY_STYLES.some((s) => s.value === v);

// Whether this file is a CD body (= subject of the pick-one choice). PR preview is orthogonal to the deploy style, so it is excluded.
export const isDeployWorkflow = (filename) => DEPLOY_STYLES.some((s) => filename.endsWith(s.suffix));

const PREVIEW_SUFFIX = "-PR-PREVIEW.yaml";

// All workflows that deploy to a server: CD bodies, the single CD (react) and PR preview.
// "No deploy" removes all of them identically for every type. Removing only some would leave server Secret requirements behind.
export const isServerDeployWorkflow = (filename) =>
  isDeployWorkflow(filename) || SINGLE_SERVER_CD_FILES.has(filename) || filename.endsWith(PREVIEW_SUFFIX);

// Whether any selected type has server deploy workflows, judged from the payload files.
// If none (node, flutter, etc.) the deploy style has no effect on the install result, so it is neither asked nor recorded.
export function hasServerDeployWorkflows(payloadRoot, types = []) {
  return types.some((type) => typeWorkflowDirs(payloadRoot, type)
    .some((dir) => existsSync(dir) && readdirSync(dir).some(isServerDeployWorkflow)));
}

// Whether any selected type has zero-downtime (nginx, traefik) workflows; if none, the zero-downtime choices are not shown.
export function hasNonstopWorkflows(payloadRoot, types = []) {
  const nonstop = DEPLOY_STYLES.filter((s) => s.value !== DEFAULT_DEPLOY_STYLE).map((s) => s.suffix);
  return types.some((type) => typeWorkflowDirs(payloadRoot, type)
    .some((dir) => existsSync(dir) && readdirSync(dir).some((f) => nonstop.some((sfx) => f.endsWith(sfx)))));
}

// All workflow file names under payload/workflows/**. File names are unique across types thanks to the PROJECT-{TYPE}- prefix.
export function payloadWorkflowNames(payloadRoot) {
  const names = new Set();
  const root = join(payloadRoot, PAYLOAD.workflowsDir);
  if (!existsSync(root)) return names;
  for (const e of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && /\.ya?ml$/.test(e.name)) names.add(e.name);
  }
  return names;
}

// Unknown values converge to the default. Returning an empty suffix would make endsWith("") always true,
// i.e. "everything passes", and an invalid value would silently leak into installing every CD.
const suffixOf = (style) =>
  (DEPLOY_STYLES.find((s) => s.value === style) ?? DEPLOY_STYLES.find((s) => s.value === DEFAULT_DEPLOY_STYLE)).suffix;
const SIMPLE_SUFFIX = suffixOf(DEFAULT_DEPLOY_STYLE);

// Whether this is the single-server deploy CD of a type that lacks the chosen style's CD (e.g. nginx was chosen but python and go have no NONSTOP).
// Such types get the single-server deploy instead: deleting it or moving it to .bak right after install would leave no deploy at all.
function isFallbackSimple(filename, style, available) {
  if (!available || !filename.endsWith(SIMPLE_SUFFIX)) return false;
  const prefix = filename.slice(0, -SIMPLE_SUFFIX.length);
  return !available.has(prefix + suffixOf(style));
}

// File filter: only the chosen style's CD passes. Non-CD files (PR preview, common, etc.) always pass.
// "none" installs no server-deploy workflow at all (CD, single CD, PR preview).
// available: set of payload workflow file names (payloadWorkflowNames). When given, types without the chosen
// style fall back to the single-server deploy. Without it, only the suffix decides.
export function deployFilter(style, available = null) {
  if (style === NO_DEPLOY_STYLE) return (filename) => !isServerDeployWorkflow(filename);
  const suffix = suffixOf(style);
  return (filename) => !isDeployWorkflow(filename) || filename.endsWith(suffix)
    || isFallbackSimple(filename, style, available);
}

// Types that get the single-server deploy instead because they lack workflows for the chosen style (nginx, traefik); for notices.
export function fallbackStyleTypes(payloadRoot, types = [], style) {
  if (!style || style === NO_DEPLOY_STYLE || suffixOf(style) === SIMPLE_SUFFIX) return [];
  return types.filter((type) => {
    const files = typeWorkflowDirs(payloadRoot, type)
      .filter((dir) => existsSync(dir)).flatMap((dir) => readdirSync(dir));
    return files.some(isServerDeployWorkflow) && !files.some((f) => f.endsWith(suffixOf(style)));
  });
}

// The deploy style that is actually installed: if no selected type has workflows for the chosen zero-downtime
// style, all of them get the single-server deploy, so the result is simple. Recording the chosen value as is would
// make version.yml and status disagree with what was installed, and the next run would inherit it as the default.
// If even one type has that style, the chosen value is kept.
export function effectiveDeployStyle(payloadRoot, types = [], style) {
  if (!style || style === NO_DEPLOY_STYLE || suffixOf(style) === SIMPLE_SUFFIX) return style;
  const installed = types.some((type) => typeWorkflowDirs(payloadRoot, type)
    .some((dir) => existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(suffixOf(style)))));
  return installed ? style : DEFAULT_DEPLOY_STYLE;
}

// Zero-downtime templates ship with the push trigger commented out (because the default deploy is the single server).
// Once the user has chosen that style the trigger must be on: otherwise nothing happens after install and the
// user has to edit the YAML by hand.
//
// Inside the first `on:` block only the two characters `# ` are removed, so the inner indentation hierarchy is preserved.
// Explanatory comments are left alone because their stripped content does not start with push/branches/-.
const TRIGGER_CONTENT = /^\s*(push:|branches:|- )/;

export function activateDeployTrigger(content) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  let inOn = false;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^on:\s*$/.test(line)) { inOn = true; continue; }
    if (!inOn) continue;
    if (/^\S/.test(line)) break; // a top-level key ends the on block
    const m = line.match(/^(\s*)# ?(.*)$/);
    if (!m || !TRIGGER_CONTENT.test(m[2])) continue;
    lines[i] = `${m[1]}${m[2]}`;
    changed = true;
  }
  return changed ? lines.join(eol) : content;
}

// Cleans up the previous CD when reinstalling with a different style.
//
// Leaving it would keep the old style's push trigger alive and deploy twice. Telling the user to "delete it
// yourself" would leave the repo in a broken state even after install finishes. Files the wizard installed are
// cleaned up by the wizard.
//
//   untouched (same as the baseline installed hash) -> deleted. No reason to ask.
//   modified                                        -> moved to .bak. Content is kept and only the trigger is killed.
//
// opts.available   - set of payload workflow file names. When given, only files in it (files the wizard installs)
//                    are cleaned up, and the single-server deploy of types lacking the chosen style is kept.
// opts.justWritten - files the wizard just wrote in this run. Not mistaken for modified files even without a baseline, as on a first install.
// opts.dryRun      - only decide, do not touch files. Makes the --dry-run preview use the same decision as a real run.
// Returns { removed:[], backedUp:[] }, reported as is on the completion screen and in the install record.
export function cleanupOtherDeployWorkflows(workflowsDir, installedFilenames, style, baseline, { available = null, justWritten = [], dryRun = false } = {}) {
  const keep = deployFilter(style, available);
  const written = new Set(justWritten);
  const removed = [];
  const backedUp = [];

  for (const filename of installedFilenames) {
    if (!isServerDeployWorkflow(filename) || keep(filename)) continue;
    if (available && !available.has(filename)) continue; // never touch a similarly named workflow the user created
    const p = join(workflowsDir, filename);
    if (!existsSync(p)) continue;

    const known = baseline?.files?.[filename]?.installed;
    const untouched = written.has(filename) || (known && sha256(readFileSync(p, "utf8")) === known);
    if (untouched) {
      if (!dryRun) rmSync(p, { force: true });
      removed.push(filename);
    } else {
      if (!dryRun) renameSync(p, `${p}.bak`);
      backedUp.push(filename);
    }
  }
  return { removed, backedUp };
}
