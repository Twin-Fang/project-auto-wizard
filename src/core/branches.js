// Branch configuration: main/develop branches and the pr-flow / trunk-based modes.
// on: push: branches: is a static YAML value, so the wizard asks for (or takes via flags) the release/develop
// branches and substitutes the {{MAIN_BRANCH}}/{{DEVELOP_BRANCH}} placeholders (the substitution itself lives in branding.js).
// When main === develop it is trunk-based mode, and RELEASE-PUBLISH is installed alone.
import { execFile } from "node:child_process";
import { t } from "../i18n/index.js";

// Default exec: runs a git command. Returns {code, stdout, stderr}. Tests inject a mock.
export function defaultExec(cmd, args, { cwd } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// Detection: remote branch list from local git (no network, based on the origin/* refs local knows).
// Empty list when git is missing or this is not a repo (falls back to the prompt-default path).
export async function detectRemoteBranches(cwd, exec = defaultExec) {
  const r = await exec("git", ["branch", "-r", "--format=%(refname:short)"], { cwd });
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes("->")) // exclude "origin/HEAD -> origin/main"
    .map((s) => s.replace(/^origin\//, ""))
    .filter((s, i, a) => a.indexOf(s) === i);
}

// Branch name validation: on top of the git check-ref-format --branch rules, shell special characters such as
// whitespace, parentheses and quotes are rejected because the value is substituted verbatim into workflow YAML and
// shell commands. If a detection-failure value like "(unknown)" from an empty remote, or a whitespace-only input,
// were written into the trigger, the workflow would never run.
export function isValidBranchName(name) {
  if (typeof name !== "string" || name === "") return false;
  if (/[\s~^:?*[\\\x00-\x1f\x7f()"'`$;&|<>!{}]/.test(name)) return false;
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) return false;
  if (name.endsWith(".") || name.endsWith(".lock") || name === "@") return false;
  if (name.includes("..") || name.includes("//") || name.includes("@{")) return false;
  return !name.split("/").some((part) => part.startsWith("."));
}

// Notice for when the remote has no branches at all (empty remote, no origin) or develop creation was skipped.
// Without develop the pr-flow workflows are never triggered, so this must not pass silently.
export function developMissingNotice({ main, develop }) {
  return t("core.branches.developMissing", { main, develop });
}

// Decision (pure function): flags/answers to the final configuration.
// Priority: explicit values (mainBranch/developBranch), then detected default, then hard fallback (main/develop).
export function resolveBranchConfig({ mainBranch = "", developBranch = "", defaultBranch = "" } = {}) {
  const main = mainBranch || defaultBranch || "main";
  const develop = developBranch || "develop";
  return { main, develop, mode: main === develop ? "trunk-based" : "pr-flow" };
}

// Ordering for the branch selection prompt. def goes first, then priority (main/develop) in that order, at the
// front of the list. The rest keep remoteBranches' original order (alphabetical as given by git).
// Pure function: the remoteBranches original is not modified.
export function sortBranchesForSelection(remoteBranches, def, priority = ["main", "develop"]) {
  const priorityOrder = [def, ...priority].filter((b, i, arr) => arr.indexOf(b) === i);
  const inPriority = priorityOrder.filter((b) => remoteBranches.includes(b));
  const rest = remoteBranches.filter((b) => !inPriority.includes(b));
  return [...inPriority, ...rest];
}

// Creation: when develop is missing on the remote, create it from the current HEAD and push.
// confirm: async(message)->bool, the interactive confirmation. When null (--force) it is created without asking.
// exec is injectable (test mock). Returns { created, pushed?, skipped? }.
export async function ensureDevelopBranch({ develop, remoteBranches = [], confirm = null, cwd, exec = defaultExec, log = null }) {
  if (remoteBranches.includes(develop)) return { created: false };

  if (confirm) {
    const ok = await confirm(t("core.branches.confirmCreate", { develop }));
    if (ok !== true) return { created: false, skipped: true };
  }

  const br = await exec("git", ["branch", develop], { cwd });
  if (br.code !== 0) {
    // e.g. it already exists locally: just try the push
    log?.(t("core.branches.localSkipped", { develop, reason: (br.stderr || "").trim() || t("core.branches.alreadyExists") }));
  }
  const push = await exec("git", ["push", "-u", "origin", develop], { cwd });
  if (push.code !== 0) {
    log?.(t("core.branches.pushFailed", { develop }));
    return { created: true, pushed: false };
  }
  log?.(t("core.branches.created", { develop }));
  return { created: true, pushed: true };
}
