import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { VALID_TYPES } from "../../src/context.js";
import { ALL_TYPES } from "../../src/ui/prompts.js";
import { markerForType } from "../../src/core/paths-resolve.js";
import { helpText } from "../../src/cli/help.js";
import {
  TYPES, TYPE_IDS, BUILD_NUMBER_TYPES, SINGLE_SERVER_CD_FILES,
} from "../../src/core/types.js";
import {
  markerForType as detectMarkerForType, extraMarkers, detectTypesFromMarkers, classifyPackageText,
  detectBuildNumberFromFiles,
} from "../../src/core/detect.js";
import { isServerDeployWorkflow } from "../../src/core/deploy-style.js";

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
  const m = helpText().match(/지원:([\s\S]*?)\n\s*(?:-\w, )?--/);
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

// 언어별 README의 '지원 프로젝트 타입' 섹션 제목 (다음 H2 직전까지가 표)
const SUPPORTED_TYPES_HEADING = {
  "README.md": "Supported project types",
  "README.ko.md": "지원 프로젝트 타입",
  "README.zh-CN.md": "支持的项目类型",
  "README.ja.md": "対応するプロジェクトタイプ",
};

for (const [file, heading] of Object.entries(SUPPORTED_TYPES_HEADING)) {
  test(`${file} 지원 타입 표가 VALID_TYPES와 같다`, () => {
    const readme = readFileSync(file, "utf8");
    const m = readme.match(new RegExp(`## ${heading}\\n([\\s\\S]*?)\\n## `));
    assert.ok(m, `${file}에서 '${heading}' 섹션을 찾지 못함`);
    // 표의 첫 칸(타입 이름)에 적힌 백틱 값만 모은다 — 다른 칸의 파일명은 제외
    const listed = [];
    for (const [, cell] of m[1].matchAll(/^\| ([^|]+) \|/gm)) {
      for (const [, t] of cell.matchAll(/`([^`]+)`/g)) listed.push(t);
    }
    assert.deepStrictEqual(sorted(listed), VALID);
  });
}

test("version_manager.py TYPE_HANDLERS가 모든 타입을 다룬다", () => {
  const py = readFileSync("payload/scripts/version_manager.py", "utf8");
  const body = py.match(/\nTYPE_HANDLERS = \{\n([\s\S]*?)\n\}/);
  assert.ok(body, "TYPE_HANDLERS 테이블을 찾지 못함");
  // 테이블 최상위 키(4칸 들여쓰기 "type":)만 모은다 — 값 안의 문자열은 제외.
  const handled = [...body[1].matchAll(/^ {4}"([^"]+)":/gm)].map((x) => x[1]);
  assert.deepStrictEqual(sorted(handled), VALID);
});

test("payload/workflows 하위 타입 폴더는 모두 유효한 타입이다", () => {
  const dirs = readdirSync("payload/workflows", { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "common")
    .map((d) => d.name);
  assert.ok(dirs.length > 0);
  for (const d of dirs) assert.ok(VALID_TYPES.includes(d), `payload/workflows/${d}: 알 수 없는 타입 폴더`);
});

// ── 레지스트리(core/types.js)가 단일 출처인지 ──
// 타입 지식을 다시 하드코딩하면 아래 대조가 어긋나 실패한다.

test("VALID_TYPES·ALL_TYPES는 레지스트리 목록 그대로다 (같은 순서)", () => {
  assert.deepStrictEqual([...VALID_TYPES], TYPES.map((t) => t.id));
  assert.strictEqual(VALID_TYPES, TYPE_IDS);
  assert.strictEqual(ALL_TYPES, TYPE_IDS);
  assert.ok(Object.isFrozen(TYPE_IDS), "공유 배열이 한쪽에서 바뀌지 않도록 고정돼야 한다");
});

test("대표·보조 마커는 레지스트리 markers에서 나온다", () => {
  for (const t of TYPES) {
    if (t.markers.length === 0) continue;
    assert.strictEqual(detectMarkerForType(t.id), t.markers[0], t.id);
    assert.deepStrictEqual(extraMarkers(t.id), t.markers.slice(1), t.id);
    assert.strictEqual(markerForType(t.id), t.markers[0], t.id);
  }
});

test("detectBy·detectOrder 선언이 온전하다", () => {
  for (const by of ["markers", "package"]) {
    const orders = TYPES.filter((t) => t.detectBy === by).map((t) => t.detectOrder);
    assert.ok(orders.every(Number.isInteger), `${by}: detectOrder는 정수여야 한다`);
    assert.strictEqual(new Set(orders).size, orders.length, `${by}: detectOrder 중복`);
  }
  assert.strictEqual(TYPES.filter((t) => t.detectBy === "package-fallback").length, 1);
  for (const t of TYPES.filter((x) => x.detectBy === "package")) assert.ok(t.packageDep, `${t.id}: packageDep 없음`);
  // 감지 방식이 없는 타입은 마커도 없어야 한다 — 마커만 있고 감지가 안 되면 자동 감지에서 조용히 빠진다.
  for (const t of TYPES.filter((x) => !x.detectBy)) assert.deepStrictEqual(t.markers, [], t.id);
});

test("각 타입이 레지스트리 선언대로 자동 감지된다", () => {
  for (const t of TYPES.filter((x) => x.detectBy === "markers")) {
    for (const m of t.markers) {
      assert.ok(detectTypesFromMarkers({ has: (f) => f === m }).includes(t.id), `${t.id}: ${m}만 있어도 감지돼야 한다`);
    }
  }
  for (const t of TYPES.filter((x) => x.detectBy === "package")) {
    const raw = JSON.stringify({ dependencies: { [t.packageDep]: "1" } });
    assert.strictEqual(classifyPackageText(raw), t.id);
  }
});

test("빌드 번호 타입은 레지스트리 buildNumberSource에서 나온다", () => {
  for (const t of TYPES) {
    let reads = 0;
    detectBuildNumberFromFiles({ types: [t.id], read: () => { reads++; return null; }, readJson: () => { reads++; return null; } });
    assert.strictEqual(reads > 0, Boolean(t.buildNumberSource), `${t.id}: 빌드 번호 파일 조회 여부`);
    assert.strictEqual(BUILD_NUMBER_TYPES.has(t.id), Boolean(t.buildNumberSource), t.id);
  }
});

test("단일 서버 CD 파일은 해당 타입 payload에 실재하고 서버 배포로 분류된다", () => {
  assert.ok(SINGLE_SERVER_CD_FILES.size > 0);
  for (const t of TYPES.filter((x) => x.singleServerCd)) {
    assert.ok(existsSync(join("payload/workflows", t.id, t.singleServerCd)), `${t.id}: ${t.singleServerCd} 없음`);
    assert.ok(isServerDeployWorkflow(t.singleServerCd));
  }
});
