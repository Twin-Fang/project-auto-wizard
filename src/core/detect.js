import { t as tr } from "../i18n/index.js";
import {
  typeInfo, FALLBACK_TYPE, MARKER_DETECTED_TYPES, PACKAGE_DETECTED_TYPES, PACKAGE_FALLBACK_TYPE,
} from "./types.js";

// package.json classification: compares dependency "keys" exactly. A raw substring match would misdetect an
// export script or exponential-backoff as expo, a web app using react-native-web as react-native, and
// "react" in keywords as react. Input is the raw package.json string. Evaluation order is the registry's detectOrder.
export function classifyPackageText(raw) {
  let pkg;
  try { pkg = JSON.parse(String(raw || "")); } catch { return PACKAGE_FALLBACK_TYPE; }
  if (!pkg || typeof pkg !== "object") return PACKAGE_FALLBACK_TYPE;
  const deps = new Set();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const d = pkg[field];
    if (d && typeof d === "object") for (const k of Object.keys(d)) deps.add(k);
  }
  const hasDep = (t) => [t.packageDep, ...(t.extraPackageDeps || [])].some((k) => deps.has(k));
  return PACKAGE_DETECTED_TYPES.find(hasDep)?.id ?? PACKAGE_FALLBACK_TYPE;
}

// Convenience: when given a parsed object, re-serialize it and apply the rule above.
export function classifyPackageJson(pkgOrRaw) {
  const raw = typeof pkgOrRaw === "string" ? pkgOrRaw : JSON.stringify(pkgOrRaw || {});
  return classifyPackageText(raw);
}

// Marker scan. has(relpath)=>bool is injected. node is not added when another type is present.
// read(relpath)=>string|null supplies the raw package.json passed to classifyPackageText.
export function detectTypesFromMarkers({ has, read }) {
  const types = [];
  for (const t of MARKER_DETECTED_TYPES) if (t.markers.some(has)) types.push(t.id);
  if (has("package.json")) {
    const cls = classifyPackageText(read ? read("package.json") : "");
    if (cls === PACKAGE_FALLBACK_TYPE) { if (types.length === 0) types.push(cls); }
    else types.push(cls);
  }
  return types.length ? [...new Set(types)] : [FALLBACK_TYPE];
}

// For prerelease/build metadata such as 1.2.3-rc.1, 1.2.3+7, 1.2.0-SNAPSHOT only the x.y.z core is used.
// version.yml accepts only x.y.z, so the core is more accurate than falling back to 0.0.1.
// Must match the release-time read (payload/scripts/version_manager.py core_version) so the value survives right after install.
function coreVersion(v) {
  const m = String(v ?? "").trim().match(/^v?(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.+-]*)?$/);
  return m ? m[1] : null;
}

// setup(version="x.y.z") in setup.py. Other keys such as python_version are filtered out by the word boundary.
export function versionFromSetupPy(content) {
  if (!content) return null;
  const m = String(content).match(/(?<![\w.])version\s*=\s*["']([^"']+)["']/);
  return m ? coreVersion(m[1]) : null;
}

// React Native app version: read from the files version_manager writes at release time (ios/<app>/Info.plist,
// android/app/build.gradle). package.json version is not a sync target, so using it as the source would drift.
// Values that are not x.y.z, such as a $(MARKETING_VERSION) reference or the template default "1.0", are skipped.
// list(relDir)=>string[]|null supplies the app folder names under ios (deep plists such as Pods are not inspected).
export function versionFromReactNative({ read, list }) {
  for (const dir of [...(list?.("ios") || [])].sort()) {
    const m = String(read(`ios/${dir}/Info.plist`) || "").match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/);
    const v = m && coreVersion(m[1]);
    if (v) return v;
  }
  const m = String(read("android/app/build.gradle") || "").match(/versionName\s+"([^"]+)"/);
  return m ? coreVersion(m[1]) : null;
}

