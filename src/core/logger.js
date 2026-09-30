// Execution trace log - records "what was done, in what order, and why" chronologically.
//
// Why append immediately: the moment you most want to see when debugging is right before a crash.
// A structure that writes everything at the end leaves nothing if an exception is thrown (the old install-log.js did).
//
// Why local-only: so the level of detail is not constrained. A .gitignore placed inside the log
// directory takes only that folder out of tracking - the root .gitignore is left alone.
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { t } from "../i18n/index.js";

export const LOG_DIR = ".github/.wizard/logs";
const KEEP = 20;              // number of log files to keep
const GITIGNORE_BODY = "*\n!.gitignore\n";

// Keys whose values may hold secrets - none of the current prompts do (domain, path, port, auth 'method'),
// but this is in place from the start so future additions are not logged in plain text.
const SECRET_KEY_RE = /(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL)/i;
const MASK = "***";

let state = null; // { targetRoot, name, header, file, rel, clock, startedAt, disabled }

export function maskValue(key, value) {
  // Keys like SSH_AUTH_METHOD hold only a "method", not a secret - not masked even though the name contains KEY.
  if (key === "SSH_AUTH_METHOD") return value;
  return SECRET_KEY_RE.test(key) ? MASK : value;
}

// "2026-08-26 12:03:41" -> "20260826-120341", so the filename doubles as the sort key.
export function stampFrom(now = "") {
  const m = String(now).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "unknown";
  return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
}

// A seconds-only name would overwrite the previous run's log when runs follow within the same second - milliseconds are appended.
// Milliseconds are also in time order, so the premise that name order equals run order (rotate) still holds.
export function logFilename(now, action = "install", ms = 0) {
  return `${stampFrom(now)}-${String(ms).padStart(3, "0")}-${action}.log`;
}

// If the name already exists (another process opened one in the same millisecond), -2, -3 is appended for a new file.
// The wx flag decides "create only if absent" atomically, so concurrent runs never overwrite each other.
function createUnique(dir, base, header) {
  const stem = base.replace(/\.log$/, "");
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? base : `${stem}-${n}.log`;
    try {
      writeFileSync(join(dir, name), header, { flag: "wx" });
      return name;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  throw new Error(t("core.logger.error.nameExhausted", { base }));
}

// Keep only the latest KEEP files, deleting the oldest first. Filenames ascend by time, so name sorting is enough.
// A new file is about to be added, so trim down to KEEP-1.
function rotate(dir) {
  const logs = readdirSync(dir).filter((f) => f.endsWith(".log")).sort();
  for (const f of logs.slice(0, Math.max(0, logs.length - (KEEP - 1)))) {
    rmSync(join(dir, f), { force: true });
  }
}

// The file is created on the first record - so runs that change nothing (read-only modes like status/doctor,
// or runs rejected during argument validation) do not leave a log folder and a header-only file in the target repo.
export function initLogger(targetRoot, opts = {}) {
  const { action = "install", now = "", argv = [], templateVersion = "unknown", clock = () => new Date(),
    ms = new Date().getUTCMilliseconds() } = opts;
  // Times are UTC - reading them as local time looks off by hours, so the header says so.
  const header =
    `=== project-auto-wizard v${templateVersion} | ${action} | ${now} UTC ===\n` +
    `argv    : ${["project-auto-wizard", ...argv].join(" ")}\n` +
    `node    : ${process.version} | ${process.platform} ${process.arch}\n` +
    `target  : ${targetRoot}\n\n`;
  const st = { targetRoot, name: logFilename(now, action, ms), header, file: "", rel: "", clock, startedAt: Date.now(), disabled: false };
  state = st;
  return { get path() { return st.rel; } };
}

// Opens the log file just before the first record. On failure, later records are turned off.
function open(st) {
  try {
    const dir = join(st.targetRoot, LOG_DIR);
    mkdirSync(dir, { recursive: true });
    // Respect a .gitignore the user placed themselves.
    const gi = join(dir, ".gitignore");
    if (!existsSync(gi)) writeFileSync(gi, GITIGNORE_BODY);
    rotate(dir);
    st.rel = `${LOG_DIR}/${createUnique(dir, st.name, st.header)}`;
    st.file = join(st.targetRoot, st.rel);
    return true;
  } catch (e) {
    // Failing to write the log is no reason to roll back the install - but it is not swallowed silently either.
    st.disabled = true;
    process.stderr.write(`[warn] ${t("core.logger.warn.startFailed", { message: e.message })}\n`);
    return false;
  }
}

export function resetLogger() {
  state = null;
}

// Log path of this run (repo-relative). Used by the install summary screen to tell the user.
export function currentLogPath() {
  return state && !state.disabled ? state.rel : "";
}

// Whether old-format (.md) install records remain - .gitignore has no effect on files git already
// tracks, so if any exist the user must be told to untrack them manually.
export function hasLegacyMdLogs(targetRoot) {
  try {
    const dir = join(targetRoot, LOG_DIR);
    return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".md"));
  } catch { return false; }
}

