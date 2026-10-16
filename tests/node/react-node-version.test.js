// tests/node/react-node-version.test.js
// The React workflows build with a default Node.js version users rarely change, so it must be a line that still gets
// security fixes, and CI and CD must build with the same one (#424). Node 20 reached end of life in April 2026.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIN_SUPPORTED_MAJOR = 22;
const files = ["PROJECT-REACT-CI.yaml", "PROJECT-REACT-CICD.yaml"].map((f) => join("payload", "workflows", "react", f));
const nodeVersion = (path) => readFileSync(path, "utf8").match(/^ {2}NODE_VERSION: "([^"]+)"/m)?.[1];

test("React CI and CD default to a supported Node.js line", () => {
  for (const path of files) {
    const version = nodeVersion(path);
    assert.ok(version, `${path}: NODE_VERSION is missing`);
    assert.ok(Number.parseInt(version, 10) >= MIN_SUPPORTED_MAJOR, `${path}: NODE_VERSION ${version} is below ${MIN_SUPPORTED_MAJOR}`);
  }
});

test("React CI and CD build with the same default Node.js version", () => {
  assert.strictEqual(nodeVersion(files[0]), nodeVersion(files[1]));
});
