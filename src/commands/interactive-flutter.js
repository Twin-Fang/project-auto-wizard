// Flutter option questions of the interactive wizard - env mode, store deploy targets, deploy mode.
// State is passed around as an immutable { envMode, stores, androidDeployMode, iosDeployMode } object.
//   "" for envMode/*DeployMode and null for stores mean undecided (an empty stores array means "no store deploy", already decided).
// Already-decided values are not asked again (convention: saved version.yml values skip the question). ESC (cancel) always means default:
// the default for a first-time question, the current value while editing.
import {
  isEnvMode, isDeployMode, parseStoreList, STORE_PLATFORMS, DEFAULT_DEPLOY_MODE,
} from "../core/flutter-options.js";
import { deployModeWarning } from "../ui/prompts.js";
import { t } from "../i18n/index.js";

export const FLUTTER_EDIT_ITEMS = new Set(["envMode", "flutterStore", "deployMode"]);

const DEPLOY_MODE_KEY = { android: "androidDeployMode", ios: "iosDeployMode" };

// Sort by STORE_PLATFORMS order and drop unknown values - keeps the per-platform question order fixed.
const normalizeStores = (picked) => STORE_PLATFORMS.filter((platform) => picked.includes(platform));

// Move the saved values of the existing version.yml into state. Invalid values are treated as not saved and asked again.
export function savedFlutterState(existing) {
  const options = existing?.options ?? {};
  return {
    envMode: isEnvMode(options.envMode) ? options.envMode : "",
    stores: options.flutterStore == null ? null : parseStoreList(options.flutterStore),
    androidDeployMode: isDeployMode(options.androidDeployMode) ? options.androidDeployMode : "",
    iosDeployMode: isDeployMode(options.iosDeployMode) ? options.iosDeployMode : "",
  };
}

async function askDeployMode(io, platform, initialValue) {
  const picked = await io.selectDeployMode({ platform, initialValue });
  const mode = isDeployMode(picked) ? picked : initialValue; // ESC = default
  const warning = deployModeWarning(mode);
  if (warning) io.note?.(warning, t("interactive.flutter.deployModeTitle"));
  return mode;
}

// Ask only for chosen platforms that have no deploy mode yet.
async function askUnsetDeployModes(io, state) {
  const next = { ...state };
  for (const platform of state.stores ?? []) {
    const key = DEPLOY_MODE_KEY[platform];
    if (!next[key]) next[key] = await askDeployMode(io, platform, DEFAULT_DEPLOY_MODE);
  }
  return next;
}

// Ask only the options that are not decided yet.
//   envModeDefault  - dart-define for new installs / dotenv for existing installs (preserves behaviour)
//   inferredStores  - stores an existing install without saved values already used (new installs get all, same as the CLI default)
export async function askUnsetFlutterOptions(io, state, { envModeDefault, inferredStores }) {
  const next = { ...state };
  if (!next.envMode) {
    const picked = await io.selectEnvMode({ initialValue: envModeDefault });
    next.envMode = isEnvMode(picked) ? picked : envModeDefault; // ESC = default
  }
  if (next.stores === null) {
    const picked = await io.selectFlutterStores({ initialValues: inferredStores });
    next.stores = Array.isArray(picked) ? normalizeStores(picked) : inferredStores; // ESC = initial selection
  }
  return askUnsetDeployModes(io, next);
}

// Re-ask one item chosen in the edit menu. The current value is the initial selection and ESC keeps it.
export async function editFlutterOption(io, what, state, envModeDefault) {
  if (what === "envMode") {
    const picked = await io.selectEnvMode({ initialValue: state.envMode || envModeDefault });
    return isEnvMode(picked) ? { ...state, envMode: picked } : state;
  }
  if (what === "flutterStore") {
    const picked = await io.selectFlutterStores({ initialValues: state.stores ?? [] });
    if (!Array.isArray(picked)) return state;
    const stores = normalizeStores(picked);
    // Reset the deploy mode of deselected platforms - otherwise the old value survives re-selection and is never asked again.
    const reset = { ...state, stores };
    for (const platform of STORE_PLATFORMS) {
      if (!stores.includes(platform)) reset[DEPLOY_MODE_KEY[platform]] = "";
    }
    // Ask the deploy mode only for platforms newly added or just reset - modes of already-decided platforms are kept.
    return askUnsetDeployModes(io, reset);
  }
  if (what === "deployMode") {
    const stores = state.stores ?? [];
    if (!stores.length) {
      io.note?.(t("interactive.flutter.storeFirst"), t("interactive.flutter.deployModeTitle"));
      return state;
    }
    const next = { ...state };
    for (const platform of stores) {
      const key = DEPLOY_MODE_KEY[platform];
      next[key] = await askDeployMode(io, platform, state[key] || DEFAULT_DEPLOY_MODE);
    }
    return next;
  }
  return state;
}
