// tests/node/release-deploy-dispatch.test.js
// 봇 토큰 병합(PAT 없음)으로 들어온 릴리스도 main 배포 워크플로우가 실행되도록
// RELEASE-PUBLISH가 배포 워크플로우를 workflow_dispatch로 깨우는지, PAT·사람 병합이면
// push 이벤트와 겹쳐 두 번 배포하지 않는지 고정한다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

const read = (p) => readFileSync(p, "utf8");
const PAYLOAD_RP = join("payload", "workflows", "common", "PROJECT-COMMON-RELEASE-PUBLISH.yaml");
const DOGFOOD_RP = join(".github", "workflows", "PROJECT-COMMON-RELEASE-PUBLISH.yaml");
const STEP = "- name: Trigger deploy workflows";

function stepBlock(body) {
  const idx = body.indexOf(STEP);
  assert.ok(idx > -1, "배포 트리거 스텝이 없다");
  const next = body.indexOf("\n      - name: ", idx + STEP.length);
  return body.slice(idx, next === -1 ? undefined : next);
}

// run: | 블록을 들여쓰기 10칸 기준으로 떼어 낸다 (YAML 블록 스칼라와 같은 결과).
function runScript(body) {
  const lines = stepBlock(body).split("\n");
  const start = lines.findIndex((l) => l.trim() === "run: |");
  assert.ok(start > -1, "run 블록이 없다");
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && !l.startsWith(" ".repeat(10))) break;
    out.push(l.slice(10));
  }
  return out.join("\n").replaceAll("{{MAIN_BRANCH}}", "main");
}

for (const path of [PAYLOAD_RP, DOGFOOD_RP]) {
  test(`${path}: pr-flow에서 새로 발행한 릴리스일 때만 배포 워크플로우를 깨운다`, () => {
    const body = read(path);
    const step = stepBlock(body);
    assert.ok(step.includes("steps.version.outputs.release_exists != 'true'"), "새로 발행한 릴리스에서만 깨워야 한다");
    assert.ok(step.includes("steps.mode.outputs.mode == 'pr-flow'"), "trunk-based는 사람의 push가 이미 배포를 깨운다");
    assert.ok(step.includes("GH_TOKEN: ${{ github.token }}"), "PAT 없이도 동작해야 한다");
    assert.ok(step.includes("HAS_WORKFLOW_PAT: ${{ secrets.WORKFLOW_PAT != '' }}"), "병합 주체 조회 실패 시 PAT 여부로 판단한다");
    assert.ok(body.indexOf(STEP) > body.indexOf("- name: Create GitHub Release"), "릴리스 발행 뒤에 와야 한다");
    assert.match(body, /^permissions:[\s\S]*?^\s+actions:\s*write/m);
    assert.match(body, /^permissions:[\s\S]*?^\s+pull-requests:\s*read/m, "병합 주체 조회에는 pull-requests: read가 필요하다");
  });
}

test("RELEASE-PUBLISH 배포 트리거 스텝은 payload와 레포 사본이 같다", () => {
  assert.strictEqual(runScript(read(DOGFOOD_RP)), runScript(read(PAYLOAD_RP)));
});

