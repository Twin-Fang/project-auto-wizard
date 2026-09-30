// status 명령 — 읽기 전용 설치 상태 확인. 네트워크 접근 없음(로컬 파일 비교만).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseExisting } from "../core/version-yml.js";
import { planWorkflows } from "../core/copy/workflows.js";
import { makeResolvers, detectRepoName, detectDefaultBranch } from "../core/detect-fs.js";
import { PATHS } from "../core/paths.js";
import { resolveFlutterOptions } from "../core/flutter-options.js";
import { isDeployStyle, DEFAULT_DEPLOY_STYLE } from "../core/deploy-style.js";
import { findStaleWorkflows } from "../core/removal-plan.js";
import { readBaseline } from "../core/baseline.js";
import { hooksFor } from "../core/types.js";

// payloadRoot: 패키지 payload/ 루트. targetRoot: 상태를 확인할 대상 레포.
export function runStatus(payloadRoot, targetRoot = ".") {
  const vyPath = join(targetRoot, PATHS.versionFile);
  if (!existsSync(vyPath)) return { installed: false };

  const existing = parseExisting(readFileSync(vyPath, "utf8"));
  const repoName = detectRepoName(targetRoot);
  // 설치 때 워크플로우에 치환된 환경변수 방식·배포 모드와 스토어 선택을 비교 기준에도 똑같이 적용한다 —
  // 그렇지 않으면 미수정 파일이 드리프트로, 선택 해제한 스토어 워크플로우가 "삭제함"으로 오탐된다.
  const flutterOptions = resolveFlutterOptions({
    cli: { envMode: "", stores: null, androidDeployMode: "", iosDeployMode: "" }, existing,
  });
  const resolvers = makeResolvers(targetRoot, repoName, existing.paths, flutterOptions);
  // version.yml에 branches 블록이 없으면(신기능 이전 설치·수기 편집) makeSrcText(null)이
  // {{MAIN_BRANCH}}/{{DEVELOP_BRANCH}}를 치환하지 못해 모든 워크플로우가 드리프트로 오탐된다 —
  // 비교용 기본값으로 폴백(실제 저장값은 아니지만 드리프트 비교 목적에는 충분).
  const branchesForCompare = existing.branches || { main: detectDefaultBranch(targetRoot) || "main", develop: "develop", mode: "pr-flow" };
  const context = {
    types: existing.types, paths: existing.paths,
    repoName, resolvers, branches: branchesForCompare,
    flutterStore: flutterOptions.stores,
    // 설치 때 고른 배포 방식으로 비교해야 nginx·traefik CD 수정도 드리프트로 잡힌다.
    // 빠지면 기본값(simple)으로 걸러 설치된 무중단 CD가 비교 대상에서 사라진다.
    deployStyle: isDeployStyle(existing.options.deployStyle) ? existing.options.deployStyle : DEFAULT_DEPLOY_STYLE,
  };
  const plan = planWorkflows(context, payloadRoot, targetRoot);
  // 현재 버전에 없는 옛 워크플로우 — 다음 업데이트에서 정리된다. 그 전까지는 옛 트리거로 계속 돈다.
  const stale = findStaleWorkflows(payloadRoot, targetRoot, readBaseline(targetRoot));

  return {
    installed: true,
    version: existing.version,
    templateVersion: existing.templateVersion,
    types: existing.types,
    branches: existing.branches,
    options: existing.options,
    // 사용자가 손댄 파일 = 진짜 충돌(changed) + 업스트림은 그대로인데 내가 고친 것(localOnly).
    // baseline이 없으면 localOnly는 항상 비어 있어 종전과 동일하게 동작한다.
    modifiedFiles: [...plan.changed, ...plan.localOnly].map((f) => f.filename),
    // 업데이트 시 무슨 일이 일어날지 미리 보여주는 버킷들 — 판단 재료가 없어 사용자가
    // 직접 git diff를 떠야 했던 문제를 없앤다.
    buckets: {
      autoUpdatable: plan.upstreamOnly.map((f) => f.filename), // 질문 없이 최신으로 교체됨
      localKept: plan.localOnly.map((f) => f.filename),        // 질문 없이 내 수정본 유지됨
      conflicts: plan.changed.map((f) => f.filename),          // 양쪽 변경 — 검토 필요
      removed: plan.removed.map((f) => f.filename),            // 내가 지웠고 복원하지 않음
    },
    staleFiles: stale,
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
  const copilotAiLabel = boolLabel(status.options.copilotAi ?? null);
  const typeLabels = hooksFor(status.types, "statusLabels").map(({ hook }) => hook(status.options)).join("");
  const deployLabel = status.options.deployStyle ? ` deploy_style=${status.options.deployStyle}` : "";
  lines.push(`옵션            : semver_auto=${semverAutoLabel} copilot_ai=${copilotAiLabel}${deployLabel}${typeLabels}`);
  if (status.modifiedFiles.length) {
    lines.push("", `사용자가 수정한 워크플로우 파일 (${status.modifiedFiles.length}개):`);
    for (const f of status.modifiedFiles) lines.push(`  - ${f}`);
  } else {
    lines.push("", "모든 워크플로우 파일이 설치 시점 기본값과 동일합니다 (수정 없음).");
  }

  if (status.staleFiles?.length) {
    lines.push("", `현재 버전에 없는 이전 워크플로우 (${status.staleFiles.length}개 — 다음 업데이트에서 정리됨):`);
    for (const f of status.staleFiles) lines.push(`  - ${f}`);
  }

  // 업데이트하면 무슨 일이 일어나는지. baseline이 없는 설치는 전부 0이라 출력하지 않는다.
  const b = status.buckets || { autoUpdatable: [], localKept: [], conflicts: [], removed: [] };
  if (b.autoUpdatable.length || b.localKept.length || b.conflicts.length || b.removed.length) {
    lines.push("", "지금 업데이트하면:");
    lines.push(`  업스트림 변경 — 자동 적용 가능   ${String(b.autoUpdatable.length).padStart(3)}`);
    lines.push(`  내가 수정 · 업스트림 그대로      ${String(b.localKept.length).padStart(3)}   (유지)`);
    lines.push(`  양쪽 변경 — 검토 필요            ${String(b.conflicts.length).padStart(3)}`);
    lines.push(`  내가 삭제함 — 복원 안 함         ${String(b.removed.length).padStart(3)}`);
  }
  lines.push("");
  console.log(lines.join("\n"));
}