// Version detection: first success in order. read(relpath)=>string|null is injected.
// package.json is already parsed with Node JSON.parse, so it is always used regardless of whether jq is installed.
// hint: one line appended to the fallback warning saying how to fix it. Interactive mode and the CLI
// suggest different fixes, so the caller decides. The CLI wording is used when omitted.
// types: the primary type's (first entry) version file is read first. At release time version_manager compares
// the primary type's file with version.yml, so picking another type's version would make the version jump on the first release.
export function detectVersionFromFiles({ read, readJson, list, gitTag, warn, hint, types = [] }) {
  const grab = (content, re) => {
    for (const line of (content || "").split("\n")) {
      const m = line.match(re);
      if (m) { const v = coreVersion(m[m.length - 1]); if (v) return v; }
    }
    return null;
  };
  // Without a line-start anchor, dependency version variables such as ext.kotlin_version match first.
  // Only quoted values are considered: that is the only form the release-time sync can rewrite.
  const gradleRe = /^(\s*)version\s*=\s*(["'])([^"'\n]*)\2/;
  // Prefer a non-indented `version =`; only when none exists use an indented line inside an allprojects/subprojects block.
  // If a plugin config block such as `node { version = '20.11.0' }` were read as the project version, the version would jump on the first release.
  // Must follow the same rule as version_manager.py at release time.
  // Strip comments and blank out characters inside quotes so the `//` in url 'https://...' or braces inside strings
  // do not throw off the block-depth count. Must follow the same rule as version_manager.py.
  // quote is the quote that was open when this line started. Triple quotes (""" ''') span several lines, so
  // { code, quote } returns the quote still open at the end of the line for the next line to continue.
  // A single-line quote is treated as closed at the end of the line.
  const gradleCode = (line, quote) => {
    let out = "";
    for (let i = 0; i < line.length;) {
      const ch = line[i];
      if (quote) {
        if (ch === "\\" && i + 1 < line.length) { out += "  "; i += 2; continue; }
        if (line.startsWith(quote, i)) { out += quote; i += quote.length; quote = ""; continue; }
        out += " ";
      } else if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
        quote = line.slice(i, i + 3); out += quote; i += 3; continue;
      } else if (ch === "'" || ch === '"') { quote = ch; out += ch; }
      else if (line.startsWith("//", i)) break;
      else out += ch;
      i++;
    }
    return { code: out, quote: quote.length === 3 ? quote : "" };
  };
  const gradleVersion = (content) => {
    const top = [], shared = [], stack = [];
    let quote = ""; // the open quote when inside a multi-line string; lines inside a string are not code
    for (const line of (content || "").split("\n")) {
      const m = quote ? null : line.match(gradleRe);
      if (m) {
        if (m[1] === "") top.push(m[3]);
        else if (stack.some((b) => b === "allprojects" || b === "subprojects")) shared.push(m[3]);
      }
      const r = gradleCode(line, quote);
      quote = r.quote;
      const code = r.code;
      const name = code.match(/(\w+)\s*\{[^{}]*$/)?.[1] ?? "";
      for (const ch of code) {
        if (ch === "{") stack.push(name);
        else if (ch === "}") stack.pop();
      }
    }
    for (const v of top.length ? top : shared) { const c = coreVersion(v); if (c) return c; }
    return null;
  };
  const sources = {
    packageJson: () => coreVersion(readJson?.("package.json")?.version),
    appJson: () => coreVersion(readJson?.("app.json")?.expo?.version),
    // Groovy DSL and Kotlin DSL share the same syntax (`version = "x.y.z"`), so they share the regex.
    // Omitting .kts would reset every Kotlin DSL Spring project to 0.0.1.
    gradle: () => gradleVersion(read("build.gradle")),
    gradleKts: () => gradleVersion(read("build.gradle.kts")),
    pom: () => versionFromPom(read("pom.xml")),
    pubspec: () => grab(read("pubspec.yaml"), /^version:\s*([^\s#]+)/),
    pyproject: () => versionFromPyproject(read("pyproject.toml")),
    setupPy: () => versionFromSetupPy(read("setup.py")),
    reactNative: () => versionFromReactNative({ read, list }),
  };
  const order = [
    ...(typeInfo(types[0])?.versionSources || []),
    "packageJson", "gradle", "gradleKts", "pom", "pubspec", "pyproject", "setupPy",
  ];
  for (const key of new Set(order)) {
    const v = sources[key]();
    if (v) return v;
  }
  if (gitTag) { const t = coreVersion(gitTag); if (t) return t; }
  const tail = hint ?? tr("core.detect.versionFallbackHint");
  warn?.(tr("core.detect.versionFallbackWarn", { tail }));
  return "0.0.1";
}

// Package version in pyproject.toml. `version =` in other sections such as [tool.*] is tool config,
// so it is read only inside the [project] and [tool.poetry] sections.
export function versionFromPyproject(content) {
  if (!content) return null;
  let section = "";
  for (const line of String(content).split(/\r?\n/)) {
    const h = line.match(/^\s*\[+\s*([^\]]+?)\s*\]+\s*(?:#.*)?$/);
    if (h) { section = h[1]; continue; }
    if (section !== "project" && section !== "tool.poetry") continue;
    const m = line.match(/^\s*version\s*=\s*["']([^"']+)["']/);
    if (m) return coreVersion(m[1]);
  }
  return null;
}

// Maven pom.xml project version: only the <version> directly under <project> counts.
// Versions inside <parent> (Spring Boot BOM) or <dependencies> are not the project version, so depth tells them apart.
// Returns null when there is no project version (inherited from the parent); a dependency version is never picked instead.
export function versionFromPom(content) {
  if (!content) return null;
  const text = String(content);
  const tokenRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([A-Za-z_][\w.:-]*)[^>]*?(\/?)>/g;
  const stack = [];
  let start = -1;
  let m;
  while ((m = tokenRe.exec(text))) {
    const name = m[2];
    if (!name) continue;
    if (m[1]) {
      if (start >= 0 && stack.length === 2 && stack[1] === "version") {
        return coreVersion(text.slice(start, m.index));
      }
      stack.pop();
      continue;
    }
    if (m[3]) continue;
    stack.push(name);
    if (stack.length === 2 && name === "version") start = tokenRe.lastIndex;
  }
  return null;
}

// A type's representative marker file. Types without markers (basic) and unknown types return package.json.
export function markerForType(type) {
  return typeInfo(type)?.markers[0] || "package.json";
}

// Secondary markers besides the representative file (e.g. Spring's build.gradle.kts and pom.xml).
export function extraMarkers(type) {
  return typeInfo(type)?.markers.slice(1) || [];
}

// The file actually used to detect that type. markerForType always returns one representative file per type,
// so even a repo with only build.gradle.kts printed "found build.gradle" and the file name disagreed with the
// path-confirmation screen in the same install log. has() picks the one that really exists.
// When no candidate exists (e.g. screens before detection) the representative file is used. When shown as
// "evidence" (fallback:false) an empty string is returned instead: attaching a file that does not exist for a
// manually chosen type as evidence would make it look detected.
export function resolveMarker(type, has, { fallback = true } = {}) {
  const candidates = [markerForType(type), ...extraMarkers(type)];
  return candidates.find(has) ?? (fallback ? candidates[0] : "");
}

// Build JDK detection: the deploy workflow's JAVA_VERSION default is fixed at 21, so a project with a
// different toolchain (e.g. 25) that just presses Enter ends up with a runner JDK mismatch and a broken build.
// Measured from project files the same way detectBuildNumberFromFiles reads the build number.
// Returns a major version string such as "21", or null when not found.
export function detectJdkFromFiles({ read }) {
  const pick = (content, patterns) => {
    if (!content) return null;
    for (const re of patterns) {
      const m = String(content).match(re);
      // Normalize the 1_8 notation (JavaVersion.VERSION_1_8) to 8.
      if (m) return m[1] === "1_8" ? "8" : m[1].replace("1_", "");
    }
    return null;
  };
  const gradlePatterns = [
    /JavaLanguageVersion\.of\((\d+)\)/,                  // toolchain (recommended Gradle notation)
    /JavaVersion\.VERSION_(\d+(?:_\d+)?)/,               // sourceCompatibility = JavaVersion.VERSION_21
    /(?:source|target)Compatibility\s*=?\s*["'](\d+)["']/, // sourceCompatibility = '17'
  ];
  let v;
  if ((v = pick(read("build.gradle.kts"), gradlePatterns))) return v;
  if ((v = pick(read("build.gradle"), gradlePatterns))) return v;
  if ((v = pick(read("pom.xml"), [
    /<java\.version>\s*(\d+(?:\.\d+)?)\s*<\/java\.version>/,
    /<maven\.compiler\.(?:source|release)>\s*(\d+(?:\.\d+)?)\s*<\//,
  ]))) return v.replace(/^1\./, "");
  return null;
}

// Map of the real marker file per type: built in one place so the detection log and install log cite the same evidence.
export function resolveMarkers(types = [], has) {
  const out = new Map();
  for (const t of types) {
    if (t === "basic") continue;
    // Only files that actually exist count as evidence: otherwise the type is left out of the map and screens/logs treat it as "manually chosen".
    const found = resolveMarker(t, has, { fallback: false });
    if (found) out.set(t, found);
  }
  return out;
}

// Build number detection: on a fresh integration, read the build number already recorded in
// pubspec.yaml/build.gradle/app.json so version_code is not always reset to 1. Only the first matching
// type in the types array is used (same types[0]=primary convention as the other detection logic).
// read(rel)=>string|null and readJson(rel)=>object|null are injected.
export function detectBuildNumberFromFiles({ types = [], read, readJson, warn }) {
  const tryFlutter = () => {
    const content = read("pubspec.yaml");
    if (content == null) return null;
    // +N is the build number even with a prerelease such as 1.2.3-rc.1+4 (same rule as the release-time read).
    const m = content.match(/^version:\s*\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\+(\d+)/m);
    if (m) return parseInt(m[1], 10);
    warn?.(tr("core.detect.buildNumber.pubspecMissing"));
    return null;
  };
  const tryReactNative = () => {
    const content = read("android/app/build.gradle");
    if (content == null) return null;
    // Anchors + the m flag match only lines that are entirely "versionCode N", so a commented-out
    // "// versionCode 2" or a versionCode reference in another block is not matched by mistake.
    const m = content.match(/^\s*versionCode\s+(\d+)\s*$/m);
    if (m) return parseInt(m[1], 10);
    warn?.(tr("core.detect.buildNumber.gradleMissing"));
    return null;
  };
  const tryExpo = () => {
    const data = readJson?.("app.json");
    if (data == null) return null;
    const code = data?.expo?.android?.versionCode;
    if (Number.isInteger(code)) return code;
    warn?.(tr("core.detect.buildNumber.expoMissing"));
    return null;
  };
  const readers = { pubspec: tryFlutter, androidGradle: tryReactNative, expoAppJson: tryExpo };
  for (const t of types) {
    const source = typeInfo(t)?.buildNumberSource;
    if (source) return readers[source]();
  }
  return null;
}
