// tests/node/payload-example-values.test.js
// payload 템플릿에 예시값이 그대로 남아 설치되는 것을 막는다 (이슈 #82).
//
// 이 문제는 "코드는 멀쩡한데 설치 결과만 틀린" 형태라 다른 테스트에 걸리지 않는다.
// 템플릿을 새로 추가하거나 복사해 쓸 때 같은 실수가 반복되므로 payload 자체를 검사한다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { parseWizardLine } from "../../src/core/wizard-env.js";

const WF_ROOT = join(resolvePayloadRoot(), "workflows");

function allWorkflowFiles(dir = WF_ROOT, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allWorkflowFiles(p, acc);
    else if (/\.ya?ml$/.test(name)) acc.push(p);
  }
  return acc;
}

const rel = (p) => p.slice(WF_ROOT.length + 1);
const isCommented = (line) => /^\s*#/.test(line);

// 설치되는 파일에 남으면 안 되는 값들. 주석(설명·예시)에 있는 것은 괜찮다 —
// 실제 env 값으로 박혀 있는 경우만 잡는다.
const FORBIDDEN = [
  { pattern: /"my-project"/, why: "어느 프로젝트에도 맞지 않는 예시 프로젝트명" },
  { pattern: /sites-enabled\/example\.conf/, why: "예시 nginx config 경로 — 틀리면 무중단 전환이 동작하지 않는다" },
  { pattern: /suhsaechan\.kr/, why: "원저자 개인 도메인" },
  { pattern: /Suh-Web\//, why: "원저자 프로젝트의 모듈명" },
  { pattern: /\/volume1\/project\//, why: "/volume1/projects 오타" },
  { pattern: /프로젝트명/, why: "한국어 자리표시자 — 값으로 그대로 설치된다" },
];

test("payload 워크플로우의 env 값에 예시값·개인 설정이 남아 있지 않다", () => {
  const hits = [];
  for (const file of allWorkflowFiles()) {
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (isCommented(line)) return;
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(line)) hits.push(`${rel(file)}:${i + 1} — ${why}\n    ${line.trim()}`);
      }
    });
  }
  assert.deepStrictEqual(hits, [], `예시값이 그대로 설치됩니다:\n  ${hits.join("\n  ")}`);
});

test("@wizard ask 마커의 대상 줄은 겹따옴표 값이어야 치환된다", () => {
  // setEnvLine이 홑따옴표도 처리하도록 넓혔지만, 템플릿 표기는 겹따옴표로 통일해 둔다 —
  // 마커가 붙은 줄의 표기가 제각각이면 치환 실패를 눈으로 알아채기 어렵다.
  const bad = [];
  for (const file of allWorkflowFiles()) {
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      const p = parseWizardLine(line);
      if (!p) return;
      if (!new RegExp(`^\\s*${p.key}:\\s*"`).test(line)) bad.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepStrictEqual(bad, [], `@wizard 마커 줄의 값 표기가 겹따옴표가 아닙니다:\n  ${bad.join("\n  ")}`);
});

test("배포 워크플로우의 JAVA_VERSION은 프로젝트 툴체인 실측값(@jdk)을 기본값으로 쓴다", () => {
  // 21 고정 기본값이면 toolchain이 다른 프로젝트는 그대로 Enter를 눌렀을 때 빌드가 깨진다.
  const bad = [];
  for (const file of allWorkflowFiles()) {
    if (!rel(file).startsWith("spring/")) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const p = parseWizardLine(line);
      if (p?.key === "JAVA_VERSION" && p.arg !== "@jdk") bad.push(`${rel(file)}  ask:${p.arg}`);
    }
  }
  assert.deepStrictEqual(bad, [], `JAVA_VERSION 기본값이 고정돼 있습니다:\n  ${bad.join("\n  ")}`);
});

test("spring DockerHub 자격증명 secret 이름이 워크플로우마다 갈리지 않는다", () => {
  // 같은 DockerHub 계정인데 PR-PREVIEW만 DOCKER_* 를 써서, 사용자가 secret 2쌍을 등록해야 했다.
  const bad = [];
  for (const file of allWorkflowFiles()) {
    if (!rel(file).startsWith("spring/")) continue;
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (isCommented(line)) return;
      if (/secrets\.DOCKER_(USERNAME|PASSWORD)\b/.test(line)) bad.push(`${rel(file)}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(bad, [], `DOCKERHUB_USERNAME/DOCKERHUB_TOKEN으로 통일해야 합니다:\n  ${bad.join("\n  ")}`);
});
