// tests/node/dogfood-parity.test.js
// 이 레포의 .github/ 사본이 payload 원본 + 선언된 PATCHES와 정확히 같은지 확인한다.
// payload만 고치고 사본 동기화를 잊으면(또는 사본만 손으로 고치면) 여기서 걸린다.
import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildExpected, findDrift, PATCHES, REPO_BRANCHES, SCRIPTS } from "../../scripts/sync-dogfood.mjs";

// 비교에 필요한 디렉터리만 복사한 임시 레포 — 실제 사본을 건드리지 않고 드리프트를 흉내 낸다.
function withRepoCopy(fn) {
  const dir = mkdtempSync(join(tmpdir(), "paw-dogfood-"));
  try {
    for (const rel of ["payload/workflows/common", "payload/scripts", ".github/workflows", ".github/scripts"]) {
      cpSync(rel, join(dir, rel), { recursive: true });
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("sync-dogfood --check: 현재 .github/ 사본은 payload와 일치한다", () => {
  const r = spawnSync(process.execPath, ["scripts/sync-dogfood.mjs", "--check"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `드리프트 발견 — npm run sync:dogfood 로 맞추세요\n${r.stderr}`);
});

test("공통 워크플로우 전부와 스크립트 사본이 비교 대상에 들어 있다", () => {
  const rels = buildExpected().map((e) => e.rel);
  const common = readdirSync(join("payload", "workflows", "common")).filter((f) => f.endsWith(".yaml"));
  assert.ok(common.length >= 6, `공통 워크플로우가 너무 적다: ${common}`);
  for (const f of common) assert.ok(rels.includes(`workflows/${f}`), f);
  // 사본 디렉터리에 있는데 비교에서 빠진 파일이 없어야 한다 (한쪽만 남은 사본 방지)
  for (const f of readdirSync(join(".github", "workflows")).filter((n) => n.startsWith("PROJECT-COMMON-"))) {
    assert.ok(rels.includes(`workflows/${f}`), `payload에 없는 공통 워크플로우 사본: ${f}`);
  }
  for (const f of readdirSync(join(".github", "scripts")).filter((n) => n.endsWith(".py"))) {
    assert.ok(SCRIPTS.includes(f), `비교 대상에 없는 스크립트 사본: ${f}`);
  }
});

test("REPO_BRANCHES는 version.yml의 브랜치 구성과 같다", () => {
  const yml = readFileSync("version.yml", "utf8");
  assert.match(yml, new RegExp(`^\\s+main: "${REPO_BRANCHES.main}"`, "m"));
  assert.match(yml, new RegExp(`^\\s+develop: "${REPO_BRANCHES.develop}"`, "m"));
});

test("의도된 차이는 ISSUE-HELPER 값과 RELEASE-PUBLISH의 NPM-PUBLISH 스텝뿐이다", () => {
  assert.deepStrictEqual(
    [...new Set(PATCHES.map((p) => p.file))].sort(),
    ["workflows/PROJECT-COMMON-ISSUE-HELPER.yaml", "workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml"],
  );
  for (const p of PATCHES) assert.ok(p.reason, `${p.file}: 차이의 이유를 적어야 한다`);
});

test("사본 한 줄만 달라도 드리프트로 잡는다", () => {
  withRepoCopy((dir) => {
    assert.deepStrictEqual(findDrift(dir), []);
    const wf = join(dir, ".github", "workflows", "PROJECT-COMMON-VERSION-CONTROL.yaml");
    writeFileSync(wf, readFileSync(wf, "utf8").replace('branches: ["main"]', 'branches: ["master"]'));
    const script = join(dir, ".github", "scripts", "version_manager.py");
    writeFileSync(script, readFileSync(script, "utf8") + "\n# 로컬 수정\n");
    assert.deepStrictEqual(
      findDrift(dir).map((e) => e.rel).sort(),
      ["scripts/version_manager.py", "workflows/PROJECT-COMMON-VERSION-CONTROL.yaml"],
    );
  });
});

test("사본이 없거나 payload에만 바뀐 내용이 있어도 드리프트로 잡는다", () => {
  withRepoCopy((dir) => {
    unlinkSync(join(dir, ".github", "workflows", "PROJECT-COMMON-AI-PR-SUMMARY.yaml"));
    const src = join(dir, "payload", "scripts", "issue_helper.py");
    writeFileSync(src, readFileSync(src, "utf8") + "\n# payload 변경\n");
    assert.deepStrictEqual(
      findDrift(dir).map((e) => e.rel).sort(),
      ["scripts/issue_helper.py", "workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml"],
    );
  });
});

test("payload가 바뀌어 패치 기준 문구가 사라지면 조용히 넘어가지 않고 실패한다", () => {
  withRepoCopy((dir) => {
    const src = join(dir, "payload", "workflows", "common", "PROJECT-COMMON-ISSUE-HELPER.yaml");
    writeFileSync(src, readFileSync(src, "utf8").replace('ISSUE_HELPER_CREATE_BRANCH: "false"', 'ISSUE_HELPER_CREATE_BRANCH: "no"'));
    assert.throws(() => buildExpected(dir), /패치 기준 문구/);
  });
});

// 링크가 낀 경로로 실행하면 argv[1]이 실제 경로와 달라 main()이 건너뛰어지던 회귀를 막는다.
test("sync-dogfood --check: 심볼릭 링크 경로로 실행해도 드리프트를 잡아 exit 1", (t) => {
  withRepoCopy((dir) => {
    // 스크립트는 자기 위치 기준으로 루트를 잡으므로 실행에 필요한 파일도 함께 복사한다
    for (const rel of ["scripts", "src", "package.json"]) cpSync(rel, join(dir, rel), { recursive: true });
    const wf = join(dir, ".github", "workflows", "PROJECT-COMMON-VERSION-CONTROL.yaml");
    writeFileSync(wf, readFileSync(wf, "utf8") + "\n# 로컬 수정\n");

    const link = `${dir}-link`;
    try {
      symlinkSync(dir, link, "dir");
    } catch (e) {
      t.skip(`심볼릭 링크를 만들 수 없음: ${e.code}`);
      return;
    }
    try {
      const r = spawnSync(process.execPath, [join(link, "scripts", "sync-dogfood.mjs"), "--check"], { encoding: "utf8" });
      assert.strictEqual(r.status, 1, `링크 경로에서 검사가 건너뛰어졌다\n${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /dogfood 불일치/);
    } finally {
      unlinkSync(link);
    }
  });
});
