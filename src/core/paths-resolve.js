// Per-type project path detection and confirmation. In a monorepo, decides which folder holds each
// type's version file using a 5-step priority.
//
// io injection contract (same as the readline-engine signatures):
//   io.select({message, options:[{value,label}]}) → value | CANCEL(symbol)
//   io.text({message, defaultValue})              → string | CANCEL
//   io.confirm({message, initialValue})           → bool | CANCEL
//   io.log(line)                                   → notice output (stderr when absent)
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { markerForType as baseMarkerForType, resolveMarker } from "./detect.js";
import { TYPES, typeInfo } from "./types.js";
import { normalizePath, isRepoRelativePath } from "./paths.js";
import { CliError } from "./errors.js";
import { t as tr } from "../i18n/index.js";

// Cancel (ESC) is the CANCEL symbol (the engine aborts on Ctrl+C with an exception); judged only by being a symbol, without importing ui (avoids a core-to-ui back reference).
const isCancel = (v) => typeof v === "symbol";

// A type's representative marker file name.
// detect.js returns package.json by default for unknown types, but path search must tell marker-less types (basic etc.) apart with an empty string, hence the wrapper.
const KNOWN_MARKER_TYPES = new Set(TYPES.filter((t) => t.markers.length).map((t) => t.id));
export function markerForType(type) {
  return KNOWN_MARKER_TYPES.has(type) ? baseMarkerForType(type) : "";
}

// Returns the marker file name that really exists in a directory: the fs-driven version of resolveMarker.
// (including secondary markers: spring build.gradle/.kts/pom.xml, python pyproject/setup.py/requirements.txt)
export function existingMarkerInDir(type, dir) {
  if (!markerForType(type)) return ""; // empty string for unknown types
  return resolveMarker(type, (n) => existsSync(join(dir, n)));
}

// Recursive file search with maxdepth 3: collects the relative "directory" path of matching files (root is ".").
// find's maxdepth counts file path components (./a/b/f = depth 3), so it is computed the same way.
function walkFindDirs(root, { prune, match, maxDepth = 3 }) {
  const hits = [];
  const walk = (rel, depth) => {
    let entries;
    try { entries = readdirSync(join(root, rel || "."), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const childDepth = depth + 1;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        // prune folders are excluded along with everything below them
        if (prune.has(e.name)) continue;
        // descend only when child files fall within depth <= maxDepth
        if (childDepth < maxDepth) walk(childRel, childDepth);
        // files inside a directory at childDepth === maxDepth are at depth maxDepth+1, which find does not see
        else if (childDepth === maxDepth) { /* files count only up to maxDepth; no need to descend into directories */ }
      } else if (childDepth <= maxDepth && match(e.name)) {
        hits.push(rel === "" ? "." : rel);
      }
    }
  };
  walk("", 0);
  return [...new Set(hits)].sort(); // dedupe + sort
}

// Marker-file candidate search per type.
// Returns an array of candidate directory relative paths (root is ".").
export function findTypePathCandidates(root, type) {
  // -- Spring multi-module: the settings.gradle(.kts) folder collapses to the module root --
  // version_manager updates every build.gradle beneath that folder, so submodules are not expanded.
  // The settings.gradle under android/ (Flutter/RN) is not spring, so it is pruned.
  if (type === "spring") {
    const mm = walkFindDirs(root, {
      prune: new Set(["node_modules", ".git", "build", "dist", ".gradle", "android", "ios"]),
      match: (n) => n === "settings.gradle" || n === "settings.gradle.kts",
    });
    if (mm.length) return mm;
    // no settings.gradle: single module, fall back to build.gradle below
  }

  // The marker order in the registry is the priority (representative file first).
  const names = typeInfo(type)?.markers;
  if (!names?.length) return [];

  const prune = new Set([
    "node_modules", ".git", "build", "dist", ".dart_tool", "android", "ios",
    ".gradle", "venv", ".venv", "__pycache__",
  ]);
  // If found with a higher-priority marker, use only that
  let found = [];
  for (const n of names) {
    found = walkFindDirs(root, { prune, match: (name) => name === n });
    if (found.length) break;
  }

  return found.filter((d) => {
    if (type === "flutter") {
      // exclude example/ and require a sibling lib/ to avoid false positives
      if (d.includes("example")) return false;
      const libDir = d === "." ? join(root, "lib") : join(root, d, "lib");
      if (!existsSync(libDir)) return false;
    }
    if (type === "spring") {
      // exclude the false positive of Flutter/RN's android/build.gradle
      if (d.includes("android")) return false;
    }
    return true;
  });
}

