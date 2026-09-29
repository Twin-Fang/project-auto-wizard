// tests/node/type-ci-tests.test.js
// 타입별 CI가 빌드만이 아니라 테스트도 실행하고, 기본 상태(Dockerfile·테스트 없음)에서 실패하지 않는지 고정한다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOWS_DIR = fileURLToPath(new URL("../../payload/workflows", import.meta.url));
const read = (file) => readFileSync(join(WORKFLOWS_DIR, file), "utf8");

// `- name: <name>` 스텝 블록 (다음 스텝 전까지). 없으면 null.
function stepBlock(text, name) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => /^\s*- name: /.test(l) && l.split("- name: ")[1].trim() === name);
  if (i === -1) return null;
  const indent = lines[i].match(/^ */)[0].length;
  const body = [lines[i]];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l.trim() !== "" && l.match(/^ */)[0].length <= indent) break;
    body.push(l);
  }
  return body.join("\n");
}

test("Python CI: 의존성 설치 후 pytest를 실행하고, 테스트가 없으면 건너뛴다", () => {
  const text = read("python/PROJECT-PYTHON-CI.yaml");
  const install = stepBlock(text, "의존성 설치");
  assert.ok(install, "의존성 설치 스텝 없음");
  assert.match(install, /pip install -r requirements\.txt/);
  assert.match(install, /pip install \./);
  const pytest = stepBlock(text, "테스트 실행 (pytest)");
  assert.ok(pytest, "pytest 스텝 없음");
  assert.match(pytest, /python -m pytest/);
  assert.match(pytest, /-eq 5/, "수집된 테스트 없음(종료 코드 5)은 실패로 보지 않아야 한다");
  assert.match(pytest, /::notice::/, "건너뛸 때 이유를 남겨야 한다");
});

test("Python CI: Docker 빌드 검증은 Dockerfile이 있을 때만 실행된다", () => {
  const text = read("python/PROJECT-PYTHON-CI.yaml");
  assert.ok(stepBlock(text, "Dockerfile 확인"), "Dockerfile 확인 스텝 없음");
  for (const name of ["Docker 빌드환경 설정", "Docker 이미지 빌드 검증"]) {
    const block = stepBlock(text, name);
    assert.ok(block, `${name} 스텝 없음`);
    assert.match(block, /if: steps\.dockerfile\.outputs\.exists == 'true'/, `${name}: Dockerfile 조건 누락`);
  }
});
