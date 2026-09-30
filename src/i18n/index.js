// i18n entry: current-language state and t(key, params) lookup.
import { CATALOGS } from "./catalog/index.js";
import { CliError } from "../core/errors.js";
import {
  SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, LANG_ENV_VAR, isSupportedLanguage, normalizeLanguage,
} from "./languages.js";

export { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, LANG_ENV_VAR, isSupportedLanguage, normalizeLanguage } from "./languages.js";

let current = DEFAULT_LANGUAGE;

export const getLanguage = () => current;

// Unsupported codes are ignored so a bad value can never leave the module without a catalog.
export function setLanguage(lang) {
  if (isSupportedLanguage(lang)) current = lang;
  return current;
}

// Look up `key` in the current language (or `lang` when given). A key missing from that
// catalog falls back to English; a key missing everywhere returns the key itself so the gap is visible.
// `{name}` placeholders are replaced from params; unknown placeholders are left as written.
export function t(key, params = {}, lang = current) {
  const template = CATALOGS[lang]?.[key] ?? CATALOGS[DEFAULT_LANGUAGE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

// Resolve the effective language: flag -> env -> saved version.yml value -> default.
// An unsupported explicit value (flag, env) throws CliError: falling back silently would hide a typo.
// A saved value is not input for this run (the file may be hand-edited or written by a newer
// version), so an unknown one falls back to the default instead of blocking the install.
//   sources: { flag?, env?, saved? } - raw values, empty/undefined = not set
export function resolveLanguage({ flag, env, saved } = {}) {
  for (const [source, raw] of [["--lang", flag], [LANG_ENV_VAR, env]]) {
    const v = normalizeLanguage(raw);
    if (!v) continue;
    if (!isSupportedLanguage(v)) {
      throw new CliError(t("cli.lang.invalid", { value: String(raw).trim(), source, supported: SUPPORTED_LANGUAGES.join(", ") }, DEFAULT_LANGUAGE));
    }
    return v;
  }
  const s = normalizeLanguage(saved);
  return isSupportedLanguage(s) ? s : DEFAULT_LANGUAGE;
}
