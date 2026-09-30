// Interactive wizard.
// Testable through io injection. The real run passes the src/ui/prompts.js functions as io.
// The visual layers (banner/detectionLog/analysisCard/installKind/summary) and the low-level engine (engineIo)
// are "optional members" of io - a stub that omits them just skips that layer; the execution contract is the same.
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { resolvePayloadRoot, assertPayload, readTemplateVersion } from "../core/assets.js";
import { detectTypes, detectVersion, detectDefaultBranch, detectRepoName, makeResolvers, detectMarkers } from "../core/detect-fs.js";
import { parseExisting, droppedPathLines } from "../core/version-yml.js";
import { pickReleaseOptions, resolveReleaseOptions } from "../core/release-options.js";
import { OPTIONS, askableOptions, explicitFromContext } from "../core/options.js";
import { runBreakingCheck } from "../core/breaking-check.js";
import { resolveProjectPaths } from "../core/paths-resolve.js";
import {
  resolveBranchConfig, detectRemoteBranches, ensureDevelopBranch, sortBranchesForSelection, isValidBranchName, developMissingNotice,
} from "../core/branches.js";
import { promptEnvPlan } from "../ui/env-plan.js";
import { surveyWorkflows } from "../core/copy/workflows.js";
import { VALID_TYPES } from "../context.js";
import { savedDeployStyle, resolveDeployStyle, resolveVersion, resolveVersionCode, buildInstallContext } from "./install-settings.js";
import { isDeployStyle, DEFAULT_DEPLOY_STYLE, hasServerDeployWorkflows, hasNonstopWorkflows } from "../core/deploy-style.js";
import { PATHS } from "../core/paths.js";
import { resolveFlutterOptions, DEFAULT_DEPLOY_MODE, STORE_PLATFORMS } from "../core/flutter-options.js";
import { inferInstalledStores } from "../core/installed-stores.js";
import { savedFlutterState, askUnsetFlutterOptions, editFlutterOption, FLUTTER_EDIT_ITEMS } from "./interactive-flutter.js";
import { runFull, postInstallNotices } from "./full.js";
import { runUninstallFlow } from "./uninstall.js";
import * as prompts from "../ui/prompts.js";
import { runStatus, printStatus } from "./status.js";
import { runDoctor, printDoctorReport } from "./doctor.js";
import { currentLogPath, hasLegacyMdLogs } from "../core/logger.js";
import { t, getLanguage } from "../i18n/index.js";

const CANCEL = prompts.CANCEL;

const isCancel = (v) => v === CANCEL || typeof v === "symbol";

