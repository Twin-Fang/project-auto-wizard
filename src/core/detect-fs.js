// Project detection on the real filesystem.
// Drives the pure functions of detect.js with fs/git.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { detectTypesFromMarkers, detectVersionFromFiles, detectBuildNumberFromFiles, detectJdkFromFiles, resolveMarkers } from "./detect.js";
import { parseExisting } from "./version-yml.js";
import { isValidBranchName } from "./branches.js";
import { t as tr } from "../i18n/index.js";

const hasFile = (root) => (rel) => existsSync(join(root, rel));
const readFile = (root) => (rel) => {
  try { return readFileSync(join(root, rel), "utf8"); } catch { return null; }
};

function gitOut(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return ""; }
}

// Type detection: project_types in version.yml wins (source of truth), otherwise a marker scan.
// paths: Map<type,path> from --paths. A monorepo has no markers at the root, so the types the user listed are used.
// warn: when no root marker exists and detection falls back to basic, reports projects found in subfolders.
export function detectTypes(root, { paths = new Map(), warn } = {}) {
  const vy = join(root, "version.yml");
  if (existsSync(vy)) {
    const { types } = parseExisting(readFileSync(vy, "utf8"));
    if (types.length) return types; // includes basic; used as-is when explicit
  }
  const fromRoot = detectTypesFromMarkers({ has: hasFile(root), read: readFile(root) });
  if (paths.size) {
    // The --paths order decides the primary type. Matches the marker-scan rule that drops the root
    // package.json's node when another type exists.
    const merged = [...new Set([...paths.keys(), ...fromRoot])].filter((t) => t !== "basic");
    const types = merged.length > 1 ? merged.filter((t) => t !== "node" || paths.has("node")) : merged;
    return types.length ? types : ["basic"];
  }
  if (fromRoot.length === 1 && fromRoot[0] === "basic" && warn) {
    const found = findSubdirProjects(root);
    if (found.length) {
      const firstDir = new Map();
      for (const { dir, types } of found) for (const t of types) if (!firstDir.has(t)) firstDir.set(t, dir);
      const list = found.map(({ dir, types }) => `${dir}(${types.join(", ")})`).join(", ");
      const hint = [...firstDir].map(([t, d]) => `${t}=${d}`).join(",");
      warn(tr("core.detectFs.monorepoWarn", { list, hint }));
    }
  }
  return fromRoot;
}

// Finds folders with project markers up to 2 levels below the root (for monorepo hints).
// Build output, dependency and native folders only add false positives, so they are skipped, and the children of a found folder are not scanned.
const SUBDIR_PRUNE = new Set(["node_modules", "build", "dist", "android", "ios", "venv", "__pycache__"]);
function findSubdirProjects(root, maxDepth = 2) {
  const found = [];
  const walk = (rel, depth) => {
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SUBDIR_PRUNE.has(e.name)) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const dir = join(root, childRel);
      const types = detectTypesFromMarkers({ has: hasFile(dir), read: readFile(dir) });
      if (types[0] !== "basic") found.push({ dir: childRel, types });
      else if (depth + 1 < maxDepth) walk(childRel, depth + 1);
    }
  };
  walk("", 0);
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

// Version detection: reads each type's version files in order.
// hint: fix guidance appended to the fallback warning (differs between interactive mode and the CLI).
// In a monorepo (--paths) the version files live inside the type folders; looking only at the root would reset to 0.0.1/1.
// Search order: primary type folder, then the other type folders, then the root.
function projectBases(types = [], paths = null) {
  const bases = [];
  for (const t of types) {
    const p = paths?.get?.(t);
    if (p && p !== "." && !bases.includes(p)) bases.push(p);
  }
  return bases.length ? [...bases, "."] : ["."];
}

// Uses the value from the first base folder that has a result, so read and list follow the same folder priority.
function firstFromBases(bases, fn) {
  return (rel) => {
    for (const b of bases) {
      const c = fn(b === "." ? rel : `${b}/${rel}`);
      if (c != null) return c;
    }
    return null;
  };
}

