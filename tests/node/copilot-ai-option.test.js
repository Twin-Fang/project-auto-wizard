// tests/node/copilot-ai-option.test.js
// Copilot AI summary opt-in option (copilot_ai). The default is always false,
// a stored value is never asked about again, and existing installs without the key never silently become true.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs, CliError } from "../../src/cli/args.js";
import { helpText } from "../../src/cli/help.js";
import { run } from "../../src/index.js";
import { parseTemplateOptions, buildVersionYml } from "../../src/core/version-yml.js";
import { readVersionYmlTemplate, resolvePayloadRoot } from "../../src/core/assets.js";
import { printStatus } from "../../src/commands/status.js";
import { runInteractive } from "../../src/commands/interactive.js";

const CLOCK = { now: "2026-07-28 00:00:00", today: "2026-07-28" };

function optionsYml(extraLine) {
  return [
    "metadata:", "  template:", "    options:",
    ...(extraLine ? [extraLine] : []),
  ].join("\n");
}

async function install(target, extraArgs = []) {
  return run(["--mode", "full", "--force", "--type", "node", ...extraArgs], { cwd: target, clock: CLOCK });
}

function tempProject() {
  const target = mkdtempSync(join(tmpdir(), "paw-copilot-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // root marker to avoid 0 path candidates
  return target;
}

const savedOptions = (target) => parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));

test("parseTemplateOptions: distinguishes copilot_ai true/false/unset", () => {
  assert.strictEqual(parseTemplateOptions(optionsYml("      copilot_ai: true")).copilotAi, true);
  assert.strictEqual(parseTemplateOptions(optionsYml("      copilot_ai: false")).copilotAi, false);
  assert.strictEqual(parseTemplateOptions(optionsYml("")).copilotAi, null);
});

function build(templateOptions) {
  return buildVersionYml({
    templateText: readVersionYmlTemplate(resolvePayloadRoot()),
    version: "1.0.0", types: ["basic"], branch: "main",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    versionCode: 1, ...CLOCK,
    templateOptions: { templateVersion: "0.1.0", ...templateOptions },
  });
}

test("buildVersionYml: includeCopilotAi unspecified renders false, true renders true", () => {
  assert.strictEqual(parseTemplateOptions(build({})).copilotAi, false);
  assert.strictEqual(parseTemplateOptions(build({ includeCopilotAi: true })).copilotAi, true);
  assert.strictEqual(parseTemplateOptions(build({ includeCopilotAi: false })).copilotAi, false);
});

test("parseArgs: --copilot / --no-copilot / unspecified", () => {
  const base = ["--mode", "full", "--force", "--type", "node"];
  assert.strictEqual(parseArgs([...base, "--copilot"]).includeCopilotAi, true);
  assert.strictEqual(parseArgs([...base, "--no-copilot"]).includeCopilotAi, false);
  assert.strictEqual(parseArgs(base).includeCopilotAi, null);
});

test("parseArgs: specifying both --copilot and --no-copilot is a CliError", () => {
  assert.throws(() => parseArgs(["--copilot", "--no-copilot"]), CliError);
  assert.throws(() => parseArgs(["--no-copilot", "--copilot"]), CliError);
});

test("help: describes the --copilot option and AI Credits consumption", () => {
  assert.ok(helpText().includes("--copilot / --no-copilot"));
  assert.ok(helpText().includes("AI Credits"));
});

