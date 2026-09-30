// Flutter type hooks: the implementations the flutter entry of the types.js registry points to.
// Common code does not know flutter directly and calls it only by hook name (see the types.js header for each hook's contract).
import { existsSync } from "node:fs";
import {
  ENV_MODES, DEPLOY_MODES, DEFAULT_ENV_MODE, DEFAULT_DEPLOY_MODE, STORE_PLATFORMS, NO_STORE,
  isEnvMode, isDeployMode, parseStoreList, formatStoreList, deployModeWarning,
  storeWorkflowFilter, cleanupDeselectedStoreWorkflows, resolveFlutterOptions,
} from "./flutter-options.js";
import { planFlutterAppFiles, copyFlutterAppFiles } from "./copy/flutter-app.js";
import { flutterStoreChecks } from "./flutter-doctor.js";
import { inferInstalledStores } from "./installed-stores.js";
import { escapeYamlDoubleQuoted } from "./wizard-env.js";
import { CliError } from "./errors.js";
import { t } from "../i18n/index.js";

// When there is no saved value, also states the behavior that actually applies in that state.
function statusLabels(options) {
  return [
    ` env_mode=${options.envMode ?? t("core.flutterHooks.status.envModeUnset")}`,
    ` flutter_store=${options.flutterStore ?? t("core.flutterHooks.status.storeUnset")}`,
    ` android_deploy_mode=${options.androidDeployMode ?? t("core.flutterHooks.status.deployModeUnset")}`,
    ` ios_deploy_mode=${options.iosDeployMode ?? t("core.flutterHooks.status.deployModeUnset")}`,
  ].join("");
}

// An existing Flutter install with no saved store value is inferred from the installed store workflows (same conclusion as interactive).
// Without inference the undecided state would be saved as "both", resurrecting workflows and fastlane files of a platform that was removed.
// Without workflowsDir (read-only paths such as status) no inference is made.
function resolveOptions({ opts = {}, existing = null, workflowsDir = null }) {
  const inferredStores = workflowsDir && opts.flutterStore == null && existing?.types?.includes("flutter")
    && existing.options?.flutterStore == null && existsSync(workflowsDir)
    ? inferInstalledStores(workflowsDir) : null;
  return resolveFlutterOptions({
    cli: {
      envMode: opts.flutterEnvMode ?? "", stores: opts.flutterStore ?? inferredStores,
      androidDeployMode: opts.androidDeployMode ?? "", iosDeployMode: opts.iosDeployMode ?? "",
    },
    existing,
  });
}

// Flutter block under version.yml options (6-space indent). Empty values are filled with the same values as the workflow template defaults,
// so the saved values do not diverge from what was actually installed. When stores is null (undecided) both are installed as today, so "android,ios" is recorded.
function versionOptionsBlock({ envMode, stores, androidDeployMode, iosDeployMode } = {}) {
  const quote = (v) => `"${escapeYamlDoubleQuoted(v)}"`;
  return [
    `      env_mode: ${quote(envMode || DEFAULT_ENV_MODE)} # ${ENV_MODES.join(" | ")} ${t("core.flutterHooks.comment.envMode")}`,
    `      flutter_store: ${quote(formatStoreList(stores ?? STORE_PLATFORMS))} # android | ios | android,ios | none ${t("core.flutterHooks.comment.store")}`,
    `      android_deploy_mode: ${quote(androidDeployMode || DEFAULT_DEPLOY_MODE)} # ${DEPLOY_MODES.join(" | ")} ${t("core.flutterHooks.comment.androidDeployMode")}`,
    `      ios_deploy_mode: ${quote(iosDeployMode || DEFAULT_DEPLOY_MODE)} # ${DEPLOY_MODES.join(" | ")} ${t("core.flutterHooks.comment.iosDeployMode")}`,
  ].join("\n");
}

// Builds one flag validated against a value list; CliError when the value is outside the list.
const enumFlag = (flag, field, isValid, allowed) => ({
  flag, field, initial: "",
  parse(v) {
    if (!isValid(v)) throw new CliError(t("core.flutterHooks.err.invalidFlag", { flag, value: v ?? t("core.flutterHooks.noValue"), allowed: allowed.join(" | ") }));
    return v;
  },
});

