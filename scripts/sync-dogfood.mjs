// Rebuilds this repo's own .github/ copies from the payload/ common workflows and scripts.
//
//   node scripts/sync-dogfood.mjs          # overwrite the .github/ copies from payload
//   node scripts/sync-dogfood.mjs --check  # compare only, without writing - exit 1 on drift
//
// copy = payload original -> branch placeholder substitution (same substitute as the installer) -> PATCHES applied.
// Differences that must exist only in the copy have to be declared in PATCHES. Hand-editing a copy is caught by --check.
// Like the installer, this uses only built-in node:* modules, with no external dependencies.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { substitute } from "../src/core/branding.js";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// This repo's branch layout - must match metadata.template.branches in version.yml.
export const REPO_BRANCHES = { main: "main", develop: "develop" };

// List only the scripts that this repo's workflows call.
// truncate_release_notes.py is Flutter-workflow-only, so it has no copy.
export const SCRIPTS = ["changelog_manager.py", "issue_helper.py", "messages.py", "version_manager.py"];

// Intentional differences that exist only in the copy. `from` must appear exactly once in the substituted
// payload text - if payload changes and the anchor text disappears, this fails instead of passing
// silently, forcing the list to be updated.
export const PATCHES = [
  {
    file: "workflows/PROJECT-COMMON-ISSUE-HELPER.yaml",
    reason: "This repo auto-creates issue branches and cuts them from develop",
    from:
      '      ISSUE_HELPER_CREATE_BRANCH: "false" # @wizard ask:false\n' +
      '      ISSUE_HELPER_BASE_BRANCH: "main"\n',
    to:
      '      ISSUE_HELPER_CREATE_BRANCH: "true" # @wizard ask:false\n' +
      '      ISSUE_HELPER_BASE_BRANCH: "develop"\n',
  },
  {
    file: "workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml",
    reason: "Rewrite the header comment from the copy's point of view",
    from:
      "# This file and its self-copy (.github/workflows/) intentionally\n" +
      "# differ by one step — the self-copy also triggers NPM-PUBLISH via\n" +
      "# workflow_dispatch right after the release is created. NPM-PUBLISH.yaml is\n" +
      "# a repo-only workflow (not shipped in payload), so wiring that dispatch\n" +
      "# here would make every wizard-installed repo call a workflow that doesn't\n" +
      "# exist for them on every release.\n",
    to:
      "# Right after the GitHub Release is created, this self-copy\n" +
      "# (unlike the payload template) also triggers NPM-PUBLISH via\n" +
      "# workflow_dispatch, since NPM-PUBLISH.yaml is a repo-only workflow that\n" +
      "# doesn't exist in payload — see PROJECT-COMMON-RELEASE-PUBLISH.yaml in\n" +
      "# payload/workflows/common for why that file intentionally omits this step.\n",
  },
  {
    file: "workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml",
    reason: "npm publishing is handled by this repo's own NPM-PUBLISH workflow",
    from:
      '          echo "$(m wf_release.published version=\"$VERSION\")"\n' +
      "\n" +
      "      - name: Trigger README-VERSION-UPDATE\n",
    to:
      '          echo "$(m wf_release.published version=\"$VERSION\")"\n' +
      "\n" +
      "      - name: Trigger NPM-PUBLISH\n" +
      "        if: steps.gate.outputs.proceed == 'true' && steps.version.outputs.release_exists != 'true'\n" +
      "        continue-on-error: true\n" +
      "        env:\n" +
      "          GH_TOKEN: ${{ github.token }}\n" +
      "        run: |\n" +
      '          VERSION="${{ steps.version.outputs.version }}"\n' +
      '          gh workflow run NPM-PUBLISH.yaml --ref main -f tag="v${VERSION}"\n' +
      '          echo "NPM-PUBLISH workflow_dispatch trigger requested (works without WORKFLOW_PAT)"\n' +
      "\n" +
      "      - name: Trigger README-VERSION-UPDATE\n",
  },
];

function countOccurrences(text, needle) {
  let count = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) count++;
  return count;
}

// List of expected copies [{ rel, source, expected }]. rel is the path relative to .github/.
// Throws if a patch anchor is not found - copies are never built by guesswork.
export function buildExpected(root = DEFAULT_ROOT) {
  const commonDir = join(root, "payload", "workflows", "common");
  const entries = [];
  // Scan the common workflows directory as-is so newly added files are always included
  for (const name of readdirSync(commonDir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const source = join("payload", "workflows", "common", name);
    entries.push({ rel: `workflows/${name}`, source, expected: substitute(readFileSync(join(root, source), "utf8"), REPO_BRANCHES) });
  }
  for (const name of SCRIPTS) {
    const source = join("payload", "scripts", name);
    entries.push({ rel: `scripts/${name}`, source, expected: readFileSync(join(root, source), "utf8") });
  }

  for (const patch of PATCHES) {
    const entry = entries.find((e) => e.rel === patch.file);
    if (!entry) throw new Error(`Patch target is missing from payload: ${patch.file}`);
    const n = countOccurrences(entry.expected, patch.from);
    if (n !== 1) {
      throw new Error(`Patch anchor text was found ${n} times in ${patch.file} (must be exactly 1) - update PATCHES: ${patch.reason}`);
    }
    entry.expected = entry.expected.replace(patch.from, () => patch.to);
  }
  return entries;
}

// Compares with the actual .github/ copies and returns only the drifted entries.
export function findDrift(root = DEFAULT_ROOT) {
  return buildExpected(root).filter(({ rel, expected }) => {
    const target = join(root, ".github", rel);
    return !existsSync(target) || readFileSync(target, "utf8") !== expected;
  });
}

// First differing line number - shows where a long workflow starts to differ.
function firstDiffLine(actual, expected) {
  const a = actual.split("\n");
  const e = expected.split("\n");
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    if (a[i] !== e[i]) return i + 1;
  }
  return 0;
}

function main(argv) {
  const check = argv.includes("--check");
  const root = DEFAULT_ROOT;
  const drift = findDrift(root);

  if (check) {
    if (drift.length === 0) {
      console.log("dogfood: .github/ copies match payload");
      return 0;
    }
    for (const { rel, source, expected } of drift) {
      const target = join(root, ".github", rel);
      const where = existsSync(target) ? `differs from line ${firstDiffLine(readFileSync(target, "utf8"), expected)}` : "copy missing";
      console.error(`dogfood mismatch: .github/${rel} (${where}, source ${source})`);
    }
    console.error("Rebuild the copies with npm run sync:dogfood, and declare copy-only differences in PATCHES in scripts/sync-dogfood.mjs.");
    return 1;
  }

  for (const { rel, expected } of drift) {
    const target = join(root, ".github", rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, expected);
    console.log(`dogfood updated: .github/${rel}`);
  }
  if (drift.length === 0) console.log("dogfood: no copies to update");
  return 0;
}

// import.meta.url resolves to the real path but argv[1] keeps the link path, so compare both via realpath
function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.exitCode = main(process.argv.slice(2));
}
