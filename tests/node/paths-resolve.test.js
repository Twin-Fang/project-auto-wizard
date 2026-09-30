import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { CliError } from "../../src/cli/args.js";
import { resolveProjectPaths, markerForType, findTypePathCandidates } from "../../src/core/paths-resolve.js";

function tmpRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, ".git"));
  return dir;
}

// ── resolveProjectPaths() call-site CliError catch ──────────────
test("run(): an unsupported type in --paths is rejected cleanly with exit 1 and no stack trace", async () => {
  const target = tmpRepo("paw-paths-resolve-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "node", "--paths", "not-a-type=."],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// ── Existence check for paths given via --paths ──────────────────────
test("resolveProjectPaths: rejects with CliError when the path given via --paths does not exist", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    await assert.rejects(
      () => resolveProjectPaths({
        root, types: ["react"],
        paths: new Map([["react", "does-not-exist"]]),
        existingPaths: new Map(), force: true, tty: false, io: {},
      }),
      CliError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProjectPaths: a path given via --paths that actually exists is confirmed as is", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    mkdirSync(join(root, "client"));
    const result = await resolveProjectPaths({
      root, types: ["react"],
      paths: new Map([["react", "client"]]),
      existingPaths: new Map(), force: true, tty: false, io: {},
    });
    assert.strictEqual(result.get("react"), "client");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── Monorepo path candidates: rejecting 0 vs 2+ distinctly ────────────────────
test("resolveProjectPaths: rejects with CliError when there are 0 path candidates (detection failed)", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    // pubspec.yaml exists but lib/ does not, so it is filtered out of the flutter candidates → 0 candidates
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app", "pubspec.yaml"), "name: demo\n");
    // Check the "not found" message, not just the type, to verify this branch is not
    // mixed up with the 2+ (ambiguous) branch (checking only the error type would pass even if both branch messages were swapped).
    await assert.rejects(
      () => resolveProjectPaths({
        root, types: ["flutter"], paths: new Map(),
        existingPaths: new Map(), force: true, tty: false, io: {},
      }),
      (err) => err instanceof CliError && /찾지 못했습니다/.test(err.message),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProjectPaths: rejects with CliError when there are 2+ path candidates (ambiguous)", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    mkdirSync(join(root, "client"));
    writeFileSync(join(root, "client", "package.json"), "{}\n");
    mkdirSync(join(root, "admin"));
    writeFileSync(join(root, "admin", "package.json"), "{}\n");
    // Check that the "ambiguous" message and the candidate list (admin, client) are included, to verify
    // it is not mixed up with the 0-candidate (detection failed) branch.
    await assert.rejects(
      () => resolveProjectPaths({
        root, types: ["react"], paths: new Map(),
        existingPaths: new Map(), force: true, tty: false, io: {},
      }),
      (err) => err instanceof CliError && /모호합니다.*admin.*client/.test(err.message),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProjectPaths: exactly 1 path candidate is confirmed automatically (regression check)", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    mkdirSync(join(root, "client"));
    writeFileSync(join(root, "client", "package.json"), "{}\n");
    const result = await resolveProjectPaths({
      root, types: ["react"], paths: new Map(),
      existingPaths: new Map(), force: true, tty: false, io: {},
    });
    assert.strictEqual(result.get("react"), "client");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── Final regression check of the 5 reproduction commands ──────────────────────────
test("repro 1 (M3): --paths react=does-not-exist is rejected with exit 1", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "react", "--paths", "react=does-not-exist"],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
    assert.strictEqual(existsSync(join(target, "version.yml")), false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("repro 2 (M4, 0 candidates): flutter with only pubspec.yaml and no lib/ is rejected with exit 1", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    mkdirSync(join(target, "app"));
    writeFileSync(join(target, "app", "pubspec.yaml"), "name: demo\n");
    const code = await run(
      ["--mode", "full", "--force", "--type", "flutter"],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("repro 2 (M4, 2+ candidates): two directories with the react marker are rejected with exit 1", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    mkdirSync(join(target, "client"));
    writeFileSync(join(target, "client", "package.json"), "{}\n");
    mkdirSync(join(target, "admin"));
    writeFileSync(join(target, "admin", "package.json"), "{}\n");
    const code = await run(
      ["--mode", "full", "--force", "--type", "react"],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("repro 3 (L5): --paths \"re act=.\" is normalized the same as --type and installs normally", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "react", "--paths", "re act=."],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 0);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("repro 4 (L6): --main-branch \"\" is rejected with exit 1", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "node", "--main-branch", ""],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("markerForType (paths-resolve): go returns go.mod (KNOWN_MARKER_TYPES regression)", () => {
  assert.strictEqual(markerForType("go"), "go.mod");
});

test("findTypePathCandidates: finds go.mod at the root as a candidate (namesByType regression)", () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    writeFileSync(join(root, "go.mod"), "module example.com/fx\n\ngo 1.23\n");
    const candidates = findTypePathCandidates(root, "go");
    assert.deepStrictEqual(candidates, ["."]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProjectPaths: go.mod at the root is confirmed automatically as '.' (KNOWN_MARKER_TYPES regression)", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    writeFileSync(join(root, "go.mod"), "module example.com/fx\n\ngo 1.23\n");
    const result = await resolveProjectPaths({
      root, types: ["go"], paths: new Map(),
      existingPaths: new Map(), force: true, tty: false, io: {},
    });
    assert.strictEqual(result.get("go"), ".");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── Escaping the interactive manual-input loop ──────────────────────────────
// Even when a type without a marker file is added, Enter alone must be enough to proceed (no infinite loop).
test("resolveProjectPaths (interactive): even without a marker, Enter (the default) alone confirms the root path", async () => {
  const target = tmpRepo("paw-paths-loop-");
  try {
    let asked = 0;
    const io = {
      log: () => {},
      text: async ({ defaultValue }) => { asked++; return defaultValue; },
      confirm: async ({ initialValue }) => initialValue,
      select: async () => { throw new Error("select must not be called when there are no candidates"); },
    };
    const result = await resolveProjectPaths({ root: target, types: ["spring"], tty: true, io });
    assert.strictEqual(result.get("spring"), ".");
    assert.strictEqual(asked, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("resolveProjectPaths (interactive): choosing 'No' asks again, and ESC uses the entered path as is", async () => {
  const target = tmpRepo("paw-paths-loop-");
  try {
    const inputs = ["server", "api"];
    const confirms = [false, Symbol("cancel")];
    const io = {
      log: () => {},
      text: async () => inputs.shift(),
      confirm: async () => confirms.shift(),
    };
    const result = await resolveProjectPaths({ root: target, types: ["spring"], tty: true, io });
    assert.strictEqual(result.get("spring"), "api");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("resolveProjectPaths (interactive): a path outside the repo is not used and is asked again", async () => {
  const target = tmpRepo("paw-paths-outside-");
  try {
    const inputs = ["../other-repo", "server"];
    const io = { log: () => {}, text: async () => inputs.shift(), confirm: async () => true };
    const result = await resolveProjectPaths({ root: target, types: ["spring"], tty: true, io });
    assert.strictEqual(result.get("spring"), "server");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
