// Fills the shared fragments (templates/workflows/*.yaml) with per-type values to build the payload workflows.
//
//   node scripts/generate-workflows.mjs          # write the generated output to the payload files
//   node scripts/generate-workflows.mjs --check  # compare only, no writes — exit 1 on drift
//
// What gets installed into user repos is the generated payload files; the fragments and this script are not packaged.
// So the output is always committed, and --check (called by tests) prevents fragments, values and payload from drifting apart.
//
// Fragment syntax: `%%NAME%%`
//   - A placeholder alone on a line replaces the whole line. The value is an array of lines, and the placeholder's indentation is
//     prepended to each line (except blank lines). An empty array removes the line (for comments that exist only for some types).
//   - Mid-line, only that spot is replaced with a string value.
//   - A placeholder without a value, or an unused value, fails loudly instead of passing silently.
// Like the installer, uses only node:* built-ins, no external dependencies.
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TARGETS } from "../templates/workflows/targets.mjs";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = /%%([A-Z][A-Z0-9_]*)%%/g;
const LINE_TOKEN = /^(\s*)%%([A-Z][A-Z0-9_]*)%%$/;

// Returns the text of one fragment filled with values.
export function render(template, vars, label = "template") {
  const used = new Set();
  const take = (name) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`${label}: 값이 없는 자리표시자 %%${name}%%`);
    used.add(name);
    return vars[name];
  };

  const out = [];
  for (const line of template.split("\n")) {
    const whole = LINE_TOKEN.exec(line);
    if (whole) {
      const value = take(whole[2]);
      if (!Array.isArray(value)) throw new Error(`${label}: %%${whole[2]}%%는 줄 전체 자리표시자라 배열 값이 필요하다`);
      // No indentation on blank lines (avoids trailing whitespace)
      for (const v of value) out.push(v === "" ? v : whole[1] + v);
      continue;
    }
    out.push(
      line.replace(TOKEN, (_, name) => {
        const value = take(name);
        if (typeof value !== "string") throw new Error(`${label}: %%${name}%%는 줄 중간에 있어 문자열 값이 필요하다`);
        return value;
      }),
    );
  }

  const unused = Object.keys(vars).filter((k) => !used.has(k));
  if (unused.length) throw new Error(`${label}: 조각에서 쓰지 않는 값 ${unused.join(", ")}`);
  return out.join("\n");
}

// Compares each target's expected content with the current file.
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
    for (const r of stale) console.error(`drift: ${r.out} — regenerate with npm run generate:workflows`);
    if (stale.length) process.exit(1);
    console.log(`all ${results.length} generated targets match`);
    return;
  }
  for (const r of stale) {
    writeFileSync(r.file, r.expected);
    console.log(`generated: ${r.out}`);
  }
  if (!stale.length) console.log("no files changed");
}

// Do not run when imported by tests
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
