// tests/node/status-cards-flutter.test.js
// Regression guard: verifies at unit level that
// printAnalysisCard (src/ui/status-cards.js), which is what actually renders on screen, renders the Flutter options (env mode, store deploy targets, deploy
// mode) directly. The target is not the summarize() fallback in interactive.js but
// this function itself, which io.analysisCard always uses.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { printAnalysisCard } from "../../src/ui/status-cards.js";

function render(info) {
  let text = "";
  printAnalysisCard(info, (s) => { text += s; });
  return text;
}

test("printAnalysisCard: showOptional and flutter type print the env, store, and deploy mode lines", () => {
  const text = render({
    mode: "full", modeLabel: "전체 설치", types: ["flutter"], version: "1.0.0", branch: "main",
    showOptional: true,
    flutter: { envMode: "dotenv", stores: ["android", "ios"], androidDeployMode: "store_only", iosDeployMode: "store_submit" },
    envModeDefault: "dart-define",
  });
  assert.match(text, /환경변수\s+dotenv/);
  assert.match(text, /스토어\s+android, ios/);
  assert.match(text, /배포모드\s+android=store_only ios=store_submit/);
});

test("printAnalysisCard: shows envModeDefault when flutter.envMode is undecided (empty string)", () => {
  const text = render({
    types: ["flutter"], version: "1.0.0", branch: "main", showOptional: true,
    flutter: { envMode: "", stores: [], androidDeployMode: "", iosDeployMode: "" },
    envModeDefault: "dart-define",
  });
  assert.match(text, /환경변수\s+dart-define/);
  assert.match(text, /스토어\s+없음/);
  assert.match(text, /배포모드\s+없음/);
});

test("printAnalysisCard: no Flutter option lines when showOptional is false", () => {
  const text = render({
    types: ["flutter"], version: "1.0.0", branch: "main", showOptional: false,
    flutter: { envMode: "dotenv", stores: ["android"], androidDeployMode: "store_only", iosDeployMode: "store_only" },
    envModeDefault: "dart-define",
  });
  assert.ok(!text.includes("환경변수"), "Flutter lines must be hidden when showOptional=false");
});

test("printAnalysisCard: no option lines for non-flutter types even when flutter state is passed", () => {
  const text = render({
    types: ["node"], version: "1.0.0", branch: "main", showOptional: true,
    flutter: { envMode: "dotenv", stores: ["android"], androidDeployMode: "store_only", iosDeployMode: "store_only" },
    envModeDefault: "dart-define",
  });
  assert.ok(!text.includes("환경변수"), "no option lines for non-Flutter types");
});

test("printAnalysisCard: without flutter state (legacy caller compatibility) it renders without exceptions and has no option lines", () => {
  const text = render({
    types: ["flutter"], version: "1.0.0", branch: "main", showOptional: true,
  });
  assert.ok(!text.includes("환경변수"));
});
