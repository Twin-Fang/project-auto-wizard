// tests/node/interactive-flutter.test.js
// 이슈 #131 — 프로젝트 타입에 flutter가 있을 때만 환경변수 방식·스토어 배포 대상·배포 모드를 묻고,
// 저장값이 있으면 재질문하지 않으며, 기존 설치는 설치된 스토어 워크플로우로 초기 선택을 추론한다.
// 스텁 io 방식은 interactive-branch-strategy.test.js와 같다. 답변은 version.yml(저장)과
// 설치된 워크플로우 파일(스토어 필터)로 검증한다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInteractive } from "../../src/commands/interactive.js";
import { printAnalysisCard } from "../../src/ui/status-cards.js";

const CANCEL = Symbol("cancel");
const WF_DIR = ".github/workflows";
const PLAYSTORE = "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml";
const IOS_WORKFLOWS = ["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml", "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"];

const initialOf = (arg) => arg.initialValue;
const initialsOf = (arg) => arg.initialValues;

// envMode/stores/deployMode: (arg) => 답변. 기본은 "질문의 초기값 그대로 Enter".
function stubIo({ envMode = initialOf, stores = initialsOf, deployMode = initialOf, confirmProjectMenu, editMenu, selectTypes } = {}) {
  const calls = { envMode: [], stores: [], deployMode: [], editMenu: [], notes: [], cards: [] };
  const io = {
    selectMode: async () => "full",
    confirmProjectMenu: confirmProjectMenu ?? (async () => "continue"),
    confirmTypes: async ({ types }) => types,
    selectDeployStyle: async () => "simple",
    selectBranchStrategy: async () => "pr-flow",
    askYesNo: async (_message, def) => def,
    askText: async (_message, def) => def,
    note: (text, title) => calls.notes.push({ text, title }),
    cancelMessage: () => {},
    summary: () => {},
    outro: () => {},
    // 실제 화면에 쓰이는 printAnalysisCard를 그대로 통과시킨다 — io.analysisCard를 빼먹으면
    // interactive.js가 summarize() fallback으로 새어나가 실사용 경로를 검증하지 못한다(fable5.1 fix round 2).
    analysisCard: (info) => {
      let text = "";
      printAnalysisCard(info, (s) => { text += s; });
      calls.cards.push(text);
    },
    editMenu: async (arg) => { calls.editMenu.push(arg); return editMenu ? editMenu(calls.editMenu.length) : "done"; },
    selectTypes,
    selectEnvMode: async (arg) => { calls.envMode.push(arg); return envMode(arg); },
    selectFlutterStores: async (arg) => { calls.stores.push(arg); return stores(arg); },
    selectDeployMode: async (arg) => { calls.deployMode.push(arg); return deployMode(arg); },
  };
  return { io, calls };
}

function flutterProject() {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-flutter-"));
  writeFileSync(join(target, "pubspec.yaml"), "name: sample_app\nversion: 1.0.0+1\n");
  return target;
}

const versionYml = (target) => readFileSync(join(target, "version.yml"), "utf8");
const workflowExists = (target, name) => existsSync(join(target, WF_DIR, name));
const neverAsked = () => { throw new Error("이 질문은 나오면 안 된다"); };

