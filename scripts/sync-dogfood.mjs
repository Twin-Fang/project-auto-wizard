// payload/ 공통 워크플로우·스크립트로 이 레포 자신의 .github/ 사본을 다시 만든다.
//
//   node scripts/sync-dogfood.mjs          # .github/ 사본을 payload 기준으로 덮어쓴다
//   node scripts/sync-dogfood.mjs --check  # 쓰지 않고 비교만 — 어긋나면 exit 1
//
// 사본 = payload 원본 → 브랜치 플레이스홀더 치환(설치기와 같은 substitute) → PATCHES 적용.
// 사본에만 있어야 하는 차이는 반드시 PATCHES에 선언한다. 사본을 손으로 고치면 --check가 잡는다.
// 설치기와 마찬가지로 외부 의존성 없이 node:* 내장 모듈만 쓴다.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { substitute } from "../src/core/branding.js";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 이 레포의 브랜치 구성 — version.yml의 metadata.template.branches와 같아야 한다.
export const REPO_BRANCHES = { main: "main", develop: "develop" };

// 이 레포 워크플로우가 호출하는 스크립트만 둔다.
// truncate_release_notes.py는 Flutter 워크플로우 전용이라 사본이 없다.
export const SCRIPTS = ["changelog_manager.py", "issue_helper.py", "version_manager.py"];

// 사본에만 있는 의도된 차이. 치환된 payload 텍스트에서 from이 정확히 한 번 나와야 한다 —
// payload가 바뀌어 기준 문구가 사라지면 조용히 넘어가지 않고 실패시켜 목록을 갱신하게 한다.
export const PATCHES = [
  {
    file: "workflows/PROJECT-COMMON-ISSUE-HELPER.yaml",
    reason: "이 레포는 이슈 브랜치를 자동 생성하고 develop에서 딴다",
    from:
      '      ISSUE_HELPER_CREATE_BRANCH: "false" # @wizard ask:false\n' +
      '      ISSUE_HELPER_BASE_BRANCH: "main"\n',
    to:
      '      ISSUE_HELPER_CREATE_BRANCH: "true" # @wizard ask:false\n' +
      '      ISSUE_HELPER_BASE_BRANCH: "develop"\n',
  },
  {
    file: "workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml",
    reason: "헤더 주석을 사본 관점으로 바꾼다",
    from:
      "# This file and its self-copy (.github/workflows/) intentionally\n" +
      "# differ by one step — the self-copy also triggers NPM-PUBLISH via\n" +
      "# workflow_dispatch right after the release is created. NPM-PUBLISH.yaml is\n" +
      "# a repo-only workflow (not shipped in payload), so wiring that dispatch\n" +
      "# here would make every wizard-installed repo call a workflow that doesn't\n" +
      "# exist for them on every release.\n",
    to:
      "# Right after the GitHub Release is created, this self-copy\n" +
      "# (unlike the payload template) also triggers NPM-PUBLISH via\n" +
      "# workflow_dispatch, since NPM-PUBLISH.yaml is a repo-only workflow that\n" +
      "# doesn't exist in payload — see PROJECT-COMMON-RELEASE-PUBLISH.yaml in\n" +
      "# payload/workflows/common for why that file intentionally omits this step.\n",
  },
  {
    file: "workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml",
    reason: "npm 배포는 이 레포 전용 NPM-PUBLISH 워크플로우가 맡는다",
    from:
      '          echo "GitHub Release v$VERSION published"\n' +
      "\n" +
      "      - name: Trigger README-VERSION-UPDATE\n",
    to:
      '          echo "GitHub Release v$VERSION published"\n' +
      "\n" +
      "      - name: Trigger NPM-PUBLISH\n" +
      "        if: steps.gate.outputs.proceed == 'true' && steps.version.outputs.release_exists != 'true'\n" +
      "        continue-on-error: true\n" +
      "        env:\n" +
      "          GH_TOKEN: ${{ github.token }}\n" +
      "        run: |\n" +
      '          VERSION="${{ steps.version.outputs.version }}"\n' +
      '          gh workflow run NPM-PUBLISH.yaml --ref main -f tag="v${VERSION}"\n' +
      '          echo "NPM-PUBLISH workflow_dispatch 트리거 요청 완료 (WORKFLOW_PAT 없이도 동작)"\n' +
      "\n" +
      "      - name: Trigger README-VERSION-UPDATE\n",
  },
];

