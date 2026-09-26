// tests/node/ci-gate-payload.test.js
// CI 워크플로우는 항상 실행하되 첫 job `changes`가 이 프로젝트 경로의 변경 여부를 판별하고,
// 나머지 job은 그 결과로 건너뛴다(건너뛴 job은 Success). 항상 실행되는 `ci-gate` 하나만 required check로
// 등록하면 되도록 job 결과를 집계한다. 이 파일은 그 골격이 payload에서 깨지지 않게 고정한다.
//
// YAML 파서 의존성을 추가하지 않는다 — payload-yaml.test.js처럼 들여쓰기 기반 줄 단위 검사를 쓰고,
// 문법·표현식·액션 입력 오류는 actionlint(PATH에 있을 때만)에 맡긴다.
import { test, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeSrcText } from "../../src/core/copy/workflows.js";
import { substituteEnv } from "../../src/core/wizard-env.js";
import { makeResolvers } from "../../src/core/detect-fs.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOWS_DIR = join(REPO_ROOT, "payload", "workflows");
const BRANCHES = { main: "main", develop: "develop" };
const MONOREPO_PATH = "services/api";

// jobs: 기존 job id 전부 — ci-gate가 needs로 걸어야 하는 대상이다. job이 늘면 여기도 늘려야 통과한다.
const CI_TARGETS = [
  { file: "go/PROJECT-GO-CI.yaml", type: "go", jobs: ["build-check"] },
  { file: "next/PROJECT-NEXT-CI.yaml", type: "next", jobs: ["build"] },
  { file: "python/PROJECT-PYTHON-CI.yaml", type: "python", jobs: ["build-check"] },
  { file: "react/PROJECT-REACT-CI.yaml", type: "react", jobs: ["build"] },
  { file: "spring/PROJECT-SPRING-CI.yml", type: "spring", jobs: ["build-check"] },
];

const EXPECTED_JOB_IF =
  "${{ github.event_name == 'workflow_dispatch' || needs.changes.outputs.project == 'true' }}";
const EXPECTED_FILTER_LINE =
  "- '${{ env.PROJECT_PATH == '.' && '**' || format('{0}/**', env.PROJECT_PATH) }}'";
const PROJECT_PATH_MARKER_LINE = '  PROJECT_PATH: "."  # @wizard auto:project-path';

// jdk 리졸버가 읽을 빈 디렉토리 — 이 레포의 build.gradle 유무에 결과가 흔들리지 않게 한다.
const EMPTY_ROOT = mkdtempSync(join(tmpdir(), "paw-ci-gate-root-"));
after(() => rmSync(EMPTY_ROOT, { recursive: true, force: true }));

// 설치 시 실제로 일어나는 치환을 그대로 재현한다 (copy/workflows.js의 makeSrcText + envOptsFor와 같은 인자).
function renderInstalled(file, type, paths = new Map()) {
  const src = makeSrcText(BRANCHES)(join(WORKFLOWS_DIR, file));
  return substituteEnv(src, {
    type,
    repoName: "demo-repo",
    projectPath: paths.get(type) || ".",
    resolvers: makeResolvers(EMPTY_ROOT, "demo-repo", paths),
  });
}

const rawText = (file) => readFileSync(join(WORKFLOWS_DIR, file), "utf8");

// ── 줄 단위 구조 헬퍼 ──────────────────────────────────────────────────────────

// 들여쓰기 0의 `key:` 다음 줄부터 다음 최상위 키 전까지 (주석·빈 줄 포함).
function topLevelBlock(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`${key}:`));
  assert.ok(start >= 0, `최상위 '${key}:'가 없습니다`);
  const end = lines.findIndex((l, i) => i > start && /^[A-Za-z_]/.test(l));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

// jobs 블록 → Map<jobId, 그 job의 줄들>. job id는 들여쓰기 2칸의 `id:` 줄이다.
function parseJobs(text) {
  const jobs = new Map();
  let current = null;
  for (const line of topLevelBlock(text, "jobs")) {
    const header = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (header) {
      current = [];
      jobs.set(header[1], current);
    } else if (current) {
      current.push(line);
    }
  }
  return jobs;
}

