// tests/node/release-automerge-option.test.js
// Release PR automerge option (release_automerge). Default ON - also for existing installs whose version.yml lacks the key,
// because automerge is what those installs already do. It is never asked in the wizard; the flag and version.yml are the controls.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs, CliError } from "../../src/cli/args.js";
import { helpText } from "../../src/cli/help.js";
import { run } from "../../src/index.js";
import { resolveReleaseOptions } from "../../src/core/release-options.js";
import { parseTemplateOptions, parseExisting } from "../../src/core/version-yml.js";
import { runInteractive } from "../../src/commands/interactive.js";

const CLOCK = { now: "2026-09-30 00:00:00", today: "2026-09-30" };
const optionsYml = (line) => ["metadata:", "  template:", "    options:", ...(line ? [line] : [])].join("\n");

function tempProject() {
  const target = mkdtempSync(join(tmpdir(), "paw-automerge-"));
  writeFileSync(join(target, "package.json"), "{}\n");
  return target;
}
const install = (target, extra = []) =>
  run(["--mode", "full", "--force", "--type", "node", ...extra], { cwd: target, clock: CLOCK });
const saved = (target) => parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));

test("resolve: ON for new installs and for existing installs without the key", () => {
  assert.strictEqual(resolveReleaseOptions({}, null).includeReleaseAutomerge, true);
  assert.strictEqual(resolveReleaseOptions({}, { options: {} }).includeReleaseAutomerge, true);
});

test("resolve: a saved false is kept, and an explicit value wins", () => {
  const existing = { options: { releaseAutomerge: false } };
  assert.strictEqual(resolveReleaseOptions({}, existing).includeReleaseAutomerge, false);
  assert.strictEqual(resolveReleaseOptions({ releaseAutomerge: true }, existing).includeReleaseAutomerge, true);
});

test("args: --release-automerge / --no-release-automerge, both together is an error", () => {
  assert.strictEqual(parseArgs([]).includeReleaseAutomerge, null);
  assert.strictEqual(parseArgs(["--release-automerge"]).includeReleaseAutomerge, true);
  assert.strictEqual(parseArgs(["--no-release-automerge"]).includeReleaseAutomerge, false);
  assert.throws(() => parseArgs(["--release-automerge", "--no-release-automerge"]),
    (e) => e instanceof CliError && e.message.includes("--release-automerge") && e.message.includes("--no-release-automerge"));
});

test("help: lists the release automerge flags", () => {
  assert.ok(helpText("ko").includes("--release-automerge / --no-release-automerge"));
  assert.ok(helpText("en").includes("--release-automerge / --no-release-automerge"));
});

test("parseTemplateOptions: release_automerge true/false/unset", () => {
  assert.strictEqual(parseTemplateOptions(optionsYml("      release_automerge: false")).releaseAutomerge, false);
  assert.strictEqual(parseTemplateOptions(optionsYml("      release_automerge: true")).releaseAutomerge, true);
  assert.strictEqual(parseTemplateOptions(optionsYml("")).releaseAutomerge, null);
});

