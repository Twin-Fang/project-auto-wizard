// project-auto-wizard CLI 진입 파이프라인.
// 감지 → payload 해석 → 모드 라우팅 → 통합 실행. 비대화형(--force) 우선.
// 설치 자산은 전부 npm 패키지 동봉 payload/ (단일 진실). 자체 네트워크 요청은 없고,
// 기본 브랜치 감지용 git 명령만 사용자 레포의 origin에 접속할 수 있다.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs, parsePathsCsv, CliError, TYPE_CLI_FLAGS } from "./cli/args.js";
import { HELP_TEXT } from "./cli/help.js";
import { resolveLanguage, setLanguage, LANG_ENV_VAR } from "./i18n/index.js";
import { fallbackStyleTypes } from "./core/deploy-style.js";
import { hooksFor, mergeHookResults } from "./core/types.js";
import { PATHS } from "./core/paths.js";
import { resolvePayloadRoot, assertPayload, readTemplateVersion } from "./core/assets.js";
import { detectTypes, detectDefaultBranch, detectRepoName, makeResolvers, detectMarkers } from "./core/detect-fs.js";
import { parseExisting } from "./core/version-yml.js";
import { resolveReleaseOptions } from "./core/release-options.js";
import { runBreakingCheck } from "./core/breaking-check.js";
import { resolveProjectPaths } from "./core/paths-resolve.js";
import {
  resolveBranchConfig, detectRemoteBranches, ensureDevelopBranch, defaultExec, isValidBranchName, developMissingNotice,
} from "./core/branches.js";
import { printBannerCompact } from "./ui/banner.js";
import { printSummary } from "./ui/summary.js";
import { runFull, postInstallNotices } from "./commands/full.js";
import { runUninstall, runUninstallFlow } from "./commands/uninstall.js";
import * as prompts from "./ui/prompts.js";
import { isPromptAbort } from "./ui/readline-engine.js";
import { runInteractive } from "./commands/interactive.js";
import { resolveDeployStyle, resolveVersion, resolveVersionCode, buildInstallContext } from "./commands/install-settings.js";
import { initLogger, closeLogger, currentLogPath, hasLegacyMdLogs, log } from "./core/logger.js";
import { runStatus, printStatus } from "./commands/status.js";
import { runDoctor, printDoctorReport } from "./commands/doctor.js";
import { planDryRun, printDryRun } from "./commands/dry-run.js";
import { planPurge, executePurge, printPurgePlan, printPurgeResult } from "./commands/purge.js";

// 패키지 버전 읽기 (-v/--version 출력용). src/../package.json.
function readPkgVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

