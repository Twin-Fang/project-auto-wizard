// purge 모드 — revert가 지우는 전부(워크플로우·스크립트·coderabbit) + version.yml·README
// AUTO-VERSION-SECTION 블록·CHANGELOG를 추가로 제거해 설치 이전 상태로 완전히 되돌린다.
// 개발·테스트 전용 숨김 모드 — DESIGN-SPEC purge #6.
// develop 브랜치 삭제는 파일 삭제와 성격이 달라(실행 시점 git 상태 판단 필요) 여기 plan에는
// 포함하지 않고 index.js의 purge 분기에서 직접 처리한다.
import { join } from "node:path";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { PATHS } from "../core/paths.js";
import { remove } from "../core/fsutil.js";
import { planRevert } from "./revert.js";
import { removeVersionSectionFromReadme, MARKER } from "../core/copy/readme.js";

const CHANGELOG_FILES = ["CHANGELOG.json", "CHANGELOG.md"];

// L4 (Fable 2차 검토): 마커 문자열을 여기서 다시 하드코딩하지 않고 readme.js의 MARKER를 그대로 재사용한다
// (진실이 두 곳으로 갈리면 한쪽만 바뀌었을 때 plan 판정과 실제 제거 조건이 어긋날 수 있다).
function readmeHasVersionMarker(targetRoot) {
  const p = join(targetRoot, "README.md");
  if (!existsSync(p)) return false;
  return readFileSync(p, "utf8").includes(MARKER);
}

// keepFlags: { versionYml, readme, changelog, workflows, scripts, coderabbit } — true인 카테고리는 후보에서 제외.
// 반환: { workflows, scripts, coderabbit, versionYml, readmeSection, changelog } — 아무것도 지우지 않는 순수 함수.
export function planPurge(payloadRoot, targetRoot = ".", keepFlags = {}) {
  const revertPlan = planRevert(payloadRoot, targetRoot);
  return {
    workflows: keepFlags.workflows ? [] : revertPlan.workflows,
    scripts: keepFlags.scripts ? [] : revertPlan.scripts,
    coderabbit: keepFlags.coderabbit ? false : revertPlan.coderabbit,
    versionYml: !keepFlags.versionYml && existsSync(join(targetRoot, PATHS.versionFile)),
    readmeSection: !keepFlags.readme && readmeHasVersionMarker(targetRoot),
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
  if (plan.coderabbit) lines.push("파일: .coderabbit.yaml");
  if (plan.versionYml) lines.push("파일: version.yml");
  if (plan.readmeSection) lines.push("README.md: AUTO-VERSION-SECTION 블록");
  for (const f of plan.changelog) lines.push(`파일: ${f}`);
  lines.push("");
  console.log(lines.join("\n"));
}
