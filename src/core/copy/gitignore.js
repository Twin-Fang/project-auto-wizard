// .gitignore guarantee: covers only the conflict backup by-products the wizard itself creates
// (*.bak, *.template.yaml). Personal dev-environment settings (IDE etc.) unrelated to what the wizard
// installs are outside its responsibility.
// The banner block is clearly delimited by the end marker (BANNER_END), so even if the user inserts other
// lines inside it, only the REQUIRED_ENTRIES are removed individually and everything else is preserved.
// Note (intended trade-off): in repos installed before this change, where the banner has no end marker,
// we fall back to the old approach of removing only while REQUIRED_ENTRIES follow the banner consecutively.
// An earlier decision states that .gitignore of already installed repos is not retroactively processed and is
// left to the user, so no separate migration logic is added.
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { t, SUPPORTED_LANGUAGES } from "../../i18n/index.js";

// Personal dev-environment entries (/.idea etc.) are outside the wizard's responsibility, so they are excluded.
// Only the by-products the wizard's own conflict handling (workflows.js backup/template decisions)
// actually creates are gitignore targets.
const REQUIRED_ENTRIES = ["*.bak", "*.template.yaml"];

// Normalizes an entry: strip comment, trim, strip leading /, leading ./ and trailing /. Returns the original if empty.
export function normalizeGitignoreEntry(entry) {
  let e = String(entry);
  e = e.replace(/#.*$/, "");        // strip comment
  e = e.trim();                      // surrounding whitespace
  e = e.replace(/^\//, "");         // leading /
  e = e.replace(/^\.\//, "");       // leading ./
  e = e.replace(/\/$/, "");         // trailing /
  return e === "" ? String(entry) : e;
}

function entryExists(target, content) {
  const nt = normalizeGitignoreEntry(target);
  for (const line of content.split("\n")) {
    if (/^\s*#/.test(line)) continue;
    if (/^\s*$/.test(line)) continue;
    if (normalizeGitignoreEntry(line) === nt) return true;
  }
  return false;
}

const newFileContent = (lang) =>
  t("copy.gitignore.newFileHeader", {}, lang) + "\n" +
  "*.bak\n" +
  "*.template.yaml\n";
// The header comment depends on the language it was written in, so a file created in one language must
// still be recognized under another: check every supported language's variant.
const NEW_FILE_CONTENT = (lang) => newFileContent(lang);
const matchingNewFileContent = (content) =>
  [NEW_FILE_CONTENT(), ...SUPPORTED_LANGUAGES.map(newFileContent)].find((c) => content.startsWith(c)) ?? null;

// Only decides without writing, so the real update and the --dry-run preview share one decision.
// Returns: {created, added:[...]}
export function planGitignore(targetRoot = ".") {
  const p = join(targetRoot, ".gitignore");
  if (!existsSync(p)) return { created: true, added: REQUIRED_ENTRIES.slice() };
  const content = readFileSync(p, "utf8");
  return { created: false, added: REQUIRED_ENTRIES.filter((e) => !entryExists(e, content)) };
}

// Returns: {created, added:[...]}
export function ensureGitignore(targetRoot = ".", lang) {
  const p = join(targetRoot, ".gitignore");
  const plan = planGitignore(targetRoot);
  if (plan.created) {
    writeFileSync(p, NEW_FILE_CONTENT(lang));
    return plan;
  }
  const toAdd = plan.added;
  if (toAdd.length === 0) return plan;
  let content = readFileSync(p, "utf8");

  // BANNER starts with "\n". If the file lacks a trailing newline that "\n" terminates the last line;
  // otherwise it becomes one blank line. Either way, cutting up to BANNER on removal restores the original text.
  // (Adding a newline separately would leave a trailing newline that was not there originally.)
  content += BANNER;
  for (const e of toAdd) content += e + "\n";
  content += BANNER_END;
  writeFileSync(p, content);
  return { created: false, added: toAdd };
}

// When ensureGitignore adds a banner block to an existing file it always starts with this exact sequence
// ("\n" + 3-line banner) and ends with BANNER_END after REQUIRED_ENTRIES. Only lines matching
// REQUIRED_ENTRIES inside the banner..BANNER_END range are removed individually; lines the user added
// between or after them are never touched.
// The banner text is English in every language, so detection needs no language handling.
const BANNER =
  "\n" +
  "# ====================================================================\n" +
  "# project-auto-wizard: Auto-added entries\n" +
  "# ====================================================================\n";

// End marker after REQUIRED_ENTRIES: it clearly delimits the "end" of the banner block so that
// removeAutoAddedEntriesFromGitignore can remove entries individually within the exact range even if the user
// inserted other lines between them. Used only when ensureGitignore adds a banner to an existing file
// (the new-file case writes NEW_FILE_CONTENT as a whole and no end marker; it is matched
// by the full startsWith prefix, so no separate marker is needed).
const BANNER_END = "# ==== project-auto-wizard: end of auto-added entries ====\n";

// Checks whether the wizard added entries to .gitignore (to decide on showing the checklist).
// Two cases: (1) a file that did not exist was created as a whole (or with user content appended after it)
// (2) a banner block was attached to an existing file.
export function hasAutoAddedEntries(targetRoot = ".") {
  const p = join(targetRoot, ".gitignore");
  if (!existsSync(p)) return false;
  const content = readFileSync(p, "utf8");
  return matchingNewFileContent(content) !== null || content.includes(BANNER);
}

// Returns: 'removed' | 'file-deleted' | 'skip-no-gitignore' | 'skip-not-found'
export function removeAutoAddedEntriesFromGitignore(targetRoot = ".") {
  const p = join(targetRoot, ".gitignore");
  if (!existsSync(p)) return "skip-no-gitignore";
  const content = readFileSync(p, "utf8");

  // The file did not exist and the wizard created it as a whole: keep only what the user appended after it.
  const created = matchingNewFileContent(content);
  if (created !== null) {
    const remainder = content.slice(created.length);
    if (remainder === "") {
      rmSync(p);
      return "file-deleted";
    }
    writeFileSync(p, remainder);
    return "removed";
  }

  // A banner block was attached to an existing file.
  const idx = content.indexOf(BANNER);
  if (idx === -1) return "skip-not-found";
  const afterBanner = idx + BANNER.length;

  // If the end marker exists (installed after this change), remove only REQUIRED_ENTRIES individually
  // within that range and keep any lines the user inserted between them, regardless of order or adjacency.
  const endIdx = content.indexOf(BANNER_END, afterBanner);
  if (endIdx !== -1) {
    const region = content.slice(afterBanner, endIdx).split("\n");
    const kept = region.filter((line) =>
      !REQUIRED_ENTRIES.some((e) => normalizeGitignoreEntry(line) === normalizeGitignoreEntry(e)));
    const afterEndMarker = content.slice(endIdx + BANNER_END.length);
    writeFileSync(p, content.slice(0, idx) + kept.join("\n") + afterEndMarker);
    return "removed";
  }

  // Old install without an end marker (before this change): fall back to the old approach of removing only
  // while REQUIRED_ENTRIES follow the banner consecutively (same no-retroactive-processing principle).
  const lines = content.slice(afterBanner).split("\n");
  let consumed = 0;
  for (const line of lines) {
    const isKnownEntry = REQUIRED_ENTRIES.some((e) => normalizeGitignoreEntry(line) === normalizeGitignoreEntry(e));
    if (!isKnownEntry) break;
    consumed += line.length + 1; // +1: the "\n" swallowed by split
  }
  writeFileSync(p, content.slice(0, idx) + content.slice(afterBanner + consumed));
  return "removed";
}
