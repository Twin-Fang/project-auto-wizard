// tests/node/sparse-checkout-order.test.js
// A sparse checkout into the workspace root leaves the tree sparse for every later full checkout in the same job
// (only the sparse paths exist, so `working-directory: api` fails). Workflows must fetch the message catalog into
// a separate `path:`, or disable sparse mode before relying on the full tree.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { rmTmp } from "../helpers/tmp.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ya?ml$/.test(n) ? [p] : [];
  });
const FILES = [...walk(join(ROOT, "payload/workflows")), ...walk(join(ROOT, "templates/workflows"))];

// Line-based scan (the project has no YAML dependency): returns the ordered checkout steps of every job
function checkoutsByJob(text) {
  const jobs = [];
  let job = null;
  let step = null;
  const lines = text.split("\n");
  let inJobs = false;
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) inJobs = true;
    else if (/^\S/.test(line) && !line.startsWith("#")) inJobs = false;
    if (!inJobs) continue;
    const j = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (j) {
      job = { name: j[1], steps: [] };
      jobs.push(job);
      step = null;
      continue;
    }
    if (!job) continue;
    if (/^      - /.test(line)) {
      step = { text: line };
      job.steps.push(step);
    } else if (step) step.text += "\n" + line;
  }
  return jobs.map((jb) => ({
    name: jb.name,
    steps: jb.steps.map((s) => ({
      checkout: /uses:\s*actions\/checkout@/.test(s.text),
      sparse: /^\s+sparse-checkout:/m.test(s.text),
      path: (s.text.match(/^\s{10}path:\s*(\S+)/m) || [])[1],
      disables: /git sparse-checkout disable/.test(s.text),
      text: s.text,
    })),
  }));
}

for (const file of FILES) {
  const text = readFileSync(file, "utf8");
  if (!/actions\/checkout@/.test(text)) continue;
  const rel = file.slice(ROOT.length);

  test(`${rel}: no full checkout or tree-dependent step follows a root-level sparse checkout`, () => {
    for (const job of checkoutsByJob(text)) {
      let sparseRoot = null;
      job.steps.forEach((s, i) => {
        if (s.checkout && s.sparse && (!s.path || s.path === ".")) sparseRoot = i;
        if (s.disables) sparseRoot = null;
        if (sparseRoot !== null && i > sparseRoot && s.checkout && !s.sparse && (!s.path || s.path === ".")) {
          assert.fail(`${job.name}: full checkout (step ${i + 1}) follows a root-level sparse checkout (step ${sparseRoot + 1})`);
        }
      });
    }
  });
}

test("PR preview workflows fetch messages.py into a separate path", () => {
  for (const f of FILES.filter((p) => /PR-PREVIEW|pr-preview/.test(p))) {
    const jobs = checkoutsByJob(readFileSync(f, "utf8"));
    const msg = jobs.flatMap((j) => j.steps).filter((s) => s.checkout && /messages\.py/.test(s.text));
    assert.ok(msg.length >= 9, `${f}: expected the message checkouts`);
    for (const s of msg) assert.equal(s.path, ".paw-msg", `${f}: messages checkout must use path: .paw-msg`);
  }
});

// Reproduces the checkout order locally: a sparse clone at the root keeps the tree sparse after a later full
// checkout, while a sparse clone in a subdirectory (the fixed layout) leaves the full tree complete.
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function makeOrigin(base) {
  const origin = join(base, "origin");
  mkdirSync(join(origin, "api"), { recursive: true });
  mkdirSync(join(origin, ".github/scripts"), { recursive: true });
  writeFileSync(join(origin, "api/app.txt"), "x\n");
  writeFileSync(join(origin, ".github/scripts/messages.py"), "# m\n");
  writeFileSync(join(origin, "version.yml"), "version: 1.0.0\n");
  git(origin, "init", "-q", "-b", "main");
  git(origin, "-c", "user.name=t", "-c", "user.email=t@t", "add", ".");
  git(origin, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  return origin;
}

function sparseThenFull(origin, work, msgPath) {
  git(work, "init", "-q");
  git(work, "remote", "add", "origin", origin);
  // step 1: message checkout (sparse)
  const dir = msgPath ? join(work, msgPath) : work;
  if (msgPath) {
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q");
    git(dir, "remote", "add", "origin", origin);
  }
  git(dir, "sparse-checkout", "set", "--no-cone", ".github/scripts/messages.py", "version.yml");
  git(dir, "fetch", "-q", "origin", "main");
  git(dir, "checkout", "-q", "-f", "FETCH_HEAD");
  if (msgPath) rmTmp(dir);
  // step 2: full checkout of the same repo at the workspace root
  git(work, "fetch", "-q", "origin", "main");
  git(work, "checkout", "-q", "-f", "FETCH_HEAD");
}

test("local repro: sparse clone at the root leaves the tree incomplete, separate path does not", () => {
  const base = mkdtempSync(join(tmpdir(), "paw-sparse-"));
  try {
    const origin = makeOrigin(base);
    const bad = join(base, "bad");
    mkdirSync(bad);
    sparseThenFull(origin, bad, null);
    assert.ok(!existsSync(join(bad, "api/app.txt")), "sanity: root-level sparse keeps the tree sparse");

    const good = join(base, "good");
    mkdirSync(good);
    sparseThenFull(origin, good, ".paw-msg");
    assert.ok(existsSync(join(good, "api/app.txt")), "full tree must be complete");
    assert.ok(existsSync(join(good, "version.yml")));
    assert.ok(!existsSync(join(good, ".paw-msg")));
  } finally {
    rmTmp(base);
  }
});
