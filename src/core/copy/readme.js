// Appends the README version section.
import { join } from "node:path";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { t, SUPPORTED_LANGUAGES } from "../../i18n/index.js";

export const MARKER = "<!-- AUTO-VERSION-SECTION";
// "## <latest version|latest-version|current/recent version|Version|version> : vX.Y.Z", where the Korean words are written as
// \u escapes so this file stays free of Hangul (case-insensitive)
const VERSION_LINE_RE = /##\s*(\uCD5C\uC2E0\s*\uBC84\uC804|\uCD5C\uC2E0\uBC84\uC804|(?:latest|current|recent)[\s-]*version|Version|\uBC84\uC804)\s*:\s*v[0-9]+\.[0-9]+\.[0-9]+/i;

// Descriptions for the run log: a bare status code forces later readers to look up its meaning.
// Getters keep the text lazy so it follows the language resolved at runtime.
export const README_STATUS_LABEL = {
  get added() { return t("copy.readme.status.added"); },
  get "skip-no-readme"() { return t("copy.readme.status.skipNoReadme"); },
  get "skip-marker"() { return t("copy.readme.status.skipMarker"); },
  get "skip-version-line"() { return t("copy.readme.status.skipVersionLine"); },
  get "heading-updated"() { return t("copy.readme.status.headingUpdated"); },
};

// Bundled default heading text ("Latest Version", ...) without the "## " prefix and version part, per language.
const defaultHeading = (lang) => t("copy.readme.versionHeading", { version: "0" }, lang).replace(/^##\s*/, "").replace(/\s*:\s*v0$/, "");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Finds a version line whose heading is exactly another language's bundled default, so a re-run under a
// different language can switch it. A heading the user edited never matches and is left alone.
// Returns the regex match (the "## <heading> : " prefix with its index) or null.
function findStaleHeading(content) {
  const current = defaultHeading();
  for (const lang of SUPPORTED_LANGUAGES) {
    const heading = defaultHeading(lang);
    if (heading === current) continue;
    const m = new RegExp("^## " + escapeRe(heading) + " : (?=v[0-9])", "m").exec(content);
    if (m) return m;
  }
  return null;
}

// Skip when README.md is missing, or when a marker or version line exists. Otherwise append to the end.
// Returns: 'skip-no-readme' | 'heading-updated' | 'skip-marker' | 'skip-version-line' | 'added'
// Only decides without writing, so the real append and the --dry-run preview share one decision.
export function planVersionSection(targetRoot = ".") {
  const p = join(targetRoot, "README.md");
  if (!existsSync(p)) return "skip-no-readme";
  const content = readFileSync(p, "utf8");
  if (findStaleHeading(content)) return "heading-updated";
  if (content.includes(MARKER)) return "skip-marker";
  if (VERSION_LINE_RE.test(content)) return "skip-version-line";
  return "added";
}

export function addVersionSectionToReadme(version, targetRoot = ".") {
  const status = planVersionSection(targetRoot);
  const p = join(targetRoot, "README.md");
  if (status === "heading-updated") {
    // Swap only the heading words; the version text after the colon stays as the workflow wrote it.
    const content = readFileSync(p, "utf8");
    const m = findStaleHeading(content);
    writeFileSync(p, content.slice(0, m.index) + "## " + defaultHeading() + " : " + content.slice(m.index + m[0].length));
    return status;
  }
  if (status !== "added") return status;
  const content = readFileSync(p, "utf8");

  // The appended body starts with "\n---\n..." to leave a blank line between the existing text and the rule.
  const section =
    "\n" +
    "---\n" +
    "\n" +
    "<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n" +
    t("copy.readme.versionHeading", { version }) + "\n" +
    "\n" +
    t("copy.readme.historyLink") + "\n";
  // Appending directly to a README without a trailing newline puts "---" right after the last line,
  // and Markdown turns that line into a heading (Setext h2), so terminate the line first.
  const lead = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  appendFileSync(p, lead + section);
  return "added";
}

// Prefix/suffix sequence that addVersionSectionToReadme always appends at the very end of the file.
// If the prefix (SECTION_PREFIX) is present it is a "block" appended by the wizard. The block always ends
// with the SECTION_TAIL line, so cut only up to that point; cutting "to the end of the file" would delete
// content the user appended later (a license section etc.).
const SECTION_PREFIX = "\n---\n\n" + MARKER;
// The tail text depends on the language it was installed in, so a section written in one language must
// still be removable under another: candidates from every supported language are matched.
const sectionTails = () => [...new Set(SUPPORTED_LANGUAGES.map((l) => t("copy.readme.historyLink", {}, l) + "\n"))];
// For a README that already had the user's own version line at install time (addVersionSectionToReadme
// skipped it as 'skip-version-line'), PROJECT-COMMON-README-VERSION-UPDATE.yaml (the installed CI) inserts
// only a marker comment line above that version line, without the '---' separator. The version line itself
// is user-owned, so only the marker comment line is removed in that case.
const MARKER_LINE = "<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n";

// Checks whether the wizard (or the installed CI) left traces in README.md (to decide on showing the checklist).
export function hasVersionSection(targetRoot = ".") {
  const p = join(targetRoot, "README.md");
  if (!existsSync(p)) return false;
  const content = readFileSync(p, "utf8");
  return content.includes(SECTION_PREFIX) || content.includes(MARKER_LINE);
}

// Returns: 'removed' | 'skip-no-readme' | 'skip-no-marker' | 'skip-unexpected-format'
export function removeVersionSectionFromReadme(targetRoot = ".") {
  const p = join(targetRoot, "README.md");
  if (!existsSync(p)) return "skip-no-readme";
  const content = readFileSync(p, "utf8");

  const idx = content.indexOf(SECTION_PREFIX);
  if (idx !== -1) {
    // Whole block appended by the wizard: cut only up to the SECTION_TAIL line and keep everything after it.
    // If the tail is missing (the user deleted that line), or is found too far away for a wizard block
    // (the user copied the same text elsewhere in the document), user content in between could be deleted,
    // and we cannot be sure where the "wizard section" ends, so give up safely.
    // The wizard block stays within a few hundred bytes even with a long version string.
    const MAX_SECTION_LENGTH = 300;
    let tailIdx = -1;
    let tailLen = 0;
    for (const tail of sectionTails()) {
      const i = content.indexOf(tail, idx);
      if (i !== -1 && (tailIdx === -1 || i < tailIdx)) { tailIdx = i; tailLen = tail.length; }
    }
    if (tailIdx === -1 || tailIdx > idx + MAX_SECTION_LENGTH) return "skip-unexpected-format";
    const cutEnd = tailIdx + tailLen;
    writeFileSync(p, content.slice(0, idx) + content.slice(cutEnd));
    return "removed";
  }

  const markerIdx = content.indexOf(MARKER_LINE);
  if (markerIdx !== -1) {
    // The CI inserted only the marker above the user's existing version line; leave the version line alone.
    writeFileSync(p, content.slice(0, markerIdx) + content.slice(markerIdx + MARKER_LINE.length));
    return "removed";
  }

  return "skip-no-marker";
}
