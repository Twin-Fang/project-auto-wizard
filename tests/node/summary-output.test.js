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

test("printSummary: gitignoreUpdated가 없으면 .gitignore를 절대 언급하지 않는다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
  });
  assert.ok(!output.includes(".gitignore"));
});

function withStderrTTY(isTTY, fn) {
  const original = process.stderr.isTTY;
  process.stderr.isTTY = isTTY;
  try { return fn(); } finally { process.stderr.isTTY = original; }
}

test("printSummary: TTY + NO_COLOR 미설정 -> ANSI 색상 코드 포함", () => {
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const output = withStderrTTY(true, () => captureStderr(() => {
      printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
    }));
    assert.ok(output.includes("\x1b["));
  } finally {
    if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
  }
});

test("printSummary: NO_COLOR=1이면 TTY여도 ANSI 색상 코드가 전혀 섞이지 않는다", () => {
  const originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const output = withStderrTTY(true, () => captureStderr(() => {
      printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
    }));
    assert.ok(!output.includes("\x1b["));
  } finally {
    if (originalNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = originalNoColor;
  }
});

test("printSummary: 비TTY면 NO_COLOR 미설정이어도 ANSI 색상 코드가 없다", () => {
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const output = withStderrTTY(false, () => captureStderr(() => {
      printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
    }));
    assert.ok(!output.includes("\x1b["));
  } finally {
    if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
  }
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
    printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
  });
  assert.ok(!output.includes("📦 새로 설치됨"));
});

test("printSummary: flutter 타입 + versionCode 지정 시 빌드 번호 줄을 출력한다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["flutter"], version: "1.2.39", versionCode: 71 });
  });
  assert.ok(output.includes("빌드 번호: 71"));
});

test("printSummary: react-native-expo 타입도 빌드 번호 줄을 출력한다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["react-native-expo"], version: "1.0.0", versionCode: 5 });
  });
  assert.ok(output.includes("빌드 번호: 5"));
});

test("printSummary: 빌드 번호 개념이 없는 타입(spring)은 versionCode가 있어도 줄을 출력하지 않는다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["spring"], version: "1.0.0", versionCode: 1 });
  });
  assert.ok(!output.includes("빌드 번호"));
});

test("printSummary: versionCode 미지정 시에도 예외 없이 동작하고 빌드 번호 줄이 없다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["flutter"], version: "1.2.39" });
  });
  assert.ok(!output.includes("빌드 번호"));
});
