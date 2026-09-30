// Wizard-wide state made explicit as a single object
import { TYPE_IDS, allHookValues } from "./core/types.js";
import { defaultContextFields } from "./core/options.js";

// --type whitelist: the display order of the type registry (core/types.js).
export const VALID_TYPES = TYPE_IDS;

// --mode whitelist: unknown values must be rejected before any side effect (branch lookup, etc.).
// purge is a hidden mode (not in --help or the interactive menu) but is still validated.
// version/workflows (partial install) and revert were removed: a partial install refreshes the
// install-time baseline only halfway and blurs update detection, and revert was a subset of uninstall.
export const VALID_MODES = [
  "interactive", "full",
  "uninstall", "status", "doctor", "purge",
];

export const DEFAULT_VERSION = "0.0.0"; // fallback when reading the package version fails (banner only; not used for breaking comparison)

export function createContext(overrides = {}) {
  return {
    mode: "interactive",
    force: false,
    types: [],
    version: "",
    branch: "",
    branches: null,          // { main, develop, mode: "pr-flow"|"trunk-based" } - result of resolveBranchConfig
    paths: new Map(),        // type -> path
    // Release option fields (includeSemverAuto, includeCopilotAi, ...): null = unset (resolved downstream), true/false = explicit.
    // Fields and defaults come from the option registry (core/options.js).
    ...defaultContextFields(),
    // Type-specific option fields; all ignored in projects without that type. Fields and defaults come from the type hook (contextDefaults).
    ...allHookValues("contextDefaults"),
    language: "en",          // message language (--lang / env / version.yml), default en
    templateVersion: "",
    deployValues: new Map(), // "type.KEY" -> value
    counters: {},
    ...overrides,
  };
}