// job 직속 키(들여쓰기 4칸) 값. 스텝은 `- ` 로 시작하고 더 깊게 들여쓰므로 섞이지 않는다.
function jobField(jobLines, key) {
  const prefix = `    ${key}:`;
  const line = jobLines.find((l) => l.startsWith(prefix));
  return line === undefined ? undefined : line.slice(prefix.length).trim();
}

// `[a, b, c]` → ["a","b","c"]
const parseFlowList = (value) => value.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);

// ── 구조 검증 ─────────────────────────────────────────────────────────────────

for (const { file, type, jobs } of CI_TARGETS) {
  const text = rawText(file);

  test(`${file}: job 구성은 changes + 기존 job + ci-gate 뿐이다`, () => {
    assert.deepStrictEqual([...parseJobs(text).keys()].sort(), ["changes", ...jobs, "ci-gate"].sort());
  });

  test(`${file}: 기존 job은 changes에 의존하고 변경 없음이면 건너뛴다 (workflow_dispatch는 항상 실행)`, () => {
    const parsed = parseJobs(text);
    for (const id of jobs) {
      assert.strictEqual(jobField(parsed.get(id), "needs"), "changes", `${id}: needs`);
      assert.strictEqual(jobField(parsed.get(id), "if"), EXPECTED_JOB_IF, `${id}: if`);
    }
  });

  test(`${file}: changes job은 dorny/paths-filter로 PROJECT_PATH 하위 변경만 판별한다`, () => {
    const changes = parseJobs(text).get("changes");
    const body = changes.join("\n");
    assert.match(body, /uses: dorny\/paths-filter@v4/);
    assert.match(body, /^ {8}if: \$\{\{ github\.event_name != 'workflow_dispatch' \}\}$/m, "workflow_dispatch에서는 판별 스텝을 건너뛴다");
    assert.match(body, /^ {6}contents: read$/m);
    assert.match(body, /^ {6}pull-requests: read$/m);
    assert.match(body, /^ {6}project: \$\{\{ steps\.filter\.outputs\.project \}\}$/m);
    assert.ok(changes.some((l) => l.trim() === EXPECTED_FILTER_LINE), "필터 표현식이 계약과 다릅니다");
  });

  test(`${file}: ci-gate는 항상 실행되고 모든 job을 needs로 집계한다`, () => {
    const gate = parseJobs(text).get("ci-gate");
    assert.strictEqual(jobField(gate, "if"), "${{ always() }}");
    assert.deepStrictEqual(parseFlowList(jobField(gate, "needs")).sort(), ["changes", ...jobs].sort());
    const body = gate.join("\n");
    assert.match(body, /RESULTS: \$\{\{ toJSON\(needs\.\*\.result\) \}\}/);
    assert.match(body, /grep -Eq '"\(failure\|cancelled\)"'/);
    assert.match(body, /^ {12}exit 1$/m);
  });

  test(`${file}: PROJECT_PATH는 단일 최상위 env 블록에 auto:project-path 마커로 선언된다`, () => {
    assert.strictEqual((text.match(/^env:/gm) || []).length, 1, "최상위 env:가 하나여야 합니다");
    assert.ok(topLevelBlock(text, "env").includes(PROJECT_PATH_MARKER_LINE), "PROJECT_PATH 마커 줄이 env 블록에 없습니다");
  });

  test(`${file}: --paths가 있으면 PROJECT_PATH가 그 경로로, 없으면 '.'로 치환되고 마커가 사라진다`, () => {
    const monorepo = renderInstalled(file, type, new Map([[type, MONOREPO_PATH]]));
    assert.ok(topLevelBlock(monorepo, "env").includes(`  PROJECT_PATH: "${MONOREPO_PATH}"`));
    assert.ok(!monorepo.includes("auto:project-path"));
    assert.ok(monorepo.includes("env.PROJECT_PATH"), "changes 필터의 env 참조는 그대로여야 합니다");

    const single = renderInstalled(file, type);
    assert.ok(topLevelBlock(single, "env").includes('  PROJECT_PATH: "."'));
    assert.ok(!single.includes("auto:project-path"));
  });
}

