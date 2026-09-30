// Install settings resolution step, shared by non-interactive (index.js) and interactive (interactive.js) mode.
// How values are filled in (flags vs. questions) differs per path, but the rules that settle type, version,
// deploy style and options and assemble the install context belong in one place, so fixing only one side
// cannot make the two modes diverge.
import { detectVersion, detectBuildNumber } from "../core/detect-fs.js";
import { createContext } from "../context.js";
import { mergeHookResults } from "../core/types.js";
import { isDeployStyle, DEFAULT_DEPLOY_STYLE, hasServerDeployWorkflows, effectiveDeployStyle } from "../core/deploy-style.js";

// Deploy style saved in version.yml; "" when missing or unknown.
export const savedDeployStyle = (existing) =>
  isDeployStyle(existing?.options?.deployStyle) ? existing.options.deployStyle : "";

// Deploy style: explicit value (flag or question answer) -> saved value -> default.
// Types without server deploy workflows do not affect the install result, so nothing is recorded (null).
export function resolveDeployStyle({ payload, types, explicit = "", existing }) {
  if (!hasServerDeployWorkflows(payload, types)) return null;
  return explicit || savedDeployStyle(existing) || DEFAULT_DEPLOY_STYLE;
}

// Version: existing version.yml first (prevents overwriting on re-run) -> explicit value -> file detection.
// detectOpts is passed to the detection function as is (types, paths, warn, hint).
export function resolveVersion({ cwd, existing, explicit = "", ...detectOpts }) {
  return existing?.version || explicit || detectVersion(cwd, detectOpts);
}

// Build number: keep the existing value; for a new install detect it from the project files; 1 if not found.
export function resolveVersionCode({ cwd, existing, types, paths }) {
  return existing?.versionCode ?? detectBuildNumber(cwd, { types, paths }) ?? 1;
}

// Assemble the settled values into the install context.
//   deployStyle: result of resolveDeployStyle (the chosen value); recorded as the style actually installed.
//   typeOptions: type-specific options settled by the type hook (resolveOptions), settled on both paths; the type hook also converts them into context fields.
//   releaseOptions: { includeSemverAuto, includeCopilotAi }, the resolveReleaseOptions result.
//   extra: fields used by one path only (envValues etc.).
export function buildInstallContext({
  payload, existing, templateVersion, types, deployStyle, typeOptions, releaseOptions, ...rest
}) {
  return createContext({
    types,
    ...releaseOptions,
    // Guidance uses the chosen value, but the record uses the style actually installed.
    deployStyle: effectiveDeployStyle(payload, types, deployStyle),
    ...mergeHookResults(types, "contextFields", typeOptions),
    previousTemplateVersion: existing?.templateVersion || "",
    templateVersion,
    ...rest,
  });
}