// Column widths - fixed so columns line up when skimmed and can be split by column when parsed.
const SCOPE_W = 8;  // fits the longest scope ('baseline') - misaligned columns make skimming worse
const ACTION_W = 10;

// East Asian full-width characters count as width 2 (for aligning the summary block).
const WIDE_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
const dispWidth = (s) => [...String(s)].reduce((n, c) => n + (WIDE_RE.test(c) ? 2 : 1), 0);

// The header's run time and the filename are UTC (utcNow), so line times are UTC too -
// local time would put the header and lines off by the timezone offset within the same file.
function hhmmss(date) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}.${p(date.getUTCMilliseconds(), 3)}`;
}

function write(level, scope, action, detail = "") {
  if (!state || state.disabled) return;
  if (!state.file && !open(state)) return;
  try {
    const line = `${hhmmss(state.clock())} ${level}  ${String(scope).padEnd(SCOPE_W)}  ${String(action).padEnd(ACTION_W)}  ${detail}`.trimEnd();
    appendFileSync(state.file, line + "\n");
  } catch (e) {
    // Report only on the first failure, then quietly turn off - a warning on every line would wreck the install screen.
    state.disabled = true;
    process.stderr.write(`[warn] ${t("core.logger.warn.writeStopped", { message: e.message })}\n`);
  }
}

export const log = {
  info: (scope, action, detail) => write("INFO", scope, action, detail),
  warn: (scope, action, detail) => write("WARN", scope, action, detail),
  fail: (scope, action, detail) => write("FAIL", scope, action, detail),
  // rows: Array<[label, value]> - labels are padded to align.
  summary(rows = []) {
    if (!state || state.disabled || !rows.length) return;
    if (!state.file && !open(state)) return;
    // Hangul takes 2 cells in a terminal - padding by character count looks misaligned.
    const w = Math.max(...rows.map(([k]) => dispWidth(k)));
    const body = rows.map(([k, v]) => `${k}${" ".repeat(w - dispWidth(k))} : ${v}`).join("\n");
    try {
      appendFileSync(state.file, `\n${t("core.logger.summary.title")}\n${body}\n`);
    } catch {
      state.disabled = true;
    }
  },
};

// For removal runs that may delete the log folder (.github/.wizard) itself. Writing before the delete
// loses the records along with it and raises an ENOENT warning, and writing after would resurrect the folder,
// leaving a trace even after a full removal. So records are collected and written only if the folder survives
// (if it is gone, the result is shown on screen instead).
export function logRemovals(targetRoot, entries = []) {
  if (!existsSync(dirname(join(targetRoot, LOG_DIR)))) return;
  for (const [scope, action, detail] of entries) write("INFO", scope, action, detail);
}

export function closeLogger() {
  state = null;
}
