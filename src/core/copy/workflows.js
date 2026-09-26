// 워크플로우 복사 엔진 (.sh copy_workflows + _copy_workflows_for_type 등가).
// 실측: template_integrator.sh 3398~3815.
// 대화형 3지선(기존 파일 충돌)은 copyWorkflowsInteractive(async)가 결정 Map을 만들어
// 동기 엔진(copyWorkflows)에 hooks.decisions로 전달한다 — 기존 시그니처·force 동작 무변경.
import { join, basename } from "node:path";
import { deployFilter, isDeployWorkflow, activateDeployTrigger, DEFAULT_DEPLOY_STYLE, NO_DEPLOY_STYLE } from "../deploy-style.js";
import { storeWorkflowFilter } from "../flutter-options.js";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { PATHS, PAYLOAD } from "../paths.js";
import { exists, writeText, listYamlFiles } from "../fsutil.js";
import { substituteEnv } from "../wizard-env.js";
import { substitute } from "../branding.js";
import { sha256, readBaseline } from "../baseline.js";
import { log } from "../logger.js";

// 원본 텍스트 로더 — context.branches가 있으면 {{MAIN_BRANCH}}/{{DEVELOP_BRANCH}} 치환 적용.
// classify(unchanged 판정)와 실제 복사가 같은 치환본을 봐야 재실행 시 가짜 충돌이 없다.
export function makeSrcText(branches, deployStyle = DEFAULT_DEPLOY_STYLE) {
  return (p) => {
    const raw = readFileSync(p, "utf8");
    const out = branches ? substitute(raw, branches) : raw;
    // 고른 배포 방식의 CD는 push 트리거를 켜서 설치한다 — 설치했는데 안 도는 상태를 만들지 않는다.
    return isDeployWorkflow(basename(p)) ? activateDeployTrigger(out) : out;
  };
}

// trunk-based 모드에서 설치하지 않는 common 워크플로우 (DESIGN-SPEC §4 설치 매트릭스).
// 릴리스 PR 흐름이 없으므로 RELEASE-PUBLISH 하나가 bump→changelog→tag→Release를 흡수한다.
const TRUNK_BASED_EXCLUDED = new Set([
  "PROJECT-COMMON-VERSION-CONTROL.yaml",
  "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml",
]);

// 타입 루트 디렉토리에 거는 파일 필터 — "배포 안 함"의 CD 제외와 Flutter 스토어 대상 선택을 합성한다.
// copyWorkflowsForType·surveyWorkflows·planWorkflows가 같은 함수를 써야 설치·충돌 조사·status/dry-run이
// 서로 다른 파일 집합을 보지 않는다. flutterStore가 배열이 아니면(null=미결정, 비대화형 기본) 스토어 필터는
// 걸지 않는다. 필터가 없어도 항상 함수를 돌려준다 — processDir은 null을 받지 못한다.
export function buildTypeRootFilter(type, deployStyle, flutterStore) {
  const filters = [];
  if (deployStyle === NO_DEPLOY_STYLE) filters.push(deployFilter(deployStyle));
  if (type === "flutter" && Array.isArray(flutterStore)) filters.push(storeWorkflowFilter(flutterStore));
  return (filename) => filters.every((keep) => keep(filename));
}

// 한 파일에 env 치환을 적용해 대상 파일을 갱신 (.sh configure_workflow_env 등가).
// values/useDefaults: env 계획(promptEnvPlan) 결과 — 미지정이면 기본값 경로(현행 force 동작).
function configureEnv(targetPath, { type, projectPath = ".", repoName = "", resolvers = {}, collectAsks = null, values = new Map(), useDefaults = true }) {
  const content = readFileSync(targetPath, "utf8");
  if (!content.includes("@wizard")) return;
  const out = substituteEnv(content, { type, useDefaults, values, projectPath, repoName, resolvers, collectAsks });
  writeFileSync(targetPath, out);
}

// payload 원본을 "기본값으로 가상 치환한 최종형" — isUnchanged가 내부에서 쓰는 것과 같은 값이다.
// baseline.rendered와 비교해 "업스트림이 바뀌었는가"를 판정하는 데 쓴다.
function renderVirtual(templateContent, envOpts) {
  return substituteEnv(templateContent, { ...envOpts, useDefaults: true });
}

