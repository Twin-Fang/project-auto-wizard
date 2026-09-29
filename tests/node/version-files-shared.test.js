// 설치 시 버전 감지(detect.js)가 공용 버전 파일 예시를 기대값대로 읽는지 확인한다.
// 같은 예시·기대값을 tests/py/test_version_files_shared.py도 사용해, 한쪽 파싱만 바뀌면 여기서 드러난다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { detectVersionFromFiles, detectBuildNumberFromFiles } from "../../src/core/detect.js";

const ROOT = join(process.cwd(), "tests", "fixtures", "version-files");
const { cases } = JSON.parse(readFileSync(join(ROOT, "expected.json"), "utf8"));

// knownDifference에 이 언어 값이 있으면 그것을 기대값으로 쓴다.
const expectedFor = (c, lang) => ({ ...c, ...(c.knownDifference?.[lang] || {}) });

test("공용 버전 파일: 케이스 폴더와 expected.json 항목이 일치한다", () => {
  const dirs = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.deepStrictEqual(dirs.sort(), Object.keys(cases).sort());
});

for (const [name, c] of Object.entries(cases)) {
  test(`공용 버전 파일(JS): ${name}`, () => {
    const dir = join(ROOT, name);
    const read = (rel) => { try { return readFileSync(join(dir, rel), "utf8"); } catch { return null; } };
    const readJson = (rel) => { const s = read(rel); try { return s ? JSON.parse(s) : null; } catch { return null; } };
    const warned = [];
    // git 태그 폴백은 파일 파싱과 무관하므로 비운다. 폴백 경고가 나오면 "파일에서 못 찾음"(null)이다.
    const detected = detectVersionFromFiles({ read, readJson, gitTag: "", warn: (m) => warned.push(m), types: [c.type] });
    const buildNumber = detectBuildNumberFromFiles({ types: [c.type], read, readJson, warn: () => {} });
    const want = expectedFor(c, "js");
    assert.deepStrictEqual(
      { version: warned.length ? null : detected, buildNumber },
      { version: want.version, buildNumber: want.buildNumber },
    );
  });
}