test("run(): default install writes release_automerge: true, the flag turns it off, a rerun keeps the saved value", async () => {
  const target = tempProject();
  try {
    assert.strictEqual(await install(target), 0);
    assert.strictEqual(saved(target).releaseAutomerge, true);
    assert.strictEqual(await install(target, ["--no-release-automerge"]), 0);
    assert.strictEqual(saved(target).releaseAutomerge, false);
    assert.strictEqual(await install(target), 0);
    assert.strictEqual(saved(target).releaseAutomerge, false, "a rerun without the flag keeps the saved false");
    assert.strictEqual(await install(target, ["--release-automerge"]), 0);
    assert.strictEqual(saved(target).releaseAutomerge, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): an existing install without the key gets release_automerge: true (existing behaviour preserved)", async () => {
  const target = tempProject();
  try {
    await install(target);
    const vy = join(target, "version.yml");
    writeFileSync(vy, readFileSync(vy, "utf8").split("\n").filter((l) => !l.includes("release_automerge")).join("\n"));
    assert.strictEqual(saved(target).releaseAutomerge, null);
    assert.strictEqual(await install(target), 0);
    assert.strictEqual(saved(target).releaseAutomerge, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

function stubIo(asked) {
  return {
    selectMode: async () => "full",
    confirmProjectMenu: async () => "continue",
    confirmTypes: async ({ types }) => types,
    selectDeployStyle: async () => "simple",
    selectBranchStrategy: async () => "pr-flow",
    askYesNo: async (message, def) => { asked.push(message); return def; },
    askText: async (_m, def) => def,
    note: () => {}, cancelMessage: () => {}, summary: () => {}, outro: () => {},
    editMenu: async () => "done",
  };
}

test("interactive: never asks about release_automerge, and a saved false survives an interactive reinstall", async () => {
  const target = tempProject();
  try {
    await install(target, ["--no-release-automerge"]);
    const asked = [];
    assert.strictEqual(await runInteractive({}, { cwd: target, io: stubIo(asked) }), 0);
    assert.ok(!asked.some((m) => /automerge|자동 머지/i.test(m)), "no question for release_automerge");
    assert.strictEqual(saved(target).releaseAutomerge, false, "the saved false must not be reset by the wizard");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("interactive: a first interactive install writes release_automerge: true", async () => {
  const target = tempProject();
  try {
    assert.strictEqual(await runInteractive({}, { cwd: target, io: stubIo([]) }), 0);
    assert.strictEqual(saved(target).releaseAutomerge, true);
    assert.strictEqual(parseExisting(readFileSync(join(target, "version.yml"), "utf8")).options.releaseAutomerge, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("status: a missing release_automerge key is shown as default true, not default false", async () => {
  const { printStatus } = await import("../../src/commands/status.js");
  const status = {
    installed: true, version: "1.0.0", templateVersion: "1.0.0", types: ["basic"], branches: null,
    options: { semverAuto: null, copilotAi: null, releaseAutomerge: null, deployStyle: null },
    modifiedFiles: [], missingFiles: [], staleFiles: [], missingScripts: [], droppedPaths: [],
  };
  const orig = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(" "));
  try { printStatus(status); } finally { console.log = orig; }
  const out = lines.join("\n");
  assert.ok(out.includes("release_automerge=미설정(기본 true)"), out);
  assert.ok(out.includes("copilot_ai=미설정(기본 false)"), "the false-default options keep their label");
});

test("args: --release-automerge=value fails like the other switches (not as an unknown option)", () => {
  const messageOf = (argv) => { try { parseArgs(argv); } catch (e) { return e.message; } return ""; };
  const copilot = messageOf(["--copilot=false"]);
  const automerge = messageOf(["--release-automerge=false"]);
  assert.ok(copilot && automerge);
  assert.strictEqual(automerge.replaceAll("release-automerge", "copilot"), copilot);
});

// Squash and rebase are not merge methods the release flow supports by itself (the merge result carries [skip ci] and the
// history changes); any line that mentions squash must say so instead of offering it as an equal choice.
test("guidance never presents squash as a supported merge method", () => {
  const files = [
    "payload/version.yml.template", "payload/scripts/messages.py", "src/i18n/catalog/en/commands.js",
    "src/i18n/catalog/ko/commands.js", "website/src/content/docs/reference/version-yml.md",
    "website/src/content/docs/ko/reference/version-yml.md", "payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml",
  ];
  for (const f of files) {
    const text = readFileSync(join(import.meta.dirname, "..", "..", f), "utf8");
    for (const line of text.split("\n").filter((l) => /automerge/i.test(l) || /squash/i.test(l))) {
      assert.ok(!/squash/i.test(line) || /merge commit|머지 커밋|skip|건너|not squash|금지|쓰지 마세요|Do not use|again|cannot be|다시 기재/i.test(line), `${f}: ${line.slice(0, 120)}`);
    }
  }
});