test("신규 설치: 환경변수 방식·스토어·배포 모드를 묻고 선택을 version.yml과 워크플로우 설치에 반영한다", async () => {
  const target = flutterProject();
  try {
    const { io, calls } = stubIo({ envMode: () => "dotenv", stores: () => ["android"], deployMode: () => "store_prepare" });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.deepStrictEqual(calls.envMode, [{ initialValue: "dart-define" }], "신규 설치의 환경변수 초기 선택은 dart-define");
    assert.deepStrictEqual(calls.stores, [{ initialValues: [] }], "신규 설치의 스토어 초기 선택은 없음");
    assert.deepStrictEqual(calls.deployMode, [{ platform: "android", initialValue: "store_only" }], "고른 플랫폼(android)만 배포 모드를 묻는다");

    const vy = versionYml(target);
    assert.match(vy, /env_mode:\s*"?dotenv"?/);
    assert.match(vy, /flutter_store:\s*"?android"?/);
    assert.match(vy, /android_deploy_mode:\s*"?store_prepare"?/);
    assert.ok(workflowExists(target, PLAYSTORE));
    for (const f of IOS_WORKFLOWS) assert.ok(!workflowExists(target, f), `${f}는 선택 해제라 설치되지 않아야 한다`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("저장값이 있으면 다시 실행해도 재질문하지 않는다 (deploy_style과 같은 규약)", async () => {
  const target = flutterProject();
  try {
    const first = stubIo({ envMode: () => "dotenv", stores: () => ["android", "ios"], deployMode: (a) => (a.platform === "ios" ? "store_submit" : "store_only") });
    await runInteractive({}, { cwd: target, io: first.io });

    const second = stubIo({ envMode: neverAsked, stores: neverAsked, deployMode: neverAsked });
    assert.strictEqual(await runInteractive({}, { cwd: target, io: second.io }), 0);
    assert.deepStrictEqual([second.calls.envMode, second.calls.stores, second.calls.deployMode], [[], [], []]);

    const vy = versionYml(target);
    assert.match(vy, /env_mode:\s*"?dotenv"?/);
    assert.match(vy, /flutter_store:\s*"?android,ios"?/);
    assert.match(vy, /ios_deploy_mode:\s*"?store_submit"?/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("저장값 없는 기존 설치: dotenv를 초기 선택으로, 스토어는 설치된 워크플로우(iOS)로 추론한다", async () => {
  const target = flutterProject();
  try {
    // 이 기능 이전에 설치된 프로젝트 — version.yml에 옵션 저장값이 없고 iOS 스토어 워크플로우가 깔려 있다.
    writeFileSync(join(target, "version.yml"), 'version: "1.0.0"\nversion_code: 1\nproject_types: ["flutter"]\n');
    mkdirSync(join(target, WF_DIR), { recursive: true });
    writeFileSync(join(target, WF_DIR, "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"), "# 기존 설치본\n");

    const { io, calls } = stubIo();
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.deepStrictEqual(calls.envMode, [{ initialValue: "dotenv" }], "기존 설치는 동작 보존을 위해 dotenv가 초기 선택");
    assert.deepStrictEqual(calls.stores, [{ initialValues: ["ios"] }], "설치된 IOS-TESTFLIGHT로 iOS를 초기 선택");
    assert.deepStrictEqual(calls.deployMode, [{ platform: "ios", initialValue: "store_only" }]);
    assert.match(versionYml(target), /flutter_store:\s*"?ios"?/);
    assert.ok(workflowExists(target, "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"), "추론된 iOS 워크플로우가 정리되면 안 된다");
    assert.ok(!workflowExists(target, PLAYSTORE), "선택하지 않은 Android 스토어 워크플로우는 새로 설치되지 않는다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("ESC(취소)는 기본값: dart-define, 스토어 없음(none), 배포 모드는 묻지 않는다", async () => {
  const target = flutterProject();
  try {
    const { io, calls } = stubIo({ envMode: () => CANCEL, stores: () => CANCEL, deployMode: neverAsked });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.deepStrictEqual(calls.deployMode, []);
    const vy = versionYml(target);
    assert.match(vy, /env_mode:\s*"?dart-define"?/);
    assert.match(vy, /flutter_store:\s*"?none"?/);
    for (const f of [PLAYSTORE, ...IOS_WORKFLOWS]) assert.ok(!workflowExists(target, f), `${f}는 설치되지 않아야 한다`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("store_submit을 고르면 main push마다 심사가 자동 제출된다는 경고 note가 나온다", async () => {
  const target = flutterProject();
  try {
    const { io, calls } = stubIo({ stores: () => ["ios"], deployMode: () => "store_submit" });
    await runInteractive({}, { cwd: target, io });
    const warning = calls.notes.find((n) => n.title === "배포 모드");
    assert.ok(warning, "배포 모드 경고 note가 있어야 한다");
    assert.ok(warning.text.includes("main push마다 심사가 자동 제출"));
    assert.match(versionYml(target), /ios_deploy_mode:\s*"?store_submit"?/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("수정하기: Flutter 프로젝트면 환경변수 방식·배포 모드 항목이 노출되고 현재값을 초기값으로 다시 묻는다", async () => {
  const target = flutterProject();
  try {
    let menuRound = 0;
    let envCalls = 0;
    let modeCalls = 0;
    const { io, calls } = stubIo({
      envMode: (arg) => (++envCalls === 1 ? arg.initialValue : "dotenv"),
      stores: () => ["android"],
      deployMode: (arg) => (++modeCalls === 1 ? arg.initialValue : "store_submit"),
      confirmProjectMenu: async () => (++menuRound === 1 ? "edit" : "continue"),
      editMenu: (round) => ["envMode", "deployMode", "done"][round - 1],
    });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.deepStrictEqual(calls.editMenu[0], { showOptional: true, showFlutter: true });
    assert.deepStrictEqual(calls.envMode[1], { initialValue: "dart-define" }, "수정 시 초기값은 현재값");
    assert.deepStrictEqual(calls.deployMode[1], { platform: "android", initialValue: "store_only" });
    const vy = versionYml(target);
    assert.match(vy, /env_mode:\s*"?dotenv"?/);
    assert.match(vy, /android_deploy_mode:\s*"?store_submit"?/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// fable5.1 리뷰 Important #1 회귀 방지 — 확인 카드에 Flutter 선택값(환경변수 방식·스토어 배포
// 대상·배포 모드)이 보여야 한다. 수정 메뉴에서만 보이고 확정 직전 화면에 없으면 재확인이 안 된다.
test("확인 카드에 Flutter 옵션(환경변수 방식·스토어 배포 대상·배포 모드)이 표시된다", async () => {
  const target = flutterProject();
  try {
    const { io, calls } = stubIo({
      envMode: () => "dotenv",
      stores: () => ["android", "ios"],
      deployMode: (a) => (a.platform === "ios" ? "store_submit" : "store_only"),
    });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.ok(calls.cards.length > 0, "확인 카드(printAnalysisCard 실제 출력)가 있어야 한다");
    const cardText = calls.cards[0];
    assert.match(cardText, /환경변수\s+dotenv/);
    assert.match(cardText, /스토어\s+android, ios/);
    assert.match(cardText, /배포모드\s+android=store_only ios=store_submit/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// fable5.1 리뷰 Important #2 회귀 방지 — flutterStore 수정에서 플랫폼을 해제했다가 다시 선택하면
// 배포 모드를 다시 물어야 한다(옛 값이 남아있으면 안 된다).
test("수정하기: 스토어 해제 후 재선택하면 배포 모드를 다시 묻는다", async () => {
  const target = flutterProject();
  try {
    let menuRound = 0;
    let storesCalls = 0;
    const { io, calls } = stubIo({
      stores: () => {
        storesCalls += 1;
        if (storesCalls === 1) return ["android"]; // 초기 질문
        if (storesCalls === 2) return []; // 수정 — 해제
        return ["android"]; // 수정 — 재선택
      },
      deployMode: () => "store_prepare",
      confirmProjectMenu: async () => (++menuRound === 1 ? "edit" : "continue"),
      editMenu: (round) => ["flutterStore", "flutterStore", "done"][round - 1],
    });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.strictEqual(calls.deployMode.length, 2, "해제→재선택이면 배포 모드를 다시 물어야 한다");
    assert.match(versionYml(target), /android_deploy_mode:\s*"?store_prepare"?/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("Flutter가 아닌 프로젝트는 Flutter 질문이 전혀 나오지 않고 수정 메뉴에도 항목이 없다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-flutter-basic-"));
  try {
    const { io, calls } = stubIo({ envMode: neverAsked, stores: neverAsked, deployMode: neverAsked });
    let menuRound = 0;
    io.confirmProjectMenu = async () => (++menuRound === 1 ? "edit" : "continue");
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.deepStrictEqual(calls.editMenu[0], { showOptional: true, showFlutter: false });
    assert.deepStrictEqual([calls.envMode, calls.stores, calls.deployMode], [[], [], []]);
    assert.ok(calls.cards.length > 0, "확인 카드(printAnalysisCard 실제 출력)가 있어야 한다");
    assert.ok(!calls.cards[0].includes("환경변수"), "Flutter 타입이 아니면 확인 카드에 Flutter 옵션 줄이 없어야 한다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("편집 루프에서 뒤늦게 flutter 타입을 추가해도 확인 화면 이후 옵션을 한 번 묻는다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-flutter-late-"));
  try {
    writeFileSync(join(target, "package.json"), JSON.stringify({ name: "sample-app", version: "1.0.0" }));
    let menuRound = 0;
    const { io, calls } = stubIo({
      confirmProjectMenu: async () => (++menuRound === 1 ? "edit" : "continue"),
      editMenu: (round) => (round === 1 ? "type" : "done"),
      selectTypes: async () => {
        writeFileSync(join(target, "pubspec.yaml"), "name: sample_app\nversion: 1.0.0+1\n");
        return ["flutter"];
      },
    });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.strictEqual(calls.envMode.length, 1);
    assert.strictEqual(calls.stores.length, 1);
    assert.match(versionYml(target), /env_mode:\s*"?dart-define"?/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
