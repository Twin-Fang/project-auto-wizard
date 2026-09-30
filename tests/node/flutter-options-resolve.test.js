// Flutter option precedence: CLI > value saved in version.yml > default.
// Default: fresh install = dart-define; existing install (version.yml present, no saved value) = keep dotenv.
import { test } from "node:test";
import assert from "node:assert";
import { resolveFlutterOptions } from "../../src/core/flutter-options.js";
import { createContext } from "../../src/context.js";

const NO_CLI = { envMode: "", stores: null, androidDeployMode: "", iosDeployMode: "" };
// The default types model a "project with Flutter already installed" — matching the
// real shape returned by parseExisting() (a types array sits alongside options).
const existingWith = (options = {}, types = ["flutter"]) => ({
  types,
  options: { envMode: null, flutterStore: null, androidDeployMode: null, iosDeployMode: null, ...options },
});

test("fresh install (existing=null): dart-define, store undecided (null), deploy mode store_only", () => {
  assert.deepStrictEqual(resolveFlutterOptions({ cli: NO_CLI, existing: null }), {
    envMode: "dart-define", stores: null, androidDeployMode: "store_only", iosDeployMode: "store_only",
  });
});

test("works even when cli is omitted", () => {
  assert.strictEqual(resolveFlutterOptions({ existing: null }).envMode, "dart-define");
  assert.strictEqual(resolveFlutterOptions({}).envMode, "dart-define");
});

test("existing install (version.yml present, no saved value): keeps dotenv", () => {
  const out = resolveFlutterOptions({ cli: NO_CLI, existing: existingWith() });
  assert.strictEqual(out.envMode, "dotenv");
  assert.strictEqual(out.stores, null);
  assert.strictEqual(out.androidDeployMode, "store_only");
  assert.strictEqual(out.iosDeployMode, "store_only");
});

test("a saved value takes precedence over the existing-install preserved value and the default", () => {
  const out = resolveFlutterOptions({
    cli: NO_CLI,
    existing: existingWith({
      envMode: "dart-define", flutterStore: "ios", androidDeployMode: "store_prepare", iosDeployMode: "store_submit",
    }),
  });
  assert.deepStrictEqual(out, {
    envMode: "dart-define", stores: ["ios"], androidDeployMode: "store_prepare", iosDeployMode: "store_submit",
  });
});

test("a saved flutter_store of 'none' yields an empty array (nothing selected)", () => {
  assert.deepStrictEqual(resolveFlutterOptions({ cli: NO_CLI, existing: existingWith({ flutterStore: "none" }) }).stores, []);
});

test("even for an existing install, when Flutter was newly added (flutter was not in the type list), dotenv is not preserved and dart-define is the default", () => {
  const out = resolveFlutterOptions({ cli: NO_CLI, existing: existingWith({}, ["spring"]) });
  assert.strictEqual(out.envMode, "dart-define");
});

test("the CLI value overrides the saved value", () => {
  const out = resolveFlutterOptions({
    cli: { envMode: "dotenv", stores: ["android"], androidDeployMode: "store_submit", iosDeployMode: "store_prepare" },
    existing: existingWith({
      envMode: "dart-define", flutterStore: "ios", androidDeployMode: "store_only", iosDeployMode: "store_only",
    }),
  });
  assert.deepStrictEqual(out, {
    envMode: "dotenv", stores: ["android"], androidDeployMode: "store_submit", iosDeployMode: "store_prepare",
  });
});

test("an empty CLI store array (--flutter-store none) stays empty even when a saved value exists", () => {
  const out = resolveFlutterOptions({ cli: { ...NO_CLI, stores: [] }, existing: existingWith({ flutterStore: "android,ios" }) });
  assert.deepStrictEqual(out.stores, []);
});

test("when the CLI specifies only some options, the rest keep the saved value or default", () => {
  const out = resolveFlutterOptions({
    cli: { ...NO_CLI, iosDeployMode: "store_submit" },
    existing: existingWith({ envMode: "dart-define", androidDeployMode: "store_prepare" }),
  });
  assert.strictEqual(out.envMode, "dart-define");
  assert.strictEqual(out.androidDeployMode, "store_prepare");
  assert.strictEqual(out.iosDeployMode, "store_submit");
});

test("a hand-edited invalid saved value is ignored and the default rules apply (so arbitrary strings do not leak into workflows)", () => {
  const out = resolveFlutterOptions({
    cli: NO_CLI,
    existing: existingWith({
      envMode: "both", flutterStore: "windows", androidDeployMode: "x' || 'y", iosDeployMode: "publish",
    }),
  });
  assert.deepStrictEqual(out, {
    envMode: "dotenv", stores: null, androidDeployMode: "store_only", iosDeployMode: "store_only",
  });
});

test("createContext: the Flutter option default is 'undecided'", () => {
  const ctx = createContext();
  assert.strictEqual(ctx.envMode, "");
  assert.strictEqual(ctx.flutterStore, null);
  assert.strictEqual(ctx.androidDeployMode, "");
  assert.strictEqual(ctx.iosDeployMode, "");
});

test("createContext: Flutter options can be injected via overrides", () => {
  const ctx = createContext({ envMode: "dotenv", flutterStore: ["ios"], androidDeployMode: "store_prepare", iosDeployMode: "store_submit" });
  assert.strictEqual(ctx.envMode, "dotenv");
  assert.deepStrictEqual(ctx.flutterStore, ["ios"]);
  assert.strictEqual(ctx.androidDeployMode, "store_prepare");
  assert.strictEqual(ctx.iosDeployMode, "store_submit");
});
