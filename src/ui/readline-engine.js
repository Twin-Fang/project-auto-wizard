// Interactive prompt engine built on node:readline (replaces @clack/prompts).
// WHY: @clack/prompts 1.7.0 has a bug on Windows TTY consoles where the Enter (return) key is not
//   handled and the prompt hangs. node:readline keypress events work correctly on Windows.
//   Implementing the menus ourselves means zero external dependencies -> safe on internal networks too.
//
// Contract: ESC returns the CANCEL symbol (callers interpret it as "default/stay"). Every function is async.
//       Ctrl+C, Ctrl+D and stdin close abort - rejected as PromptAbortError so any question can be left immediately.
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { visualWidth } from "./ansi.js";
import { t } from "../i18n/index.js";

export const CANCEL = Symbol("cancel");

// User abort (Ctrl+C etc.). Unlike ESC it must not continue with defaults, so it propagates as an exception, not a return value -
// callers interpreted CANCEL differently, and some forced the install with defaults or redrew the same screen forever.
// signal: name of the external signal ("SIGINT"/"SIGTERM") when aborted by one - aligns the exit code with the shell convention (128+number).
export class PromptAbortError extends Error {
  constructor(signal = null) {
    super(t("ui.readline-engine.aborted"));
    this.name = "PromptAbortError";
    this.signal = signal;
  }
}
export const isPromptAbort = (e) => e instanceof PromptAbortError;

// In raw mode Ctrl+C arrives as a keypress, not SIGINT. Ctrl+D is not EOF in raw mode either.
const isAbortKey = (key) => key.ctrl && (key.name === "c" || key.name === "d");

// External signals (kill -INT / kill -TERM) arrive as process signals, not keypresses. Without a listener Node exits
// immediately and the hidden cursor and raw mode are never restored - while waiting for input, route them through the same abort path as keyboard Ctrl+C.
const TERM_SIGNALS = ["SIGINT", "SIGTERM"];
function onTermSignal(fn) {
  const handlers = TERM_SIGNALS.map((sig) => [sig, () => fn(sig)]);
  for (const [sig, h] of handlers) process.on(sig, h);
  return () => { for (const [sig, h] of handlers) process.removeListener(sig, h); };
}

// ── ANSI helpers (replaces picocolors - zero dependencies) ───────────
const ESC = "\x1b[";
const c = {
  reset: `${ESC}0m`, dim: `${ESC}2m`, bold: `${ESC}1m`,
  cyan: `${ESC}36m`, green: `${ESC}32m`, gray: `${ESC}90m`, yellow: `${ESC}33m`,
};
// NO_COLOR (https://no-color.org) / non-TTY guard - same rule as ansi.js (presence only, value ignored) but
// implemented locally to stay dependency-free.
// TERM=dumb cannot interpret cursor-movement/erase sequences either, not just colors - then output continues instead of redrawing.
const isDumb = () => process.env.TERM === "dumb";
const colorEnabled = () => process.env.NO_COLOR === undefined && !!stdout.isTTY && !isDumb();
const paint = (s, color, enabled = colorEnabled()) => (enabled ? `${color}${s}${c.reset}` : String(s));
// If the process ends with the cursor hidden (exception, process.exit, ...) the terminal cursor stays invisible - restore it once more on exit.
let cursorHidden = false;
let exitGuard = false;
const hideCursor = () => {
  if (isDumb()) return;
  stdout.write(`${ESC}?25l`);
  cursorHidden = true;
  if (!exitGuard) {
    exitGuard = true;
    process.once("exit", () => { if (cursorHidden) stdout.write(`${ESC}?25h`); });
  }
};
const showCursor = () => {
  if (isDumb()) return;
  stdout.write(`${ESC}?25h`);
  cursorHidden = false;
};

