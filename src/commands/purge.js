// purge 모드 — planRemoval이 판별하는 전부(워크플로우·스크립트) + version.yml·README
// AUTO-VERSION-SECTION 블록·.gitignore 자동 추가 항목·릴리스 워크플로우가 만든 CHANGELOG를
// 추가로 제거해 설치 이전 상태로 완전히 되돌린다. 마법사가 만들지 않은 파일은 지우지 않는다.
// 개발·테스트 전용 숨김 모드.
// develop 브랜치 삭제는 파일 삭제와 성격이 달라(실행 시점 git 상태 판단 필요) 여기 plan에는
// 포함하지 않고 index.js의 purge 분기에서 직접 처리한다.
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { PATHS } from "../core/paths.js";
import { planRemoval, backupArtifacts } from "../core/removal-plan.js";
import { executeRemoval } from "../core/removal-exec.js";
import { hasVersionSection } from "../core/copy/readme.js";
import { hasAutoAddedEntries } from "../core/copy/gitignore.js";

const CHANGELOG_FILES = ["CHANGELOG.json", "CHANGELOG.md"];

// changelog_manager.py가 만든 CHANGELOG인지 — 사용자가 원래 쓰던 CHANGELOG.md를 지우지 않기 위해 내용으로 가린다.
// CHANGELOG.json은 metadata·releases 구조로, CHANGELOG.md는 generate-md가 쓰는 머리말로 판단한다.
// JSON이 우리 것이면 MD는 릴리스마다 JSON에서 통째로 재생성되므로 함께 우리 것이다.
function readText(targetRoot, f) {
  try { return readFileSync(join(targetRoot, f), "utf8").replace(/\r\n/g, "\n"); } catch { return null; }
}
function isGeneratedChangelogJson(targetRoot) {
  const text = readText(targetRoot, "CHANGELOG.json");
  if (text === null) return false;
  try {
    const data = JSON.parse(text);
    return !!data && typeof data.metadata === "object" && Array.isArray(data.releases);
  } catch { return false; }
}
function generatedChangelogFiles(targetRoot) {
  const jsonOurs = isGeneratedChangelogJson(targetRoot);
  const md = readText(targetRoot, "CHANGELOG.md");
  const mdOurs = md !== null && (jsonOurs || md.startsWith("# Changelog\n\n**현재 버전:**"));
  return CHANGELOG_FILES.filter((f) => (f === "CHANGELOG.json" ? jsonOurs : mdOurs));
}

// keepFlags: { versionYml, readme, changelog, workflows, scripts } — true인 카테고리는 후보에서 제외.
// 반환: { workflows, scripts, versionYml, readmeSection, gitignore, changelog } — 아무것도 지우지 않는 순수 함수.
export function planPurge(payloadRoot, targetRoot = ".", keepFlags = {}) {
  const removalPlan = planRemoval(payloadRoot, targetRoot);
  // 워크플로우를 남기면 그 .bak/.template.yaml도 남는다 — .gitignore 항목까지 지우면 백업 파일이 git 상태에 드러난다.
  const gitignoreKept = hasAutoAddedEntries(targetRoot) && keepFlags.workflows === true
    && backupArtifacts(removalPlan.workflows).length > 0;
  return {
    workflows: keepFlags.workflows ? [] : removalPlan.workflows,
    // Flutter 앱 파일의 생성 기록은 baseline에 있으므로 baseline과 같은 플래그를 따른다.
    appFiles: keepFlags.workflows ? [] : removalPlan.appFiles,
    baseline: keepFlags.workflows ? [] : removalPlan.baseline,
    scripts: keepFlags.scripts ? [] : removalPlan.scripts,
    versionYml: !keepFlags.versionYml && existsSync(join(targetRoot, PATHS.versionFile)),
    readmeSection: !keepFlags.readme && hasVersionSection(targetRoot),
    gitignore: hasAutoAddedEntries(targetRoot) && !gitignoreKept,
    gitignoreKept,
    changelog: keepFlags.changelog ? [] : generatedChangelogFiles(targetRoot),
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
  for (const f of plan.appFiles || []) lines.push(`Flutter 앱 파일: ${f}`);
  if (plan.versionYml) lines.push("파일: version.yml");
  if (plan.readmeSection) lines.push("README.md: AUTO-VERSION-SECTION 블록");
  if (plan.gitignore) lines.push(".gitignore: 자동 추가 항목(*.bak, *.template.yaml)");
  if (plan.gitignoreKept) lines.push(".gitignore: 자동 추가 항목 유지 (남겨 둔 워크플로우의 백업 파일을 가리는 항목)");
  for (const f of plan.changelog) lines.push(`파일: ${f}`);
  lines.push("");
  console.log(lines.join("\n"));
}

// 실제 삭제 수행 — planPurge()와 동일 shape을 반환하되 실제로 제거된 항목을 반영한다.
// planRemoval 결과를 그대로 지우지 않는 이유: 그 목록은 항상 전체라서
// --keep-* 로 선택적 카테고리만 보존하는 요구사항과 맞지 않는다.
// readmeSection은 plan의 판정을 그대로 되돌려주지 않고
// removeVersionSectionFromReadme()의 실제 반환값("removed"인지)을 반영한다 — plan과 실제 제거 조건이
// 이론상 어긋나는 경우에도 printPurgeResult가 거짓으로 "제거됨"을 보고하지 않는다.
export function executePurge(payloadRoot, targetRoot = ".", keepFlags = {}) {
  const plan = planPurge(payloadRoot, targetRoot, keepFlags);
  const { readme, gitignore } = executeRemoval(targetRoot, { ...plan, readme: plan.readmeSection }, {
    logOrder: ["version", "gitignore", "changelog", "readme"],
    gitignoreDetail: (status) => (status === "removed" || status === "file-deleted" ? ".gitignore 자동 추가 항목" : null),
  });
  return { ...plan, readmeSection: readme, gitignore };
}

// 삭제 후 실제 제거된 목록 출력 — printPurgePlan과 완전히 동일한 형태(파일명 나열)로
// 맞춘다 (개수만 출력하면 무엇이 지워졌는지 확인할 수 없다).
export function printPurgeResult(result) {
  const lines = ["", "제거됨:", ""];
  lines.push(`워크플로우 (${result.workflows.length}개):`);
  for (const f of result.workflows) lines.push(`  - ${f}`);
  lines.push(`스크립트 (${result.scripts.length}개):`);
  for (const f of result.scripts) lines.push(`  - ${f}`);
  for (const f of result.appFiles || []) lines.push(`Flutter 앱 파일: ${f}`);
  if (result.versionYml) lines.push("파일: version.yml");
  if (result.readmeSection) lines.push("README.md: AUTO-VERSION-SECTION 블록");
  if (result.gitignore) lines.push(".gitignore: 자동 추가 항목(*.bak, *.template.yaml)");
  for (const f of result.changelog) lines.push(`파일: ${f}`);
  lines.push("");
  console.log(lines.join("\n"));
}