// Detects and confirms the paths of all selected types into a Map<type,path>
// (5-step priority).
//   1. already in paths (--paths): kept
//   2. marker exists at the root: "." automatically
//   3. existingPaths (value saved in version.yml)
//   4. candidate scan
//   5. branch - non-interactive: existing value, then a single candidate, then error / interactive: confirm, select, enter manually
export async function resolveProjectPaths({
  root, types = [], paths = new Map(), existingPaths = new Map(),
  force = false, tty = true, io = {},
}) {
  const say = io.log || ((m) => process.stderr.write(`${m}\n`));
  const result = new Map(paths); // keep the pre-set --paths values (the caller's Map is left unchanged)
  const targets = types.filter((t) => t !== "basic"); // basic needs no path
  if (targets.length === 0) return result;

  const total = targets.length;
  // -- Intro notice (detection result + what will happen) --
  say("");
  if (total > 1) say(tr("core.paths.intro.multi", { total }));
  else say(tr("core.paths.intro.single", { type: targets[0] }));
  for (const t of targets) say(`   • ${t.padEnd(8)} → ${existingMarkerInDir(t, root)}`);
  say("");
  say(tr("core.paths.intro.rootDef"));
  say("");

  let idx = 0;
  for (const t of targets) {
    idx += 1;
    const prog = `[${idx}/${total}]`;

    // 1. already given via --paths etc.: highest priority
    if (result.get(t)) {
      const p = result.get(t);
      if (!existsSync(join(root, p))) {
        throw new CliError(tr("core.paths.err.pathMissing", { type: t, path: p }));
      }
      say(tr("core.paths.say.explicit", { type: t, path: p }));
      // Not blocking (some setups work without the marker); this only flags a typo that pointed to the wrong folder.
      const pm = existingMarkerInDir(t, join(root, p));
      if (pm && !existsSync(join(root, p, pm))) {
        say(tr("core.paths.warn.noMarker", { path: p, type: t, marker: pm }));
      }
      continue;
    }

    // 2. marker exists at the root: "." confirmed automatically (including secondary markers)
    const rootMarker = existingMarkerInDir(t, root);
    if (rootMarker && existsSync(join(root, rootMarker))) {
      result.set(t, ".");
      say(tr("core.paths.say.rootMarker", { type: t, marker: rootMarker }));
      continue;
    }

    // 3. value saved in the existing version.yml: default suggestion
    const existing = existingPaths.get(t) || "";

    // 4. candidate search
    const candidates = findTypePathCandidates(root, t);
    let chosen = "";

    // -- 5a. non-interactive (--force or no TTY; root fallback intentionally excluded) --
    if (force || !tty) {
      if (existing) {
        chosen = existing;
        say(tr("core.paths.say.keepExisting", { type: t, path: chosen }));
      } else if (candidates.length === 1) {
        chosen = candidates[0];
        say(tr("core.paths.say.auto", { type: t, path: chosen }));
      } else if (candidates.length === 0) {
        throw new CliError(tr("core.paths.err.none", { type: t }));
      } else {
        throw new CliError(tr("core.paths.err.ambiguous", { type: t, count: candidates.length, list: candidates.join(", ") }));
      }
      result.set(t, chosen);
      continue;
    }

    // -- 5b. interactive: branch by candidate count --
    if (candidates.length === 1) {
      const cand = candidates[0];
      const candMarker = existingMarkerInDir(t, cand === "." ? root : join(root, cand));
      const candFull = cand === "." ? candMarker : `${cand}/${candMarker}`;
      say("");
      say(tr("core.paths.found.one", { prog, type: t, marker: candMarker }));
      say(tr("core.paths.found.location", { file: candFull }));
      // On 'No'/cancel chosen stays unset, falling through to the manual-entry loop below
      const ok = await io.confirm({
        message: tr("core.paths.confirm.candidate", { type: t, cand, file: candFull }),
        initialValue: true,
      });
      if (ok === true) chosen = cand;
    } else if (candidates.length > 1) {
      say("");
      say(tr("core.paths.found.many", { prog, type: t, count: candidates.length }));
      // Candidates + a 'manual entry' menu: the value itself is the display text (avoids exposing a sentinel)
      const manual = tr("core.paths.manualInput");
      const options = candidates.map((c) => ({
        value: c,
        label: `${c} (${existingMarkerInDir(t, c === "." ? root : join(root, c))})`,
      }));
      options.push({ value: manual, label: manual });
      const sel = await io.select({ message: tr("core.paths.select.root", { type: t }), options });
      // ESC (cancel) also falls back to manual entry
      if (!isCancel(sel) && sel != null && sel !== manual) chosen = sel;
    } else {
      say("");
      say(tr("core.paths.found.none", { prog, type: t }));
    }

    // -- Manual-entry loop (when still undecided above) --
    while (!chosen) {
      const hintMarker = existingMarkerInDir(t, root);
      let prompt = tr("core.paths.prompt.base", { type: t, marker: hintMarker });
      if (existing) prompt += tr("core.paths.prompt.current", { existing });
      prompt += "): ";
      let input = await io.text({ message: prompt, defaultValue: "" });
      if (isCancel(input) || input == null) input = ""; // ESC becomes empty (falls back below)
      input = String(input).trim();
      // Empty means the existing value or the root; decided before normalizePath
      input = input === "" ? (existing || ".") : normalizePath(input);
      if (!isRepoRelativePath(input)) {
        say(tr("core.paths.warn.outsideRepo", { input }));
        continue;
      }
      // Validation: confirm a marker exists at the entered path (including secondary markers)
      const m = existingMarkerInDir(t, input === "." ? root : join(root, input));
      if (m && existsSync(join(root, input === "." ? "" : input, m))) {
        chosen = input;
      } else {
        say(tr("core.paths.warn.noFile", { input, marker: m }));
        // Default (Enter) and ESC keep this path as is. With 'No' as the default, a type whose marker does not exist yet
        // (e.g. added before the project is created) could not be exited with Enter alone.
        // To enter it again, explicitly choose 'No'. The path can be fixed later in version.yml project_paths.
        const forceOk = await io.confirm({ message: tr("core.paths.confirm.useAnyway"), initialValue: true });
        if (forceOk !== false) chosen = input;
      }
    }

    result.set(t, chosen);
    say(tr("core.paths.say.chosen", { type: t, chosen }));
  }

  // -- Summary + duplicate-marker-file warning --
  say("");
  say(tr("core.paths.summary.title"));
  const fileToTypes = new Map(); // marker file relative path to the types using that file
  for (const [pt, pp] of result) {
    const m = existingMarkerInDir(pt, pp === "." ? root : join(root, pp));
    const file = pp === "." ? m : `${pp}/${m}`;
    say(tr("core.paths.summary.row", { type: pt, file }));
    if (!fileToTypes.has(file)) fileToTypes.set(file, []);
    fileToTypes.get(file).push(pt);
  }
  for (const [file, ts] of fileToTypes) {
    if (ts.length > 1) {
      // Idempotent behavior, so only a warning rather than a block
      say(tr("core.paths.dup.warn", { file, types: ts.join(" ") }));
      say(tr("core.paths.dup.note"));
    }
  }
  say("");
  return result;
}
