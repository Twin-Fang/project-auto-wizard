// project-auto-wizard CLI 진입 파이프라인 (.sh main + execute_integration 등가).
// 감지 → payload 해석 → 모드 라우팅 → 통합 실행. 비대화형(--force) 우선.
// 네트워크 접근 0 — 설치 자산은 전부 npm 패키지 동봉 payload/ (단일 진실).
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs, parsePathsCsv, CliError } from "./cli/args.js";
import { HELP_TEXT } from "./cli/help.js";
import { createContext } from "./context.js";
import { resolvePayloadRoot, assertPayload, readTemplateVersion } from "./core/assets.js";
import { detectTypes, detectVersion, detectDefaultBranch, detectRepoName, makeResolvers, detectBuildNumber, detectMarkers } from "./core/detect-fs.js";
import { parseExisting } from "./core/version-yml.js";
import { runBreakingCheck } from "./core/breaking-check.js";
import { resolveProjectPaths } from "./core/paths-resolve.js";
import { resolveBranchConfig, detectRemoteBranches, ensureDevelopBranch, defaultExec } from "./core/branches.js";
import { printBannerCompact } from "./ui/banner.js";
import { printSummary } from "./ui/summary.js";
import { runFull } from "./commands/full.js";
import { runUninstall, runUninstallFlow } from "./commands/uninstall.js";
import * as prompts from "./ui/prompts.js";
import { runInteractive } from "./commands/interactive.js";
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
  return { now: `${d} ${t}`, today: d };
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
export async function run(argv, {
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

  const payload = assertPayload(payloadRoot ?? resolvePayloadRoot());

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
    return await runInteractive({}, { cwd, payloadRoot: payload, clock });
  }

  // purge 모드 — 마법사가 만든 모든 산출물을 지워 설치 이전 상태로 완전히 되돌린다.
  // 개발·테스트 전용 숨김 모드 — --help/대화형 메뉴에 노출하지 않는다 (issue #6).
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
      // M4 (Fable 검토): develop 브랜치 삭제는 plan에 포함되지 않으므로(§6 — git 상태는 실행 시점에만
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
      const r = runUninstall({}, payload, cwd, safeSelection);
      const removed = [
        `워크플로우 ${r.workflows.length}개`, `스크립트 ${r.scripts.length}개`,
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
    await runUninstallFlow(payload, cwd, prompts);
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
  // 명시 모드(full/version/workflows)인데 --force 없으면 TTY 여부와 무관하게 즉시 거부한다
  // (issue #19 — TTY에서 확인 없이 즉시 설치되던 결함 수정).
  // --dry-run은 파일을 쓰지 않으므로 --force 게이트를 우회한다 (status/doctor와 동일한 안전성).
  if (!opts.force && !opts.dryRun) {
    console.error("--force 없이는 이 모드를 실행할 수 없습니다 (확인 절차가 없습니다).");
    return 1;
  }

  // 기존 version.yml 로드 — version/version_code/project_paths 보존의 단일 진실 (.sh L2208~2239 SSoT)
  const vyPath = join(cwd, "version.yml");
  const existing = existsSync(vyPath) ? parseExisting(readFileSync(vyPath, "utf8")) : null;

  // 감지 (CLI 인자 우선, 없으면 자동 감지 — version.yml 우선 규칙은 detectTypes/detectVersion 내부)
  const types = opts.types.length ? opts.types : detectTypes(cwd);
  // version: 기존 version.yml 최우선(SSoT — 재실행 시 덮어쓰기 방지) → CLI 지정 → 파일 감지
  // 비대화형이므로 폴백 안내는 CLI 문구(--project-version)를 그대로 쓴다 (이슈 #80).
  const detectWarnings = [];
  const version = (existing?.version) || opts.version
    || detectVersion(cwd, { warn: (m) => { detectWarnings.push(m); console.error(m); } });
  const versionCode = existing?.versionCode ?? detectBuildNumber(cwd, { types }) ?? 1; // 기존 빌드번호 보존, 신규 통합 시 프로젝트 파일에서 감지 (.sh L2208~2221, 이슈 #41)
  const branch = detectDefaultBranch(cwd);
  const repoName = detectRepoName(cwd);
  // 경로 확정 (.sh resolve_project_paths 비대화형 경로 — --paths 우선 → 저장값 → 후보 1개 자동 → 에러)
  let paths;
  try {
    paths = await resolveProjectPaths({
      root: cwd, types, paths: parsePathsCsv(opts.pathsCsv),
      existingPaths: existing?.paths ?? new Map(), force: true, tty: false, io: {},
    });
  } catch (e) {
    if (e instanceof CliError) { console.error(e.message); return 1; }
    throw e;
  }

  // 브랜치 구성 (--main-branch/--develop-branch → version.yml 저장값 → 감지 default → main/develop)
  const branches = resolveBranchConfig({
    mainBranch: opts.mainBranch || existing?.branches?.main || "",
    developBranch: opts.developBranch || existing?.branches?.develop || "",
    defaultBranch: branch,
  });
  // pr-flow에서 develop이 원격에 없으면 자동 생성+push (--force 비대화형 — 질문 없음).
  // 원격 목록을 못 읽는 환경(git 없음·origin 없음)은 remoteBranches=[]지만 push 실패를 조용히 보고.
  if (branches.mode === "pr-flow" && !opts.dryRun) {
    const remoteBranches = await detectRemoteBranches(cwd);
    if (remoteBranches.length && !remoteBranches.includes(branches.develop)) {
      await ensureDevelopBranch({
        develop: branches.develop, remoteBranches, confirm: null, cwd,
        log: (m) => console.error(m),
      });
    }
  }

  const { now, today } = clock || utcNow();

  const context = createContext({
    mode: opts.mode, force: opts.force, types, version, versionCode, branch,
    branches,
    paths,
    // 옵션 워크플로우: CLI 플래그 최우선 → version.yml 저장 옵션(.sh read_template_options 등가) → false
    includeNexus: opts.includeNexus ?? existing?.options?.nexus ?? false,
    includeSecretBackup: opts.includeSecretBackup ?? existing?.options?.secretBackup ?? false,
    // 기존 version.yml이 있는데 semver_auto 키가 아예 없었던 경우(신규 기능 추가 이전 설치·
    // workflows-only 재실행) 조용히 true로 켜지면 애매한 커밋 하나로 major가 승격될 위험이 있다 —
    // 기존 설치는 false로 안전하게 폴백, 완전 신규 설치만 true(기존 설계) 유지.
    includeSemverAuto: opts.includeSemverAuto ?? existing?.options?.semverAuto ?? (existing ? false : true),
    repoName,
    // 실 resolver 4종 (.sh resolve_token 등가)
    resolvers: makeResolvers(cwd, repoName, paths),
    now, today,
    // 설치 로그(#79)용 부가 문맥 — 설치 동작 자체는 바꾸지 않는다.
    markers: detectMarkers(cwd, types), detectWarnings,
    previousTemplateVersion: existing?.templateVersion || "",
  });

  context.templateVersion = readTemplateVersion();

  // 비대화형 축약 배너 (#446 확정 — 1줄, 로그 오염 최소)
  printBannerCompact({ version: context.templateVersion, mode: opts.mode });

  // Breaking Changes 게이트 (.sh execute_integration L4415~4420 등가 — 비대화형은 경고 후 진행)
  const proceed = await runBreakingCheck({ cwd, payloadRoot: payload, templateVersion: context.templateVersion });
  if (!proceed) return 0;

  if (opts.dryRun) {
    printDryRun(planDryRun(opts.mode, context, payload, cwd));
    return 0;
  }

  // opts.mode는 parseArgs()에서 화이트리스트 검증을 통과했고, interactive/purge/uninstall/status/doctor는
  // 전부 위에서 조기 반환했으므로 이 시점엔 full 하나로 보장된다 (issue #19 — default 분기 제거,
  // issue #70 — 부분 설치 모드 제거로 분기 자체가 사라졌다).
  const result = runFull(context, payload, cwd);

  // 완료 요약 (.sh print_summary — CLI 모드에서도 출력)
  printSummary({
    mode: opts.mode, types, version, versionCode, branches,
    copiedFiles: result?.workflows?.copiedFiles ?? [],
    gitignoreUpdated: result?.gitignoreUpdated === true,
    unresolved: result?.unresolved ?? [],
    secrets: result?.secrets ?? new Map(),
    installLogPath: result?.installLog?.path ?? "",
  });
  return 0;
}
