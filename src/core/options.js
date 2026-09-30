// Option registry - one declaration per boolean release option; CLI flags, value resolution, version.yml parse/render
// and status/log lines are all derived from it (same idea as core/types.js for project types).
// Adding an option means adding one entry here; see ADDING-AN-OPTION.md.
//
// default       : value on a new install when neither a flag nor a saved value exists
// legacyDefault : value on an existing install (version.yml present) whose file lacks this key
//   semver_auto    - false: an install from before the feature must not silently turn on and let one ambiguous commit bump major
//   copilot_ai     - false: opt-in because it consumes AI Credits
// conflictKey   : i18n key of the error thrown when --<flag> and --no-<flag> are both given (catalog lives in src/i18n)
// logLabel      : label used by the install log line ("option <logLabel> on|off")
// ask           : present only for options the interactive wizard asks about / lists in the edit menu
//   { questionKey, initial, menuLabelKey, summaryKey, cardIcon, cardLabel }
// Keys only - this module never imports the i18n layer, so core stays free of UI dependencies.
export const OPTIONS = Object.freeze([
  {
    key: "semver_auto", name: "semverAuto", ctxField: "includeSemverAuto",
    flag: "semver-auto", default: true, legacyDefault: false,
    conflictKey: "cli.args.semverConflict", logLabel: "semver",
  },
  {
    key: "copilot_ai", name: "copilotAi", ctxField: "includeCopilotAi",
    flag: "copilot", default: false, legacyDefault: false,
    conflictKey: "cli.args.copilotConflict", logLabel: "copilot",
  },
]);

export const optionByKey = (key) => OPTIONS.find((o) => o.key === key);

// version.yml template variable name, e.g. semver_auto -> OPT_SEMVER_AUTO
export const optionVar = (o) => `OPT_${o.key.toUpperCase()}`;

// Context fields (includeX) -> explicit-value map (name -> boolean|null)
export function explicitFromContext(ctx = {}) {
  return Object.fromEntries(OPTIONS.map((o) => [o.name, ctx[o.ctxField] ?? null]));
}

// Context defaults: null = not decided yet
export function defaultContextFields() {
  return Object.fromEntries(OPTIONS.map((o) => [o.ctxField, null]));
}

// Only explicit and saved values are applied - null means undecided (interactive mode uses it to decide whether to ask).
export function pickOptionValues(explicit = {}, existing = null) {
  return Object.fromEntries(
    OPTIONS.map((o) => [o.name, explicit[o.name] ?? existing?.options?.[o.name] ?? null]),
  );
}

// Final values keyed by context field - undecided options get default (new install) or legacyDefault (existing install).
export function resolveOptionValues(explicit = {}, existing = null) {
  const picked = pickOptionValues(explicit, existing);
  return Object.fromEntries(
    OPTIONS.map((o) => {
      const v = picked[o.name];
      return [o.ctxField, v === null ? (existing ? o.legacyDefault : o.default) : v === true];
    }),
  );
}

// Values for rendering version.yml: a context field that is unset (null/undefined) falls back to the option's default.
export function renderValues(ctx = {}) {
  return Object.fromEntries(OPTIONS.map((o) => [o.ctxField, (ctx[o.ctxField] ?? o.default) === true]));
}

// Options the interactive wizard asks about (those declaring `ask`).
export const askableOptions = () => OPTIONS.filter((o) => o.ask);
