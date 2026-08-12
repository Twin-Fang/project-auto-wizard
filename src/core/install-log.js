// 설치 로그 (이슈 #79) — 실행마다 "무엇을 어떤 값으로 설치했는지"를 레포에 한 건 남긴다.
//
// 왜 필요한가: version.yml에는 버전·타입·경로·브랜치·옵션만 남는다. 감지 근거, 질문별 답변,
// 특히 환경설정 답변(도메인·포트·볼륨 경로)은 워크플로우 YAML 안으로 흩어질 뿐 한 곳에
// 기록되지 않아, 배포가 실패했을 때 "설치할 때 뭘로 답했더라"를 역추적할 방법이 없었다.
// 터미널 스크롤백은 에이전트가 볼 수 없고 다른 클론에도 남지 않는다.
//
// 위치는 .github/.wizard/ 아래 — 마법사가 이미 baseline.json을 두는 자기 메타데이터 폴더다.
// 새 최상위 폴더를 만들 이유가 없고, 삭제 모드에서도 경계가 이 폴더 하나로 끝난다.
import { join } from "node:path";
import { writeText } from "./fsutil.js";

export const LOG_DIR = ".github/.wizard/logs";

// 값에 비밀이 들어갈 수 있는 키 — 현재 질문 항목에는 없지만(도메인·경로·포트·인증 '방식'),
// 앞으로 추가될 때 그냥 평문으로 커밋되지 않도록 처음부터 걸어둔다. 이 파일은 커밋 대상이다.
const SECRET_KEY_RE = /(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL)/i;
const MASK = "***";

export function maskValue(key, value) {
  // SSH_AUTH_METHOD처럼 "방식"만 담는 키는 비밀이 아니다 — 이름에 KEY가 들어가도 마스킹하지 않는다.
  if (key === "SSH_AUTH_METHOD") return value;
  return SECRET_KEY_RE.test(key) ? MASK : value;
}

// "2026-08-12 18:15:30" → "20260812-181530". 파일명이 곧 정렬 키가 되도록.
export function stampFrom(now = "") {
  const m = String(now).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "unknown";
  return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
}

export function logFilename(now, action = "install") {
  return `${stampFrom(now)}-${action}.md`;
}

