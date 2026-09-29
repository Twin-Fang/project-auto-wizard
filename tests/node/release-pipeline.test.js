// tests/node/release-pipeline.test.js
// 사용자 레포에 설치되는 공통 릴리스 워크플로우의 커밋 위생·멱등성·패키징을 고정한다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const payloadPath = (n) => join("payload", "workflows", "common", `PROJECT-COMMON-${n}.yaml`);
const dogfoodPath = (n) => join(".github", "workflows", `PROJECT-COMMON-${n}.yaml`);
const read = (p) => readFileSync(p, "utf8");
const bothCopies = (n) => [payloadPath(n), dogfoodPath(n)];

// 봇 커밋을 만드는 워크플로우 — 스크립트 실행이 남긴 __pycache__가 커밋에 섞이면 안 된다.
const COMMITTING = ["AUTO-CHANGELOG-CONTROL", "RELEASE-PUBLISH", "VERSION-CONTROL", "README-VERSION-UPDATE"];

for (const name of COMMITTING) {
  for (const path of bothCopies(name)) {
    test(`${path}: 최상위 env로 파이썬 바이트코드 생성을 끈다`, () => {
      assert.match(read(path), /^env:\n(?:  .*\n)*  PYTHONDONTWRITEBYTECODE: "1"/m);
    });

    test(`${path}: git add -A / git add . 로 작업트리 전체를 커밋하지 않는다`, () => {
      assert.ok(!/git add (-A|--all|\.)(\s|$)/m.test(read(path)), "추적 대상만 명시해 스테이징해야 한다");
    });
  }
}

test("npm 패키지 files에서 __pycache__와 pyc를 제외한다", () => {
  const files = JSON.parse(read("package.json")).files;
  assert.ok(files.includes("!**/__pycache__/"), "__pycache__ 제외 패턴이 없다");
  assert.ok(files.includes("!**/*.pyc"), "*.pyc 제외 패턴이 없다");
});

test("파이썬 테스트 런처는 바이트코드를 남기지 않는다", () => {
  assert.ok(read(join("scripts", "run-py-tests.mjs")).includes('PYTHONDONTWRITEBYTECODE: "1"'));
});

