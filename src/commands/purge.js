// purge 모드 — planRemoval이 판별하는 전부(워크플로우·스크립트) + version.yml·README
// AUTO-VERSION-SECTION 블록·CHANGELOG를 추가로 제거해 설치 이전 상태로 완전히 되돌린다.
// 개발·테스트 전용 숨김 모드 — DESIGN-SPEC purge #6.
// develop 브랜치 삭제는 파일 삭제와 성격이 달라(실행 시점 git 상태 판단 필요) 여기 plan에는
// 포함하지 않고 index.js의 purge 분기에서 직접 처리한다.
import { join } from "node:path";
import { existsSync } from "node:fs";
import { PATHS } from "../core/paths.js";
import { remove } from "../core/fsutil.js";
import { planRemoval } from "../core/removal-plan.js";
import { removeVersionSectionFromReadme, hasVersionSection } from "../core/copy/readme.js";

const CHANGELOG_FILES = ["CHANGELOG.json", "CHANGELOG.md"];

// keepFlags: { versionYml, readme, changelog, workflows, scripts } — true인 카테고리는 후보에서 제외.
// 반환: { workflows, scripts, versionYml, readmeSection, changelog } — 아무것도 지우지 않는 순수 함수.
export function planPurge(payloadRoot, targetRoot = ".", keepFlags = {}) {
  const removalPlan = planRemoval(payloadRoot, targetRoot);
  return {
    workflows: keepFlags.workflows ? [] : removalPlan.workflows,
    scripts: keepFlags.scripts ? [] : removalPlan.scripts,
    versionYml: !keepFlags.versionYml && existsSync(join(targetRoot, PATHS.versionFile)),
    readmeSection: !keepFlags.readme && hasVersionSection(targetRoot),
    changelog: keepFlags.changelog ? [] : CHANGELOG_FILES.filter((f) => existsSync(join(targetRoot, f))),
  };
}

// 삭제 전 요약 출력 — dry-run 미리보기와 실제 실행 전 요약 양쪽에서 재사용한다.
export function printPurgePlan(plan, { dryRun = false } = {}) {
  const lines = ["",
    dryRun
      ? "project-auto-wizard --mode purge --dry-run — 미리보기, 실제 파일은 바뀌지 않았습니다"
      : "project-auto-wizard --mode purge — 아래 항목을 제거합니다",
    ""];
  lines.push(`워크플로우 (${plan.workflows.length}개):`);
  for (const f of plan.workflows) lines.push(`  - ${f}`);
  lines.push(`스크립트 (${plan.scripts.length}개):`);
  for (const f of plan.scripts) lines.push(`  - ${f}`);
  if (plan.versionYml) lines.push("파일: version.yml");
  if (plan.readmeSection) lines.push("README.md: AUTO-VERSION-SECTION 블록");
  for (const f of plan.changelog) lines.push(`파일: ${f}`);
  lines.push("");
  console.log(lines.join("\n"));
}

// 실제 삭제 수행 — planPurge()와 동일 shape을 반환하되 실제로 제거된 항목을 반영한다.
// planRemoval 결과를 그대로 지우지 않는 이유: 그 목록은 항상 전체라서
// --keep-* 로 선택적 카테고리만 보존하는 요구사항과 맞지 않는다.
// H3 (Fable 검토): readmeSection은 plan의 판정을 그대로 되돌려주지 않고
// removeVersionSectionFromReadme()의 실제 반환값("removed"인지)을 반영한다 — 스펙 §6이
// "반환값은 실제 삭제 결과를 반영"하라고 명시하기 때문에, plan과 실제 제거 조건이
// 이론상 어긋나는 경우에도 printPurgeResult가 거짓으로 "제거됨"을 보고하지 않는다.
export function executePurge(payloadRoot, targetRoot = ".", keepFlags = {}) {
  const plan = planPurge(payloadRoot, targetRoot, keepFlags);
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  for (const name of plan.workflows) remove(join(wfDir, name));
  for (const name of plan.scripts) remove(join(targetRoot, PATHS.scriptsDir, name));
  if (plan.versionYml) remove(join(targetRoot, PATHS.versionFile));
  const readmeSection = plan.readmeSection && removeVersionSectionFromReadme(targetRoot) === "removed";
  for (const f of plan.changelog) remove(join(targetRoot, f));
  return { ...plan, readmeSection };
}

// 삭제 후 실제 제거된 목록 출력 — printPurgePlan과 완전히 동일한 형태(파일명 나열)로
// 맞춘다 (M3, Fable 검토: 개수만 출력하면 스펙 §5-6의 "제거된 목록 재출력" 요구를 충족하지 못함).
export function printPurgeResult(result) {
  const lines = ["", "제거됨:", ""];
  lines.push(`워크플로우 (${result.workflows.length}개):`);
  for (const f of result.workflows) lines.push(`  - ${f}`);
  lines.push(`스크립트 (${result.scripts.length}개):`);
  for (const f of result.scripts) lines.push(`  - ${f}`);
  if (result.versionYml) lines.push("파일: version.yml");
  if (result.readmeSection) lines.push("README.md: AUTO-VERSION-SECTION 블록");
  for (const f of result.changelog) lines.push(`파일: ${f}`);
  lines.push("(.gitignore에 추가된 백업 파일 제외 항목(*.bak/*.template.yaml)은 purge 대상에서 제외되어 그대로 보존됩니다)");
  lines.push("");
  console.log(lines.join("\n"));
}
