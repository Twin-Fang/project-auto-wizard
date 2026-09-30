// English message catalog (default language). Keys are flat and dotted: `<area>.<topic>.<name>`.
// Params are written as {name}. Every key here must also exist in ko.js (checked by tests).
export default {
  "cli.lang.invalid": "Unsupported language '{value}' ({source}). Supported: {supported}",
  "cli.lang.missing": "--lang requires a value. Supported: {supported}",
  "cli.lang.help": "Message language: {supported} (default: en)",
};
