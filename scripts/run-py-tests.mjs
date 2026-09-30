// Cross-platform launcher for the Python tests.
//
// `python3` does not exist on Windows - and when it does, it is a Microsoft Store
// stub that dies with exit 49. Conversely, some Linux distributions have no `python`.
// Try both names in order and pick the interpreter that actually works.
//
// Node is always present when an npm script runs, so this adds no dependency
// (keeps the zero-dependency rule). It is not in the package.json files allowlist
// (bin/, src/, payload/), so it is not shipped in the npm package.
import { spawnSync } from "node:child_process";

const CANDIDATES = ["python3", "python"];
const ARGS = ["-m", "unittest", "discover", "-s", "tests/py", "-v"];

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
const result = spawnSync(python, ARGS, {
  stdio: "inherit",
  env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
});

process.exit(result.status ?? 1);