// 결정적 UTC 타임스탬프 (주입 가능 — 테스트/골든용)
function utcNow(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const d = `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
  const t = `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`;
  // ms: 로그 파일명이 같은 초의 연속 실행끼리 겹치지 않도록 쓴다 (now와 같은 시각에서 뽑는다).
  return { now: `${d} ${t}`, today: d, ms: date.getUTCMilliseconds() };
}

// purge TTY 확인 — 실제 stdin에서 한 줄 입력을 받는다 (테스트는 promptRepoName 주입으로 대체).
async function defaultPromptRepoName(repoName) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(`purge를 실행하려면 정확히 이 레포명을 입력하세요: ${repoName}\n> `);
  } finally {
    rl.close();
  }
}

// run(argv, opts) → exitCode. opts: { cwd, payloadRoot?, clock?, exec?, promptRepoName? }
//   payloadRoot: 테스트 픽스처 주입점 (기본: 패키지 동봉 payload/)
//   clock: {now, today} 주입 (기본 현재 UTC).
//   exec/promptRepoName: purge 모드 안전장치 게이트용 주입점 (기본 실제 구현, 테스트는 mock 주입).
async function runInner(argv, {
  cwd = process.cwd(), payloadRoot, clock,
  exec = defaultExec, promptRepoName = defaultPromptRepoName,
} = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (e instanceof CliError) { console.error(e.message); return 1; }
    throw e;
  }
  if (opts.showVersion) { console.log(readPkgVersion()); return 0; }
  if (opts.help) { console.log(HELP_TEXT); return 0; }

  // Language: --lang -> env var -> saved version.yml value -> en. Resolved after --help/--version
  // so an invalid env var cannot block the help output.
  let language;
  try {
    const savedVy = join(cwd, "version.yml");
    language = resolveLanguage({
      flag: opts.lang, env: process.env[LANG_ENV_VAR],
      saved: existsSync(savedVy) ? parseExisting(readFileSync(savedVy, "utf8")).language : null,
    });
  } catch (e) {
    if (e instanceof CliError) { console.error(e.message); return 1; }
    throw e;
  }
  setLanguage(language);

  const payload = assertPayload(payloadRoot ?? resolvePayloadRoot());

  // 시각은 여기서 한 번만 계산한다 — 로그 파일명과 설치 기록이 같은 값을 쓰도록.
  const { now, today, ms } = clock || utcNow();

  // 로그는 인자 검증과 모드별 게이트를 모두 통과한 "실제로 파일을 바꾸는" 실행만 남긴다.
  // status/doctor(읽기 전용)·dry-run·거부된 실행은 대상 레포에 아무 파일도 만들지 않아야 한다.
  const startLog = (action) => initLogger(cwd, { action, now, ms, argv, templateVersion: readTemplateVersion() });

  // 대화형 모드 — 인자 없이 실행 or --mode interactive
  if (opts.mode === "interactive") {
    // --dry-run은 대화형 모드에서 조용히 무시되면 안 됨(실제 설치가 진행돼버림) — 명시 에러로 차단.
    if (opts.dryRun) {
      console.error("--dry-run은 --mode <full|uninstall>와 함께 사용하세요 (대화형 모드에서는 지원하지 않습니다).");
      return 1;
    }
    if (!process.stdout.isTTY) {
      console.error("대화형 입력이 불가능한 환경입니다. --mode <full|uninstall> 와 --force 를 지정하세요.");
      return 1;
    }
    // 켜고 끄기 옵션은 대화형에서도 반영한다(해당 질문 생략). 나머지 설치 플래그는 대화형 질문이 정하므로
    // 조용히 무시하지 않고 알린다.
    const ignored = [
      [opts.types.length, "--type"], [opts.version, "--project-version"], [opts.pathsCsv, "--paths"],
      [opts.mainBranch, "--main-branch"], [opts.developBranch, "--develop-branch"], [opts.deployStyle, "--deploy-style"],
      ...TYPE_CLI_FLAGS.map((f) => [opts[f.field], f.flag]),
    ].filter(([v]) => v).map(([, flag]) => flag);
    if (ignored.length) {
      console.error(`⚠️  대화형 모드에서는 ${ignored.join(", ")}를 사용하지 않습니다 — 질문에서 고르거나 --mode full --force와 함께 쓰세요.`);
    }
    // 로그 파일은 첫 기록 때 생기므로 메뉴에서 status/doctor만 보고 나가면 아무것도 남지 않는다.
    startLog("install");
    return await runInteractive(
      { includeSemverAuto: opts.includeSemverAuto, includeCopilotAi: opts.includeCopilotAi, language },
      { cwd, payloadRoot: payload, clock },
    );
  }

  // purge 모드 — 마법사가 만든 모든 산출물을 지워 설치 이전 상태로 완전히 되돌린다.
  // 개발·테스트 전용 숨김 모드 — --help/대화형 메뉴에 노출하지 않는다.
  if (opts.mode === "purge") {
    if (!existsSync(join(cwd, ".git"))) {
      console.error("git 레포가 아닙니다(.git 없음) — purge는 git 레포 안에서만 실행할 수 있습니다.");
      return 1;
    }
    const keepFlags = {
      versionYml: opts.keepVersionYml, readme: opts.keepReadme, changelog: opts.keepChangelog,
      workflows: opts.keepWorkflows, scripts: opts.keepScripts,
    };
    // version.yml은 여기서 미리 읽어둔다 — (a) executePurge()가 version.yml 자체를 지울 수 있어
    // 실행 이후에는 읽을 수 없고, (b) 아래 dry-run 예고 문구도 trunk-based 여부(develop === main)를
    // 알아야 실제 실행 시 삭제를 건너뛸지 미리 알릴 수 있기 때문에, 두 지점보다 앞서 읽어야 한다.
    const vyPath = join(cwd, "version.yml");
    const existing = existsSync(vyPath) ? parseExisting(readFileSync(vyPath, "utf8")) : null;
    if (opts.dryRun) {
      printPurgePlan(planPurge(payload, cwd, keepFlags), { dryRun: true });
      // develop 브랜치 삭제는 plan에 포함되지 않으므로(git 상태는 실행 시점에만
      // 판단 가능) 별도로 예고하지 않으면 dry-run 미리보기가 유일한 파괴적 동작을 사용자에게 숨기게 된다.
      if (opts.deleteDevelopBranch) {
        const developBranch = existing?.branches?.develop || "develop";
        if (existing?.branches?.main && developBranch === existing.branches.main) {
          console.log("(--delete-develop-branch 지정됨: trunk-based 구성(develop === main)이라 실제 실행 시에도 삭제를 건너뜁니다)");
        } else {
          console.log("(--delete-develop-branch 지정됨: 실제 실행 시 로컬 develop 브랜치도 삭제를 시도합니다)");
        }
      }
      return 0;
    }
    if (!opts.yes) {
      console.error("--yes 없이는 purge를 실행할 수 없습니다 (--force로 대체할 수 없습니다).");
      return 1;
    }
    const st = await exec("git", ["status", "--porcelain"], { cwd });
    if (st.code !== 0) {
      console.error("git 상태를 확인할 수 없습니다 — 안전을 위해 purge를 중단합니다.");
      return 1;
    }
    if (!opts.allowDirty && st.stdout.trim() !== "") {
      console.error("작업트리에 커밋되지 않은 변경 사항이 있습니다 — purge 후 복구할 수 없습니다. 커밋하거나 --allow-dirty를 사용하세요.");
      return 1;
    }
    if (!opts.force) {
      if (!process.stdout.isTTY) {
        console.error("비대화형 환경에서는 --force 옵션이 필요합니다.");
        return 1;
      }
      const repoName = detectRepoName(cwd);
      const typed = await promptRepoName(repoName);
      if (typed !== repoName) {
        console.error("입력한 레포명이 일치하지 않습니다 — purge를 중단합니다.");
        return 1;
      }
    }
    startLog("purge");
    const plan = planPurge(payload, cwd, keepFlags);
    printPurgePlan(plan, { dryRun: false });
    const result = executePurge(payload, cwd, keepFlags);
    printPurgeResult(result);
    if (opts.deleteDevelopBranch) {
      const developBranch = existing?.branches?.develop || "develop";
      if (existing?.branches?.main && developBranch === existing.branches.main) {
        console.error("trunk-based 구성(develop === main)입니다 — 릴리스 브랜치 삭제는 건너뜁니다.");
      } else {
        const br = await exec("git", ["branch", "-d", developBranch], { cwd });
        if (br.code !== 0) {
          console.error(`⚠️  로컬 '${developBranch}' 브랜치 삭제 실패 (${(br.stderr || "").trim() || "이유 확인 불가"}) — 수동으로 확인하세요.`);
        } else {
          console.error(`로컬 '${developBranch}' 브랜치를 삭제했습니다.`);
        }
      }
    }
    return 0;
  }

  // uninstall 모드 — 설치물에 더해 README·gitignore·version.yml까지 선택적으로 제거.
  if (opts.mode === "uninstall") {
    const safeSelection = {
      workflows: true, scripts: true,
      readme: opts.purgeReadme, gitignore: opts.purgeGitignore, versionYml: opts.purgeVersion,
    };
    if (opts.dryRun) {
      printDryRun(planDryRun("uninstall", { uninstallSelection: safeSelection }, payload, cwd));
      return 0;
    }
    if (opts.force) {
      startLog("uninstall");
      const r = runUninstall({}, payload, cwd, safeSelection);
      const removed = [
        `워크플로우 ${r.workflows.length}개`, `스크립트 ${r.scripts.length}개`,
        r.appFiles.length > 0 && `Flutter 앱 파일 ${r.appFiles.length}개`,
        r.readme && "README 버전 섹션",
        r.gitignore && ".gitignore 자동 추가 항목", r.versionYml && "version.yml",
      ].filter(Boolean).join(", ");
      console.error(`제거됨 — ${removed}`);
      return 0;
    }
    if (!process.stdout.isTTY) {
      console.error("비대화형 환경에서는 --force 옵션이 필요합니다.");
      return 1;
    }
    startLog("uninstall");
    // --purge-* 플래그는 체크리스트 초기 선택으로 반영한다(조용히 무시하지 않는다).
    await runUninstallFlow(payload, cwd, prompts, {
      readme: opts.purgeReadme, gitignore: opts.purgeGitignore, versionYml: opts.purgeVersion,
    });
    return 0;
  }

  // status 모드 — 읽기 전용, TTY/--force 무관하게 항상 동작
  if (opts.mode === "status") {
    printStatus(runStatus(payload, cwd));
    return 0;
  }
  // doctor 모드 — 읽기 전용, TTY/--force 무관하게 항상 동작
  if (opts.mode === "doctor") {
    printDoctorReport(runDoctor(cwd));
    return 0;
  }
  // 명시 모드(full)인데 --force 없으면 TTY 여부와 무관하게 즉시 거부한다
  // (TTY에서 확인 없이 즉시 설치되던 결함 수정).
  // --dry-run은 파일을 쓰지 않으므로 --force 게이트를 우회한다 (status/doctor와 동일한 안전성).
  if (!opts.force && !opts.dryRun) {
    console.error("--force 없이는 이 모드를 실행할 수 없습니다 (확인 절차가 없습니다).");
    return 1;
  }

  // 기존 version.yml 로드 — version/version_code/project_paths 보존의 단일 진실
  const vyPath = join(cwd, "version.yml");
  const existing = existsSync(vyPath) ? parseExisting(readFileSync(vyPath, "utf8")) : null;

  // 감지 (CLI 인자 우선, 없으면 자동 감지 — version.yml 우선 규칙은 detectTypes/detectVersion 내부)
  // --paths만 주고 --type을 생략한 모노레포도 그 타입으로 설치되도록 감지에 넘긴다.
  let cliPaths;
  try {
    cliPaths = parsePathsCsv(opts.pathsCsv);
  } catch (e) {
    if (e instanceof CliError) { console.error(e.message); return 1; }
    throw e;
  }
  const types = opts.types.length ? opts.types
    : detectTypes(cwd, { paths: cliPaths, warn: (m) => console.error(m) });
  const detectWarnings = [];
  const branch = detectDefaultBranch(cwd, {
    warn: (m) => { detectWarnings.push(m); console.error(m); },
    hint: "다르면 --main-branch로 지정하세요.",
  });
  const repoName = detectRepoName(cwd);
  // 경로 확정 (비대화형 — --paths 우선 → 저장값 → 후보 1개 자동 → 에러)
  let paths;
  try {
    paths = await resolveProjectPaths({
      root: cwd, types, paths: cliPaths,
      existingPaths: existing?.paths ?? new Map(), force: true, tty: false, io: {},
    });
  } catch (e) {
    if (e instanceof CliError) { console.error(e.message); return 1; }
    throw e;
  }

  // version: 기존 version.yml 최우선(SSoT — 재실행 시 덮어쓰기 방지) → CLI 지정 → 파일 감지
  // 비대화형이므로 폴백 안내는 CLI 문구(--project-version)를 그대로 쓴다.
  // 경로 확정 뒤에 감지해야 모노레포 하위 폴더의 버전·빌드 번호를 읽는다.
  const version = resolveVersion({
    cwd, existing, explicit: opts.version,
    types, paths, warn: (m) => { detectWarnings.push(m); console.error(m); },
  });
  const versionCode = resolveVersionCode({ cwd, existing, types, paths });

  // 브랜치 구성 (--main-branch/--develop-branch → version.yml 저장값 → 감지 default → main/develop)
  // 이전 버전이 저장한 감지 실패 값("(unknown)" 등)은 저장값으로 인정하지 않는다 — 그대로 두면 재실행해도 복구되지 않는다.
  const savedBranch = (b) => (isValidBranchName(b) ? b : "");
  const branches = resolveBranchConfig({
    mainBranch: opts.mainBranch || savedBranch(existing?.branches?.main),
    developBranch: opts.developBranch || savedBranch(existing?.branches?.develop),
    defaultBranch: branch,
  });
  // pr-flow에서 develop이 원격에 없으면 자동 생성+push (--force 비대화형 — 질문 없음).
  // 원격에 브랜치가 하나도 없으면(빈 원격·origin 없음) push할 기준이 없으므로 만들지 않고 안내한다.
  let developMissing = false;
  if (branches.mode === "pr-flow" && !opts.dryRun) {
    const remoteBranches = await detectRemoteBranches(cwd);
    if (!remoteBranches.length) {
      developMissing = true;
      console.error(`⚠️  ${developMissingNotice(branches)}`);
    } else if (!remoteBranches.includes(branches.develop)) {
      const r = await ensureDevelopBranch({
        develop: branches.develop, remoteBranches, confirm: null, cwd,
        log: (m) => console.error(m),
      });
      developMissing = r.pushed === false;
    }
  }

  // 타입 전용 옵션 — CLI 플래그 → version.yml 저장값 → 기본값을 타입 훅이 정한다. 해당 타입이 없으면 비어 있다.
  // (Flutter는 저장값이 없는 기존 설치의 스토어를 설치된 워크플로우로 추론한다 — 대화형과 같은 결론.)
  const typeOptions = mergeHookResults(types, "resolveOptions", {
    opts, existing, workflowsDir: join(cwd, PATHS.workflowsDir),
  });

  // 고른 배포 방식 — 플래그 → 저장값 → 기본값. 실제 설치되는 방식으로의 정리는 컨텍스트 조립에서 한다.
  const chosenDeployStyle = resolveDeployStyle({ payload, types, explicit: opts.deployStyle, existing });

  const context = buildInstallContext({
    payload, existing, templateVersion: readTemplateVersion(), types, deployStyle: chosenDeployStyle,
    typeOptions,
    // 옵션: CLI 플래그 최우선 → version.yml 저장 옵션 → 기본값 (대화형과 같은 규칙)
    releaseOptions: resolveReleaseOptions({ semverAuto: opts.includeSemverAuto, copilotAi: opts.includeCopilotAi }, existing),
    mode: opts.mode, force: opts.force, version, versionCode, branch,
    branches,
    paths,
    repoName,
    // @wizard ask/auto 토큰 값을 계산하는 resolver
    resolvers: makeResolvers(cwd, repoName, paths, typeOptions),
    now, today, language,
    // 설치 로그용 부가 문맥 — 설치 동작 자체는 바꾸지 않는다.
    markers: detectMarkers(cwd, types), detectWarnings,
  });

  // 무중단(nginx·traefik) 워크플로우가 없는 타입은 단일 서버 배포로 설치한다 — 조용히 넘어가지 않게 알린다.
  const fallbackTypes = fallbackStyleTypes(payload, types, chosenDeployStyle);
  if (fallbackTypes.length) {
    console.error(`⚠️  ${fallbackTypes.join(", ")}에는 ${chosenDeployStyle} 무중단 배포 워크플로우가 없어 단일 서버 배포(simple)로 설치합니다.`);
  }

  // 비대화형 축약 배너 (1줄, 로그 오염 최소)
  printBannerCompact({ version: context.templateVersion, mode: opts.mode });

  // Breaking Changes 게이트 (비대화형은 경고 후 진행)
  const proceed = await runBreakingCheck({ cwd, payloadRoot: payload, templateVersion: context.templateVersion });
  if (!proceed) return 0;

  if (opts.dryRun) {
    printDryRun(planDryRun(opts.mode, context, payload, cwd));
    return 0;
  }

  startLog("install");
  // opts.mode는 parseArgs()에서 화이트리스트 검증을 통과했고, interactive/purge/uninstall/status/doctor는
  // 전부 위에서 조기 반환했으므로 이 시점엔 full 하나로 보장된다 (default 분기 제거,
  // 부분 설치 모드 제거로 분기 자체가 사라졌다).
  const result = runFull(context, payload, cwd);

  // 완료 요약 (CLI 모드에서도 출력)
  printSummary({
    mode: opts.mode, types, version, versionCode, branches, developMissing,
    copiedFiles: result?.workflows?.copiedFiles ?? [],
    autoUpdated: result?.workflows?.autoUpdated ?? [],
    gitignoreUpdated: result?.gitignoreUpdated === true,
    unresolved: result?.unresolved ?? [],
    secrets: result?.secrets ?? new Map(),
    optionalSecrets: result?.optionalSecrets ?? new Map(),
    logPath: currentLogPath(),
    legacyMdLogs: hasLegacyMdLogs(cwd),
    cleanup: result?.cleanup ?? null,
    storeCleanup: result?.storeCleanup ?? null,
    flutterApp: result?.flutterApp ?? null,
    readme: result?.readme ?? null,
    scripts: result?.scripts ?? null,
  });
  for (const n of postInstallNotices(result)) console.error(n.startsWith(" ") ? n : `⚠️  ${n}`);
  // store_submit 배포 모드는 main push마다 심사를 자동 제출한다 — 비대화형에서도 같은 경고를 보여준다
  // (대화형 경로는 ui/prompts.js#deployModeWarning을 선택 시점에 note로 보여준다). 타입 훅이 해당 타입에만 낸다.
  for (const { hook } of hooksFor(types, "installNotices")) {
    for (const w of hook(typeOptions)) {
      if (w) console.error(`⚠️  ${w}`);
    }
  }
  return 0;
}

// 공개 진입점 — 어떤 경로로 끝나든(정상 반환·CliError·예외) 로거를 닫는다.
// 본문을 통째로 try로 감싸면 들여쓰기가 전부 바뀌므로 얇은 래퍼로 분리했다.
export async function run(argv, opts = {}) {
  try {
    return await runInner(argv, opts);
  } catch (e) {
    // Ctrl+C/EOF는 어느 질문에서든 즉시 중단한다 — 설치 파일을 쓰기 전에 빠져나오고, 셸 관례대로 130을 돌려준다.
    if (isPromptAbort(e)) {
      prompts.cancelMessage("중단했습니다 — 변경 없이 종료합니다.");
      return e.signal === "SIGTERM" ? 143 : 130;
    }
    // 이미 기록을 시작한 실행이 도중에 죽으면 헤더만 남은 로그로는 원인을 알 수 없다 — 사유를 남긴다.
    if (currentLogPath()) log.fail("run", "error", e?.message || String(e));
    // 사용자가 고칠 수 있는 실패(권한 등)는 스택트레이스 대신 읽을 수 있는 문구로 끝낸다.
    if (e instanceof CliError) { console.error(e.message); return 1; }
    throw e;
  } finally {
    closeLogger();
  }
}
