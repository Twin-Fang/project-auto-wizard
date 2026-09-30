// tests/node/detect-package-deps.test.js
// package.json type classification is decided only by dependency keys — judging by raw substrings
// would change the type due to characters mixed into script names or other package names.
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

test("classifyPackageText: with an expo dependency, react-native-expo", () => {
  assert.strictEqual(classifyPackageText(pkg({ dependencies: { expo: "~51.0.0", "react-native": "0.74.0" } })), "react-native-expo");
});

test("classifyPackageText: an export script or an exponential-backoff dependency is not treated as expo", () => {
  assert.strictEqual(classifyPackageText(pkg({
    scripts: { export: "react-native bundle" }, dependencies: { "react-native": "0.73" },
  })), "react-native");
  assert.strictEqual(classifyPackageText(pkg({
    dependencies: { "react-native": "0.73", "exponential-backoff": "3.1.1" },
  })), "react-native");
});

test("classifyPackageText: a React web app using react-native-web is react", () => {
  assert.strictEqual(classifyPackageText(pkg({
    dependencies: { react: "18", "react-dom": "18", "react-native-web": "0.19" },
  })), "react");
});

test("classifyPackageText: next in keywords is not treated as next", () => {
  assert.strictEqual(classifyPackageText(pkg({ name: "my-app", keywords: ["next"] })), "node");
  assert.strictEqual(classifyPackageText(pkg({ devDependencies: { next: "14" }, dependencies: { react: "18" } })), "next");
});

test("classifyPackageText: a broken package.json is node", () => {
  assert.strictEqual(classifyPackageText("{ not json"), "node");
  assert.strictEqual(classifyPackageText(""), "node");
});

test("resolveMarker: Expo with only app.config.ts and no app.json still finds the evidence file", () => {
  assert.strictEqual(resolveMarker("react-native-expo", (n) => n === "app.config.ts" || n === "package.json"), "app.config.ts");
  assert.strictEqual(resolveMarker("react-native-expo", (n) => n === "package.json"), "package.json");
});

test("findTypePathCandidates: finds an app.config.js Expo app in a subfolder as a candidate", () => {
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

test("run(): a modern Expo setup with only app.config.ts is installed by the default run", async () => {
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

test("run(): specifying --type react-native-expo also succeeds with an app.config.ts setup", async () => {
  const { root, code } = await installIn({
    "package.json": pkg({ name: "my-app", version: "1.0.0", dependencies: { expo: "~51.0.0" } }),
    "app.config.ts": 'export default { expo: { name: "my-app" } };\n',
  }, ["--type", "react-native-expo"]);
  try {
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(root, "version.yml")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("run(): a React web app using react-native-web is installed as react", async () => {
  const { root, code } = await installIn({
    "package.json": pkg({ name: "my-app", version: "1.0.0", dependencies: { react: "18", "react-dom": "18", "react-native-web": "0.19" } }),
  });
  try {
    assert.strictEqual(code, 0);
    const vy = readFileSync(join(root, "version.yml"), "utf8");
    assert.match(vy, /project_types:\s*\["react"\]/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
