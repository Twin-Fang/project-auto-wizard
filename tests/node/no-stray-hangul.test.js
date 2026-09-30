// Regression gate: English is the default language of this repo.
//
// Hangul may only appear in product content that is intentionally Korean (ko catalogs, translated
// docs, `_ko` fields, past changelog entries, ko-output test literals). Everywhere else it means
// a comment, doc or test name slipped back into Korean. To allow a new legitimate case, add it to
// FILE_ALLOW (whole file) or LINE_ALLOW (matching lines of one file) below with a reason.
import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Hangul syllables, Jamo and compatibility Jamo (written as escapes so this file stays ASCII)
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;

// Whole files (or directories, when the pattern ends with "/") where Korean is expected
const FILE_ALLOW = [
  // Message catalogs and translated documents
  { path: /^src\/i18n\/catalog\/ko\//, why: "ko message catalog" },
  { path: /^(payload|\.github)\/scripts\/messages\.py$/, why: "ko catalog of the installed scripts (and its dogfood copy)" },
  { path: /^README\.ko\.md$/, why: "Korean README translation" },
  { path: /^website\/src\/content\/docs\/ko\//, why: "ko locale of the docs site" },
  // Historical records
  { path: /^CHANGELOG\.(md|json)$/, why: "past release entries" },
  { path: /^\.issue\//, why: "historical work notes" },
  // Test input data
  { path: /^tests\/fixtures\//, why: "fixture input data (e.g. Korean text handling)" },
];

// Tests that intentionally contain Korean literals (ko output assertions or Korean input data)
const TEST_ALLOW = [
  "tests/node/args-validation.test.js",
  "tests/node/branch-empty-remote.test.js",
  "tests/node/breaking-check.test.js",
  "tests/node/copilot-ai-option.test.js",
  "tests/node/deploy-style-types.test.js",
  "tests/node/detect-monorepo-paths.test.js",
  "tests/node/docs-examples.test.js",
  "tests/node/docs-site.test.js",
  "tests/node/doctor.test.js",
  "tests/node/dry-run.test.js",
  "tests/node/env-plan.test.js",
  "tests/node/flutter-app-copy.test.js",
  "tests/node/flutter-full-install.test.js",
  "tests/node/flutter-options-cli.test.js",
  "tests/node/flutter-workflows-payload.test.js",
  "tests/node/i18n-output.test.js",
  "tests/node/i18n.test.js",
  "tests/node/install-settings.test.js",
  "tests/node/install-writable.test.js",
  "tests/node/interactive-branch-picker.test.js",
  "tests/node/interactive-branch-strategy.test.js",
  "tests/node/interactive-flutter.test.js",
  "tests/node/interactive-mode-uninstall.test.js",
  "tests/node/logger-copy.test.js",
  "tests/node/logger-full.test.js",
  "tests/node/logger-lifecycle.test.js",
  "tests/node/logger.test.js",
  "tests/node/paths-resolve.test.js",
  "tests/node/payload-example-values.test.js",
  "tests/node/pr-preview-messages.test.js",
  "tests/node/prompts-flutter.test.js",
  "tests/node/purge-cli.test.js",
  "tests/node/purge-plan.test.js",
  "tests/node/readline-engine-stdin-end.test.js",
  "tests/node/readline-engine-wrap.test.js",
  "tests/node/readme-flutter-docs.test.js",
  "tests/node/readme-remove.test.js",
  "tests/node/readme-translations.test.js",
  "tests/node/release-pipeline.test.js",
  "tests/node/rerun-idempotency.test.js",
  "tests/node/stale-workflows.test.js",
  "tests/node/status-cards-flutter.test.js",
  "tests/node/status.test.js",
  "tests/node/summary-accuracy-cli.test.js",
  "tests/node/summary-output.test.js",
  "tests/node/type-hooks.test.js",
  "tests/node/type-registry-consistency.test.js",
  "tests/node/uninstall-dry-run.test.js",
  "tests/node/uninstall-flow.test.js",
  "tests/node/uninstall-plan.test.js",
  "tests/node/verify.test.js",
  "tests/node/wizard-labels.test.js",
  "tests/py/test_ai_summary.py",
  "tests/py/test_changelog_fallback.py",
  "tests/py/test_changelog_manager.py",
  "tests/py/test_classify_bump.py",
  "tests/py/test_copilot_engine.py",
  "tests/py/test_issue_helper.py",
  "tests/py/test_messages.py",
  "tests/py/test_summary_parser.py",
  "tests/py/test_truncate_release_notes.py",
  "tests/py/test_version_manager.py",
  "tests/py/test_version_sync.py",
];
for (const name of TEST_ALLOW) FILE_ALLOW.push({ path: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), why: "ko output / Korean input literal" });

// Lines of otherwise-English files where Korean is expected
const LINE_ALLOW = [
  { path: /^payload\/config\/(wizard-prompts\.yml|breaking-changes\.json)$/, line: /(^|[\s"])(label|help|example|title|message)_ko\b|_ko"?\s*:/, why: "per-language _ko fields" },
  { path: /^payload\/config\/wizard-prompts\.yml$/, line: /^\s+[A-Z][A-Z0-9-]+: "/, why: "values of the _workflow_names_ko table" },
  { path: /^README(\.zh-CN|\.ja)?\.md$/, line: /\[한국어\]\(README\.ko\.md\)/, why: "language switcher link label" },
  { path: /^website\/astro\.config\.mjs$/, line: /\bko:|translations:/, why: "locale labels and sidebar translations" },
  { path: /^website\/src\/content\/docs\/reference\/version-yml\.md$/, line: /^## (최신 )?버전 :/, why: "Korean heading forms the parser recognizes" },
];

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return out.toString("utf8").split("\0").filter(Boolean);
}

function findStray() {
  const stray = [];
  for (const file of trackedFiles()) {
    if (FILE_ALLOW.some((a) => a.path.test(file))) continue;
    let text;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue; // deleted in the working tree or unreadable
    }
    if (text.includes("\0")) continue; // binary
    const lineRules = LINE_ALLOW.filter((a) => a.path.test(file));
    text.split("\n").forEach((line, i) => {
      if (!HANGUL.test(line)) return;
      if (lineRules.some((a) => a.line.test(line))) return;
      stray.push({ file, no: i + 1, line: line.trim().slice(0, 100) });
    });
  }
  return stray;
}

test("no Hangul outside the allow-list", () => {
  const stray = findStray();
  const shown = stray.slice(0, 30).map((s) => `  ${s.file}:${s.no}  ${s.line}`).join("\n");
  const more = stray.length > 30 ? `\n  ... and ${stray.length - 30} more` : "";
  assert.strictEqual(
    stray.length,
    0,
    `Hangul found outside the allow-list (${stray.length} lines):\n${shown}${more}\n\n` +
      "English is the default language of this repo. Translate the text to English. If the Korean is " +
      "legitimate product content (ko catalog, translated doc, ko output assertion), add its path to " +
      "FILE_ALLOW / TEST_ALLOW, or a line pattern to LINE_ALLOW, in tests/node/no-stray-hangul.test.js.",
  );
});

test("allow-list entries still match something", () => {
  const files = trackedFiles();
  const dead = [...FILE_ALLOW, ...LINE_ALLOW].filter((a) => !files.some((f) => a.path.test(f)));
  assert.deepStrictEqual(
    dead.map((a) => String(a.path)),
    [],
    "These allow-list paths match no tracked file; remove them from tests/node/no-stray-hangul.test.js",
  );
});