const yamlStr = (v) => `"${String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const yamlList = (arr) => `[${(arr || []).map(yamlStr).join(", ")}]`;

// 마크다운 렌더 — 상단은 기계가 읽는 front matter, 아래는 사람이 읽는 본문.
// 에이전트가 파싱만 해도 핵심을 얻고, 사람이 열면 그대로 읽힌다.
export function renderInstallLog(d = {}) {
  const {
    action = "install", at = "", templateVersion = "",
    previousTemplateVersion = "", mode = "", types = [], markers = new Map(),
    version = "", branch = "", branches = null, paths = new Map(),
    options = {}, answers = [], result = {}, unresolved = [], secrets = new Map(),
    warnings = [], cleanup = null,
  } = d;

  const L = [];
  L.push("---");
  L.push(`action: ${yamlStr(action)}`);
  L.push(`at: ${yamlStr(at)}`);
  L.push(`template_version: ${yamlStr(templateVersion)}`);
  if (previousTemplateVersion) L.push(`previous_template_version: ${yamlStr(previousTemplateVersion)}`);
  L.push(`mode: ${yamlStr(mode)}`);
  L.push(`project_types: ${yamlList(types)}`);
  L.push(`version: ${yamlStr(version)}`);
  L.push(`default_branch: ${yamlStr(branch)}`);
  if (branches) {
    L.push(`branches: { main: ${yamlStr(branches.main)}, develop: ${yamlStr(branches.develop)}, mode: ${yamlStr(branches.mode)} }`);
  }
  L.push(`unresolved_count: ${unresolved.length}`);
  L.push(`required_secrets: ${yamlList([...secrets.keys()])}`);
  L.push("---");
  L.push("");
  L.push(`# 설치 로그 — ${at}`);
  L.push("");
  L.push("project-auto-wizard가 이 레포에 무엇을 설치했는지 남긴 기록입니다. 직접 편집하지 마세요.");
  L.push("");

  L.push("## 실행");
  L.push("");
  L.push("| 항목 | 값 |");
  L.push("|---|---|");
  L.push(`| 동작 | ${action === "install" ? "신규 설치" : action === "update" ? "업데이트" : action} |`);
  L.push(`| 템플릿 버전 | ${previousTemplateVersion ? `${previousTemplateVersion} → ${templateVersion}` : templateVersion || "-"} |`);
  L.push(`| 설치 모드 | ${mode || "-"} |`);
  L.push("");

  L.push("## 감지 결과");
  L.push("");
  L.push("| 항목 | 값 | 근거 |");
  L.push("|---|---|---|");
  for (const t of types) {
    L.push(`| 타입 | ${t} | ${markers?.get?.(t) || "직접 선택"} |`);
  }
  L.push(`| 버전 | ${version} | ${d.versionSource || "자동 감지"} |`);
  L.push(`| 브랜치 | ${branch} | git |`);
  for (const [t, p] of paths) L.push(`| 경로 (${t}) | ${p} | |`);
  L.push("");
  if (warnings.length) {
    L.push("감지 중 경고:");
    L.push("");
    for (const w of warnings) L.push(`- ${w}`);
    L.push("");
  }

  L.push("## 선택 항목");
  L.push("");
  L.push("| 항목 | 값 |");
  L.push("|---|---|");
  L.push(`| 라이브러리 publish (Nexus·GitHub Packages) | ${options.nexus ? "포함" : "제외"} |`);
  L.push(`| Secret 서버 백업 | ${options.secretBackup ? "포함" : "제외"} |`);
  L.push(`| 자동 버전 승격 | ${options.semverAuto === false ? "사용 안 함" : "사용"} |`);
  L.push(`| 서버 배포 방식 | ${options.deployStyle || "-"} |`);
  L.push("");

  L.push("## 환경설정 답변");
  L.push("");
  if (!answers.length) {
    L.push("이 설치에서는 환경설정 질문이 없었습니다.");
  } else {
    L.push("`기본값` 열이 `예`면 질문에서 그대로 Enter를 누른 값입니다. 배포가 예상과 다르게 동작하면 여기부터 확인하세요.");
    L.push("");
    L.push("| 키 | 항목 | 값 | 기본값 | 사용처 |");
    L.push("|---|---|---|---|---|");
    for (const a of answers) {
      L.push(`| \`${a.key}\` | ${a.label} | \`${maskValue(a.key, a.value)}\` | ${a.isDefault ? "예" : "아니오"} | ${a.scope || ""} |`);
    }
  }
  L.push("");

  L.push("## 설치 결과");
  L.push("");
  const sec = (title, items, fmt = (x) => `- \`${x}\``) => {
    if (!items || !items.length) return;
    L.push(`### ${title} (${items.length})`);
    L.push("");
    for (const it of items) L.push(fmt(it));
    L.push("");
  };
  sec("새로 설치된 파일", result.copiedFiles);
  sec("이전 배포 방식 정리 — 삭제", cleanup?.removed);
  sec("이전 배포 방식 정리 — .bak 백업 (수정 내용 보존)", cleanup?.backedUp);
  sec("건너뛴 파일", result.skippedFiles);
  sec("백업 후 교체한 파일", result.backupFiles);
  if (result.gitignoreUpdated) { L.push("`.gitignore`를 갱신했습니다 (충돌 백업 파일 무시 항목 추가)."); L.push(""); }

  L.push("## 남은 할 일");
  L.push("");
  if (unresolved.length) {
    L.push("### ⚠️ 값이 채워지지 않은 항목");
    L.push("");
    L.push("마법사가 값을 계산하지 못해 플레이스홀더가 그대로 남았습니다. **이 상태로는 해당 워크플로우가 정상 동작하지 않습니다.** 직접 채워 주세요.");
    L.push("");
    L.push("| 파일 | 줄 | 토큰 |");
    L.push("|---|---|---|");
    for (const u of unresolved) L.push(`| \`${u.filename}\` | ${u.line} | \`${u.token}\` |`);
    L.push("");
  }
  if (secrets.size) {
    L.push("### 등록해야 하는 GitHub Secret");
    L.push("");
    L.push("Settings > Secrets and variables > Actions 에서 등록합니다. 등록 전에는 해당 워크플로우가 실패합니다.");
    L.push("");
    L.push("| Secret | 사용하는 워크플로우 |");
    L.push("|---|---|");
    for (const [name, users] of secrets) L.push(`| \`${name}\` | ${users.map((u) => `\`${u}\``).join(", ")} |`);
    L.push("");
  }
  if (!unresolved.length && !secrets.size) {
    L.push("추가로 조치할 항목이 없습니다.");
    L.push("");
  }

  return L.join("\n") + "\n";
}

// 로그 기록. 실패해도 설치 자체는 성공으로 끝나야 하므로 예외를 삼키고 null을 돌려준다 —
// 로그를 못 남긴 것이 설치를 되돌릴 이유는 아니다.
export function writeInstallLog(targetRoot, data = {}) {
  try {
    const filename = logFilename(data.at, data.action || "install");
    const rel = `${LOG_DIR}/${filename}`;
    writeText(join(targetRoot, rel), renderInstallLog(data));
    return { path: rel };
  } catch {
    return null;
  }
}
