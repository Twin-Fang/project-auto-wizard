// A release_automerge value that cannot be read must never switch automerge back on: the CLI reports it, reads it as false
// (same as the workflow reader), and the install summary does not describe automerge when the option is off.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { parseExisting } from "../../src/core/version-yml.js";
import { runStatus, printStatus } from "../../src/commands/status.js";
import { runDoctor } from "../../src/commands/doctor.js";
import { printSummary } from "../../src/ui/summary.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const CLOCK = { now: "2026-09-30 00:00:00", today: "2026-09-30" };
const branches = { mode: "pr-flow", main: "main", develop: "develop" };

function capture(stream, fn) {
  const original = stream.write.bind(stream);
  let out = "";
  stream.write = (chunk) => { out += chunk; return true; };
  const done = () => { stream.write = original; return out; };
  return Promise.resolve(fn()).then(() => done(), (e) => { done(); throw e; });
}

function installedProject() {
  const target = mkdtempSync(join(tmpdir(), "paw-invalid-"));
  writeFileSync(join(target, "package.json"), "{}\n");
  return target;
}
const install = (target, extra = []) => run(["--mode", "full", "--force", "--type", "node", ...extra], { cwd: target, clock: CLOCK });
const setValue = (target, text) => {
  const vy = join(target, "version.yml");
  writeFileSync(vy, readFileSync(vy, "utf8").replace(/^(\s+release_automerge:).*$/m, `$1 ${text}`));
};
const savedLine = (target) => readFileSync(join(target, "version.yml"), "utf8").match(/^\s+release_automerge:.*$/m)[0].trim();

test("reinstall: a quoted or capitalized false stays off and raises no warning", async () => {
  const target = installedProject();
  try {
    await install(target);
    for (const v of ["'false'", '"false"', "False", "FALSE", "false # by hand"]) {
      setValue(target, v);
      let code;
      const err = await capture(process.stderr, async () => { code = await install(target); });
      assert.strictEqual(code, 0);
      assert.strictEqual(savedLine(target), "release_automerge: false", v);
      assert.ok(!err.includes("release_automerge 값"), `${v}: ${err}`);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("reinstall: an unrecognized value is reported and written back as false, never as true", async () => {
  const target = installedProject();
  try {
    await install(target);
    for (const v of ["no", "off", "0", '"maybe"', "null", ""]) {
      setValue(target, v);
      let code;
      const err = await capture(process.stderr, async () => { code = await install(target); });
      assert.strictEqual(code, 0);
      assert.strictEqual(savedLine(target), "release_automerge: false", `value ${JSON.stringify(v)}`);
      assert.match(err, /release_automerge/, `value ${JSON.stringify(v)}: a warning is expected`);
      assert.match(err, /false/);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("status: an unrecognized value is shown as invalid, a quoted false is just false", async () => {
  const target = installedProject();
  try {
    await install(target);
    const show = async (v) => {
      setValue(target, v);
      return capture(process.stdout, () => printStatus(runStatus(resolvePayloadRoot(), target)));
    };
    const bad = await show('"maybe"');
    assert.match(bad, /release_automerge=false \(.*"maybe".*\)/);
    const ok = await show("'false'");
    assert.match(ok, /release_automerge=false( |$)/m);
    assert.ok(!/release_automerge=false \(/.test(ok));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

const OK_EXEC = (cmd, args) => {
  const key = [cmd, ...args].join(" ");
  if (key.includes("git -C")) return { status: 0, stdout: "https://github.com/acme/widgets.git\n", stderr: "" };
  return { status: 0, stdout: "true", stderr: "" };
};

test("doctor: an unrecognized value is a warning that names the value; a valid value stays informational", async () => {
  const target = installedProject();
  try {
    await install(target);
    const item = () => runDoctor(target, { exec: OK_EXEC }).find((i) => i.name === "릴리스 PR 자동 머지");
    setValue(target, "off");
    assert.strictEqual(item().status, "WARN");
    assert.match(item().note.join("\n"), /off/);
    setValue(target, "'false'");
    assert.strictEqual(item().status, "INFO");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

const summaryText = (extra) => capture(process.stderr, () => printSummary({ mode: "full", types: ["node"], version: "1.0.0", branches, ...extra }));

test("summary: with automerge off the pr-flow line and the PAT guidance no longer describe automerge", async () => {
  const off = await summaryText({ releaseAutomerge: false });
  assert.ok(!off.includes("automerge용 PAT"), off);
  assert.ok(!off.includes("WORKFLOW_PAT"), off);
  assert.match(off, /직접 머지/);
  const on = await summaryText({ releaseAutomerge: true });
  assert.ok(on.includes("automerge용 PAT"));
  assert.ok(on.includes("WORKFLOW_PAT"));
  const unspecified = await summaryText({});
  assert.ok(unspecified.includes("automerge용 PAT"), "without the field the summary keeps the automerge wording");
});

test("summary: trunk-based mode keeps the PAT block (there is no release PR to merge by hand)", async () => {
  const out = await summaryText({ releaseAutomerge: false, branches: { mode: "trunk-based", main: "main", develop: "main" } });
  assert.ok(out.includes("WORKFLOW_PAT"));
});

test("install: --no-release-automerge prints the manual-merge summary", async () => {
  const target = installedProject();
  try {
    const err = await capture(process.stderr, () => install(target, ["--no-release-automerge"]));
    assert.ok(!err.includes("automerge용 PAT"), err);
    assert.match(err, /직접 머지/);
    assert.strictEqual(parseExisting(readFileSync(join(target, "version.yml"), "utf8")).options.releaseAutomerge, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
