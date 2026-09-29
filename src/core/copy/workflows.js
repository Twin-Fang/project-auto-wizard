// 워크플로우 복사 엔진 — common → 타입별 → server-deploy 순으로 분류·복사·치환한다.
// 대화형 3지선(기존 파일 충돌)은 copyWorkflowsInteractive(async)가 결정 Map을 만들어
// 동기 엔진(copyWorkflows)에 hooks.decisions로 전달한다 — 기존 시그니처·force 동작 무변경.
import { join, basename } from "node:path";
import {
  deployFilter, isDeployWorkflow, activateDeployTrigger, payloadWorkflowNames, DEFAULT_DEPLOY_STYLE, NO_DEPLOY_STYLE,
} from "../deploy-style.js";
import { storeWorkflowFilter } from "../flutter-options.js";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { PATHS, PAYLOAD, typeWorkflowDirs } from "../paths.js";
import { exists, writeText, listYamlFiles } from "../fsutil.js";
import { substituteEnv } from "../wizard-env.js";
import { substitute } from "../branding.js";
import { sha256, readBaseline } from "../baseline.js";
import { parseDeployBlock } from "../version-yml.js";
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

// trunk-based 모드에서 설치하지 않는 common 워크플로우.
// 릴리스 PR 흐름이 없으므로 RELEASE-PUBLISH 하나가 bump→changelog→tag→Release를 흡수한다.
const TRUNK_BASED_EXCLUDED = new Set([
  "PROJECT-COMMON-VERSION-CONTROL.yaml",
  "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml",
]);

// version.yml deploy 블록에 저장된 배포 값 — Map<type, Map<key,value>>.
// 설치·분류·baseline이 같은 값을 기본값으로 써야 재실행 때 가짜 변경이 생기지 않는다.
export function readSavedDeployValues(targetRoot = ".") {
  const p = join(targetRoot, PATHS.versionFile);
  if (!existsSync(p)) return new Map();
  return parseDeployBlock(readFileSync(p, "utf8"));
}

// 타입 루트 디렉토리에 거는 파일 필터 — 배포 방식 필터와 Flutter 스토어 대상 선택을 합성한다.
// copyWorkflowsForType·surveyWorkflows·planWorkflows가 같은 함수를 써야 설치·충돌 조사·status/dry-run이
// 서로 다른 파일 집합을 보지 않는다. flutterStore가 배열이 아니면(null=미결정, 비대화형 기본) 스토어 필터는
// 걸지 않는다. 필터가 없어도 항상 함수를 돌려준다 — processDir은 null을 받지 못한다.
// go/python·react/next처럼 서버 배포 워크플로우가 타입 루트에 바로 있는 타입도 있어 배포 방식 필터를
// 항상 건다. available(payload 파일명 집합)이 있어야 고른 방식이 없는 타입을 단일 서버 배포로 대체한다.
export function buildTypeRootFilter(type, deployStyle, flutterStore, available = null) {
  const filters = [];
  if (deployStyle) filters.push(deployFilter(deployStyle, available));
  if (type === "flutter" && Array.isArray(flutterStore)) filters.push(storeWorkflowFilter(flutterStore));
  return (filename) => filters.every((keep) => keep(filename));
}

// 한 타입이 설치하는 원본 디렉토리를 순서대로 돌려준다 — 타입 루트 → server-deploy.
// 각 항목: { srcDir, type, filter }. 폴더 존재 여부와 "배포 안 함" 제외를 여기서 한 번에 판단한다.
export function typeWorkflowSources(type, payloadRoot, { deployStyle, flutterStore = null, available = null }) {
  const [typeDir, serverDeployDir] = typeWorkflowDirs(payloadRoot, type);
  const sources = [];
  // go/python·react/next처럼 서버 배포 워크플로우가 타입 루트에 바로 있는 타입도 있어 루트에도 배포 방식 필터를 건다.
  if (exists(typeDir)) sources.push({ srcDir: typeDir, type, filter: buildTypeRootFilter(type, deployStyle, flutterStore, available) });
  // "배포 안 함"이면 폴더째 제외
  if (exists(serverDeployDir) && deployStyle !== NO_DEPLOY_STYLE) {
    sources.push({ srcDir: serverDeployDir, type, filter: deployFilter(deployStyle, available) });
  }
  return sources;
}

