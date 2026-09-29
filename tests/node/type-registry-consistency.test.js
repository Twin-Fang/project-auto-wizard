import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { VALID_TYPES } from "../../src/context.js";
import { ALL_TYPES } from "../../src/ui/prompts.js";
import { markerForType } from "../../src/core/paths-resolve.js";
import { HELP_TEXT } from "../../src/cli/help.js";

// 타입 목록이 여러 파일에 따로 적혀 있어, 새 타입 추가 시 한 곳만 빠져도 여기서 실패하게 한다.
const sorted = (xs) => [...new Set(xs)].sort();
const VALID = sorted(VALID_TYPES);

// 문자열 안에서 타입 이름 토큰만 뽑는다 — "react-native"가 "react"로 잘리지 않도록 하이픈 포함.
const typeTokens = (text) =>
  sorted((text.match(/[a-z][a-z-]*[a-z]/g) || []).filter((t) => VALID_TYPES.includes(t)));

test("VALID_TYPES에 중복이 없다", () => {
  assert.strictEqual(new Set(VALID_TYPES).size, VALID_TYPES.length);
});

test("대화형 타입 선택지(ALL_TYPES)가 VALID_TYPES와 같다", () => {
  assert.deepStrictEqual(sorted(ALL_TYPES), VALID);
  assert.strictEqual(new Set(ALL_TYPES).size, ALL_TYPES.length);
});

test("basic을 제외한 모든 타입에 대표 마커가 있다 (paths-resolve KNOWN_MARKER_TYPES)", () => {
  for (const t of VALID_TYPES) {
    if (t === "basic") assert.strictEqual(markerForType(t), "", "basic은 마커 파일이 없어야 한다");
    else assert.ok(markerForType(t), `${t}: paths-resolve 마커 목록에 없음`);
  }
});

test("--help 지원 타입 목록이 VALID_TYPES와 같다", () => {
  // "지원:" 줄부터 다음 옵션 줄(--로 시작) 직전까지가 타입 목록이다.
  const m = HELP_TEXT.match(/지원:([\s\S]*?)\n\s*(?:-\w, )?--/);
  assert.ok(m, "--help에서 '지원:' 목록을 찾지 못함");
  assert.deepStrictEqual(typeTokens(m[1]), VALID);
});

const template = readFileSync("payload/version.yml.template", "utf8");

test("version.yml 템플릿의 지원 타입 주석이 VALID_TYPES와 같다", () => {
  const m = template.match(/# Supported project types:([\s\S]*?)\n# (?!\s)/);
  assert.ok(m, "템플릿에서 'Supported project types' 주석을 찾지 못함");
  assert.deepStrictEqual(typeTokens(m[1]), VALID);
});

test("version.yml 템플릿의 타입별 동기화 파일 주석에 모든 타입이 있다", () => {
  const m = template.match(/# Synced files per type:\n((?:# - .*\n)+)/);
  assert.ok(m, "템플릿에서 'Synced files per type' 주석을 찾지 못함");
  // 각 항목의 "- a/b/c:" 앞부분만 타입 이름으로 본다.
  const listed = m[1].split("\n").flatMap((line) => {
    const head = line.match(/^# - ([^:]+):/);
    return head ? head[1].split("/").map((s) => s.trim()) : [];
  });
  assert.deepStrictEqual(sorted(listed), VALID);
});

test("README 지원 프로젝트 타입 목록이 VALID_TYPES와 같다", () => {
  const readme = readFileSync("README.md", "utf8");
  const m = readme.match(/### 지원 프로젝트 타입\n\n(.*)\n/);
  assert.ok(m, "README에서 '지원 프로젝트 타입' 섹션을 찾지 못함");
  const listed = [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
  assert.deepStrictEqual(sorted(listed), VALID);
});

test("version_manager.py sync_for_type이 모든 타입을 분기한다", () => {
  const py = readFileSync("payload/scripts/version_manager.py", "utf8");
  const body = py.match(/\ndef sync_for_type\([\s\S]*?(?=\ndef )/);
  assert.ok(body, "sync_for_type 함수를 찾지 못함");
  // project_type == "x" 와 project_type in ("a", "b") 양쪽 형태를 모두 모은다.
  const handled = [];
  for (const [, cond] of body[0].matchAll(/project_type (?:==|in) ([^:]+):/g)) {
    for (const [, t] of cond.matchAll(/"([^"]+)"/g)) handled.push(t);
  }
  assert.deepStrictEqual(sorted(handled), VALID);
});

test("payload/workflows 하위 타입 폴더는 모두 유효한 타입이다", () => {
  const dirs = readdirSync("payload/workflows", { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "common")
    .map((d) => d.name);
  assert.ok(dirs.length > 0);
  for (const d of dirs) assert.ok(VALID_TYPES.includes(d), `payload/workflows/${d}: 알 수 없는 타입 폴더`);
});
