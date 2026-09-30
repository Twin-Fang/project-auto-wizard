// tests/node/type-ci-tests.test.js
// Pins that each type's CI runs tests as well as the build, and does not fail in the default state (no Dockerfile, no tests).
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOWS_DIR = fileURLToPath(new URL("../../payload/workflows", import.meta.url));
const read = (file) => readFileSync(join(WORKFLOWS_DIR, file), "utf8");

// The `- name: <name>` step block (up to the next step). null when missing.
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

test("Python CI: runs pytest after installing dependencies, and skips when there are no tests", () => {
  const text = read("python/PROJECT-PYTHON-CI.yaml");
  const install = stepBlock(text, "Install dependencies");
  assert.ok(install, "install dependencies step missing");
  assert.match(install, /pip install -r requirements\.txt/);
  assert.match(install, /pip install \./);
  const pytest = stepBlock(text, "Run tests (pytest)");
  assert.ok(pytest, "pytest step missing");
  assert.match(pytest, /python -m pytest/);
  assert.match(pytest, /-eq 5/, "no tests collected (exit code 5) must not count as a failure");
  assert.match(pytest, /cibuild\.py_no_test_files/, "the reason for skipping must be logged");
});

test("Python CI: Docker build verification runs only when a Dockerfile exists", () => {
  const text = read("python/PROJECT-PYTHON-CI.yaml");
  assert.ok(stepBlock(text, "Check for Dockerfile"), "Dockerfile check step missing");
  for (const name of ["Set up Docker Buildx", "Verify Docker image build"]) {
    const block = stepBlock(text, name);
    assert.ok(block, `${name} step missing`);
    assert.match(block, /if: steps\.dockerfile\.outputs\.exists == 'true'/, `${name}: Dockerfile condition missing`);
  }
});

for (const file of ["react/PROJECT-REACT-CI.yaml", "next/PROJECT-NEXT-CI.yaml"]) {
  test(`${file}: runs npm test when a test script exists, and skips otherwise`, () => {
    const text = read(file);
    const block = stepBlock(text, "Run tests");
    assert.ok(block, "run tests step missing");
    assert.match(block, /CI=true npm test/);
    assert.match(block, /no test specified/, "the npm init default test script must count as none");
    assert.match(block, /cibuild\.node_no_test_script/);
    // Runs before the build so that a test failure reaches the CI Gate
    assert.ok(text.indexOf("- name: Run tests") < text.indexOf("- name: Build project"));
  });
}

test("Flutter CI: runs flutter test when tests exist so failures reach the CI Gate, and skips when there are none", () => {
  const text = read("flutter/PROJECT-FLUTTER-CI.yaml");
  const block = stepBlock(text, "Run Flutter Test");
  assert.ok(block, "flutter test step missing");
  assert.match(block, /flutter test/);
  assert.match(block, /find test -name '\*_test\.dart'/, "must skip when there are no test files");
  assert.match(block, /::notice::|::notice title=/, "must leave a reason when skipping");
  assert.doesNotMatch(block, /continue-on-error/, "a test failure must fail the job");
  // Must be inside the analyze job that the CI Gate aggregates via needs, so failures reach the gate
  const analyzeJob = text.slice(text.indexOf("\n  analyze:\n"), text.indexOf("\n  build-android:\n"));
  assert.ok(analyzeJob.includes("- name: Run Flutter Test"), "outside the analyze job");
  assert.ok(analyzeJob.indexOf("- name: Run Flutter Analyze") < analyzeJob.indexOf("- name: Run Flutter Test"));
  const gate = text.slice(text.indexOf("\n  ci-gate:\n"));
  assert.match(gate, /needs: \[[^\]]*\banalyze\b/);
  // The test result must also appear in the result comment
  assert.match(text, /test_status: \$\{\{ steps\.result\.outputs\.test_status \}\}/);
  assert.match(text, /\| 🧪 Test \| \$\{testDisplay\}/);
});