// 분류 — 대상 워크플로우 디렉토리 기준. srcText: 브랜치 치환이 적용된 원본 로더 (makeSrcText).
//
// baseline이 있으면 3-way로 가른다. base가 없던 시절에는 업스트림이 한 글자만 고쳐도
// 사용자가 손대지 않은 파일이 changed로 떨어져, "전부 skip" 아니면 "전부 backup" 둘 중 하나만
// 고를 수 있었다.
//
//   ours === theirs                    → unchanged     이미 최신, 할 일 없음
//   sha(ours) === base.installed       → upstreamOnly  사용자 미수정 → 질문 없이 교체
//   sha(theirs) === base.rendered      → localOnly     업스트림 그대로 → 질문 없이 유지
//   그 외                              → changed       진짜 충돌 → 질문
//   디스크에 없는데 baseline에 있음     → removed       사용자가 지움 → 되살리기 전에 물어봄
//
// baseline이 없는 기존 설치는 base 미상이라 upstreamOnly/localOnly 판정을 할 수 없고,
// 종전대로 unchanged/changed 2분류로 떨어진다(폴백). 그 실행에서 baseline이 심긴다.
function classify(srcDir, workflowsDir, envOpts, srcText, baseline = null, filter = null) {
  const result = { newFiles: [], unchanged: [], changed: [], upstreamOnly: [], localOnly: [], removed: [] };
  for (const filename of listYamlFiles(srcDir)) {
    if (filter && !filter(filename)) continue;
    const src = join(srcDir, filename);
    const dst = join(workflowsDir, filename);
    const base = baseline?.files?.[filename] || null;

    if (!existsSync(dst)) {
      // baseline에 있는데 디스크에 없다 = 우리가 깔았던 파일을 사용자가 지웠다.
      // 별도의 삭제 이력 파일이 필요 없다는 것이 baseline 설계의 부산물이다.
      if (base) result.removed.push(filename);
      else result.newFiles.push(filename);
      continue;
    }

    const tpl = srcText(src);
    const inst = readFileSync(dst, "utf8");
    const theirs = renderVirtual(tpl, envOpts);
    if (theirs === inst) { result.unchanged.push(filename); continue; }
    if (base?.installed && sha256(inst) === base.installed) { result.upstreamOnly.push(filename); continue; }
    if (base?.rendered && sha256(theirs) === base.rendered) { result.localOnly.push(filename); continue; }
    result.changed.push(filename);
  }
  return result;
}

// 한 원본 디렉토리를 분류 결과대로 처리한다. common·타입별·server-deploy가 같은 규칙을 쓴다.
// filter: trunk-based 제외 같은 파일 단위 필터.
//
// 자동 처리되는 두 버킷이 이 함수의 핵심이다:
//   upstreamOnly — 사용자가 손대지 않았으니 그냥 최신으로 교체한다. 물어볼 이유가 없다.
//   localOnly    — 업스트림이 그대로니 사용자 수정본을 그대로 둔다. 역시 물어볼 이유가 없다.
function processDir(srcDir, workflowsDir, envOpts, ctx, counters, filter = () => true) {
  const { srcText, baseline, decisions, restoreRemoved, baselineTargets } = ctx;
  const c = classify(srcDir, workflowsDir, envOpts, srcText, baseline);
  const track = (f, wrote) => baselineTargets.set(f, { srcPath: join(srcDir, f), envOpts, wrote });
  const write = (f) => { writeText(join(workflowsDir, f), srcText(join(srcDir, f))); counters.copied++; counters.copiedFiles.push(f); track(f, true); };

  for (const f of c.unchanged.filter(filter)) {
    counters.skipped++; counters.unchangedFiles.push(f); track(f, false);
    log.info("copy", "skip", `${f} (unchanged)`);
  }

  for (const f of c.localOnly.filter(filter)) {
    counters.skipped++; counters.keptLocal.push(f); track(f, false);
    log.info("copy", "keep-local", `${f} (업스트림 무변경, 사용자 수정본 유지)`);
  }

  for (const f of c.newFiles.filter(filter)) {
    write(f);
    log.info("copy", "write", `${f} (new)`);
  }

  for (const f of c.upstreamOnly.filter(filter)) {
    write(f); counters.autoUpdated.push(f);
    log.info("copy", "auto-update", `${f} (사용자 미수정, 최신으로 교체)`);
  }

  // 사용자가 지운 파일은 조용히 되살리지 않는다. 복원 결정이 있을 때만 다시 쓴다.
  // 되살리지 않은 파일은 baselineTargets에 넣지 않는다 — 디스크에 없어 해시할 것이 없고,
  // 기존 baseline 항목은 병합으로 남아 다음 실행에서도 "지운 파일"로 인식된다.
  for (const f of c.removed.filter(filter)) {
    if (restoreRemoved.has(f)) {
      write(f); counters.restoredFiles.push(f);
      log.info("copy", "restore", `${f} (사용자가 지웠지만 복원 결정)`);
    } else {
      counters.removedKept.push(f);
      log.info("copy", "removed-kept", `${f} (사용자가 지움, 되살리지 않음)`);
    }
  }

  for (const f of c.changed.filter(filter)) {
    const decision = decisions.get(f);
    applyDecision(decision, srcDir, workflowsDir, f, counters, srcText);
    // 'backup'만 대상 파일 자체를 새로 쓴다. 'template'은 다른 파일명이고 'skip'은 기존 유지.
    track(f, decision === "backup");
  }
  return c;
}