// common 원본 — trunk-based 모드의 제외 필터를 반영한다. 폴더가 없으면 null.
export function commonWorkflowSource(context, payloadRoot) {
  const commonDir = join(payloadRoot, PAYLOAD.workflowsDir, "common");
  if (!exists(commonDir)) return null;
  const branchMode = context.branches?.mode || "pr-flow";
  return {
    srcDir: commonDir, type: "common",
    filter: (filename) => !(branchMode === "trunk-based" && TRUNK_BASED_EXCLUDED.has(filename)),
  };
}

// 설치 대상 워크플로우 원본을 엔진 처리 순서(common → 타입 순회 → 타입 루트 → server-deploy)로 내준다.
// 복사·충돌 조사·미리보기 계획이 모두 이 순회를 써야 서로 다른 파일 집합을 보지 않는다.
export function* workflowSources(context, payloadRoot, { deployStyle, available }) {
  const { types = [], flutterStore = null } = context;
  const common = commonWorkflowSource(context, payloadRoot);
  if (common) yield common;
  for (const type of types) yield* typeWorkflowSources(type, payloadRoot, { deployStyle, flutterStore, available });
}

// 한 파일에 env 치환을 적용해 대상 파일을 갱신.
// values/useDefaults: env 계획(promptEnvPlan) 결과 — 미지정이면 기본값 경로(현행 force 동작).
function configureEnv(targetPath, { type, projectPath = ".", repoName = "", resolvers = {}, collectAsks = null, values = new Map(), useDefaults = true, savedValues = null }) {
  const content = readFileSync(targetPath, "utf8");
  if (!content.includes("@wizard")) return;
  const out = substituteEnv(content, { type, useDefaults, values, projectPath, repoName, resolvers, collectAsks, savedValues });
  writeFileSync(targetPath, out);
}

// payload 원본을 "이번 실행이 쓸 값으로 가상 치환한 최종형" — 저장된 deploy 값(없으면 기본값)과
// 이번에 답한 값을 반영한다. 기본값만 쓰면 기본값이 아닌 값으로 설치한 파일이 재실행마다 변경으로
// 잡혀, 다시 쓰이면서 답한 값이 기본값으로 되돌아간다.
// baseline.rendered와 비교해 "업스트림이 바뀌었는가"를 판정하는 데 쓴다.
function renderVirtual(templateContent, envOpts) {
  return substituteEnv(templateContent, { useDefaults: true, ...envOpts, collectAsks: null });
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
  const track = (f, wrote, keepRendered = false) => baselineTargets.set(f, { srcPath: join(srcDir, f), envOpts, wrote, keepRendered });
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
    // skip은 업스트림 변경을 받지 않은 것이라 rendered를 예전 값으로 둔다 — 새 값으로 바꾸면 다음 실행에서
    // "업스트림 무변경"으로 분류되어 그 변경을 영영 받을 수 없다.
    const kept = decision !== "backup" && decision !== "template";
    if (kept) counters.conflictKept.push(f);
    track(f, decision === "backup", kept);
  }
  return c;
}

