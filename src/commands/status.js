// status 명령 — 읽기 전용 설치 상태 확인. 네트워크 접근 없음(로컬 파일 비교만).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseExisting } from "../core/version-yml.js";
import { planWorkflows } from "../core/copy/workflows.js";
import { makeResolvers, detectRepoName, detectDefaultBranch } from "../core/detect-fs.js";
import { PATHS } from "../core/paths.js";

// payloadRoot: 패키지 payload/ 루트. targetRoot: 상태를 확인할 대상 레포.
export function runStatus(payloadRoot, targetRoot = ".") {
  const vyPath = join(targetRoot, PATHS.versionFile);
  if (!existsSync(vyPath)) return { installed: false };

  const existing = parseExisting(readFileSync(vyPath, "utf8"));
  const repoName = detectRepoName(targetRoot);
  const resolvers = makeResolvers(targetRoot, repoName, existing.paths);
  // version.yml에 branches 블록이 없으면(신기능 이전 설치·수기 편집) makeSrcText(null)이
  // {{MAIN_BRANCH}}/{{DEVELOP_BRANCH}}를 치환하지 못해 모든 워크플로우가 드리프트로 오탐된다 —
  // 비교용 기본값으로 폴백(실제 저장값은 아니지만 드리프트 비교 목적에는 충분).
  const branchesForCompare = existing.branches || { main: detectDefaultBranch(targetRoot) || "main", develop: "develop", mode: "pr-flow" };
  const context = {
    types: existing.types, paths: existing.paths,
    includeNexus: existing.options.nexus === true,
    includeSecretBackup: existing.options.secretBackup === true,
    repoName, resolvers, branches: branchesForCompare,
  };
  const plan = planWorkflows(context, payloadRoot, targetRoot);

  return {
    installed: true,
    version: existing.version,
    templateVersion: existing.templateVersion,
    types: existing.types,
    branches: existing.branches,
    options: existing.options,
    modifiedFiles: plan.changed.map((f) => f.filename),
  };
}

export function printStatus(status) {
  const lines = ["", "project-auto-wizard status — 설치 상태", ""];
  if (!status.installed) {
    lines.push("이 디렉터리에 project-auto-wizard가 설치되어 있지 않습니다 (version.yml 없음).", "");
    console.log(lines.join("\n"));
    return;
  }
  lines.push(`버전            : ${status.version}`);
  lines.push(`템플릿 버전      : ${status.templateVersion}`);
  lines.push(`프로젝트 타입    : ${status.types.join(", ") || "(없음)"}`);
  if (status.branches) {
    lines.push(`브랜치 모드      : ${status.branches.mode} (${status.branches.main} / ${status.branches.develop})`);
  }
  const boolLabel = (v) => (v === null ? "미설정(기본 false)" : v);
  const semverAutoLabel = status.options.semverAuto === null ? "미설정(기본 false)" : status.options.semverAuto;
  lines.push(`옵션            : nexus=${boolLabel(status.options.nexus)} secret_backup=${boolLabel(status.options.secretBackup)} coderabbit=${boolLabel(status.options.coderabbit)} semver_auto=${semverAutoLabel}`);
  if (status.modifiedFiles.length) {
    lines.push("", `사용자가 수정한 워크플로우 파일 (${status.modifiedFiles.length}개):`);
    for (const f of status.modifiedFiles) lines.push(`  - ${f}`);
  } else {
    lines.push("", "모든 워크플로우 파일이 설치 시점 기본값과 동일합니다 (수정 없음).");
  }
  lines.push("");
  console.log(lines.join("\n"));
}
