// CLI argument parsing.
import { VALID_TYPES, VALID_MODES } from "../context.js";
import { DEPLOY_STYLES, isDeployStyle, NO_DEPLOY_STYLE } from "../core/deploy-style.js";
import { isValidBranchName } from "../core/branches.js";
import { TYPES } from "../core/types.js";
import { CliError } from "../core/errors.js";
import { normalizePath, isRepoRelativePath } from "../core/paths.js";
import { t, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, isSupportedLanguage, normalizeLanguage } from "../i18n/index.js";

// Kept for the existing import path (cli/args.js); the definitions live in core.
export { CliError, normalizePath, isRepoRelativePath };

// Type-specific CLI flags (type hook cliFlags): flag name -> { field, initial, parse }. Hooks are collected in type-table order.
export const TYPE_CLI_FLAGS = TYPES.flatMap((t) => t.hooks?.cliFlags ?? []);
const TYPE_CLI_FLAG_BY_NAME = new Map(TYPE_CLI_FLAGS.map((f) => [f.flag, f]));

// argv (process.argv.slice(2)) -> parse result. Throws on error (the caller exits with 1).
export function parseArgs(argv) {
  const result = {
    mode: "interactive",
    version: "",             // initial version of the target project (--project-version)
    types: [],
    primaryType: "",
    includeSemverAuto: null,  // --semver-auto / --no-semver-auto (default true; resolved downstream when unset)
    includeCopilotAi: null,   // --copilot / --no-copilot (default false; opt-in because it consumes AI Credits)
    pathsCsv: "",            // raw "flutter=app,react=client" (normalized in the resolve step)
    mainBranch: "",          // release branch (--main-branch). empty = detected default branch
    developBranch: "",       // development branch (--develop-branch). empty = develop
    deployStyle: "",         // server deploy style (--deploy-style). empty = saved version.yml value -> simple
    // Type-specific flag fields (e.g. Flutter env mode, store targets, deploy mode); unset values are decided by the type hook.
    ...Object.fromEntries(TYPE_CLI_FLAGS.map((f) => [f.field, f.initial])),
    lang: "",                // message language (--lang). empty = env var -> saved version.yml value -> en
    force: false,
    help: false,
    showVersion: false,      // -v/--version -> print the package version (npm convention)
    dryRun: false,        // --dry-run: preview only, no changes (full/uninstall)
    purgeReadme: false,       // --purge-readme: also remove the README version section on uninstall --force
    purgeGitignore: false,    // --purge-gitignore: also remove auto-added .gitignore entries on uninstall --force
    purgeVersion: false,      // --purge-version: also remove version.yml on uninstall --force
    // purge-only flags (hidden mode; not shown in the help text).
    yes: false,               // --yes: confirms purge (required; --force cannot replace it)
    allowDirty: false,        // --allow-dirty: proceed even with a dirty git working tree
    deleteDevelopBranch: false, // --delete-develop-branch: also delete the local develop branch
    keepVersionYml: false,
    keepReadme: false,
    keepChangelog: false,
    keepWorkflows: false,
    keepScripts: false,
  };
  const args = [...argv];
  const seenFlags = new Set(); // for validating mutually exclusive flags such as --semver-auto/--copilot
  while (args.length > 0) {
    const a = args.shift();
    const typeFlag = TYPE_CLI_FLAG_BY_NAME.get(a);
    if (typeFlag) { result[typeFlag.field] = typeFlag.parse(args.shift()); continue; }
    switch (a) {
      case "-m": case "--mode":
        result.mode = args.shift() ?? ""; break;
      case "-v": case "--version":
        // npm convention: -v/--version prints the package version (use --project-version for the initial version).
        result.showVersion = true; break;
      case "--project-version": {
        // The release workflow (version_manager) can only bump x.y.z, so accept the common v prefix and strip it.
        const raw = (args.shift() ?? "").trim();
        const v = raw.replace(/^v/i, "");
        if (!/^\d+\.\d+\.\d+$/.test(v)) {
          throw new CliError(t("cli.args.projectVersionInvalid", { raw }));
        }
        result.version = v; break;
      }
      case "-t": case "--type": {
        const csv = args.shift() ?? "";
        const seen = new Set();
        const types = [];
        for (let name of csv.split(",")) {
          name = name.replace(/\s/g, "");
          if (name === "") continue;
          if (seen.has(name)) continue;      // dedup
          if (!VALID_TYPES.includes(name)) {
            throw new CliError(t("cli.args.typeUnsupported", { type: name, valid: VALID_TYPES.join(" ") }));
          }
          seen.add(name);
          types.push(name);
        }
        if (types.length === 0) throw new CliError(t("cli.args.typeEmpty"));
        result.types = types;
        result.primaryType = types[0];
        break;
      }
      case "--lang": {
        // Errors here always use the default language (en) so they stay stable regardless of the provisional language.
        const supported = SUPPORTED_LANGUAGES.join(", ");
        const raw = args.shift();
        const v = normalizeLanguage(raw);
        if (!v) throw new CliError(t("cli.lang.missing", { supported }, DEFAULT_LANGUAGE));
        if (!isSupportedLanguage(v)) {
          throw new CliError(t("cli.lang.invalid", { value: String(raw).trim(), source: "--lang", supported }, DEFAULT_LANGUAGE));
        }
        result.lang = v; break;
      }
      case "--force": result.force = true; break;
      case "--dry-run": result.dryRun = true; break;
      case "--purge-readme": result.purgeReadme = true; break;
      case "--purge-gitignore": result.purgeGitignore = true; break;
      case "--purge-version": result.purgeVersion = true; break;
      case "--yes": result.yes = true; break;
      case "--allow-dirty": result.allowDirty = true; break;
      case "--delete-develop-branch": result.deleteDevelopBranch = true; break;
      case "--keep-version-yml": result.keepVersionYml = true; break;
      case "--keep-readme": result.keepReadme = true; break;
      case "--keep-changelog": result.keepChangelog = true; break;
      case "--keep-workflows": result.keepWorkflows = true; break;
      case "--keep-scripts": result.keepScripts = true; break;
      case "--deploy-style": {
        const v = args.shift();
        if (!isDeployStyle(v)) {
          throw new CliError(t("cli.args.deployStyleInvalid", {
            value: v ?? t("cli.args.noValue"), choices: [...DEPLOY_STYLES.map((s) => s.value), NO_DEPLOY_STYLE].join(" | "),
          }));
        }
        result.deployStyle = v; break;
      }
      case "--semver-auto":
        if (seenFlags.has("--no-semver-auto")) throw new CliError(t("cli.args.semverConflict"));
        seenFlags.add("--semver-auto"); result.includeSemverAuto = true; break;
      case "--no-semver-auto":
        if (seenFlags.has("--semver-auto")) throw new CliError(t("cli.args.semverConflict"));
        seenFlags.add("--no-semver-auto"); result.includeSemverAuto = false; break;
      case "--copilot":
        if (seenFlags.has("--no-copilot")) throw new CliError(t("cli.args.copilotConflict"));
        seenFlags.add("--copilot"); result.includeCopilotAi = true; break;
      case "--no-copilot":
        if (seenFlags.has("--copilot")) throw new CliError(t("cli.args.copilotConflict"));
        seenFlags.add("--no-copilot"); result.includeCopilotAi = false; break;
      case "--paths": {
        // Silently falling back to auto-detection would install to paths other than the ones the user thinks they set.
        const v = (args.shift() ?? "").trim();
        if (!v) throw new CliError(t("cli.args.pathsEmpty"));
        result.pathsCsv = v; break;
      }
      case "--main-branch": case "--develop-branch": {
        const v = (args.shift() ?? "").trim();
        if (!v) throw new CliError(t("cli.args.branchEmpty", { flag: a }));
        // The value is substituted into workflow triggers and shell commands, so reject unusable names before installing.
        if (!isValidBranchName(v)) throw new CliError(t("cli.args.branchInvalid", { flag: a, value: v }));
        if (a === "--main-branch") result.mainBranch = v; else result.developBranch = v;
        break;
      }
      case "-h": case "--help": result.help = true; break;
      default:
        throw new CliError(t("cli.args.unknownOption", { option: a }));
    }
  }
  if (!VALID_MODES.includes(result.mode)) {
    throw new CliError(t("cli.args.modeUnsupported", { mode: result.mode }));
  }
  return result;
}

// "flutter=app,react=client" -> Map<type, normalizedPath>. Validates types (invalid -> throw).
export function parsePathsCsv(csv) {
  const map = new Map();
  if (!csv) return map;
  for (const pair of csv.split(",")) {
    if (pair.trim() === "") continue;
    const eq = pair.indexOf("=");
    const type = (eq >= 0 ? pair.slice(0, eq) : pair).replace(/\s/g, "");
    const rawPath = eq >= 0 ? pair.slice(eq + 1) : "";
    if (!VALID_TYPES.includes(type)) {
      throw new CliError(t("cli.args.pathsTypeUnsupported", { type }));
    }
    const path = normalizePath(rawPath);
    if (!isRepoRelativePath(path)) {
      throw new CliError(t("cli.args.pathsRelativeOnly", { pair: `${type}=${rawPath.trim()}` }));
    }
    map.set(type, path);
  }
  return map;
}
