// tests/node/detect-accuracy.test.js
// Detection accuracy regression.
// Common failure shape: "detection fails silently and the install still ends as a success".
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  detectVersionFromFiles, versionFromPom, detectJdkFromFiles, resolveMarker, resolveMarkers,
  detectTypesFromMarkers, markerForType, versionFromPyproject,
} from "../../src/core/detect.js";
import { findSpringAppYml, makeResolvers, detectVersion } from "../../src/core/detect-fs.js";

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

// ── Version detection ──────────────────────────────────────────────────
test("detectVersionFromFiles: reads the version even with only build.gradle.kts (Kotlin DSL)", () => {
  const warned = [];
  const v = detectVersionFromFiles({
    read: readFrom({ "build.gradle.kts": 'version = "1.4.2"\n' }),
    readJson: () => null, gitTag: "", warn: (m) => warned.push(m),
  });
  assert.strictEqual(v, "1.4.2");
  assert.strictEqual(warned.length, 0, "no fallback warning is expected when detection succeeds");
});

test("detectVersionFromFiles: does not read the kotlin_version variable in build.gradle as the app version", () => {
  const gradle = "buildscript {\n  ext.kotlin_version = '1.9.0'\n}\nversion = '1.2.3'\n";
  const v = detectVersionFromFiles({
    read: readFrom({ "build.gradle": gradle }), readJson: () => null, gitTag: "", warn: () => {},
  });
  assert.strictEqual(v, "1.2.3");
});

test("versionFromPyproject: [tool.*] section version is ignored and the [project] version is read", () => {
  const toml = '[tool.other]\nversion = "9.9.9"\n\n[project]\nname = "my-app"\nversion = "0.4.0"\n';
  assert.strictEqual(versionFromPyproject(toml), "0.4.0");
  assert.strictEqual(versionFromPyproject('[project]\ndynamic = ["version"]\n[tool.other]\nversion = "9.9.9"\n'), null);
});

test("detectVersionFromFiles: for multi-type repos, reads the primary type's (first entry) version file first", () => {
  const files = { "build.gradle": "version = '1.0.0'\n" };
  const readJson = (rel) => (rel === "package.json" ? { version: "3.0.0" } : null);
  const opts = { read: readFrom(files), readJson, gitTag: "", warn: () => {} };
  assert.strictEqual(detectVersionFromFiles({ ...opts, types: ["spring", "react"] }), "1.0.0");
  assert.strictEqual(detectVersionFromFiles({ ...opts, types: ["react", "spring"] }), "3.0.0");
});

test("detectVersionFromFiles: reads the version from setup.py", () => {
  const v = detectVersionFromFiles({
    read: readFrom({ "setup.py": 'setup(\n  name="my-app",\n  python_version="3.11.0",\n  version="1.0.0",\n)\n' }),
    readJson: () => null, gitTag: "", warn: () => {}, types: ["python"],
  });
  assert.strictEqual(v, "1.0.0");
});

test("detectVersionFromFiles: a prerelease version is detected as its x.y.z core", () => {
  const warned = [];
  const v = detectVersionFromFiles({
    read: () => null, readJson: (rel) => (rel === "package.json" ? { version: "2.0.0-rc.1" } : null),
    gitTag: "", warn: (m) => warned.push(m),
  });
  assert.strictEqual(v, "2.0.0");
  assert.strictEqual(warned.length, 0);
  assert.strictEqual(detectVersionFromFiles({ read: () => null, readJson: () => null, gitTag: "v1.2.3-beta.1" }), "1.2.3");
});

