// doctor command: local environment diagnosis (read-only, rule-based). Delegates to the gh CLI to check remote state.
//
// Output design, borrowed from the `flutter doctor` pattern.
//   1. Each item label carries its purpose ("what this setting is for"). `WORKFLOW_PAT` alone does not tell
//      what it does in the release flow, the same reason flutter prints
//      `Android toolchain - develop for Android devices`.
//   2. The tool never judges "OK to install / not OK". It only states the facts found (N problems) and
//      leaves it to the user whether they matter.
//   3. Only problem items unfold into 4 levels (symptom -> impact -> action -> docs); healthy items collapse to one line.
//   4. Strings actually shown in the GitHub settings UI ("Read and write permissions", etc.) are not
//      translated: a translation reads well but then the item cannot be found on the real screen.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { A, paint, colorEnabled, visualWidth } from "../ui/ansi.js";
import { PATHS } from "../core/paths.js";
import { parseExisting } from "../core/version-yml.js";
import { hooksFor } from "../core/types.js";
import { t } from "../i18n/index.js";

const defaultExec = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });

// Resolution guide links. They point at English HTML anchors inside the docs site pages: auto-generated
// anchors from non-Latin headings get URL-encoded and become unreadable in a terminal.
// Getters so the link follows the output language (the localized page path comes from the catalog).
export const DOCS_SITE_URL = "https://twin-fang.github.io/project-auto-wizard";
export const DOC = {
  get postInstall() { return `${DOCS_SITE_URL}${t("cmd.doctor.docPath.postInstall")}`; },
  get flutterStore() { return `${DOCS_SITE_URL}${t("cmd.doctor.docPath.flutterStore")}`; },
};

