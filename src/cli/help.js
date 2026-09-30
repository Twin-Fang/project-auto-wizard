import { TYPE_IDS } from "../core/types.js";
import { t, SUPPORTED_LANGUAGES } from "../i18n/index.js";

// Supported type list: wrapped at 40 characters per line in registry order; continuation lines align after the "Supported:" label.
function typeListLines(width = 40) {
  const lines = [];
  for (const id of TYPE_IDS) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last].length + 1 + id.length <= width) lines[last] += ` ${id}`;
    else lines.push(id);
  }
  return lines.join(`\n${" ".repeat(33)}`);
}

// --help text. Built lazily because the language is only resolved after import time.
export const helpText = () => t("cli.help.text", {
  types: typeListLines(),
  langHelp: t("cli.lang.help", { supported: SUPPORTED_LANGUAGES.join(" | ") }),
});
