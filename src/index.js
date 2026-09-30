// project-auto-wizard CLI entry pipeline.
// detect -> resolve payload -> route by mode -> run the install. Non-interactive (--force) first.
// All installed assets come from the payload/ bundled in the npm package (single source of truth). The tool
// makes no network requests of its own; only the git command that detects the default branch may contact the repo's origin.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs, parsePathsCsv, CliError, TYPE_CLI_FLAGS } from "./cli/args.js";
import { helpText } from "./cli/help.js";
import { resolveLanguage, setLanguage, t, DEFAULT_LANGUAGE, LANG_ENV_VAR, normalizeLanguage } from "./i18n/index.js";
import { fallbackStyleTypes } from "./core/deploy-style.js";
import { hooksFor, mergeHookResults } from "./core/types.js";
import { PATHS } from "./core/paths.js";
import { resolvePayloadRoot, assertPayload, readTemplateVersion } from "./core/assets.js";
import { detectTypes, detectDefaultBranch, detectRepoName, makeResolvers, detectMarkers } from "./core/detect-fs.js";
import { parseExisting, droppedPathLines } from "./core/version-yml.js";
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
import { runDoctor, printDoctorReport, doctorExitCode } from "./commands/doctor.js";
import { planDryRun, printDryRun } from "./commands/dry-run.js";
import { planPurge, executePurge, printPurgePlan, printPurgeResult } from "./commands/purge.js";

// Read the package version (for -v/--version output) from src/../package.json.
function readPkgVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

