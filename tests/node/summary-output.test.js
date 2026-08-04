// tests/node/summary-output.test.js
import { test } from "node:test";
import assert from "node:assert";
import { printSummary } from "../../src/ui/summary.js";

function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  let output = "";
  process.stderr.write = (chunk) => { output += chunk; return true; };
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return output;
}

test("printSummary: full 모드 + gitignoreUpdated:true -> .gitignore 줄 출력", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["basic"], version: "1.0.0", gitignoreUpdated: true });
  });
  assert.ok(output.includes(".gitignore"));
});

test("printSummary: full 모드 + gitignoreUpdated:false(기본값) -> .gitignore 줄 없음", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
  });
  assert.ok(!output.includes(".gitignore"));
});

test("printSummary: version 모드는 .gitignore를 절대 언급하지 않는다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "version", types: ["basic"], version: "1.0.0" });
  });
  assert.ok(!output.includes(".gitignore"));
});

test("printSummary: copiedFiles를 common/타입별로 분류해서 목록과 정확한 개수를 렌더링한다", () => {
  const output = captureStderr(() => {
    printSummary({
      mode: "full", types: ["spring"], version: "1.0.0",
      copiedFiles: ["PROJECT-COMMON-RELEASE-PUBLISH.yaml", "PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml"],
    });
  });
  assert.ok(output.includes("📦 새로 설치됨 (2개):"));
  assert.ok(output.includes("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
  assert.ok(output.includes("PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml"));
});

test("printSummary: copiedFiles가 비어 있으면(전부 skip) '새로 설치됨' 줄 자체를 출력하지 않는다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["spring"], version: "1.0.0", copiedFiles: [] });
  });
  assert.ok(!output.includes("📦 새로 설치됨"));
});

test("printSummary: copiedFiles 미지정 시에도 예외 없이 동작한다(기본값 빈 배열)", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "version", types: ["basic"], version: "1.0.0" });
  });
  assert.ok(!output.includes("📦 새로 설치됨"));
});
