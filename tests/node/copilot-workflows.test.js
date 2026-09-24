// tests/node/copilot-workflows.test.js
// 이슈 #134 — GitHub Models(models: read) 대신 opt-in Copilot CLI, 엔진 표기, 중립 라벨.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NAMES = ["AI-PR-SUMMARY", "AUTO-CHANGELOG-CONTROL", "RELEASE-PUBLISH"];
const payloadPath = (n) => join("payload", "workflows", "common", `PROJECT-COMMON-${n}.yaml`);
const dogfoodPath = (n) => join(".github", "workflows", `PROJECT-COMMON-${n}.yaml`);
const read = (p) => readFileSync(p, "utf8");
const substitute = (text) => text.replaceAll("{{MAIN_BRANCH}}", "main").replaceAll("{{DEVELOP_BRANCH}}", "develop");

for (const name of NAMES) {
  for (const [label, path] of [["payload", payloadPath(name)], ["도그푸딩", dogfoodPath(name)]]) {
    test(`${name} (${label}): models: read 대신 copilot-requests: write를 선언한다`, () => {
      const body = read(path);
      assert.ok(!body.includes("models: read"), "종료된 GitHub Models 권한이 남아 있다");
      assert.match(body, /^permissions:[\s\S]*?^\s+copilot-requests:\s*write/m);
    });

    test(`${name} (${label}): 종료된 GitHub Models 엔진을 더 이상 안내하지 않는다`, () => {
      assert.ok(!/GitHub Models/.test(read(path)));
    });
  }

  test(`${name}: copilot_ai 옵션을 version.yml에서 읽고, 켜졌을 때만 고정 버전 Copilot CLI를 설치한다`, () => {
    const body = read(payloadPath(name));
    assert.ok(body.includes("copilot_ai:"), "version.yml의 copilot_ai를 읽어야 한다");
    assert.ok(body.includes("id: copilot_options"));
    const install = body.slice(body.indexOf("- name: Install Copilot CLI"));
    assert.match(install.slice(0, 500), /steps\.copilot_options\.outputs\.copilot_ai == 'true'/);
    assert.match(install.slice(0, 500), /npm install -g @github\/copilot@\d+\.\d+\.\d+/);
  });

  test(`${name}: AI 스텝이 COPILOT_AI와 COPILOT_MODEL을 전달한다`, () => {
    const body = read(payloadPath(name));
    assert.ok(body.includes("COPILOT_AI: ${{ steps.copilot_options.outputs.copilot_ai }}"));
    assert.ok(body.includes("COPILOT_MODEL: ${{ vars.COPILOT_MODEL }}"));
  });

  test(`${name}: 도그푸딩 사본의 Copilot 관련 줄이 payload와 같다`, () => {
    const pick = (text) => substitute(text).split("\n").filter((l) => /copilot|PR Summary|engine/i.test(l));
    assert.deepStrictEqual(pick(read(dogfoodPath(name))), pick(read(payloadPath(name))));
  });
}

test("세 워크플로우가 같은 Copilot CLI 버전을 고정한다", () => {
  const versions = NAMES.map((n) => read(payloadPath(n)).match(/@github\/copilot@(\d+\.\d+\.\d+)/)?.[1]);
  assert.ok(versions.every(Boolean), `버전 고정 누락: ${versions}`);
  assert.strictEqual(new Set(versions).size, 1);
});

test("AI-PR-SUMMARY와 AUTO-CHANGELOG-CONTROL 도그푸딩 사본은 placeholder 치환 후 payload와 완전히 같다", () => {
  for (const name of ["AI-PR-SUMMARY", "AUTO-CHANGELOG-CONTROL"]) {
    assert.strictEqual(read(dogfoodPath(name)), substitute(read(payloadPath(name))), name);
  }
});

test("PR 코멘트 헤더는 엔진과 무관한 중립 이름이고 엔진을 표기한다", () => {
  for (const name of ["AI-PR-SUMMARY", "AUTO-CHANGELOG-CONTROL"]) {
    for (const path of [payloadPath(name), dogfoodPath(name)]) {
      const body = read(path);
      assert.ok(!body.includes("AI Summary (project-auto-wizard)"), `${path}: 거짓 라벨이 남아 있다`);
      assert.ok(body.includes("📋 **PR Summary (project-auto-wizard)**"), path);
      assert.match(body, /<sub>engine: \$\{ENGINE/, path);
    }
  }
});

test("AUTO-CHANGELOG-CONTROL은 요약 스텝의 engine 출력을 코멘트 스텝에 넘긴다", () => {
  const body = read(payloadPath("AUTO-CHANGELOG-CONTROL"));
  assert.ok(body.includes("id: summary"));
  assert.ok(body.includes('echo "engine=$ENGINE" >> $GITHUB_OUTPUT'));
  assert.ok(body.includes("ENGINE: ${{ steps.summary.outputs.engine }}"));
});

test("AI-PR-SUMMARY는 연속 푸시의 진행 중 실행을 취소한다", () => {
  for (const path of [payloadPath("AI-PR-SUMMARY"), dogfoodPath("AI-PR-SUMMARY")]) {
    const body = read(path);
    assert.match(body, /^concurrency:\s*\n\s+group: ai-pr-summary-\$\{\{ github\.event\.pull_request\.number \}\}\s*\n\s+cancel-in-progress: true/m, path);
  }
});

test("AUTO-CHANGELOG-CONTROL의 concurrency는 커밋을 만드는 잡이라 취소하지 않는다", () => {
  assert.match(read(payloadPath("AUTO-CHANGELOG-CONTROL")), /cancel-in-progress: false/);
});

test("RELEASE-PUBLISH: Copilot 옵션·설치 스텝은 trunk-based push에서만 실행된다", () => {
  const body = read(payloadPath("RELEASE-PUBLISH"));
  const start = body.indexOf("- name: Read copilot_ai option from version.yml");
  assert.ok(start > 0);
  const section = body.slice(start, body.indexOf("- name: Trunk-based version bump + changelog"));
  assert.equal((section.match(/steps\.mode\.outputs\.mode == 'trunk-based'/g) || []).length, 2);
  assert.equal((section.match(/github\.event_name == 'push'/g) || []).length, 2);
});
