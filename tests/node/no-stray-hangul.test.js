// Regression gate: English is the default language of this repo.
//
// Hangul may only appear in product content that is intentionally Korean (ko catalogs, translated
// docs, `_ko` fields, past changelog entries, fixtures) and, inside test files, in string or regex
// literals that check ko output or feed Korean input. Comments, code and test/describe names must
// be English. To allow a new legitimate case, add it to FILE_ALLOW (whole file) or LINE_ALLOW
// (matching lines of one file) below with a reason. This file itself must stay ASCII (use \uXXXX).
import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Hangul syllables, Jamo and compatibility Jamo
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/;

// Whole files (or directories) where Korean is expected; each must still contain Hangul
const FILE_ALLOW = [
  { path: /^src\/i18n\/catalog\/ko\//, why: "ko message catalog" },
  { path: /^(payload|\.github)\/scripts\/messages\.py$/, why: "ko catalog of the installed scripts (and its dogfood copy)" },
  { path: /^README\.ko\.md$/, why: "Korean README translation" },
  { path: /^website\/src\/content\/docs\/ko\//, why: "ko locale of the docs site" },
  { path: /^CHANGELOG\.(md|json)$/, why: "past release entries" },
  { path: /^\.issue\//, why: "historical work notes" },
  { path: /^tests\/fixtures\//, why: "fixture input data (e.g. Korean text handling)" },
];

// Lines of otherwise-English files where Korean is expected; each rule must allow >= 1 line
const LINE_ALLOW = [
  { path: /^payload\/config\/(wizard-prompts\.yml|breaking-changes\.json)$/, line: /(^|[\s"])(label|help|example|title|message)_ko\b|_ko"?\s*:/, why: "per-language _ko fields" },
  { path: /^payload\/config\/wizard-prompts\.yml$/, line: /^\s+[A-Z][A-Z0-9-]+: "/, why: "values of the _workflow_names_ko table" },
  { path: /^README(\.zh-CN|\.ja)?\.md$/, line: /\[\ud55c\uad6d\uc5b4\]\(README\.ko\.md\)/, why: "language switcher link label" },
  { path: /^website\/astro\.config\.mjs$/, line: /\bko:|translations:/, why: "locale labels and sidebar translations" },
  { path: /^website\/src\/content\/docs\/reference\/version-yml\.md$/, line: /^## (\ucd5c\uc2e0 )?\ubc84\uc804 :/, why: "Korean heading forms the parser recognizes" },
];

const TEST_FILE = /^tests\/(node|py)\/.+\.(js|mjs|py)$/;

// Test/describe titles are documentation, so Korean there is flagged even though it is a string
const TITLE_CALL = /\b(test|describe|it|suite)(\.\w+)?\(\s*$/;

// Returns, per line, the text that remains after blanking string, template and regex literals.
// Comments and code are kept; a literal used as a test/describe title is kept too (flagged).
function stripLiterals(text, py) {
  const out = [];
  let cur = "";
  let i = 0;
  let prevSig = ""; // last significant code char (decides regex vs division in JS)
  let prevWord = "";
  const n = text.length;
  const push = (ch) => {
    if (ch === "\n") { out.push(cur); cur = ""; } else cur += ch;
  };
  const readLiteral = (quote, triple, keep) => {
    // consumes up to and including the closing quote; emits text only when keep is true
    const q = triple ? quote.repeat(3) : quote;
    i += q.length;
    while (i < n) {
      if (text[i] === "\\") { if (keep) { push(text[i]); if (i + 1 < n) push(text[i + 1]); } i += 2; continue; }
      if (text.startsWith(q, i)) { i += q.length; return; }
      if (quote === "`" && text[i] === "$" && text[i + 1] === "{") {
        // template expression: copy as code until the matching brace
        let depth = 0;
        while (i < n) {
          const ch = text[i];
          if (ch === '"' || ch === "'") {
            // string inside the expression: skip its content
            push(ch); i++;
            while (i < n && text[i] !== ch) i += text[i] === "\\" ? 2 : 1;
            push(ch); i++;
            continue;
          }
          push(ch);
          if (ch === "{") depth++;
          if (ch === "}" && --depth === 0) { i++; break; }
          i++;
        }
        continue;
      }
      if (!triple && quote !== "`" && text[i] === "\n") return; // unterminated, bail out
      if (text[i] === "\n") push("\n");
      else if (keep) push(text[i]);
      i++;
    }
  };
  while (i < n) {
    const c = text[i];
    if (py ? c === "#" : (c === "/" && text[i + 1] === "/")) {
      while (i < n && text[i] !== "\n") push(text[i++]);
      continue;
    }
    if (!py && c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      while (i < stop) push(text[i++]);
      continue;
    }
    if (c === '"' || c === "'" || (!py && c === "`")) {
      const triple = py && text.startsWith(c.repeat(3), i);
      const keep = !py && TITLE_CALL.test(cur);
      readLiteral(c, triple, keep);
      prevSig = "x";
      continue;
    }
    if (!py && c === "/" && (prevSig === "" || "(,=:[!&|?{};>".includes(prevSig) || prevWord === "return")) {
      // regex literal
      i++;
      let inClass = false;
      while (i < n && text[i] !== "\n") {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === "[") inClass = true;
        else if (text[i] === "]") inClass = false;
        else if (text[i] === "/" && !inClass) { i++; break; }
        i++;
      }
      while (i < n && /[a-z]/.test(text[i])) i++;
      prevSig = "x";
      prevWord = "";
      continue;
    }
    if (/\s/.test(c)) { push(c); i++; continue; }
    if (/[A-Za-z_$]/.test(c)) {
      let w = "";
      while (i < n && /[\w$]/.test(text[i])) { w += text[i]; push(text[i++]); }
      prevWord = w;
      prevSig = "x";
      continue;
    }
    prevWord = "";
    prevSig = c;
    push(c);
    i++;
  }
  out.push(cur);
  return out;
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return out.toString("utf8").split("\0").filter(Boolean);
}

function read(file) {
  try {
    const text = readFileSync(join(ROOT, file), "utf8");
    return text.includes("\0") ? null : text; // null: binary
  } catch {
    return null; // deleted in the working tree or unreadable
  }
}

function scan() {
  const stray = [];
  const usedFile = new Set();
  const usedLine = new Map(LINE_ALLOW.map((a) => [a, 0]));
  for (const file of trackedFiles()) {
    const text = read(file);
    if (text === null || !HANGUL.test(text)) continue;
    const fileRule = FILE_ALLOW.find((a) => a.path.test(file));
    if (fileRule) { usedFile.add(fileRule); continue; }
    const lines = text.split("\n");
    const lineRules = LINE_ALLOW.filter((a) => a.path.test(file));
    // Tests may keep Hangul inside string/regex literals (ko output, Korean input data)
    const checked = TEST_FILE.test(file) ? stripLiterals(text, file.endsWith(".py")) : lines;
    lines.forEach((raw, idx) => {
      if (!HANGUL.test(raw)) return;
      const rule = lineRules.find((a) => a.line.test(raw));
      if (rule) { usedLine.set(rule, usedLine.get(rule) + 1); return; }
      if (TEST_FILE.test(file) && !HANGUL.test(checked[idx] ?? "")) return;
      stray.push({ file, no: idx + 1, line: raw.trim().slice(0, 100) });
    });
  }
  return { stray, usedFile, usedLine };
}

test("no Hangul outside the allow-list", () => {
  const { stray } = scan();
  const shown = stray.slice(0, 30).map((s) => `  ${s.file}:${s.no}  ${s.line}`).join("\n");
  const more = stray.length > 30 ? `\n  ... and ${stray.length - 30} more` : "";
  assert.strictEqual(
    stray.length,
    0,
    `Hangul found outside the allow-list (${stray.length} lines):\n${shown}${more}\n\n` +
      "English is the default language of this repo. Translate comments, docs and test names to " +
      "English. Korean is fine only in string/regex literals of tests that check ko output or feed " +
      "Korean input. For other legitimate product content (ko catalog, translated doc), add the path " +
      "to FILE_ALLOW, or a line pattern to LINE_ALLOW, in tests/node/no-stray-hangul.test.js.",
  );
});

test("every allow-list entry is still needed", () => {
  const { usedFile, usedLine } = scan();
  const unusedFiles = FILE_ALLOW.filter((a) => !usedFile.has(a)).map((a) => `FILE_ALLOW ${a.path}`);
  const unusedLines = LINE_ALLOW.filter((a) => usedLine.get(a) === 0).map((a) => `LINE_ALLOW ${a.path} ${a.line}`);
  assert.deepStrictEqual(
    [...unusedFiles, ...unusedLines],
    [],
    "These allow-list entries cover no Hangul anymore; remove them from tests/node/no-stray-hangul.test.js",
  );
});

test("the scanner flags comments and titles but not literals", () => {
  const H = "\ud55c";
  const js = stripLiterals(
    [`const a = "${H}"; // ${H}`, `const r = /${H}+/u.test(x);`, `test("${H}", () => {});`, "const t = `", `${H}`, "`;"].join("\n"),
    false,
  );
  assert.deepStrictEqual(js.map((l) => HANGUL.test(l)), [true, false, true, false, false, false]);
  const py = stripLiterals([`x = "${H}"`, `y = 1  # ${H}`, `z = """`, `${H}`, `"""`].join("\n"), true);
  assert.deepStrictEqual(py.map((l) => HANGUL.test(l)), [false, true, false, false, false]);
  assert.ok(!/[^\x00-\x7f]/.test(readFileSync(fileURLToPath(import.meta.url), "utf8")), "this file must stay ASCII");
});
