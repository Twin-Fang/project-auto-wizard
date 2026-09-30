// First-screen banner - classic boxed style
import { A, paint, visualWidth } from "./ansi.js";
import { t } from "../i18n/index.js";

const INNER = 56; // inner box width

function boxLine(out, content = "") {
  const pad = Math.max(0, INNER - visualWidth(content));
  out(paint("║", A.cyan) + content + " ".repeat(pad) + paint("║", A.cyan) + "\n");
}

// Interactive first-screen banner - boxed title + meta lines
export function printBanner({ version, modeLabel }, out = (s) => process.stderr.write(s), columns = process.stderr.columns) {
  out("\n");
  // On terminals narrower than the box the border wraps and breaks the shape, so print just the title.
  if (columns && columns < INNER + 2) {
    out(`${paint("✦", A.yellow)} ${paint("PROJECT AUTO WIZARD", A.bold)}\n`);
  } else {
    out(paint(`╔${"═".repeat(INNER)}╗`, A.cyan) + "\n");
    boxLine(out);
    boxLine(out, `   ${paint("✦", A.yellow)}  ${paint("P R O J E C T · A U T O · W I Z A R D", A.bold)}  ${paint("✦", A.yellow)}`);
    boxLine(out);
    out(paint(`╚${"═".repeat(INNER)}╝`, A.cyan) + "\n");
  }
  out(`     🌙 Version : ${paint(`v${version}`, A.green)}\n`);
  out(`     🪐 Mode    : ${modeLabel}\n`);
  out(`     📦 Repo    : ${paint("github.com/Twin-Fang/project-auto-wizard", A.dim)}\n`);
  out("\n");
}

// Compact banner for non-interactive (--force/CI) runs - one line (minimal log noise, keeps the version traceable)
export function printBannerCompact({ version, mode }, out = (s) => process.stderr.write(s)) {
  out(`${paint("✦", A.yellow)} ${paint("project-auto-wizard", A.bold)} v${version} — ${t("ui.banner.compact", { mode })}\n`);
}