function countOccurrences(text, needle) {
  let count = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) count++;
  return count;
}

// 기대 사본 목록 [{ rel, source, expected }]. rel은 .github/ 기준 경로.
// 패치 기준 문구를 못 찾으면 throw — 사본을 추측으로 만들지 않는다.
export function buildExpected(root = DEFAULT_ROOT) {
  const commonDir = join(root, "payload", "workflows", "common");
  const entries = [];
  // 공통 워크플로우는 디렉터리를 그대로 훑어 새로 추가된 파일도 빠짐없이 대상에 넣는다
  for (const name of readdirSync(commonDir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const source = join("payload", "workflows", "common", name);
    entries.push({ rel: `workflows/${name}`, source, expected: substitute(readFileSync(join(root, source), "utf8"), REPO_BRANCHES) });
  }
  for (const name of SCRIPTS) {
    const source = join("payload", "scripts", name);
    entries.push({ rel: `scripts/${name}`, source, expected: readFileSync(join(root, source), "utf8") });
  }

  for (const patch of PATCHES) {
    const entry = entries.find((e) => e.rel === patch.file);
    if (!entry) throw new Error(`패치 대상이 payload에 없습니다: ${patch.file}`);
    const n = countOccurrences(entry.expected, patch.from);
    if (n !== 1) {
      throw new Error(`패치 기준 문구가 ${patch.file}에서 ${n}번 발견됐습니다 (정확히 1번이어야 함) — PATCHES를 갱신하세요: ${patch.reason}`);
    }
    entry.expected = entry.expected.replace(patch.from, () => patch.to);
  }
  return entries;
}

// 실제 .github/ 사본과 비교해 어긋난 항목만 돌려준다.
export function findDrift(root = DEFAULT_ROOT) {
  return buildExpected(root).filter(({ rel, expected }) => {
    const target = join(root, ".github", rel);
    return !existsSync(target) || readFileSync(target, "utf8") !== expected;
  });
}

// 어긋난 첫 줄 번호 — 긴 워크플로우에서 어디부터 달라졌는지 바로 보이게 한다.
function firstDiffLine(actual, expected) {
  const a = actual.split("\n");
  const e = expected.split("\n");
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    if (a[i] !== e[i]) return i + 1;
  }
  return 0;
}

function main(argv) {
  const check = argv.includes("--check");
  const root = DEFAULT_ROOT;
  const drift = findDrift(root);

  if (check) {
    if (drift.length === 0) {
      console.log("dogfood: .github/ 사본이 payload와 일치합니다");
      return 0;
    }
    for (const { rel, source, expected } of drift) {
      const target = join(root, ".github", rel);
      const where = existsSync(target) ? `${firstDiffLine(readFileSync(target, "utf8"), expected)}번째 줄부터 다름` : "사본 없음";
      console.error(`dogfood 불일치: .github/${rel} (${where}, 원본 ${source})`);
    }
    console.error("npm run sync:dogfood 로 사본을 다시 만들고, 사본에만 필요한 차이는 scripts/sync-dogfood.mjs의 PATCHES에 선언하세요.");
    return 1;
  }

  for (const { rel, expected } of drift) {
    const target = join(root, ".github", rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, expected);
    console.log(`dogfood 갱신: .github/${rel}`);
  }
  if (drift.length === 0) console.log("dogfood: 갱신할 사본이 없습니다");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
