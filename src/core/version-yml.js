import { DEFAULT_DEPLOY_STYLE } from "./deploy-style.js";
import { OPTIONS, optionVar, renderValues } from "./options.js";
import { escapeYamlDoubleQuoted } from "./wizard-env.js";
import { hooksFor, mergeHookResults, allHookValues, canonicalTypeId, canonicalTypeIds } from "./types.js";
import { normalizePath } from "./paths.js";
import { DEFAULT_LANGUAGE, isSupportedLanguage, normalizeLanguage } from "../i18n/languages.js";
// Aliased: `t` is used as a local variable name (type, trimmed line) throughout this file.
import { t as tr } from "../i18n/index.js";

// version.yml parsing and generation (full-regeneration strategy).
// WARNING: no YAML re-serialization - the comments are data.
// Single source of truth for the layout = payload/version.yml.template (injected by the caller as templateText).

// Top-level keys the version.yml.template knows - any other top-level key is considered added by the user.
// "project_type" (singular) is a legacy key that is no longer rendered but stays in this set:
// if removed, the singular line of an existing file would be mistaken for a "field added by the user" and
// revived on regeneration. It must stay a known key so it is absorbed and disappears on re-integration.
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "version", "version_code", "project_types", "project_type", "language", "project_paths", "metadata", "deploy",
]);

// Preserve unknown top-level fields (arbitrary fields the user added) verbatim.
// Everything from each unknown top-level key up to just before the next top-level key is captured
// as one block (so it stays valid YAML even with nested structure). Unknown sub-keys "inside" blocks this
// module already knows, such as metadata/project_paths/deploy, are out of scope.
export function parseExtraTopLevel(content) {
  const blocks = [];
  let current = null;
  for (const line of String(content || "").split("\n")) {
    // Top-level keys may contain hyphens (YAML convention).
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):/);
    if (m) {
      if (current) blocks.push(current.join("\n"));
      current = KNOWN_TOP_LEVEL_KEYS.has(m[1]) ? null : [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current.join("\n"));
  return blocks;
}

// Type-specific option key -> returned field (type hook savedOptionKeys). The value is returned as the raw string; validity is up to the type hook's resolveOptions.
const TYPE_OPTION_KEYS = allHookValues("savedOptionKeys");
const OPTION_BY_KEY = new Map(OPTIONS.map((o) => [o.key, o]));
const OPTION_LINE = new RegExp(`^\\s+(${OPTIONS.map((o) => o.key).join("|")}):\\s*(.+)`);
const TYPE_OPTION_LINE = new RegExp(`^\\s+(${Object.keys(TYPE_OPTION_KEYS).join("|")}):\\s*(.+)`);

