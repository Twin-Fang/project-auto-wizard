// Post-install verification - re-reads the installed workflows to check "will this run as-is".
//
// Why after install rather than before: substitution happens scattered per file and auto tokens
// depend on resolver results. Looking at the final disk content is the only way to see the same
// thing that will actually be deployed.
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { t } from "../i18n/index.js";

// Tokens that are not substitution targets - heredoc delimiters inside workflow scripts. They are
// syntax, not values, so they are excluded from the unsubstituted check. (e.g. cat <<'__WIZARD_FILE_CONTENT_EOF__')
const SENTINEL_RE = /^__WIZARD_[A-Z0-9_]*__$/;
const PLACEHOLDER_RE = /__[A-Z][A-Z0-9_]*__/g;

// Lines dead as comments - they never run, so they are not checked.
// The template contains whole optional example steps commented out; counting them
// would tell the user to "register" secrets that are never used.
const isCommented = (line) => /^\s*#/.test(line);

// Scan for unsubstituted placeholders.
// Previously, even when an auto token computation failed (e.g. application.yaml not found, so the path was an empty string),
// the line was left untouched, and a workflow still containing __APPLICATION_YML_DIR__ ended as an
// "install success". The problem only surfaced at deploy time, when a directory with that name got created.
//
// Returns: [{ filename, line, token, text }] - with the line number so a person can fix it right away.
export function scanUnsubstituted(workflowsDir, filenames = []) {
  const found = [];
  for (const filename of filenames) {
    const p = join(workflowsDir, filename);
    if (!existsSync(p)) continue;
    let content;
    try { content = readFileSync(p, "utf8"); } catch { continue; }
    content.split(/\r?\n/).forEach((text, i) => {
      if (isCommented(text)) return;
      for (const token of text.match(PLACEHOLDER_RE) || []) {
        if (SENTINEL_RE.test(token)) continue;
        found.push({ filename, line: i + 1, token, text: text.trim() });
      }
    });
  }
  return found;
}

// GITHUB_TOKEN is injected by Actions automatically, so it is not something the user registers.
const AUTO_SECRETS = new Set(["GITHUB_TOKEN"]);
// Secrets the workflow runs without - the fallback is documented. Mixing them with required ones under
// "must be registered to work" would make the guidance itself untrustworthy, so they are kept apart.
//   AI_API_KEY   -> if absent: Copilot (opt-in, copilot_ai) -> rule-based fallback
//   WORKFLOW_PAT -> if absent: GITHUB_TOKEN
export const OPTIONAL_SECRETS = new Set(["AI_API_KEY", "WORKFLOW_PAT"]);
const SECRET_RE = /secrets\.([A-Z][A-Z0-9_]*)/g;

// The "NAME (optional)" note in a workflow header comment - a secret the workflow is written to work without.
// The payload comments are Korean ("(\uC120\uD0DD)" = "(optional)"); the English form is accepted too.
const OPTIONAL_NOTE_RE = /^\s*#\s*-?\s*([A-Z][A-Z0-9_]*)\s*\((?:\uC120\uD0DD|optional)/i;
// `secrets.A || secrets.B` - only one of the two is needed.
const EITHER_RE = /^\s*\|\|\s*secrets\.([A-Z][A-Z0-9_]*)/;
// `secrets.A || '3000'`, `secrets.A || vars.A` - there is a default/alternative value.
const FALLBACK_AFTER_RE = /^\s*\|\|/;
const FALLBACK_BEFORE_RE = /\|\|\s*$/;
// Separator of a "A or B" secret pair. It is shown to the user and also used to split keys, so it follows
// the current language; evaluated lazily (via toString) because it must not be fixed at import time.
export const EITHER_SEP = { toString: () => t("core.verify.eitherSep") };

