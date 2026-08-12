// tests/node/detect-accuracy.test.js
// 감지 정확도 회귀 (이슈 #77, #81, #82).
// 공통 실패 형태: "감지가 조용히 실패하고 설치는 성공으로 끝난다".
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  detectVersionFromFiles, versionFromPom, detectJdkFromFiles, resolveMarker, resolveMarkers,
} from "../../src/core/detect.js";
import { findSpringAppYml } from "../../src/core/detect-fs.js";

const readFrom = (files) => (rel) => (rel in files ? files[rel] : null);

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "paw-detect-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

// ── 버전 감지 (#77) ──────────────────────────────────────────────────
test("detectVersionFromFiles: build.gradle.kts만 있어도 버전을 읽는다 (Kotlin DSL)", () => {
  const warned = [];
  const v = detectVersionFromFiles({
    read: readFrom({ "build.gradle.kts": 'version = "1.4.2"\n' }),
    readJson: () => null, gitTag: "", warn: (m) => warned.push(m),
  });
  assert.strictEqual(v, "1.4.2");
  assert.strictEqual(warned.length, 0, "감지에 성공했으면 폴백 경고가 없어야 한다");
});

test("detectVersionFromFiles: pom.xml의 프로젝트 버전을 읽되 <parent> 버전은 쓰지 않는다", () => {
  const pom = `<project>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <version>3.4.0</version>
  </parent>
  <version>2.7.1</version>
</project>`;
  const v = detectVersionFromFiles({
    read: readFrom({ "pom.xml": pom }), readJson: () => null, gitTag: "", warn: () => {},
  });
  assert.strictEqual(v, "2.7.1", "부모 BOM 버전(3.4.0)이 아니라 프로젝트 버전이어야 한다");
});

test("versionFromPom: 프로젝트 버전이 <parent>보다 앞에 있어도 부모 버전을 고르지 않는다", () => {
  const pom = `<project><version>9.9.9</version><parent><version>1.1.1</version></parent></project>`;
  assert.strictEqual(versionFromPom(pom), "9.9.9");
});

test("detectVersionFromFiles: 폴백 경고 문구는 호출부가 준 hint를 쓴다 (대화형/CLI 분기)", () => {
  const warned = [];
  detectVersionFromFiles({
    read: () => null, readJson: () => null, gitTag: "",
    warn: (m) => warned.push(m), hint: "수정하기 > 버전에서 고칠 수 있습니다.",
  });
  assert.match(warned[0], /수정하기 > 버전/);
  assert.doesNotMatch(warned[0], /--project-version/, "대화형에 CLI 플래그를 안내하면 안 된다");
});

// ── 마커 (#77) ───────────────────────────────────────────────────────
test("resolveMarker: 실제로 존재하는 파일을 돌려준다 (build.gradle.kts)", () => {
  const has = (n) => n === "build.gradle.kts";
  assert.strictEqual(resolveMarker("spring", has), "build.gradle.kts");
});

test("resolveMarker: has 미주입이면 종전대로 타입 대표 파일로 폴백한다", () => {
  assert.strictEqual(resolveMarker("spring"), "build.gradle");
});

test("resolveMarkers: basic은 근거 파일이 없으므로 맵에서 제외된다", () => {
  const m = resolveMarkers(["spring", "basic"], (n) => n === "pom.xml");
  assert.strictEqual(m.get("spring"), "pom.xml");
  assert.ok(!m.has("basic"));
});

// ── 빌드 JDK (#82) ───────────────────────────────────────────────────
test("detectJdkFromFiles: Kotlin DSL toolchain에서 JDK를 읽는다", () => {
  const kts = "java { toolchain { languageVersion = JavaLanguageVersion.of(25) } }";
  assert.strictEqual(detectJdkFromFiles({ read: readFrom({ "build.gradle.kts": kts }) }), "25");
});

test("detectJdkFromFiles: sourceCompatibility 문자열 표기도 인식한다", () => {
  const g = "sourceCompatibility = '17'";
  assert.strictEqual(detectJdkFromFiles({ read: readFrom({ "build.gradle": g }) }), "17");
});

test("detectJdkFromFiles: JavaVersion.VERSION_1_8은 8로 정규화한다", () => {
  const g = "sourceCompatibility = JavaVersion.VERSION_1_8";
  assert.strictEqual(detectJdkFromFiles({ read: readFrom({ "build.gradle": g }) }), "8");
});

test("detectJdkFromFiles: Maven의 <java.version>을 읽는다", () => {
  const pom = "<properties><java.version>21</java.version></properties>";
  assert.strictEqual(detectJdkFromFiles({ read: readFrom({ "pom.xml": pom }) }), "21");
});

test("detectJdkFromFiles: 근거가 없으면 null (호출부가 종전 기본값으로 폴백해야 한다)", () => {
  assert.strictEqual(detectJdkFromFiles({ read: () => null }), null);
});

// ── application.yml/.yaml 탐색 (#81) ─────────────────────────────────
test("findSpringAppYml: .yaml 확장자도 찾는다 (Spring 공식 지원)", () => {
  const root = fixture({ "app/src/main/resources/application.yaml": "" });
  try {
    assert.strictEqual(findSpringAppYml(root), "app/src/main/resources/application.yaml");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("findSpringAppYml: 프로파일 파일보다 기본 application 파일을 우선한다", () => {
  // 파일명 정렬만 쓰면 'application-dev.yml'이 'application.yml'보다 앞선다(`-` < `.`).
  const root = fixture({
    "src/main/resources/application-dev.yml": "",
    "src/main/resources/application.yml": "",
  });
  try {
    assert.strictEqual(findSpringAppYml(root), "src/main/resources/application.yml");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("findSpringAppYml: src/main/resources 밖의 application.yml은 무시한다", () => {
  const root = fixture({ "config/application.yml": "" });
  try {
    assert.strictEqual(findSpringAppYml(root), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