// 복사 엔진 본체 (동기 — 기존 호출부 무변경).
// context: { types:[], paths:Map, force, repoName, resolvers,
//            envValues?:Map<key,value>, envUseDefaults?:boolean }  ← env 계획(promptEnvPlan) 결과 주입점
//            flutterStore?:string[]|null }  ← Flutter 스토어 대상 (null=필터 없음, 배열=선택된 플랫폼만)
// hooks: { decisions?: Map<filename, 'skip'|'backup'|'template'>,   — 진짜 충돌(changed) 결정
//          restoreRemoved?: Set<filename> }                          — 사용자가 지운 파일 중 복원할 것
//        미지정 파일은 'skip'(현행 force 동작 100% 유지). 대화형 수집은 copyWorkflowsInteractive 참조.
// 반환: {copied, skipped, templateAdded, backupAdded, autoUpdated, keptLocal, removedKept, restoredFiles}
export function copyWorkflows(context, payloadRoot, targetRoot = ".", hooks = {}) {
  const { types = [], paths = new Map(), repoName = "", resolvers = {}, envValues = new Map(), envUseDefaults = true } = context;
  const decisions = hooks.decisions instanceof Map ? hooks.decisions : new Map();
  const restoreRemoved = hooks.restoreRemoved instanceof Set ? hooks.restoreRemoved : new Set();
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const projectTypesDir = join(payloadRoot, PAYLOAD.workflowsDir);
  if (!exists(projectTypesDir)) throw new Error("패키지 구조 오류 — payload/workflows 폴더를 찾지 못했습니다.");

  const counters = { copied: 0, skipped: 0, templateAdded: 0, backupAdded: 0 };
  const deployValues = new Map(); // Map<type, Map<key,value>> — deploy 블록용 ask 값
  counters.deployValues = deployValues;
  counters.copiedFiles = []; // 이번 실행에서 실제로 새로 쓰여진 파일명 (printSummary 정확성용)
  counters.unchangedFiles = []; // skip(unchanged) 대상 — 로그에서 "왜 안 바뀌었나"의 근거
  counters.autoUpdated = [];    // 질문 없이 최신으로 교체된 파일 (사용자 미수정)
  counters.keptLocal = [];      // 질문 없이 사용자 수정본을 유지한 파일 (업스트림 무변경)
  counters.removedKept = [];    // 사용자가 지웠고 되살리지 않은 파일
  counters.restoredFiles = [];  // 사용자가 지웠지만 복원하기로 한 파일
  counters.conflictKept = [];   // 양쪽이 다 바뀌어 기존 파일을 유지한 파일 (업스트림 변경 미반영)
  const deployStyle = context.deployStyle || DEFAULT_DEPLOY_STYLE;
  const srcText = makeSrcText(context.branches || null, deployStyle);
  const baseline = readBaseline(targetRoot);
  const baselineTargets = new Map(); // filename -> { srcPath, envOpts, wrote }
  // values/useDefaults는 치환 경로에서만 의미 (renderVirtual은 useDefaults:true 강제 — 가상 비교 무손상)
  const saved = readSavedDeployValues(targetRoot);
  const envOptsFor = (type) => ({
    type, projectPath: paths.get(type) || ".", repoName, resolvers, values: envValues, useDefaults: envUseDefaults,
    savedValues: saved.get(type) || null,
  });
  const available = payloadWorkflowNames(payloadRoot);
  const dirCtx = { srcText, baseline, decisions, restoreRemoved, baselineTargets, available };

  // (1) common — 타입별과 동일 규칙 (README 계약).
  //     trunk-based 모드는 VERSION-CONTROL·AUTO-CHANGELOG 미설치 (RELEASE-PUBLISH 단독).
  const commonSource = commonWorkflowSource(context, payloadRoot);
  if (commonSource) {
    const { srcDir: commonDir, filter: notExcluded } = commonSource;
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
    copyWorkflowsForType(type, payloadRoot, workflowsDir, { ...context, deployStyle, envOptsFor, collectAsks: asks, dirCtx }, counters);
    if (asks.size) deployValues.set(type, asks);
  }

  counters.baselineTargets = baselineTargets; // 호출부(runFull)가 env 치환 완료 후 baseline을 기록한다
  return counters;
}

// copyWorkflows가 끝나고 env 치환까지 마친 뒤에 호출한다 — 그래야 디스크 내용이 최종형이다.
// entries: Map<filename, {installed:string|null, rendered:string}>
// savedDeploy: 이번 실행이 version.yml deploy 블록에 쓴 값(Map<type, Map<key,value>>). 다음 실행은 이 값을
// 기본값으로 분류하므로 rendered도 같은 값으로 계산해야 재실행이 "업스트림 변경"으로 오인되지 않는다.
export function computeBaselineEntries(baselineTargets, workflowsDir, srcText, savedDeploy = null) {
  const entries = new Map();
  for (const [filename, info] of baselineTargets) {
    const dst = join(workflowsDir, filename);
    if (!existsSync(dst)) continue;
    const envOpts = savedDeploy ? { ...info.envOpts, savedValues: savedDeploy.get(info.envOpts.type) || null } : info.envOpts;
    // keepRendered: 충돌로 기존 파일을 유지함 — 예전 rendered를 그대로 두도록 null로 넘긴다(writeBaseline이 병합).
    const rendered = info.keepRendered ? null : sha256(renderVirtual(srcText(info.srcPath), envOpts));
    // installed는 이번에 우리가 쓴 파일에만 채운다. 사용자 수정본을 installed로 기록하면
    // "우리가 쓴 것"이라고 거짓말하는 셈이고, 다음 업데이트에서 그 파일이 조용히 덮인다.
    entries.set(filename, { installed: info.wrote ? sha256(readFileSync(dst, "utf8")) : null, rendered });
  }
  return entries;
}

