import { flutterHooks } from "./flutter-hooks.js";

// Project type registry: keeps per-type knowledge (detection markers, detection order, version and build-number files) in one place.
// The type list, marker map and detection chain are all built from this table, so a new type starts with one more line here.
// (Writing version files at release time is handled separately by payload/scripts/version_manager.py.)
//
// Fields:
//   id                 Type name used in the CLI and version.yml. Array order is also the display order of --help and interactive choices.
//   markers            Evidence files for the type. [0] is the representative file, and monorepo path search prioritizes in this order.
//   detectBy           Auto-detection method - "markers": detected when any of markers exists
//                      "package": detected by a package.json dependency key (packageDep)
//                      "package-fallback": package.json exists but none of the above matched
//                      absent: not auto-detected (basic is the result when nothing was detected).
//   extraPackageDeps   Other dependency keys that also classify a project as this type (e.g. next -> react).
//   displayName        Human-readable name shown next to the id in interactive choices (optional).
//   detectOrder        Evaluation order within the same detectBy. The earlier rule wins (an expo app also has a react-native dependency).
//   versionSources     File keys to read the version from at install (sources in detect.js); read first in this order for the primary type.
//   buildNumberSource  File key to read the mobile build number from (detectBuildNumberFromFiles in detect.js).
//   singleServerCd     The workflow file name when there is exactly one server-deploy CD with no deploy-style variants.
//   hooks              Type-specific behavior. A missing hook means "nothing to do", so common code calls only the existing ones through hooksFor().
//     workflowFilter(context)                         Filter for the type's root workflow files (filename -> bool) or null
//     cleanupWorkflows(dir, installed, context, baseline, opts)
//                                                     Cleanup of workflows dropped from the selection -> { removed, backedUp }
//     planAppFiles / copyAppFiles(context, payloadRoot, targetRoot)
//                                                     Plan/copy of user-owned app files (created only when missing) -> { created, kept }
//     appFilesTag                                     Category name in the app-file copy log
//     statusLabels(options)                           String appended to the status options line
//     doctorChecks(cwd, existing, { docs })           Array of doctor diagnostic rows
//     resolveOptions({ opts, existing, workflowsDir }) Type option object decided as CLI options, then saved values, then defaults
//                                                     (workflowsDir is passed only when inferring from installed workflows)
//     contextDefaults                                 Undecided default fields of createContext
//     contextFields(options) / optionsFromContext(context)
//                                                     Conversion between the option object and install-context fields
//     versionOptionsBlock(options)                    Block appended under version.yml options (6-space indent)
//     savedOptionKeys                                 Saved version.yml key to parseExisting option field
//     cliFlags[{ flag, field, initial, parse(v) }]    Type-specific CLI flags (the parsed result goes into opts[field])
//     installNotices(options)                         Array of warnings shown right after install (empty values ignored)
//     logChoices(context)                             Array of selected [name, value] pairs to record in the install log
// (The type-specific interactive question flow still lives in interactive.js.)
export const TYPES = [
  {
    id: "spring",
    markers: ["build.gradle", "build.gradle.kts", "pom.xml"],
    detectBy: "markers", detectOrder: 2,
    versionSources: ["gradle", "gradleKts", "pom"],
  },
  {
    id: "flutter",
    markers: ["pubspec.yaml"],
    detectBy: "markers", detectOrder: 1,
    versionSources: ["pubspec"],
    buildNumberSource: "pubspec",
    hooks: flutterHooks,
  },
  {
    // Next.js projects are React projects: same package.json version handling and the same CI/CD workflows.
    id: "react",
    displayName: "React / Next.js",
    markers: ["package.json"],
    detectBy: "package", packageDep: "react", extraPackageDeps: ["next"], detectOrder: 3,
    versionSources: ["packageJson"],
    singleServerCd: "PROJECT-REACT-CICD.yaml",
  },
  {
    id: "react-native",
    markers: ["package.json"],
    detectBy: "package", packageDep: "react-native", detectOrder: 2,
    // The native files synced at release time are the reference; package.json is consulted only when they cannot be read.
    versionSources: ["reactNative", "packageJson"],
    buildNumberSource: "androidGradle",
  },
  {
    // Expo may use only app.config.ts/js without app.json, as in the latest create-expo-app template.
    // Even with no config file at all, a package.json with an expo dependency is the evidence.
    id: "react-native-expo",
    markers: ["app.json", "app.config.ts", "app.config.js", "package.json"],
    detectBy: "package", packageDep: "expo", detectOrder: 1,
    versionSources: ["appJson", "packageJson"],
    buildNumberSource: "expoAppJson",
  },
  {
    id: "node",
    markers: ["package.json"],
    detectBy: "package-fallback",
    versionSources: ["packageJson"],
  },
  {
    id: "python",
    markers: ["pyproject.toml", "setup.py", "requirements.txt"],
    detectBy: "markers", detectOrder: 3,
    versionSources: ["pyproject", "setupPy"],
  },
  {
    // A type with no marker files: the result when nothing was detected, and a type that needs no path.
    id: "basic",
    markers: [],
  },
  {
    id: "go",
    markers: ["go.mod"],
    detectBy: "markers", detectOrder: 4,
    versionSources: [],
  },
];

