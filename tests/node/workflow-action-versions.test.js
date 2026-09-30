// tests/node/workflow-action-versions.test.js
// If installed workflows use outdated GitHub Actions, deprecation warnings appear in every user repo.
// Even after an upgrade they fall behind again over time, so tests catch at least the following two.
//   (1) no major below the known floor is used
//   (2) the same action is not mixed across different majors (setup-java used to mix v3 and v4)
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// Latest majors as of 2026-08-06. Bump these together when upgrading an action.
const MIN_MAJOR = {
  "actions/checkout": 7,
  "actions/setup-node": 7,
  "actions/setup-python": 7,
  "actions/setup-java": 5,
  "actions/cache": 6,
  "actions/upload-artifact": 7,
  "actions/download-artifact": 8,
  "actions/github-script": 9,
  "actions/setup-go": 7,
};

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : (/\.ya?ml$/.test(e.name) ? [p] : []);
  });
}

// Targets the payload (shipped to users) plus this repo's own workflows (including dogfooding copies).
function allWorkflows() {
  return [...walk(join(REPO_ROOT, "payload", "workflows")), ...walk(join(REPO_ROOT, ".github", "workflows"))];
}

// "uses: actions/checkout@v7" → { action: "actions/checkout", major: 7 }
function usedActions(text) {
  const out = [];
  for (const m of text.matchAll(/uses:\s*(actions\/[a-z0-9-]+)@v(\d+)/g)) {
    out.push({ action: m[1], major: Number(m[2]) });
  }
  return out;
}

test("workflows do not use an action with a major version below the floor", () => {
  const stale = [];
  for (const file of allWorkflows()) {
    for (const { action, major } of usedActions(readFileSync(file, "utf8"))) {
      const min = MIN_MAJOR[action];
      if (min !== undefined && major < min) {
        stale.push(`${file.slice(REPO_ROOT.length)}: ${action}@v${major} (floor v${min})`);
      }
    }
  }
  assert.deepStrictEqual(stale, [], `outdated actions remain:\n  ${stale.join("\n  ")}`);
});

test("the same action is not mixed across different major versions", () => {
  const seen = new Map();
  for (const file of allWorkflows()) {
    for (const { action, major } of usedActions(readFileSync(file, "utf8"))) {
      if (!seen.has(action)) seen.set(action, new Set());
      seen.get(action).add(major);
    }
  }
  const mixed = [...seen.entries()]
    .filter(([, majors]) => majors.size > 1)
    .map(([action, majors]) => `${action}: v${[...majors].sort().join(", v")}`);
  assert.deepStrictEqual(mixed, [], `actions with mixed versions found:\n  ${mixed.join("\n  ")}`);
});
