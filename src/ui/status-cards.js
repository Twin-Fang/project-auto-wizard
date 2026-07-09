// 첫 화면 상태 표시 층 (#446 층2·3·5) — 감지 로그 · 분석 카드 · 신규/업데이트 판별
// (층5의 Breaking Changes 박스는 core/breaking-check.js가 담당.
//  원본의 층4 IDE Skills 상태는 project-auto-wizard 스코프 제외 — Agent Skills 미포함)
import { A, paint } from "./ansi.js";
import { markerForType } from "../core/detect.js";

const GUT = paint("│", A.gray);
const HEAD = paint("◆", A.cyan);
const OK = paint("✓", A.green);

// 층2 — 감지 로그 (.ps1 감지 진행 표시 등가)
export function printDetectionLog({ types = [], version = "", branch = "" }, out = (s) => process.stdout.write(s)) {
  out(`${paint("┌", A.gray)}  🔍 프로젝트를 살펴보는 중...\n`);
  if (types.length && !(types.length === 1 && types[0] === "basic")) {
    for (const t of types) {
      const marker = markerForType(t);
      out(`${GUT}  ${OK} ${marker ? `${marker} 발견 → ` : ""}${paint(t, A.bold)} 감지\n`);
    }
  } else {
    out(`${GUT}  ${paint("─", A.dim)} 마커 파일 없음 → ${paint("basic", A.bold)} (직접 선택 가능)\n`);
  }
  out(`${GUT}  ${OK} 버전: ${paint(`v${version}`, A.green)} · 브랜치: ${paint(branch, A.green)}\n`);
  out(`${GUT}\n`);
}

// 층3 — 프로젝트 분석 개요 카드 (.ps1 Print-ProjectAnalysis 등가+)
export function printAnalysisCard({ mode = "", modeLabel = "", types = [], version = "", branch = "",
  includeNexus = null, includeSecretBackup = null, paths = new Map(), showOptional = false },
  out = (s) => process.stdout.write(s)) {
  out(`${HEAD}  ${paint("프로젝트 분석 결과", A.bold)}\n`);
  const row = (icon, label, value) => out(`${GUT}  ${icon} ${label.padEnd(10)} ${value}\n`);
  row("📂", types.length > 1 ? "타입(멀티)" : "타입", paint(types.join(", ") || "basic", A.bold));
  row("🌙", "버전", paint(`v${version}`, A.green));
  row("🌿", "브랜치", branch);
  if (modeLabel || mode) row("💫", "통합 모드", modeLabel || mode);
  if (showOptional) {
    row("📦", "Nexus", includeNexus === true ? paint("포함", A.green) : paint("제외", A.dim));
    row("🔐", "Secret백업", includeSecretBackup === true ? paint("포함", A.green) : paint("제외", A.dim));
  }
  // 모노레포 경로 — 루트가 아닌 항목이 하나라도 있으면 표시
  const nonRoot = [...paths.entries()].filter(([, p]) => p && p !== ".");
  if (nonRoot.length) {
    row("📁", "경로", [...paths.entries()].map(([t, p]) => `${t}→${p}`).join(", "));
  }
  out(`${GUT}\n`);
}

// 층5 — 신규 통합 vs 업데이트 판별 라인 (Breaking 박스는 breaking-check.js)
export function printInstallKind({ currentTemplateVersion = "", templateVersion = "" }, out = (s) => process.stdout.write(s)) {
  if (currentTemplateVersion) {
    out(`${GUT}  ♻️  ${paint("업데이트", A.bold)} — 템플릿 ${paint(`v${currentTemplateVersion}`, A.dim)} → ${paint(`v${templateVersion}`, A.green)}\n`);
  } else {
    out(`${GUT}  🆕 ${paint("신규 통합", A.bold)} — 이 프로젝트에 처음 설치합니다 (템플릿 ${paint(`v${templateVersion}`, A.green)})\n`);
  }
  out(`${GUT}\n`);
}
