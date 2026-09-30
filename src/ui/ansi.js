// Shared ANSI helpers used by banner/status-cards/summary (independent of readline-engine's own helpers, zero dependencies)
const E = "\x1b[";
export const A = {
  reset: `${E}0m`,
  bold: `${E}1m`,
  dim: `${E}2m`,
  cyan: `${E}36m`,
  green: `${E}32m`,
  yellow: `${E}33m`,
  red: `${E}31m`,
  magenta: `${E}35m`,
  gray: `${E}90m`,
};

// Disable color when NO_COLOR (https://no-color.org) is set or the target stream is not a TTY.
// Per the no-color.org spec only the presence of NO_COLOR matters, not its value: NO_COLOR="" (empty)
// counts as set, so we check presence instead of truthiness (`!process.env.NO_COLOR`).
// TERM=dumb (Emacs shell, some CI pseudo-TTYs) cannot interpret ANSI sequences and prints them raw, so color is off too.
export const isDumbTerminal = () => process.env.TERM === "dumb";
export function colorEnabled(stream = process.stdout) {
  return process.env.NO_COLOR === undefined && !!stream.isTTY && !isDumbTerminal();
}

export const paint = (s, color, enabled = colorEnabled()) => (enabled ? `${color}${s}${A.reset}` : String(s));

// Approximate display width (CJK 2 columns, ANSI sequences 0) - used to align the right edge of boxes
export function visualWidth(s) {
  const plain = String(s).replace(/\x1b\[[0-9;]*m/g, "");
  let w = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    // Hangul/CJK/emoji take roughly 2 columns (terminal convention)
    w += (cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3)
      || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || cp >= 0x1f300)) ? 2 : 1;
  }
  return w;
}
