// --dry-run 미리보기 — 실제 파일을 쓰지 않고 무엇이 바뀔지 계산한다.
// full/uninstall 두 모드 지원 (부분 설치·되돌리기 모드 제거).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../core/paths.js";
import { planWorkflows } from "../core/copy/workflows.js";
import { planTypeAppFiles } from "../core/copy/app-files.js";
import { planUninstall } from "./uninstall.js";
import { renderVersionYml, parseExisting, sameIgnoringTimestamps } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { existingMarkerInDir } from "../core/paths-resolve.js";
import { planScripts } from "../core/copy/simple.js";
import { planVersionSection } from "../core/copy/readme.js";
import { BASELINE_PATH, readBaseline } from "../core/baseline.js";
import { cleanupWorkflows } from "./full.js";
import { planGitignore } from "../core/copy/gitignore.js";

function versionYmlPreview(context, payloadRoot, targetRoot) {
  const { paths = new Map() } = context;
  const pathMarkers = new Map();
  for (const [t, p] of paths) pathMarkers.set(t, existingMarkerInDir(t, join(targetRoot, p || ".")));

  const vyPath = join(targetRoot, PATHS.versionFile);
  const existingRaw = existsSync(vyPath) ? readFileSync(vyPath, "utf8") : null;
  const extraTopLevel = existingRaw !== null ? parseExisting(existingRaw).extraTopLevel : [];

  // 실제 설치와 같은 렌더 함수를 쓴다 — 각자 조립하면 옵션이 늘 때마다 미리보기가 어긋난다.
  const wouldBe = renderVersionYml(context, readVersionYmlTemplate(payloadRoot), {
    pathMarkers, extraTopLevel,
  });
  // 실제 설치와 같은 기준으로 비교한다 — 시각 줄만 다르면 설치도 파일을 다시 쓰지 않는다.
  return { existed: existingRaw !== null, changed: existingRaw === null || !sameIgnoringTimestamps(existingRaw, wouldBe) };
}

