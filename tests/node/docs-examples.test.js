// 문서·도움말의 명령 예시가 현재 파서로 그대로 실행 가능한지 확인한다.
// 모드·옵션을 없애거나 이름을 바꿀 때 예시가 함께 갱신되지 않으면 여기서 걸린다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { parseArgs } from "../../src/cli/args.js";
import { HELP_TEXT } from "../../src/cli/help.js";

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

// "npx project-auto-wizard ..." / "node bin/project-auto-wizard.js ..." 줄에서 인자만 뽑는다.
// 큰따옴표 인자를 하나로 묶고, 줄 끝 # 주석은 버린다.
function extractCommands(text) {
  const cmds = [];
  for (const line of text.split("\n")) {
    const m = line.match(/(?:npx project-auto-wizard|node bin\/project-auto-wizard\.js)((?:\s[^#`|]*)?)/);
    if (!m) continue;
    const args = [...m[1].matchAll(/"([^"]*)"|(\S+)/g)].map((t) => t[1] ?? t[2]);
    if (args.includes("[옵션]")) continue; // 사용법 줄
    cmds.push({ line: line.trim(), args });
  }
  return cmds;
}

for (const [name, text] of [["--help", HELP_TEXT], ["README.md", read("README.md")], ["README.ko.md", read("README.ko.md")], ["CONTRIBUTING.md", read("CONTRIBUTING.md")]]) {
  test(`${name}의 명령 예시는 모두 현재 파서로 해석된다`, () => {
    const cmds = extractCommands(text);
    assert.ok(cmds.length > 0, "예시를 하나 이상 찾아야 한다");
    for (const { line, args } of cmds) {
      assert.doesNotThrow(() => parseArgs(args), `실행할 수 없는 예시: ${line}`);
    }
  });
}

test("문서와 도움말에 제거된 모드·옵션이 남아 있지 않다", () => {
  const docs = { "--help": HELP_TEXT, "README.md": read("README.md"), "README.ko.md": read("README.ko.md"), "ROADMAP.md": read("ROADMAP.md") };
  for (const [name, text] of Object.entries(docs)) {
    for (const stale of ["--mode workflows", "--mode version", "--mode revert", "full/version/workflows", "--no-nexus", "--no-secret-backup"]) {
      assert.ok(!text.includes(stale), `${name}에 '${stale}'가 남아 있다`);
    }
  }
});
