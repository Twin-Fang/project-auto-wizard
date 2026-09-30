// tests/node/deploy-style-scope.test.js
// The deploy style is asked and recorded only for types that have a server deploy (CD) workflow.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hasServerDeployWorkflows } from "../../src/core/deploy-style.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runInteractive } from "../../src/commands/interactive.js";
import { run } from "../../src/index.js";

const payload = resolvePayloadRoot();

test("hasServerDeployWorkflows: only spring, go, python and react have server deploy workflows", () => {
  for (const t of ["spring", "go", "python", "react"]) assert.strictEqual(hasServerDeployWorkflows(payload, [t]), true, t);
  for (const t of ["node", "flutter", "basic", "react-native", "react-native-expo"]) {
    assert.strictEqual(hasServerDeployWorkflows(payload, [t]), false, t);
  }
  assert.strictEqual(hasServerDeployWorkflows(payload, ["flutter", "spring"]), true);
});

function stubIo(deployAsked) {
  return {
    selectMode: async () => "full",
    confirmProjectMenu: async () => "continue",
    confirmTypes: async ({ types }) => types,
    selectDeployStyle: async () => { deployAsked.push(true); return "nginx"; },
    selectBranchStrategy: async () => "pr-flow",
    askYesNo: async (_m, def) => def,
    askText: async (_m, def) => def,
    note: () => {}, cancelMessage: () => {}, summary: () => {}, outro: () => {},
    editMenu: async () => "done",
  };
}

test("interactive: a node project is not asked about the deploy style and deploy_style is not recorded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-deploy-scope-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app", version: "1.0.0" }));
    const asked = [];
    assert.strictEqual(await runInteractive({}, { cwd: dir, io: stubIo(asked) }), 0);
    assert.strictEqual(asked.length, 0);
    assert.doesNotMatch(readFileSync(join(dir, "version.yml"), "utf8"), /deploy_style:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("interactive: a go project is asked about the deploy style and it is recorded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-deploy-scope-"));
  try {
    writeFileSync(join(dir, "go.mod"), "module example.com/my-service\n\ngo 1.22\n");
    const asked = [];
    assert.strictEqual(await runInteractive({}, { cwd: dir, io: stubIo(asked) }), 0);
    assert.strictEqual(asked.length, 1);
    // go has no nginx zero-downtime workflow, so a single-server deploy is installed — the installed style is recorded.
    assert.match(readFileSync(join(dir, "version.yml"), "utf8"), /deploy_style: "simple"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run(--force): a node project does not record deploy_style", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-deploy-scope-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app", version: "1.0.0" }));
    const original = process.stderr.write;
    process.stderr.write = () => true;
    try {
      assert.strictEqual(await run(["--mode", "full", "--force", "--type", "node"], { cwd: dir }), 0);
    } finally {
      process.stderr.write = original;
    }
    assert.doesNotMatch(readFileSync(join(dir, "version.yml"), "utf8"), /deploy_style:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
