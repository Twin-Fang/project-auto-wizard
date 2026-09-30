// wizard-prompts.yml label metadata parser.
// WARNING: no YAML library - line-based parsing only (zero external dependencies, and slightly malformed user files still read).
import { join } from "node:path";
import * as nodeFs from "node:fs";
import { PAYLOAD } from "./paths.js";
import { getLanguage } from "../i18n/index.js";

// Location of wizard-prompts.yml - path relative to the user repo (for custom overrides)
export const LABELS_FILE = ".github/config/wizard-prompts.yml";

// Strip surrounding quotes and trim ("value" -> value).
function unquote(s) {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t.slice(1, -1);
  return t;
}

// wizard-prompts.yml text -> parsed object (pure function - usable directly in tests).
// Returns: { fields: Map<lookup key, {label?,help?,example?}>, workflowNames: [{key,value}] }
//  - lookup key: "PROJECT_NAME" or "flutter.APP_ARTIFACT_NAME" (dotted per-type override)
//  - the legacy one-liner (KEY: "label") is absorbed as the fields label (label only)
//  - a language variant is a suffixed field (label_ko) or a suffixed names block (_workflow_names_ko);
//    the plain field/block is the default-language text
export function parseWizardPrompts(text) {
  const fields = new Map();
  const workflowNames = [];
  let current = null;       // fields entry of the current block (owner of indented lines)
  let inWfNames = false;    // whether inside a _workflow_names block
  let wfLang = null;        // language of that block (null = the plain default block)

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue; // blank lines and comments do not end a block

    if (!/^\s/.test(line)) {
      // top-level key line - ends the previous block
      current = null; inWfNames = false;
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_.\-]*):(.*)$/);
      if (!m) continue;
      const key = m[1];
      const rest = m[2].trim();
      const wfBlock = key.match(/^_workflow_names(?:_([a-z]{2}))?$/);
      if (wfBlock) { inWfNames = true; wfLang = wfBlock[1] ?? null; continue; }
      const entry = fields.get(key) || {};
      if (rest) {
        // legacy one-liner: KEY: "label" (used as label only)
        const q = rest.match(/^"([^"]*)"\s*$/);
        if (q) entry.label = q[1];
      }
      fields.set(key, entry);
      current = entry;
      continue;
    }

    // indented line - belongs to the current block
    const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_.\-]*):\s*(.*)$/);
    if (!m) continue;
    if (inWfNames) {
      // only the `  KEY: "value"` form is accepted
      const q = m[2].match(/^"(.*)"\s*$/);
      if (q) workflowNames.push(wfLang ? { key: m[1], value: q[1], lang: wfLang } : { key: m[1], value: q[1] });
      continue;
    }
    if (current && /^(?:label|help|example)(?:_[a-z]{2})?$/.test(m[1])) {
      // only the first occurrence in a block is taken
      if (current[m[1]] == null) current[m[1]] = unquote(m[2]);
    }
  }
  return { fields, workflowNames };
}

// Find, read and parse wizard-prompts.yml.
// The target project's user file (custom override) is layered over the bundled copy (payload/config) key by key.
// WHY merge: it is natural for a user file to list only the keys to change - replacing the whole file would drop the
//          label/help/example of every unlisted question and the workflow display names, leaving only KEY names.
// fs is injectable (for tests) - defaults to node:fs.
export function loadWizardPrompts(targetRoot = ".", payloadRoot = "", fs = nodeFs) {
  const read = (p) => (fs.existsSync(p) ? parseWizardPrompts(fs.readFileSync(p, "utf8")) : null);
  const bundled = payloadRoot ? read(join(payloadRoot, PAYLOAD.configDir, "wizard-prompts.yml")) : null;
  const user = read(join(targetRoot, LABELS_FILE));
  if (!bundled || !user) return user || bundled;
  return mergeWizardPrompts(bundled, user);
}

// Merge the bundled and user parse results. For the same key only fields the user wrote are overridden (changing only label keeps the bundled help/example).
export function mergeWizardPrompts(base, override) {
  const fields = new Map([...base.fields].map(([k, v]) => [k, { ...v }]));
  for (const [key, entry] of override.fields) {
    const merged = { ...(fields.get(key) || {}) };
    for (const [f, v] of Object.entries(entry)) {
      if (v == null || v === "") continue;
      // A plain field written by the user must win in every language, so bundled variants of it are dropped.
      if (!/_[a-z]{2}$/.test(f)) for (const k of Object.keys(merged)) if (k.startsWith(`${f}_`)) delete merged[k];
      merged[f] = v;
    }
    fields.set(key, merged);
  }
  // A plain user name replaces the bundled name of every language (the user wrote it for their own repo);
  // a language-tagged one replaces only that language.
  const overridden = new Set(override.workflowNames.map((w) => `${w.key}|${w.lang ?? "*"}`));
  const isOverridden = (w) => overridden.has(`${w.key}|${w.lang ?? "*"}`) || overridden.has(`${w.key}|*`);
  const workflowNames = [...base.workflowNames.filter((w) => !isOverridden(w)), ...override.workflowNames];
  return { fields, workflowNames };
}

// Field lookup. field: "label" | "help" | "example".
// Priority: "{type}.KEY" block -> "KEY" block (including the legacy one-liner) -> fallback (KEY name for label, otherwise "").
// Within a block the current language's variant (label_ko) comes before the plain field.
export function wfField(prompts, type, key, field, lang = getLanguage()) {
  if (prompts && prompts.fields) {
    for (const q of [`${type}.${key}`, key]) {
      const entry = prompts.fields.get(q);
      for (const f of [`${field}_${lang}`, field]) {
        const v = entry?.[f];
        if (v != null && v !== "") return v;
      }
    }
  }
  return field === "label" ? key : "";
}

// Workflow filename -> short human-readable name.
// From _workflow_names, use the value "when the key is contained in the filename" - longest key wins (tells REACT-CI from REACT-CICD).
// If nothing matches, return the name with only the .yaml/.yml extension removed.
// A name tagged with the current language wins over a plain one at the same length.
export function workflowDisplayName(prompts, filename, lang = getLanguage()) {
  const base = String(filename).split("/").pop().split("\\").pop(); // strip the path
  let best = null; let bestLen = 0; let bestTagged = false;
  for (const { key, value, lang: l } of prompts?.workflowNames ?? []) {
    if (l && l !== lang) continue;
    if (!base.includes(key)) continue;
    const tagged = Boolean(l);
    if (key.length > bestLen || (key.length === bestLen && tagged && !bestTagged)) { best = value; bestLen = key.length; bestTagged = tagged; }
  }
  if (best != null) return best;
  return base.replace(/\.ya?ml$/, "");
}
