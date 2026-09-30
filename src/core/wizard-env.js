// @wizard env token engine - substitution of the workflow's ask/auto/fallback markers and the unchanged verdict.
// WARNING: no YAML parsing/re-serialization - line-based string handling (preserving format and comments is the premise of the unchanged verdict).

// KEY regex: besides env keys (uppercase) it accepts lowercase keys such as `default:` in a workflow_dispatch input.
// Only lines carrying a marker are targeted, so widening it does not affect other lines.
// fallback is a marker that replaces the default literal inside a `KEY: ${{ runtimeValue || 'literal' }}` expression.
const MARKER_RE = /#\s*@wizard\s+(ask|auto|fallback):(.*)$/;
const KEY_RE = /^(\s*)([A-Za-z_]+):/;
const PATHS_ANCHOR_RE = /#\s*@wizard\s+paths-anchor/;

// Parse one line into {indent,key,action,arg}. null when there is no ask/auto/fallback marker.
export function parseWizardLine(line) {
  const marker = line.match(MARKER_RE);
  if (!marker) return null;
  const km = line.match(KEY_RE);
  if (!km) return null; // not in KEY: form (e.g. a paths-anchor comment) - ignore
  return { indent: km[1], key: km[2], action: marker[1], arg: marker[2].trim() };
}

// Escape for safely placing a value inside a YAML double-quoted string (backslash first - otherwise the
// double-quote escape added afterwards would be broken). Reused by both the @wizard substitution (setEnvLine)
// and the version.yml deploy block (buildVersionYml, src/core/version-yml.js) - the same bug
// occurs at both points.
export function escapeYamlDoubleQuoted(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Substitute the value inside the quotes of `KEY: "..."` + strip the trailing `# @wizard ...` comment on that line.
// Works on a single line. An empty value skips substitution (the template default stays).
export function setEnvLine(line, key, value) {
  if (value === "" || value == null) return line;
  // CRLF safe: split off the trailing \r, process, then restore (for autocrlf projects)
  const cr = line.endsWith("\r") ? "\r" : "";
  const body = cr ? line.slice(0, -1) : line;
  // Value substitution: KEY: "old" -> KEY: "value"
  // Single quotes (KEY: 'old') are accepted too - the template mixes both notations, and looking only at
  // double quotes would silently ignore the @wizard marker on single-quoted lines (the same failure shape).
  // The result is unified to double quotes and the value is escaped accordingly.
  const escaped = escapeYamlDoubleQuoted(value);
  let out = body.replace(
    new RegExp(`^(\\s*${key}:\\s*)(["'])(?:(?!\\2).)*\\2`),
    (_m, head) => `${head}"${escaped}"`,
  );
  // Strip the trailing # @wizard ... comment on that line (with the preceding whitespace)
  out = out.replace(/(\S)[^\S\r\n]*#[^\S\r\n]*@wizard[^\S\r\n].*$/, "$1");
  return out + cr;
}

// `KEY: ${{ a || b || 'literal' }}  # @wizard fallback:<token>` - replaces only the "last single-quoted literal" inside the expression
// and strips the marker comment. setEnvLine handles only quoted values of the `KEY: "value"` form, so it cannot process GitHub expressions.
// The literal sits at the very end of the `||` chain (the default when runtime input and repo variables are all empty), so runtime precedence does not change.
// An empty value leaves the line as is (same convention as setEnvLine - the template default stays).
const WIZARD_COMMENT_RE = /[^\S\r\n]*#[^\S\r\n]*@wizard[^\S\r\n].*$/;
const LAST_LITERAL_RE = /^(.*)'[^']*'([^']*)$/;
export function setFallbackLine(line, value) {
  if (value === "" || value == null) return line;
  const cr = line.endsWith("\r") ? "\r" : "";
  const expression = (cr ? line.slice(0, -1) : line).replace(WIZARD_COMMENT_RE, "");
  if (!LAST_LITERAL_RE.test(expression)) return line;
  const escaped = String(value).replaceAll("'", "''"); // quote escape for a GitHub expression string literal
  return expression.replace(LAST_LITERAL_RE, (_m, head, tail) => `${head}'${escaped}'${tail}`) + cr;
}

