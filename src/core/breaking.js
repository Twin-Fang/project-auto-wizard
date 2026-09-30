import { getLanguage } from "../i18n/index.js";

// Version comparison: strips the v prefix, compares 3 numeric parts, missing part = 0
export function compareVersions(a, b) {
  const parse = (v) => String(v).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// Text of an entry in the given language: `title_ko` / `message_ko` when present, otherwise the plain (English) field.
export function localizedField(entry, field, lang = getLanguage()) {
  return entry?.[`${field}_${lang}`] || entry?.[field] || "";
}

// Collect entries from breaking-changes.json with current < ver <= target.
// target is the actual templateVersion, not a fixed value - so every notice up to the version being installed is caught.
// Keys starting with _ (metadata) are skipped. severity critical / anything else (warning).
// A version key's value is an entry object or an array of entry objects (several notices in one release).
// types: installed project types. When an entry has types it is shown only if one overlaps - a
// Flutter-only warning on a spring repo would bury the notices that really matter. Unknown types (empty array) shows everything.
export function collectBreaking(json, current, target, types = []) {
  const critical = [], warnings = [];
  const relevant = (entry) => !Array.isArray(entry?.types) || !types.length || entry.types.some((t) => types.includes(t));
  for (const [ver, value] of Object.entries(json || {})) {
    if (ver.startsWith("_")) continue;
    if (compareVersions(current, ver) < 0 && compareVersions(ver, target) <= 0) {
      // Several notices in one release are registered as an array - JSON keys (versions) are unique, so an object holds only one.
      for (const entry of Array.isArray(value) ? value : [value]) {
        if (!relevant(entry)) continue;
        const rec = { version: ver, ...entry };
        (entry?.severity === "critical" ? critical : warnings).push(rec);
      }
    }
  }
  return { critical, warnings };
}