// Sorts the secret references in one file into required / either-of-two / optional.
function classifyFile(content) {
  const lines = content.split(/\r?\n/);
  const noted = new Set();
  for (const line of lines) {
    const m = line.match(OPTIONAL_NOTE_RE);
    if (m) noted.add(m[1]);
  }
  const singles = new Set();
  const pairs = [];
  const optional = new Set();
  for (const line of lines) {
    if (isCommented(line)) continue;
    const matches = [...line.matchAll(SECRET_RE)];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const name = m[1];
      const rest = line.slice(m.index + m[0].length);
      const either = rest.match(EITHER_RE);
      if (either) {
        pairs.push([name, either[1]]);
        i++; // the right side of the pair is already bound
      } else if (FALLBACK_AFTER_RE.test(rest) || FALLBACK_BEFORE_RE.test(line.slice(0, m.index))) {
        optional.add(name);
      } else {
        singles.add(name);
      }
    }
  }
  const out = { required: [], optional: [] };
  for (const name of singles) (noted.has(name) ? out.optional : out.required).push(name);
  for (const name of optional) out.optional.push(name);
  for (const [a, b] of pairs) {
    const key = `${a}${EITHER_SEP}${b}`;
    (noted.has(a) || noted.has(b) ? out.optional : out.required).push(key);
  }
  return out;
}

// Splits the secrets of the installed workflows into required and optional.
// Counting every referenced name as required would mix ones with defaults and either-of-two fallback pairs into
// "must be registered to work", inflating the count and making first-time users register secrets they do not need.
// Returns: { required: Map<name|"A or B", filenames[]>, optional: Map<same format> }
export function classifySecrets(workflowsDir, filenames = []) {
  const required = new Map();
  const optional = new Map();
  const add = (map, key, filename) => {
    if (!map.has(key)) map.set(key, []);
    if (!map.get(key).includes(filename)) map.get(key).push(filename);
  };
  const skip = (key) => key.split(EITHER_SEP).some((n) => AUTO_SECRETS.has(n) || OPTIONAL_SECRETS.has(n));
  for (const filename of filenames) {
    const p = join(workflowsDir, filename);
    if (!existsSync(p)) continue;
    let content;
    try { content = readFileSync(p, "utf8"); } catch { continue; }
    const r = classifyFile(content);
    for (const k of r.required) if (!skip(k)) add(required, k, filename);
    for (const k of r.optional) if (!skip(k)) add(optional, k, filename);
  }
  // A name that is required on its own in even one file is required - fallback pairs/optional entries containing it are already satisfied, so drop them.
  const requiredNames = new Set([...required.keys()].filter((k) => !k.includes(EITHER_SEP)));
  const coveredByRequired = (k) => k.split(EITHER_SEP).some((n) => requiredNames.has(n));
  for (const k of [...required.keys()]) if (k.includes(EITHER_SEP) && coveredByRequired(k)) required.delete(k);
  for (const k of [...optional.keys()]) if (required.has(k) || coveredByRequired(k)) optional.delete(k);
  const sorted = (m) => new Map([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return { required: sorted(required), optional: sorted(optional) };
}

// List of GitHub Secrets the installed workflows require.
// The completion screen only mentioned WORKFLOW_PAT and permissions, so values the deploy workflow really needs
// (SERVER_HOST, SSH_KEY, ...) were never announced. Right after install the deploy does not run,
// and that fact was shown nowhere.
//
// Returns: Map<secretName or "A or B", string[] filenames that use the secret>
export function collectRequiredSecrets(workflowsDir, filenames = []) {
  return classifySecrets(workflowsDir, filenames).required;
}

// Secrets the workflow runs without (having a default/alternative value, or marked optional in the header comment).
export function collectOptionalSecrets(workflowsDir, filenames = []) {
  return classifySecrets(workflowsDir, filenames).optional;
}

// Secrets where only one of two is needed depending on the SSH auth method - narrows the list using the answer the user already gave.
// Telling the user to "register" secrets that will not be used makes the guidance itself untrusted.
export function narrowSecretsBySshAuth(secrets, sshAuthMethod) {
  if (!sshAuthMethod) return secrets;
  const drop = sshAuthMethod === "key" ? "SERVER_PASSWORD" : "SSH_KEY";
  const out = new Map(secrets);
  out.delete(drop);
  return out;
}
