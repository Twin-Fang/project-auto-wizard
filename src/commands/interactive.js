// 대화형 마법사 (.sh interactive_mode 등가) + #446 UI 층.
// io 주입으로 테스트 가능. 실제 실행은 src/ui/prompts.js 함수를 io로 넘긴다.
// 새 시각 층(banner/detectionLog/analysisCard/installKind/summary)과 저수준 엔진(engineIo)은
// io의 "옵셔널 멤버" — 스텁이 생략하면 해당 층만 건너뛰고 실행 계약은 동일하다.
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { resolvePayloadRoot, assertPayload, readTemplateVersion } from "../core/assets.js";
import { detectTypes, detectVersion, detectDefaultBranch, detectRepoName, makeResolvers } from "../core/detect-fs.js";
import { parseExisting } from "../core/version-yml.js";
import { runBreakingCheck } from "../core/breaking-check.js";
import { resolveProjectPaths } from "../core/paths-resolve.js";
import { resolveBranchConfig, detectRemoteBranches, ensureDevelopBranch } from "../core/branches.js";
import { askAllOptionalWorkflows } from "../core/options-ask.js";
import { promptEnvPlan } from "../ui/env-plan.js";
import { listWorkflowConflicts } from "../core/copy/workflows.js";
import { createContext, VALID_TYPES } from "../context.js";
import { runFull } from "./full.js";
import { runVersion } from "./version.js";
import { runWorkflows } from "./workflows.js";
import * as prompts from "../ui/prompts.js";

const CANCEL = prompts.CANCEL;
const isCancel = (v) => v === CANCEL || typeof v === "symbol";