// State-machine parse of metadata.template.options.
// Returns: { <one bool|null per registry option, e.g. semverAuto/copilotAi>, deployStyle: string|null,
//         type-specific option fields (e.g. envMode/flutterStore/androidDeployMode/iosDeployMode): string|null } - null = not written.
// Other keys such as the old synology/coderabbit ones hit no branch and are naturally ignored (no parse error).
export function parseTemplateOptions(content) {
  const out = {
    ...Object.fromEntries(OPTIONS.map((o) => [o.name, null])), deployStyle: null,
    ...Object.fromEntries(Object.values(TYPE_OPTION_KEYS).map((field) => [field, null])),
  };
  // Value normalization: strip quotes + trim
  // Strip the inline comment (` # ...`) first, then clean quotes and whitespace. For keys taking a string value (deploy_style),
  // without stripping the comment the whole "simple # simple | nginx ..." becomes the value.
  const strip = (s) => String(s).replace(/\s+#.*$/, "").replace(/["']/g, "").trim();
  let inTemplate = false;
  let inOptions = false;
  for (const line of String(content || "").split("\n")) {
    if (/^\s*template:/.test(line)) { inTemplate = true; continue; }
    if (inTemplate && /^\s+options:/.test(line)) { inOptions = true; continue; }
    if (inTemplate && inOptions) {
      let m = line.match(/^\s+deploy_style:\s*(.+)/);
      if (m) { const v = strip(m[1]); if (v) out.deployStyle = v; continue; }
      m = line.match(TYPE_OPTION_LINE);
      if (m) { const v = strip(m[2]); if (v) out[TYPE_OPTION_KEYS[m[1]]] = v; continue; }
      // Boolean options come from the registry; a value other than true/false is left null (= not written).
      const optionLine = line.match(OPTION_LINE);
      if (optionLine) {
        const v = strip(optionLine[2]);
        if (v === "true") out[OPTION_BY_KEY.get(optionLine[1]).name] = true;
        if (v === "false") out[OPTION_BY_KEY.get(optionLine[1]).name] = false;
        continue;
      }
      // another key indented 0-4 spaces -> end of the options section
      if (/^\s{0,4}[a-z_]+:/.test(line)) { inOptions = false; inTemplate = false; }
    }
    // top-level key -> end of the template section
    if (inTemplate && /^[a-z_]+:/.test(line)) { inTemplate = false; inOptions = false; }
  }
  return out;
}

// User-facing lines for entries parseExisting() folded away: what is kept, what drops out, and how to keep the other folder.
// finalPaths (Map<type, folder>) is the folder set the run will actually write; without it the saved winner is assumed.
// The message follows the real outcome, so an explicit --paths choice is never told the opposite.
export function droppedPathLines(droppedPaths = [], finalPaths = null) {
  return droppedPaths.flatMap((d) => {
    const final = finalPaths?.get(d.type) ?? d.kept;
    const same = (x) => normalizePath(x) === normalizePath(final);
    const lost = same(d.kept) ? d.path : same(d.path) ? d.kept : `${d.kept}, ${d.path}`;
    const lines = [tr("core.versionYml.pathMerged", { keptName: d.keptName, kept: d.kept, name: d.name, path: d.path, type: d.type, final, lost })];
    // The re-run hint only makes sense when the saved winner is what stays.
    if (same(d.kept)) lines.push(tr("core.versionYml.pathMergedHint", { type: d.type, path: d.path }));
    return lines;
  });
}

// Extract values from an existing version.yml (line-based, avoids false hits on comment lines).
export function parseExisting(content) {
  const text = String(content || "");
  const line = (re) => {
    for (const l of text.split("\n")) {
      if (l.startsWith("#")) continue; // exclude comments
      const m = l.match(re);
      if (m) return m[1];
    }
    return null;
  };
  // version: "x.y.z" (digits.digits.digits form only)
  const version = line(/^version:\s*["']?([0-9][0-9.]*)["']?/) || "";
  // version_code: N (positive integer, otherwise 1)
  let versionCode = parseInt(line(/^version_code:\s*([0-9]+)/) || "", 10);
  if (!Number.isInteger(versionCode) || versionCode <= 0) versionCode = 1;
  // project_types: ["a","b"]
  const typesRaw = line(/^project_types:\s*(\[[^\]]*\])/);
  let types = [];
  // Old names (next) are read as their current type so every later step, including the rewrite, only sees canonical ids.
  if (typesRaw) types = canonicalTypeIds([...typesRaw.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  // language: "en" - only supported values count; a hand-edited unknown value is treated as unset
  const langRaw = normalizeLanguage((line(/^language:\s*(.+)/) || "").replace(/\s+#.*$/, "").replace(/["']/g, ""));
  const language = isSupportedLanguage(langRaw) ? langRaw : null;
  // project_paths block: `  type: "path"`
  const paths = new Map();
  // Entries folded into another entry of the same canonical type with a different folder (react: client + next: web).
  // A type holds one folder, so these are lost on rewrite; callers surface them instead of dropping them silently.
  const droppedPaths = [];
  const pathNames = new Map(); // canonical id -> the name the kept folder was written under
  let inPaths = false;
  for (const l of text.split("\n")) {
    if (/^project_paths:/.test(l)) { inPaths = true; continue; }
    if (inPaths) {
      const m = l.match(/^\s+([a-z-]+):\s*"([^"]*)"/);
      // The first entry wins when an old name and its current name are both present.
      if (m) {
        const id = canonicalTypeId(m[1]);
        if (!paths.has(id)) { paths.set(id, m[2]); pathNames.set(id, m[1]); }
        else if (normalizePath(paths.get(id)) !== normalizePath(m[2])) droppedPaths.push({ type: id, keptName: pathNames.get(id), kept: paths.get(id), name: m[1], path: m[2] });
      }
      else if (/^\S/.test(l)) inPaths = false; // end of indentation -> end of block
    }
  }
  // A name listed in project_types without a project_paths entry lives at the repo root, so when it shares a
  // canonical type with a name that has a folder, the root is the folder that drops out.
  if (typesRaw) {
    const names = [...new Set([...typesRaw.matchAll(/"([^"]+)"/g)].map((m) => m[1]))];
    const written = new Set(text.split("\n").map((l) => l.match(/^\s+([a-z-]+):\s*"/)?.[1]).filter(Boolean));
    for (const id of new Set(names.map(canonicalTypeId))) {
      const group = names.filter((n) => canonicalTypeId(n) === id);
      if (group.length < 2 || !paths.has(id)) continue;
      for (const n of group) {
        if (written.has(n) || normalizePath(paths.get(id)) === ".") continue;
        droppedPaths.push({ type: id, keptName: pathNames.get(id), kept: paths.get(id), name: n, path: "." });
      }
    }
  }
  // version inside the template: block
  let templateVersion = "";
  let inTemplate = false;
  for (const l of text.split("\n")) {
    if (/^\s*template:/.test(l)) { inTemplate = true; continue; }
    if (inTemplate) {
      const m = l.match(/^\s*version:\s*"([0-9][0-9.]*)"/);
      if (m) { templateVersion = m[1]; break; }
      if (/^\S/.test(l)) break;
    }
  }
  // Optional workflow options (metadata.template.options)
  const options = parseTemplateOptions(text);
  // metadata.template.branches - main/develop/mode (to skip re-asking in update mode)
  const branches = parseTemplateBranches(text);
  return {
    version, versionCode, types, language, paths, droppedPaths, templateVersion, options, branches,
    deploy: parseDeployBlock(text), extraTopLevel: parseExtraTopLevel(text),
  };
}

// Parse the deploy block - re-reads the deploy values answered at install time for use as defaults on re-runs and updates.
// If it is only written and never read, an untouched file skips substitution so the block disappears, and auto-refresh
// reverts the user's chosen values to the template defaults.
// Returns: Map<type, Map<KEY, value>> (values are the raw text with the double-quote escapes written by buildVersionYml undone)
export function parseDeployBlock(content) {
  const out = new Map();
  let inDeploy = false;
  let current = null;
  for (const raw of String(content || "").split("\n")) {
    const l = raw.replace(/\r$/, "");
    if (/^deploy:/.test(l)) { inDeploy = true; current = null; continue; }
    if (!inDeploy) continue;
    if (/^\S/.test(l)) { inDeploy = false; continue; } // next top-level key -> end of block
    const t = l.match(/^ {2}([a-z][a-z-]*):\s*(?:#.*)?$/);
    if (t) {
      // An old type name shares the block of its current name; keys already present there win.
      const id = canonicalTypeId(t[1]);
      current = out.get(id) ?? new Map();
      out.set(id, current);
      continue;
    }
    const kv = l.match(/^ {4}([A-Za-z_][A-Za-z0-9_]*):\s*"((?:[^"\\]|\\.)*)"/);
    if (kv && current && !current.has(kv[1])) current.set(kv[1], kv[2].replace(/\\(["\\])/g, "$1"));
  }
  return out;
}

// Parse the metadata.template.branches block. All three must be present to be valid - otherwise null.
export function parseTemplateBranches(content) {
  // Strip the inline comment (` # ...`) first, then clean quotes and whitespace. For keys taking a string value (deploy_style),
  // without stripping the comment the whole "simple # simple | nginx ..." becomes the value.
  const strip = (s) => String(s).replace(/\s+#.*$/, "").replace(/["']/g, "").trim();
  let inTemplate = false;
  let inBranches = false;
  const out = { main: "", develop: "", mode: "" };
  for (const line of String(content || "").split("\n")) {
    if (/^\s*template:/.test(line)) { inTemplate = true; continue; }
    if (inTemplate && /^\s+branches:/.test(line)) { inBranches = true; continue; }
    if (inTemplate && inBranches) {
      let m = line.match(/^\s+main:\s*(.+)/);
      if (m) { out.main = strip(m[1]); continue; }
      m = line.match(/^\s+develop:\s*(.+)/);
      if (m) { out.develop = strip(m[1]); continue; }
      m = line.match(/^\s+mode:\s*(.+)/);
      if (m) { out.mode = strip(m[1].split("#")[0]); continue; }
      if (/^\s{0,4}[a-z_]+:/.test(line)) { inBranches = false; }
    }
    if (inTemplate && /^[a-z_]+:/.test(line)) { inTemplate = false; inBranches = false; }
  }
  return out.main && out.develop && out.mode ? out : null;
}

// Generate the whole version.yml - renders payload/version.yml.template.
// opts: { templateText, version, types:[], paths:Map, pathMarkers?:Map,
//         branch, branches?, versionCode, now, today, templateOptions?, deployValues?,
//         extraTopLevel?:string[],  <- preserves unknown top-level fields of the existing version.yml
//         language?:string,  <- message language (en|ko, default en)
//         typeOptions?:object }  <- input of the option block a type hook (versionOptionsBlock) renders only for its own type
//   templateText = raw text of payload/version.yml.template (readVersionYmlTemplate - required)
//   now   = "YYYY-MM-DD HH:MM:SS" (UTC) - injected for determinism / today = "YYYY-MM-DD"
//   branches = { main, develop, mode } (result of resolveBranchConfig. Without it, defaults based on branch)
//   pathMarkers = Map<type, markerFilename> (for project_paths comments)
//   templateOptions = { templateVersion, optionsDate }
export function buildVersionYml({
  templateText, version, types = [], paths = new Map(), pathMarkers = new Map(),
  branch = "main", branches = null, versionCode = 1, now, today,
  templateOptions = null, deployValues = new Map(), extraTopLevel = [], typeOptions = {}, language = DEFAULT_LANGUAGE,
}) {
  if (!templateText) throw new Error(tr("core.versionYml.error.templateRequired"));
  const typesJson = types.length ? `[${types.map((t) => `"${t}"`).join(", ")}]` : `["basic"]`;
  const b = branches || { main: branch || "main", develop: "develop", mode: "pr-flow" };
  const {
    templateVersion = "unknown",
    deployStyle = "", optionsDate = today,
  } = templateOptions || {};
  const optionValues = renderValues(templateOptions || {});

  // project_paths block (full-line token {{PROJECT_PATHS}} - line removed when absent)
  let pathsBlock = "";
  if (paths.size) {
    const rows = [`project_paths: # ${tr("core.versionYml.pathsComment")}`];
    for (const [t, p] of paths) {
      const marker = pathMarkers.get(t) || "";
      const pf = p === "." ? marker : (marker ? `${p}/${marker}` : p);
      rows.push(marker ? `  ${t}: "${p}" # ${pf}` : `  ${t}: "${p}"`);
    }
    pathsBlock = rows.join("\n");
  }

  // deploy block (full-line token {{DEPLOY}} - only types with WF ask values, one blank line before)
  let deployBlock = "";
  const deployTypes = [...deployValues.keys()].filter((t) => deployValues.get(t) && deployValues.get(t).size > 0);
  if (deployTypes.length) {
    const rows = ["", `deploy: # ${tr("core.versionYml.deployComment")}`];
    for (const t of deployTypes) {
      rows.push(`  ${t}:`);
      // Reuse the same escape - deploy values arrive by the same path as @wizard ask values, so
      // a stray double quote breaks the YAML just like in setEnvLine (the second site).
      for (const [k, v] of deployValues.get(t)) rows.push(`    ${k}: "${escapeYamlDoubleQuoted(v)}"`);
    }
    deployBlock = rows.join("\n");
  }

  // Type option block (full-line token {{TYPE_OPTIONS}} - only when a type emits a block, otherwise the line is removed)
  const typeOptionsBlock = hooksFor(types, "versionOptionsBlock").map(({ hook }) => hook(typeOptions)).join("\n");

  const scalars = {
    VERSION: version, VERSION_CODE: String(versionCode),
    PROJECT_TYPES: typesJson,
    LANGUAGE: isSupportedLanguage(language) ? language : DEFAULT_LANGUAGE,
    NOW: now, TODAY: today || optionsDate, DEFAULT_BRANCH: branch,
    TEMPLATE_VERSION: templateVersion,
    MAIN_BRANCH: b.main, DEVELOP_BRANCH: b.develop, BRANCH_MODE: b.mode,
    ...Object.fromEntries(OPTIONS.map((o) => [optionVar(o), String(optionValues[o.ctxField])])),
    OPT_DEPLOY_STYLE: String(deployStyle || ""),
  };

  const out = [];
  for (const line of String(templateText).split("\n")) {
    const t = line.trim();
    if (t === "{{PROJECT_PATHS}}") { if (pathsBlock) out.push(pathsBlock); continue; }
    if (t === "{{TYPE_OPTIONS}}") { if (typeOptionsBlock) out.push(typeOptionsBlock); continue; }
    if (t === "{{DEPLOY}}") { if (deployBlock) out.push(deployBlock); continue; }
    if (t.startsWith("deploy_style:") && deployStyle === null) continue; // types without a server deploy do not record it
    out.push(line.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_, name) => {
      if (name in scalars) return scalars[name];
      throw new Error(tr("core.versionYml.error.unknownPlaceholder", { name }));
    }));
  }
  let text = out.join("\n");
  if (extraTopLevel.length) {
    if (!text.endsWith("\n")) text += "\n";
    text += "\n" + extraTopLevel.join("\n\n");
  }
  if (!text.endsWith("\n")) text += "\n";
  return text.replace(/\n{3,}$/, "\n"); // trim excess trailing blank lines
}

// Whether only the install-time lines (metadata.last_updated etc.) differ - callers use it to skip the write so a
// re-run with no changes does not rewrite the file every time and dirty the working tree.
const TIMESTAMP_LINE = /^\s*(last_updated|integration_date|integrated_date|last_update_date):/;
export function sameIgnoringTimestamps(a, b) {
  const norm = (t) => String(t).replace(/\r\n/g, "\n").split("\n").filter((l) => !TIMESTAMP_LINE.test(l)).join("\n");
  return norm(a) === norm(b);
}

// Builds the final version.yml from a single context - the real install (full) and the preview (dry-run)
// use the same function, structurally preventing "the preview differs from the result".
// deployValues exist only in a real install (the preview performs no substitution, so it is an empty Map).
export function renderVersionYml(context, templateText, { pathMarkers, deployValues = new Map(), extraTopLevel = [] }) {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    now, today, templateVersion = "unknown", branches = null, language,
    deployStyle } = context;
  return buildVersionYml({
    templateText, version, types, paths, pathMarkers, branch, branches, versionCode, now, today,
    deployValues, extraTopLevel, language,
    typeOptions: mergeHookResults(types, "optionsFromContext", context),
    templateOptions: {
      templateVersion,
      ...renderValues(context),
      // null = a type with no server deploy workflow, so the deploy style is meaningless (record omitted)
      deployStyle: deployStyle === null ? null : (deployStyle || DEFAULT_DEPLOY_STYLE),
      optionsDate: today,
    },
  });
}
