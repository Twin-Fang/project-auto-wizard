// uninstall 모드 — 마법사가 설치한 파일(planRemoval 판별분)에 더해 README/.gitignore/version.yml까지
// 선택적으로 제거한다. 대화형 체크리스트 또는 --force + --purge-* 로 항목별 opt-in.
// core/removal-plan.js는 읽기 전용으로만 재사용한다(아무것도 지우지 않는 순수 함수).
import { join } from "node:path";
import { existsSync } from "node:fs";
import { PATHS } from "../core/paths.js";
import { remove } from "../core/fsutil.js";
import { planRemoval } from "../core/removal-plan.js";
import { removeVersionSectionFromReadme, hasVersionSection } from "../core/copy/readme.js";
import { removeAutoAddedEntriesFromGitignore, hasAutoAddedEntries } from "../core/copy/gitignore.js";
import { CANCEL } from "../ui/prompts.js";

// selection: { workflows, scripts, readme, gitignore, versionYml } (모두 boolean).
// 반환: 위와 동일한 키의 boolean/배열 — 실제로 제거 "대상"인지 여부(순수 함수, 아무것도 지우지 않음).
export function planUninstall(payloadRoot, targetRoot, selection) {
  const removalPlan = planRemoval(payloadRoot, targetRoot);
  return {
    workflows: selection.workflows ? removalPlan.workflows : [],
    scripts: selection.scripts ? removalPlan.scripts : [],
    readme: selection.readme ? hasVersionSection(targetRoot) : false,
    gitignore: selection.gitignore ? hasAutoAddedEntries(targetRoot) : false,
    versionYml: selection.versionYml ? existsSync(join(targetRoot, PATHS.versionFile)) : false,
  };
}

// 반환: planUninstall과 동일한 형태 — 실제로 제거된 항목.
export function runUninstall(context, payloadRoot, targetRoot, selection) {
  const plan = planUninstall(payloadRoot, targetRoot, selection);
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  for (const name of plan.workflows) remove(join(wfDir, name));
  for (const name of plan.scripts) remove(join(targetRoot, PATHS.scriptsDir, name));
  // removeVersionSectionFromReadme/removeAutoAddedEntriesFromGitignore는 plan이 "제거 대상"으로
  // 판단했더라도 실제로는 안전하게 포기(skip-*)할 수 있다 — 반환 상태를 그대로 신뢰하지 않고
  // 실제 결과로 plan을 덮어써서 호출부(CLI/대화형 요약)가 거짓 성공을 보고하지 않게 한다.
  const readmeRemoved = plan.readme && removeVersionSectionFromReadme(targetRoot) === "removed";
  const gitignoreStatus = plan.gitignore ? removeAutoAddedEntriesFromGitignore(targetRoot) : null;
  const gitignoreRemoved = gitignoreStatus === "removed" || gitignoreStatus === "file-deleted";
  if (plan.versionYml) remove(join(targetRoot, PATHS.versionFile));
  return { ...plan, readme: readmeRemoved, gitignore: gitignoreRemoved };
}

// ── 대화형 체크리스트 흐름 ────────────────────────────────────────────
const ITEM_DEFS = [
  { key: "workflows", label: "워크플로우 (.github/workflows/PROJECT-*.yaml)" },
  { key: "scripts", label: "스크립트 (.github/scripts/*.py)" },
  { key: "readme", label: "README.md 버전 섹션 (AUTO-VERSION-SECTION)" },
  { key: "gitignore", label: ".gitignore 자동 추가 항목" },
  { key: "versionYml", label: "version.yml (버전/브랜치 설정 전체)" },
];

// 기본 체크 상태 — 설치 시 옵션(nexus/secret-backup)이 opt-in인 것과 대칭으로,
// 여기서는 "안전 삭제" 2종만 기본 체크하고 나머지(readme/gitignore/versionYml)는 opt-in.
export const SAFE_ITEMS = ["workflows", "scripts"];

function detectAvailableItems(payloadRoot, targetRoot) {
  const removalPlan = planRemoval(payloadRoot, targetRoot);
  const presence = {
    workflows: removalPlan.workflows.length > 0,
    scripts: removalPlan.scripts.length > 0,
    readme: hasVersionSection(targetRoot),
    gitignore: hasAutoAddedEntries(targetRoot),
    versionYml: existsSync(join(targetRoot, PATHS.versionFile)),
  };
  return ITEM_DEFS.filter((d) => presence[d.key]).map((d) => ({ value: d.key, label: d.label }));
}

function toSelection(checkedKeys) {
  const set = new Set(checkedKeys);
  return {
    workflows: set.has("workflows"), scripts: set.has("scripts"),
    readme: set.has("readme"), gitignore: set.has("gitignore"), versionYml: set.has("versionYml"),
  };
}

function summarizeSelection(selection) {
  const labelOf = Object.fromEntries(ITEM_DEFS.map((d) => [d.key, d.label]));
  const chosen = Object.keys(selection).filter((k) => selection[k]).map((k) => `- ${labelOf[k]}`);
  return chosen.length ? chosen.join("\n") : "(선택된 항목 없음)";
}

function summarizeResult(result) {
  const lines = [];
  if (result.workflows.length) lines.push(`워크플로우 ${result.workflows.length}개 제거`);
  if (result.scripts.length) lines.push(`스크립트 ${result.scripts.length}개 제거`);
  if (result.readme) lines.push("README.md 버전 섹션 제거");
  if (result.gitignore) lines.push(".gitignore 자동 추가 항목 제거");
  if (result.versionYml) lines.push("version.yml 제거");
  return lines.length ? lines.join("\n") : "제거된 항목이 없습니다.";
}

// io 계약: engineIo.multiselect({message,options,initialValues}), askYesNo(msg,def),
// note(text,title)?, cancelMessage(text)? — src/ui/prompts.js가 실물, 테스트는 스텁 주입.
export async function runUninstallFlow(payloadRoot, targetRoot, io) {
  const available = detectAvailableItems(payloadRoot, targetRoot);
  if (available.length === 0) {
    io.note?.("제거할 항목이 없습니다.", "완전 삭제");
    return null;
  }

  const checked = await io.engineIo.multiselect({
    message: "삭제할 항목을 선택하세요 (Space 토글, Enter 확정)",
    options: available,
    initialValues: available.map((o) => o.value).filter((v) => SAFE_ITEMS.includes(v)),
  });
  if (checked === CANCEL || !Array.isArray(checked) || checked.length === 0) {
    io.cancelMessage?.("완전 삭제를 취소했습니다.");
    return null;
  }

  const selection = toSelection(checked);
  io.note?.(summarizeSelection(selection), "삭제 예정 항목");
  const ok = await io.askYesNo("정말 삭제할까요? 되돌릴 수 없습니다.", false);
  if (ok !== true) {
    io.cancelMessage?.("완전 삭제를 취소했습니다.");
    return null;
  }

  const result = runUninstall({}, payloadRoot, targetRoot, selection);
  io.note?.(summarizeResult(result), "완전 삭제 완료");
  return result;
}
