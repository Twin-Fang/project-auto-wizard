// tests/node/copilot-workflows.test.js
// Opt-in Copilot CLI instead of GitHub Models (models: read), engine labeling, neutral label.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NAMES = ["AI-PR-SUMMARY", "AUTO-CHANGELOG-CONTROL", "RELEASE-PUBLISH"];
const payloadPath = (n) => join("payload", "workflows", "common", `PROJECT-COMMON-${n}.yaml`);
const dogfoodPath = (n) => join(".github", "workflows", `PROJECT-COMMON-${n}.yaml`);
const read = (p) => readFileSync(p, "utf8");
const substitute = (text) => text.replaceAll("{{MAIN_BRANCH}}", "main").replaceAll("{{DEVELOP_BRANCH}}", "develop");

for (const name of NAMES) {
  for (const [label, path] of [["payload", payloadPath(name)], ["dogfood", dogfoodPath(name)]]) {
    test(`${name} (${label}): declares copilot-requests: write instead of models: read`, () => {
      const body = read(path);
      assert.ok(!body.includes("models: read"), "the retired GitHub Models permission is still present");
      assert.match(body, /^permissions:[\s\S]*?^\s+copilot-requests:\s*write/m);
    });

    test(`${name} (${label}): no longer mentions the retired GitHub Models engine`, () => {
      assert.ok(!/GitHub Models/.test(read(path)));
    });
  }

  test(`${name}: reads the copilot_ai option from version.yml and installs the pinned Copilot CLI only when it is on`, () => {
    const body = read(payloadPath(name));
    assert.ok(body.includes("copilot_ai:"), "must read copilot_ai from version.yml");
    assert.ok(body.includes("id: copilot_options"));
    const install = body.slice(body.indexOf("- name: Install Copilot CLI"));
    assert.match(install.slice(0, 500), /steps\.copilot_options\.outputs\.copilot_ai == 'true'/);
    assert.match(install.slice(0, 500), /npm install -g @github\/copilot@\d+\.\d+\.\d+/);
  });

  test(`${name}: the AI step passes COPILOT_AI and does not specify a model`, () => {
    assert.ok(read(payloadPath(name)).includes("COPILOT_AI: ${{ steps.copilot_options.outputs.copilot_ai }}"));
    for (const path of [payloadPath(name), dogfoodPath(name)]) {
      assert.ok(!read(path).includes("COPILOT_MODEL"), `${path}: a model override is still passed (Free/Student allow auto only)`);
    }
  });

  test(`${name}: the Copilot-related lines of the dogfood copy match payload`, () => {
    const pick = (text) => substitute(text).split("\n").filter((l) => /copilot|PR Summary|engine/i.test(l));
    assert.deepStrictEqual(pick(read(dogfoodPath(name))), pick(read(payloadPath(name))));
  });
}

test("all three workflows pin the same Copilot CLI version", () => {
  const versions = NAMES.map((n) => read(payloadPath(n)).match(/@github\/copilot@(\d+\.\d+\.\d+)/)?.[1]);
  assert.ok(versions.every(Boolean), `missing version pin: ${versions}`);
  assert.strictEqual(new Set(versions).size, 1);
});

test("AI-PR-SUMMARY and AUTO-CHANGELOG-CONTROL dogfood copies are identical to payload after placeholder substitution", () => {
  for (const name of ["AI-PR-SUMMARY", "AUTO-CHANGELOG-CONTROL"]) {
    assert.strictEqual(read(dogfoodPath(name)), substitute(read(payloadPath(name))), name);
  }
});

test("the PR comment header uses an engine-neutral name and states the engine", () => {
  for (const name of ["AI-PR-SUMMARY", "AUTO-CHANGELOG-CONTROL"]) {
    for (const path of [payloadPath(name), dogfoodPath(name)]) {
      const body = read(path);
      assert.ok(!body.includes("AI Summary (project-auto-wizard)"), `${path}: a misleading label is still present`);
      assert.ok(body.includes("📋 **PR Summary (project-auto-wizard)**"), path);
      assert.match(body, /<sub>engine: \$\{ENGINE/, path);
    }
  }
});

test("AUTO-CHANGELOG-CONTROL passes the summary step's engine output to the comment step", () => {
  const body = read(payloadPath("AUTO-CHANGELOG-CONTROL"));
  assert.ok(body.includes("id: summary"));
  assert.ok(body.includes('echo "engine=$ENGINE" >> $GITHUB_OUTPUT'));
  assert.ok(body.includes("ENGINE: ${{ steps.summary.outputs.engine }}"));
});

test("AI-PR-SUMMARY cancels the in-progress run on consecutive pushes", () => {
  for (const path of [payloadPath("AI-PR-SUMMARY"), dogfoodPath("AI-PR-SUMMARY")]) {
    const body = read(path);
    assert.match(body, /^concurrency:\s*\n\s+group: ai-pr-summary-\$\{\{ github\.event\.pull_request\.number \}\}\s*\n\s+cancel-in-progress: true/m, path);
  }
});

test("AUTO-CHANGELOG-CONTROL concurrency does not cancel, because the job creates commits", () => {
  assert.match(read(payloadPath("AUTO-CHANGELOG-CONTROL")), /cancel-in-progress: false/);
});

test("RELEASE-PUBLISH: the Copilot option and install step run only on trunk-based pushes", () => {
  const body = read(payloadPath("RELEASE-PUBLISH"));
  const start = body.indexOf("- name: Read copilot_ai option from version.yml");
  assert.ok(start > 0);
  const section = body.slice(start, body.indexOf("- name: Trunk-based version bump + changelog"));
  assert.equal((section.match(/steps\.mode\.outputs\.mode == 'trunk-based'/g) || []).length, 2);
  assert.equal((section.match(/github\.event_name == 'push'/g) || []).length, 2);
});