test("run(): when unspecified, even a fresh install gets copilot_ai: false (opt-in)", async () => {
  const target = tempProject();
  try {
    await install(target);
    assert.strictEqual(savedOptions(target).copilotAi, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --copilot is saved in version.yml, a rerun without the flag keeps the stored value, and --no-copilot can turn it off", async () => {
  const target = tempProject();
  try {
    await install(target, ["--copilot"]);
    assert.strictEqual(savedOptions(target).copilotAi, true);

    await install(target);
    assert.strictEqual(savedOptions(target).copilotAi, true, "a rerun without the flag keeps the stored value");

    await install(target, ["--no-copilot"]);
    assert.strictEqual(savedOptions(target).copilotAi, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): rerunning an existing install without the copilot_ai key does not silently become true", async () => {
  const target = tempProject();
  try {
    await install(target);
    const vyPath = join(target, "version.yml");
    const stripped = readFileSync(vyPath, "utf8")
      .split("\n")
      .filter((line) => !/^\s+copilot_ai:/.test(line))
      .join("\n");
    writeFileSync(vyPath, stripped);
    assert.strictEqual(parseTemplateOptions(stripped).copilotAi, null, "fixture setup: key must be absent");

    assert.strictEqual(await install(target), 0);
    assert.strictEqual(savedOptions(target).copilotAi, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

function renderStatus(status) {
  const originalLog = console.log;
  let output = "";
  console.log = (msg) => { output += msg; };
  try {
    printStatus(status);
  } finally {
    console.log = originalLog;
  }
  return output;
}

test("printStatus: shows the copilot_ai value and the unset state on the options line", () => {
  const base = { installed: true, version: "1.0.0", templateVersion: "0.1.0", types: ["basic"], branches: null, modifiedFiles: [] };
  const on = renderStatus({ ...base, options: { semverAuto: true, copilotAi: true } });
  assert.ok(on.includes("copilot_ai=true"));
  const unset = renderStatus({ ...base, options: { semverAuto: true, copilotAi: null } });
  assert.ok(unset.includes("copilot_ai=미설정(기본 false)"));
});

// The stub io works the same way as in interactive-flutter.test.js. If the harness requires more methods,
// see stubIo in that file and add them in the same form.
function stubIo(asked, copilotAnswer) {
  return {
    selectMode: async () => "full",
    confirmProjectMenu: async () => "continue",
    confirmTypes: async ({ types }) => types,
    selectDeployStyle: async () => "simple",
    selectBranchStrategy: async () => "pr-flow",
    askYesNo: async (message, def) => {
      asked.push({ message, def });
      return message.includes("Copilot") ? copilotAnswer : def;
    },
    askText: async (_message, def) => def,
    note: () => {}, cancelMessage: () => {}, summary: () => {}, outro: () => {},
    editMenu: async () => "done",
  };
}

test("interactive: the Copilot question defaults to No, saves the answer, and is not asked again when a stored value exists", async () => {
  const target = tempProject();
  try {
    const first = [];
    assert.strictEqual(await runInteractive({}, { cwd: target, io: stubIo(first, true) }), 0);
    const question = first.find((q) => q.message.includes("Copilot"));
    assert.ok(question, "the Copilot question must appear");
    assert.strictEqual(question.def, false, "the default is No");
    assert.ok(question.message.includes("AI Credits"), "the question must disclose the cost consumption");
    assert.strictEqual(savedOptions(target).copilotAi, true);

    const second = [];
    assert.strictEqual(await runInteractive({}, { cwd: target, io: stubIo(second, false) }), 0);
    assert.ok(!second.some((q) => q.message.includes("Copilot")), "not asked again when a stored value exists");
    assert.strictEqual(savedOptions(target).copilotAi, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("interactive: answering the Copilot question with the default (No) saves false", async () => {
  const target = tempProject();
  try {
    const asked = [];
    await runInteractive({}, { cwd: target, io: stubIo(asked, false) });
    assert.strictEqual(savedOptions(target).copilotAi, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("interactive: the --copilot/--no-copilot flags take precedence over the stored value and skip the question", async () => {
  const target = tempProject();
  try {
    await runInteractive({}, { cwd: target, io: stubIo([], false) });
    assert.strictEqual(savedOptions(target).copilotAi, false);
    const asked = [];
    await runInteractive({ includeCopilotAi: true }, { cwd: target, io: stubIo(asked, false) });
    assert.ok(!asked.some((q) => q.message.includes("Copilot")), "not asked when decided by a flag");
    assert.strictEqual(savedOptions(target).copilotAi, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("interactive: even with a stored value, the Copilot setting can be seen and changed from the confirm screen and 'Edit'", async () => {
  const target = tempProject();
  try {
    await runInteractive({}, { cwd: target, io: stubIo([], false) });
    const cards = [];
    const menus = ["edit", "continue"];
    const edits = ["copilotAi", "done"];
    let editArgs = null;
    const io = {
      ...stubIo([], true),
      analysisCard: (info) => cards.push(info),
      confirmProjectMenu: async () => menus.shift(),
      editMenu: async (args) => { editArgs = args; return edits.shift(); },
    };
    await runInteractive({}, { cwd: target, io });
    assert.strictEqual(cards[0].options.copilotAi, false, "the confirm card must show the current value");
    assert.strictEqual(editArgs.showOptions, true, "the Edit menu must show the options entry");
    assert.strictEqual(savedOptions(target).copilotAi, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("editMenuOptions: with showOptions it includes the auto version bump and Copilot entries", async () => {
  const { editMenuOptions } = await import("../../src/ui/prompts.js");
  const values = editMenuOptions({ showOptions: true }).map((o) => o.value);
  assert.ok(values.includes("semverAuto") && values.includes("copilotAi"));
  assert.ok(!editMenuOptions().map((o) => o.value).includes("copilotAi"));
});
