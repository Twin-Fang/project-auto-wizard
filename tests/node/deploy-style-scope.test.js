// tests/node/deploy-style-scope.test.js
// 배포 방식은 서버 배포(CD) 워크플로우가 있는 타입일 때만 묻고 기록한다.
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

test("hasServerDeployWorkflows: spring·go·python·react·next만 서버 배포 워크플로우를 가진다", () => {
  for (const t of ["spring", "go", "python", "react", "next"]) assert.strictEqual(hasServerDeployWorkflows(payload, [t]), true, t);
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

test("interactive: node 프로젝트는 배포 방식을 묻지 않고 deploy_style을 기록하지 않는다", async () => {
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

test("interactive: go 프로젝트는 배포 방식을 묻고 기록한다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-deploy-scope-"));
  try {
    writeFileSync(join(dir, "go.mod"), "module example.com/my-service\n\ngo 1.22\n");
    const asked = [];
    assert.strictEqual(await runInteractive({}, { cwd: dir, io: stubIo(asked) }), 0);
    assert.strictEqual(asked.length, 1);
    // go에는 nginx 무중단 워크플로우가 없어 단일 서버 배포가 설치된다 — 설치된 방식을 기록한다.
    assert.match(readFileSync(join(dir, "version.yml"), "utf8"), /deploy_style: "simple"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run(--force): node 프로젝트는 deploy_style을 기록하지 않는다", async () => {
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
