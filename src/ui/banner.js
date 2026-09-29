// 첫 화면 배너 — 클래식 박스형
import { A, paint, visualWidth } from "./ansi.js";

const INNER = 56; // 박스 내부 폭

function boxLine(out, content = "") {
  const pad = Math.max(0, INNER - visualWidth(content));
  out(paint("║", A.cyan) + content + " ".repeat(pad) + paint("║", A.cyan) + "\n");
}

// 대화형 첫 화면 배너 — 박스 타이틀 + 메타 4줄
export function printBanner({ version, modeLabel }, out = (s) => process.stderr.write(s), columns = process.stderr.columns) {
  out("\n");
  // 상자보다 좁은 터미널에서는 테두리가 접혀 모양이 무너지므로 상자 없이 제목만 찍는다.
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

// 비대화형(--force/CI) 축약 배너 — 1줄 (사용자 확정: 로그 오염 최소 + 버전 추적)
export function printBannerCompact({ version, mode }, out = (s) => process.stderr.write(s)) {
  out(`${paint("✦", A.yellow)} ${paint("project-auto-wizard", A.bold)} v${version} — ${mode} 모드 (--force)\n`);
}
