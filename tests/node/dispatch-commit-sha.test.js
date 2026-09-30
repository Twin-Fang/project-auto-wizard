// tests/node/dispatch-commit-sha.test.js
// For repository_dispatch runs, github.sha is the default branch HEAD, not the branch that was checked out and built.
// Workflows triggered that way must report the commit from `git rev-parse HEAD` (after the checkout) instead.
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.ya?ml$/.test(e.name) ? [p] : [];
  });
const FILES = [...walk(join(ROOT, "payload/workflows")), ...walk(join(ROOT, "templates/workflows")), ...walk(join(ROOT, ".github/workflows"))];

// repository_dispatch as a trigger key under `on:` (not a mention in a comment or script)
const isDispatchTriggered = (text) => /^ {2}repository_dispatch:/m.test(text);

const DISPATCH = FILES.filter((f) => isDispatchTriggered(readFileSync(f, "utf8").replace(/\r\n/g, "\n")));

test("the set of repository_dispatch workflows is covered", () => {
  const names = DISPATCH.map((f) => f.split(/[\\/]/).pop());
  assert.ok(names.includes("PROJECT-FLUTTER-ANDROID-TEST-APK.yaml"));
  assert.ok(names.includes("PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"));
});

for (const file of DISPATCH) {
  test(`${file.slice(ROOT.length)}: does not report github.sha as the built commit`, () => {
    const hits = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
      .split("\n")
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /github\.sha|GITHUB_SHA/.test(l) && !/^\s*(#|ref:)/.test(l));
    assert.deepStrictEqual(hits, []);
  });
}

for (const name of ["PROJECT-FLUTTER-ANDROID-TEST-APK.yaml", "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"]) {
  test(`${name}: the commit comes from the checked-out tree and is passed on`, () => {
    const text = readFileSync(join(ROOT, "payload/workflows/flutter", name), "utf8").replace(/\r\n/g, "\n");
    assert.match(text, /^\s*COMMIT_SHA=\$\(git rev-parse HEAD\)$/m);
    assert.match(text, /^\s*commit_sha: \$\{\{ steps\.\w+\.outputs\.commit_sha \}\}$/m);
    assert.match(text, /needs\.prepare-test-build\.outputs\.commit_sha/);
    // git rev-parse must run after the repository checkout step of its job
    const lines = text.split("\n");
    const at = lines.findIndex((l) => /COMMIT_SHA=\$\(git rev-parse HEAD\)/.test(l));
    const before = lines.slice(0, at).join("\n");
    assert.ok(before.lastIndexOf("- name: Checkout repository") > before.lastIndexOf("\n  prepare-test-build:"));
  });
}
