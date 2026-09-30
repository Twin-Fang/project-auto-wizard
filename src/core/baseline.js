// Install-time baseline - the reference point that tells an update "who changed this".
//
// Why it is needed: isUnchanged() compares the payload (theirs) and the installed copy (ours) 2-way.
// Without a base, upstream changing a single character drops a file the user never touched into
// "changed", so the only choices are "skip everything (no updates)" or "back up everything
// (all user edits lost)".
//
// Only hashes are kept, not file copies - the goal is classification, not automatic merging.
//
// Why two hashes: for files with user values substituted from env, the disk content and the
// "payload rendered with defaults" differ from the start, so one hash cannot answer both questions.
//   - installed : what we wrote to disk at install time        -> "did the user touch it since"
//   - rendered  : the payload rendered with defaults at that time -> "did upstream change it since"
//
// installed is filled only for files we actually wrote. Recording a user-edited file as installed
// would claim "we wrote this", and the next update would silently overwrite it.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { writeText } from "./fsutil.js";

export const BASELINE_DIR = ".github/.wizard";
export const BASELINE_PATH = ".github/.wizard/baseline.json";

export function sha256(text) {
  return "sha256:" + createHash("sha256").update(String(text), "utf8").digest("hex");
}

// Hash of Flutter app files (Fastfile, ExportOptions.plist) - normalized to LF first so a file that
// differs only by checkout line endings (autocrlf) is not treated as "modified by the user".
export function appFileHash(text) {
  return sha256(String(text).replace(/\r\n/g, "\n"));
}

// null when missing or corrupt - callers fall back to "base unknown" (we never silently use an empty
// baseline, which could be misread as "everything was deleted" rather than "no record").
export function readBaseline(targetRoot = ".") {
  const p = join(targetRoot, BASELINE_PATH);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf8"));
    if (!data || typeof data !== "object" || typeof data.files !== "object" || data.files === null) return null;
    return data;
  } catch {
    return null; // A corrupt baseline is treated as missing - it must not block the update
  }
}

// entries: Map<filename, {installed?:string|null, rendered?:string|null}>
// appFiles: Map<repo-relative path, appFileHash> - Flutter app files newly created this run. It is what lets a
//   full removal delete only "files the wizard created and the user did not touch". files is keyed by workflow filename, so they are not mixed.
// The existing baseline is merged in - files not touched this run keep their reference point.
export function writeBaseline(targetRoot, { templateVersion, installedAt, entries, previous = null, appFiles = new Map() }) {
  const files = { ...(previous?.files || {}) };
  for (const [filename, entry] of entries) {
    const prev = files[filename] || {};
    files[filename] = {
      // installed is updated only when actually written this run. Files kept (skipped) retain the old reference point.
      installed: entry.installed ?? prev.installed ?? null,
      // Without rendered (a file that did not take the upstream change due to a conflict) the old reference point is kept.
      rendered: entry.rendered ?? prev.rendered ?? null,
    };
  }
  const apps = { ...(previous?.appFiles || {}), ...Object.fromEntries(appFiles) };
  // A re-run that changes no reference point keeps the install time too - a file that changes on every run is not idempotent.
  const unchanged = previous && previous.templateVersion === (templateVersion || "unknown")
    && JSON.stringify(previous.files) === JSON.stringify(files)
    && JSON.stringify(previous.appFiles || {}) === JSON.stringify(apps);
  const out = {
    templateVersion: templateVersion || "unknown",
    installedAt: unchanged ? (previous.installedAt || "") : (installedAt || ""),
    files,
    ...(Object.keys(apps).length ? { appFiles: apps } : {}),
  };
  writeText(join(targetRoot, BASELINE_PATH), JSON.stringify(out, null, 2) + "\n");
  return out;
}

// In the baseline but missing on disk = deleted by the user.
// A side benefit of this design is that no separate deletion-history file is needed.
// candidates: filenames the payload intends to install this run (other baseline entries are ignored)
export function detectRemoved(baseline, candidates, workflowsDir) {
  if (!baseline) return [];
  const removed = [];
  for (const filename of candidates) {
    if (!baseline.files[filename]) continue;      // A file we never installed - no basis for a judgement
    if (existsSync(join(workflowsDir, filename))) continue;
    removed.push(filename);
  }
  return removed;
}
