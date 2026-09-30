import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setLanguage } from "../../src/i18n/index.js";
import { runDoctor, printDoctorReport, DOC, DOCS_SITE_URL } from "../../src/commands/doctor.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// Capture printDoctorReport through the injected out (colors off, so string assertions are safe from ESC bytes).
function render(results, { color = false } = {}) {
  let output = "";
  printDoctorReport(results, { out: (s) => { output = s; }, color });
  return output;
}

const ALL_OK_EXEC = [
  ["gh --version", { status: 0, stdout: "gh version 2.96.0", stderr: "" }],
  ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
  ["git -C", { status: 0, stdout: "https://github.com/acme/widgets.git\n", stderr: "" }],
  ["actions/permissions/workflow", { status: 0, stdout: "write", stderr: "" }],
  ["secret list", { status: 0, stdout: "WORKFLOW_PAT\tUpdated 2026-01-01\n", stderr: "" }],
  [".allow_merge_commit", { status: 0, stdout: "true", stderr: "" }],
];

function fakeExec(map) {
  return (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    for (const [pattern, result] of map) {
      if (key.includes(pattern)) return result;
    }
    return { status: 1, stdout: "", stderr: "unmocked command: " + key, error: null };
  };
}

test("runDoctor: gh CLI missing -> WARN and stops early", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 1, stdout: "", stderr: "", error: new Error("not found") }],
    ]);
    const results = runDoctor(dir, { exec });
    const ghCheck = results.find((r) => r.name === "gh CLI");
    assert.strictEqual(ghCheck.status, "WARN");
    assert.ok(!results.some((r) => r.name === "gh 인증"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: gh not authenticated -> FAIL and stops before remote checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 1, stdout: "", stderr: "not logged in" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "gh 인증").status, "FAIL");
    assert.ok(!results.some((r) => r.name === "GitHub 원격"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: all checks OK", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  writeFileSync(join(dir, "version.yml"), "version: \"1.0.0\"\n");
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 0, stdout: "https://github.com/acme/widgets.git\n", stderr: "" }],
      ["actions/permissions/workflow", { status: 0, stdout: "write", stderr: "" }],
      ["secret list", { status: 0, stdout: "WORKFLOW_PAT\tUpdated 2026-01-01\n", stderr: "" }],
      [".allow_merge_commit", { status: 0, stdout: "true", stderr: "" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "설치 여부").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "Workflow permissions").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "WORKFLOW_PAT secret").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "automerge 호환성(merge commit 허용)").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "Copilot AI 요약").status, "INFO");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: missing WORKFLOW_PAT -> INFO (fallback auto-recovers), non-write permissions -> INFO, merge commit disabled -> WARN", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 0, stdout: "git@github.com:acme/widgets.git\n", stderr: "" }],
      ["actions/permissions/workflow", { status: 0, stdout: "read", stderr: "" }],
      ["secret list", { status: 0, stdout: "AI_API_KEY\tUpdated 2026-01-01\n", stderr: "" }],
      [".allow_merge_commit", { status: 0, stdout: "false", stderr: "" }],
    ]);
    const results = runDoctor(dir, { exec });
    // Workflow permissions is INFO even when read, since no action is needed.
    assert.strictEqual(results.find((r) => r.name === "Workflow permissions").status, "INFO");
    // A missing WORKFLOW_PAT is also auto-recovered by the fallback, so no action is needed: INFO.
    const pat = results.find((r) => r.name === "WORKFLOW_PAT secret");
    assert.strictEqual(pat.status, "INFO");
    assert.ok(pat.note?.some((l) => l.includes("bot") || l.includes("machine")), "missing bot/machine account recommendation");
    assert.strictEqual(pat.doc, undefined, "INFO items carry no doc link");
    assert.strictEqual(results.find((r) => r.name === "automerge 호환성(merge commit 허용)").status, "WARN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: no git remote -> WARN and stops before repo-scoped checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 1, stdout: "", stderr: "fatal: no such remote" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "GitHub 원격").status, "WARN");
    assert.ok(!results.some((r) => r.name === "Workflow permissions"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Output redesign regression guards --------------------------------------------------

// Running doctor "before" installing is the normal path, so not-installed must not surface as a warning.
test("runDoctor: not installed is INFO, not a warning", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const results = runDoctor(dir, { exec: fakeExec(ALL_OK_EXEC) });
    assert.strictEqual(results.find((r) => r.name === "설치 여부").status, "INFO");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A name alone does not tell what a setting is for; that was the core complaint.
test("runDoctor: every item has a purpose", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const results = runDoctor(dir, { exec: fakeExec(ALL_OK_EXEC) });
    for (const r of results) {
      assert.ok(r.purpose && r.purpose.length > 0, `${r.name} has no purpose`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Problem items must come with action steps and a doc link (resolution guide link).
test("runDoctor: problem items provide impact, actions, and a doc link together", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ...ALL_OK_EXEC.filter(([k]) => !k.includes("actions/permissions/workflow") && !k.includes(".allow_merge_commit")),
      ["actions/permissions/workflow", { status: 1, stdout: "", stderr: "not found" }],
      [".allow_merge_commit", { status: 0, stdout: "false", stderr: "" }],
    ]);
    const problems = runDoctor(dir, { exec }).filter((r) => r.status === "WARN" || r.status === "FAIL");
    assert.ok(problems.length >= 2);
    for (const r of problems) {
      assert.ok(r.impact?.length, `${r.name} has no impact description`);
      assert.ok(r.actions?.length, `${r.name} has no action steps`);
    }
    // WORKFLOW_PAT was downgraded to INFO so it is not in the problem sample; verify the doc link
    // on an item that needs real action (automerge compatibility).
    const automerge = problems.find((r) => r.name === "automerge 호환성(merge commit 허용)");
    assert.strictEqual(automerge.doc, DOC.postInstall);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Doc site anchors linked from the output must exist in the real doc source (prevents link rot),
// for both the English default (root paths) and the ko locale (/ko/ paths).
test("anchors targeted by DOC links actually exist in the doc site source", () => {
  try {
    for (const lang of ["en", "ko"]) {
      setLanguage(lang);
      for (const url of Object.values(DOC)) {
        assert.ok(url.startsWith(`${DOCS_SITE_URL}/`), `not a doc site URL: ${url}`);
        assert.strictEqual(url.startsWith(`${DOCS_SITE_URL}/ko/`), lang === "ko", `${lang} link has the wrong locale: ${url}`);
        const [page, anchor] = url.slice(DOCS_SITE_URL.length + 1).split("#");
        const base = join(REPO_ROOT, "website/src/content/docs", page.replace(/\/$/, ""));
        const file = [".md", ".mdx"].map((ext) => base + ext).find((f) => existsSync(f));
        assert.ok(file, `no doc file for ${page}`);
        assert.ok(readFileSync(file, "utf8").includes(`<a id="${anchor}">`), `${page} has no #${anchor} anchor`);
      }
    }
  } finally {
    setLanguage("ko"); // the other tests in this file assert the ko output
  }
});

// Already-released CLI versions link README anchors, so the READMEs keep the anchors too.
test("README anchors linked by older CLI versions remain in every README", () => {
  for (const file of ["README.md", "README.ko.md", "README.zh-CN.md", "README.ja.md"]) {
    const readme = readFileSync(join(REPO_ROOT, file), "utf8");
    for (const anchor of ["post-install", "flutter-store"]) {
      assert.ok(readme.includes(`<a id="${anchor}"></a>`), `${file} has no #${anchor} anchor`);
    }
  }
});

test("printDoctorReport: problem items expand in the order symptom, impact, action, doc", () => {
  const output = render([{
    name: "Workflow permissions", purpose: "auto-push version commit", status: "WARN",
    value: "Currently read.",
    impact: ["The release stops."],
    actions: ["Repo Settings → Actions → General", '"Read and write permissions" option'],
    doc: DOC.postInstall,
  }]);
  assert.ok(output.includes("[!] Workflow permissions — auto-push version commit"));
  const iValue = output.indexOf("Currently read.");
  const iImpact = output.indexOf("The release stops.");
  const iAction = output.indexOf("Repo Settings");
  const iDoc = output.indexOf("자세히:");
  assert.ok(iValue < iImpact && iImpact < iAction && iAction < iDoc, "order is not symptom -> impact -> action -> doc");
  assert.ok(output.includes(DOC.postInstall));
});

test("printDoctorReport: healthy items collapse to one line", () => {
  const output = render([
    { name: "gh CLI", purpose: "for repo settings lookup", status: "OK", value: "gh version 2.96.0" },
  ]);
  const line = output.split("\n").find((l) => l.includes("gh CLI"));
  assert.ok(line.includes("[✓]"));
  assert.ok(line.includes("for repo settings lookup"));
  assert.ok(line.includes("gh version 2.96.0"));
});

// Pin that the tool reports only what it found, without judging whether installing is OK.
test("printDoctorReport: summary reports the problem count instead of a verdict", () => {
  const clean = render([{ name: "gh CLI", purpose: "for repo settings lookup", status: "OK", value: "installed" }]);
  assert.ok(clean.includes("문제를 찾지 못했습니다"));

  const warned = render([
    { name: "A", purpose: "a", status: "WARN", value: "x", impact: ["y"], actions: ["z"] },
    { name: "B", purpose: "b", status: "WARN", value: "x", impact: ["y"], actions: ["z"] },
  ]);
  assert.ok(warned.includes("2개 항목에서 문제를 찾았습니다"));
  assert.ok(warned.includes("나중에 설정해도 됩니다"));

  const failed = render([{ name: "gh 인증", purpose: "permission", status: "FAIL", value: "x", impact: ["y"], actions: ["z"] }]);
  assert.ok(failed.includes("일부 점검은 실행하지 못했습니다"));
});

test("printDoctorReport: color=false leaves no ESC bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const output = render(runDoctor(dir, { exec: fakeExec(ALL_OK_EXEC) }), { color: false });
    assert.ok(!output.includes("\x1b["));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Workflow permissions misdiagnosis fix -----------------------------------------

// The wizard workflows run on their own permissions declaration, so a read repo default is not a problem.
// Flagging WARN on an item needing no action reports a nonexistent outage and prompts needless permission escalation.
test("runDoctor: Workflow permissions read is INFO, not a warning", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ...ALL_OK_EXEC.filter(([k]) => !k.includes("permissions/workflow")),
      ["actions/permissions/workflow", { status: 0, stdout: "read", stderr: "" }],
    ]);
    const perm = runDoctor(dir, { exec }).find((r) => r.name === "Workflow permissions");
    assert.strictEqual(perm.status, "INFO");
    assert.ok(perm.note?.length, "INFO items must have a note");
    assert.ok(perm.note.join(" ").includes("read"), "the current value must remain in the guidance");
    assert.ok(!perm.impact, "no impact is attached since no action is needed");
    assert.ok(!perm.actions?.length, "no actions are attached since no action is needed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// "The release is halted" is a false statement, so it must never appear on any path.
test("runDoctor: Workflow permissions guidance never says the release is halted", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ...ALL_OK_EXEC.filter(([k]) => !k.includes("permissions/workflow")),
      ["actions/permissions/workflow", { status: 0, stdout: "read", stderr: "" }],
    ]);
    const perm = runDoctor(dir, { exec }).find((r) => r.name === "Workflow permissions");
    const all = [perm.value, ...(perm.note || []), ...(perm.impact || [])].filter(Boolean).join(" ");
    assert.ok(!all.includes("중단"), `false statement remains: ${all}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A failed lookup is not a misdiagnosis but a real lack of information: keep WARN.
test("runDoctor: Workflow permissions lookup failure stays WARN", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ...ALL_OK_EXEC.filter(([k]) => !k.includes("permissions/workflow")),
      ["actions/permissions/workflow", { status: 1, stdout: "", stderr: "forbidden" }],
    ]);
    const perm = runDoctor(dir, { exec }).find((r) => r.name === "Workflow permissions");
    assert.strictEqual(perm.status, "WARN");
    assert.ok(perm.actions?.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Flutter store deploy diagnostics ──────────────────────────────
const ANDROID_FASTFILE = "app/android/fastlane/Fastfile.playstore";
const IOS_FASTFILE = "app/ios/fastlane/Fastfile";
const EXPORT_OPTIONS = "app/ios/ExportOptions.plist";
const PLACEHOLDER_PLIST = "<plist><dict><string>__TEAM_ID__</string><string>__BUNDLE_ID__</string></dict></plist>\n";
const FILLED_PLIST = "<plist><dict><string>ABCDE12345</string><string>com.example.app</string></dict></plist>\n";
const NO_GH = fakeExec([["gh --version", { status: 1, stdout: "", stderr: "", error: new Error("not found") }]]);
const isFlutterRow = (r) => r.name.startsWith("Flutter ") || r.name === "ExportOptions.plist";

// An empty storeLine simulates a pre-feature install with no stored flutter_store value.
function writeFlutterProject(dir, { storeLine = 'flutter_store: "android,ios"', files = {} } = {}) {
  const optionsLine = storeLine ? `      ${storeLine}\n` : "";
  writeFileSync(join(dir, "version.yml"),
    'version: "1.0.0"\nproject_types: ["flutter"]\nproject_paths:\n  flutter: "app"\n' +
    `metadata:\n  template:\n    options:\n${optionsLine}`);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
}

test("runDoctor: missing Flutter store deploy files are reported per platform as WARN (reflecting the Flutter root)", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-flutter-"));
  try {
    writeFlutterProject(dir);
    const results = runDoctor(dir, { exec: NO_GH });
    const android = results.find((r) => r.name === "Flutter Android 배포 파일");
    const ios = results.find((r) => r.name === "Flutter iOS 배포 파일");
    assert.strictEqual(android.status, "WARN");
    assert.ok(android.value.includes(ANDROID_FASTFILE), "project_paths.flutter(app) must be reflected in the path");
    assert.strictEqual(ios.status, "WARN");
    assert.ok(ios.value.includes(IOS_FASTFILE) && ios.value.includes(EXPORT_OPTIONS));
    assert.ok(!results.some((r) => r.name === "ExportOptions.plist"), "without a plist there is no placeholder check row");
    assert.ok(android.doc.endsWith("#flutter-store"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: WARN when ExportOptions.plist still has placeholders, OK once filled", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-flutter-"));
  try {
    const files = { [ANDROID_FASTFILE]: "x", [IOS_FASTFILE]: "x", [EXPORT_OPTIONS]: PLACEHOLDER_PLIST };
    writeFlutterProject(dir, { files });
    let results = runDoctor(dir, { exec: NO_GH });
    assert.strictEqual(results.find((r) => r.name === "Flutter Android 배포 파일").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "Flutter iOS 배포 파일").status, "OK");
    const plist = results.find((r) => r.name === "ExportOptions.plist");
    assert.strictEqual(plist.status, "WARN");
    assert.ok(plist.value.includes("__TEAM_ID__") && plist.value.includes("__BUNDLE_ID__"));
    const output = render(results);
    assert.ok(output.includes("ExportOptions.plist") && output.includes("__TEAM_ID__"));

    writeFileSync(join(dir, EXPORT_OPTIONS), FILLED_PLIST);
    results = runDoctor(dir, { exec: NO_GH });
    assert.strictEqual(results.find((r) => r.name === "ExportOptions.plist").status, "OK");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: only the selected platforms are checked (android only means no iOS/ExportOptions rows)", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-flutter-"));
  try {
    writeFlutterProject(dir, { storeLine: 'flutter_store: "android"', files: { [EXPORT_OPTIONS]: PLACEHOLDER_PLIST } });
    const names = runDoctor(dir, { exec: NO_GH }).filter(isFlutterRow).map((r) => r.name);
    assert.deepStrictEqual(names, ["Flutter Android 배포 파일"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: no Flutter rows when flutter_store is none", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-flutter-"));
  try {
    writeFlutterProject(dir, { storeLine: 'flutter_store: "none"' });
    assert.deepStrictEqual(runDoctor(dir, { exec: NO_GH }).filter(isFlutterRow), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: an existing install without a stored flutter_store infers platforms from the installed store workflows", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-flutter-"));
  try {
    writeFlutterProject(dir, {
      storeLine: "",
      files: { ".github/workflows/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml": "" },
    });
    const names = runDoctor(dir, { exec: NO_GH }).filter(isFlutterRow).map((r) => r.name);
    assert.deepStrictEqual(names, ["Flutter iOS 배포 파일"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: non-Flutter projects have no Flutter rows even with stored store options", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-flutter-"));
  try {
    writeFileSync(join(dir, "version.yml"),
      'version: "1.0.0"\nproject_types: ["spring"]\nmetadata:\n  template:\n    options:\n      flutter_store: "ios"\n');
    assert.deepStrictEqual(runDoctor(dir, { exec: NO_GH }).filter(isFlutterRow), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: owner/repo is recognized even when the repo name has dots (next.js, user.github.io)", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    for (const [url, expected] of [
      ["https://github.com/vercel/next.js.git\n", "repos/vercel/next.js"],
      ["git@github.com:someone/someone.github.io.git\n", "repos/someone/someone.github.io"],
      ["https://github.com/vercel/next.js\n", "repos/vercel/next.js"],
    ]) {
      const calls = [];
      const base = fakeExec([...ALL_OK_EXEC.filter(([p]) => p !== "git -C"), ["git -C", { status: 0, stdout: url, stderr: "" }]]);
      const exec = (cmd, args) => { calls.push([cmd, ...args].join(" ")); return base(cmd, args); };
      const results = runDoctor(dir, { exec });
      assert.ok(!results.some((r) => r.name === "GitHub 원격"), `${url.trim()} must be recognized`);
      assert.ok(calls.some((c) => c.includes(`${expected}/actions/permissions/workflow`)), `${url.trim()} → ${expected}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: Copilot guidance shows the actual copilot_ai value from version.yml", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const noteFor = (yml) => {
      writeFileSync(join(dir, "version.yml"), yml);
      return runDoctor(dir, { exec: fakeExec(ALL_OK_EXEC) }).find((r) => r.name === "Copilot AI 요약").note.join("\n");
    };
    const opts = (v) => `version: "1.0.0"\nmetadata:\n  template:\n    options:\n      copilot_ai: ${v}\n`;
    assert.match(noteFor(opts("true")), /켜져 있습니다 \(version\.yml의 copilot_ai: true\)/);
    assert.match(noteFor(opts("false")), /꺼져 있습니다 \(version\.yml의 copilot_ai: false\)/);
    assert.match(noteFor('version: "1.0.0"\n'), /기본은 꺼져 있습니다/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
