// Payload asset resolution: zero network access (replaces the old acquireTemplate/git clone).
// The payload/ bundled in the npm package is the single source of truth for every asset the wizard installs.
// Even when run from the npx global cache, import.meta.url points precisely at the payload inside the package.
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { exists, readText, listYamlFiles } from "./fsutil.js";
import { DEFAULT_VERSION } from "../context.js";
import { t } from "../i18n/index.js";

// Absolute path of payload/ inside the package. Tests and fixtures can substitute it by argument injection.
export function resolvePayloadRoot() {
  return fileURLToPath(new URL("../../payload/", import.meta.url));
}

// Wizard (= template) version: the version in the package's package.json.
// Serves the same consumers as the former readTemplateVersion(tempDir/version.yml): banner, breaking-change comparison, version.yml record.
export function readTemplateVersion() {
  try {
    const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.version || DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}

// List of yaml files directly under payload/workflows/common.
export function listCommonWorkflows(payloadRoot = resolvePayloadRoot()) {
  return listYamlFiles(join(payloadRoot, "workflows", "common"));
}

// Payload structure self-check: fails clearly when a required folder is missing (catches packaging errors early).
export function assertPayload(payloadRoot = resolvePayloadRoot()) {
  if (!exists(join(payloadRoot, "workflows"))) {
    throw new Error(t("core.assets.missingWorkflows"));
  }
  if (!exists(join(payloadRoot, "scripts"))) {
    throw new Error(t("core.assets.missingScripts"));
  }
  return payloadRoot;
}

// Raw text of payload/version.yml.template.
export function readVersionYmlTemplate(payloadRoot = resolvePayloadRoot()) {
  const p = join(payloadRoot, "version.yml.template");
  return exists(p) ? readText(p) : null;
}
