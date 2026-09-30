// Language selection: --lang flag -> PROJECT_AUTO_WIZARD_LANG -> saved version.yml `language` -> default.
export const SUPPORTED_LANGUAGES = ["en", "ko"];
export const DEFAULT_LANGUAGE = "en";
export const LANG_ENV_VAR = "PROJECT_AUTO_WIZARD_LANG";

export const isSupportedLanguage = (v) => SUPPORTED_LANGUAGES.includes(v);

// Trim and lowercase so `--lang KO` and ` ko ` behave the same. Returns "" when unset.
export const normalizeLanguage = (v) => String(v ?? "").trim().toLowerCase();
