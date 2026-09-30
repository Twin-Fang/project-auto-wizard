// Flutter diagnostic checks, called by doctor through the type hook (doctorChecks).
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { PATHS } from "./paths.js";
import { STORE_PLATFORMS, STORE_APP_FILES, parseStoreList, storeAppFilesFor } from "./flutter-options.js";
import { inferInstalledStores } from "./installed-stores.js";
import { t } from "../i18n/index.js";

const PLATFORM_ROW_NAME = { android: "core.flutterDoctor.row.android", ios: "core.flutterDoctor.row.ios" }; // catalog keys, resolved lazily
const PLACEHOLDER_RE = /__[A-Z][A-Z0-9_]*__/g; // Same detection rule as the ExportOptions.plist template and the IOS-TESTFLIGHT validation
const EXPORT_OPTIONS_REL = STORE_APP_FILES.ios.find((rel) => rel.endsWith("ExportOptions.plist"));

// Flutter store deploy diagnostics: required files for the selected platforms and ExportOptions.plist placeholders.
// Whether store secrets are registered is out of scope. Returns an array of doctor result rows.
export function flutterStoreChecks(cwd, existing, { docs }) {
  const saved = existing.options.flutterStore == null ? null : parseStoreList(existing.options.flutterStore);
  // An existing install with no saved value is inferred from the installed store workflows (same rule as interactive).
  const stores = saved ?? inferInstalledStores(join(cwd, PATHS.workflowsDir));
  const flutterRoot = existing.paths.get("flutter") || ".";
  const rows = [];

  for (const platform of STORE_PLATFORMS.filter((p) => stores.includes(p))) {
    const files = storeAppFilesFor([platform]).map((rel) => posix.join(flutterRoot, rel));
    const missing = files.filter((file) => !existsSync(join(cwd, file)));
    const head = { name: t(PLATFORM_ROW_NAME[platform]), purpose: t("core.flutterDoctor.purpose.storeFiles") };
    rows.push(missing.length
      ? {
        ...head, status: "WARN", value: t("core.flutterDoctor.value.missing", { files: missing.join(", ") }),
        impact: [t("core.flutterDoctor.impact.missing")],
        actions: [t("core.flutterDoctor.action.missing")],
        doc: docs.flutterStore,
      }
      : { ...head, status: "OK", value: t("core.flutterDoctor.value.present", { count: files.length }) });
  }

  const plistPath = posix.join(flutterRoot, EXPORT_OPTIONS_REL);
  if (stores.includes("ios") && existsSync(join(cwd, plistPath))) {
    const head = { name: "ExportOptions.plist", purpose: t("core.flutterDoctor.purpose.exportOptions") };
    const left = [...new Set(readFileSync(join(cwd, plistPath), "utf8").match(PLACEHOLDER_RE) ?? [])];
    rows.push(left.length
      ? {
        ...head, status: "WARN", value: t("core.flutterDoctor.value.unfilled", { left: left.join(", ") }),
        impact: [t("core.flutterDoctor.impact.unfilled")],
        actions: [t("core.flutterDoctor.action.unfilled", { path: plistPath })],
        doc: docs.flutterStore,
      }
      : { ...head, status: "OK", value: t("core.flutterDoctor.value.noPlaceholder") });
  }
  return rows;
}