// main push로 도는 배포 워크플로우는 모두 workflow_dispatch가 있어야 폴백이 깨울 수 있다.
// 무중단 템플릿처럼 push가 주석 처리된 것도 설치 시 켜지므로 함께 본다.
test("main push로 도는 payload 워크플로우는 모두 workflow_dispatch를 가진다", () => {
  const root = join("payload", "workflows");
  const files = readdirSync(root, { recursive: true }).filter((f) => /\.ya?ml$/.test(f));
  let checked = 0;
  for (const f of files) {
    const body = read(join(root, f));
    const on = body.match(/^on:\n((?:[ #].*\n|\n)*)/m)?.[1] ?? "";
    if (!/^\s*#?\s*push:/m.test(on) || !on.includes("{{MAIN_BRANCH}}")) continue;
    checked++;
    assert.match(on, /^ {2}workflow_dispatch:/m, `${f}에 workflow_dispatch가 없다`);
  }
  assert.ok(checked >= 10, `검사한 워크플로우가 너무 적다: ${checked}`);
});

// ---------------------------------------------------------------
// 실측: 가짜 gh로 스텝 스크립트를 실제 git 레포에서 돌린다.
// ---------------------------------------------------------------
function hasPython3() {
  const r = spawnSync("python3", ["-c", "print(1)"], { encoding: "utf-8" });
  return r.status === 0;
}

function setupRepo({ releaseMerge = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "paw-deploy-"));
  const work = join(root, "work");
  const bin = join(root, "bin");
  mkdirSync(join(work, ".github", "workflows"), { recursive: true });
  mkdirSync(bin);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: work, encoding: "utf-8", env });
    assert.strictEqual(r.status, 0, r.stderr);
  };

  // 설치된 상태를 흉내 낸다 — 플레이스홀더를 치환하고 무중단 CD는 push를 켠 형태로 둔다.
  const payloadRoot = join("payload", "workflows");
  for (const f of readdirSync(payloadRoot, { recursive: true }).filter((n) => /\.ya?ml$/.test(n))) {
    let body = read(join(payloadRoot, f)).replaceAll("{{MAIN_BRANCH}}", "main").replaceAll("{{DEVELOP_BRANCH}}", "develop");
    if (f.endsWith("NONSTOP-NGINX-CICD.yaml")) {
      body = body.replace("  # push:\n  #   branches:\n  #     - main", "  push:\n    branches:\n      - main");
    }
    if (basename(f) === "PROJECT-REACT-CICD.yaml") {
      body = body.replace(/^( *)# @wizard paths-anchor.*$/m, "$1paths: ['web/**']");
    }
    if (basename(f) === "PROJECT-NEXT-CICD.yaml") {
      body = body.replace(/^( *)# @wizard paths-anchor.*$/m, "$1paths:\n$1  - 'site/**'");
    }
    writeFileSync(join(work, ".github", "workflows", basename(f)), body);
  }
  // 마법사가 설치하지 않은 사용자 워크플로우는 건드리지 않는다
  writeFileSync(join(work, ".github", "workflows", "my-deploy.yml"), "on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n");

  writeFileSync(join(work, "README.md"), "x\n");
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "chore: init");
  git("checkout", "-q", "-b", "develop");
  mkdirSync(join(work, "web"));
  writeFileSync(join(work, "web", "app.js"), "1\n");
  git("add", ".");
  git("commit", "-q", "-m", "feat: 새 화면");
  git("checkout", "-q", "main");
  if (releaseMerge) {
    git("merge", "-q", "--no-ff", "-m", "chore(release): v0.2.0 (PR #7)", "develop");
  } else {
    git("merge", "-q", "--ff-only", "develop");
    git("commit", "-q", "--allow-empty", "-m", "chore(version): bump to v0.2.0 [skip ci]");
  }

  // 가짜 gh: 병합 주체 조회는 FAKE_MERGED_BY(비면 실패), workflow run은 기록만 한다
  const log = join(root, "gh.log");
  writeFileSync(join(bin, "gh"), [
    "#!/usr/bin/env bash",
    `echo "$*" >> "${log}"`,
    'if [ "$1" = "api" ]; then',
    '  [ -n "$FAKE_MERGED_BY" ] || exit 1',
    '  echo "$FAKE_MERGED_BY"',
    "fi",
    "exit 0",
    "",
  ].join("\n"));
  chmodSync(join(bin, "gh"), 0o755);
  return { root, work, bin, log };
}

function runStep(t, { mergedBy = "", hasPat = "false", releaseMerge = true } = {}) {
  if (process.platform === "win32") {
    t.skip("워크플로우 셸 조각은 ubuntu 러너용 bash 전제");
    return null;
  }
  if (!hasPython3()) {
    t.skip("python3 없음");
    return null;
  }
  const { root, work, bin, log } = setupRepo({ releaseMerge });
  try {
    // The step prints through the message catalog, so provide it like an installed repo does.
    mkdirSync(join(work, ".github", "scripts"), { recursive: true });
    copyFileSync(join("payload", "scripts", "messages.py"), join(work, ".github", "scripts", "messages.py"));
    const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", runScript(read(PAYLOAD_RP))], {
      cwd: work, encoding: "utf-8",
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: root, GITHUB_WORKSPACE: work, PROJECT_AUTO_WIZARD_LANG: "en", GITHUB_REPOSITORY: "my-org/my-app",
        FAKE_MERGED_BY: mergedBy, HAS_WORKFLOW_PAT: hasPat, RELEASE_VERSION: "0.2.0", MAIN_BRANCH: "main",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    });
    assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const calls = existsSync(log) ? read(log).split("\n").filter(Boolean) : [];
    return {
      api: calls.filter((c) => c.startsWith("api ")),
      runs: calls.filter((c) => c.startsWith("workflow run ")).map((c) => c.split(" ")[2]),
      stdout: r.stdout,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("봇 토큰이 병합한 릴리스는 main 배포 워크플로우를 모두 깨운다", (t) => {
  const r = runStep(t, { mergedBy: "github-actions[bot]" });
  if (!r) return;
  assert.deepStrictEqual(r.api, ["api repos/my-org/my-app/pulls/7 --jq .merged_by.login // \"\""]);
  assert.match(r.stdout, /PR #7 was merged with the bot token/);
  assert.deepStrictEqual(r.runs, [
    "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml",
    "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml",
    "PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml",
    "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml",
    "PROJECT-GO-SIMPLE-CICD.yaml",
    "PROJECT-PYTHON-SIMPLE-CICD.yaml",
    "PROJECT-REACT-CICD.yaml",
    "PROJECT-SPRING-NONSTOP-NGINX-CICD.yaml",
    "PROJECT-SPRING-SIMPLE-CICD.yaml",
  ], "develop CI·공통·사용자 워크플로우·push가 꺼진 무중단 CD·paths가 맞지 않는 CD는 빠져야 한다");
});

test("봇 병합 판정은 github-actions[bot]과 정확히 일치할 때만 한다", (t) => {
  // 접두사만 같은 다른 계정(예: 머신 계정)은 사람 병합으로 보고 건너뛴다
  const machine = runStep(t, { mergedBy: "github-actions-machine", hasPat: "true" });
  if (!machine) return;
  assert.deepStrictEqual(machine.runs, []);
  // PAT이 없어도 건너뛰어야 한다 — 병합 주체가 확인된 사람 계정이기 때문
  assert.deepStrictEqual(runStep(t, { mergedBy: "github-actions-machine", hasPat: "false" }).runs, []);
  assert.ok(runStep(t, { mergedBy: "github-actions[bot]", hasPat: "true" }).runs.length > 0);
});

test("PAT·사람이 병합했으면 push 이벤트가 이미 배포했으므로 깨우지 않는다", (t) => {
  const r = runStep(t, { mergedBy: "my-bot-user", hasPat: "true" });
  if (!r) return;
  assert.deepStrictEqual(r.runs, []);
});

test("병합 주체를 모르면 PAT이 있을 때는 건너뛰고 없을 때는 깨운다", (t) => {
  const withPat = runStep(t, { mergedBy: "", hasPat: "true" });
  if (!withPat) return;
  assert.deepStrictEqual(withPat.runs, []);
  const noPat = runStep(t, { mergedBy: "", hasPat: "false" });
  assert.ok(noPat.runs.includes("PROJECT-SPRING-SIMPLE-CICD.yaml"), noPat.stdout);
});

test("릴리스 PR 병합이 아닌 릴리스(안전망 bump)는 깨우지 않는다", (t) => {
  const r = runStep(t, { mergedBy: "github-actions[bot]", releaseMerge: false });
  if (!r) return;
  assert.deepStrictEqual(r.api, []);
  assert.deepStrictEqual(r.runs, []);
});
