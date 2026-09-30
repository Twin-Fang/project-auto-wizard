// Value-decision rules for the release options (semver_auto, copilot_ai), shared by non-interactive (index.js) and interactive (interactive.js) modes.
// Priority: explicit value (CLI flag, prompt answer), then the value saved in version.yml, then the default.
// Keeping separate copies per path would install the same repo with different settings depending on how it was run.

// Reflects only explicit and saved values. null means not decided yet (interactive mode uses it to decide whether to ask).
export function pickReleaseOptions(explicit = {}, existing = null) {
  return {
    semverAuto: explicit.semverAuto ?? existing?.options?.semverAuto ?? null,
    copilotAi: explicit.copilotAi ?? existing?.options?.copilotAi ?? null,
  };
}

// Final values: fills undecided options with defaults.
// semver_auto: true only for fresh installs. If an existing install whose version.yml lacked the key (installed
//   before the feature existed) were switched on silently, one ambiguous commit could promote a major bump, so it stays false.
// copilot_ai: an opt-in that consumes AI credits, so it is false for both new and existing installs unless stated.
export function resolveReleaseOptions(explicit = {}, existing = null) {
  const { semverAuto, copilotAi } = pickReleaseOptions(explicit, existing);
  return {
    includeSemverAuto: semverAuto === null ? !existing : semverAuto !== false,
    includeCopilotAi: copilotAi === true,
  };
}
