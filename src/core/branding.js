// Branch placeholder substitution pipeline.
// Replaces {{MAIN_BRANCH}}/{{DEVELOP_BRANCH}} in payload workflows with the real branch names at install time.
// WARNING: the GitHub Actions expression `${{ ... }}` is not our token, so a leading `$` excludes it (lookbehind).
// Throws when an unknown {{TOKEN}} remains after substitution: a copy-integrity guard (catches typos and omissions early).
import { t } from "../i18n/index.js";

const TOKEN_RE = /(?<!\$)\{\{([A-Z][A-Z0-9_]*)\}\}/g;

// substitute(text, {main, develop}): substitutes branch tokens. Throws when an unknown token is found.
export function substitute(text, { main, develop }) {
  const map = { MAIN_BRANCH: main, DEVELOP_BRANCH: develop };
  return String(text).replace(TOKEN_RE, (_, name) => {
    if (name in map) return map[name];
    throw new Error(t("core.branding.unknownPlaceholder", { name }));
  });
}
