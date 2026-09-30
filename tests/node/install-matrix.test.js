// Gate: workflow install matrix per branch mode.
// | mode        | VERSION-CONTROL | AUTO-CHANGELOG | RELEASE-PUBLISH |
// | pr-flow     | ✅              | ✅             | ✅              |
// | trunk-based | ❌              | ❌             | ✅              |
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyWorkflows } from "../../src/core/copy/workflows.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const PAYLOAD = resolvePayloadRoot();
const WF = (target, name) => join(target, ".github", "workflows", name);

function install({ mode = "pr-flow", types = ["basic"], deployStyle }) {
  const target = mkdtempSync(join(tmpdir(), "paw-matrix-"));
  const ctx = createContext({
    mode: "full", force: true, types, version: "1.0.0",
    branches: { main: "main", develop: mode === "trunk-based" ? "main" : "develop", mode },
    paths: new Map(),
    ...(deployStyle === undefined ? {} : { deployStyle }),
  });
  copyWorkflows(ctx, PAYLOAD, target);
  return target;
}

test("pr-flow installs all release workflows", () => {
  const t = install({ mode: "pr-flow" });
  try {
    assert.ok(existsSync(WF(t, "PROJECT-COMMON-VERSION-CONTROL.yaml")));
    assert.ok(existsSync(WF(t, "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml")));
    assert.ok(existsSync(WF(t, "PROJECT-COMMON-RELEASE-PUBLISH.yaml")));
    assert.ok(existsSync(WF(t, "PROJECT-COMMON-README-VERSION-UPDATE.yaml")));
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test("trunk-based installs RELEASE-PUBLISH only (roles absorbed)", () => {
  const t = install({ mode: "trunk-based" });
  try {
    assert.ok(!existsSync(WF(t, "PROJECT-COMMON-VERSION-CONTROL.yaml")), "VERSION-CONTROL must be absent");
    assert.ok(!existsSync(WF(t, "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml")), "AUTO-CHANGELOG must be absent");
    assert.ok(existsSync(WF(t, "PROJECT-COMMON-RELEASE-PUBLISH.yaml")));
    assert.ok(existsSync(WF(t, "PROJECT-COMMON-README-VERSION-UPDATE.yaml")));
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test("spring default install: CI and server deploy workflows are installed together and no nexus ones", () => {
  const t = install({ types: ["spring"] });
  try {
    assert.ok(existsSync(WF(t, "PROJECT-SPRING-CI.yml")), "Spring CI is always installed");
    assert.ok(existsSync(WF(t, "PROJECT-SPRING-SIMPLE-CICD.yaml")));
    assert.ok(!existsSync(WF(t, "PROJECT-SPRING-NEXUS-CI.yml")));
    assert.ok(!existsSync(WF(t, "PROJECT-SPRING-NEXUS-PUBLISH.yml")));
    assert.ok(!existsSync(WF(t, "PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml")));
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test("spring + no deploy (none): server deploy is dropped but CI stays", () => {
  const t = install({ types: ["spring"], deployStyle: "none" });
  try {
    assert.ok(existsSync(WF(t, "PROJECT-SPRING-CI.yml")));
    assert.ok(!existsSync(WF(t, "PROJECT-SPRING-SIMPLE-CICD.yaml")));
    assert.ok(!existsSync(WF(t, "PROJECT-SPRING-PR-PREVIEW.yaml")));
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test("the common install has no SECRET-FILE-UPLOAD workflow", () => {
  const t = install({});
  try {
    assert.ok(!existsSync(WF(t, "PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml")));
  } finally { rmSync(t, { recursive: true, force: true }); }
});
