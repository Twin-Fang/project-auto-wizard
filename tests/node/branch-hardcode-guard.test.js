// 설치 시 고른 브랜치명이 모든 워크플로우에 반영되는지 검증한다.
// main/develop이 아닌 이름으로 설치했을 때 체크아웃 ref·git pull 등에 main/develop이 박혀 있으면
// 배포가 엉뚱한 브랜치 코드를 쓰거나 실패한다.
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
// 주석 줄은 사용자 안내문이라 제외하고, 실행되는 줄에서 브랜치명으로 쓰인 main/develop만 잡는다.
// Maven/Gradle 소스 경로(src/main/...)는 브랜치가 아니므로 먼저 걷어낸다.
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
  test(`${label}: --main-branch ${MAIN} 설치 시 워크플로우에 main/develop 하드코딩이 남지 않는다`, () => {
    const t = installFixture(name, args);
    try {
      const hits = strayLines(t);
      assert.deepStrictEqual(hits, [], `하드코딩된 브랜치명:\n${hits.join("\n")}`);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });
}

test("flutter: 스토어 배포 워크플로우의 체크아웃·pull이 설치한 릴리스 브랜치를 따른다", () => {
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
