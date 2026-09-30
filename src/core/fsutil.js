// Shared filesystem utilities (byte-for-byte copy, LF preserved). Text is copied as-is so original line endings survive.
import {
  cpSync, existsSync, readFileSync, writeFileSync, mkdirSync,
  readdirSync, rmSync, accessSync, constants,
} from "node:fs";
import { dirname, join } from "node:path";

export const exists = (p) => existsSync(p);
export const readText = (p) => readFileSync(p, "utf8");

export function writeText(p, s) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s);
}

// Copy a single file (creates parent directories, bytes unchanged)
export function copyFileSync(src, dst) {
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
}

// Recursively copy a directory (contents go under dst)
export function copyDirSync(src, dst) {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
}

// Delete a file/folder (harmless if missing)
export function remove(p) {
  rmSync(p, { recursive: true, force: true });
}

// Names of the .yaml/.yml files directly inside a directory (subfolders excluded).
// Sort order is fixed: grouped by extension first (.yaml before .yml), alphabetical within each group.
// (A plain .sort() mixes extensions, so the traversal order diverges from existing installs and
//  the key order of the version.yml deploy block changes with it. Grouping keeps re-runs byte-identical.)
export function listYamlFiles(dir) {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ya?ml)$/.test(e.name))
    .map((e) => e.name);
  const yaml = names.filter((n) => n.endsWith(".yaml")).sort();
  const yml = names.filter((n) => n.endsWith(".yml")).sort();
  return [...yaml, ...yml];
}

// Check permissions before writing - stopping midway on EACCES leaves a partial install, and the
// next run has no baseline, so every file already written would be classified as a conflict.
// dirs: folders to create files in (if missing, the nearest existing ancestor is checked), files: existing files to be overwritten.
// Returns the list of unwritable paths (relative to root).
export function findUnwritable(root, dirs = [], files = []) {
  const writable = (p) => { try { accessSync(p, constants.W_OK); return true; } catch { return false; } };
  const blocked = new Set();
  for (const rel of dirs) {
    let cur = rel;
    while (cur !== "." && !existsSync(join(root, cur))) cur = dirname(cur);
    if (!writable(join(root, cur))) blocked.add(cur);
  }
  for (const rel of files) {
    if (existsSync(join(root, rel)) && !writable(join(root, rel))) blocked.add(rel);
  }
  return [...blocked];
}