// io 기본값 = 실제 prompts. 테스트는 스텁 io 주입.
export async function runInteractive(baseCtx, { cwd = process.cwd(), payloadRoot, clock, io = prompts } = {}) {
  const payload = assertPayload(payloadRoot ?? resolvePayloadRoot());
  const templateVersion = readTemplateVersion();

  // 층1 — 시작 배너 (#446 확정 시안 A). 스텁엔 banner 없음 → intro 폴백.
  if (io.banner) io.banner({ version: templateVersion, modeLabel: "대화형 통합 마법사" });
  else io.intro?.("project-auto-wizard — 대화형 통합 마법사");

  // 기존 version.yml — version/version_code/paths/옵션 보존의 단일 진실 (.sh SSoT L2208~2239)
  const vyPath = join(cwd, "version.yml");
  const existing = existsSync(vyPath) ? parseExisting(readFileSync(vyPath, "utf8")) : null;

  // 층5 — 신규/업데이트 판별 (#446)
  io.installKind?.({ currentTemplateVersion: existing?.templateVersion || "", templateVersion });

  // 1) 모드 선택
  const mode = await io.selectMode();
  if (mode === CANCEL || mode == null) { io.cancelMessage?.("설치를 취소했습니다."); return 0; }

  // Breaking Changes 게이트 (.sh execute_integration L4415~4420 — 모든 모드 공통, 대화형은 확인 질문)
  const proceed = await runBreakingCheck({
    cwd, payloadRoot: payload, templateVersion,
    askYesNo: (msg, def) => io.askYesNo(msg, def),
  });
  if (!proceed) { io.cancelMessage?.("통합을 안전하게 취소했습니다."); return 0; }

  // full/version/workflows — 감지 (version은 기존 version.yml 최우선)
  let types = detectTypes(cwd);
  let version = (existing?.version) || detectVersion(cwd);
  let branch = detectDefaultBranch(cwd);
  const repoName = detectRepoName(cwd);
  const versionCode = existing?.versionCode ?? 1; // 기존 빌드번호 보존
  // 선택 워크플로우 초기값: version.yml 저장 옵션 (.sh read_template_options L2361 등가)
  let includeNexus = existing?.options?.nexus ?? false;
  let includeSecretBackup = existing?.options?.secretBackup ?? false;
  let includeCodeRabbit = existing?.options?.coderabbit ?? null;
  const showOptional = mode === "full" || mode === "workflows";
  const realTty = process.stdout.isTTY === true;

  // 층2 — 감지 로그 (#446)
  io.detectionLog?.({ types, version, branch });

  // 선택 워크플로우(Nexus/Secret) 질문 (.sh ask_all_optional_workflows L2707 — full/workflows만)
  if (showOptional) {
    const r = await askAllOptionalWorkflows({
      payloadRoot: payload, types, targetRoot: cwd,
      current: { nexus: existing?.options?.nexus ?? null, secretBackup: existing?.options?.secretBackup ?? null },
      force: false, tty: realTty,
      io: { confirm: ({ message, initialValue }) => io.askYesNo(message, initialValue) },
    });
    includeNexus = r.nexus;
    includeSecretBackup = r.secretBackup;

    // 신규 질문 ② — CodeRabbit opt-in (DESIGN-SPEC §4, 기본 아니오). 저장값 있으면 재질문 생략.
    if (includeCodeRabbit === null) {
      const y = await io.askYesNo("CodeRabbit을 사용합니까? (PR AI 리뷰·요약을 릴리스 노트 1순위로 사용)", false);
      includeCodeRabbit = y === true;
    }
  }
  includeCodeRabbit = includeCodeRabbit === true;

  // 확인/수정 루프 — ESC는 '머무르기' (.sh L1877~1881: 명시적 '아니오'만 종료)
  let paths = new Map();
  let confirmed = false;
  while (!confirmed) {
    // 층3 — 프로젝트 분석 개요 카드 (#446). 스텁엔 없음 → note 폴백.
    if (io.analysisCard) {
      io.analysisCard({ mode, modeLabel: modeLabel(mode), types, version, branch, includeNexus, includeSecretBackup, showOptional, paths });
    } else {
      io.note?.(summarize({ mode, types, version, branch, includeNexus, includeSecretBackup, showOptional }), "프로젝트 분석 결과");
    }
    const choice = await io.confirmProjectMenu();
    if (choice === "cancel") { io.cancelMessage?.("설치를 취소했습니다."); return 0; }
    if (isCancel(choice) || choice == null) continue; // ESC = 머무르기 (루프 재출력)
    if (choice === "continue") { confirmed = true; break; }
    // edit 루프
    let editing = true;
    while (editing) {
      const what = await io.editMenu({ showOptional });
      if (isCancel(what) || what === "done") { editing = false; break; }
      if (what === "type") {
        const t = await io.selectTypes(types);
        if (!isCancel(t) && Array.isArray(t) && t.length) {
          // 타입 집합이 실제로 바뀌면 경로 재해석 대상으로 초기화 (.sh L1984~1992 — 정렬 집합 비교)
          const oldSorted = [...types].sort().join(",");
          types = t.filter((x) => VALID_TYPES.includes(x));
          if ([...types].sort().join(",") !== oldSorted) paths = new Map();
        }
      } else if (what === "version") {
        const v = await io.askText("새 버전 (예: 1.0.0)", version);
        if (!isCancel(v) && v !== version) {
          // semver 형식 검증 (.sh L2010~2015)
          if (/^\d+\.\d+\.\d+$/.test(v)) version = v;
          else io.note?.("버전 형식이 올바르지 않습니다 (x.y.z 형태) — 기존 값을 유지합니다.", "⚠ 버전");
        }
      } else if (what === "branch") {
        const b = await io.askText("기본 브랜치", branch);
        if (!isCancel(b) && b) branch = b;
      } else if (what === "nexus") {
        const y = await io.askYesNo("Nexus publish 워크플로우를 포함할까요?", includeNexus);
        if (!isCancel(y)) includeNexus = y === true;
      } else if (what === "secret") {
        const y = await io.askYesNo("Secret 백업 워크플로우를 포함할까요?", includeSecretBackup);
        if (!isCancel(y)) includeSecretBackup = y === true;
      }
    }
  }

  // 신규 질문 ① — 브랜치 설정 (DESIGN-SPEC §4). full/workflows만 질문, version은 기본값 기록.
  // 저장값(version.yml metadata.template.branches)이 있으면 재질문 없이 재사용 (업데이트 모드).
  let branches = existing?.branches
    ? resolveBranchConfig({ mainBranch: existing.branches.main, developBranch: existing.branches.develop, defaultBranch: branch })
    : resolveBranchConfig({ defaultBranch: branch });
  if (showOptional && !existing?.branches) {
    const remoteBranches = await detectRemoteBranches(cwd);
    const mainB = await pickBranch(io, `릴리스 브랜치를 선택하세요 (기본: ${branch})`, branch, remoteBranches, isCancel);
    const devB = await pickBranch(io, "개발 브랜치를 선택하세요 (기본: develop)", "develop", remoteBranches, isCancel);
    branches = resolveBranchConfig({ mainBranch: mainB, developBranch: devB, defaultBranch: branch });
    if (branches.mode === "trunk-based") {
      io.note?.("릴리스 브랜치 = 개발 브랜치 → trunk-based 모드로 설치합니다 (RELEASE-PUBLISH 단독).", "브랜치 모드");
    } else if (remoteBranches.length && !remoteBranches.includes(branches.develop)) {
      await ensureDevelopBranch({
        develop: branches.develop, remoteBranches, cwd,
        confirm: (msg) => io.askYesNo(msg, true),
        log: (m) => io.note?.(m, "브랜치"),
      });
    }
  }

  // 경로 확정 (.sh resolve_project_paths L1362~1589 — full/version만. 저장값·후보 스캔·질문)
  if (mode === "full" || mode === "version") {
    paths = await resolveProjectPaths({
      root: cwd, types, paths, existingPaths: existing?.paths ?? new Map(),
      force: false, tty: realTty, io: io.engineIo ?? {},
    });
  } else {
    for (const t of types) if (t !== "basic" && !paths.has(t)) paths.set(t, existing?.paths.get(t) || ".");
  }

  // @wizard env 계획 질문 (.sh wf_prompt_env_plan L3220 — full/workflows만)
  const resolvers = makeResolvers(cwd, repoName, paths);
  let envValues = new Map(), envUseDefaults = true;
  if (showOptional) {
    const plan = await promptEnvPlan({
      payloadRoot: payload, types, io: io.engineIo ?? null, force: false,
      resolvers, includeNexus, targetRoot: cwd, repoName,
    });
    envValues = plan.values;
    envUseDefaults = plan.useDefaults;
  }

  const { now, today } = clock || utcNow();
  const ctx = createContext({
    mode, force: true, types, version, versionCode, branch, branches, paths,
    includeNexus, includeSecretBackup, includeCodeRabbit,
    repoName, templateVersion, resolvers, envValues, envUseDefaults, now, today,
  });
  ctx.templateVersion = templateVersion;

  // 기존 워크플로우 충돌 3지선 — 타입당 1회 결정을 파일에 캐시 적용 (.sh L3440~3508 UX 등가)
  let hooks = {};
  if (showOptional && io.engineIo?.select) {
    const conflicts = listWorkflowConflicts(ctx, payload, cwd);
    if (conflicts.length) {
      const perType = new Map();
      const decisions = new Map();
      for (const { filename, type } of conflicts) {
        if (!perType.has(type)) {
          const sel = await io.engineIo.select({
            message: `기존 워크플로우와 내용이 다른 파일이 있습니다 (${type}) — 어떻게 할까요?`,
            options: [
              { value: "skip", label: "건너뛰기 — 기존 파일 유지 (기본)" },
              { value: "backup", label: ".bak 백업 후 새 버전으로 교체" },
              { value: "template", label: "기존 유지 + 새 버전을 .template.yaml로 참고 추가" },
            ],
          });
          perType.set(type, isCancel(sel) || sel == null ? "skip" : sel); // ESC = 건너뛰기 (.sh L3463)
        }
        decisions.set(filename, perType.get(type));
      }
      hooks = { decisions };
    }
  }

  let result = null;
  if (mode === "full") result = runFull(ctx, payload, cwd, hooks);
  else if (mode === "version") result = runVersion(ctx, payload, cwd);
  else if (mode === "workflows") result = runWorkflows(ctx, payload, cwd, hooks);

  // 완료 요약 (.sh print_summary L5438)
  io.summary?.({
    mode, types, version, branches, includeCodeRabbit,
    counters: { workflows: result?.workflows?.copied ?? 0 },
  }, cwd);
  io.outro?.(`통합 완료 — ${mode} 모드로 설치했습니다.`);
  return 0;
}

