// tests/node/readme-remove.test.js
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
    // 설치 후 사용자가 파일 끝에 라이선스 절을 추가했다고 가정 — uninstall이 이 내용을 지우면 안 된다.
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
    // PROJECT-COMMON-README-VERSION-UPDATE.yaml이 사용자가 이미 가진 버전 라인 위에
    // '---' 구분자 없이 마커 주석 한 줄만 끼워넣는 실제 케이스를 재현.
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
    // 사용자가 CHANGELOG 링크 줄을 지웠다고 가정 — 꼬리를 못 찾으면 보수적으로 아무것도 하지 않는다.
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