// ── actionlint ────────────────────────────────────────────────────────────────
// 원본에는 `{{MAIN_BRANCH}}` 플레이스홀더와 `@wizard` 마커가 있어 그대로 검사하기 부적절하므로,
// 설치 때와 같은 치환(renderInstalled)을 거친 임시 사본을 검사한다.
//
// 기준선(2026-09-21, actionlint 1.7.12): 원본 CI·publish 워크플로우에는 구문·표현식·액션 입력 오류가 0건이고
// shellcheck 지적(SC2086 info, SC2129 style, SC2193 warning)만 기존부터 있다(Next 4, React 4, Spring CI 35,
// Spring publish 2종 각 2). 그 지적은 이 이슈 범위 밖이라 허용하고, 새로 생긴 것만 실패로 본다:
//   ① shellcheck 이외 종류의 지적은 위치와 관계없이 전부 실패 (needs 오타, 표현식 오류, 알 수 없는 액션 입력 등)
//   ② shellcheck 지적은 이 이슈가 새로 넣은 job(changes, ci-gate) 안에서만 실패
// shellcheck 버전에 따라 기존 지적 수가 달라져도 흔들리지 않도록 개수가 아니라 위치로 가른다.
const ACTIONLINT_AVAILABLE = spawnSync("actionlint", ["-version"], { encoding: "utf8" }).status === 0;
const SKIP_ACTIONLINT = ACTIONLINT_AVAILABLE ? false : "actionlint가 PATH에 없어 건너뜁니다";

// 렌더된 텍스트에서 job id → 시작 줄(1부터). finding의 줄이 어느 job에 속하는지 가르는 데 쓴다.
function jobStartLines(text) {
  const starts = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const header = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (header) starts.push({ id: header[1], line: i + 1 });
  });
  return starts;
}

function jobOfLine(starts, line) {
  return starts.filter((s) => s.line <= line).at(-1)?.id ?? null;
}

// 렌더된 워크플로우를 actionlint로 검사해 "새로 생긴 것으로 간주할 지적" 목록을 돌려준다.
function actionlintNewFindings(renderedText, fileName, newJobIds) {
  const dir = mkdtempSync(join(tmpdir(), "paw-actionlint-"));
  try {
    const target = join(dir, fileName);
    writeFileSync(target, renderedText);
    const result = spawnSync("actionlint", ["-no-color", "-format", "{{json .}}", target], { encoding: "utf8" });
    // 0=지적 없음, 1=지적 있음, 그 외는 실행 자체가 실패한 것
    assert.ok(result.status === 0 || result.status === 1, `actionlint 실행 실패: ${result.stderr}`);
    const findings = JSON.parse(result.stdout.trim() || "[]") ?? [];
    const starts = jobStartLines(renderedText);
    return findings
      .filter((f) => f.kind !== "shellcheck" || newJobIds.includes(jobOfLine(starts, f.line)))
      .map((f) => `${fileName}:${f.line}:${f.column} [${f.kind}] ${f.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const { file, type } of CI_TARGETS) {
  const fileName = file.split("/").pop();
  for (const [label, paths] of [["단일 레포", new Map()], ["모노레포", new Map([[type, MONOREPO_PATH]])]]) {
    test(`${file}: 치환된 사본이 actionlint를 통과한다 (${label}, 신규 지적 0건)`, { skip: SKIP_ACTIONLINT }, () => {
      const findings = actionlintNewFindings(renderInstalled(file, type, paths), fileName, ["changes", "ci-gate"]);
      assert.deepStrictEqual(findings, [], `actionlint 신규 지적:\n  ${findings.join("\n  ")}`);
    });
  }
}

test("actionlint 헬퍼는 존재하지 않는 job을 needs로 걸면 지적을 잡아낸다 (헬퍼가 공회전하지 않는다는 증거)", { skip: SKIP_ACTIONLINT }, () => {
  const { file, type } = CI_TARGETS[0];
  const broken = renderInstalled(file, type).replace("needs: [changes, build-check]", "needs: [changes, no-such-job]");
  assert.notStrictEqual(broken, renderInstalled(file, type), "치환 대상 줄을 찾지 못했습니다");
  assert.ok(actionlintNewFindings(broken, "broken.yaml", ["changes", "ci-gate"]).length > 0);
});
