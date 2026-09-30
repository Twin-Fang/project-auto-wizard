// tests/node/options-characterization.test.js
// Characterization tests that pin the current behavior of the existing options (semver_auto, copilot_ai) before the
// options-registry refactor. If the refactor changes any of these outputs, that is a regression, not a test to update.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { parseArgs, CliError } from "../../src/cli/args.js";
import { helpText } from "../../src/cli/help.js";
import { pickReleaseOptions, resolveReleaseOptions } from "../../src/core/release-options.js";
import { parseTemplateOptions } from "../../src/core/version-yml.js";
import { printStatus } from "../../src/commands/status.js";
import { printAnalysisCard } from "../../src/ui/status-cards.js";

const ymlWith = (body) => `metadata:\n  template:\n    version: "1.0.0"\n    options:\n${body}`;

// ── resolution ───────────────────────────────────────────────────────────────
test("resolve: new install defaults to semver on, copilot off", () => {
  assert.deepStrictEqual(resolveReleaseOptions({}, null), { includeSemverAuto: true, includeCopilotAi: false, includeReleaseAutomerge: true });
});

test("resolve: existing install without the keys stays semver off, copilot off", () => {
  const existing = { options: { semverAuto: null, copilotAi: null } };
  assert.deepStrictEqual(resolveReleaseOptions({}, existing), { includeSemverAuto: false, includeCopilotAi: false, includeReleaseAutomerge: true });
});

test("resolve: explicit value beats the saved value; saved value beats the default", () => {
  const existing = { options: { semverAuto: false, copilotAi: true } };
  assert.deepStrictEqual(resolveReleaseOptions({}, existing), { includeSemverAuto: false, includeCopilotAi: true, includeReleaseAutomerge: true });
  assert.deepStrictEqual(
    resolveReleaseOptions({ semverAuto: true, copilotAi: false }, existing),
    { includeSemverAuto: true, includeCopilotAi: false, includeReleaseAutomerge: true });
});

test("pick: undecided stays null (interactive mode uses it to decide whether to ask)", () => {
  assert.deepStrictEqual(pickReleaseOptions({}, null), { semverAuto: null, copilotAi: null, releaseAutomerge: null });
  assert.deepStrictEqual(pickReleaseOptions({ semverAuto: false }, { options: { copilotAi: true } }),
    { semverAuto: false, copilotAi: true, releaseAutomerge: null });
});

// ── CLI flags ────────────────────────────────────────────────────────────────
test("args: option flags map to context fields, unset stays null", () => {
  assert.strictEqual(parseArgs(["--copilot"]).includeCopilotAi, true);
  assert.strictEqual(parseArgs(["--no-copilot"]).includeCopilotAi, false);
  assert.strictEqual(parseArgs(["--semver-auto"]).includeSemverAuto, true);
  assert.strictEqual(parseArgs(["--no-semver-auto"]).includeSemverAuto, false);
  const none = parseArgs([]);
  assert.strictEqual(none.includeCopilotAi, null);
  assert.strictEqual(none.includeSemverAuto, null);
});

test("args: conflicting flags throw CliError with the fixed message", () => {
  assert.throws(() => parseArgs(["--copilot", "--no-copilot"]),
    (e) => e instanceof CliError && e.message === "--copilot과 --no-copilot은 동시에 지정할 수 없습니다");
  assert.throws(() => parseArgs(["--no-copilot", "--copilot"]), CliError);
  assert.throws(() => parseArgs(["--semver-auto", "--no-semver-auto"]),
    (e) => e instanceof CliError && e.message === "--semver-auto와 --no-semver-auto는 동시에 지정할 수 없습니다");
  assert.throws(() => parseArgs(["--no-semver-auto", "--semver-auto"]), CliError);
});

test("help: lists every option flag", () => {
  const h = helpText("ko");
  for (const f of ["--semver-auto", "--no-semver-auto", "--copilot", "--no-copilot"]) assert.ok(h.includes(f), f);
});

// ── version.yml parsing ──────────────────────────────────────────────────────
test("parseTemplateOptions: saved true/false/missing", () => {
  const a = parseTemplateOptions(ymlWith("      semver_auto: true\n      copilot_ai: false\n"));
  assert.strictEqual(a.semverAuto, true);
  assert.strictEqual(a.copilotAi, false);
  const b = parseTemplateOptions(ymlWith(""));
  assert.strictEqual(b.semverAuto, null);
  assert.strictEqual(b.copilotAi, null);
});

test("parseTemplateOptions: same keys outside the options block are ignored", () => {
  const out = parseTemplateOptions("semver_auto: true\ncopilot_ai: true\n" + ymlWith(""));
  assert.strictEqual(out.semverAuto, null);
  assert.strictEqual(out.copilotAi, null);
});

// ── display ──────────────────────────────────────────────────────────────────
function captureLog(fn) {
  const orig = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(" "));
  try { fn(); } finally { console.log = orig; }
  return lines.join("\n");
}

test("status: options line format", () => {
  const status = {
    installed: true, version: "1.0.0", templateVersion: "1.0.0", types: ["basic"], branches: null,
    options: { semverAuto: true, copilotAi: null, deployStyle: null },
    modifiedFiles: [], missingFiles: [], staleFiles: [], missingScripts: [], droppedPaths: [],
  };
  const out = captureLog(() => printStatus(status));
  assert.match(out, /semver_auto=true copilot_ai=\S+/);
});

test("analysis card: option rows keep their icon, label and on/off text", () => {
  const out = [];
  printAnalysisCard({ types: ["basic"], options: { semverAuto: true, copilotAi: false } }, (s) => out.push(s));
  const text = out.join("").replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(text, /🔢 자동승격\s+켜짐/);
  assert.match(text, /🤖 Copilot\s+꺼짐/);
});
