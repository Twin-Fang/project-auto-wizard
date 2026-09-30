// Flutter options: single source of truth for the env-var mode, store deploy targets and deploy modes.
// Store deploy targets follow the same structure as deploy-style.js (deploy style): value list, file filter, deselection cleanup.
import { join } from "node:path";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { sha256 } from "./baseline.js";
import { t } from "../i18n/index.js";

// Env-var injection mode. dart-define uses --dart-define-from-file; dotenv generates the .env for flutter_dotenv/envied.
// No "both" option that uses the two at once: it would mean managing env vars in two places.
export const ENV_MODES = ["dart-define", "dotenv"];
export const DEFAULT_ENV_MODE = "dart-define"; // default for new installs
export const LEGACY_ENV_MODE = "dotenv";       // preserved so an existing install (has version.yml, no saved value) does not break silently

export const STORE_PLATFORMS = ["android", "ios"];
export const DEPLOY_MODES = ["store_only", "store_prepare", "store_submit"];
export const DEFAULT_DEPLOY_MODE = "store_only";
export const NO_STORE = "none";

export const isEnvMode = (v) => ENV_MODES.includes(v);
export const isDeployMode = (v) => DEPLOY_MODES.includes(v);

// "android,ios" | "android" | "none" | "" to an array. Always in STORE_PLATFORMS order, so serialization is deterministic.
// null when any token is unknown or the input is not a string; callers treat that as "no value / invalid value".
export function parseStoreList(csv) {
  if (typeof csv !== "string") return null;
  const tokens = csv.split(",").map((t) => t.trim()).filter((t) => t !== "");
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === NO_STORE)) return [];
  if (!tokens.every((t) => STORE_PLATFORMS.includes(t))) return null;
  return STORE_PLATFORMS.filter((p) => tokens.includes(p));
}

// Serialization for saving: an empty array is written as "none" rather than an empty string, to tell "nothing selected" from "no value".
export function formatStoreList(stores) {
  const ordered = STORE_PLATFORMS.filter((p) => stores.includes(p));
  return ordered.length ? ordered.join(",") : NO_STORE;
}

// Store workflows per platform (file names relative to payload/workflows/flutter/).
// FIREBASE, SELFHOSTED, TEST-APK, APP-BUILD-TRIGGER and CI are unrelated to the stores and are not listed here: they are always installed.
export const STORE_WORKFLOWS = {
  android: ["PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"],
  ios: ["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml", "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"],
};

export const isStoreWorkflow = (filename) => Object.values(STORE_WORKFLOWS).flat().includes(filename);

// File filter: null stores means undecided, which keeps current behavior (install everything).
// With an array, store workflows pass only for the selected platforms and all other files always pass.
export function storeWorkflowFilter(stores) {
  if (stores === null || stores === undefined) return () => true;
  const allowed = new Set(STORE_PLATFORMS.filter((p) => stores.includes(p)).flatMap((p) => STORE_WORKFLOWS[p]));
  return (filename) => !isStoreWorkflow(filename) || allowed.has(filename);
}

// Cleanup of deselected store workflows: same rule as cleanupOtherDeployWorkflows (deploy-style.js).
//   untouched (same as the baseline installed hash) -> deleted
//   modified                                        -> moved to .bak (content kept, only the trigger is killed)
// User-owned Fastfile and ExportOptions.plist are not handled here (workflow files only).
// With dryRun only the decision is made and no files are touched (for the --dry-run preview).
// Returns: { removed:[], backedUp:[] }
export function cleanupDeselectedStoreWorkflows(workflowsDir, installedFilenames, stores, baseline, { dryRun = false } = {}) {
  const keep = storeWorkflowFilter(stores);
  const removed = [];
  const backedUp = [];

  for (const filename of installedFilenames) {
    if (!isStoreWorkflow(filename) || keep(filename)) continue;
    const p = join(workflowsDir, filename);
    if (!existsSync(p)) continue;

    const known = baseline?.files?.[filename]?.installed;
    const untouched = known && sha256(readFileSync(p, "utf8")) === known;
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

// Store app files (paths relative to payload/flutter-app/), grouped per platform.
export const STORE_APP_FILES = {
  android: ["android/fastlane/Fastfile.playstore"],
  ios: ["ios/fastlane/Fastfile", "ios/ExportOptions.plist"],
};

// App file list for the selected platforms. All of them when stores is null (current behavior = install both).
export function storeAppFilesFor(stores) {
  const platforms = stores === null || stores === undefined
    ? STORE_PLATFORMS
    : STORE_PLATFORMS.filter((p) => stores.includes(p));
  return platforms.flatMap((p) => STORE_APP_FILES[p]);
}

// store_submit submits a review on every main push, so a one-line notice is shown right after it is chosen. Other modes have nothing to announce, hence an empty string.
export function deployModeWarning(mode) {
  return mode === "store_submit" ? t("core.flutterOptions.storeSubmitWarning") : "";
}

const validOr = (isValid, value, fallback) => (isValid(value) ? value : fallback);

// Final option decision. Priority: CLI > value saved in version.yml > default.
//   cli      { envMode:"", stores:null|string[], androidDeployMode:"", iosDeployMode:"" } (empty/null = not given)
//   existing parseExisting() result or null (no version.yml means a fresh install)
//
// - envMode default: fresh installs and existing installs that are "newly adding Flutter" get dart-define; projects
//   that already had Flutter installed get dotenv. This keeps a single update from silently breaking a flutter_dotenv
//   project, so the criterion is "did this project already have Flutter" (not merely whether existing is present:
//   adding the flutter type for the first time to a Spring-only project must not be lumped into dotenv).
// - stores: null means "undecided": non-interactive keeps current behavior (install both), interactive asks.
// - Saved values are used only when valid. version.yml can be hand-edited and the value goes straight into a
//   workflow expression (the `|| 'store_only'` fallback slot), so strings outside the list must be filtered out.
export function resolveFlutterOptions({ cli = {}, existing = null } = {}) {
  const saved = existing?.options ?? {};
  const hadFlutterAlready = Array.isArray(existing?.types) && existing.types.includes("flutter");
  return {
    envMode: cli.envMode || validOr(isEnvMode, saved.envMode, hadFlutterAlready ? LEGACY_ENV_MODE : DEFAULT_ENV_MODE),
    stores: cli.stores ?? parseStoreList(saved.flutterStore),
    androidDeployMode: cli.androidDeployMode || validOr(isDeployMode, saved.androidDeployMode, DEFAULT_DEPLOY_MODE),
    iosDeployMode: cli.iosDeployMode || validOr(isDeployMode, saved.iosDeployMode, DEFAULT_DEPLOY_MODE),
  };
}