// copy_workflows 본체 (동기 — 기존 호출부 무변경).
// context: { types:[], paths:Map, force, repoName, resolvers,
//            envValues?:Map<key,value>, envUseDefaults?:boolean }  ← env 계획(promptEnvPlan) 결과 주입점
//            flutterStore?:string[]|null }  ← Flutter 스토어 대상 (null=필터 없음, 배열=선택된 플랫폼만)
// hooks: { decisions?: Map<filename, 'skip'|'backup'|'template'>,   — 진짜 충돌(changed) 결정
//          restoreRemoved?: Set<filename> }                          — 사용자가 지운 파일 중 복원할 것
//        미지정 파일은 'skip'(현행 force 동작 100% 유지). 대화형 수집은 copyWorkflowsInteractive 참조.
// 반환: {copied, skipped, templateAdded, optionalCopied, backupAdded, autoUpdated, keptLocal, removedKept, restoredFiles}
export function copyWorkflows(context, payloadRoot, targetRoot = ".", hooks = {}) {
  const { types = [], paths = new Map(), repoName = "", resolvers = {}, envValues = new Map(), envUseDefaults = true } = context;
  const decisions = hooks.decisions instanceof Map ? hooks.decisions : new Map();
  const restoreRemoved = hooks.restoreRemoved instanceof Set ? hooks.restoreRemoved : new Set();
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const projectTypesDir = join(payloadRoot, PAYLOAD.workflowsDir);
  if (!exists(projectTypesDir)) throw new Error("패키지 구조 오류 — payload/workflows 폴더를 찾지 못했습니다.");

  const counters = { copied: 0, skipped: 0, templateAdded: 0, optionalCopied: 0, backupAdded: 0 };
  const deployValues = new Map(); // Map<type, Map<key,value>> — deploy 블록용 ask 값
  counters.deployValues = deployValues;
  counters.copiedFiles = []; // 이번 실행에서 실제로 새로 쓰여진 파일명 (printSummary 정확성용)
  counters.unchangedFiles = []; // skip(unchanged) 대상 — 로그에서 "왜 안 바뀌었나"의 근거
  counters.autoUpdated = [];    // 질문 없이 최신으로 교체된 파일 (사용자 미수정)
  counters.keptLocal = [];      // 질문 없이 사용자 수정본을 유지한 파일 (업스트림 무변경)
  counters.removedKept = [];    // 사용자가 지웠고 되살리지 않은 파일
  counters.restoredFiles = [];  // 사용자가 지웠지만 복원하기로 한 파일
  const deployStyle = context.deployStyle || DEFAULT_DEPLOY_STYLE;
  const srcText = makeSrcText(context.branches || null, deployStyle);
  const baseline = readBaseline(targetRoot);
  const baselineTargets = new Map(); // filename -> { srcPath, envOpts, wrote }
  // values/useDefaults는 치환 경로에서만 의미 (renderVirtual은 useDefaults:true 강제 — 가상 비교 무손상)
  const envOptsFor = (type) => ({ type, projectPath: paths.get(type) || ".", repoName, resolvers, values: envValues, useDefaults: envUseDefaults });
  const dirCtx = { srcText, baseline, decisions, restoreRemoved, baselineTargets };

  // (1) common — 타입별과 동일 규칙 (README 계약).
  //     trunk-based 모드는 VERSION-CONTROL·AUTO-CHANGELOG 미설치 (RELEASE-PUBLISH 단독).
  const branchMode = context.branches?.mode || "pr-flow";
  const commonDir = join(projectTypesDir, "common");
  if (exists(commonDir)) {
    const notExcluded = (filename) => !(branchMode === "trunk-based" && TRUNK_BASED_EXCLUDED.has(filename));
    const c = processDir(commonDir, workflowsDir, envOptsFor("common"), dirCtx, counters, notExcluded);
    // env 치환 — 타입별 폴더(copyWorkflowsForType)와 동일하게, 손대지 않기로 한 파일(unchanged/localOnly)은
    // 건너뛴다. common 최상위는 지금까지 @wizard 마커가 없어 이 루프가 없어도 드러나지 않았지만,
    // ISSUE_HELPER_CREATE_BRANCH부터는 실제로 값이 반영돼야 한다.
    const untouched = [...c.unchanged, ...c.localOnly];
    for (const filename of listYamlFiles(commonDir)) {
      if (!notExcluded(filename)) continue;
      const target = join(workflowsDir, filename);
      if (!existsSync(target)) continue;
      if (untouched.includes(filename)) continue;
      configureEnv(target, envOptsFor("common"));
    }
  }

  // (2~4) 타입별
  for (const type of types) {
    const asks = new Map();
    copyWorkflowsForType(type, projectTypesDir, workflowsDir, { ...context, deployStyle, envOptsFor, collectAsks: asks, dirCtx }, counters);
    if (asks.size) deployValues.set(type, asks);
  }

  counters.baselineTargets = baselineTargets; // 호출부(runFull)가 env 치환 완료 후 baseline을 기록한다
  return counters;
}

