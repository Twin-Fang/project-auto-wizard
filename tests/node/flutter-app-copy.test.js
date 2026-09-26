// tests/node/flutter-app-copy.test.js
// Flutter 앱 파일(fastlane·ExportOptions) 복사 — 없을 때만 생성, 절대 덮어쓰지 않는다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { copyFlutterAppFiles, planFlutterAppFiles } from "../../src/core/copy/flutter-app.js";

const ANDROID_FASTFILE = "android/fastlane/Fastfile.playstore";
const IOS_FASTFILE = "ios/fastlane/Fastfile";
const IOS_EXPORT = "ios/ExportOptions.plist";
const ALL = [ANDROID_FASTFILE, IOS_FASTFILE, IOS_EXPORT];

// D6의 실제 payload에 의존하지 않도록 테스트 안에서 원본 트리를 만든다. iOS Fastfile은 CRLF로 둔다.
function makePayload() {
  const root = mkdtempSync(join(tmpdir(), "paw-fa-payload-"));
  const contents = {
    [ANDROID_FASTFILE]: "# android fastfile\nlane :deploy_internal do\nend\n",
    [IOS_FASTFILE]: "# ios fastfile\r\nlane :deploy do\r\nend\r\n",
    [IOS_EXPORT]: "<plist>__TEAM_ID__</plist>\n",
  };
  for (const [rel, body] of Object.entries(contents)) {
    const p = join(root, "flutter-app", rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return { root, contents };
}

const freshTarget = () => mkdtempSync(join(tmpdir(), "paw-fa-target-"));
const ctx = (overrides = {}) => ({ types: ["flutter"], paths: new Map(), flutterStore: null, ...overrides });

test("신규 설치: 3개 파일을 만들고 디렉토리도 자동 생성한다", () => {
  const { root, contents } = makePayload();
  const target = freshTarget();
  try {
    const r = copyFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual([...r.created].sort(), [...ALL].sort());
    assert.deepStrictEqual(r.kept, []);
    for (const rel of ALL) assert.strictEqual(readFileSync(join(target, rel), "utf8"), contents[rel]);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("이미 있는 파일은 덮어쓰지 않고 kept로 보고한다", () => {
  const { root } = makePayload();
  const target = freshTarget();
  try {
    mkdirSync(join(target, "ios"), { recursive: true });
    writeFileSync(join(target, IOS_EXPORT), "내가 채운 값\n");

    const r = copyFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual(r.kept, [IOS_EXPORT]);
    assert.deepStrictEqual([...r.created].sort(), [ANDROID_FASTFILE, IOS_FASTFILE].sort());
    assert.strictEqual(readFileSync(join(target, IOS_EXPORT), "utf8"), "내가 채운 값\n");

    const again = copyFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual(again.created, []);
    assert.deepStrictEqual([...again.kept].sort(), [...ALL].sort());
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("모노레포: paths.flutter 아래에 만들고 반환 경로도 그 접두사를 갖는다", () => {
  const { root } = makePayload();
  const target = freshTarget();
  try {
    const r = copyFlutterAppFiles(ctx({ paths: new Map([["flutter", "app"]]) }), root, target);
    assert.deepStrictEqual([...r.created].sort(), ALL.map((rel) => `app/${rel}`).sort());
    assert.ok(existsSync(join(target, "app", ANDROID_FASTFILE)));
    assert.ok(!existsSync(join(target, "android")), "레포 루트에는 만들지 않는다");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("선택 플랫폼만: android / ios / none(빈 배열)", () => {
  const { root } = makePayload();
  try {
    const cases = [
      [["android"], [ANDROID_FASTFILE]],
      [["ios"], [IOS_FASTFILE, IOS_EXPORT]],
      [[], []],
    ];
    for (const [stores, expected] of cases) {
      const target = freshTarget();
      try {
        const r = copyFlutterAppFiles(ctx({ flutterStore: stores }), root, target);
        assert.deepStrictEqual([...r.created].sort(), [...expected].sort(), `stores=${JSON.stringify(stores)}`);
        for (const rel of ALL) assert.strictEqual(existsSync(join(target, rel)), expected.includes(rel), rel);
      } finally { rmSync(target, { recursive: true, force: true }); }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Flutter 타입이 없으면 아무것도 만들지 않는다", () => {
  const { root } = makePayload();
  const target = freshTarget();
  try {
    const r = copyFlutterAppFiles(ctx({ types: ["react"] }), root, target);
    assert.deepStrictEqual(r, { created: [], kept: [] });
    assert.ok(!existsSync(join(target, "android")) && !existsSync(join(target, "ios")));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("CRLF 원본은 바이트 그대로 복사된다", () => {
  const { root, contents } = makePayload();
  const target = freshTarget();
  try {
    copyFlutterAppFiles(ctx(), root, target);
    const copied = readFileSync(join(target, IOS_FASTFILE));
    assert.ok(copied.equals(Buffer.from(contents[IOS_FASTFILE], "utf8")));
    assert.ok(copied.includes(Buffer.from("\r\n")));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("planFlutterAppFiles: 복사와 같은 결과를 계산하되 아무 파일도 쓰지 않는다", () => {
  const { root } = makePayload();
  const target = freshTarget();
  try {
    mkdirSync(join(target, "android/fastlane"), { recursive: true });
    writeFileSync(join(target, ANDROID_FASTFILE), "기존\n");

    const planned = planFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual(planned.kept, [ANDROID_FASTFILE]);
    assert.deepStrictEqual([...planned.created].sort(), [IOS_FASTFILE, IOS_EXPORT].sort());
    assert.ok(!existsSync(join(target, "ios")), "plan은 읽기 전용이다");

    const copied = copyFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual({ created: [...copied.created].sort(), kept: copied.kept },
      { created: [...planned.created].sort(), kept: planned.kept });
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("planFlutterAppFiles: 원본 payload를 읽지 않으므로 payload가 없어도 계산된다", () => {
  const target = freshTarget();
  try {
    const planned = planFlutterAppFiles(ctx(), join(target, "no-such-payload"), target);
    assert.strictEqual(planned.created.length, 3);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
