// tests/node/release-options.test.js
// Resolution rules for semver_auto and copilot_ai — non-interactive and interactive flows share the same function, so pin them here once.
import { test } from "node:test";
import assert from "node:assert";
import { pickReleaseOptions, resolveReleaseOptions } from "../../src/core/release-options.js";

const saved = (semverAuto, copilotAi) => ({ options: { semverAuto, copilotAi } });

test("fresh install defaults: semver_auto on, copilot off", () => {
  assert.deepStrictEqual(resolveReleaseOptions({}, null), { includeSemverAuto: true, includeCopilotAi: false, includeReleaseAutomerge: true });
});

test("existing install without a saved value: semver_auto is also left off", () => {
  assert.deepStrictEqual(resolveReleaseOptions({}, saved(null, null)), { includeSemverAuto: false, includeCopilotAi: false, includeReleaseAutomerge: true });
});

test("a saved value takes precedence over the default", () => {
  assert.deepStrictEqual(resolveReleaseOptions({}, saved(true, true)), { includeSemverAuto: true, includeCopilotAi: true, includeReleaseAutomerge: true });
  assert.deepStrictEqual(resolveReleaseOptions({}, saved(false, false)), { includeSemverAuto: false, includeCopilotAi: false, includeReleaseAutomerge: true });
});

test("an explicit value (flag or answer) takes precedence over the saved value", () => {
  assert.deepStrictEqual(
    resolveReleaseOptions({ semverAuto: false, copilotAi: true }, saved(true, false)),
    { includeSemverAuto: false, includeCopilotAi: true, includeReleaseAutomerge: true });
  assert.deepStrictEqual(
    resolveReleaseOptions({ semverAuto: true, copilotAi: false }, saved(false, true)),
    { includeSemverAuto: true, includeCopilotAi: false, includeReleaseAutomerge: true });
});

test("pickReleaseOptions leaves undecided values as null — the interactive flow uses this to decide whether to ask", () => {
  assert.deepStrictEqual(pickReleaseOptions({}, null), { semverAuto: null, copilotAi: null, releaseAutomerge: null });
  assert.deepStrictEqual(pickReleaseOptions({ copilotAi: undefined }, saved(false, null)), { semverAuto: false, copilotAi: null, releaseAutomerge: null });
  assert.deepStrictEqual(pickReleaseOptions({ semverAuto: true }, saved(false, true)), { semverAuto: true, copilotAi: true, releaseAutomerge: null });
});
