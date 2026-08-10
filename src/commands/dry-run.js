// --dry-run 미리보기 — 실제 파일을 쓰지 않고 무엇이 바뀔지 계산한다.
// full/uninstall 두 모드 지원 (issue #70 — 부분 설치·되돌리기 모드 제거).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../core/paths.js";
import { planWorkflows } from "../core/copy/workflows.js";
import { planUninstall } from "./uninstall.js";
import { buildVersionYml, parseExisting } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { markerForType } from "../core/detect.js";

function versionYmlPreview(context, payloadRoot, targetRoot) {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false,
    includeSemverAuto } = context;
  const pathMarkers = new Map();
  for (const [t] of paths) pathMarkers.set(t, markerForType(t));

  const vyPath = join(targetRoot, PATHS.versionFile);
  const existingRaw = existsSync(vyPath) ? readFileSync(vyPath, "utf8") : null;
  const extraTopLevel = existingRaw !== null ? parseExisting(existingRaw).extraTopLevel : [];

  const wouldBe = buildVersionYml({
    templateText: readVersionYmlTemplate(payloadRoot),
    version, types, paths, pathMarkers, branch, branches: context.branches, versionCode, now, today,
    extraTopLevel,
    templateOptions: {
      templateVersion, includeNexus, includeSecretBackup,
      includeSemverAuto: includeSemverAuto !== false,
      optionsDate: today,
    },
  });
  return { existed: existingRaw !== null, changed: existingRaw !== wouldBe };
}

// mode: "full" | "uninstall". 읽기 전용 — 아무 파일도 쓰지 않는다.
export function planDryRun(mode, context, payloadRoot, targetRoot = ".") {
  if (mode === "uninstall") {
    return { mode, uninstall: planUninstall(payloadRoot, targetRoot, context.uninstallSelection) };
  }
  return {
    mode,
    workflows: planWorkflows(context, payloadRoot, targetRoot),
    versionYml: versionYmlPreview(context, payloadRoot, targetRoot),
  };
}

export function printDryRun(plan) {
  const lines = ["", `project-auto-wizard --dry-run (mode: ${plan.mode}) — 미리보기, 실제 파일은 바뀌지 않았습니다`, ""];
  if (plan.mode === "uninstall") {
    const u = plan.uninstall;
    lines.push(`제거될 워크플로우 (${u.workflows.length}개):`);
    for (const f of u.workflows) lines.push(`  - ${f}`);
    lines.push(`제거될 스크립트 (${u.scripts.length}개):`);
    for (const f of u.scripts) lines.push(`  - ${f}`);
    if (u.readme) lines.push("제거될 항목: README.md 버전 섹션 (AUTO-VERSION-SECTION)");
    if (u.gitignore) lines.push("제거될 항목: .gitignore 자동 추가 항목");
    if (u.versionYml) lines.push("제거될 파일: version.yml");
  } else {
    if (plan.workflows) {
      const w = plan.workflows;
      lines.push(`신규 파일 (${w.newFiles.length}개):`);
      for (const f of w.newFiles) lines.push(`  + ${f.filename} [${f.type}]`);
      lines.push(`변경될 파일 (${w.changed.length}개, 기존 설치가 사용자 수정본이면 충돌):`);
      for (const f of w.changed) lines.push(`  ~ ${f.filename} [${f.type}]`);
      lines.push(`동일한 파일 (${w.unchanged.length}개, 변경 없음)`);
    }
    if (plan.versionYml) {
      lines.push(plan.versionYml.existed
        ? (plan.versionYml.changed ? "version.yml: 갱신될 예정" : "version.yml: 변경 없음")
        : "version.yml: 새로 생성될 예정");
      // dry-run은 프롬프트 없이 읽기 전용으로 동작하므로 @wizard ask 배포 설정 값을 계산할 수 없다.
      // spring 등 deploy 블록이 있는 타입은 실제 설치 결과와 미리보기가 다를 수 있음을 안내한다.
      lines.push("  (참고: 배포 설정 질문이 있는 타입(spring 등)은 deploy: 블록이 미리보기에 반영되지 않아 실제 설치와 다르게 보일 수 있습니다.)");
    }
  }
  lines.push("");
  console.log(lines.join("\n"));
}
