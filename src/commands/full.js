// full 모드 오케스트레이터 (.sh execute_integration full case 등가).
// 복사 순서: workflows(+env 치환) → version.yml → readme → scripts → gitignore(조건부)
// gitignore는 충돌 백업 부산물(.bak/.template.yaml)이 이번 실행에서 실제로 생겼을 때만 갱신한다 — issue #7.
// (원본의 util/issue/discussion/setup-guide/config 설치는 project-auto-wizard 스코프에서 제외 — DESIGN-SPEC §2)
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { writeText } from "../core/fsutil.js";
import { PATHS } from "../core/paths.js";
import { buildVersionYml, parseExisting } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { markerForType } from "../core/detect.js";
import { addVersionSectionToReadme } from "../core/copy/readme.js";
import { copyWorkflows } from "../core/copy/workflows.js";
import { copyScripts } from "../core/copy/simple.js";
import { ensureGitignore } from "../core/copy/gitignore.js";

// context: { version, types, paths:Map, branch, versionCode, includeNexus, includeSecretBackup,
//            force, repoName, resolvers, now, today }
// payloadRoot: 패키지 payload/ 루트. targetRoot: 통합 대상.
export function runFull(context, payloadRoot, targetRoot = ".", hooks = {}) {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    force = true, now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false,
    includeSemverAuto } = context;

  // project_paths 마커 계산 (.sh existing_marker_in_dir 등가 — 대표 마커명)
  const pathMarkers = new Map();
  for (const [t] of paths) pathMarkers.set(t, markerForType(t));

  // 1. 워크플로우 복사 (+ env 치환) — deploy 블록에 쓸 ask 값을 수집한다.
  //    hooks.decisions: 대화형 충돌 3지선 결정 Map (미지정=skip — 현행 force 동작)
  const wfCounters = copyWorkflows(context, payloadRoot, targetRoot, hooks);
  const deployValues = wfCounters.deployValues || new Map(); // Map<type, Map<key,value>>

  // 기존 version.yml의 알려지지 않은 최상위 필드를 재생성 시 보존한다 (issue #20 M8).
  const vyPath = join(targetRoot, PATHS.versionFile);
  const extraTopLevel = existsSync(vyPath) ? parseExisting(readFileSync(vyPath, "utf8")).extraTopLevel : [];

  // 2. version.yml 생성 (payload/version.yml.template 렌더링 — 전체 재생성 전략 D4)
  writeText(join(targetRoot, PATHS.versionFile),
    buildVersionYml({
      templateText: readVersionYmlTemplate(payloadRoot),
      version, types, paths, pathMarkers, branch, branches: context.branches, versionCode, now, today,
      deployValues, extraTopLevel,
      templateOptions: { templateVersion, includeNexus, includeSecretBackup, includeSemverAuto: includeSemverAuto !== false, optionsDate: today },
    }));

  // 3. README 버전 섹션
  addVersionSectionToReadme(version, targetRoot);

  // 4. scripts (payload/scripts/*.py → .github/scripts/)
  copyScripts(payloadRoot, targetRoot);

  // 5. gitignore — 워크플로우 충돌 처리가 .bak나 .template.yaml을 실제로 만든 경우에만 갱신한다.
  //    충돌 없는 설치(대부분의 최초 설치)는 .gitignore를 전혀 건드리지 않는다 — issue #7.
  const gitignoreUpdated = wfCounters.backupAdded > 0 || wfCounters.templateAdded > 0;
  if (gitignoreUpdated) ensureGitignore(targetRoot);

  return { workflows: wfCounters, gitignoreUpdated };
}