// 브랜치 선택 — 원격 목록이 있으면 select(+직접 입력), 없으면 텍스트 입력. ESC/빈값 = 기본값.
async function pickBranch(io, message, def, remoteBranches, isCancel) {
  if (io.engineIo?.select && remoteBranches.length) {
    const options = [];
    if (!remoteBranches.includes(def)) options.push({ value: def, label: `${def} (기본값 — 없으면 새로 생성)` });
    for (const b of remoteBranches) options.push({ value: b, label: b === def ? `${b} (기본값)` : b });
    options.push({ value: "__custom__", label: "직접 입력..." });
    const sel = await io.engineIo.select({ message, options });
    if (sel === "__custom__") {
      const v = await io.askText("브랜치 이름", def);
      return isCancel(v) || !v ? def : v;
    }
    return isCancel(sel) || sel == null ? def : sel;
  }
  const v = await io.askText(message, def);
  return isCancel(v) || !v ? def : v;
}

function summarize({ mode, types, version, branch, includeNexus, includeSecretBackup, showOptional }) {
  const lines = [
    `통합 모드 : ${modeLabel(mode)}`,
    `프로젝트 타입 : ${types.join(", ")}${types.length > 1 ? " (멀티)" : ""}`,
    `버전 : ${version}`,
    `기본 브랜치 : ${branch}`,
  ];
  if (showOptional) {
    lines.push(`Nexus publish : ${includeNexus ? "포함" : "제외"}`);
    lines.push(`Secret 백업 : ${includeSecretBackup ? "포함" : "제외"}`);
  }
  return lines.join("\n");
}

function modeLabel(m) {
  return { full: "전체 설치", version: "버전 관리만", workflows: "워크플로우만" }[m] || m;
}

function utcNow(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const d = `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
  const t = `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`;
  return { now: `${d} ${t}`, today: d };
}