// Symbols (keeps the clack look)
const S_ACTIVE = paint("●", c.green);
const S_INACTIVE = paint("○", c.dim);
const S_CHECK_ON = paint("◼", c.green);
const S_CHECK_OFF = paint("◻", c.dim);
const S_BAR = paint("│", c.gray);
const S_Q = paint("◆", c.cyan);
const S_DONE = paint("◇", c.green);

// Number of rows a line actually occupies in the terminal - lines wider than the terminal wrap into several rows.
// Moving up only by the logical line count would leave the wrapped top part uncleared and stack copies on screen.
export function physicalRows(line, columns = stdout.columns) {
  if (!columns) return 1;
  return Math.max(1, Math.ceil(visualWidth(line) / columns));
}

// Renderer that erases several lines and returns the cursor to the start of the block.
// Moves up by the number of physical rows drawn last time, erases, and redraws.
function makeRenderer() {
  let prevLines = 0;
  return {
    render(lines) {
      if (isDumb()) { stdout.write(lines.join("\n") + "\n"); return; }
      if (prevLines > 0) stdout.write(`${ESC}${prevLines}A`); // up
      stdout.write(`${ESC}0J`); // erase everything below the cursor
      stdout.write(lines.join("\n") + "\n");
      prevLines = lines.reduce((n, l) => n + physicalRows(l), 0);
    },
    reset() { prevLines = 0; },
  };
}

// Common wrapper for raw keypress sessions. Ends when onKey(str,key) returns a value.
// The result is produced by the caller's onKey; CANCEL on cancel.
function keySession(renderFn, onKey) {
  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;
    emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    hideCursor();

    const cleanup = () => {
      stdin.removeListener("keypress", handler);
      stdin.removeListener("end", onEnd);
      offSignal();
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      showCursor();
    };
    const offSignal = onTermSignal((sig) => {
      cleanup();
      stdout.write("\n");
      reject(new PromptAbortError(sig));
    });

    // stdin closed (EOF, dropped SSH connection, ...) - no more input can arrive, so abort.
    // Returning CANCEL would make screens that read it as "stay" ask again and wait forever.
    const onEnd = () => {
      cleanup();
      reject(new PromptAbortError());
    };

    const handler = (str, key) => {
      key = key || {};
      if (isAbortKey(key)) {
        cleanup();
        stdout.write("\n");
        reject(new PromptAbortError());
        return;
      }
      if (key.name === "escape") {
        cleanup();
        resolve(CANCEL);
        return;
      }
      const done = onKey(str, key);
      if (done !== undefined) {
        cleanup();
        resolve(done);
      } else {
        renderFn();
      }
    };
    stdin.on("keypress", handler);
    stdin.on("end", onEnd);
    renderFn(); // initial render
  });
}

// ── Single select (arrow keys + Enter) ───────────────────────────────
// options: [{value,label,hint?}]. Returns: the selected value or CANCEL.
export async function select({ message, options, initialIndex = 0 }) {
  if (!stdin.isTTY) {
    // Non-TTY: return the default (first item) - guards piped environments
    return options[initialIndex]?.value;
  }
  const r = makeRenderer();
  let idx = Math.max(0, Math.min(initialIndex, options.length - 1));

  const draw = () => {
    const lines = [S_BAR, `${S_Q}  ${paint(message, c.bold)}`];
    options.forEach((o, i) => {
      const sel = i === idx;
      const marker = sel ? S_ACTIVE : S_INACTIVE;
      const label = sel ? paint(o.label, c.cyan) : o.label;
      const hint = o.hint && sel ? paint(`  (${o.hint})`, c.dim) : "";
      lines.push(`${S_BAR}  ${marker} ${label}${hint}`);
    });
    lines.push(paint(t("ui.readline-engine.footer.select"), c.gray));
    r.render(lines);
  };

  const result = await keySession(draw, (str, key) => {
    if (key.name === "up" || key.name === "k") { idx = (idx - 1 + options.length) % options.length; return; }
    if (key.name === "down" || key.name === "j") { idx = (idx + 1) % options.length; return; }
    // Number jump (1-9)
    if (/^[1-9]$/.test(str || "")) {
      const n = Number(str) - 1;
      if (n < options.length) { idx = n; return; }
      return;
    }
    if (key.name === "return" || key.name === "enter") return options[idx].value;
    return; // any other key: ignore and continue
  });

  // Redraw the confirmed screen (◇ done symbol + chosen value)
  if (result !== CANCEL) {
    const chosen = options.find((o) => o.value === result);
    r.render([S_BAR, `${S_DONE}  ${paint(message, c.dim)}`, `${S_BAR}  ${paint(chosen?.label ?? "", c.dim)}`]);
  }
  return result;
}

