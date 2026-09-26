// tests/node/status-cards-flutter.test.js
// 이슈 #131 fable5.1 리뷰 Important #1(fix round 2) 회귀 방지 — 실제 화면에 출력되는
// printAnalysisCard(src/ui/status-cards.js)가 Flutter 옵션(환경변수 방식·스토어 배포 대상·배포
// 모드)을 직접 렌더링하는지 단위로 검증한다. interactive.js의 summarize() fallback이 아니라
// io.analysisCard가 항상 쓰는 이 함수 자체를 대상으로 한다.
import { test } from "node:test";
import assert from "node:assert";
import { printAnalysisCard } from "../../src/ui/status-cards.js";

function render(info) {
  let text = "";
  printAnalysisCard(info, (s) => { text += s; });
  return text;
}

test("printAnalysisCard: showOptional && flutter 타입이면 환경변수·스토어·배포 모드 3줄을 출력한다", () => {
  const text = render({
    mode: "full", modeLabel: "전체 설치", types: ["flutter"], version: "1.0.0", branch: "main",
    includeSecretBackup: false, showOptional: true,
    flutter: { envMode: "dotenv", stores: ["android", "ios"], androidDeployMode: "store_only", iosDeployMode: "store_submit" },
    envModeDefault: "dart-define",
  });
  assert.match(text, /환경변수\s+dotenv/);
  assert.match(text, /스토어\s+android, ios/);
  assert.match(text, /배포모드\s+android=store_only ios=store_submit/);
});

test("printAnalysisCard: flutter.envMode가 미결정(빈 문자열)이면 envModeDefault를 보여준다", () => {
  const text = render({
    types: ["flutter"], version: "1.0.0", branch: "main", showOptional: true,
    flutter: { envMode: "", stores: [], androidDeployMode: "", iosDeployMode: "" },
    envModeDefault: "dart-define",
  });
  assert.match(text, /환경변수\s+dart-define/);
  assert.match(text, /스토어\s+없음/);
  assert.match(text, /배포모드\s+없음/);
});

test("printAnalysisCard: showOptional이 false면 Flutter 옵션 줄이 없다", () => {
  const text = render({
    types: ["flutter"], version: "1.0.0", branch: "main", showOptional: false,
    flutter: { envMode: "dotenv", stores: ["android"], androidDeployMode: "store_only", iosDeployMode: "store_only" },
    envModeDefault: "dart-define",
  });
  assert.ok(!text.includes("환경변수"), "showOptional=false면 Secret과 같이 Flutter 줄도 숨겨야 한다");
});

test("printAnalysisCard: flutter 타입이 아니면 flutter 상태를 넘겨도 옵션 줄이 없다", () => {
  const text = render({
    types: ["node"], version: "1.0.0", branch: "main", showOptional: true,
    flutter: { envMode: "dotenv", stores: ["android"], androidDeployMode: "store_only", iosDeployMode: "store_only" },
    envModeDefault: "dart-define",
  });
  assert.ok(!text.includes("환경변수"), "Flutter 타입이 아니면 옵션 줄이 없어야 한다");
});

test("printAnalysisCard: flutter 상태를 안 넘기면(기존 호출부 호환) 예외 없이 렌더링되고 옵션 줄이 없다", () => {
  const text = render({
    types: ["flutter"], version: "1.0.0", branch: "main", showOptional: true,
  });
  assert.ok(!text.includes("환경변수"));
});
