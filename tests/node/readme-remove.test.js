// tests/node/readme-remove.test.js
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addVersionSectionToReadme, hasVersionSection, removeVersionSectionFromReadme } from "../../src/core/copy/readme.js";

test("hasVersionSection: false before add, true after add", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    writeFileSync(join(target, "README.md"), "# Test Project\n");
    assert.strictEqual(hasVersionSection(target), false);
    addVersionSectionToReadme("1.0.0", target);
    assert.strictEqual(hasVersionSection(target), true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeVersionSectionFromReadme: round-trips back to the original content", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    const original = "# Test Project\n\nSome docs.\n";
    writeFileSync(join(target, "README.md"), original);
    addVersionSectionToReadme("1.0.0", target);
    assert.notStrictEqual(readFileSync(join(target, "README.md"), "utf8"), original);

    const status = removeVersionSectionFromReadme(target);
    assert.strictEqual(status, "removed");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), original);
    assert.strictEqual(hasVersionSection(target), false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeVersionSectionFromReadme: no README.md -> skip-no-readme, no-op", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    assert.strictEqual(removeVersionSectionFromReadme(target), "skip-no-readme");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeVersionSectionFromReadme: README.md exists but no marker -> skip-no-marker, content untouched", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    writeFileSync(join(target, "README.md"), "# Plain readme\n");
    const status = removeVersionSectionFromReadme(target);
    assert.strictEqual(status, "skip-no-marker");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), "# Plain readme\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeVersionSectionFromReadme: preserves content the user appended after the auto section", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    const original = "# Test Project\n\nSome docs.\n";
    writeFileSync(join(target, "README.md"), original);
    addVersionSectionToReadme("1.0.0", target);
    // Assume the user appended a license section at the end of the file after install — uninstall must not delete it.
    const userAddition = "\n## License\n\nMIT\n";
    const installed = readFileSync(join(target, "README.md"), "utf8");
    writeFileSync(join(target, "README.md"), installed + userAddition);

    const status = removeVersionSectionFromReadme(target);
    assert.strictEqual(status, "removed");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), original + userAddition);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeVersionSectionFromReadme: CI-inserted standalone marker (no '---' divider) removes only the marker line", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    // Reproduces the real case where PROJECT-COMMON-README-VERSION-UPDATE.yaml inserts only a marker comment line
    // above the user's existing version line, without a '---' separator.
    const content = "# Test Project\n\n<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n## Version : v1.2.0\n\nMore docs.\n";
    writeFileSync(join(target, "README.md"), content);
    assert.strictEqual(hasVersionSection(target), true);

    const status = removeVersionSectionFromReadme(target);
    assert.strictEqual(status, "removed");
    const after = readFileSync(join(target, "README.md"), "utf8");
    assert.strictEqual(after, "# Test Project\n\n## Version : v1.2.0\n\nMore docs.\n");
    assert.strictEqual(hasVersionSection(target), false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeVersionSectionFromReadme: marker block present but tail line missing (edited by user) -> skip-unexpected-format, untouched", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    writeFileSync(join(target, "README.md"), "# Test Project\n");
    addVersionSectionToReadme("1.0.0", target);
    // Assume the user deleted the CHANGELOG link line — if the tail cannot be found, conservatively do nothing.
    const withSection = readFileSync(join(target, "README.md"), "utf8");
    const edited = withSection.replace("[전체 버전 기록 보기](CHANGELOG.md)\n", "");
    writeFileSync(join(target, "README.md"), edited);

    const status = removeVersionSectionFromReadme(target);
    assert.strictEqual(status, "skip-unexpected-format");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), edited);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeVersionSectionFromReadme: tail found far beyond the wizard's block -> skip-unexpected-format, untouched (guards against deleting relocated user content)", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    const original = "# Test Project\n";
    writeFileSync(join(target, "README.md"), original);
    addVersionSectionToReadme("1.0.0", target);
    const withSection = readFileSync(join(target, "README.md"), "utf8");
    // Assume the user deleted the CHANGELOG link line and re-wrote it far later in the document —
    // the user content in between must not be deleted.
    const withoutTail = withSection.replace("[전체 버전 기록 보기](CHANGELOG.md)\n", "");
    const farContent = withoutTail + "x".repeat(400) + "\n[전체 버전 기록 보기](CHANGELOG.md)\n";
    writeFileSync(join(target, "README.md"), farContent);

    const status = removeVersionSectionFromReadme(target);
    assert.strictEqual(status, "skip-unexpected-format");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), farContent);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("addVersionSectionToReadme: a README without a trailing newline does not turn the previous line into a heading", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-noeol-"));
  try {
    writeFileSync(join(target, "README.md"), "# Title\nbody without newline");
    assert.strictEqual(addVersionSectionToReadme("1.0.0", target), "added");
    const body = readFileSync(join(target, "README.md"), "utf8");
    // "body\n---" becomes a Setext heading — a blank line must be kept in between
    assert.ok(body.startsWith("# Title\nbody without newline\n\n---\n"), JSON.stringify(body.slice(0, 60)));
    assert.strictEqual(hasVersionSection(target), true);
    assert.strictEqual(removeVersionSectionFromReadme(target), "removed");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), "# Title\nbody without newline\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("addVersionSectionToReadme: no extra line is added to a README ending in CRLF", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-crlf-"));
  try {
    writeFileSync(join(target, "README.md"), "# Title\r\nbody\r\n");
    addVersionSectionToReadme("1.0.0", target);
    assert.ok(readFileSync(join(target, "README.md"), "utf8").startsWith("# Title\r\nbody\r\n\n---\n"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// A README that already has a version heading without the marker (hand-written or from an older
// install) must not get a second section appended - in the en default format and the ko one.
for (const heading of ["## Latest Version : v1.0.0", "## Current version : v1.0.0", "## recent-version : v1.0.0", "## 최신 버전 : v1.0.0"]) {
  test(`addVersionSectionToReadme: skips when the README already has "${heading}" without a marker`, () => {
    const target = mkdtempSync(join(tmpdir(), "paw-readme-vline-"));
    try {
      const original = `# my-app\n\n${heading}\n`;
      writeFileSync(join(target, "README.md"), original);
      addVersionSectionToReadme("1.0.0", target);
      assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), original);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
}