export function runDoctor(cwd = process.cwd(), { exec = defaultExec } = {}) {
  const results = [];
  // name is the item identifier (for tests/programmatic reference), label is for display. Falls back to name when label is omitted.
  const add = (item) => { results.push({ actions: [], ...item }); return results; };

  const installed = existsSync(join(cwd, "version.yml"));
  // Not installed is not a problem: running doctor "before" installing is the normal usage path.
  const installItem = { name: t("cmd.doctor.install.name"), label: t("cmd.doctor.install.label"), purpose: t("cmd.doctor.install.purpose") };
  add(installed
    ? { ...installItem, status: "OK", value: t("cmd.doctor.install.value") }
    : { ...installItem, status: "INFO", note: [t("cmd.doctor.install.note")] });

  // Per-type local file checks (e.g. Flutter store deploy files): only local files are read, so this runs regardless of the gh lookup results.
  if (installed) {
    const existing = parseExisting(readFileSync(join(cwd, PATHS.versionFile), "utf8"));
    for (const { hook } of hooksFor(existing.types, "doctorChecks")) {
      for (const item of hook(cwd, existing, { docs: DOC })) add(item);
    }
  }

  const ghVersion = exec("gh", ["--version"]);
  if (ghVersion.error || ghVersion.status !== 0) {
    add({
      name: "gh CLI", purpose: t("cmd.doctor.gh.purpose"), status: "WARN",
      value: t("cmd.doctor.gh.notFound"),
      impact: [t("cmd.doctor.gh.notFoundImpact")],
      actions: [t("cmd.doctor.gh.notFoundAction")],
    });
    return results;
  }
  add({
    name: "gh CLI", purpose: t("cmd.doctor.gh.purpose"), status: "OK",
    value: (ghVersion.stdout || "").split("\n")[0] || t("cmd.doctor.gh.installed"),
  });

  const auth = exec("gh", ["auth", "status"]);
  const authOk = !auth.error && auth.status === 0;
  if (!authOk) {
    add({
      name: t("cmd.doctor.auth.name"), label: t("cmd.doctor.auth.label"), purpose: t("cmd.doctor.auth.purpose"), status: "FAIL",
      value: t("cmd.doctor.auth.notLoggedIn"),
      impact: [t("cmd.doctor.auth.impact")],
      actions: [t("cmd.doctor.auth.action")],
    });
    return results;
  }
  add({ name: t("cmd.doctor.auth.name"), label: t("cmd.doctor.auth.label"), purpose: t("cmd.doctor.auth.purpose"), status: "OK", value: t("cmd.doctor.auth.ok") });

  const remote = exec("git", ["-C", cwd, "remote", "get-url", "origin"]);
  const url = remote.status === 0 ? (remote.stdout || "").trim() : "";
  // Repo names may contain dots (user.github.io, next.js); strip only the trailing .git.
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(\.git)?\/?$/);
  if (!match) {
    add({
      name: t("cmd.doctor.remote.name"), purpose: t("cmd.doctor.remote.purpose"), status: "WARN",
      value: t("cmd.doctor.remote.notFound"),
      impact: [t("cmd.doctor.remote.impact")],
      actions: [t("cmd.doctor.remote.action")],
    });
    return results;
  }
  const [, owner, repo] = match;

  const perm = exec("gh", ["api", `repos/${owner}/${repo}/actions/permissions/workflow`, "--jq", ".default_workflow_permissions"]);
  const permValue = (perm.stdout || "").trim();
  // This value is the "default applied when a workflow omits permissions", not an upper bound.
  // Every workflow the wizard installs declares its own permissions (regression guard:
  // tests/node/payload-workflow-permissions.test.js), so it works even with read; this repo itself is
  // read and VERSION-CONTROL still succeeds in pushing the version commit, which is the proof.
  const PERM_PURPOSE = t("cmd.doctor.perm.purpose");
  if (perm.status !== 0) {
    // A failed lookup is not a misdiagnosis but a real lack of information; the action is to ask an admin.
    add({
      name: "Workflow permissions", purpose: PERM_PURPOSE, status: "WARN",
      value: t("cmd.doctor.perm.lookupFailed"),
      impact: [t("cmd.doctor.adminImpact")],
      actions: [t("cmd.doctor.perm.action")],
      doc: DOC.postInstall,
    });
  } else if (permValue === "write") {
    add({ name: "Workflow permissions", purpose: PERM_PURPOSE, status: "OK", value: "Read and write" });
  } else {
    // No action is needed, so this is INFO rather than WARN. A warning would announce a nonexistent problem
    // and push users toward an unnecessary permission increase, against the least-privilege principle.
    add({
      name: "Workflow permissions", purpose: PERM_PURPOSE, status: "INFO",
      note: [
        t("cmd.doctor.perm.infoCurrent", { value: permValue || t("cmd.doctor.perm.unknown") }),
        t("cmd.doctor.perm.infoAdvice"),
      ],
    });
  }

  const secrets = exec("gh", ["secret", "list", "--repo", `${owner}/${repo}`]);
  const hasPat = secrets.status === 0 && (secrets.stdout || "").split("\n").some((l) => l.startsWith("WORKFLOW_PAT"));
  add(hasPat
    ? { name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: t("cmd.doctor.pat.purpose"), status: "OK", value: t("cmd.doctor.pat.registered") }
    : {
      // No action is needed, so this is INFO rather than WARN, for the same reason as the Workflow permissions
      // item above: the fallback (wait-for-merge-and-trigger-release / Trigger NPM-PUBLISH) carries the
      // pipeline through to the end with GITHUB_TOKEN alone, so a nonexistent problem is not raised as a warning.
      name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: t("cmd.doctor.pat.purpose"), status: "INFO",
      note: [t("cmd.doctor.pat.note1"), t("cmd.doctor.pat.note2"), t("cmd.doctor.pat.note3")],
    });

  const mergeSettings = exec("gh", ["api", `repos/${owner}/${repo}`, "--jq", ".allow_merge_commit"]);
  const automergeOk = mergeSettings.status === 0 && mergeSettings.stdout.trim() === "true";
  const mergeItem = { name: t("cmd.doctor.merge.name"), label: t("cmd.doctor.merge.label"), purpose: t("cmd.doctor.merge.purpose") };
  if (mergeSettings.status !== 0) {
    add({
      ...mergeItem, status: "WARN",
      value: t("cmd.doctor.merge.lookupFailed"),
      impact: [t("cmd.doctor.adminImpact")],
      actions: [t("cmd.doctor.merge.lookupAction")],
      doc: DOC.postInstall,
    });
  } else if (automergeOk) {
    add({ ...mergeItem, status: "OK", value: t("cmd.doctor.merge.allowed") });
  } else {
    add({
      ...mergeItem, status: "WARN",
      value: t("cmd.doctor.merge.disabled"),
      impact: [t("cmd.doctor.merge.impact")],
      actions: [
        t("cmd.doctor.merge.action1"),
        t("cmd.doctor.merge.action2"),
      ],
      doc: DOC.postInstall,
    });
  }

  // Show the actual setting: telling a user who turned it on that it is off would misrepresent the current state.
  const copilotAi = installed ? parseExisting(readFileSync(join(cwd, "version.yml"), "utf8")).options.copilotAi : null;
  const copilotState = copilotAi === true
    ? t("cmd.doctor.copilot.on")
    : copilotAi === false
      ? t("cmd.doctor.copilot.off")
      : t("cmd.doctor.copilot.default");
  add({
    name: t("cmd.doctor.copilot.name"), label: t("cmd.doctor.copilot.name"), purpose: t("cmd.doctor.copilot.purpose"), status: "INFO",
    note: [
      copilotState,
      t(copilotAi === true ? "cmd.doctor.copilot.creditsOn" : "cmd.doctor.copilot.creditsOff"),
      t("cmd.doctor.copilot.fallback"),
    ],
  });

  return results;
}