// changed(기존에 있고 내용이 바뀐) 파일 1개를 결정에 따라 처리.
// 'skip'(기본): 기존 유지. 'backup': 기존→.bak 후 교체. 'template': 기존 유지 + 새 버전을 .template.yaml로.
function applyDecision(decision, srcDir, workflowsDir, filename, counters, srcText) {
  const src = join(srcDir, filename);
  const dst = join(workflowsDir, filename);
  if (decision === "backup") {
    // 기존을 .bak으로 백업 후 새 버전으로 교체
    renameSync(dst, dst + ".bak");
    writeText(dst, srcText(src));
    counters.copied++;
    counters.backupAdded++;
    counters.copiedFiles.push(filename);
    log.info("copy", "backup", `${filename} → ${filename}.bak (사용자 결정, 새 버전으로 교체)`);
    return;
  }
  if (decision === "template") {
    // `${이름}.template.yaml` — .yaml만 떼고 붙인다 (.yml은 그대로 뒤에 붙는다)
    const templateName = (filename.endsWith(".yaml") ? filename.slice(0, -".yaml".length) : filename) + ".template.yaml";
    writeText(join(workflowsDir, templateName), srcText(src)); // 기존 .template.yaml 덮어씀
    counters.templateAdded++;
    counters.copiedFiles.push(templateName);
    log.info("copy", "template", `${filename} 유지 + ${templateName} 생성 (사용자 결정)`);
    return;
  }
  counters.skipped++; // 'skip'/미지정/ESC → 기존 유지 (force 기본)
  // 결정이 없으면 사용자가 고른 게 아니라 --force 기본값이다 — 로그가 사실과 달라지지 않게 구분한다.
  log.info("copy", "skip", decision
    ? `${filename} (사용자 결정: 기존 유지, 업스트림 변경 미반영)`
    : `${filename} (--force 기본값: 기존 유지, 업스트림 변경 미반영)`);
}