// ── Multi select (Space toggle + Enter) ──────────────────────────────
// options: [{value,label,hint?,disabled?}]. Returns: array of selected values or CANCEL.
export async function multiselect({ message, options, initialValues = [], required = false }) {
  if (!stdin.isTTY) {
    return initialValues.length ? [...initialValues] : (required ? [options[0]?.value].filter(Boolean) : []);
  }
  const r = makeRenderer();
  let idx = 0;
  const chosen = new Set(initialValues);
  let warn = "";

  const draw = () => {
    const lines = [S_BAR, `${S_Q}  ${paint(message, c.bold)}`];
    options.forEach((o, i) => {
      const cur = i === idx;
      const box = chosen.has(o.value) ? S_CHECK_ON : S_CHECK_OFF;
      const pointer = cur ? paint("❯", c.cyan) : " ";
      const label = cur ? paint(o.label, c.cyan) : (o.disabled ? paint(o.label, c.dim) : o.label);
      const hint = o.hint ? paint(`  (${o.hint})`, c.dim) : "";
      lines.push(`${S_BAR} ${pointer} ${box} ${label}${hint}`);
    });
    if (warn) lines.push(paint(`   ${warn}`, c.yellow));
    lines.push(paint(t("ui.readline-engine.footer.multiselect"), c.gray));
    r.render(lines);
  };

  const result = await keySession(draw, (str, key) => {
    warn = "";
    if (key.name === "up" || key.name === "k") { idx = (idx - 1 + options.length) % options.length; return; }
    if (key.name === "down" || key.name === "j") { idx = (idx + 1) % options.length; return; }
    if (key.name === "space" || str === " ") {
      const o = options[idx];
      if (o.disabled) { warn = t("ui.readline-engine.warn.disabled"); return; }
      if (chosen.has(o.value)) chosen.delete(o.value); else chosen.add(o.value);
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      if (required && chosen.size === 0) { warn = t("ui.readline-engine.warn.required"); return; }
      return [...chosen];
    }
    return;
  });

  if (result !== CANCEL) {
    const labels = options.filter((o) => chosen.has(o.value)).map((o) => o.label).join(", ") || t("ui.readline-engine.none");
    r.render([S_BAR, `${S_DONE}  ${paint(message, c.dim)}`, `${S_BAR}  ${paint(labels, c.dim)}`]);
  }
  return result;
}