// copyWorkflows가 끝나고 env 치환까지 마친 뒤에 호출한다 — 그래야 디스크 내용이 최종형이다.
// entries: Map<filename, {installed:string|null, rendered:string}>
export function computeBaselineEntries(baselineTargets, workflowsDir, srcText) {
  const entries = new Map();
  for (const [filename, info] of baselineTargets) {
    const dst = join(workflowsDir, filename);
    if (!existsSync(dst)) continue;
    const rendered = sha256(renderVirtual(srcText(info.srcPath), info.envOpts));
    // installed는 이번에 우리가 쓴 파일에만 채운다. 사용자 수정본을 installed로 기록하면
    // "우리가 쓴 것"이라고 거짓말하는 셈이고, 다음 업데이트에서 그 파일이 조용히 덮인다.
    entries.set(filename, { installed: info.wrote ? sha256(readFileSync(dst, "utf8")) : null, rendered });
  }
  return entries;
}

// changed(기존에 있고 내용이 바뀐) 파일 1개를 결정에 따라 처리 (.sh 3440~3508 3지선 case 등가).
// 'skip'(기본): 기존 유지. 'backup': 기존→.bak 후 교체. 'template': 기존 유지 + 새 버전을 .template.yaml로.
function applyDecision(decision, srcDir, workflowsDir, filename, counters, srcText) {
  const src = join(srcDir, filename);
  const dst = join(workflowsDir, filename);
  if (decision === "backup") {
    // .sh O) mv → cp: 기존을 .bak으로 백업 후 새 버전으로 교체
    renameSync(dst, dst + ".bak");
    writeText(dst, srcText(src));
    counters.copied++;
    counters.backupAdded++;
    counters.copiedFiles.push(filename);
    log.info("copy", "backup", `${filename} → ${filename}.bak (사용자 결정, 새 버전으로 교체)`);
    return;
  }
  if (decision === "template") {
    // .sh T) `${filename%.yaml}.template.yaml` — .yaml만 strip (.yml은 그대로 뒤에 붙음, .sh 동일)
    const templateName = (filename.endsWith(".yaml") ? filename.slice(0, -".yaml".length) : filename) + ".template.yaml";
    writeText(join(workflowsDir, templateName), srcText(src)); // 기존 .template.yaml 덮어씀(.sh rm -f + cp 등가)
    counters.templateAdded++;
    counters.copiedFiles.push(templateName);
    log.info("copy", "template", `${filename} 유지 + ${templateName} 생성 (사용자 결정)`);
    return;
  }
  counters.skipped++; // 'skip'/미지정/ESC → 기존 유지 (.sh S)·force 기본)
  log.info("copy", "skip", `${filename} (사용자 결정: 기존 유지)`);
}

