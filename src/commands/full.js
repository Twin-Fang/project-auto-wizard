// full 모드 오케스트레이터 (.sh execute_integration full case 등가).
// 복사 순서: workflows(+env 치환) → version.yml → readme → scripts → gitignore(조건부)
// gitignore는 충돌 백업 부산물(.bak/.template.yaml)이 이번 실행에서 실제로 생겼을 때만 갱신한다 — issue #7.
// (원본의 util/issue/discussion/setup-guide/config 설치는 project-auto-wizard 스코프에서 제외 — DESIGN-SPEC §2)
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { writeText } from "../core/fsutil.js";
import { PATHS } from "../core/paths.js";
import { buildVersionYml, parseExisting } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { existingMarkerInDir } from "../core/paths-resolve.js";
import { addVersionSectionToReadme } from "../core/copy/readme.js";
import { copyWorkflows, computeBaselineEntries, makeSrcText } from "../core/copy/workflows.js";
import { copyScripts } from "../core/copy/simple.js";
import { ensureGitignore } from "../core/copy/gitignore.js";
import { readBaseline, writeBaseline } from "../core/baseline.js";
import { scanUnsubstituted, collectRequiredSecrets, narrowSecretsBySshAuth } from "../core/verify.js";
import { competingDeployWorkflows } from "../core/deploy-style.js";
import { writeInstallLog } from "../core/install-log.js";

// context: { version, types, paths:Map, branch, versionCode, includeNexus, includeSecretBackup,
//            force, repoName, resolvers, now, today }
// payloadRoot: 패키지 payload/ 루트. targetRoot: 통합 대상.
export function runFull(context, payloadRoot, targetRoot = ".", hooks = {}) {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    force = true, now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false,
    includeSemverAuto } = context;

  // project_paths 마커 계산 (.sh existing_marker_in_dir 등가).
  // 대표 마커명이 아니라 그 폴더에 실제로 있는 파일을 쓴다 — build.gradle.kts만 있는 레포의
  // version.yml에 "# build.gradle"이라고 적히면 감지 로그와 같은 종류의 거짓말이 된다 (이슈 #77).
  const pathMarkers = new Map();
  for (const [t, p] of paths) pathMarkers.set(t, existingMarkerInDir(t, join(targetRoot, p || ".")));

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

  // 6. baseline 기록 (issue #69) — 다음 업데이트에서 "누가 바꿨는지"를 가를 기준점.
  //    env 치환까지 전부 끝난 뒤에 해시해야 디스크 내용이 최종형이다. 그래서 copyWorkflows 안이
  //    아니라 여기서 기록한다.
  //    기존 baseline은 병합 대상 — 이번에 건드리지 않은 파일의 기준점을 잃지 않는다.
  writeBaseline(targetRoot, {
    templateVersion,
    installedAt: now || today || "",
    entries: computeBaselineEntries(
      wfCounters.baselineTargets || new Map(),
      join(targetRoot, PATHS.workflowsDir),
      makeSrcText(context.branches || null, context.deployStyle || "")),
    previous: readBaseline(targetRoot),
  });

  // 7. 설치 후 검증 (이슈 #81, #80) — 디스크에 실제로 쓰인 내용을 다시 읽어 확인한다.
  //    미치환 플레이스홀더가 남았는지, 어떤 Secret이 있어야 워크플로우가 도는지.
  //    설치를 실패시키지는 않는다 — 사실을 알려주는 것이 목적이고, 판단은 사용자 몫이다.
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  const managed = [...(wfCounters.baselineTargets || new Map()).keys()];
  const unresolved = scanUnsubstituted(wfDir, managed);
  const secrets = narrowSecretsBySshAuth(
    collectRequiredSecrets(wfDir, managed),
    firstDeployValue(deployValues, "SSH_AUTH_METHOD"),
  );

  // 고른 배포 방식이 아닌데 이미 깔려 있는 CD 워크플로우 (이슈 #80). 지우지 않는다 —
  // 사용자 파일이고 손댄 내용이 있을 수 있다. 다만 SIMPLE은 push 트리거가 살아 있어 두 배포가
  // 동시에 도는 상태가 되므로 완료 화면에서 반드시 알린다.
  const competing = competingDeployWorkflows(
    existsSync(wfDir) ? readdirSync(wfDir) : [], context.deployStyle || "");

  // 8. 설치 로그 (이슈 #79) — 이 실행에서 무엇을 어떤 값으로 설치했는지 레포에 남긴다.
  //    실패해도 설치는 성공으로 끝난다.
  const installLog = writeInstallLog(targetRoot, {
    action: context.previousTemplateVersion ? "update" : "install",
    at: now || today || "",
    templateVersion,
    previousTemplateVersion: context.previousTemplateVersion || "",
    mode: context.mode || "full",
    types, markers: context.markers || new Map(), version,
    versionSource: context.versionSource || "",
    branch, branches: context.branches, paths,
    options: {
      nexus: includeNexus,
      githubPackages: includeNexus,
      secretBackup: includeSecretBackup,
      semverAuto: includeSemverAuto !== false,
      deployStyle: context.deployStyle || "",
    },
    answers: context.envAnswers || [],
    warnings: context.detectWarnings || [],
    result: {
      copiedFiles: wfCounters.copiedFiles || [],
      gitignoreUpdated,
    },
    unresolved, secrets, competing,
  });

  return { workflows: wfCounters, gitignoreUpdated, unresolved, secrets, installLog, competing };
}

// deployValues는 Map<type, Map<key,value>> — 타입 구분 없이 첫 값만 필요할 때 쓴다.
function firstDeployValue(deployValues, key) {
  for (const [, asks] of deployValues) {
    const v = asks.get(key);
    if (v) return v;
  }
  return "";
}