// ── Text input (Enter confirms, empty input = default) ────────────────
// Returns: the typed string (defaultValue on empty input) or CANCEL.
export async function text({ message, defaultValue = "" }) {
  if (!stdin.isTTY) return defaultValue;
  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;
    emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    let buf = "";

    // A dumb terminal cannot erase lines, so write the prompt once and just append typed characters.
    const dumb = isDumb();
    let prevRows = 0; // physical rows the previous prompt occupied - long prompts wrap into several rows
    const prompt = () => {
      if (dumb) {
        stdout.write(`${S_Q}  ${message} ${defaultValue ? `[${defaultValue}] ` : ""}`);
        return;
      }
      // The cursor is on the last wrapped row, so move up to the first row and erase everything below
      stdout.write(prevRows > 1 ? `\r${ESC}${prevRows - 1}A${ESC}0J` : `\r${ESC}0J`);
      const shown = buf.length ? buf : paint(defaultValue || "", c.dim);
      const line = `${S_Q}  ${paint(message, c.bold)} ${shown}`;
      stdout.write(line);
      prevRows = physicalRows(line);
    };

    const cleanup = () => {
      stdin.removeListener("keypress", handler);
      stdin.removeListener("end", onEnd);
      offSignal();
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\n");
    };
    const offSignal = onTermSignal((sig) => {
      cleanup();
      reject(new PromptAbortError(sig));
    });

    // stdin closed (EOF) - no more input can arrive, so abort.
    const onEnd = () => {
      cleanup();
      reject(new PromptAbortError());
    };

    const handler = (str, key) => {
      key = key || {};
      if (isAbortKey(key)) { cleanup(); reject(new PromptAbortError()); return; }
      if (key.name === "escape") { cleanup(); resolve(CANCEL); return; }
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(buf.length ? buf : defaultValue);
        return;
      }
      if (key.name === "backspace") {
        if (dumb && buf.length) stdout.write("\b \b");
        buf = buf.slice(0, -1);
        if (!dumb) prompt();
        return;
      }
      // Regular character (control characters excluded)
      if (str && !key.ctrl && !key.meta && str.length === 1 && str >= " ") {
        buf += str;
        if (dumb) stdout.write(str); else prompt();
        return;
      }
    };
    stdin.on("keypress", handler);
    stdin.on("end", onEnd);
    prompt();
  });
}

// ── Y/N confirm (left/right or y/n, Enter confirms) ──────────────────
// Returns: true/false or CANCEL.
export async function confirm({ message, initialValue = true }) {
  if (!stdin.isTTY) return initialValue;
  const r = makeRenderer();
  let val = initialValue;

  const draw = () => {
    const yes = val ? paint(`● ${t("ui.readline-engine.yes")}`, c.green) : paint(`○ ${t("ui.readline-engine.yes")}`, c.dim);
    const no = !val ? paint(`● ${t("ui.readline-engine.no")}`, c.green) : paint(`○ ${t("ui.readline-engine.no")}`, c.dim);
    r.render([S_BAR, `${S_Q}  ${paint(message, c.bold)}`, `${S_BAR}  ${yes}   ${no}`,
      paint(t("ui.readline-engine.footer.confirm"), c.gray)]);
  };

  const result = await keySession(draw, (str, key) => {
    if (key.name === "left" || key.name === "right" || key.name === "tab") { val = !val; return; }
    if ((str || "").toLowerCase() === "y") { val = true; return; }
    if ((str || "").toLowerCase() === "n") { val = false; return; }
    if (key.name === "return" || key.name === "enter") return val;
    return;
  });

  if (result !== CANCEL) {
    r.render([S_BAR, `${S_DONE}  ${paint(message, c.dim)}`, `${S_BAR}  ${paint(result ? t("ui.readline-engine.yes") : t("ui.readline-engine.no"), c.dim)}`]);
  }
  return result;
}

// ── Output helpers (replace clack intro/outro/note/cancel) ────────────
export function intro(text) { stdout.write(`\n${paint("┌", c.gray)}  ${paint(text, c.bold)}\n`); }
export function outro(text) { stdout.write(`${paint("└", c.gray)}  ${paint(text, c.green)}\n\n`); }
export function cancelMessage(text = t("ui.readline-engine.cancelled")) { stdout.write(`${paint("■", c.yellow)}  ${paint(text, c.yellow)}\n`); }
export function note(text, title = "") {
  const lines = String(text).split("\n");
  stdout.write(`${paint("○", c.cyan)} ${paint(title, c.bold)}\n`);
  for (const l of lines) stdout.write(`${S_BAR}  ${l}\n`);
  stdout.write(`${S_BAR}\n`);
}
export function log(text = "") { stdout.write(`${text}\n`); }
