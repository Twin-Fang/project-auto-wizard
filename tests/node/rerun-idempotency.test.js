// tests/node/rerun-idempotency.test.js
// Re-running the same install or receiving an upstream update must give stable results.
//  - unchanged rerun: version.yml deploy block, required Secrets and record files stay the same
//  - auto update: deploy values answered at install (deploy block) do not revert to template defaults
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull, postInstallNotices } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeResolvers } from "../../src/core/detect-fs.js";
import { parseExisting } from "../../src/core/version-yml.js";
import { collectAsks } from "../../src/ui/env-plan.js";
import { readSavedDeployValues } from "../../src/core/copy/workflows.js";

const PAYLOAD = resolvePayloadRoot();
const WF = ".github/workflows";
const SIMPLE = "PROJECT-SPRING-SIMPLE-CICD.yaml";

function springRepo() {
  const dir = mkdtempSync(join(tmpdir(), "paw-rerun-"));
  mkdirSync(join(dir, "src", "main", "resources"), { recursive: true });
  writeFileSync(join(dir, "build.gradle"), "version = '1.0.0'\n");
  writeFileSync(join(dir, "src", "main", "resources", "application.yml"), "a: 1\n");
  return dir;
}

function ctx(dir, extra = {}) {
  const paths = new Map([["spring", "."]]);
  return createContext({
    mode: "full", force: true, types: ["spring"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths, repoName: "my-service", resolvers: makeResolvers(dir, "my-service", paths),
    templateVersion: "0.12.2", deployStyle: "simple", ...extra,
  });
}

// Build the state where the user answered DEPLOY_PORT=9090, SSH_AUTH_METHOD=password at install.
function installWithAnswers(dir, payload = PAYLOAD) {
  const envValues = new Map([["DEPLOY_PORT", "9090"], ["SSH_AUTH_METHOD", "password"]]);
  return runFull(ctx(dir, { envValues, envUseDefaults: false, now: "2026-01-01 00:00:00", today: "2026-01-01" }), payload, dir);
}

test("unchanged rerun: deploy block and required Secrets stay the same and record files are not rewritten", () => {
  const dir = springRepo();
  try {
    const first = installWithAnswers(dir);
    const vy1 = readFileSync(join(dir, "version.yml"), "utf8");
    const bl1 = readFileSync(join(dir, ".github", ".wizard", "baseline.json"), "utf8");
    assert.match(vy1, /^deploy:/m);
    assert.match(vy1, /DEPLOY_PORT: "9090"/);

    const second = runFull(ctx(dir, { now: "2026-01-02 00:00:00", today: "2026-01-02" }), PAYLOAD, dir);
    assert.strictEqual(readFileSync(join(dir, "version.yml"), "utf8"), vy1, "version.yml must not change");
    assert.strictEqual(readFileSync(join(dir, ".github", ".wizard", "baseline.json"), "utf8"), bl1, "baseline must not change");
    assert.deepStrictEqual([...second.secrets.keys()].sort(), [...first.secrets.keys()].sort());
    assert.ok(!second.secrets.has("SSH_KEY"), "SSH_KEY is not required with password auth");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("upstream auto update: deploy values answered at install do not revert to defaults", () => {
  const dir = springRepo();
  const payload = mkdtempSync(join(tmpdir(), "paw-rerun-payload-"));
  try {
    cpSync(PAYLOAD, payload, { recursive: true });
    installWithAnswers(dir, payload);
    const wf = join(dir, WF, SIMPLE);
    assert.match(readFileSync(wf, "utf8"), /DEPLOY_PORT: "9090"/);

    // Upstream changed SIMPLE-CICD — the user did not touch the file, so it is an auto-update target
    const tpl = join(payload, "workflows", "spring", "server-deploy", SIMPLE);
    writeFileSync(tpl, readFileSync(tpl, "utf8") + "\n# upstream change\n");
    const r = runFull(ctx(dir), payload, dir);

    assert.ok(r.workflows.autoUpdated.includes(SIMPLE), "a user-unedited file must be auto-updated");
    const after = readFileSync(wf, "utf8");
    assert.match(after, /# upstream change/);
    assert.match(after, /DEPLOY_PORT: "9090"/, "the stored value must be kept");
    assert.match(readFileSync(join(dir, "version.yml"), "utf8"), /DEPLOY_PORT: "9090"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(payload, { recursive: true, force: true });
  }
});

test("interactive env questions show the stored deploy values as defaults", () => {
  const dir = springRepo();
  try {
    installWithAnswers(dir);
    const paths = new Map([["spring", "."]]);
    const asks = collectAsks(PAYLOAD, ["spring"], {
      resolvers: makeResolvers(dir, "my-service", paths), deployStyle: "simple",
      saved: readSavedDeployValues(dir),
    });
    assert.strictEqual(asks.defaults.get("DEPLOY_PORT"), "9090");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("parseExisting: reads the deploy block into typed values and unescapes them", () => {
  const vy = [
    'version: "1.0.0"',
    "",
    "deploy: # 마법사가 기억하는 배포 설정",
    "  spring:",
    '    DEPLOY_PORT: "9090"',
    '    CONTAINER_NAME: "my-\\"svc\\""',
    "  go:",
    '    SSH_AUTH_METHOD: "key"',
    "",
  ].join("\n");
  const { deploy } = parseExisting(vy);
  assert.strictEqual(deploy.get("spring").get("DEPLOY_PORT"), "9090");
  assert.strictEqual(deploy.get("spring").get("CONTAINER_NAME"), 'my-"svc"');
  assert.strictEqual(deploy.get("go").get("SSH_AUTH_METHOD"), "key");
});

test("answering a value anew on rerun is reflected in user-unedited files and the deploy block", () => {
  const dir = springRepo();
  try {
    installWithAnswers(dir);
    const envValues = new Map([["DEPLOY_PORT", "7070"]]);
    runFull(ctx(dir, { envValues, envUseDefaults: false }), PAYLOAD, dir);
    assert.match(readFileSync(join(dir, WF, SIMPLE), "utf8"), /DEPLOY_PORT: "7070"/);
    const vy = readFileSync(join(dir, "version.yml"), "utf8");
    assert.match(vy, /DEPLOY_PORT: "7070"/);
    assert.match(vy, /SSH_AUTH_METHOD: "password"/, "values not answered anew keep the stored value");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a file skipped by --force on conflict stays a conflict on the next run (must not be misclassified as upstream-unchanged)", () => {
  const dir = springRepo();
  const payload = mkdtempSync(join(tmpdir(), "paw-rerun-payload-"));
  try {
    cpSync(PAYLOAD, payload, { recursive: true });
    runFull(ctx(dir), payload, dir);
    const CI = "PROJECT-SPRING-CI.yml";
    const wf = join(dir, WF, CI);
    writeFileSync(wf, readFileSync(wf, "utf8") + "\n# my edit\n");
    const tpl = join(payload, "workflows", "spring", CI);
    writeFileSync(tpl, readFileSync(tpl, "utf8") + "\n# upstream change\n");

    const first = runFull(ctx(dir), payload, dir);
    assert.deepStrictEqual(first.workflows.conflictKept, [CI]);
    assert.match(postInstallNotices(first).join("\n"), /충돌 1개/);

    const second = runFull(ctx(dir), payload, dir);
    assert.deepStrictEqual(second.workflows.conflictKept, [CI], "must still be a conflict on the second run");
    assert.ok(!second.workflows.keptLocal.includes(CI), "must not be classified as upstream-unchanged (localOnly)");
    assert.match(readFileSync(wf, "utf8"), /# my edit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(payload, { recursive: true, force: true });
  }
});
