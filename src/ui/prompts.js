// Interactive prompt wrappers.
// Uses the in-house node:readline engine (@clack/prompts was removed because Enter hangs on Windows TTY).
// On ESC each function returns the CANCEL symbol -> the caller interprets it as default/stay.
// Ctrl+C / Ctrl+D make the engine reject with PromptAbortError -> run() catches it and exits with code 130.
import * as engine from "./readline-engine.js";
import { t, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "../i18n/index.js";
import { DEPLOY_STYLES, NO_DEPLOY_STYLE } from "../core/deploy-style.js";
import { TYPE_IDS, typeInfo } from "../core/types.js";
import { askableOptions } from "../core/options.js";
import { ENV_MODES, DEFAULT_ENV_MODE, STORE_PLATFORMS, DEPLOY_MODES, DEFAULT_DEPLOY_MODE, deployModeWarning } from "../core/flutter-options.js";

export const CANCEL = engine.CANCEL;

// Language selection - asked before any language is known, so the message and every label are rendered
// once per supported language instead of in the active one. Returns the language code. CANCEL on cancel.
export async function selectLanguage() {
  return engine.select({
    message: SUPPORTED_LANGUAGES.map((lang) => t("ui.prompts.language.message", {}, lang)).join(" / "),
    options: SUPPORTED_LANGUAGES.map((lang) => ({ value: lang, label: t("ui.prompts.language.label", {}, lang) })),
    initialIndex: Math.max(0, SUPPORTED_LANGUAGES.indexOf(DEFAULT_LANGUAGE)),
  });
}

// Mode selection - localized labels, returns the internal key. CANCEL on cancel.
// again=true is a re-entry after running a read-only mode (status/doctor) and returning to the menu -
// asking "what should we install?" again would feel odd, so the wording changes.
export async function selectMode({ again = false } = {}) {
  return engine.select({
    message: again ? t("ui.prompts.mode.messageAgain") : t("ui.prompts.mode.message"),
    options: [
      { value: "full", label: t("ui.prompts.mode.full") },
      { value: "uninstall", label: t("ui.prompts.mode.uninstall") },
      { value: "status", label: t("ui.prompts.mode.status") },
      { value: "doctor", label: t("ui.prompts.mode.doctor") },
    ],
  });
}

// Project confirmation menu (continue/edit/cancel).
export async function confirmProjectMenu() {
  return engine.select({
    message: t("ui.prompts.confirm.message"),
    options: [
      { value: "continue", label: t("ui.prompts.confirm.continue") },
      { value: "edit", label: t("ui.prompts.confirm.edit") },
      { value: "cancel", label: t("ui.prompts.confirm.cancel") },
    ],
  });
}

// Edit menu items - showFlutter exposes env mode / store targets / deploy mode only for the Flutter type.
// Split into a pure function so labels and order can be tested.
// showOptions exposes the optional-workflow toggles (auto version bump, Copilot) - a saved value skips the first question, so it is changed here.
export function editMenuOptions({ showFlutter = false, showOptions = false } = {}) {
  const options = [
    { value: "type", label: t("ui.prompts.edit.type") },
    { value: "version", label: t("ui.prompts.edit.version") },
    { value: "branch", label: t("ui.prompts.edit.branch") },
  ];
  if (showOptions) {
    for (const o of askableOptions()) options.push({ value: o.name, label: t(o.ask.menuLabelKey) });
  }
  if (showFlutter) {
    options.push({ value: "envMode", label: t("ui.prompts.edit.envMode") });
    options.push({ value: "flutterStore", label: t("ui.prompts.edit.flutterStore") });
    options.push({ value: "deployMode", label: t("ui.prompts.edit.deployMode") });
  }
  options.push({ value: "done", label: t("ui.prompts.edit.done") });
  return options;
}

// Edit menu - which item to fix.
export async function editMenu({ showFlutter = false, showOptions = false } = {}) {
  return engine.select({ message: t("ui.prompts.edit.message"), options: editMenuOptions({ showFlutter, showOptions }) });
}

// Interactive type choices - built from the same registry as the CLI validation list (VALID_TYPES).
export const ALL_TYPES = TYPE_IDS;

// Type multi-select.
export async function selectTypes(current = []) {
  return engine.multiselect({
    message: t("ui.prompts.types.select"),
    options: ALL_TYPES.map((type) => ({ value: type, label: type, hint: typeInfo(type).displayName })),
    initialValues: current.length ? current : ["basic"],
    required: true,
  });
}

// Confirm types right after detection. Unlike selectTypes it appends the evidence file to the label
// to show "why it was decided this way" - the user can only judge right or wrong when the evidence is visible.
// If detection is right, a single Enter finishes it.
export async function confirmTypes({ types = [], markers = null } = {}) {
  const detected = new Set(types);
  engine.note(
    t("ui.prompts.types.confirmNote"),
    t("ui.prompts.types.confirmTitle"),
  );
  return engine.multiselect({
    message: t("ui.prompts.types.confirmMessage"),
    options: ALL_TYPES.map((type) => {
      const marker = markers?.get?.(type);
      // Only detected types get evidence - the rest are just listed as candidates.
      return {
        value: type,
        label: detected.has(type) && marker ? t("ui.prompts.types.withMarker", { type, marker }) : type,
        hint: typeInfo(type).displayName,
      };
    }),
    initialValues: types.length ? types : ["basic"],
    required: true,
  });
}

// Deploy style selection. Server-deploy CD workflows are alternatives to each other, so only one is used.
// Only the chosen one is installed and its push trigger is enabled - previously all four were installed with only SIMPLE on,
// so anyone wanting zero-downtime had to edit the YAML by hand after install.
// "No server deploy" excludes server-deploy workflows (CD / PR preview) for every type - a choice for projects
// that do not deploy to a server (frontend-only, libraries, ...).
// With nonstop=false (no selected type has a zero-downtime workflow) the unusable zero-downtime choices are left out.
export async function selectDeployStyle({ nonstop = true } = {}) {
  engine.note(
    t("ui.prompts.deployStyle.note"),
    t("ui.prompts.deployStyle.title"),
  );
  return engine.select({
    message: t("ui.prompts.deployStyle.message"),
    options: [
      // label may be a plain string or a lazy function depending on the registry
      ...DEPLOY_STYLES.filter((s) => nonstop || s.value === "simple").map((s) => ({ value: s.value, label: typeof s.label === "function" ? s.label() : s.label })),
      { value: NO_DEPLOY_STYLE, label: t("ui.prompts.deployStyle.none") },
    ],
  });
}

// ── Flutter options ──────────────────────────────────────
// interactive.js asks these only when the project types include flutter. All three functions return CANCEL
// as is on cancel (ESC); the "ESC = default" handling is up to the caller (same convention as selectDeployStyle).
// Labels are resolved lazily via t() so they follow the language chosen at run time.
const envModeLabel = (value) => t(`ui.prompts.envMode.label.${value}`);
const storeLabel = (value) => t(`ui.prompts.stores.label.${value}`);
const deployModeLabel = (platform, value) => t(`ui.prompts.deployMode.label.${platform}.${value}`);
const platformTitle = (platform) => t(`ui.prompts.deployMode.platform.${platform}`);

// Env mode - how the secret ENV_FILE (.env format) is passed to the Flutter build.
export async function selectEnvMode({ initialValue = DEFAULT_ENV_MODE } = {}) {
  engine.note(
    t("ui.prompts.envMode.note"),
    t("ui.prompts.envMode.title"),
  );
  return engine.select({
    message: t("ui.prompts.envMode.message"),
    options: ENV_MODES.map((value) => ({ value, label: envModeLabel(value) })),
    initialIndex: Math.max(0, ENV_MODES.indexOf(initialValue)),
  });
}

// Store deploy targets - installs only the workflows and fastlane templates of the chosen platforms. Choosing none installs without store deployment.
export async function selectFlutterStores({ initialValues = [] } = {}) {
  engine.note(
    t("ui.prompts.stores.note"),
    t("ui.prompts.stores.title"),
  );
  return engine.multiselect({
    message: t("ui.prompts.stores.message"),
    options: STORE_PLATFORMS.map((value) => ({ value, label: storeLabel(value) })),
    initialValues,
    required: false,
  });
}

// Deploy mode - asked once per platform. The runtime repository variable and workflow_dispatch input always take precedence over this value.
export async function selectDeployMode({ platform, initialValue = DEFAULT_DEPLOY_MODE }) {
  return engine.select({
    message: t("ui.prompts.deployMode.message", { platform: platformTitle(platform) }),
    options: DEPLOY_MODES.map((value) => ({ value, label: deployModeLabel(platform, value) })),
    initialIndex: Math.max(0, DEPLOY_MODES.indexOf(initialValue)),
  });
}

// store_submit warning text - defined in core; the caller (interactive) prints it via note.
export { deployModeWarning };

// Branch strategy selection. Previously trunk-based only happened when the same name was entered for both
// the "release branch" and "development branch" questions; that rule was never announced, so users
// drifted into pr-flow unintentionally. Choosing the strategy explicitly first removes that.
// Do not reorder the options (pr-flow first) - the order determines the default in non-TTY environments.
export async function selectBranchStrategy() {
  engine.note(
    t("ui.prompts.branch.note"),
    t("ui.prompts.branch.title"),
  );
  return engine.select({
    message: t("ui.prompts.branch.message"),
    options: [
      { value: "pr-flow", label: t("ui.prompts.branch.prFlow") },
      { value: "trunk-based", label: t("ui.prompts.branch.trunk") },
    ],
  });
}

// Text input (empty input keeps the default).
export async function askText(message, defaultValue = "") {
  const v = await engine.text({ message, defaultValue });
  if (v === CANCEL) return CANCEL;
  return v === "" || v == null ? defaultValue : v;
}

// Yes/no.
export async function askYesNo(message, initial = true) {
  return engine.confirm({ message, initialValue: initial });
}

// Banner / notice output.
export function intro(text) { engine.intro(text); }
export function outro(text) { engine.outro(text); }
export function note(text, title) { engine.note(text, title); }
export function cancelMessage(text = t("ui.readline-engine.cancelled")) { engine.cancelMessage(text); }

// ── First-screen UI layers + real io for the interactive layer ─────
// runInteractive calls io.<method>?.() optionally - test stubs omit these methods
// to skip the visual layers and env questions (the execution contract is unchanged).
import { printBanner as _printBanner } from "./banner.js";
import {
  printDetectionLog as _detLog, printAnalysisCard as _card,
  printInstallKind as _installKind,
} from "./status-cards.js";
import { printSummary as _summary } from "./summary.js";

export function banner(info) { _printBanner(info); }
export function detectionLog(info) { _detLog(info); }
export function analysisCard(info) { _card(info); }
export function installKind(info) { _installKind(info); }
export function summary(ctx) { _summary(ctx); }

// Low-level engine io used by the env plan, path resolution and conflict menu (io contract of env-plan/paths-resolve)
export const engineIo = {
  select: engine.select,
  multiselect: engine.multiselect,
  text: engine.text,
  confirm: engine.confirm,
};
