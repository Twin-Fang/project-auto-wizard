// tests/node/options-registry.test.js - invariants of the option registry itself.
import { test } from "node:test";
import assert from "node:assert";
import {
  OPTIONS, optionByKey, optionVar, explicitFromContext, defaultContextFields,
  pickOptionValues, resolveOptionValues, renderValues,
} from "../../src/core/options.js";

test("registry: keys, names, context fields and flags are unique and consistently named", () => {
  for (const field of ["key", "name", "ctxField", "flag"]) {
    const values = OPTIONS.map((o) => o[field]);
    assert.strictEqual(new Set(values).size, values.length, `${field} must be unique`);
  }
  for (const o of OPTIONS) {
    assert.match(o.key, /^[a-z]+(_[a-z]+)*$/, `${o.key}: snake_case`);
    assert.strictEqual(typeof o.default, "boolean");
    assert.strictEqual(typeof o.legacyDefault, "boolean");
    assert.match(o.conflictKey, /^cli\.args\./);
    assert.strictEqual(o.ctxField, `include${o.name[0].toUpperCase()}${o.name.slice(1)}`);
    assert.strictEqual(o.name, o.key.replace(/_(\w)/g, (_, c) => c.toUpperCase()));
  }
});

test("registry: existing options keep their historical defaults", () => {
  assert.deepStrictEqual([optionByKey("semver_auto").default, optionByKey("semver_auto").legacyDefault], [true, false]);
  assert.deepStrictEqual([optionByKey("copilot_ai").default, optionByKey("copilot_ai").legacyDefault], [false, false]);
});

test("optionVar: template variable name", () => {
  assert.strictEqual(optionVar(optionByKey("semver_auto")), "OPT_SEMVER_AUTO");
});

test("explicitFromContext / defaultContextFields", () => {
  const explicit = explicitFromContext({ includeSemverAuto: true });
  assert.strictEqual(explicit.semverAuto, true);
  assert.strictEqual(explicit.copilotAi, null);
  const defaults = defaultContextFields();
  assert.strictEqual(defaults.includeSemverAuto, null);
  assert.strictEqual(defaults.includeCopilotAi, null);
});

test("resolveOptionValues: explicit > saved > default (new) / legacyDefault (existing)", () => {
  const r0 = resolveOptionValues({}, null);
  assert.strictEqual(r0.includeSemverAuto, true);
  assert.strictEqual(r0.includeCopilotAi, false);
  const r1 = resolveOptionValues({}, { options: {} });
  assert.strictEqual(r1.includeSemverAuto, false);
  const r2 = resolveOptionValues({ semverAuto: true }, { options: { semverAuto: false } });
  assert.strictEqual(r2.includeSemverAuto, true);
  assert.strictEqual(pickOptionValues({}, null).semverAuto, null);
});

test("renderValues: unset context falls back to the option default", () => {
  const r = renderValues({});
  assert.strictEqual(r.includeSemverAuto, true);
  assert.strictEqual(r.includeCopilotAi, false);
  assert.strictEqual(renderValues({ includeSemverAuto: false }).includeSemverAuto, false);
  assert.strictEqual(renderValues({ includeCopilotAi: true }).includeCopilotAi, true);
});
