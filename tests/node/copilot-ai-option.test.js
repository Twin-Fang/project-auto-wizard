// tests/node/copilot-ai-option.test.js
// Copilot AI 요약 opt-in 옵션(copilot_ai). 기본값은 항상 false이고,
// 저장값이 있으면 재질문하지 않으며, 키가 없는 기존 설치는 조용히 true가 되지 않는다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs, CliError } from "../../src/cli/args.js";
import { HELP_TEXT } from "../../src/cli/help.js";
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
  writeFileSync(join(target, "package.json"), "{}\n"); // 경로 후보 0개 방지용 루트 마커
  return target;
}

const savedOptions = (target) => parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));

test("parseTemplateOptions: copilot_ai true/false/미기재를 구분한다", () => {
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

test("buildVersionYml: includeCopilotAi 미지정은 false, true는 true로 렌더된다", () => {
  assert.strictEqual(parseTemplateOptions(build({})).copilotAi, false);
  assert.strictEqual(parseTemplateOptions(build({ includeCopilotAi: true })).copilotAi, true);
  assert.strictEqual(parseTemplateOptions(build({ includeCopilotAi: false })).copilotAi, false);
});

test("parseArgs: --copilot / --no-copilot / 미지정", () => {
  const base = ["--mode", "full", "--force", "--type", "node"];
  assert.strictEqual(parseArgs([...base, "--copilot"]).includeCopilotAi, true);
  assert.strictEqual(parseArgs([...base, "--no-copilot"]).includeCopilotAi, false);
  assert.strictEqual(parseArgs(base).includeCopilotAi, null);
});

test("parseArgs: --copilot과 --no-copilot 동시 지정은 CliError", () => {
  assert.throws(() => parseArgs(["--copilot", "--no-copilot"]), CliError);
  assert.throws(() => parseArgs(["--no-copilot", "--copilot"]), CliError);
});

test("help: --copilot 옵션과 AI Credits 소비를 안내한다", () => {
  assert.ok(HELP_TEXT.includes("--copilot / --no-copilot"));
  assert.ok(HELP_TEXT.includes("AI Credits"));
});

test("run(): 미지정이면 신규 설치도 copilot_ai: false (opt-in)", async () => {
  const target = tempProject();
  try {
    await install(target);
    assert.strictEqual(savedOptions(target).copilotAi, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --copilot은 version.yml에 저장되고, 플래그 없는 재실행도 저장값을 유지하며, --no-copilot으로 끌 수 있다", async () => {
  const target = tempProject();
  try {
    await install(target, ["--copilot"]);
    assert.strictEqual(savedOptions(target).copilotAi, true);

    await install(target);
    assert.strictEqual(savedOptions(target).copilotAi, true, "플래그 없는 재실행은 저장값을 유지");

    await install(target, ["--no-copilot"]);
    assert.strictEqual(savedOptions(target).copilotAi, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): copilot_ai 키가 없는 기존 설치를 재실행해도 조용히 true가 되지 않는다", async () => {
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

test("printStatus: copilot_ai 값과 미설정 상태를 옵션 줄에 표시한다", () => {
  const base = { installed: true, version: "1.0.0", templateVersion: "0.1.0", types: ["basic"], branches: null, modifiedFiles: [] };
  const on = renderStatus({ ...base, options: { semverAuto: true, copilotAi: true } });
  assert.ok(on.includes("copilot_ai=true"));
  const unset = renderStatus({ ...base, options: { semverAuto: true, copilotAi: null } });
  assert.ok(unset.includes("copilot_ai=미설정(기본 false)"));
});

// 스텁 io는 interactive-flutter.test.js와 같은 방식이다. 하네스가 요구하는 메서드가 더 있으면
// 그 파일의 stubIo를 참고해 같은 형태로 추가한다.
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

test("interactive: Copilot 질문은 기본값 No로 나오고 답을 저장하며, 저장값이 있으면 재질문하지 않는다", async () => {
  const target = tempProject();
  try {
    const first = [];
    assert.strictEqual(await runInteractive({}, { cwd: target, io: stubIo(first, true) }), 0);
    const question = first.find((q) => q.message.includes("Copilot"));
    assert.ok(question, "Copilot 질문이 나와야 한다");
    assert.strictEqual(question.def, false, "기본값은 No");
    assert.ok(question.message.includes("AI Credits"), "비용 소비를 질문에 밝혀야 한다");
    assert.strictEqual(savedOptions(target).copilotAi, true);

    const second = [];
    assert.strictEqual(await runInteractive({}, { cwd: target, io: stubIo(second, false) }), 0);
    assert.ok(!second.some((q) => q.message.includes("Copilot")), "저장값이 있으면 재질문하지 않는다");
    assert.strictEqual(savedOptions(target).copilotAi, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("interactive: Copilot 질문에 기본값(No)으로 답하면 false로 저장된다", async () => {
  const target = tempProject();
  try {
    const asked = [];
    await runInteractive({}, { cwd: target, io: stubIo(asked, false) });
    assert.strictEqual(savedOptions(target).copilotAi, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
