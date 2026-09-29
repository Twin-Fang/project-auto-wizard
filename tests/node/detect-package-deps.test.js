// tests/node/detect-package-deps.test.js
// package.json 타입 분류는 의존성 키로만 판정한다 — 원문 부분문자열로 보면
// 스크립트 이름·다른 패키지 이름에 섞인 글자로 타입이 바뀐다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyPackageText, resolveMarker } from "../../src/core/detect.js";
import { findTypePathCandidates } from "../../src/core/paths-resolve.js";
import { run } from "../../src/index.js";

const pkg = (obj) => JSON.stringify(obj);
const CLOCK = { now: "2026-09-01 00:00:00", today: "2026-09-01" };

test("classifyPackageText: expo 의존성이 있으면 react-native-expo", () => {
  assert.strictEqual(classifyPackageText(pkg({ dependencies: { expo: "~51.0.0", "react-native": "0.74.0" } })), "react-native-expo");
});

test("classifyPackageText: export 스크립트나 exponential-backoff 의존성은 expo로 보지 않는다", () => {
  assert.strictEqual(classifyPackageText(pkg({
    scripts: { export: "react-native bundle" }, dependencies: { "react-native": "0.73" },
  })), "react-native");
  assert.strictEqual(classifyPackageText(pkg({
    dependencies: { "react-native": "0.73", "exponential-backoff": "3.1.1" },
  })), "react-native");
});

test("classifyPackageText: react-native-web을 쓰는 React 웹앱은 react", () => {
  assert.strictEqual(classifyPackageText(pkg({
    dependencies: { react: "18", "react-dom": "18", "react-native-web": "0.19" },
  })), "react");
});

test("classifyPackageText: keywords의 next는 next로 보지 않는다", () => {
  assert.strictEqual(classifyPackageText(pkg({ name: "my-app", keywords: ["next"] })), "node");
  assert.strictEqual(classifyPackageText(pkg({ devDependencies: { next: "14" }, dependencies: { react: "18" } })), "next");
});

test("classifyPackageText: 깨진 package.json은 node", () => {
  assert.strictEqual(classifyPackageText("{ not json"), "node");
  assert.strictEqual(classifyPackageText(""), "node");
});

test("resolveMarker: app.json 없이 app.config.ts만 있는 Expo도 근거 파일을 찾는다", () => {
  assert.strictEqual(resolveMarker("react-native-expo", (n) => n === "app.config.ts" || n === "package.json"), "app.config.ts");
  assert.strictEqual(resolveMarker("react-native-expo", (n) => n === "package.json"), "package.json");
});

test("findTypePathCandidates: 하위 폴더의 app.config.js Expo 앱을 후보로 찾는다", () => {
  const root = mkdtempSync(join(tmpdir(), "paw-expo-cand-"));
  try {
    mkdirSync(join(root, "mobile"));
    writeFileSync(join(root, "mobile", "app.config.js"), "module.exports = { expo: { name: 'x' } };\n");
    assert.deepStrictEqual(findTypePathCandidates(root, "react-native-expo"), ["mobile"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

async function installIn(files, args = []) {
  const root = mkdtempSync(join(tmpdir(), "paw-expo-cli-"));
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(root, rel), body);
  const code = await run(["--mode", "full", "--force", ...args], { cwd: root, clock: CLOCK });
  return { root, code };
}

test("run(): app.config.ts만 있는 최신 Expo 구성도 기본 실행으로 설치된다", async () => {
  const { root, code } = await installIn({
    "package.json": pkg({ name: "my-app", version: "1.0.0", dependencies: { expo: "~51.0.0", "react-native": "0.74.0" } }),
    "app.config.ts": 'export default { expo: { name: "my-app" } };\n',
  });
  try {
    assert.strictEqual(code, 0);
    const vy = readFileSync(join(root, "version.yml"), "utf8");
    assert.match(vy, /react-native-expo/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("run(): --type react-native-expo 지정도 app.config.ts 구성에서 성공한다", async () => {
  const { root, code } = await installIn({
    "package.json": pkg({ name: "my-app", version: "1.0.0", dependencies: { expo: "~51.0.0" } }),
    "app.config.ts": 'export default { expo: { name: "my-app" } };\n',
  }, ["--type", "react-native-expo"]);
  try {
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(root, "version.yml")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("run(): react-native-web을 쓰는 React 웹앱은 react로 설치된다", async () => {
  const { root, code } = await installIn({
    "package.json": pkg({ name: "my-app", version: "1.0.0", dependencies: { react: "18", "react-dom": "18", "react-native-web": "0.19" } }),
  });
  try {
    assert.strictEqual(code, 0);
    const vy = readFileSync(join(root, "version.yml"), "utf8");
    assert.match(vy, /project_types:\s*\["react"\]/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
