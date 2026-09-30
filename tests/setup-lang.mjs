// Preloaded by `npm run test:node` (node --import). Most existing tests assert the Korean output,
// so they run with the ko catalog. Spawned CLI processes inherit the env var; in-process calls
// use the module state set here. Tests for the default (en) output pass --lang en / setLanguage("en").
import { setLanguage } from "../src/i18n/index.js";

process.env.PROJECT_AUTO_WIZARD_LANG = "ko";
setLanguage("ko");
