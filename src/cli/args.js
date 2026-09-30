// CLI argument parsing.
import { VALID_TYPES, VALID_MODES } from "../context.js";
import { DEPLOY_STYLES, isDeployStyle, NO_DEPLOY_STYLE } from "../core/deploy-style.js";
import { isValidBranchName } from "../core/branches.js";
import { TYPES, canonicalTypeId } from "../core/types.js";
import { CliError } from "../core/errors.js";
import { OPTIONS, defaultContextFields } from "../core/options.js";
import { normalizePath, isRepoRelativePath } from "../core/paths.js";
import { t, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, isSupportedLanguage, normalizeLanguage } from "../i18n/index.js";

// Kept for the existing import path (cli/args.js); the definitions live in core.
export { CliError, normalizePath, isRepoRelativePath };

// Type-specific CLI flags (type hook cliFlags): flag name -> { field, initial, parse }. Hooks are collected in type-table order.
// --<flag> / --no-<flag> for every registry option - a new option needs no change here.
const OPTION_CLI_FLAGS = new Map(OPTIONS.flatMap((option) => [
  [`--${option.flag}`, { option, value: true }],
  [`--no-${option.flag}`, { option, value: false }],
]));
export const TYPE_CLI_FLAGS = TYPES.flatMap((t) => t.hooks?.cliFlags ?? []);
const TYPE_CLI_FLAG_BY_NAME = new Map(TYPE_CLI_FLAGS.map((f) => [f.flag, f]));

// Options that consume a value, and options that are plain switches. Needed to expand `--name=value`.
const VALUE_FLAGS = new Set([
  "--mode", "--project-version", "--type", "--lang", "--deploy-style", "--paths", "--main-branch", "--develop-branch",
  ...TYPE_CLI_FLAGS.map((f) => f.flag),
]);
const SWITCH_FLAGS = new Set([
  "--version", "--help", "--force", "--dry-run", "--purge-readme", "--purge-gitignore", "--purge-version", "--yes", "--allow-dirty",
  "--delete-develop-branch", "--keep-version-yml", "--keep-readme", "--keep-changelog", "--keep-workflows", "--keep-scripts",
  ...OPTIONS.flatMap((o) => [`--${o.flag}`, `--no-${o.flag}`]),
]);

// `--name=value` -> `--name`, `value`, so the parser below only sees the space-separated form.
// Only the first "=" splits, so `--paths=flutter=app` keeps its value intact. A switch given a value is an error
// (silently ignoring it would hide a typo); an unknown name is left as-is and reported by the parser.
// The token after a value option is that option's value and is never expanded.
function expandInlineValues(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    if (eq < 0) {
      out.push(a);
      if (VALUE_FLAGS.has(a) && i + 1 < argv.length) out.push(argv[++i]);
      continue;
    }
    const name = a.slice(0, eq);
    if (VALUE_FLAGS.has(name)) out.push(name, a.slice(eq + 1));
    else if (SWITCH_FLAGS.has(name)) throw new CliError(t("cli.args.flagNoValue", { flag: name, value: a.slice(eq + 1) }));
    else out.push(a);
  }
  return out;
}

// argv (process.argv.slice(2)) -> parse result. Throws on error (the caller exits with 1).
export function parseArgs(argv) {
  const result = {
    mode: "interactive",
    version: "",             // initial version of the target project (--project-version)
    types: [],
    primaryType: "",
    ...defaultContextFields(), // --<flag> / --no-<flag> per registry option (null = unset, resolved downstream)
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
  const args = expandInlineValues(argv);
  const seenFlags = new Set(); // for validating mutually exclusive flags such as --semver-auto/--copilot
  while (args.length > 0) {
    const a = args.shift();
    const typeFlag = TYPE_CLI_FLAG_BY_NAME.get(a);
    if (typeFlag) { result[typeFlag.field] = typeFlag.parse(args.shift()); continue; }
    const optionFlag = OPTION_CLI_FLAGS.get(a);
    if (optionFlag) {
      const { option, value } = optionFlag;
      // --<flag> and --no-<flag> together are contradictory, so reject instead of letting the last one win
      if (seenFlags.has(`--${value ? "no-" : ""}${option.flag}`)) throw new CliError(t(option.conflictKey));
      seenFlags.add(a); result[option.ctxField] = value; continue;
    }
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
          // The alias is resolved here, before validation and dedup (--type react,next is just react).
          // Only registry ids are valid, so an unsupported name is reported as typed.
          const id = canonicalTypeId(name);
          if (seen.has(id)) continue;      // dedup
          if (!VALID_TYPES.includes(id)) {
            throw new CliError(t("cli.args.typeUnsupported", { type: name, valid: VALID_TYPES.join(" ") }));
          }
          seen.add(id);
          types.push(id);
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
  const spelled = new Map(); // type -> name as typed, to tell an alias clash from a plain repeat
  if (!csv) return map;
  for (const pair of csv.split(",")) {
    if (pair.trim() === "") continue;
    const eq = pair.indexOf("=");
    const typeRaw = (eq >= 0 ? pair.slice(0, eq) : pair).replace(/\s/g, "");
    const type = canonicalTypeId(typeRaw);
    const rawPath = eq >= 0 ? pair.slice(eq + 1) : "";
    if (!VALID_TYPES.includes(type)) {
      throw new CliError(t("cli.args.pathsTypeUnsupported", { type: typeRaw }));
    }
    const path = normalizePath(rawPath);
    if (!isRepoRelativePath(path)) {
      throw new CliError(t("cli.args.pathsRelativeOnly", { pair: `${type}=${rawPath.trim()}` }));
    }
    // An alias and its canonical name in one list (react=a,next=b) would silently drop a folder; refuse it instead.
    if (map.has(type) && spelled.get(type) !== typeRaw && map.get(type) !== path) {
      throw new CliError(t("cli.args.pathsDuplicateType", { type }));
    }
    map.set(type, path);
    spelled.set(type, typeRaw);
  }
  return map;
}