// resolver - value computation is delegated to the injected resolvers (keeps purity).
// resolvers: { repo, "spring-app-yml-dir"(type), "spring-app-yml-path"(type), "flutter-root",
//              "project-path"(type), "flutter-env-mode", "android-deploy-mode", "ios-deploy-mode" }
export function resolveToken(name, type, resolvers = {}) {
  const fn = resolvers[name];
  return typeof fn === "function" ? (fn(type) ?? "") : "";
}

// Replace the global tokens __PROJECT_NAME__/__APP_ARTIFACT_NAME__ with repoName.
// Reused by both substituteEnv() (installed file body) and collectAsks() (defaults shown on the wizard screen) -
// if the two diverge into different logic, display mismatches come back.
export function replaceProjectTokens(text, repoName) {
  if (!text.includes("__PROJECT_NAME__") && !text.includes("__APP_ARTIFACT_NAME__")) return text;
  return text.replaceAll("__PROJECT_NAME__", repoName).replaceAll("__APP_ARTIFACT_NAME__", repoName);
}

// Whole-file substitution.
// content: original workflow text. Returns: the substituted text.
// opts:
//   type          - project type (for resolvers/value lookup)
//   values        - Map<key,value>: the user's choices for ask keys (if absent, default = arg or resolver)
//   useDefaults   - when true, ask also uses defaults (the premise of the unchanged comparison)
//   resolvers     - for resolveToken
//   repoName      - substitution value for __PROJECT_NAME__/__APP_ARTIFACT_NAME__
//   projectPath   - for paths-anchor substitution (anchor unchanged when '.')
//   savedValues   - Map<key,value>: values of this type saved in the version.yml deploy block. Take precedence over ask defaults
//                   (so re-runs/auto-refresh do not revert answers given at install time to the template defaults).
export function substituteEnv(content, opts = {}) {
  const {
    type = "", values = new Map(), useDefaults = true, resolvers = {}, repoName = "", projectPath = ".",
    collectAsks = null, savedValues = null,
  } = opts;
  if (!content.includes("@wizard")) return content;

  // CRLF safe: split EOLs, parse/substitute on LF basis, then restore the original EOL style.
  // (JS regex `.` does not match \r, so `(.*)$` marker parsing would fail on CRLF.)
  const usesCRLF = content.includes("\r\n");
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const p = parseWizardLine(lines[i]); // line with \r already stripped
    if (!p) continue;
    // fallback changes a literal inside an expression, not a quoted value, so its path differs from ask/auto.
    if (p.action === "fallback") {
      lines[i] = setFallbackLine(lines[i], resolveToken(p.arg, type, resolvers));
      continue;
    }
    let val = "";
    if (p.action === "auto") {
      val = resolveToken(p.arg, type, resolvers);
    } else { // ask
      let def = p.arg.startsWith("@") ? resolveToken(p.arg.slice(1), type, resolvers) : p.arg;
      const saved = savedValues?.get(p.key);
      if (saved != null && saved !== "") def = saved;
      const chosen = values.get(p.key);
      if (chosen != null && chosen !== "" && !useDefaults) val = chosen;
      else val = def;
      // Collect only ask keys (auto is recomputed every time, so it is not saved). For the deploy block.
      if (collectAsks) collectAsks.set(p.key, replaceProjectTokens(val, repoName));
    }
    lines[i] = setEnvLine(lines[i], p.key, val);
  }
  let out = lines.join(usesCRLF ? "\r\n" : "\n");

  // Remaining global tokens
  out = replaceProjectTokens(out, repoName);

  // paths-anchor: unless the path is '.', replace the whole comment line with a paths line
  if (PATHS_ANCHOR_RE.test(out) && projectPath && projectPath !== ".") {
    const eol = out.includes("\r\n") ? "\r\n" : "\n";
    out = out.split(/\r?\n/).map((line) => {
      if (PATHS_ANCHOR_RE.test(line)) {
        const indent = (line.match(/^(\s*)/) || ["", ""])[1];
        return `${indent}paths: ['${projectPath}/**']`;
      }
      return line;
    }).join(eol);
  }
  return out;
}

// unchanged verdict: byte-compare the "final form virtually substituted with defaults" of the original against the installed copy.
export function isUnchanged(templateContent, installedContent, opts = {}) {
  const virtual = substituteEnv(templateContent, { ...opts, useDefaults: true });
  return virtual === installedContent;
}
