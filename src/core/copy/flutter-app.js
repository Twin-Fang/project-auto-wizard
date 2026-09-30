// Installs Flutter app-owned files (fastlane, ExportOptions.plist).
// Unlike workflows these are files the user fills in, so they are created only when missing: never
// overwritten and no baseline 3-way applied (existing user files are not overwritten by convention).
// Propagating upstream changes to existing users is out of scope.
import { join, posix } from "node:path";
import { existsSync } from "node:fs";
import { copyFileSync } from "../fsutil.js";
import { storeAppFilesFor } from "../flutter-options.js";

const FLUTTER_APP_DIR = "flutter-app"; // payload/flutter-app/

// List of (reported relative path, source, destination) for the files handled in this run.
// Only when the Flutter type is present, limited to the selected platforms (context.flutterStore, null = both).
function flutterAppTargets(context, payloadRoot, targetRoot) {
  const { types = [], paths = new Map(), flutterStore = null } = context;
  if (!types.includes("flutter")) return [];
  const flutterRoot = paths.get("flutter") || ".";
  return storeAppFilesFor(flutterStore).map((rel) => ({
    reported: posix.join(flutterRoot, rel),
    src: join(payloadRoot, FLUTTER_APP_DIR, rel),
    dst: join(targetRoot, flutterRoot, rel),
  }));
}

// Read-only, used by status/dry-run. Does not read the source payload.
export function planFlutterAppFiles(context, payloadRoot, targetRoot = ".") {
  const result = { created: [], kept: [] };
  for (const { reported, dst } of flutterAppTargets(context, payloadRoot, targetRoot)) {
    (existsSync(dst) ? result.kept : result.created).push(reported);
  }
  return result;
}

export function copyFlutterAppFiles(context, payloadRoot, targetRoot = ".") {
  const result = { created: [], kept: [] };
  for (const { reported, src, dst } of flutterAppTargets(context, payloadRoot, targetRoot)) {
    if (existsSync(dst)) { result.kept.push(reported); continue; }
    copyFileSync(src, dst); // creates parent directories and copies bytes as-is (preserves CRLF)
    result.created.push(reported);
  }
  return result;
}
