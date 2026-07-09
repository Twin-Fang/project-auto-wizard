// 워크플로우 복사 엔진 (.sh copy_workflows + _copy_workflows_for_type 등가).
// 실측: template_integrator.sh 3398~3815.
// 대화형 3지선(기존 파일 충돌)은 copyWorkflowsInteractive(async)가 결정 Map을 만들어
// 동기 엔진(copyWorkflows)에 hooks.decisions로 전달한다 — 기존 시그니처·force 동작 무변경.
import { join, basename } from "node:path";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { PATHS, PAYLOAD } from "../paths.js";
import { exists, writeText, listYamlFiles } from "../fsutil.js";
import { isUnchanged, substituteEnv } from "../wizard-env.js";
import { substitute } from "../branding.js";

// 원본 텍스트 로더 — context.branches가 있으면 {{MAIN_BRANCH}}/{{DEVELOP_BRANCH}} 치환 적용.
// classify(unchanged 판정)와 실제 복사가 같은 치환본을 봐야 재실행 시 가짜 충돌이 없다.
function makeSrcText(branches) {
  return (p) => {
    const raw = readFileSync(p, "utf8");
    return branches ? substitute(raw, branches) : raw;
  };
}

// trunk-based 모드에서 설치하지 않는 common 워크플로우 (DESIGN-SPEC §4 설치 매트릭스).
// 릴리스 PR 흐름이 없으므로 RELEASE-PUBLISH 하나가 bump→changelog→tag→Release를 흡수한다.
const TRUNK_BASED_EXCLUDED = new Set([
  "PROJECT-COMMON-VERSION-CONTROL.yaml",
  "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml",
]);

// 한 파일에 env 치환을 적용해 대상 파일을 갱신 (.sh configure_workflow_env 등가).
// values/useDefaults: env 계획(promptEnvPlan) 결과 — 미지정이면 기본값 경로(현행 force 동작).
function configureEnv(targetPath, { type, projectPath = ".", repoName = "", resolvers = {}, collectAsks = null, values = new Map(), useDefaults = true }) {
  const content = readFileSync(targetPath, "utf8");
  if (!content.includes("@wizard")) return;
  const out = substituteEnv(content, { type, useDefaults, values, projectPath, repoName, resolvers, collectAsks });
  writeFileSync(targetPath, out);
}

// 3분류 (신규/unchanged/changed) — 대상 워크플로우 디렉토리 기준.
// srcText: 브랜치 치환이 적용된 원본 로더 (makeSrcText).
function classify(srcDir, workflowsDir, envOpts, srcText) {
  const result = { newFiles: [], unchanged: [], changed: [] };
  for (const filename of listYamlFiles(srcDir)) {
    const src = join(srcDir, filename);
    const dst = join(workflowsDir, filename);
    if (existsSync(dst)) {
      const tpl = srcText(src);
      const inst = readFileSync(dst, "utf8");
      if (isUnchanged(tpl, inst, envOpts)) result.unchanged.push(filename);
      else result.changed.push(filename);
    } else {
      result.newFiles.push(filename);
    }
  }
  return result;
}

