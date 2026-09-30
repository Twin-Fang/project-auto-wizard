// Value-decision rules for the release options (semver_auto, copilot_ai, ...), shared by non-interactive (index.js) and
// interactive (interactive.js) modes. The rules themselves live in the option registry (core/options.js); this file keeps
// the existing import path and names.
// Priority: explicit value (CLI flag / prompt answer) -> saved value in version.yml -> default. Keeping one implementation
// stops the same repo from being installed with different settings depending on how the wizard was run.
export { pickOptionValues as pickReleaseOptions, resolveOptionValues as resolveReleaseOptions } from "./options.js";