// Deterministic UTC timestamp (injectable for tests/goldens)
function utcNow(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const d = `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
  const t = `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`;
  // ms: keeps log file names from colliding between runs in the same second (taken from the same instant as now).
  return { now: `${d} ${t}`, today: d, ms: date.getUTCMilliseconds() };
}

// purge TTY confirmation: reads one line from the real stdin (tests replace it by injecting promptRepoName).
async function defaultPromptRepoName(repoName) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(t("cli.index.purgePrompt", { repoName }));
  } finally {
    rl.close();
  }
}

// Provisional language from argv/env so argument errors are already printed in the requested language.
// Mirrors how parseArgs reads `--lang X` (last valid value wins); invalid values are ignored silently here
// because parseArgs / resolveLanguage report them. The saved version.yml language only applies later.
function presetLanguage(argv) {
  setLanguage(DEFAULT_LANGUAGE);
  setLanguage(normalizeLanguage(process.env[LANG_ENV_VAR]));
  argv.forEach((a, i) => {
    if (a === "--lang") setLanguage(normalizeLanguage(argv[i + 1]));
    else if (a.startsWith("--lang=")) setLanguage(normalizeLanguage(a.slice("--lang=".length)));
  });
}

// run(argv, opts) -> exitCode. opts: { cwd, payloadRoot?, clock?, exec?, promptRepoName? }
//   payloadRoot: test fixture injection point (default: payload/ bundled in the package)
//   clock: inject {now, today} (default: current UTC).
//   exec/promptRepoName: injection points for the purge safety gates (real implementations by default, mocks in tests).
async function runInner(argv, {
  cwd = process.cwd(), payloadRoot, clock,
  exec = defaultExec, promptRepoName = defaultPromptRepoName,
} = {}) {
  let opts;
  presetLanguage(argv);
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (e instanceof CliError) { console.error(e.message); return 1; }
    throw e;
  }
  if (opts.showVersion) { console.log(readPkgVersion()); return 0; }
  if (opts.help) { console.log(helpText()); return 0; }

  // Language: --lang -> env var -> saved version.yml value -> en. Resolved after --help/--version
  // so an invalid env var cannot block the help output.
  let language;
  try {
    const savedVy = join(cwd, "version.yml");
    const saved = existsSync(savedVy) ? parseExisting(readFileSync(savedVy, "utf8")).language : null;
    language = resolveLanguage({ flag: opts.lang, env: process.env[LANG_ENV_VAR], saved });
    // An existing install without a saved language now falls back to English: say so once, since
    // its workflow messages switch from Korean on the next update.
    const existingWithoutLanguage = existsSync(savedVy) && !saved;
    const unspecified = !normalizeLanguage(opts.lang) && !normalizeLanguage(process.env[LANG_ENV_VAR]);
    if (existingWithoutLanguage && unspecified && ["full", "interactive"].includes(opts.mode)) {
      console.error(t("cli.lang.defaultNotice", {}, DEFAULT_LANGUAGE));
    }
  } catch (e) {
    if (e instanceof CliError) { console.error(e.message); return 1; }
    throw e;
  }
  setLanguage(language);

  const payload = assertPayload(payloadRoot ?? resolvePayloadRoot());

  // Compute the time once here so the log file name and the install record use the same value.
  const { now, today, ms } = clock || utcNow();

  // Only runs that pass argument validation and every mode gate and actually change files leave a log.
  // status/doctor (read-only), dry-run and rejected runs must not create any file in the target repo.
  const startLog = (action) => initLogger(cwd, { action, now, ms, argv, templateVersion: readTemplateVersion() });

  // Interactive mode: run without arguments or with --mode interactive
  if (opts.mode === "interactive") {
    // --dry-run must not be silently ignored in interactive mode (a real install would proceed), so fail explicitly.
    if (opts.dryRun) {
      console.error(t("cli.index.dryRunNeedsMode"));
      return 1;
    }
    if (!process.stdout.isTTY) {
      console.error(t("cli.index.noTty"));
      return 1;
    }
    // On/off options also apply in interactive mode (their question is skipped). The remaining install flags
    // are decided by the interactive questions, so report them instead of ignoring them silently.
    const ignored = [
      [opts.types.length, "--type"], [opts.version, "--project-version"], [opts.pathsCsv, "--paths"],
      [opts.mainBranch, "--main-branch"], [opts.developBranch, "--develop-branch"], [opts.deployStyle, "--deploy-style"],
      ...TYPE_CLI_FLAGS.map((f) => [opts[f.field], f.flag]),
    ].filter(([v]) => v).map(([, flag]) => flag);
    if (ignored.length) {
      console.error(`⚠️  ${t("cli.index.ignoredFlags", { flags: ignored.join(", ") })}`);
    }
    // The log file is created on the first write, so viewing only status/doctor from the menu leaves nothing behind.
    startLog("install");
    return await runInteractive(
      { includeSemverAuto: opts.includeSemverAuto, includeCopilotAi: opts.includeCopilotAi, language },
      { cwd, payloadRoot: payload, clock },
    );
  }

  // purge mode: removes everything the wizard created and restores the pre-install state.
  // Hidden development/testing mode; not exposed in --help or the interactive menu.
  if (opts.mode === "purge") {
    if (!existsSync(join(cwd, ".git"))) {
      console.error(t("cli.index.purgeNotGit"));
      return 1;
    }
    const keepFlags = {
      versionYml: opts.keepVersionYml, readme: opts.keepReadme, changelog: opts.keepChangelog,
      workflows: opts.keepWorkflows, scripts: opts.keepScripts,
    };
    // Read version.yml up front: (a) executePurge() may delete version.yml itself, so it cannot be read
    // afterwards, and (b) the dry-run notice below must know whether the repo is trunk-based (develop === main)
    // to tell in advance whether the real run will skip the deletion. Both need it before this point.
    const vyPath = join(cwd, "version.yml");
    const existing = existsSync(vyPath) ? parseExisting(readFileSync(vyPath, "utf8")) : null;
    if (opts.dryRun) {
      printPurgePlan(planPurge(payload, cwd, keepFlags), { dryRun: true });
      // Deleting the develop branch is not part of the plan (git state can only be judged at run time), so
      // without a separate notice the dry-run preview would hide the only destructive action from the user.
      if (opts.deleteDevelopBranch) {
        const developBranch = existing?.branches?.develop || "develop";
        if (existing?.branches?.main && developBranch === existing.branches.main) {
          console.log(t("cli.index.deleteDevelopSkipDry"));
        } else {
          console.log(t("cli.index.deleteDevelopTryDry"));
        }
      }
      return 0;
    }
    if (!opts.yes) {
      console.error(t("cli.index.purgeNeedsYes"));
      return 1;
    }
    const st = await exec("git", ["status", "--porcelain"], { cwd });
    if (st.code !== 0) {
      console.error(t("cli.index.purgeGitStatusFailed"));
      return 1;
    }
    if (!opts.allowDirty && st.stdout.trim() !== "") {
      console.error(t("cli.index.purgeDirty"));
      return 1;
    }
    if (!opts.force) {
      if (!process.stdout.isTTY) {
        console.error(t("cli.index.forceRequiredNonTty"));
        return 1;
      }
      const repoName = detectRepoName(cwd);
      const typed = await promptRepoName(repoName);
      if (typed !== repoName) {
        console.error(t("cli.index.purgeRepoMismatch"));
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
        console.error(t("cli.index.deleteDevelopSkip"));
      } else {
        const br = await exec("git", ["branch", "-d", developBranch], { cwd });
        if (br.code !== 0) {
          console.error(`⚠️  ${t("cli.index.deleteDevelopFailed", { branch: developBranch, reason: (br.stderr || "").trim() || t("cli.index.reasonUnknown") })}`);
        } else {
          console.error(t("cli.index.deleteDevelopDone", { branch: developBranch }));
        }
      }
    }
    return 0;
  }

  // uninstall mode: removes the installed files and, optionally, the README section, gitignore entries and version.yml.
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
        t("cli.index.removedWorkflows", { n: r.workflows.length }), t("cli.index.removedScripts", { n: r.scripts.length }),
        r.appFiles.length > 0 && t("cli.index.removedAppFiles", { n: r.appFiles.length }),
        r.readme && t("cli.index.removedReadme"),
        r.gitignore && t("cli.index.removedGitignore"), r.versionYml && "version.yml",
      ].filter(Boolean).join(", ");
      console.error(t("cli.index.removed", { removed }));
      return 0;
    }
    if (!process.stdout.isTTY) {
      console.error(t("cli.index.forceRequiredNonTty"));
      return 1;
    }
    startLog("uninstall");
    // --purge-* flags become the initial checklist selection (never silently ignored).
    await runUninstallFlow(payload, cwd, prompts, {
      readme: opts.purgeReadme, gitignore: opts.purgeGitignore, versionYml: opts.purgeVersion,
    });
    return 0;
  }

  // status mode: read-only, always works regardless of TTY/--force
  if (opts.mode === "status") {
    printStatus(runStatus(payload, cwd));
    return 0;
  }
  // doctor mode: read-only, always works regardless of TTY/--force
  if (opts.mode === "doctor") {
    const results = runDoctor(cwd);
    printDoctorReport(results);
    return doctorExitCode(results);
  }
  // An explicit mode (full) without --force is rejected immediately, TTY or not
  // (fixes a defect where a TTY run installed at once without confirmation).
  // --dry-run writes no files, so it bypasses the --force gate (same safety as status/doctor).
  if (!opts.force && !opts.dryRun) {
    console.error(t("cli.index.forceRequired"));
    return 1;
  }

  // Load the existing version.yml: the single source of truth for preserving version/version_code/project_paths
  const vyPath = join(cwd, "version.yml");
  const existing = existsSync(vyPath) ? parseExisting(readFileSync(vyPath, "utf8")) : null;

  // Detection (CLI args first, otherwise auto-detect; the version.yml-first rule lives inside detectTypes/detectVersion).
  // Pass --paths to detection so a monorepo that gives only --paths and omits --type is installed with those types.
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
    hint: t("cli.index.mainBranchHint"),
  });
  const repoName = detectRepoName(cwd);
  // Confirm paths (non-interactive: --paths first -> saved value -> single candidate auto-picked -> error)
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

  // Warn against the final folders (an explicit --paths may keep the other one). The dry-run preview prints its own notice.
  if (!opts.dryRun) for (const line of droppedPathLines(existing?.droppedPaths, paths)) console.error(`⚠️  ${line}`);

  // version: existing version.yml first (SSoT; prevents overwriting on re-run) -> CLI value -> file detection.
  // Non-interactive, so the fallback notice uses the CLI wording (--project-version) as is.
  // Detect after paths are confirmed so a monorepo subfolder's version and build number are read.
  const version = resolveVersion({
    cwd, existing, explicit: opts.version,
    types, paths, warn: (m) => { detectWarnings.push(m); console.error(m); },
  });
  const versionCode = resolveVersionCode({ cwd, existing, types, paths });

  // Branch config (--main-branch/--develop-branch -> saved version.yml value -> detected default -> main/develop).
  // Failed-detection values saved by an earlier version ("(unknown)" etc.) are not accepted as saved values, otherwise re-running would never recover.
  const savedBranch = (b) => (isValidBranchName(b) ? b : "");
  const branches = resolveBranchConfig({
    mainBranch: opts.mainBranch || savedBranch(existing?.branches?.main),
    developBranch: opts.developBranch || savedBranch(existing?.branches?.develop),
    defaultBranch: branch,
  });
  // In pr-flow, if develop is missing on the remote, create and push it automatically (--force non-interactive, no question).
  // If the remote has no branches at all (empty remote / no origin) there is nothing to base the push on, so notify instead of creating.
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

  // Type-specific options: the type hook decides CLI flag -> saved version.yml value -> default. Empty if the type is absent.
  // (For an existing Flutter install without a saved value, the stores are inferred from the installed workflows, same as interactive.)
  const typeOptions = mergeHookResults(types, "resolveOptions", {
    opts, existing, workflowsDir: join(cwd, PATHS.workflowsDir),
  });

  // Chosen deploy style: flag -> saved value -> default. Normalizing to the style actually installed happens when the context is assembled.
  const chosenDeployStyle = resolveDeployStyle({ payload, types, explicit: opts.deployStyle, existing });

  const context = buildInstallContext({
    payload, existing, templateVersion: readTemplateVersion(), types, deployStyle: chosenDeployStyle,
    typeOptions,
    // Options: CLI flag first -> saved version.yml option -> default (same rule as interactive)
    releaseOptions: resolveReleaseOptions({ semverAuto: opts.includeSemverAuto, copilotAi: opts.includeCopilotAi }, existing),
    mode: opts.mode, force: opts.force, version, versionCode, branch,
    branches,
    paths,
    repoName,
    // resolvers that compute @wizard ask/auto token values
    resolvers: makeResolvers(cwd, repoName, paths, typeOptions),
    now, today, language,
    // Extra context for the install log; does not change the install itself.
    markers: detectMarkers(cwd, types), detectWarnings,
  });

  // Types without a zero-downtime (nginx/traefik) workflow are installed with the single-server deploy; say so instead of passing silently.
  const fallbackTypes = fallbackStyleTypes(payload, types, chosenDeployStyle);
  if (fallbackTypes.length) {
    console.error(`⚠️  ${t("cli.index.deployFallback", { types: fallbackTypes.join(", "), style: chosenDeployStyle })}`);
  }

  // Compact non-interactive banner (one line, minimal log noise)
  printBannerCompact({ version: context.templateVersion, mode: opts.mode });

  // Breaking Changes gate (non-interactive warns, then proceeds)
  const proceed = await runBreakingCheck({ cwd, payloadRoot: payload, templateVersion: context.templateVersion });
  if (!proceed) return 0;

  if (opts.dryRun) {
    printDryRun(planDryRun(opts.mode, context, payload, cwd));
    return 0;
  }

  startLog("install");
  // opts.mode passed the whitelist check in parseArgs(), and interactive/purge/uninstall/status/doctor all
  // returned early above, so it is guaranteed to be full here (the default branch is gone along with the
  // removed partial-install modes).
  const result = runFull(context, payload, cwd);

  // Completion summary (also printed in CLI mode)
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
  // The store_submit deploy mode auto-submits for review on every main push, so show the same warning non-interactively
  // (the interactive path shows ui/prompts.js#deployModeWarning as a note at selection time). Only the matching type hook emits it.
  for (const { hook } of hooksFor(types, "installNotices")) {
    for (const w of hook(typeOptions)) {
      if (w) console.error(`⚠️  ${w}`);
    }
  }
  return 0;
}

// Public entry point: closes the logger however the run ends (normal return, CliError, exception).
// A thin wrapper, since wrapping the whole body in try would re-indent all of it.
export async function run(argv, opts = {}) {
  try {
    return await runInner(argv, opts);
  } catch (e) {
    // Ctrl+C/EOF aborts immediately at any question: exit before writing install files and return 130 by shell convention.
    if (isPromptAbort(e)) {
      prompts.cancelMessage(t("cli.index.aborted"));
      return e.signal === "SIGTERM" ? 143 : 130;
    }
    // If a run that already started logging dies midway, a header-only log hides the cause, so record the reason.
    if (currentLogPath()) log.fail("run", "error", e?.message || String(e));
    // Failures the user can fix (permissions, etc.) end with a readable message instead of a stack trace.
    if (e instanceof CliError) { console.error(e.message); return 1; }
    throw e;
  } finally {
    closeLogger();
  }
}
