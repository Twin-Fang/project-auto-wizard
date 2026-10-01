// tests/node/precheck-not-run.test.js
// Steps that never ran because a pre-check failed must be reported as "not run" with the reason, not as
// "waiting" / "canceled" with no cause: the PR preview failure comments and the Flutter iOS test-build comment.
import "../setup-lang.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const PREVIEWS = [
  "payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml",
  "payload/workflows/python/PROJECT-PYTHON-PR-PREVIEW.yaml",
  "payload/workflows/spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml",
];
const IOS = "payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml";
const MSG = join(ROOT, "payload/scripts/messages.py");

const dump = (prefix, lang) =>
  JSON.parse(execFileSync("python3", [MSG, "dump", prefix], { env: { ...process.env, PROJECT_AUTO_WIZARD_LANG: lang, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }, encoding: "utf8" }));

for (const file of PREVIEWS) {
  const text = read(file);
  const steps = text.split("      - name: Deploy pre-check (Secrets and Dockerfile)\n").slice(1);

  test(`${file}: every build pre-check has an id and reports what is missing`, () => {
    assert.strictEqual(steps.length, 3);
    for (const s of steps) {
      assert.match(s, /^ {8}id: precheck\n/);
      assert.match(s.split("\n      - name: ")[0], /echo "missing=\$ITEMS" >> "\$GITHUB_OUTPUT"\n\s+exit 1/);
    }
  });

  test(`${file}: the failure comments show blocked steps as not run, never as waiting`, () => {
    assert.ok(!text.includes("status_waiting"));
    const comments = text.split("      - name: Build/deploy failure comment\n").slice(1);
    assert.strictEqual(comments.length, 3);
    for (const c of comments) {
      assert.match(c, /PAW_IN_STEPS_PRECHECK_OUTCOME: \$\{\{ steps\.precheck\.outcome \}\}/);
      assert.match(c, /PAW_IN_STEPS_PRECHECK_OUTPUTS_MISSING: \$\{\{ steps\.precheck\.outputs\.missing \}\}/);
      assert.match(c, /PAW_IN_STEPS_PRECHECK_OUTCOME === 'failure'/);
      assert.match(c, /wf_preview\.status_precheck_blocked/);
      assert.match(c, /wf_preview\.status_not_run/);
    }
  });
}

test("the pre-check step lists every missing item (secrets and Dockerfile) in its output", (t) => {
  if (process.platform === "win32") return t.skip("the workflow step is a bash snippet for an ubuntu runner");
  const block = read(PREVIEWS[0]).split("      - name: Deploy pre-check (Secrets and Dockerfile)\n")[1].split("\n      - name: ")[0];
  const script = block.split("        run: |\n")[1].split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
  const dir = mkdtempSync(join(tmpdir(), "paw-pre-"));
  try {
    mkdirSync(join(dir, "paw"), { recursive: true });
    copyFileSync(MSG, join(dir, "paw", "messages.py"));
    const out = join(dir, "gh_output");
    writeFileSync(out, "");
    const r = spawnSync("bash", ["-e", "-c", script], {
      encoding: "utf-8",
      cwd: dir,
      env: {
        ...process.env, RUNNER_TEMP: dir.replaceAll("\\", "/"), GITHUB_OUTPUT: out.replaceAll("\\", "/"),
        PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PROJECT_AUTO_WIZARD_LANG: "en",
        DOCKERHUB_USERNAME: "", DOCKERHUB_TOKEN: "x", SERVER_HOST: "", SERVER_USER: "u", SERVER_PASSWORD: "", SSH_KEY: "",
        DOCKERFILE: "./Dockerfile", PROJECT_PATH: ".",
      },
    });
    assert.notStrictEqual(r.status, 0);
    assert.match(readFileSync(out, "utf8").replace(/\r\n/g, "\n"), /^missing=DOCKERHUB_USERNAME, SERVER_HOST, SERVER_PASSWORD, Dockerfile$/m, `${r.stdout}${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Flutter iOS test build: skipped rows say why, and nothing is shown as canceled", () => {
  const text = read(IOS);
  assert.ok(!text.includes("'canceled'"));
  assert.match(text.split("- name: Validate deploy settings\n")[1], /^ {8}id: validate\n/);
  assert.match(text, /echo "missing=\$ITEMS" >> "\$GITHUB_OUTPUT"/);
  assert.match(text, /PAW_IN_STEPS_VALIDATE_OUTCOME: \$\{\{ steps\.validate\.outcome \}\}/);
  assert.match(text, /blocked \? 'precheck_blocked' : 'not_run'/);
});

test("the new not-run messages exist in both languages with the {missing} placeholder", () => {
  const cases = [["wf_preview.", "wf_preview.status_precheck_blocked"], ["ios_test_tf.", "ios_test_tf.st_precheck_blocked"], ["ios_test_tf.", "ios_test_tf.prepare_precheck_error"]];
  for (const [prefix, key] of cases) {
    for (const lang of ["en", "ko"]) assert.match(dump(prefix, lang)[key], /\{missing\}/, `${key} (${lang})`);
  }
  for (const [prefix, key] of [["wf_preview.", "wf_preview.status_not_run"], ["ios_test_tf.", "ios_test_tf.st_not_run"]]) {
    for (const lang of ["en", "ko"]) assert.ok(dump(prefix, lang)[key], `${key} (${lang})`);
  }
  assert.match(dump("wf_preview.", "ko")["wf_preview.status_not_run"], /실행 안 됨/);
  assert.match(dump("ios_test_tf.", "ko")["ios_test_tf.st_not_run"], /실행 안 됨/);
});