// Type used when nothing was detected
export const FALLBACK_TYPE = "basic";

// Names that were once separate types and are now accepted as an alias of another one.
// Every input that can carry a type name (--type, --paths, version.yml) goes through canonicalTypeId(),
// so the rest of the code only ever sees registry ids and version.yml is rewritten with the canonical name.
export const TYPE_ALIASES = Object.freeze({ next: "react" });

export const canonicalTypeId = (name) => TYPE_ALIASES[name] ?? name;

// Canonical ids of a type list with duplicates removed (react,next -> react), keeping the first occurrence's position.
export const canonicalTypeIds = (names) => [...new Set(names.map(canonicalTypeId))];

const BY_ID = new Map(TYPES.map((t) => [t.id, t]));

// Unknown types give undefined; callers decide their own defaults.
export const typeInfo = (id) => BY_ID.get(id);

// Only those of types that have hook `name`, as [{ id, hook }], keeping the given type order.
export function hooksFor(types, name) {
  const found = [];
  for (const id of types) {
    const hook = BY_ID.get(id)?.hooks?.[name];
    if (hook !== undefined) found.push({ id, hook });
  }
  return found;
}

// Merges into one object the return values of the hook `name` from the types that have it; used when each type contributes different keys, such as options and context fields.
export function mergeHookResults(types, name, ...args) {
  return Object.assign({}, ...hooksFor(types, name).map(({ hook }) => hook(...args)));
}

// Merges the hook constants declared by all types (contextDefaults, savedOptionKeys, etc.) into one; for the default shape needed before the types are decided.
export const allHookValues = (name) => Object.assign({}, ...TYPES.map((t) => t.hooks?.[name]));

// Type names in display order.
// VALID_TYPES and ALL_TYPES share the same array, so it is frozen to keep a change on one side from polluting the other.
export const TYPE_IDS = Object.freeze(TYPES.map((t) => t.id));

const byDetectOrder = (a, b) => a.detectOrder - b.detectOrder;

// Types detected by file existence alone (in detection order)
export const MARKER_DETECTED_TYPES = TYPES.filter((t) => t.detectBy === "markers").sort(byDetectOrder);

// Types told apart by package.json dependencies (in evaluation order)
export const PACKAGE_DETECTED_TYPES = TYPES.filter((t) => t.detectBy === "package").sort(byDetectOrder);

// Type used when package.json exists but has no known framework dependency
export const PACKAGE_FALLBACK_TYPE = TYPES.find((t) => t.detectBy === "package-fallback").id;

// Types that have a mobile build number (version_code)
export const BUILD_NUMBER_TYPES = new Set(TYPES.filter((t) => t.buildNumberSource).map((t) => t.id));

// Workflow file names for which there is exactly one server-deploy CD, with no deploy-style variants
export const SINGLE_SERVER_CD_FILES = new Set(TYPES.filter((t) => t.singleServerCd).map((t) => t.singleServerCd));
