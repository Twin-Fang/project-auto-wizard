// tests/node/deploy-style.test.js
// Deploy style selection — CD workflows are alternatives, so install only one and enable its trigger.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deployFilter, isDeployWorkflow, activateDeployTrigger, isDeployStyle, DEFAULT_DEPLOY_STYLE,
  NO_DEPLOY_STYLE, cleanupOtherDeployWorkflows,
} from "../../src/core/deploy-style.js";
import { sha256 } from "../../src/core/baseline.js";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeResolvers } from "../../src/core/detect-fs.js";
import { parseArgs } from "../../src/cli/args.js";
import { parseTemplateOptions } from "../../src/core/version-yml.js";

const SIMPLE = "PROJECT-SPRING-SIMPLE-CICD.yaml";
const NGINX = "PROJECT-SPRING-NONSTOP-NGINX-CICD.yaml";
const TRAEFIK = "PROJECT-SPRING-NONSTOP-TRAEFIK-CICD.yaml";
const PREVIEW = "PROJECT-SPRING-PR-PREVIEW.yaml";
const SPRING_CI = "PROJECT-SPRING-CI.yml"; // always installed regardless of deploy style

test("deployFilter: passes only the chosen CD and always passes the PR preview", () => {
  const keep = deployFilter("nginx");
  assert.ok(keep(NGINX));
  assert.ok(!keep(SIMPLE));
  assert.ok(!keep(TRAEFIK));
  assert.ok(keep(PREVIEW), "the PR preview is orthogonal to the deploy style");
  assert.ok(keep("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
});

test("isDeployWorkflow: only the CD workflow itself is selectable", () => {
  assert.ok(isDeployWorkflow(SIMPLE) && isDeployWorkflow(NGINX) && isDeployWorkflow(TRAEFIK));
  assert.ok(!isDeployWorkflow(PREVIEW));
});

test("activateDeployTrigger: revives only the commented-out push trigger in the on block", () => {
  const before = `name: X\n\non:\n  # push:\n  #   branches:\n  #     - main\n  workflow_dispatch:\n\nenv:\n  # comment stays as-is\n  A: "1"\n`;
  const after = activateDeployTrigger(before);
  assert.match(after, /^on:\n  push:\n    branches:\n      - main\n  workflow_dispatch:$/m,
    "inner indentation hierarchy must be preserved");
  assert.match(after, /  # comment stays as-is/, "comments outside the on block must not be touched");
});

test("activateDeployTrigger: leaves an already-enabled trigger as is (idempotent)", () => {
  const already = `on:\n  push:\n    branches:\n      - main\n`;
  assert.strictEqual(activateDeployTrigger(already), already);
});

test("--deploy-style: value validation", () => {
  assert.strictEqual(parseArgs(["--deploy-style", "nginx"]).deployStyle, "nginx");
  assert.strictEqual(parseArgs(["--deploy-style", "none"]).deployStyle, "none");
  assert.strictEqual(parseArgs([]).deployStyle, "", "unspecified is empty -> stored value or default (simple)");
  assert.throws(() => parseArgs(["--deploy-style", "k8s"]), /deploy-style/);
  assert.throws(() => parseArgs(["--deploy-style"]), /deploy-style/);
  assert.ok(isDeployStyle("traefik") && isDeployStyle("none") && !isDeployStyle("k8s") && !isDeployStyle("all"));
  assert.strictEqual(DEFAULT_DEPLOY_STYLE, "simple");
  assert.strictEqual(NO_DEPLOY_STYLE, "none");
});

function springTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-deploy-style-"));
  mkdirSync(join(target, "src/main/resources"), { recursive: true });
  writeFileSync(join(target, "src/main/resources/application.yaml"), "");
  writeFileSync(join(target, "build.gradle.kts"), 'version = "1.0.0"\n');
  return target;
}

function goTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-deploy-style-go-"));
  writeFileSync(join(target, "go.mod"), "module example.com/svc\n\ngo 1.22\n");
  return target;
}

function installGo(target, deployStyle) {
  const paths = new Map([["go", "."]]);
  return runFull(createContext({
    mode: "full", force: true, types: ["go"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths, repoName: "svc", resolvers: makeResolvers(target, "svc", paths),
    now: "2026-08-12 10:00:00", today: "2026-08-12", templateVersion: "0.2.2", deployStyle,
  }), resolvePayloadRoot(), target);
}

const GO_CI = "PROJECT-GO-CI.yaml";
const GO_SIMPLE = "PROJECT-GO-SIMPLE-CICD.yaml";
const GO_PREVIEW = "PROJECT-GO-PR-PREVIEW.yaml";

function install(target, deployStyle) {
  const paths = new Map([["spring", "."]]);
  return runFull(createContext({
    mode: "full", force: true, types: ["spring"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths, repoName: "svc", resolvers: makeResolvers(target, "svc", paths),
    now: "2026-08-12 10:00:00", today: "2026-08-12", templateVersion: "0.2.2", deployStyle,
  }), resolvePayloadRoot(), target);
}

test("runFull: choosing nginx installs only that CD with its push trigger enabled", () => {
  const target = springTarget();
  try {
    install(target, "nginx");
    const files = readdirSync(join(target, ".github/workflows")).filter((f) => f.includes("SPRING"));
    assert.deepStrictEqual(files.sort(), [NGINX, PREVIEW, SPRING_CI].sort());

    const wf = readFileSync(join(target, ".github/workflows", NGINX), "utf8");
    assert.match(wf, /^on:\n  push:\n    branches:\n      - main/m,
      "the chosen style must run automatically — otherwise installing it does nothing");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: without a style, only the default (single server) is installed", () => {
  const target = springTarget();
  try {
    install(target, "");
    const files = readdirSync(join(target, ".github/workflows")).filter((f) => f.includes("SPRING"));
    assert.deepStrictEqual(files.sort(), [PREVIEW, SIMPLE, SPRING_CI].sort(),
      "only one CD — installing all four piles up unused workflows and adds questions");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: switching style deletes the untouched previous CD — leaving it would deploy twice", () => {
  const target = springTarget();
  try {
    install(target, "simple");
    const r = install(target, "nginx");

    assert.deepStrictEqual(r.cleanup.removed, [SIMPLE]);
    assert.deepStrictEqual(r.cleanup.backedUp, []);
    const files = readdirSync(join(target, ".github/workflows"));
    assert.ok(!files.includes(SIMPLE), "files the wizard installed are cleaned up by the wizard");
    assert.ok(files.includes(NGINX));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: a previous CD edited by the user is moved to .bak instead of deleted", () => {
  const target = springTarget();
  try {
    install(target, "simple");
    const p = join(target, ".github/workflows", SIMPLE);
    writeFileSync(p, readFileSync(p, "utf8") + "\n# my own edit\n");

    const r = install(target, "nginx");
    assert.deepStrictEqual(r.cleanup.backedUp, [SIMPLE]);
    assert.deepStrictEqual(r.cleanup.removed, []);
    assert.match(readFileSync(`${p}.bak`, "utf8"), /my own edit/, "the edits must be preserved");
    assert.ok(!readdirSync(join(target, ".github/workflows")).includes(SIMPLE), "the trigger must be disabled");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: cleaned-up files are also dropped from the baseline so the next run does not mistake them for 'deleted by the user'", () => {
  const target = springTarget();
  try {
    install(target, "simple");
    install(target, "nginx");
    const again = install(target, "nginx");
    assert.deepStrictEqual(again.cleanup.removed, []);
    assert.deepStrictEqual(again.workflows.removedKept, []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: reinstalling with the same style finishes quietly without false conflicts", () => {
  const target = springTarget();
  try {
    install(target, "nginx");
    const again = install(target, "nginx");
    assert.strictEqual(again.workflows.copiedFiles.length, 0,
      "the trigger-enabled copy must equal the baseline so a rerun lands on unchanged");
    assert.deepStrictEqual(again.cleanup.removed, []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("deployFilter: unknown values converge to the default instead of passing everything", () => {
  // endsWith("") is always true, so returning an empty suffix would silently turn a bad value into "install every CD".
  const keep = deployFilter("invalid-value");
  assert.ok(keep(SIMPLE));
  assert.ok(!keep(NGINX));
  assert.ok(!keep(TRAEFIK));
});

test("deploy_style in version.yml does not swallow an inline comment as its value", () => {
  const vy = 'metadata:\n  template:\n    options:\n      deploy_style: "nginx" # simple | nginx | traefik\n';
  assert.strictEqual(parseTemplateOptions(vy).deployStyle, "nginx");
});

test("deployFilter('none'): excludes the 3 CDs, the PR preview and the react/next single CD, and passes CI and common", () => {
  const keep = deployFilter("none");
  assert.ok(!keep(SIMPLE));
  assert.ok(!keep(NGINX));
  assert.ok(!keep(TRAEFIK));
  assert.ok(!keep(PREVIEW), "the PR preview is also a server deploy, so it must be excluded too");
  assert.ok(!keep("PROJECT-PYTHON-PR-PREVIEW.yaml"));
  assert.ok(!keep("PROJECT-REACT-CICD.yaml"));
  assert.ok(!keep("PROJECT-NEXT-CICD.yaml"));
  assert.ok(keep("PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"), "store deploys are not server deploys");
  assert.ok(keep("PROJECT-REACT-CI.yaml"));
  assert.ok(keep("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
});

test("adding 'none' leaves the existing detection logic intact — isDeployWorkflow is unchanged and unknown values still converge to simple", () => {
  assert.ok(isDeployWorkflow(SIMPLE) && isDeployWorkflow(NGINX) && isDeployWorkflow(TRAEFIK));
  assert.ok(!isDeployWorkflow(PREVIEW));
  const keepUnknown = deployFilter("invalid-value");
  assert.ok(keepUnknown(SIMPLE));
  assert.ok(!keepUnknown(NGINX));
  assert.ok(!keepUnknown(TRAEFIK));
});

test("cleanupOtherDeployWorkflows: switching to 'none' cleans up the untouched previous CD and the PR preview together", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-deploy-cleanup-"));
  try {
    const simpleContent = "name: simple\n";
    const previewContent = "name: preview\n";
    writeFileSync(join(dir, SIMPLE), simpleContent);
    writeFileSync(join(dir, PREVIEW), previewContent);
    const baseline = { files: {
      [SIMPLE]: { installed: sha256(simpleContent) },
      [PREVIEW]: { installed: sha256(previewContent) },
    } };

    const result = cleanupOtherDeployWorkflows(dir, [SIMPLE, PREVIEW], "none", baseline);

    assert.deepStrictEqual(result.removed, [SIMPLE, PREVIEW]);
    assert.deepStrictEqual(result.backedUp, []);
    assert.deepStrictEqual(readdirSync(dir), [], "must match a fresh install with none");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runFull: choosing 'none' installs neither the CD nor the PR preview", () => {
  const target = springTarget();
  try {
    install(target, "none");
    const files = readdirSync(join(target, ".github/workflows")).filter((f) => f.includes("SPRING"));
    assert.deepStrictEqual(files, [SPRING_CI], "the whole server-deploy folder (including the PR preview) is excluded, leaving only CI");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: switching from simple to 'none' cleans up the SIMPLE CD and PR preview together (same result as a fresh none install)", () => {
  const target = springTarget();
  try {
    install(target, "simple");
    const r = install(target, "none");
    assert.deepStrictEqual(r.cleanup.removed.sort(), [PREVIEW, SIMPLE].sort());
    assert.deepStrictEqual(r.cleanup.backedUp, []);
    const files = readdirSync(join(target, ".github/workflows")).filter((f) => f.includes("SPRING"));
    assert.deepStrictEqual(files, [SPRING_CI]);
    assert.ok(!r.secrets.has("SERVER_HOST"), "must not require server-deploy secrets anymore");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: choosing 'none' for the go type also excludes the CD file at the type root (a type without a server-deploy folder)", () => {
  const target = goTarget();
  try {
    installGo(target, "none");
    const files = readdirSync(join(target, ".github/workflows")).filter((f) => f.includes("GO"));
    assert.deepStrictEqual(files, [GO_CI], "the CD (SIMPLE-CICD) and PR preview are dropped, leaving only CI installed");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: switching go from simple to 'none' deletes the CD cleanly without a .bak", () => {
  const target = goTarget();
  try {
    installGo(target, "simple");
    const r = installGo(target, "none");
    assert.deepStrictEqual(r.cleanup.removed.sort(), [GO_PREVIEW, GO_SIMPLE].sort(),
      "the type-root CD must not be re-copied so it matches the baseline and is removed cleanly — re-copying changes the hash each time and leaks into .bak");
    assert.deepStrictEqual(r.cleanup.backedUp, []);
    const files = readdirSync(join(target, ".github/workflows"));
    assert.ok(!files.includes(GO_SIMPLE) && !files.includes(`${GO_SIMPLE}.bak`));
    assert.ok(!files.includes(GO_PREVIEW) && !files.includes(`${GO_PREVIEW}.bak`));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