// 대화형 사전 조사 — 사람이 답해야 하는 것만 뽑는다.
// copyWorkflows 본체와 동일한 classify 기준을 써야 결정 Map이 실제 처리 대상과 1:1로 맞는다.
// common도 타입별과 동일하게 스캔한다 (이전에는 common 충돌이 질문조차 되지 않았다).
// 반환: { conflicts: [{filename,type}], removed: [{filename,type}] }
//   conflicts — 양쪽이 다 바뀐 진짜 충돌. upstreamOnly/localOnly는 자동 처리되므로 여기 없다.
//   removed   — 우리가 깔았는데 사용자가 지운 파일. 되살리기 전에 물어봐야 한다.
export function surveyWorkflows(context, payloadRoot, targetRoot = ".") {
  const { types = [], paths = new Map(), repoName = "", resolvers = {}, flutterStore = null } = context;
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const projectTypesDir = join(payloadRoot, PAYLOAD.workflowsDir);
  const deployStyle = context.deployStyle || DEFAULT_DEPLOY_STYLE;
  const srcText = makeSrcText(context.branches || null, deployStyle);
  const baseline = readBaseline(targetRoot);
  const branchMode = context.branches?.mode || "pr-flow";
  const conflicts = []; // 엔진 처리 순서와 동일 (common → 타입 순회 → 직하위 → server-deploy)
  const removed = [];

  const keepDeploy = deployFilter(deployStyle);
  const collect = (srcDir, envOpts, type, skipFile = () => false, filter = null) => {
    const c = classify(srcDir, workflowsDir, envOpts, srcText, baseline, filter);
    for (const f of c.changed) { if (!skipFile(f)) conflicts.push({ filename: f, type }); }
    for (const f of c.removed) { if (!skipFile(f)) removed.push({ filename: f, type }); }
  };

  const commonDir = join(projectTypesDir, "common");
  if (exists(commonDir)) {
    collect(commonDir, { type: "common", projectPath: ".", repoName, resolvers }, "common",
      (f) => branchMode === "trunk-based" && TRUNK_BASED_EXCLUDED.has(f));
  }

  for (const type of types) {
    const envOpts = { type, projectPath: paths.get(type) || ".", repoName, resolvers };
    const typeDir = join(projectTypesDir, type);
    if (exists(typeDir)) {
      collect(typeDir, envOpts, type, () => false, buildTypeRootFilter(type, deployStyle, flutterStore));
    }
    const serverDeployDir = join(typeDir, "server-deploy");
    if (exists(serverDeployDir) && deployStyle !== NO_DEPLOY_STYLE) {
      collect(serverDeployDir, envOpts, type, () => false, keepDeploy);
    }
  }
  return { conflicts, removed };
}

// 진짜 충돌 목록만 필요할 때 (기존 호출부 호환).
export function listWorkflowConflicts(context, payloadRoot, targetRoot = ".") {
  return surveyWorkflows(context, payloadRoot, targetRoot).conflicts;
}

// 대화형 진입점 (async) — 충돌마다 onConflict(filename, type)를 await해 결정 Map을 만든 뒤
// 동기 엔진에 위임한다. WHY 분리: copyWorkflows를 async로 바꾸면 await 없이 호출하는
// 기존 호출부(runFull)가 깨진다 — 시그니처 무변경 원칙.
// onConflict 반환값: 'template' | 'skip' | 'backup' (그 외/미지정 → 'skip').
export async function copyWorkflowsInteractive(context, payloadRoot, targetRoot = ".", { onConflict } = {}) {
  const decisions = new Map();
  if (typeof onConflict === "function") {
    for (const { filename, type } of listWorkflowConflicts(context, payloadRoot, targetRoot)) {
      if (decisions.has(filename)) continue; // 파일명은 PROJECT-{TYPE}- prefix로 타입 간 유일
      decisions.set(filename, await onConflict(filename, type));
    }
  }
  return copyWorkflows(context, payloadRoot, targetRoot, { decisions });
}

