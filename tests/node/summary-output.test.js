// tests/node/summary-output.test.js
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { printSummary } from "../../src/ui/summary.js";

// Keeps color expectations independent of the runner's TERM (e.g. dumb on CI). TERM=dumb behavior is set directly by the individual test.
delete process.env.TERM;

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

test("printSummary: full mode + gitignoreUpdated:true -> prints the .gitignore line", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["basic"], version: "1.0.0", gitignoreUpdated: true });
  });
  assert.ok(output.includes(".gitignore"));
});

test("printSummary: full mode + gitignoreUpdated:false (default) -> no .gitignore line", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
  });
  assert.ok(!output.includes(".gitignore"));
});

test("printSummary: never mentions .gitignore when gitignoreUpdated is absent", () => {
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

test("printSummary: TTY + NO_COLOR unset -> includes ANSI color codes", () => {
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

test("printSummary: with NO_COLOR=1 no ANSI color codes are mixed in even on a TTY", () => {
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

test("printSummary: on a non-TTY there are no ANSI color codes even if NO_COLOR is unset", () => {
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

test("printSummary: classifies copiedFiles into common/per-type and renders the list with exact counts", () => {
  const output = captureStderr(() => {
    printSummary({
      mode: "full", types: ["spring"], version: "1.0.0",
      copiedFiles: ["PROJECT-COMMON-RELEASE-PUBLISH.yaml", "PROJECT-SPRING-CI.yml"],
    });
  });
  assert.ok(output.includes("📦 새로 설치됨 (2개):"));
  assert.ok(output.includes("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
  assert.ok(output.includes("PROJECT-SPRING-CI.yml"));
});

test("printSummary: auto-updated files are shown separately as 'updated', not 'newly installed'", () => {
  const output = captureStderr(() => {
    printSummary({
      mode: "full", types: ["spring"], version: "1.0.0",
      copiedFiles: ["PROJECT-COMMON-RELEASE-PUBLISH.yaml", "PROJECT-SPRING-CI.yml"],
      autoUpdated: ["PROJECT-COMMON-RELEASE-PUBLISH.yaml"],
    });
  });
  assert.ok(output.includes("📦 새로 설치됨 (1개):"));
  assert.ok(output.includes("🔄 업데이트됨 (1개"));
  const installed = output.slice(output.indexOf("📦 새로 설치됨"), output.indexOf("🔄 업데이트됨"));
  assert.ok(!installed.includes("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
});

test("printSummary: when copiedFiles is empty (everything skipped) the 'newly installed' line is not printed at all", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["spring"], version: "1.0.0", copiedFiles: [] });
  });
  assert.ok(!output.includes("📦 새로 설치됨"));
});

test("printSummary: works without throwing when copiedFiles is not given (default empty array)", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
  });
  assert.ok(!output.includes("📦 새로 설치됨"));
});

test("printSummary: flutter type + versionCode prints the build number line", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["flutter"], version: "1.2.39", versionCode: 71 });
  });
  assert.ok(output.includes("빌드 번호: 71"));
});

test("printSummary: react-native-expo type also prints the build number line", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["react-native-expo"], version: "1.0.0", versionCode: 5 });
  });
  assert.ok(output.includes("빌드 번호: 5"));
});

test("printSummary: a type without a build number concept (spring) prints no line even with versionCode", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["spring"], version: "1.0.0", versionCode: 1 });
  });
  assert.ok(!output.includes("빌드 번호"));
});

test("printSummary: works without throwing when versionCode is not given and has no build number line", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["flutter"], version: "1.2.39" });
  });
  assert.ok(!output.includes("빌드 번호"));
});

test("printSummary: splits Flutter store deploy files into 'newly created' and 'existing kept' and appends the ExportOptions notice", () => {
  const output = captureStderr(() => {
    printSummary({
      mode: "full", types: ["flutter"], version: "1.0.0",
      flutterApp: {
        created: ["ios/fastlane/Fastfile", "ios/ExportOptions.plist"],
        kept: ["android/fastlane/Fastfile.playstore"],
      },
    });
  });
  assert.ok(output.includes("Flutter 스토어 배포 파일"));
  assert.ok(output.includes("ios/fastlane/Fastfile 새로 생성"));
  assert.ok(output.includes("android/fastlane/Fastfile.playstore 기존 파일 유지"));
  assert.ok(output.includes("__TEAM_ID__") && output.includes("__BUNDLE_ID__") && output.includes("__PROVISIONING_PROFILE_NAME__"));
});

test("printSummary: does not print the placeholder notice when ExportOptions.plist was not newly created (already exists)", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["flutter"], version: "1.0.0", flutterApp: { created: [], kept: ["ios/ExportOptions.plist"] } });
  });
  assert.ok(output.includes("ios/ExportOptions.plist 기존 파일 유지"));
  assert.ok(!output.includes("__TEAM_ID__"));
});

test("printSummary: shows the cleanup result (deleted/.bak backup) of deselected store deploy workflows", () => {
  const output = captureStderr(() => {
    printSummary({
      mode: "full", types: ["flutter"], version: "1.0.0",
      storeCleanup: {
        removed: ["PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"],
        backedUp: ["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"],
      },
    });
  });
  assert.ok(output.includes("선택 해제한 스토어 배포 정리"));
  assert.ok(output.includes("PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml 삭제 (손대지 않은 파일)"));
  assert.ok(output.includes("PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml → PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml.bak"));
});

test("printSummary: does not print the block when flutterApp/storeCleanup is absent or empty", () => {
  const output = captureStderr(() => {
    printSummary({
      mode: "full", types: ["flutter"], version: "1.0.0",
      flutterApp: { created: [], kept: [] }, storeCleanup: { removed: [], backedUp: [] },
    });
  });
  assert.ok(!output.includes("Flutter 스토어 배포 파일"));
  assert.ok(!output.includes("스토어 배포 정리"));
});

test("printSummary: deploy-method change cleanup output stays unchanged", () => {
  const output = captureStderr(() => {
    printSummary({
      mode: "full", types: ["spring"], version: "1.0.0",
      cleanup: { removed: ["PROJECT-SPRING-SIMPLE-CICD.yaml"], backedUp: [] },
    });
  });
  assert.ok(output.includes("이전 배포 방식 정리"));
  assert.ok(output.includes("PROJECT-SPRING-SIMPLE-CICD.yaml 삭제 (손대지 않은 파일)"));
});
