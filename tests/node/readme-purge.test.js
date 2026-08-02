// tests/node/readme-purge.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addVersionSectionToReadme, removeVersionSectionFromReadme } from "../../src/core/copy/readme.js";

function withTempReadme(initialContent, fn) {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-purge-"));
  writeFileSync(join(target, "README.md"), initialContent);
  try {
    return fn(target);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
}

test("removeVersionSectionFromReadme: round-trip restores original content", () => {
  withTempReadme("# My Project\n\nSome description.\n", (target) => {
    const original = readFileSync(join(target, "README.md"), "utf8");
    addVersionSectionToReadme("1.2.3", target);
    assert.ok(readFileSync(join(target, "README.md"), "utf8").includes("AUTO-VERSION-SECTION"));
    const result = removeVersionSectionFromReadme(target);
    assert.strictEqual(result, "removed");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), original);
  });
});

test("removeVersionSectionFromReadme: no marker present -> no-op", () => {
  withTempReadme("# My Project\n\nSome description.\n", (target) => {
    const original = readFileSync(join(target, "README.md"), "utf8");
    const result = removeVersionSectionFromReadme(target);
    assert.strictEqual(result, "skip-no-marker");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), original);
  });
});

test("removeVersionSectionFromReadme: no README.md -> no-op", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-purge-"));
  try {
    const result = removeVersionSectionFromReadme(target);
    assert.strictEqual(result, "skip-no-readme");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// H2 (Fable 검토): 릴리스 워크플로우(payload/workflows/common/PROJECT-COMMON-README-VERSION-UPDATE.yaml)는
// README에 이미 사용자가 버전 라인을 써 둔 상태로 마법사가 설치된 경우(addVersionSectionToReadme가
// skip-version-line으로 아무것도 안 씀) 다음 릴리스에서 "---" 프리앰블·CHANGELOG 링크 없이
// 마커 라인만 그 버전 라인 바로 위에 삽입한다. 이 형태에서도 마커+버전라인만 정확히 제거되고
// 그 앞뒤 사용자 콘텐츠는 보존돼야 한다(EOF까지 통째로 자르면 안 됨).
test("removeVersionSectionFromReadme: marker-only shape (no --- preamble, inserted by the release workflow next to a pre-existing user version line) removes only the marker+version lines", () => {
  withTempReadme(
    "# My Project\n\n<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n## Version : v1.0.0\n\nSome other content.\n",
    (target) => {
      const result = removeVersionSectionFromReadme(target);
      assert.strictEqual(result, "removed");
      assert.strictEqual(
        readFileSync(join(target, "README.md"), "utf8"),
        "# My Project\n\n\nSome other content.\n",
      );
    },
  );
});

// M-N1 (Fable 2차 검토): PROJECT-COMMON-README-VERSION-UPDATE.yaml은 버전 라인이 아예 없던 README에
// "## Latest Version : vX.Y.Z (날짜)" 헤더를 마커와 함께 직접 삽입한다. 기존 VERSION_LINE_RE는
// "##" 바로 뒤에 "Latest"가 오는 이 형태를 인식하지 못해 버전 라인을 남긴 채로도 "removed"를
// 거짓 반환하는 문제가 있었다 — 워크플로우의 패턴 목록과 정렬한 넓은 정규식으로 고쳐졌는지 검증한다.
test("removeVersionSectionFromReadme: recognizes a 'Latest Version' header inserted by the release workflow when no version line existed before", () => {
  withTempReadme(
    "# My Project\n\n<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n## Latest Version : v1.0.0 (2025-08-15)\n\nSome other content.\n",
    (target) => {
      const result = removeVersionSectionFromReadme(target);
      assert.strictEqual(result, "removed");
      assert.strictEqual(
        readFileSync(join(target, "README.md"), "utf8"),
        "# My Project\n\n\nSome other content.\n",
      );
    },
  );
});
