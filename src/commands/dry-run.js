// --dry-run 미리보기 — 실제 파일을 쓰지 않고 무엇이 바뀔지 계산한다.
// full/version/workflows/revert 4개 모드 전체 지원.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../core/paths.js";
import { planWorkflows } from "../core/copy/workflows.js";
import { planRevert } from "./revert.js";
import { buildVersionYml } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { markerForType } from "../core/detect.js";

function versionYmlPreview(context, payloadRoot, targetRoot) {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false, includeCodeRabbit = false } = context;
  const pathMarkers = new Map();
  for (const [t] of paths) pathMarkers.set(t, markerForType(t));
  const wouldBe = buildVersionYml({
    templateText: readVersionYmlTemplate(payloadRoot),
    version, types, paths, pathMarkers, branch, branches: context.branches, versionCode, now, today,
    templateOptions: { templateVersion, includeNexus, includeSecretBackup, includeCodeRabbit: includeCodeRabbit === true, optionsDate: today },
  });
  const vyPath = join(targetRoot, PATHS.versionFile);
  const existing = existsSync(vyPath) ? readFileSync(vyPath, "utf8") : null;
  return { existed: existing !== null, changed: existing !== wouldBe };
}

// mode: "full" | "version" | "workflows" | "revert". 읽기 전용 — 아무 파일도 쓰지 않는다.
export function planDryRun(mode, context, payloadRoot, targetRoot = ".") {
  if (mode === "revert") return { mode, revert: planRevert(payloadRoot, targetRoot) };

  const result = { mode };
  if (mode === "full" || mode === "workflows") {
    result.workflows = planWorkflows(context, payloadRoot, targetRoot);
  }
  if (mode === "full" || mode === "version") {
    result.versionYml = versionYmlPreview(context, payloadRoot, targetRoot);
  }
  return result;
}

export function printDryRun(plan) {
  const lines = ["", `project-auto-wizard --dry-run (mode: ${plan.mode}) — 미리보기, 실제 파일은 바뀌지 않았습니다`, ""];
  if (plan.mode === "revert") {
    const r = plan.revert;
    lines.push(`제거될 워크플로우 (${r.workflows.length}개):`);
    for (const f of r.workflows) lines.push(`  - ${f}`);
    lines.push(`제거될 스크립트 (${r.scripts.length}개):`);
    for (const f of r.scripts) lines.push(`  - ${f}`);
    if (r.coderabbit) lines.push("제거될 파일: .coderabbit.yaml");
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
    }
  }
  lines.push("");
  console.log(lines.join("\n"));
}
