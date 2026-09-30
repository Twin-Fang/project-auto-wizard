// Preloaded by `npm run test:node` (node --import). Most existing tests assert the Korean output,
// so they run with the ko catalog. Spawned CLI processes inherit the env var; in-process calls
// use the module state set here. Tests for the default (en) output pass --lang en / setLanguage("en").
import { setLanguage } from "../src/i18n/index.js";

process.env.PROJECT_AUTO_WIZARD_LANG = "ko";
setLanguage("ko");

// Keep git from starting background gc / maintenance / fsmonitor in test repositories: they create files under
// .git while a test is deleting it (ENOTEMPTY). Env-based config reaches every git process a test spawns.
const gitConfig = [["gc.auto", "0"], ["maintenance.auto", "false"], ["core.fsmonitor", "false"]];
process.env.GIT_CONFIG_COUNT = String(gitConfig.length);
gitConfig.forEach(([k, v], i) => { process.env[`GIT_CONFIG_KEY_${i}`] = k; process.env[`GIT_CONFIG_VALUE_${i}`] = v; });
