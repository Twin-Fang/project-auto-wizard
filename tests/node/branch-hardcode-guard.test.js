// Verify the branch name chosen at install is reflected in every workflow.
// If main/develop are hardcoded in checkout refs, git pull, etc. when installed with other names,
// the deploy uses the wrong branch's code or fails.
import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BIN = join(process.cwd(), "bin", "project-auto-wizard.js");
const FIXTURES = join(process.cwd(), "tests", "fixtures", "e2e");
const MAIN = "master";
const DEVELOP = "dev-line";
// Skip comment lines (user-facing notes) and catch only main/develop used as branch names on executed lines.
// Strip Maven/Gradle source paths (src/main/...) first since they are not branches.
const HARDCODED_RE = /\b(main|develop)\b/;
const SOURCE_PATH_RE = /\bsrc\/main\//g;

function installFixture(name, args) {
  const target = mkdtempSync(join(tmpdir(), `paw-branch-${name}-`));
  cpSync(join(FIXTURES, name), target, { recursive: true });
  execFileSync(process.execPath, [BIN, "--mode", "full", "--force", "--main-branch", MAIN, "--develop-branch", DEVELOP, ...args],
    { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return target;
}

function strayLines(target) {
  const wfDir = join(target, ".github", "workflows");
  const hits = [];
  for (const f of readdirSync(wfDir)) {
    readFileSync(join(wfDir, f), "utf8").split("\n").forEach((line, i) => {
      if (line.trim().startsWith("#")) return;
      if (HARDCODED_RE.test(line.replace(SOURCE_PATH_RE, ""))) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

const CASES = [
  { name: "flutter", args: ["--type", "flutter", "--flutter-store", "android,ios"] },
  { name: "spring", args: ["--type", "spring", "--deploy-style", "simple"] },
  { name: "spring", label: "spring-nginx", args: ["--type", "spring", "--deploy-style", "nginx"] },
  { name: "spring", label: "spring-traefik", args: ["--type", "spring", "--deploy-style", "traefik"] },
  { name: "react", args: ["--type", "react"] },
  { name: "next", args: ["--type", "next"] },
  { name: "python", args: ["--type", "python"] },
  { name: "go", args: ["--type", "go"] },
];

for (const { name, label = name, args } of CASES) {
  test(`${label}: --main-branch ${MAIN} installing leaves no main/develop hardcoding in the workflows`, () => {
    const t = installFixture(name, args);
    try {
      const hits = strayLines(t);
      assert.deepStrictEqual(hits, [], `hardcoded branch names:\n${hits.join("\n")}`);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });
}

test("flutter: checkout and pull in the store deploy workflows follow the installed release branch", () => {
  const t = installFixture("flutter", ["--type", "flutter", "--flutter-store", "android,ios"]);
  try {
    const wfDir = join(t, ".github", "workflows");
    for (const f of ["PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml", "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml", "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"]) {
      const body = readFileSync(join(wfDir, f), "utf8");
      assert.match(body, new RegExp(`ref: "${MAIN}"`), `${f}: checkout ref`);
      assert.match(body, new RegExp(`git pull origin ${MAIN}\\b`), `${f}: git pull`);
    }
  } finally { rmSync(t, { recursive: true, force: true }); }
});