// mode: "full" | "uninstall". 읽기 전용 — 아무 파일도 쓰지 않는다.
export function planDryRun(mode, context, payloadRoot, targetRoot = ".") {
  if (mode === "uninstall") {
    return { mode, uninstall: planUninstall(payloadRoot, targetRoot, context.uninstallSelection) };
  }
  const workflows = planWorkflows(context, payloadRoot, targetRoot);
  // 실제 실행과 같은 정리 판정을 파일을 건드리지 않고 돌린다 — 배포 방식 변경·스토어 해제로 지워지거나
  // .bak으로 옮겨질 파일이 미리보기에서 빠지면 안 된다. 비대화형 실행이 새로 쓰는 파일은 신규·자동 갱신분이다.
  const justWritten = [...workflows.newFiles, ...workflows.upstreamOnly].map((f) => f.filename);
  const cleanup = cleanupWorkflows(context, payloadRoot, targetRoot, readBaseline(targetRoot), { justWritten, dryRun: true });
  // .bak이 생기면 실제 실행은 .gitignore에 백업 파일 항목을 보장한다. 비대화형 충돌은 기존 유지라 .bak을 만들지 않는다.
  const backedUp = Object.values(cleanup).some((r) => r.backedUp.length > 0);
  return {
    mode,
    workflows,
    cleanup,
    gitignore: backedUp ? planGitignore(targetRoot) : null,
    // Flutter 스토어 배포 파일(Fastfile·ExportOptions.plist) — 이미 있는 파일은 덮어쓰지 않고 유지한다.
    flutterApp: planTypeAppFiles(context, payloadRoot, targetRoot),
    versionYml: versionYmlPreview(context, payloadRoot, targetRoot),
    // 실제 설치가 함께 바꾸는 파일 — 특히 기존 파일을 덮어쓰는 스크립트는 미리 보여줘야 한다.
    scripts: planScripts(payloadRoot, targetRoot),
    readme: planVersionSection(targetRoot),
    baselineExists: existsSync(join(targetRoot, BASELINE_PATH)),
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
    for (const f of u.appFiles || []) lines.push(`제거될 Flutter 앱 파일: ${f}`);
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
    if (plan.cleanup) {
      const reasons = { cleanup: "이전 배포 방식 정리", storeCleanup: "선택 해제된 스토어 워크플로우 정리", staleCleanup: "현재 버전에 없는 이전 워크플로우 정리" };
      const removed = [];
      const backedUp = [];
      for (const [key, reason] of Object.entries(reasons)) {
        for (const f of plan.cleanup[key]?.removed || []) removed.push(`  - ${f} (${reason})`);
        for (const f of plan.cleanup[key]?.backedUp || []) backedUp.push(`  > ${f} → ${f}.bak (${reason}, 수정본이라 백업)`);
      }
      if (removed.length) lines.push(`삭제될 파일 (${removed.length}개):`, ...removed);
      if (backedUp.length) lines.push(`.bak으로 옮겨질 파일 (${backedUp.length}개):`, ...backedUp);
    }
    if (plan.gitignore) {
      const g = plan.gitignore;
      lines.push(g.created
        ? `.gitignore: 새로 생성될 예정 (${g.added.join(", ")})`
        : g.added.length ? `.gitignore: ${g.added.join(", ")} 추가될 예정` : ".gitignore: 변경 없음 (이미 있는 항목)");
    }
    if (plan.flutterApp && (plan.flutterApp.created.length || plan.flutterApp.kept.length)) {
      const { created, kept } = plan.flutterApp;
      lines.push(`Flutter 스토어 배포 파일 — 신규 (${created.length}개):`);
      for (const f of created) lines.push(`  + ${f}`);
      lines.push(`Flutter 스토어 배포 파일 — 기존 파일 유지 (${kept.length}개, 덮어쓰지 않음):`);
      for (const f of kept) lines.push(`  = ${f} (기존 파일 유지)`);
    }
    if (plan.versionYml) {
      lines.push(plan.versionYml.existed
        ? (plan.versionYml.changed ? "version.yml: 갱신될 예정" : "version.yml: 변경 없음")
        : "version.yml: 새로 생성될 예정");
      // dry-run은 프롬프트 없이 읽기 전용으로 동작하므로 @wizard ask 배포 설정 값을 계산할 수 없다.
      // spring 등 deploy 블록이 있는 타입은 실제 설치 결과와 미리보기가 다를 수 있음을 안내한다.
      lines.push("  (참고: 배포 설정 질문이 있는 타입(spring 등)은 deploy: 블록이 미리보기에 반영되지 않아 실제 설치와 다르게 보일 수 있습니다.)");
    }
    if (plan.scripts) {
      const mark = { create: "+", overwrite: "~", unchanged: "=" };
      const note = { create: "새로 생성", overwrite: "기존 파일을 새 버전으로 덮어씀 — 직접 고친 내용은 사라집니다", unchanged: "변경 없음" };
      lines.push(`스크립트 (${PATHS.scriptsDir}/, ${plan.scripts.length}개 — 항상 새 버전으로 교체):`);
      for (const s of plan.scripts) lines.push(`  ${mark[s.action]} ${s.name} (${note[s.action]})`);
    }
    if (plan.readme) {
      lines.push({
        added: "README.md: 끝에 버전 섹션이 추가될 예정",
        "skip-no-readme": "README.md: 파일이 없어 버전 섹션을 추가하지 않음",
        "skip-marker": "README.md: 이미 버전 섹션이 있어 변경 없음",
        "skip-version-line": "README.md: 이미 버전 줄이 있어 변경 없음",
      }[plan.readme] || `README.md: ${plan.readme}`);
    }
    if (plan.baselineExists !== undefined) {
      lines.push(`${BASELINE_PATH}: ${plan.baselineExists ? "갱신될 예정" : "새로 생성될 예정"} (다음 업데이트의 비교 기준)`);
    }
  }
  lines.push("");
  console.log(lines.join("\n"));
}
