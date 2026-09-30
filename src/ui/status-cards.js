// First-screen status layer - detection log, analysis card, new-install/update detection
// (the Breaking Changes box is handled by core/breaking-check.js)
import { A, paint } from "./ansi.js";
import { t } from "../i18n/index.js";
import { DEFAULT_DEPLOY_MODE } from "../core/flutter-options.js";

const GUT = paint("│", A.gray);
const HEAD = paint("◆", A.cyan);
const OK = paint("✓", A.green);

// Detection log - which type was detected and on what evidence
// markers: Map<type, file actually found>.
// warnings: warnings raised during detection. Detection runs before the box is drawn, so warnings
//           used to leak above the box and look like they belonged to the previous question - print them inside the box.
export function printDetectionLog({ types = [], version = "", branch = "", markers = new Map(), warnings = [] },
  out = (s) => process.stderr.write(s)) {
  out(`${paint("┌", A.gray)}  ${t("ui.status-cards.detect.title")}\n`);
  if (types.length && !(types.length === 1 && types[0] === "basic")) {
    for (const type of types) {
      const marker = markers.get(type);
      const found = marker
        ? t("ui.status-cards.detect.foundWithMarker", { marker, type: paint(type, A.bold) })
        : t("ui.status-cards.detect.found", { type: paint(type, A.bold) });
      out(`${GUT}  ${OK} ${found}\n`);
    }
  } else {
    out(`${GUT}  ${paint("─", A.dim)} ${t("ui.status-cards.detect.none", { type: paint("basic", A.bold) })}\n`);
  }
  out(`${GUT}  ${OK} ${t("ui.status-cards.detect.versionBranch", { version: paint(`v${version}`, A.green), branch: paint(branch, A.green) })}\n`);
  for (const w of warnings) out(`${GUT}  ${paint(w, A.yellow)}\n`);
  out(`${GUT}\n`);
}

// Project analysis overview card
export function printAnalysisCard({ mode = "", modeLabel = "", types = [], version = "", branch = "",
  paths = new Map(), showOptional = false,
  flutter = null, envModeDefault = "", options = null },
  out = (s) => process.stderr.write(s)) {
  out(`${HEAD}  ${paint(t("ui.status-cards.card.title"), A.bold)}\n`);
  // Label column width differs per language (English labels are longer than the Korean ones)
  const labelWidth = Number(t("ui.status-cards.card.labelWidth"));
  const row = (icon, label, value) => out(`${GUT}  ${icon} ${label.padEnd(labelWidth)} ${value}\n`);
  row("📂", types.length > 1 ? t("ui.status-cards.card.typeMulti") : t("ui.status-cards.card.type"), paint(types.join(", ") || "basic", A.bold));
  row("🌙", t("ui.status-cards.card.version"), paint(`v${version}`, A.green));
  row("🌿", t("ui.status-cards.card.branch"), branch);
  if (modeLabel || mode) row("💫", t("ui.status-cards.card.mode"), modeLabel || mode);
  if (showOptional) {
    // Flutter options - show the chosen values on the pre-confirmation screen too.
    if (flutter && types.includes("flutter")) {
      const stores = flutter.stores ?? [];
      const modeParts = stores.map(
        (p) => `${p}=${(p === "android" ? flutter.androidDeployMode : flutter.iosDeployMode) || DEFAULT_DEPLOY_MODE}`,
      );
      row("⚙️", t("ui.status-cards.card.envMode"), flutter.envMode || envModeDefault);
      row("🏬", t("ui.status-cards.card.stores"), stores.length ? stores.join(", ") : t("ui.status-cards.card.none"));
      row("🚀", t("ui.status-cards.card.deployMode"), modeParts.length ? modeParts.join(" ") : t("ui.status-cards.card.none"));
    }
  }
  // Optional workflows - a saved value is used without asking, so show the current value before confirmation.
  if (options) {
    const onOff = (v) => (v ? paint(t("ui.status-cards.card.on"), A.green) : paint(t("ui.status-cards.card.off"), A.dim));
    row("🔢", t("ui.status-cards.card.autoBump"), onOff(options.semverAuto));
    row("🤖", "Copilot", onOff(options.copilotAi));
  }
  // Monorepo paths - shown when at least one entry is not the root
  const nonRoot = [...paths.entries()].filter(([, p]) => p && p !== ".");
  if (nonRoot.length) {
    row("📁", t("ui.status-cards.card.paths"), [...paths.entries()].map(([type, p]) => `${type}→${p}`).join(", "));
  }
  out(`${GUT}\n`);
}

// New-install vs update line (the Breaking box is in breaking-check.js)
export function printInstallKind({ currentTemplateVersion = "", templateVersion = "" }, out = (s) => process.stderr.write(s)) {
  if (currentTemplateVersion) {
    out(`${GUT}  ♻️  ${t("ui.status-cards.kind.update", { title: paint(t("ui.status-cards.kind.updateTitle"), A.bold), from: paint(`v${currentTemplateVersion}`, A.dim), to: paint(`v${templateVersion}`, A.green) })}\n`);
  } else {
    out(`${GUT}  🆕 ${t("ui.status-cards.kind.fresh", { title: paint(t("ui.status-cards.kind.freshTitle"), A.bold), version: paint(`v${templateVersion}`, A.green) })}\n`);
  }
  out(`${GUT}\n`);
}