// io defaults to the real prompts. Tests inject a stub io.
export async function runInteractive(baseCtx, { cwd = process.cwd(), payloadRoot, clock, io = prompts } = {}) {
  const payload = assertPayload(payloadRoot ?? resolvePayloadRoot());
  const templateVersion = readTemplateVersion();

  // Start banner. Stubs have no banner -> fall back to intro.
  if (io.banner) io.banner({ version: templateVersion, modeLabel: t("interactive.banner.modeLabel") });
  else io.intro?.(t("interactive.intro"));

  // Existing version.yml - single source of truth for preserving version/version_code/paths/options
  const vyPath = join(cwd, "version.yml");
  const existing = existsSync(vyPath) ? parseExisting(readFileSync(vyPath, "utf8")) : null;

  // New install vs update detection
  io.installKind?.({ currentTemplateVersion: existing?.templateVersion || "", templateVersion });

  // 1) Mode selection
  // status/doctor are read-only, so no detection or breaking gate is needed. After showing the result we
  // return to the menu: the point of diagnosis is install preparation, so check -> install should finish in one session.
  // The CLI path (--mode status/doctor in index.js) is a one-shot command, so it exits immediately as before.
  let mode;
  for (let round = 0; ; round++) {
    mode = await io.selectMode({ again: round > 0 });
    if (mode === CANCEL || mode == null) { io.cancelMessage?.(t("interactive.cancel.install")); return 0; }
    if (mode === "status") { printStatus(runStatus(payload, cwd)); continue; }
    if (mode === "doctor") { printDoctorReport(runDoctor(cwd)); continue; }
    break;
  }

  // uninstall mode - delete after per-item opt-in through an interactive checklist. No detection or breaking gate needed.
  // runUninstallFlow returns null on cancel / nothing to remove - then the completion outro is not printed.
  if (mode === "uninstall") {
    const result = await runUninstallFlow(payload, cwd, io);
    if (result) io.outro?.(t("interactive.outro.uninstall"));
    return 0;
  }

  // Breaking Changes gate (common to all modes, a confirmation question in interactive mode)
  const proceed = await runBreakingCheck({
    cwd, payloadRoot: payload, templateVersion,
    askYesNo: (msg, def) => io.askYesNo(msg, def),
  });
  if (!proceed) { io.cancelMessage?.(t("interactive.cancel.integration")); return 0; }

  // full/version/workflows - detection (the existing version.yml takes top priority for version)
  // Detection warnings are collected and printed inside the detection box instead of immediately - they used to
  // appear before the box and look like warnings about the previous question. The hint text is also adapted for interactive mode.
  const detectWarnings = [];
  let types = detectTypes(cwd);
  let version = resolveVersion({
    cwd, existing, types,
    warn: (m) => detectWarnings.push(m),
    hint: t("interactive.hint.version"),
  });
  // Whether to re-detect in a monorepo subfolder once paths are settled - saved values and hand-typed values are left alone.
  let versionAutoDetected = !existing?.version;
  let branch = detectDefaultBranch(cwd, {
    warn: (m) => detectWarnings.push(m),
    hint: t("interactive.hint.branch"),
  });
  const repoName = detectRepoName(cwd);
  // Initial values of optional workflows: CLI flags (--copilot etc.) -> options saved in version.yml
  // Values set by a flag skip the question - same priority as non-interactive mode.
  // optionState: option name -> boolean|null (null = undecided; settled by resolveReleaseOptions below). Driven by the option registry.
  const optionState = pickReleaseOptions(explicitFromContext(baseCtx ?? {}), existing);
  // Server deploy style - not asked again when a saved value (version.yml) exists (same convention as semver_auto).
  let deployStyle = savedDeployStyle(existing);
  const showOptional = mode === "full";
  const realTty = process.stdout.isTTY === true;

  // Flutter options - not asked again when a saved value exists (same convention as deploy_style).
  // Existing installs without saved values start with dotenv to preserve behaviour, and stores are inferred from the installed workflows.
  // The env default rule (new = dart-define, existing install without saved value = dotenv) lives only in resolveFlutterOptions.
  let flutter = savedFlutterState(existing);
  const flutterAsk = {
    envModeDefault: resolveFlutterOptions({
      cli: { envMode: "", stores: null, androidDeployMode: "", iosDeployMode: "" }, existing,
    }).envMode,
    // The initial selection of a new install must equal the CLI default (--flutter-store unspecified = both) - the install result must not depend on the path taken.
    inferredStores: existing && flutter.stores === null ? inferInstalledStores(join(cwd, PATHS.workflowsDir)) : [...STORE_PLATFORMS],
  };
  // Already-decided values are skipped, so calling this several times never repeats a question.
  const askFlutterOptions = async () => {
    if (types.includes("flutter")) flutter = await askUnsetFlutterOptions(io, flutter, flutterAsk);
  };
  // Server deploy style - asked only for types that have server-deploy (CD) workflows (spring, go, python, ...).
  // For other types the question does not affect the install result, so it is neither asked nor recorded.
  const hasServerDeploy = () => hasServerDeployWorkflows(payload, types);
  const askDeployStyle = async () => {
    if (isDeployStyle(deployStyle) || !hasServerDeploy()) return;
    const picked = await io.selectDeployStyle({ nonstop: hasNonstopWorkflows(payload, types) });
    deployStyle = isDeployStyle(picked) ? picked : DEFAULT_DEPLOY_STYLE; // ESC = default
  };

  // Detection log. markers = files whose existence was actually confirmed.
  let markers = detectMarkers(cwd, types);
  io.detectionLog?.({ types, version, branch, markers, warnings: detectWarnings });

  // Confirm types - detection is a guess, so get confirmation before any other question. The confirmation UI used to be
  // hidden two steps deep in 'Edit > Project type', so installs often finished with the wrong type.
  // Types decide the scope of the later questions (optional workflows, paths, env), so this is the right place in the order.
  // Not asked for update installs with saved values and in non-interactive mode - unchanged behaviour.
  if (showOptional && !existing?.types?.length) {
    const picked = await io.confirmTypes({ types, markers });
    if (!isCancel(picked) && Array.isArray(picked) && picked.length) {
      const next = picked.filter((x) => VALID_TYPES.includes(x));
      if (next.length) {
        types = next;
        markers = detectMarkers(cwd, types);
      }
    }
  }

  // Deploy style, Flutter options, semver/Copilot questions - only when optional items are asked (showOptional)
  if (showOptional) {
    await askDeployStyle();

    // Flutter options - env mode -> store deploy targets -> per-platform deploy mode.
    await askFlutterOptions();

    // Optional-workflow questions (auto semver bump default ON, Copilot AI summary default No - it consumes AI Credits).
    // Each is skipped when a flag or a saved value exists. In workflows mode version.yml is not written and the answer
    // is meaningless, so they are asked only in full. Options without `ask` in the registry are never asked.
    for (const o of askableOptions()) {
      if (mode === "full" && optionState[o.name] === null) {
        const answer = await io.askYesNo(t(o.ask.questionKey), o.ask.initial);
        optionState[o.name] = answer === true;
      }
    }
  }
  // When a question was actually asked (the full-mode questions above) its answer is respected, and only options that were not asked
  // are filled with defaults - same function as the CLI path (index.js), hence the same rule.
  // Fill undecided options with defaults; keep the whole result (also the options that are never asked) so a saved
  // value such as release_automerge: false survives an interactive reinstall.
  const settledOptions = resolveReleaseOptions(optionState, existing);
  for (const o of OPTIONS) optionState[o.name] = settledOptions[o.ctxField];
  const showOptionToggles = mode === "full";

  // Confirm/edit loop - ESC means 'stay' (only an explicit 'No' exits)
  let paths = new Map();
  let confirmed = false;
  while (!confirmed) {
    // Project analysis overview card. Stubs have none -> fall back to note.
    if (io.analysisCard) {
      io.analysisCard({
        mode, modeLabel: modeLabel(mode), types, version, branch, showOptional, paths, flutter, envModeDefault: flutterAsk.envModeDefault,
        options: showOptionToggles ? { ...optionState } : null,
      });
    } else {
      io.note?.(summarize({
        mode, types, version, branch, showOptional, flutter, envModeDefault: flutterAsk.envModeDefault,
        options: showOptionToggles ? { ...optionState } : null,
      }), t("interactive.summary.title"));
    }
    const choice = await io.confirmProjectMenu();
    if (choice === "cancel") { io.cancelMessage?.(t("interactive.cancel.install")); return 0; }
    if (isCancel(choice) || choice == null) continue; // ESC = stay (redraw the loop)
    if (choice === "continue") { confirmed = true; break; }
    // edit loop
    let editing = true;
    while (editing) {
      const what = await io.editMenu({ showFlutter: showOptional && types.includes("flutter"), showOptions: showOptionToggles });
      if (isCancel(what) || what === "done") { editing = false; break; }
      if (what === "type") {
        const picked = await io.selectTypes(types);
        if (!isCancel(picked) && Array.isArray(picked) && picked.length) {
          // If the type set really changed, reset it so paths are re-resolved (sorted-set comparison)
          const oldSorted = [...types].sort().join(",");
          types = picked.filter((x) => VALID_TYPES.includes(x));
          if ([...types].sort().join(",") !== oldSorted) paths = new Map();
        }
      } else if (what === "version") {
        const v = await io.askText(t("interactive.edit.versionPrompt"), version);
        if (!isCancel(v) && v !== version) {
          // semver format check
          if (/^\d+\.\d+\.\d+$/.test(v)) { version = v; versionAutoDetected = false; }
          else io.note?.(t("interactive.edit.versionInvalid"), t("interactive.edit.versionInvalidTitle"));
        }
      } else if (what === "branch") {
        branch = await askBranchName(io, t("interactive.edit.branchPrompt"), branch, isCancel);
      } else if (askableOptions().some((o) => o.name === what)) {
        // A saved value skips the first question, so this is the only place to change a value once decided.
        const o = askableOptions().find((x) => x.name === what);
        const y = await io.askYesNo(t(o.ask.questionKey), optionState[o.name]);
        if (typeof y === "boolean") optionState[o.name] = y;
      } else if (FLUTTER_EDIT_ITEMS.has(what)) {
        flutter = await editFlutterOption(io, what, flutter, flutterAsk.envModeDefault);
      }
    }
  }

  // Settle the options even when the flutter type was added late in the edit loop - already-decided values are not asked again.
  // The same goes for a server-deploy type added late.
  if (showOptional) {
    await askDeployStyle();
    await askFlutterOptions();
  }
  // Even when no question was asked (non-full modes etc.) fill in behaviour-preserving defaults so workflow substitution stays consistent.
  const flutterOptions = {
    envMode: flutter.envMode || flutterAsk.envModeDefault,
    stores: flutter.stores,
    androidDeployMode: flutter.androidDeployMode || DEFAULT_DEPLOY_MODE,
    iosDeployMode: flutter.iosDeployMode || DEFAULT_DEPLOY_MODE,
  };

  // Branch setup. Only full/workflows ask; version records the defaults.
  // A saved value (version.yml metadata.template.branches) is reused without asking (update mode).
  // A detection-failure value saved by an earlier version ("(unknown)" etc.) counts as not saved and is asked again.
  const savedBranches = existing?.branches
    && isValidBranchName(existing.branches.main) && isValidBranchName(existing.branches.develop)
    ? existing.branches : null;
  let branches = savedBranches
    ? resolveBranchConfig({ mainBranch: savedBranches.main, developBranch: savedBranches.develop, defaultBranch: branch })
    : resolveBranchConfig({ defaultBranch: branch });
  let developMissing = false;
  if (showOptional && !savedBranches) {
    const remoteBranches = await detectRemoteBranches(cwd);
    // Instead of the implicit rule that trunk-based only happens when the same name is typed for both questions,
    // let the user pick the strategy explicitly first. Cancel / any other value falls back to pr-flow, the existing default
    // (same "ESC = default" pattern as selectDeployStyle).
    const strategyPick = await io.selectBranchStrategy();
    const strategy = strategyPick === "trunk-based" ? "trunk-based" : "pr-flow";
    const mainB = await pickBranch(io, t("interactive.branch.releasePrompt", { branch }), branch, remoteBranches, isCancel);
    // For trunk-based the development-branch question is skipped - the only branch (main) doubles as develop.
    const devB = strategy === "trunk-based"
      ? mainB
      : await pickBranch(io, t("interactive.branch.developPrompt"), "develop", remoteBranches, isCancel);
    branches = resolveBranchConfig({ mainBranch: mainB, developBranch: devB, defaultBranch: branch });
    if (branches.mode === "trunk-based") {
      io.note?.(t("interactive.branch.trunkNote", { main: branches.main }), t("interactive.branch.modeTitle"));
    } else if (!remoteBranches.length) {
      // With no remote or an empty one there is nothing to push against - report that it was not created and how to do it.
      developMissing = true;
      io.note?.(developMissingNotice(branches), t("interactive.branch.title"));
    } else if (!remoteBranches.includes(branches.develop)) {
      const r = await ensureDevelopBranch({
        develop: branches.develop, remoteBranches, cwd,
        confirm: (msg) => io.askYesNo(msg, true),
        log: (m) => io.note?.(m, t("interactive.branch.title")),
      });
      developMissing = r.created !== true || r.pushed === false;
    }
  }

  // Settle paths (saved values, candidate scan, questions)
  if (mode === "full") {
    paths = await resolveProjectPaths({
      root: cwd, types, paths, existingPaths: existing?.paths ?? new Map(),
      force: false, tty: realTty, io: io.engineIo ?? {},
    });
  } else {
    for (const ty of types) if (ty !== "basic" && !paths.has(ty)) paths.set(ty, existing?.paths.get(ty) || ".");
  }

  // Announce merged folders only now: the message must follow the folders actually chosen, not the saved ones.
  if (existing?.droppedPaths?.length) io.note?.(droppedPathLines(existing.droppedPaths, paths).join("\n"), t("core.versionYml.pathMergedTitle"));

  // In a monorepo the version/build-number files live inside the type folder - detect there now that paths are settled.
  if (versionAutoDetected && [...paths.values()].some((p) => p && p !== ".")) {
    version = detectVersion(cwd, { types, paths, warn: () => {} });
  }
  const versionCode = resolveVersionCode({ cwd, existing, types, paths });

  // @wizard env plan questions (full/workflows only)
  const resolvers = makeResolvers(cwd, repoName, paths, flutterOptions);
  let envValues = new Map(), envUseDefaults = true, envAnswers = [];
  if (showOptional) {
    const plan = await promptEnvPlan({
      payloadRoot: payload, types, io: io.engineIo ?? null, force: false,
      resolvers, deployStyle, targetRoot: cwd, repoName,
      flutterStore: flutterOptions.stores, // ask questions of deselected store workflows are not asked
    });
    envValues = plan.values;
    envUseDefaults = plan.useDefaults;
    envAnswers = plan.answers || []; // the completion summary and install log share the same answer data
  }

  const { now, today } = clock || utcNow();
  const ctx = buildInstallContext({
    payload, existing, templateVersion, types,
    // Even if the saved value is zero-downtime, a single-server deploy is installed when the chosen types lack that style - record the style actually installed.
    deployStyle: resolveDeployStyle({ payload, types, explicit: deployStyle, existing }),
    typeOptions: flutterOptions,
    releaseOptions: Object.fromEntries(OPTIONS.map((o) => [o.ctxField, optionState[o.name]])),
    mode, force: true, version, versionCode, branch, branches, paths,
    repoName, resolvers, envValues, envUseDefaults, now, today,
    language: baseCtx.language ?? existing?.language ?? getLanguage(),
    // Extra context used by the install log and completion summary - does not change the install behaviour itself.
    markers, envAnswers, detectWarnings,
  });

  // Ask only what the user has to answer. The baseline 3-way merge filters out the automatically
  // safe cases, so what reaches here is (a) real conflicts where both sides changed and (b) files the user deleted.
  let hooks = {};
  if (showOptional && io.engineIo?.select) {
    const { conflicts, removed } = surveyWorkflows(ctx, payload, cwd);

    // (b) Deleted files - never restored silently. The key point is that restoring is not the default.
    const restoreRemoved = new Set();
    if (removed.length) {
      io.note?.(removed.map((r) => `  - ${r.filename}`).join("\n"),
        t("interactive.removed.title", { count: removed.length }));
      for (const { filename } of removed) {
        const sel = await io.engineIo.select({
          message: t("interactive.removed.message", { filename }),
          options: [
            { value: "keep", label: t("interactive.removed.keep") },
            { value: "restore", label: t("interactive.removed.restore") },
          ],
        });
        if (!isCancel(sel) && sel === "restore") restoreRemoved.add(filename); // ESC = keep
      }
    }

    // (a) Real conflicts, three choices - one decision per type, applied to its files via a cache
    const decisions = new Map();
    if (conflicts.length) {
      const perType = new Map();
      for (const { filename, type } of conflicts) {
        if (!perType.has(type)) {
          const sel = await io.engineIo.select({
            message: t("interactive.conflict.message", { type }),
            options: [
              { value: "skip", label: t("interactive.conflict.skip") },
              { value: "backup", label: t("interactive.conflict.backup") },
              { value: "template", label: t("interactive.conflict.template") },
            ],
          });
          perType.set(type, isCancel(sel) || sel == null ? "skip" : sel); // ESC = skip
        }
        decisions.set(filename, perType.get(type));
      }
    }
    hooks = { decisions, restoreRemoved };
  }

  const result = runFull(ctx, payload, cwd, hooks);

  // Completion summary
  io.summary?.({
    mode, types, version, versionCode, branches, developMissing,
    copiedFiles: result?.workflows?.copiedFiles ?? [],
    autoUpdated: result?.workflows?.autoUpdated ?? [],
    gitignoreUpdated: result?.gitignoreUpdated === true,
    answers: envAnswers,
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
  const notices = postInstallNotices(result, { interactive: true });
  if (notices.length) io.note?.(notices.join("\n"), t("interactive.notices.title"));
  io.outro?.(t("interactive.outro.done", { mode }));
  return 0;
}

// Branch selection - select (+ manual entry) when a remote list exists, otherwise text input. ESC/empty = default.
// def sorts first, main/develop next, and the cursor is pinned to def.
export async function pickBranch(io, message, def, remoteBranches, isCancel) {
  if (io.engineIo?.select && remoteBranches.length) {
    const sorted = sortBranchesForSelection(remoteBranches, def);
    const options = [];
    if (!sorted.includes(def)) options.push({ value: def, label: t("interactive.branch.defaultNew", { name: def }) });
    for (const b of sorted) options.push({ value: b, label: b === def ? t("interactive.branch.defaultMark", { name: b }) : b });
    options.push({ value: "__custom__", label: t("interactive.branch.custom") });
    const initialIndex = Math.max(0, options.findIndex((o) => o.value === def));
    const sel = await io.engineIo.select({ message, options, initialIndex });
    if (sel === "__custom__") return askBranchName(io, t("interactive.branch.namePrompt"), def, isCancel);
    return isCancel(sel) || sel == null ? def : sel;
  }
  return askBranchName(io, message, def, isCancel);
}

// Branch name text input - trim whitespace, use the default when empty or ESC, ask again for unusable names.
// The value goes into the workflow trigger as is, so names with spaces etc. would keep the workflow from ever running.
async function askBranchName(io, message, def, isCancel) {
  for (;;) {
    const v = await io.askText(message, def);
    if (isCancel(v)) return def;
    const name = String(v ?? "").trim();
    if (!name) return def;
    if (isValidBranchName(name)) return name;
    io.note?.(t("interactive.branch.invalid", { name }), t("interactive.branch.invalidTitle"));
  }
}

function summarize({ mode, types, version, branch, showOptional, flutter, envModeDefault, options = null }) {
  const lines = [
    t("interactive.summary.mode", { value: modeLabel(mode) }),
    t("interactive.summary.types", { value: `${types.join(", ")}${types.length > 1 ? t("interactive.summary.multi") : ""}` }),
    t("interactive.summary.version", { value: version }),
    t("interactive.summary.branch", { value: branch }),
  ];
  if (showOptional) {
    if (types.includes("flutter")) {
      const stores = flutter.stores ?? [];
      const modeParts = stores.map((p) => `${p}=${(p === "android" ? flutter.androidDeployMode : flutter.iosDeployMode) || DEFAULT_DEPLOY_MODE}`);
      lines.push(t("interactive.summary.envMode", { value: flutter.envMode || envModeDefault }));
      lines.push(t("interactive.summary.stores", { value: stores.length ? stores.join(", ") : t("interactive.summary.none") }));
      lines.push(t("interactive.summary.deployMode", { value: modeParts.length ? modeParts.join(" ") : t("interactive.summary.none") }));
    }
  }
  if (options) {
    for (const o of askableOptions()) {
      lines.push(t(o.ask.summaryKey, { value: options[o.name] ? t("interactive.summary.on") : t("interactive.summary.off") }));
    }
  }
  return lines.join("\n");
}

function modeLabel(m) {
  return { full: t("interactive.modeLabel.full"), version: t("interactive.modeLabel.version"), workflows: t("interactive.modeLabel.workflows") }[m] || m;
}

function utcNow(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const d = `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
  const tm = `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`;
  return { now: `${d} ${tm}`, today: d };
}