test("npm pack은 payload 아래 pyc를 싣지 않는다 (실측)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "paw-pack-"));
  try {
    const pkg = JSON.parse(read("package.json"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app", version: "0.0.0", files: pkg.files }));
    mkdirSync(join(dir, "payload", "scripts", "__pycache__"), { recursive: true });
    writeFileSync(join(dir, "payload", "scripts", "tool.py"), "print('ok')\n");
    writeFileSync(join(dir, "payload", "scripts", "__pycache__", "tool.cpython-312.pyc"), "x");
    const isWin = process.platform === "win32";
    const r = spawnSync(isWin ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: dir, encoding: "utf-8", shell: isWin,
    });
    if (r.error || r.status !== 0) {
      t.skip(`npm pack을 실행할 수 없음: ${r.error?.message || r.stderr}`);
      return;
    }
    const paths = JSON.parse(r.stdout)[0].files.map((f) => f.path);
    assert.ok(paths.includes("payload/scripts/tool.py"), `소스는 실려야 한다: ${paths}`);
    assert.ok(!paths.some((p) => p.includes("__pycache__") || p.endsWith(".pyc")), `pyc가 실렸다: ${paths}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 봇 토큰 push는 README 갱신을 깨우지 못한다 — PAT 없는 기본 설치에서도 README가 릴리스 버전을 따라가야 한다.
for (const path of bothCopies("RELEASE-PUBLISH")) {
  test(`${path}: 릴리스 발행 뒤 README-VERSION-UPDATE를 workflow_dispatch로 깨운다`, () => {
    const body = read(path);
    assert.match(body, /^permissions:[\s\S]*?^\s+actions:\s*write/m, "workflow_dispatch에는 actions: write가 필요하다");
    const idx = body.indexOf("- name: Trigger README-VERSION-UPDATE");
    assert.ok(idx > -1, "README 갱신 트리거 스텝이 없다");
    const step = body.slice(idx, idx + 1200);
    assert.ok(step.includes("steps.version.outputs.release_exists != 'true'"), "새로 발행한 릴리스에서만 깨워야 한다");
    assert.match(step, /gh workflow run PROJECT-COMMON-README-VERSION-UPDATE\.yaml --ref (\{\{MAIN_BRANCH\}\}|main)/);
    assert.ok(step.indexOf("GH_TOKEN: ${{ github.token }}") > -1, "기본 토큰으로도 동작해야 한다");
  });
}

// 태그 스냅샷의 README는 README 버전 커밋보다 앞서 있어 항상 한 버전 전이다.
test("NPM-PUBLISH는 패키징 전에 README 버전 줄을 배포 버전으로 맞춘다", () => {
  const body = read(join(".github", "workflows", "NPM-PUBLISH.yaml"));
  const fix = body.indexOf("- name: README 버전 줄을 배포 버전으로 맞춤");
  assert.ok(fix > -1, "README 버전 보정 스텝이 없다");
  assert.ok(fix > body.indexOf("uses: actions/checkout"), "체크아웃 뒤에 와야 한다");
  assert.ok(fix < body.indexOf("npm publish --dry-run"), "패키징(publish) 전에 와야 한다");
  const step = body.slice(fix, fix + 900);
  assert.ok(step.includes("AUTO-VERSION-SECTION"), "자동 버전 마커 다음 줄을 고쳐야 한다");
  assert.ok(step.includes("steps.target.outputs.version"), "배포 대상 버전을 써야 한다");
  assert.match(body, /^env:\n(?:  .*\n)*  PYTHONDONTWRITEBYTECODE: "1"/m, "배포 게이트 테스트가 pyc를 남기면 패키지에 실린다");
});

// ---------------------------------------------------------------
// 커밋 수집: 제목 한 줄 = 한 항목 형식을 지키면서 본문 BREAKING CHANGE 푸터도 승격 판정에 닿아야 한다.
// 워크플로우의 수집 줄을 그대로 뽑아 실제 git 레포에서 돌린다.
// ---------------------------------------------------------------
const COLLECTORS = ["AUTO-CHANGELOG-CONTROL", "AI-PR-SUMMARY", "RELEASE-PUBLISH"];

function collectLines(name) {
  return read(payloadPath(name))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("git log --pretty=%") && /> ?commits\.txt|>> commits\.txt/.test(l));
}

for (const name of COLLECTORS) {
  test(`${name}: 커밋 제목과 함께 본문 BREAKING CHANGE 푸터만 수집한다`, () => {
    const lines = collectLines(name);
    assert.ok(lines.some((l) => l.startsWith("git log --pretty=%s") && l.includes("> commits.txt")), "제목 수집 줄이 없다");
    const footer = lines.find((l) => l.includes(">> commits.txt"));
    assert.ok(footer, "본문 푸터 수집 줄이 없다");
    assert.ok(footer.startsWith("git log --pretty=%b"), "본문(%b)에서 뽑아야 한다");
    assert.ok(footer.includes("grep -E '^BREAKING[ -]CHANGE[[:space:]]*:'"), "푸터 줄만 걸러야 한다");
    assert.ok(footer.endsWith("|| true"), "푸터가 없을 때 grep 종료 코드로 스텝이 실패하면 안 된다");
  });
}

function findPython() {
  for (const cmd of ["python3", "python"]) {
    const r = spawnSync(cmd, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf-8", input: "" });
    if (r.status === 0 && r.stdout.trim() === "3") return cmd;
  }
  return null;
}

test("수집 결과를 classify-bump에 넣으면 본문 푸터 커밋이 major가 되고 다른 본문 줄은 섞이지 않는다", (t) => {
  if (process.platform === "win32") {
    t.skip("워크플로우 셸 조각은 ubuntu 러너용 bash 전제");
    return;
  }
  const python = findPython();
  if (!python) {
    t.skip("python3 없음");
    return;
  }
  const scriptPath = join(process.cwd(), "payload", "scripts", "changelog_manager.py");
  const dir = mkdtempSync(join(tmpdir(), "paw-collect-"));
  const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf-8", env });
    assert.strictEqual(r.status, 0, r.stderr);
  };
  try {
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "chore: init");
    git("branch", "base");
    git("commit", "-q", "--allow-empty", "-m", "fix: 로그인 오류 수정", "-m", "원인 설명 한 줄");
    git("commit", "-q", "--allow-empty", "-m", "feat: 인증 API 교체", "-m", "BREAKING CHANGE: 토큰 형식이 바뀝니다");
    const snippet = collectLines("AUTO-CHANGELOG-CONTROL").map((l) => l.replaceAll("origin/{{MAIN_BRANCH}}", "base")).join("\n");
    const r = spawnSync("bash", ["-e", "-c", snippet], { cwd: dir, encoding: "utf-8", env });
    assert.strictEqual(r.status, 0, r.stderr);
    const collected = readFileSync(join(dir, "commits.txt"), "utf-8").split("\n").filter(Boolean);
    assert.deepStrictEqual(collected, ["feat: 인증 API 교체", "fix: 로그인 오류 수정", "BREAKING CHANGE: 토큰 형식이 바뀝니다"]);

    const bump = spawnSync(python, [scriptPath, "classify-bump", "--commits-file", "commits.txt"], {
      cwd: dir, encoding: "utf-8", env: { ...env, AI_API_KEY: "", COPILOT_AI: "false" },
    });
    assert.strictEqual(bump.status, 0, bump.stderr);
    assert.strictEqual(bump.stdout.trim().split("\n").pop(), "major");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// fallback 사유가 잡 로그에만 있으면 PR 댓글만 보는 사용자는 원인을 알 수 없다.
for (const name of ["AI-PR-SUMMARY", "AUTO-CHANGELOG-CONTROL"]) {
  for (const path of bothCopies(name)) {
    test(`${path}: engine 줄과 실행 요약에 fallback 사유를 붙인다`, () => {
      const body = read(path);
      assert.ok(body.includes('.get("fallback_reason")'), "결과 JSON의 fallback_reason을 읽어야 한다");
      assert.ok(body.includes("html.escape("), "댓글 HTML에 들어가므로 이스케이프해야 한다");
      assert.ok(body.includes('echo "engine: $ENGINE_LINE" >> "$GITHUB_STEP_SUMMARY"'), "실행 요약에도 남겨야 한다");
      assert.match(body, /<sub>engine: \$\{ENGINE[^}]*\}\$\{FALLBACK_REASON:\+ \(\$FALLBACK_REASON\)\}<\/sub>|<sub>engine: \$\{ENGINE_LINE\}<\/sub>/, "PR 댓글 engine 줄에 사유가 붙어야 한다");
    });
  }
}