const asLines = (v) => (Array.isArray(v) ? v : v ? [String(v)] : []);
const headOf = (r) => `${r.label || r.name}${r.purpose ? ` — ${r.purpose}` : ""}`;

export function printDoctorReport(results, { out = (s) => console.log(s), color = colorEnabled() } = {}) {
  const p = (s, c) => paint(s, c, color);
  const oks = results.filter((r) => r.status === "OK");
  const problems = results.filter((r) => r.status === "WARN" || r.status === "FAIL");
  const infos = results.filter((r) => r.status === "INFO");

  const lines = ["", `${p("◆", A.cyan)}  ${p(t("cmd.doctor.heading"), A.bold)} ${p("— project-auto-wizard doctor", A.dim)}`, ""];

  // Healthy items: one line each. Values are aligned to the label width (double-width CJK counting is delegated to visualWidth).
  if (oks.length) {
    const width = Math.max(...oks.map((r) => visualWidth(headOf(r))));
    for (const r of oks) {
      const head = headOf(r);
      const pad = " ".repeat(width - visualWidth(head) + 4);
      lines.push(`  ${p("[✓]", A.green)} ${head}${r.value ? `${pad}${p(r.value, A.dim)}` : ""}`);
    }
    lines.push("");
  }

  // Problems: unfold as symptom -> impact -> action -> docs.
  for (const r of problems) {
    const fail = r.status === "FAIL";
    lines.push(`  ${p(fail ? "[✗]" : "[!]", fail ? A.red : A.yellow)} ${p(headOf(r), A.bold)}`);
    if (r.value) lines.push(`      ${p(fail ? "✗" : "✗", fail ? A.red : A.yellow)} ${r.value}`);
    for (const l of asLines(r.impact)) lines.push(`        ${p(l, A.dim)}`);
    for (const a of asLines(r.actions)) lines.push(`      ${p("→", A.cyan)} ${a}`);
    if (r.doc) lines.push(`      ${p("→", A.cyan)} ${t("cmd.doctor.details")}${p(r.doc, A.dim)}`);
    lines.push("");
  }

  // Notes: guidance that needs no action.
  for (const r of infos) {
    lines.push(`  ${p("[i]", A.gray)} ${headOf(r)}`);
    for (const l of asLines(r.note)) lines.push(`      ${p(l, A.dim)}`);
  }
  if (infos.length) lines.push("");

  lines.push(summaryLine(problems, p), "");
  out(lines.join("\n"));
}

// Summary: states only the facts found instead of an "OK to install" verdict (same stance as flutter doctor's last line).
function summaryLine(problems, p) {
  if (!problems.length) return `  ${p("✓", A.green)} ${t("cmd.doctor.summaryNone")}`;
  const n = problems.length;
  if (problems.some((r) => r.status === "FAIL")) {
    return `  ${p("✗", A.red)} ${t("cmd.doctor.summaryFail", { n })}`;
  }
  return [
    `  ${p("!", A.yellow)} ${t("cmd.doctor.summaryWarn", { n })}`,
    `    ${t("cmd.doctor.summaryWarnNote", { n })}`,
  ].join("\n");
}