function copyWorkflowsForType(type, projectTypesDir, workflowsDir, ctx, counters) {
  const { deployStyle = "", flutterStore = null, envOptsFor, collectAsks = null, dirCtx } = ctx;
  const keepDeploy = deployFilter(deployStyle);
  const keepTypeRoot = buildTypeRootFilter(type, deployStyle, flutterStore);
  const { srcText, baselineTargets } = dirCtx;
  const typeDir = join(projectTypesDir, type);
  const envOpts = envOptsFor(type);
  // env 치환에서 제외할 파일 — 손대지 않기로 한 것들(unchanged/localOnly/유지된 삭제분)에
  // 치환을 다시 걸면 사용자 수정본을 덮어쓰게 된다.
  const untouched = [];

  // 타입별 워크플로우 (직하위). go/python처럼 CD 워크플로우가 server-deploy 없이 타입 루트에
  // 바로 있는 타입도 있다 — "배포 안 함"일 때는 타입 루트에서도 CD 파일(SIMPLE-CICD 등)을
  // 걸러야 한다. simple/nginx/traefik은 오늘과 동일하게 필터 없이 전부 복사한다.
  if (exists(typeDir)) {
    const c = processDir(typeDir, workflowsDir, envOpts, dirCtx, counters, keepTypeRoot);
    untouched.push(...c.unchanged, ...c.localOnly);
  }

  // server-deploy
  const serverDeployDir = join(typeDir, "server-deploy");
  // "배포 안 함"이면 폴더째 제외 (복사 안 함)
  if (exists(serverDeployDir) && deployStyle !== NO_DEPLOY_STYLE) {
    const c = processDir(serverDeployDir, workflowsDir, envOpts, dirCtx, counters, keepDeploy);
    untouched.push(...c.unchanged, ...c.localOnly);
  }

  // env 치환 — 이 타입의 원본 디렉토리들에서 복사돼 존재하고, 손대지 않기로 한 것이 아닌 파일만
  for (const srcDir of [typeDir, serverDeployDir]) {
    if (!exists(srcDir)) continue;
    if (srcDir === serverDeployDir && deployStyle === NO_DEPLOY_STYLE) continue; // 폴더째 제외
    for (const filename of listYamlFiles(srcDir)) {
      const target = join(workflowsDir, filename);
      if (srcDir === serverDeployDir && !keepDeploy(filename)) continue; // 안 고른 배포 방식
      if (srcDir === typeDir && !keepTypeRoot(filename)) continue; // 타입 루트: 배제된 CD·안 고른 스토어 워크플로우
      if (!existsSync(target)) continue;          // 건너뛴 파일 제외
      if (untouched.includes(filename)) continue; // unchanged/localOnly 제외
      configureEnv(target, { ...envOpts, collectAsks }); // env 계획 values/useDefaults 포함
    }
  }
}

// 전체 워크플로우 분류(common + 타입별 + server-deploy) — status/dry-run 공용.
// changed뿐 아니라 newFiles/unchanged까지 전부 반환한다는 점이 listWorkflowConflicts(changed만
// 반환)와 다르다(읽기 전용 — 실제로 아무 파일도 쓰지 않는다).
export function planWorkflows(context, payloadRoot, targetRoot = ".") {
  const { types = [], paths = new Map(), repoName = "", resolvers = {}, flutterStore = null } = context;
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const projectTypesDir = join(payloadRoot, PAYLOAD.workflowsDir);
  const deployStyle = context.deployStyle || DEFAULT_DEPLOY_STYLE;
  const srcText = makeSrcText(context.branches || null, deployStyle);
  const baseline = readBaseline(targetRoot);
  const branchMode = context.branches?.mode || "pr-flow";
  // upstreamOnly/localOnly/removed는 baseline이 있을 때만 채워진다.
  const plan = { newFiles: [], unchanged: [], changed: [], upstreamOnly: [], localOnly: [], removed: [] };
  const BUCKETS = ["newFiles", "unchanged", "changed", "upstreamOnly", "localOnly", "removed"];

  const merge = (result, type, excluded = null) => {
    for (const bucket of BUCKETS) {
      for (const filename of result[bucket]) {
        if (excluded && excluded.has(filename)) continue;
        plan[bucket].push({ filename, type });
      }
    }
  };

  const commonDir = join(projectTypesDir, "common");
  if (exists(commonDir)) {
    const envOpts = { type: "common", projectPath: ".", repoName, resolvers };
    merge(classify(commonDir, workflowsDir, envOpts, srcText, baseline), "common",
      branchMode === "trunk-based" ? TRUNK_BASED_EXCLUDED : null);
  }

  for (const type of types) {
    const envOpts = { type, projectPath: paths.get(type) || ".", repoName, resolvers };
    const typeDir = join(projectTypesDir, type);
    if (exists(typeDir)) {
      merge(classify(typeDir, workflowsDir, envOpts, srcText, baseline, buildTypeRootFilter(type, deployStyle, flutterStore)), type);
    }

    const serverDeployDir = join(typeDir, "server-deploy");
    if (exists(serverDeployDir) && deployStyle !== NO_DEPLOY_STYLE) {
      merge(classify(serverDeployDir, workflowsDir, envOpts, srcText, baseline, deployFilter(deployStyle)), type);
    }
  }

  return plan;
}
