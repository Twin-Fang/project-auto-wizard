// 브랜치 구성 (DESIGN-SPEC §4 신규 질문 ①).
// on: push: branches: 는 YAML 정적 값 — 마법사가 릴리스/개발 브랜치를 물어(또는 플래그로 받아)
// {{MAIN_BRANCH}}/{{DEVELOP_BRANCH}} 플레이스홀더를 치환한다 (치환 자체는 branding.js — Task 14).
// main === develop 이면 trunk-based 모드 → RELEASE-PUBLISH 단독 설치 (설치 매트릭스는 Task 16).
import { execFile } from "node:child_process";

// 기본 exec — git 명령 실행. 반환 {code, stdout, stderr}. 테스트는 mock 주입.
function defaultExec(cmd, args, { cwd } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// 감지: 로컬 git에서 원격 브랜치 목록 (네트워크 없이 — 로컬이 아는 origin/* 기준).
// git이 없거나 레포가 아니면 빈 목록 (질문 기본값 경로로 폴백).
export async function detectRemoteBranches(cwd, exec = defaultExec) {
  const r = await exec("git", ["branch", "-r", "--format=%(refname:short)"], { cwd });
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes("->")) // "origin/HEAD -> origin/main" 제외
    .map((s) => s.replace(/^origin\//, ""))
    .filter((s, i, a) => a.indexOf(s) === i);
}

// 결정 (순수 함수): 플래그/답변 → 최종 구성.
// 우선순위: 명시값(mainBranch/developBranch) → 감지 default → 하드 폴백(main/develop).
export function resolveBranchConfig({ mainBranch = "", developBranch = "", defaultBranch = "" } = {}) {
  const main = mainBranch || defaultBranch || "main";
  const develop = developBranch || "develop";
  return { main, develop, mode: main === develop ? "trunk-based" : "pr-flow" };
}

// 생성: develop이 원격에 없으면 현 HEAD 기준으로 생성 + push.
// confirm: async(message)→bool — 대화형 확인 질문. null이면(--force) 질문 없이 자동 생성.
// exec 주입 가능 (테스트 mock). 반환 { created, pushed?, skipped? }.
export async function ensureDevelopBranch({ develop, remoteBranches = [], confirm = null, cwd, exec = defaultExec, log = null }) {
  if (remoteBranches.includes(develop)) return { created: false };

  if (confirm) {
    const ok = await confirm(`원격에 '${develop}' 브랜치가 없습니다. 현재 HEAD 기준으로 생성하고 push할까요?`);
    if (ok !== true) return { created: false, skipped: true };
  }

  const br = await exec("git", ["branch", develop], { cwd });
  if (br.code !== 0) {
    // 이미 로컬에 존재하는 경우 등 — push만 시도
    log?.(`'${develop}' 로컬 브랜치 생성 생략 (${(br.stderr || "").trim() || "이미 존재"})`);
  }
  const push = await exec("git", ["push", "-u", "origin", develop], { cwd });
  if (push.code !== 0) {
    log?.(`⚠️  '${develop}' 브랜치 push 실패 — 원격 설정을 확인한 뒤 수동으로 push하세요 (git push -u origin ${develop})`);
    return { created: true, pushed: false };
  }
  log?.(`'${develop}' 브랜치를 생성하고 push했습니다.`);
  return { created: true, pushed: true };
}
