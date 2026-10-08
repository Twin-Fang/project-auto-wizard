// Cross-platform launcher for the Python tests.
//
// `python3` does not exist on Windows - and when it does, it is a Microsoft Store
// stub that dies with exit 49. Conversely, some Linux distributions have no `python`.
// Try both names in order and pick the interpreter that actually works.
//
// Node is always present when an npm script runs, so this adds no dependency
// (keeps the zero-dependency rule). It is not in the package.json files allowlist
// (bin/, src/, payload/), so it is not shipped in the npm package.
//
// `--coverage` runs the same tests under coverage.py and writes coverage/py-coverage.json.
// coverage.py is the only non-stdlib piece and is needed only for that flag, so it is installed
// in CI (or by hand), never declared as a dependency.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const CANDIDATES = ["python3", "python"];
const UNITTEST = ["-m", "unittest", "discover", "-s", "tests/py", "-v"];
const COVERAGE = process.argv.includes("--coverage");
// The rcfile measures payload/scripts only and follows the scripts some tests start as subprocesses.
const RCFILE = "--rcfile=tests/py/.coveragerc";

// Checks whether the name is a Python that is actually usable.
// The Windows Store stub does not return 0 even for `--version`, so it is filtered out here.
function isUsable(cmd) {
  const probe = spawnSync(cmd, ["-c", "import sys; print(sys.version_info[0])"], {
    encoding: "utf8",
    // Send EOF immediately so a stub does not hang waiting on stdin
    input: "",
  });
  return probe.status === 0 && probe.stdout.trim() === "3";
}

const python = CANDIDATES.find(isUsable);

if (!python) {
  console.error(
    `Python 3 not found (tried: ${CANDIDATES.join(", ")}).\n` +
    "Install Python 3, add it to PATH, and run again."
  );
  process.exit(1);
}

// Force UTF-8 so non-ASCII output is not garbled by the Windows default code page (cp949).
// Also keep __pycache__ from being left behind when payload/scripts is imported - otherwise it
// ships in the npm package and the original-author-name guard test catches the pyc and fails
// from the second run on.
const ENV = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" };

function run(args) {
  return spawnSync(python, args, { stdio: "inherit", env: ENV }).status ?? 1;
}

if (!COVERAGE) process.exit(run(UNITTEST));

// Fail with a hint instead of a "No module named coverage" traceback. Probe with `-m coverage`
// rather than `import coverage`: the coverage/ output folder in the cwd imports as an empty
// namespace package, so a bare import succeeds even when coverage.py is missing.
if (spawnSync(python, ["-m", "coverage", "--version"], { env: ENV }).status !== 0) {
  console.error(`coverage.py is not installed for ${python}. Run: ${python} -m pip install coverage`);
  process.exit(1);
}

// The rcfile keeps the data file under coverage/, which must exist before the run starts.
mkdirSync("coverage", { recursive: true });
// Leftover data from an earlier run would be merged into this one, so erase it first.
run(["-m", "coverage", "erase", RCFILE]);
const status = run(["-m", "coverage", "run", RCFILE, ...UNITTEST]);
// Report even when tests fail, but keep the test exit code: a red run must stay red.
run(["-m", "coverage", "combine", RCFILE]);
run(["-m", "coverage", "report", RCFILE]);
run(["-m", "coverage", "json", RCFILE, "-o", "coverage/py-coverage.json"]);
process.exit(status);