export const flutterHooks = {
  resolveOptions,
  // Decided options to install-context fields. The defaults are the "undecided" state used when there are no options.
  contextDefaults: {
    envMode: "",             // "dart-define" | "dotenv". ""=undecided, template default (dart-define) applies
    flutterStore: null,      // store deploy targets, string[] (e.g. ["android","ios"]). null=undecided, both (current behavior)
    androidDeployMode: "",   // store_only | store_prepare | store_submit. ""=undecided, store_only
    iosDeployMode: "",       // same as above (iOS)
  },
  contextFields: (options) => ({
    envMode: options.envMode,
    flutterStore: options.stores,
    androidDeployMode: options.androidDeployMode,
    iosDeployMode: options.iosDeployMode,
  }),
  optionsFromContext: ({ envMode, flutterStore, androidDeployMode, iosDeployMode }) => ({
    envMode, stores: flutterStore, androidDeployMode, iosDeployMode,
  }),
  versionOptionsBlock,
  // Saved version.yml key to parsed-result field. The value is returned as the raw string; validity is resolveOptions' job.
  savedOptionKeys: {
    env_mode: "envMode", flutter_store: "flutterStore",
    android_deploy_mode: "androidDeployMode", ios_deploy_mode: "iosDeployMode",
  },
  // CLI flags: parsed-result field (opts) and value validation. initial is the not-given value.
  cliFlags: [
    enumFlag("--flutter-env-mode", "flutterEnvMode", isEnvMode, ENV_MODES),
    {
      flag: "--flutter-store", field: "flutterStore", initial: null,
      parse(v) {
        // parseStoreList sees an empty string as [], but "select no store" is accepted only as an explicit none.
        const stores = v ? parseStoreList(v) : null;
        if (stores === null) {
          throw new CliError(t("core.flutterHooks.err.invalidFlag", { flag: "--flutter-store", value: v || t("core.flutterHooks.noValue"), allowed: [STORE_PLATFORMS.join(","), ...STORE_PLATFORMS, NO_STORE].join(" | ") }));
        }
        return stores;
      },
    },
    enumFlag("--android-deploy-mode", "androidDeployMode", isDeployMode, DEPLOY_MODES),
    enumFlag("--ios-deploy-mode", "iosDeployMode", isDeployMode, DEPLOY_MODES),
  ],
  // Warnings shown right after install: store_submit auto-submits a review on every main push, so it must not appear for a store that was not selected.
  installNotices: ({ stores, androidDeployMode, iosDeployMode }) => [
    (stores === null || stores.includes("android")) && deployModeWarning(androidDeployMode),
    (stores === null || stores.includes("ios")) && deployModeWarning(iosDeployMode),
  ],
  // Selected values to record in the install log, as [name, value] pairs
  logChoices: (context) => {
    const stores = Array.isArray(context.flutterStore) ? (context.flutterStore.join(",") || t("core.flutterHooks.log.storesNone")) : t("core.flutterHooks.log.storesUndecided");
    return [["flutter",
      `env=${context.envMode || "-"} stores=${stores} android=${context.androidDeployMode || "-"} ios=${context.iosDeployMode || "-"}`]];
  },
  // The store workflow filter applies only when the store target is an array (null=undecided, install everything).
  workflowFilter: ({ flutterStore }) => (Array.isArray(flutterStore) ? storeWorkflowFilter(flutterStore) : null),
  // Cleans up deselected store workflows; when the target is undecided (null) nothing is deleted.
  cleanupWorkflows: (workflowsDir, installed, context, baseline, opts) => (Array.isArray(context.flutterStore)
    ? cleanupDeselectedStoreWorkflows(workflowsDir, installed, context.flutterStore, baseline, opts)
    : { removed: [], backedUp: [] }),
  appFilesTag: "flutter-app",
  planAppFiles: planFlutterAppFiles,
  copyAppFiles: copyFlutterAppFiles,
  statusLabels,
  doctorChecks: flutterStoreChecks,
};
