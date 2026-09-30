// tests/node/interactive-flutter.test.js
// Only when the project type includes flutter: ask the env mode, store deploy targets and deploy mode,
// never re-ask when a stored value exists, and infer the initial selection of an existing install from its installed store workflows.
// The stub io approach is the same as interactive-branch-strategy.test.js. Answers are verified through version.yml (persisted)
// and the installed workflow files (store filter).
import "../setup-lang.mjs"; // these tests assert the ko output
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

// envMode/stores/deployMode: (arg) => answer. Default is "press Enter on the question's initial value".
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
    // Run the real printAnalysisCard used on screen — if io.analysisCard were omitted,
    // interactive.js would leak into the summarize() fallback and the real-use path would go unverified.
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
const neverAsked = () => { throw new Error("this question must not be asked"); };

test("new install: asks env mode, stores and deploy mode, and applies the choices to version.yml and the workflow install", async () => {
  const target = flutterProject();
  try {
    const { io, calls } = stubIo({ envMode: () => "dotenv", stores: () => ["android"], deployMode: () => "store_prepare" });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.deepStrictEqual(calls.envMode, [{ initialValue: "dart-define" }], "initial env mode for a new install is dart-define");
    assert.deepStrictEqual(calls.stores, [{ initialValues: ["android", "ios"] }], "initial store selection for a new install is both, same as the CLI default");
    assert.deepStrictEqual(calls.deployMode, [{ platform: "android", initialValue: "store_only" }], "only the chosen platform (android) is asked for a deploy mode");

    const vy = versionYml(target);
    assert.match(vy, /env_mode:\s*"?dotenv"?/);
    assert.match(vy, /flutter_store:\s*"?android"?/);
    assert.match(vy, /android_deploy_mode:\s*"?store_prepare"?/);
    assert.ok(workflowExists(target, PLAYSTORE));
    for (const f of IOS_WORKFLOWS) assert.ok(!workflowExists(target, f), `${f} is deselected so it must not be installed`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("does not re-ask on rerun when a stored value exists (same convention as deploy_style)", async () => {
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

test("existing install without stored values: dotenv as the initial choice, stores inferred from installed workflows (iOS)", async () => {
  const target = flutterProject();
  try {
    // A project installed before this feature — version.yml has no stored options and the iOS store workflow is installed.
    writeFileSync(join(target, "version.yml"), 'version: "1.0.0"\nversion_code: 1\nproject_types: ["flutter"]\n');
    mkdirSync(join(target, WF_DIR), { recursive: true });
    writeFileSync(join(target, WF_DIR, "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"), "# existing install\n");

    const { io, calls } = stubIo();
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.deepStrictEqual(calls.envMode, [{ initialValue: "dotenv" }], "existing installs default to dotenv to preserve behavior");
    assert.deepStrictEqual(calls.stores, [{ initialValues: ["ios"] }], "iOS is initially selected because IOS-TESTFLIGHT is installed");
    assert.deepStrictEqual(calls.deployMode, [{ platform: "ios", initialValue: "store_only" }]);
    assert.match(versionYml(target), /flutter_store:\s*"?ios"?/);
    assert.ok(workflowExists(target, "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"), "the inferred iOS workflow must not be cleaned up");
    assert.ok(!workflowExists(target, PLAYSTORE), "the unselected Android store workflow is not newly installed");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("ESC (cancel) uses defaults: dart-define, both stores same as the CLI default, deploy mode store_only", async () => {
  const target = flutterProject();
  try {
    const { io, calls } = stubIo({ envMode: () => CANCEL, stores: () => CANCEL, deployMode: () => CANCEL });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.deepStrictEqual(calls.deployMode.map((c) => c.platform), ["android", "ios"]);
    const vy = versionYml(target);
    assert.match(vy, /env_mode:\s*"?dart-define"?/);
    assert.match(vy, /flutter_store:\s*"?android,ios"?/);
    assert.match(vy, /android_deploy_mode:\s*"?store_only"?/);
    for (const f of [PLAYSTORE, ...IOS_WORKFLOWS]) assert.ok(workflowExists(target, f), `${f} must be installed`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("choosing store_submit shows a warning note that every main push auto-submits for review", async () => {
  const target = flutterProject();
  try {
    const { io, calls } = stubIo({ stores: () => ["ios"], deployMode: () => "store_submit" });
    await runInteractive({}, { cwd: target, io });
    const warning = calls.notes.find((n) => n.title === "배포 모드");
    assert.ok(warning, "a deploy mode warning note must exist");
    assert.ok(warning.text.includes("main push마다 심사가 자동 제출"));
    assert.match(versionYml(target), /ios_deploy_mode:\s*"?store_submit"?/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("edit: for a Flutter project the env mode and deploy mode items are shown and re-asked with the current value as initial", async () => {
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

    assert.deepStrictEqual(calls.editMenu[0], { showFlutter: true, showOptions: true });
    assert.deepStrictEqual(calls.envMode[1], { initialValue: "dart-define" }, "on edit the initial value is the current value");
    assert.deepStrictEqual(calls.deployMode[1], { platform: "android", initialValue: "store_only" });
    const vy = versionYml(target);
    assert.match(vy, /env_mode:\s*"?dotenv"?/);
    assert.match(vy, /android_deploy_mode:\s*"?store_submit"?/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// Regression guard — the confirm card must show the Flutter choices (env mode, store deploy
// targets, deploy mode). If they only appear in the edit menu and not on the pre-confirm screen, they cannot be re-checked.
test("the confirm card shows the Flutter options (env mode, store deploy targets, deploy mode)", async () => {
  const target = flutterProject();
  try {
    const { io, calls } = stubIo({
      envMode: () => "dotenv",
      stores: () => ["android", "ios"],
      deployMode: (a) => (a.platform === "ios" ? "store_submit" : "store_only"),
    });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.ok(calls.cards.length > 0, "a confirm card (real printAnalysisCard output) must exist");
    const cardText = calls.cards[0];
    assert.match(cardText, /환경변수\s+dotenv/);
    assert.match(cardText, /스토어\s+android, ios/);
    assert.match(cardText, /배포모드\s+android=store_only ios=store_submit/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// Regression guard — if a platform is deselected and reselected while editing flutterStore,
// the deploy mode must be asked again (the old value must not linger).
test("edit: deselecting then reselecting a store asks the deploy mode again", async () => {
  const target = flutterProject();
  try {
    let menuRound = 0;
    let storesCalls = 0;
    const { io, calls } = stubIo({
      stores: () => {
        storesCalls += 1;
        if (storesCalls === 1) return ["android"]; // initial question
        if (storesCalls === 2) return []; // edit — deselect
        return ["android"]; // edit — reselect
      },
      deployMode: () => "store_prepare",
      confirmProjectMenu: async () => (++menuRound === 1 ? "edit" : "continue"),
      editMenu: (round) => ["flutterStore", "flutterStore", "done"][round - 1],
    });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.strictEqual(calls.deployMode.length, 2, "deselect then reselect must ask the deploy mode again");
    assert.match(versionYml(target), /android_deploy_mode:\s*"?store_prepare"?/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("a non-Flutter project gets no Flutter questions and no edit menu items", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-flutter-basic-"));
  try {
    const { io, calls } = stubIo({ envMode: neverAsked, stores: neverAsked, deployMode: neverAsked });
    let menuRound = 0;
    io.confirmProjectMenu = async () => (++menuRound === 1 ? "edit" : "continue");
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.deepStrictEqual(calls.editMenu[0], { showFlutter: false, showOptions: true });
    assert.deepStrictEqual([calls.envMode, calls.stores, calls.deployMode], [[], [], []]);
    assert.ok(calls.cards.length > 0, "a confirm card (real printAnalysisCard output) must exist");
    assert.ok(!calls.cards[0].includes("환경변수"), "without the Flutter type the confirm card must have no Flutter option line");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("adding the flutter type late in the edit loop still asks the options once after the confirm screen", async () => {
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
