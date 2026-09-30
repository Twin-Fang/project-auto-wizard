// tests/node/pr-preview-messages.test.js
// The PR preview workflows print everything through the message catalog: every referenced key must exist
// in both languages, no Hangul may remain in the workflow text, and each job loads the catalog from the
// default branch (the PR branch is not checked out yet when the first comment is written).
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FILES = [
  "payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml",
  "payload/workflows/python/PROJECT-PYTHON-PR-PREVIEW.yaml",
  "payload/workflows/spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml",
];
const HANGUL = /[가-힣]/;

const dump = (lang) =>
  JSON.parse(
    execFileSync("python3", [join(ROOT, "payload/scripts/messages.py"), "dump", "wf_preview."], {
      env: { ...process.env, PROJECT_AUTO_WIZARD_LANG: lang },
      encoding: "utf8",
    }),
  );

for (const file of FILES) {
  const text = readFileSync(join(ROOT, file), "utf8");

  test(`${file}: every catalog key exists in en and ko, and en has no Hangul`, () => {
    const keys = new Set([...text.matchAll(/\b(wf_preview\.[a-z][a-z0-9_]*[a-z0-9])/g)].map((m) => m[1]));
    assert.ok(keys.size > 30, "expected many catalog references");
    const en = dump("en");
    const ko = dump("ko");
    for (const key of keys) {
      assert.ok(key in en, `${key} missing from en`);
      assert.ok(key in ko, `${key} missing from ko`);
      assert.ok(!HANGUL.test(en[key]), `${key}: en text contains Hangul`);
    }
  });

  test(`${file}: no Hangul in the workflow except the "(선택" marker`, () => {
    const left = text.split("\n").filter((l) => HANGUL.test(l) && !/\(선택/.test(l));
    assert.deepStrictEqual(left, []);
  });

  test(`${file}: every job loads messages from the workflow's own revision before using them`, () => {
    const jobs = text.slice(text.search(/^jobs:\s*$/m)).split(/^(?=  [a-z][\w-]*:\s*$)/m).slice(1);
    assert.ok(jobs.length >= 7);
    for (const job of jobs) {
      const name = job.match(/^  ([\w-]+):/)[1];
      const steps = job.slice(job.indexOf("    steps:"));
      assert.match(steps, /ref: \$\{\{ github\.event_name == 'pull_request' && github\.sha \|\| github\.event\.repository\.default_branch \}\}/, `${name}: checkout ref`);
      assert.ok(
        steps.indexOf("- name: Load messages") < steps.indexOf("wf_preview."),
        `${name}: messages loaded before the first use`,
      );
    }
  });

  test(`${file}: the issue helper branch heading is matched in English and Korean`, () => {
    const line = text.split("\n").find((l) => l.includes("const branchRegex"));
    const re = eval(line.trim().replace(/^const branchRegex = /, "").replace(/;$/, ""));
    for (const heading of ["Branch name", "브랜치명", "브랜치"]) {
      assert.ok(re.test(`### ${heading}\n\`\`\`\nfeature/x\n\`\`\``), heading);
    }
  });
}