// copy_workflows 본체 (동기 — 기존 호출부 무변경).
// context: { types:[], paths:Map, includeNexus, includeSecretBackup, force, repoName, resolvers,
//            envValues?:Map<key,value>, envUseDefaults?:boolean }  ← env 계획(promptEnvPlan) 결과 주입점
// hooks: { decisions?: Map<filename, 'skip'|'backup'|'template'> } — 기존 파일(changed) 충돌 결정.
//        미지정 파일은 'skip'(현행 force 동작 100% 유지). 대화형 수집은 copyWorkflowsInteractive 참조.
// 반환: {copied, skipped, templateAdded, optionalCopied}
export function copyWorkflows(context, payloadRoot, targetRoot = ".", hooks = {}) {
  const { types = [], paths = new Map(), includeNexus = false, includeSecretBackup = false, repoName = "", resolvers = {}, envValues = new Map(), envUseDefaults = true } = context;
  const decisions = hooks.decisions instanceof Map ? hooks.decisions : new Map();
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const projectTypesDir = join(payloadRoot, PAYLOAD.workflowsDir);
  if (!exists(projectTypesDir)) throw new Error("패키지 구조 오류 — payload/workflows 폴더를 찾지 못했습니다.");

  const counters = { copied: 0, skipped: 0, templateAdded: 0, optionalCopied: 0 };
  const deployValues = new Map(); // Map<type, Map<key,value>> — deploy 블록용 ask 값
  counters.deployValues = deployValues;
  const srcText = makeSrcText(context.branches || null);
  // values/useDefaults는 치환 경로에서만 의미 (isUnchanged는 내부에서 useDefaults:true 강제 — 가상 비교 무손상)
  const envOptsFor = (type) => ({ type, projectPath: paths.get(type) || ".", repoName, resolvers, values: envValues, useDefaults: envUseDefaults });

  // (1) common — unchanged면 스킵, 아니면 무조건 덮어쓰기.
  //     trunk-based 모드는 VERSION-CONTROL·AUTO-CHANGELOG 미설치 (RELEASE-PUBLISH 단독).
  const branchMode = context.branches?.mode || "pr-flow";
  const commonDir = join(projectTypesDir, "common");
  if (exists(commonDir)) {
    for (const filename of listYamlFiles(commonDir)) {
      if (branchMode === "trunk-based" && TRUNK_BASED_EXCLUDED.has(filename)) continue;
      const src = join(commonDir, filename);
      const dst = join(workflowsDir, filename);
      const body = srcText(src);
      if (existsSync(dst) && isUnchanged(body, readFileSync(dst, "utf8"), envOptsFor("common"))) {
        counters.skipped++;
        continue;
      }
      writeText(dst, body);
      counters.copied++;
    }
  }

  // (2~4) 타입별
  for (const type of types) {
    const asks = new Map();
    copyWorkflowsForType(type, projectTypesDir, workflowsDir, { includeNexus, ...context, envOptsFor, collectAsks: asks, decisions, srcText }, counters);
    if (asks.size) deployValues.set(type, asks);
  }

  // (5) common/secret-backup — 있으면 무조건 스킵/신규만 복사
  const secretDir = join(commonDir, "secret-backup");
  if (exists(secretDir) && includeSecretBackup) {
    for (const filename of listYamlFiles(secretDir)) {
      const dst = join(workflowsDir, filename);
      if (existsSync(dst)) continue; // 이미 존재하면 스킵
      writeText(dst, srcText(join(secretDir, filename)));
      counters.optionalCopied++;
      counters.copied++;
    }
  }

  return counters;
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
    return;
  }
  if (decision === "template") {
    // .sh T) `${filename%.yaml}.template.yaml` — .yaml만 strip (.yml은 그대로 뒤에 붙음, .sh 동일)
    const templateName = (filename.endsWith(".yaml") ? filename.slice(0, -".yaml".length) : filename) + ".template.yaml";
    writeText(join(workflowsDir, templateName), srcText(src)); // 기존 .template.yaml 덮어씀(.sh rm -f + cp 등가)
    counters.templateAdded++;
    return;
  }
  counters.skipped++; // 'skip'/미지정/ESC → 기존 유지 (.sh S)·force 기본)
}