test("detectVersionFromFiles: react-native reads the native file version used at release before package.json", () => {
  const root = fixture({
    "package.json": JSON.stringify({ version: "1.0.0", dependencies: { "react-native": "0.74.0" } }),
    "ios/MyApp/Info.plist": "<dict><key>CFBundleShortVersionString</key>\n<string>$(MARKETING_VERSION)</string></dict>",
    "ios/Pods/Target Support Files/Lib/Info.plist": "<dict><key>CFBundleShortVersionString</key><string>9.9.9</string></dict>",
    "android/app/build.gradle": 'android { defaultConfig { versionName "1.0.3" } }',
  });
  try {
    // Skips $(MARKETING_VERSION) and ignores plists deep inside dependencies (Pods).
    assert.strictEqual(detectVersion(root, { types: ["react-native"], warn: () => {} }), "1.0.3");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("detectVersionFromFiles: falls back to package.json when react-native native files have no x.y.z", () => {
  const root = fixture({
    "package.json": JSON.stringify({ version: "0.4.0", dependencies: { "react-native": "0.74.0" } }),
    "ios/MyApp/Info.plist": "<dict><key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string></dict>",
    "android/app/build.gradle": 'android { defaultConfig { versionName "1.0" } }',
  });
  try {
    assert.strictEqual(detectVersion(root, { types: ["react-native"], warn: () => {} }), "0.4.0");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("detectVersionFromFiles: a Gradle -SNAPSHOT version is detected as its x.y.z core", () => {
  const v = detectVersionFromFiles({
    read: readFrom({ "build.gradle": "version = '1.2.0-SNAPSHOT'\n" }), readJson: () => null,
    gitTag: "", warn: () => {}, types: ["spring"],
  });
  assert.strictEqual(v, "1.2.0");
});

test("detectVersionFromFiles: reads the project version in pom.xml but not the <parent> version", () => {
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
  assert.strictEqual(v, "2.7.1", "must be the project version, not the parent BOM version (3.4.0)");
});

test("versionFromPom: does not pick the parent version even when the project version precedes <parent>", () => {
  const pom = `<project><version>9.9.9</version><parent><version>1.1.1</version></parent></project>`;
  assert.strictEqual(versionFromPom(pom), "9.9.9");
});

test("versionFromPom: does not pick a dependency version when there is no project version", () => {
  const pom = `<project><parent><version>3.4.0</version></parent>
  <dependencies><dependency><version>9.9.9</version></dependency></dependencies></project>`;
  assert.strictEqual(versionFromPom(pom), null);
});

test("detectVersionFromFiles: the fallback warning uses the hint supplied by the caller (interactive/CLI branch)", () => {
  const warned = [];
  detectVersionFromFiles({
    read: () => null, readJson: () => null, gitTag: "",
    warn: (m) => warned.push(m), hint: "You can fix it under Edit > Version.",
  });
  assert.match(warned[0], /Edit > Version/);
  assert.doesNotMatch(warned[0], /--project-version/, "the interactive flow must not point to a CLI flag");
});

// ── Markers ───────────────────────────────────────────────────────
test("resolveMarker: returns a file that actually exists (build.gradle.kts)", () => {
  const has = (n) => n === "build.gradle.kts";
  assert.strictEqual(resolveMarker("spring", has), "build.gradle.kts");
});

test("resolveMarker: uses the representative file when no candidate exists", () => {
  assert.strictEqual(resolveMarker("spring", () => false), "build.gradle");
});

test("resolveMarker: with fallback:false, returns an empty string when no candidate exists", () => {
  assert.strictEqual(resolveMarker("spring", () => false, { fallback: false }), "");
});

test("resolveMarkers: types without a file (picked manually) are not put in the evidence map", () => {
  const m = resolveMarkers(["spring", "python"], (n) => n === "build.gradle");
  assert.strictEqual(m.get("spring"), "build.gradle");
  assert.ok(!m.has("python"), "attaching a nonexistent pyproject.toml as evidence would make it look detected");
});

test("resolveMarkers: basic has no evidence file, so it is excluded from the map", () => {
  const m = resolveMarkers(["spring", "basic"], (n) => n === "pom.xml");
  assert.strictEqual(m.get("spring"), "pom.xml");
  assert.ok(!m.has("basic"));
});

test("detectTypesFromMarkers: with only go.mod, returns [\"go\"]", () => {
  const types = detectTypesFromMarkers({ has: (n) => n === "go.mod", read: () => null });
  assert.deepStrictEqual(types, ["go"]);
});

test("detectTypesFromMarkers: with both go.mod and a react package.json, both types are detected", () => {
  // A case where classifyPackageText returns "node" is not added as a fallback
  // when another type was already detected (logic at lines 22-33), so we verify with the "react" marker.
  // react has cls !== "node", so it is always pushed regardless of types.length.
  const has = (n) => n === "go.mod" || n === "package.json";
  const read = (n) => (n === "package.json" ? '{"dependencies":{"react":"18.0.0"}}' : null);
  const types = detectTypesFromMarkers({ has, read });
  assert.deepStrictEqual(types, ["go", "react"]);
});

test("markerForType: go returns go.mod (no package.json fallback)", () => {
  assert.strictEqual(markerForType("go"), "go.mod");
});

// ── Build JDK ───────────────────────────────────────────────────
test("detectJdkFromFiles: reads the JDK from the Kotlin DSL toolchain", () => {
  const kts = "java { toolchain { languageVersion = JavaLanguageVersion.of(25) } }";
  assert.strictEqual(detectJdkFromFiles({ read: readFrom({ "build.gradle.kts": kts }) }), "25");
});

test("detectJdkFromFiles: also recognizes the string form of sourceCompatibility", () => {
  const g = "sourceCompatibility = '17'";
  assert.strictEqual(detectJdkFromFiles({ read: readFrom({ "build.gradle": g }) }), "17");
});

test("detectJdkFromFiles: normalizes JavaVersion.VERSION_1_8 to 8", () => {
  const g = "sourceCompatibility = JavaVersion.VERSION_1_8";
  assert.strictEqual(detectJdkFromFiles({ read: readFrom({ "build.gradle": g }) }), "8");
});

test("detectJdkFromFiles: reads Maven's <java.version>", () => {
  const pom = "<properties><java.version>21</java.version></properties>";
  assert.strictEqual(detectJdkFromFiles({ read: readFrom({ "pom.xml": pom }) }), "21");
});

test("detectJdkFromFiles: null when there is no evidence (the caller must fall back to the previous default)", () => {
  assert.strictEqual(detectJdkFromFiles({ read: () => null }), null);
});

// ── application.yml/.yaml lookup ─────────────────────────────────
test("findSpringAppYml: also finds the .yaml extension (officially supported by Spring)", () => {
  const root = fixture({ "app/src/main/resources/application.yaml": "" });
  try {
    assert.strictEqual(findSpringAppYml(root), "app/src/main/resources/application.yaml");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("findSpringAppYml: prefers the default application file over profile files", () => {
  // Sorting by filename alone puts 'application-dev.yml' before 'application.yml' (`-` < `.`).
  const root = fixture({
    "src/main/resources/application-dev.yml": "",
    "src/main/resources/application.yml": "",
  });
  try {
    assert.strictEqual(findSpringAppYml(root), "src/main/resources/application.yml");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("findSpringAppYml: ignores application.yml outside src/main/resources", () => {
  const root = fixture({ "config/application.yml": "" });
  try {
    assert.strictEqual(findSpringAppYml(root), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── application.properties projects (Spring Initializr default output) ─────────
test("spring-app-yml resolver: with only properties, fills in that resource folder and the application.yml path", () => {
  const root = fixture({ "src/main/resources/application.properties": "spring.application.name=my-service\n" });
  try {
    const r = makeResolvers(root, "my-service", new Map([["spring", "."]]));
    assert.strictEqual(r["spring-app-yml-dir"]("spring"), "src/main/resources");
    assert.strictEqual(r["spring-app-yml-path"]("spring"), "src/main/resources/application.yml");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("spring-app-yml resolver: falls back to the standard resource folder even without a config file (including monorepo paths)", () => {
  const root = fixture({ "server/build.gradle": "" });
  try {
    const r = makeResolvers(root, "my-service", new Map([["spring", "server"]]));
    assert.strictEqual(r["spring-app-yml-dir"]("spring"), "server/src/main/resources");
    assert.strictEqual(r["spring-app-yml-path"]("spring"), "server/src/main/resources/application.yml");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("spring-app-yml resolver: when a yml exists, uses that file as before", () => {
  const root = fixture({
    "src/main/resources/application.properties": "",
    "src/main/resources/application.yml": "",
  });
  try {
    const r = makeResolvers(root, "my-service", new Map([["spring", "."]]));
    assert.strictEqual(r["spring-app-yml-path"]("spring"), "src/main/resources/application.yml");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
