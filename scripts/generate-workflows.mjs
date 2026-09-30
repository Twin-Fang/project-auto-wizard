// Fills the shared templates (templates/workflows/*.yaml) with per-type values to produce the payload workflows.
//
//   node scripts/generate-workflows.mjs          # write the generated output to the payload files
//   node scripts/generate-workflows.mjs --check  # compare only, without writing - exit 1 on mismatch
//
// What gets installed into user repos is the generated payload files; the templates and this script are
// not part of the package. So the generated output is always committed, and --check (called by the tests)
// keeps the templates, values and payload from drifting apart.
//
// Template syntax: `%%NAME%%`
//   - A placeholder alone on a line replaces the whole line. The value is an array of lines, and the
//     placeholder's indentation is prepended to each line (except empty ones). An empty array removes
//     the line (for comments that exist only for some types).
//   - A placeholder in the middle of a line is replaced in place with a string value.
//   - A placeholder without a value, or a value that is never used, fails instead of passing silently.
// Like the installer, this uses only built-in node:* modules, with no external dependencies.
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TARGETS } from "../templates/workflows/targets.mjs";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = /%%([A-Z][A-Z0-9_]*)%%/g;
const LINE_TOKEN = /^(\s*)%%([A-Z][A-Z0-9_]*)%%$/;

// Returns the text of one template with its values filled in.
export function render(template, vars, label = "template") {
  const used = new Set();
  const take = (name) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`${label}: placeholder %%${name}%% has no value`);
    used.add(name);
    return vars[name];
  };

  const out = [];
  for (const line of template.split("\n")) {
    const whole = LINE_TOKEN.exec(line);
    if (whole) {
      const value = take(whole[2]);
      if (!Array.isArray(value)) throw new Error(`${label}: %%${whole[2]}%% is a whole-line placeholder and needs an array value`);
      // Do not indent empty lines (avoids trailing whitespace)
      for (const v of value) out.push(v === "" ? v : whole[1] + v);
      continue;
    }
    out.push(
      line.replace(TOKEN, (_, name) => {
        const value = take(name);
        if (typeof value !== "string") throw new Error(`${label}: %%${name}%% is in the middle of a line and needs a string value`);
        return value;
      }),
    );
  }

  const unused = Object.keys(vars).filter((k) => !used.has(k));
  if (unused.length) throw new Error(`${label}: values not used by the template: ${unused.join(", ")}`);
  return out.join("\n");
}

// Compares the expected content of each generation target with the current file.
export function plan(root = DEFAULT_ROOT, targets = TARGETS) {
  return targets.map((t) => {
    const template = readFileSync(join(root, "templates/workflows", t.template), "utf8");
    const expected = render(template, t.vars, t.out);
    const file = join(root, t.out);
    const actual = existsSync(file) ? readFileSync(file, "utf8") : null;
    return { out: t.out, file, expected, ok: actual === expected };
  });
}

function main() {
  const check = process.argv.includes("--check");
  const results = plan();
  const stale = results.filter((r) => !r.ok);

  if (check) {
    for (const r of stale) console.error(`Out of date: ${r.out} - regenerate with npm run generate:workflows`);
    if (stale.length) process.exit(1);
    console.log(`All ${results.length} generation targets match`);
    return;
  }
  for (const r of stale) {
    writeFileSync(r.file, r.expected);
    console.log(`Generated: ${r.out}`);
  }
  if (!stale.length) console.log("No files changed");
}

// Do not run when imported by tests
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
