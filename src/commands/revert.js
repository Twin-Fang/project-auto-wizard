// revert 모드 — payload 유래 파일 + 마커로 식별되는 파일을 제거 (DESIGN-SPEC §4 되돌리기).
// 원칙: (a) 현재 payload에 존재하는 파일명과 정확히 일치하는 것, (b) 설치된 워크플로우 파일 중
// 마법사 관리 마커(MANAGED_WORKFLOW_MARKER)로 시작하는 것 — 이 둘의 합집합을 제거 대상으로 삼는다.
// (a)만으로는 과거 버전에서 설치된 뒤 이후 릴리스에서 payload 파일명이 바뀌거나 삭제된 파일을
// 인식하지 못했다 (issue #20 L12 원래 버그). 반대로 (b)만으로는 이 수정 이전에 설치되어 마커가
// 없는(그러나 파일명은 여전히 현재 payload와 일치하는) 기존 설치 전체를 인식하지 못하는 회귀가
// 생긴다 — 그래서 두 방식을 합집합으로 병행한다. 마커는 이 수정 이후 배포되는 payload 템플릿부터
// 포함되므로, (b) 경로가 실제로 새로 잡아내는 것은 "이름이 바뀌거나 삭제된, 마커가 있는" 파일뿐이다.
// 사용자가 직접 만든 워크플로우·version.yml·README·.gitignore는 건드리지 않는다
// (version.yml은 사용자 버전 데이터 — 제거 대상이 아니라 산출물이다).
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { PATHS, PAYLOAD } from "../core/paths.js";
import { remove } from "../core/fsutil.js";

// payload/workflows/**/*.yaml 첫 줄에 심어둔 고정 마커 — 이 값이 바뀌면 과거 설치분과의 매칭이 끊긴다.
export const MANAGED_WORKFLOW_MARKER = "# project-auto-wizard:managed-workflow";

// payload/workflows/** 전체(하위 폴더 포함)의 yaml 파일명 집합.
function payloadWorkflowNames(payloadRoot) {
  const names = new Set();
  const root = join(payloadRoot, PAYLOAD.workflowsDir);
  if (!existsSync(root)) return names;
  for (const e of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && /\.(ya?ml)$/.test(e.name)) names.add(e.name);
  }
  return names;
}

// 설치된 워크플로우 디렉토리(평면 구조)에서 관리 마커로 시작하는 파일명 집합.
// .bak/.template.yaml 백업본도 원본 텍스트를 그대로 복사한 것이라 마커를 그대로 갖고 있어
// 확장자나 파일명 유추 없이 동일한 방식으로 인식된다 (issue #20 L12).
function markedWorkflowNames(wfDir) {
  const names = new Set();
  if (!existsSync(wfDir)) return names;
  for (const entry of readdirSync(wfDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const firstLine = readFileSync(join(wfDir, entry.name), "utf8").split("\n", 1)[0].replace(/\r$/, "");
    if (firstLine === MANAGED_WORKFLOW_MARKER) names.add(entry.name);
  }
  return names;
}

// 아무것도 지우지 않는 순수 함수 — --dry-run과 status류 기능에서 재사용.
export function planRevert(payloadRoot, targetRoot = ".") {
  const removedWf = new Set();
  const removedScripts = [];
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  if (existsSync(wfDir)) {
    // (a) 현재 payload와 파일명이 일치하는 것 — 기존 동작 그대로(마커 유무 무관, 기존 설치 회귀 방지).
    for (const name of payloadWorkflowNames(payloadRoot)) {
      const p = join(wfDir, name);
      if (existsSync(p)) removedWf.add(name);
      const templateName = (name.endsWith(".yaml") ? name.slice(0, -".yaml".length) : name) + ".template.yaml";
      if (existsSync(join(wfDir, templateName))) removedWf.add(templateName);
      if (existsSync(p + ".bak")) removedWf.add(name + ".bak");
    }
    // (b) 관리 마커로 시작하는 것 — payload에서 이름이 바뀌거나 삭제된 파일도 인식 (issue #20 L12).
    for (const name of markedWorkflowNames(wfDir)) removedWf.add(name);
  }
  for (const s of ["version_manager.py", "changelog_manager.py"]) {
    if (existsSync(join(targetRoot, PATHS.scriptsDir, s))) removedScripts.push(s);
  }
  return { workflows: [...removedWf], scripts: removedScripts };
}

// 반환: { workflows: [...제거된 파일명], scripts: [...] } — planRevert와 동일한 형태.
export function runRevert(context, payloadRoot, targetRoot = ".") {
  const plan = planRevert(payloadRoot, targetRoot);
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  for (const name of plan.workflows) remove(join(wfDir, name));
  for (const name of plan.scripts) remove(join(targetRoot, PATHS.scriptsDir, name));
  return plan;
}