// 대화형 사전 조사 — 사람이 답해야 하는 것만 뽑는다.
// copyWorkflows 본체와 동일한 classify 기준을 써야 결정 Map이 실제 처리 대상과 1:1로 맞는다.
// common도 타입별과 동일하게 스캔한다 (이전에는 common 충돌이 질문조차 되지 않았다).
// 반환: { conflicts: [{filename,type}], removed: [{filename,type}] }
//   conflicts — 양쪽이 다 바뀐 진짜 충돌. upstreamOnly/localOnly는 자동 처리되므로 여기 없다.
//   removed   — 우리가 깔았는데 사용자가 지운 파일. 되살리기 전에 물어봐야 한다.
export function surveyWorkflows(context, payloadRoot, targetRoot = ".") {
  const { paths = new Map(), repoName = "", resolvers = {} } = context;
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const deployStyle = context.deployStyle || DEFAULT_DEPLOY_STYLE;
  const srcText = makeSrcText(context.branches || null, deployStyle);
  const baseline = readBaseline(targetRoot);
  const saved = readSavedDeployValues(targetRoot);
  const conflicts = []; // 엔진 처리 순서와 동일 (common → 타입 순회 → 직하위 → server-deploy)
  const removed = [];
  const available = payloadWorkflowNames(payloadRoot);
  const values = context.envValues || new Map();
  const useDefaults = context.envUseDefaults !== false;

  for (const { srcDir, type, filter } of workflowSources(context, payloadRoot, { deployStyle, available })) {
    // 복사 엔진과 같은 값(이번 답변 포함)으로 분류해야 결정 목록이 실제 처리 대상과 맞는다.
    const envOpts = type === "common"
      ? { type, projectPath: ".", repoName, resolvers, values, useDefaults }
      : { type, projectPath: paths.get(type) || ".", repoName, resolvers, savedValues: saved.get(type) || null, values, useDefaults };
    const c = classify(srcDir, workflowsDir, envOpts, srcText, baseline, filter);
    for (const f of c.changed) conflicts.push({ filename: f, type });
    for (const f of c.removed) removed.push({ filename: f, type });
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

function copyWorkflowsForType(type, payloadRoot, workflowsDir, ctx, counters) {
  const { deployStyle = "", flutterStore = null, envOptsFor, collectAsks = null, dirCtx } = ctx;
  const { srcText } = dirCtx;
  const sources = typeWorkflowSources(type, payloadRoot, { deployStyle, flutterStore, available: dirCtx.available });
  const envOpts = envOptsFor(type);
  // env 치환에서 제외할 파일 — 손대지 않기로 한 것들(unchanged/localOnly/유지된 삭제분)에
  // 치환을 다시 걸면 사용자 수정본을 덮어쓰게 된다.
  const untouched = [];

  for (const { srcDir, filter } of sources) {
    const c = processDir(srcDir, workflowsDir, envOpts, dirCtx, counters, filter);
    untouched.push(...c.unchanged, ...c.localOnly);
  }

  // env 치환 — 이 타입의 원본 디렉토리들에서 복사돼 존재하고, 손대지 않기로 한 것이 아닌 파일만
  for (const { srcDir, filter } of sources) {
    for (const filename of listYamlFiles(srcDir)) {
      const target = join(workflowsDir, filename);
      if (!filter(filename)) continue; // 배제된 CD·안 고른 배포 방식·안 고른 스토어 워크플로우
      if (!existsSync(target)) continue;          // 건너뛴 파일 제외
      // unchanged/localOnly와 치환 마커가 이미 없는 유지본은 다시 치환하지 않는다. 대신 deploy 블록이
      // 사라지지 않도록 저장값(없으면 기본값)으로 ask 값만 수집한다 — 파일은 건드리지 않는다.
      if (untouched.includes(filename) || !readFileSync(target, "utf8").includes("@wizard")) {
        if (collectAsks) substituteEnv(srcText(join(srcDir, filename)), { ...envOpts, useDefaults: true, collectAsks });
        continue;
      }
      configureEnv(target, { ...envOpts, collectAsks }); // env 계획 values/useDefaults 포함
    }
  }
}

// 전체 워크플로우 분류(common + 타입별 + server-deploy) — status/dry-run 공용.
// changed뿐 아니라 newFiles/unchanged까지 전부 반환한다는 점이 listWorkflowConflicts(changed만
// 반환)와 다르다(읽기 전용 — 실제로 아무 파일도 쓰지 않는다).
export function planWorkflows(context, payloadRoot, targetRoot = ".") {
  const { paths = new Map(), repoName = "", resolvers = {} } = context;
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const deployStyle = context.deployStyle || DEFAULT_DEPLOY_STYLE;
  const srcText = makeSrcText(context.branches || null, deployStyle);
  const baseline = readBaseline(targetRoot);
  const saved = readSavedDeployValues(targetRoot);
  const available = payloadWorkflowNames(payloadRoot);
  // upstreamOnly/localOnly/removed는 baseline이 있을 때만 채워진다.
  const plan = { newFiles: [], unchanged: [], changed: [], upstreamOnly: [], localOnly: [], removed: [] };
  const BUCKETS = ["newFiles", "unchanged", "changed", "upstreamOnly", "localOnly", "removed"];

  for (const { srcDir, type, filter } of workflowSources(context, payloadRoot, { deployStyle, available })) {
    const envOpts = type === "common"
      ? { type, projectPath: ".", repoName, resolvers }
      : { type, projectPath: paths.get(type) || ".", repoName, resolvers, savedValues: saved.get(type) || null };
    const result = classify(srcDir, workflowsDir, envOpts, srcText, baseline, filter);
    for (const bucket of BUCKETS) {
      for (const filename of result[bucket]) plan[bucket].push({ filename, type });
    }
  }

  return plan;
}