function readFromProject(root, types = [], paths = null) {
  return firstFromBases(projectBases(types, paths), readFile(root));
}

// Subfolder names (for React Native's ios/<app>/Info.plist lookup). null when the folder does not exist.
function listFromProject(root, types = [], paths = null) {
  const listDirs = (rel) => {
    try {
      return readdirSync(join(root, rel), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch { return null; }
  };
  return firstFromBases(projectBases(types, paths), listDirs);
}

export function detectVersion(root, { warn = (m) => console.error(m), hint, types = [], paths = null } = {}) {
  const read = readFromProject(root, types, paths);
  const readJson = (rel) => { const c = read(rel); try { return c ? JSON.parse(c) : null; } catch { return null; } };
  const list = listFromProject(root, types, paths);
  const gitTag = gitOut(root, ["describe", "--tags", "--abbrev=0"]);
  return detectVersionFromFiles({ read, readJson, list, gitTag, warn, hint, types });
}

// Real marker file per type, so the detection log and install log cite the same evidence file.
export function detectMarkers(root, types = []) {
  return resolveMarkers(types, hasFile(root));
}

// Build JDK detection, so the measured value can be used as the deploy workflow's JAVA_VERSION default.
// base: the spring project root in a monorepo (relative to the repo root).
export function detectJdk(root, base = ".") {
  const rel = base && base !== "." ? (r) => `${base}/${r}` : (r) => r;
  const read = readFile(root);
  return detectJdkFromFiles({ read: (r) => read(rel(r)) });
}

// Build number detection: on a fresh integration, reads the real build number from pubspec.yaml/build.gradle/app.json.
export function detectBuildNumber(root, { types = [], paths = null, warn = (m) => console.error(m) } = {}) {
  const read = readFromProject(root, types, paths);
  const readJson = (rel) => { const c = read(rel); try { return c ? JSON.parse(c) : null; } catch { return null; } };
  return detectBuildNumberFromFiles({ types, read, readJson, warn });
}

// Default branch detection: symbolic-ref, then remote show, then main.
// For an empty remote (remote add without a push yet) remote show returns "HEAD branch: (unknown)". If that value
// were written into the workflow trigger, release automation would silently stop, so only valid branch names are
// accepted; otherwise it falls back to the current local branch (first push target), then main, and warns.
// hint: fix guidance appended to the warning (differs between interactive mode and the CLI).
export function detectDefaultBranch(root, { warn = null, hint = "" } = {}) {
  const b = gitOut(root, ["symbolic-ref", "refs/remotes/origin/HEAD"]).replace(/^refs\/remotes\/origin\//, "");
  if (isValidBranchName(b)) return b;
  const show = gitOut(root, ["remote", "show", "origin"]);
  const m = show.match(/HEAD branch:\s*(\S+)/);
  if (m && isValidBranchName(m[1])) return m[1];
  if (!m) return "main"; // no origin: keep the existing rule
  const local = gitOut(root, ["symbolic-ref", "--short", "HEAD"]);
  const fallback = isValidBranchName(local) ? local : "main";
  warn?.(tr("core.detectFs.defaultBranchWarn", { fallback, hint: hint ? ` ${hint}` : "" }));
  return fallback;
}

// Repo name: last segment of git remote get-url origin, or the folder name on failure.
export function detectRepoName(root) {
  const url = gitOut(root, ["remote", "get-url", "origin"]);
  if (url) {
    const seg = url.replace(/\.git$/, "").split(/[/:]/).pop();
    if (seg) return seg;
  }
  return basename(root);
}

// Spring application*.yml lookup.
// Recursive fs implementation of: find {base} -path "*/src/main/resources/application*.yml" | head -1
// Returns a path relative to root (e.g. "server/src/main/resources/application.yml") or "".
//
// .yaml is accepted too. Spring officially supports both .yml and .yaml, but the old regex only looked
// for .yml, so projects using application.yaml got an empty string here and __APPLICATION_YML_DIR__
// was installed unreplaced.
//
// Within one directory the profile-less base file (application.yml/.yaml) wins. With filename sorting alone,
// 'application-dev.yml' sorts before 'application.yml' (`-` < `.`) and a profile file would be picked.
export function findSpringAppYml(root, base = ".") {
  return findSpringConfig(root, base, /^application(-[^/]*)?\.ya?ml$/, /^application\.ya?ml$/);
}

// Finds a config file matching pattern under src/main/resources. Once basePattern (the profile-less base file)
// turns up, that one is final.
function findSpringConfig(root, base, pattern, basePattern) {
  const startRel = base === "." ? "" : base;
  const PRUNE = new Set(["node_modules", ".git", "build", ".gradle", "target", ".idea"]);
  let hit = "";
  let hitIsBase = false;
  const walk = (rel, depth) => {
    if (hitIsBase || depth > 8) return; // once the base file is found there is no need to look further
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    // Sort to make traversal order deterministic (removes platform differences in find order)
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (hitIsBase) return;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (PRUNE.has(e.name)) continue;
        walk(childRel, depth + 1);
      } else if (pattern.test(e.name) && childRel.includes("src/main/resources/")) {
        const isBase = basePattern.test(e.name);
        // Take the first match for now, and promote to the base file if one turns up later.
        if (!hit || isBase) { hit = childRel; hitIsBase = isBase; }
      }
    }
  };
  walk(startRel, 0);
  return hit;
}

// Resource folder where the deploy workflow will create application-prod.yml.
// Spring Initializr produces application.properties by default, so looking only for yml gives an empty value and
// __APPLICATION_YML_DIR__ is installed unreplaced. Decided in order: yml, then properties, then the standard path.
export function findSpringResourcesDir(root, base = ".") {
  const f = findSpringAppYml(root, base)
    || findSpringConfig(root, base, /^application(-[^/]*)?\.properties$/, /^application\.properties$/);
  if (f) return f.split("/").slice(0, -1).join("/");
  return base === "." ? "src/main/resources" : `${base}/src/main/resources`;
}

// Builds the set of @wizard token resolvers, shared by index and interactive.
// paths: Map<type, path> (monorepo paths).
// flutterOptions: the resolveFlutterOptions result or a context with the same fields. When null the Flutter tokens
//   are empty, so the template defaults (dart-define, store_only) remain.
export function makeResolvers(root, repoName, paths, flutterOptions = null) {
  const springBase = (t) => paths.get(t || "spring") || paths.get("spring") || ".";
  return {
    repo: () => repoName,
    // Build JDK: default for the deploy workflow's JAVA_VERSION, measured from the project toolchain.
    // WARNING: returning an empty string makes setEnvLine skip that line, leaving __JAVA_VERSION__ as is
    //    (the same failure shape). On detection failure always fall back to the previous default, 21.
    jdk: (t) => detectJdk(root, springBase(t)) || "21",
    "spring-app-yml-dir": (t) => findSpringResourcesDir(root, springBase(t)),
    // A project without yml (properties only) gets application.yml in the resources folder:
    // writing YAML content in place of a properties file would break the config.
    "spring-app-yml-path": (t) => findSpringAppYml(root, springBase(t))
      || `${findSpringResourcesDir(root, springBase(t))}/application.yml`,
    "flutter-root": () => paths.get("flutter") || ".",
    // Path filter for the CI changes job: the project root per type. Single repos and common use "." (always treated as changed).
    "project-path": (t) => paths.get(t) || ".",
    // An empty string makes setEnvLine/setFallbackLine skip the line, so the template default remains.
    "flutter-env-mode": () => flutterOptions?.envMode || "",
    "android-deploy-mode": () => flutterOptions?.androidDeployMode || "",
    "ios-deploy-mode": () => flutterOptions?.iosDeployMode || "",
  };
}