// 대상 워크플로우 디렉토리에서 changed(충돌) 파일 목록만 뽑는다 — copyWorkflowsInteractive의 사전 조사용.
// copyWorkflows 본체와 동일한 classify 기준을 써야 결정 Map이 실제 처리 대상과 1:1로 맞는다.
export function listWorkflowConflicts(context, payloadRoot, targetRoot = ".") {
  const { types = [], paths = new Map(), includeNexus = false, repoName = "", resolvers = {} } = context;
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const projectTypesDir = join(payloadRoot, PAYLOAD.workflowsDir);
  const srcText = makeSrcText(context.branches || null);
  const conflicts = []; // [{ filename, type }] — 엔진 처리 순서와 동일 (타입 순회 → 직하위 → server-deploy)
  for (const type of types) {
    const envOpts = { type, projectPath: paths.get(type) || ".", repoName, resolvers };
    const typeDir = join(projectTypesDir, type);
    if (exists(typeDir)) {
      for (const f of classify(typeDir, workflowsDir, envOpts, srcText).changed) conflicts.push({ filename: f, type });
    }
    const serverDeployDir = join(typeDir, "server-deploy");
    if (exists(serverDeployDir) && !includeNexus) {
      for (const f of classify(serverDeployDir, workflowsDir, envOpts, srcText).changed) conflicts.push({ filename: f, type });
    }
  }
  return conflicts;
}

// 대화형 진입점 (async) — 충돌마다 onConflict(filename, type)를 await해 결정 Map을 만든 뒤
// 동기 엔진에 위임한다. WHY 분리: copyWorkflows를 async로 바꾸면 await 없이 호출하는
// 기존 호출부(runFull/runWorkflows)가 깨진다 — 시그니처 무변경 원칙.
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
  const { includeNexus, envOptsFor, collectAsks = null, decisions = new Map(), srcText } = ctx;
  const typeDir = join(projectTypesDir, type);
  const envOpts = envOptsFor(type);
  let unchangedNames = [];

  // 타입별 워크플로우 (직하위)
  if (exists(typeDir)) {
    const { newFiles, unchanged, changed } = classify(typeDir, workflowsDir, envOpts, srcText);
    unchangedNames = unchanged.slice();
    for (const f of unchanged) counters.skipped++;
    for (const f of newFiles) { writeText(join(workflowsDir, f), srcText(join(typeDir, f))); counters.copied++; }
    // changed: 결정 Map에 따라 처리 (미지정=skip → 현행 force 동작과 동일)
    for (const f of changed) applyDecision(decisions.get(f), typeDir, workflowsDir, f, counters, srcText);
  }

  // server-deploy
  const serverDeployDir = join(typeDir, "server-deploy");
  if (exists(serverDeployDir)) {
    if (includeNexus) {
      // Nexus 프로젝트 → 폴더째 제외 (복사 안 함)
    } else {
      const { newFiles, unchanged, changed } = classify(serverDeployDir, workflowsDir, envOpts, srcText);
      for (const f of unchanged) counters.skipped++;
      for (const f of newFiles) { writeText(join(workflowsDir, f), srcText(join(serverDeployDir, f))); counters.copied++; }
      for (const f of changed) applyDecision(decisions.get(f), serverDeployDir, workflowsDir, f, counters, srcText);
    }
  }

  // nexus (opt-in)
  const nexusDir = join(typeDir, "nexus");
  if (exists(nexusDir) && includeNexus) {
    for (const filename of listYamlFiles(nexusDir)) {
      const src = join(nexusDir, filename);
      const dst = join(workflowsDir, filename);
      const body = srcText(src);
      if (existsSync(dst) && isUnchanged(body, readFileSync(dst, "utf8"), envOpts)) {
        counters.skipped++;
        continue;
      }
      if (existsSync(dst)) renameSync(dst, dst + ".bak");
      writeText(dst, body);
      counters.optionalCopied++;
      counters.copied++;
    }
  }

  // env 치환 — 이 타입의 원본 디렉토리들에서 복사돼 존재하고 unchanged 아닌 파일만
  for (const srcDir of [typeDir, serverDeployDir, nexusDir]) {
    if (!exists(srcDir)) continue;
    for (const filename of listYamlFiles(srcDir)) {
      const target = join(workflowsDir, filename);
      if (!existsSync(target)) continue;            // 건너뛴 파일 제외
      if (unchangedNames.includes(filename)) continue; // unchanged 제외
      configureEnv(target, { ...envOpts, collectAsks }); // env 계획 values/useDefaults 포함
    }
  }
}
