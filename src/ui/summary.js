// 완료 요약 출력 (.sh print_summary 등가). 전부 stderr.
// ctx: { mode, types:[], version, copiedFiles:[], branches?, gitignoreUpdated? }
import { WORKFLOW_PREFIX, WORKFLOW_COMMON_PREFIX } from "../core/paths.js";
import { paint, A, colorEnabled } from "./ansi.js";

const SEPARATOR = "────────────────────────────────────────";

export function printSummary(ctx) {
  const { mode, types = [], version = "", versionCode = null, copiedFiles = [], branches = null, gitignoreUpdated = false,
    // 설치 후 검증·기록 (#79, #80, #81)
    answers = [], unresolved = [], secrets = new Map(), logPath = "", legacyMdLogs = false, cleanup = null } = ctx || {};
  const err = (s = "") => process.stderr.write(`${s}\n`);
  // 색상은 ansi.js의 공용 가드로 통일 (NO_COLOR + stderr TTY 여부)
  const enabled = colorEnabled(process.stderr);

  err("");
  err(SEPARATOR);
  err("");
  err("✨ project-auto-wizard Setup Complete!");
  err("");
  err(SEPARATOR);
  err("");
  err("통합된 기능:");

  // 모드별 체크리스트
  switch (mode) {
    case "full":
      err("  ✅ 버전 관리 시스템 (version.yml)");
      err("  ✅ README.md 자동 버전 업데이트");
      err("  ✅ GitHub Actions 워크플로우 (AI 릴리스 자동화 포함)");
      if (gitignoreUpdated) err("  ✅ .gitignore 백업 파일 제외 항목 (*.bak/*.template.yaml)");
      break;
    case "version":
      err("  ✅ 버전 관리 시스템 (version.yml)");
      err("  ✅ README.md 자동 버전 업데이트");
      break;
    case "workflows":
      err("  ✅ GitHub Actions 워크플로우 (AI 릴리스 자동화 포함)");
      break;
  }

  // 브랜치 모드 + 릴리스 요약 엔진 안내 (DESIGN-SPEC §4~5)
  if (branches) {
    err("");
    err("브랜치 구성:");
    if (branches.mode === "trunk-based") {
      err(`  🌿 ${branches.main} 단일 브랜치 (trunk-based) — RELEASE-PUBLISH 하나가 버전확정→체인지로그→tag→Release를 순차 처리`);
    } else {
      err(`  🌿 개발 ${branches.develop} → 릴리스 ${branches.main} (pr-flow) — 릴리스 PR에서 버전확정·AI 체인지로그·automerge`);
    }
  }
  if (mode === "full" || mode === "workflows") {
    err("");
    err("릴리스 노트 요약 엔진:");
    err("  🤖 AI_API_KEY(선택) → GitHub Models(기본·무료·API 키 불필요) → 규칙 fallback — 릴리스는 절대 막히지 않음");
  }

  err("");
  err("추가된 파일:");
  err(`  📄 version.yml (버전: ${version}, 타입: ${types.join(",")})`);
  const BUILD_NUMBER_TYPES = new Set(["flutter", "react-native", "react-native-expo"]);
  if (versionCode != null && types.some((t) => BUILD_NUMBER_TYPES.has(t))) {
    err(`     빌드 번호: ${versionCode}`);
  }
  err("  📝 README.md (버전 섹션 추가)");
  err("");
  err("추가된 워크플로우:");

  // 실제로 이번 실행에서 복사된 파일만 분류한다 (copyWorkflows()가 반환한 copiedFiles —
  // 디렉터리 재스캔은 재실행 시 skip된 파일까지 "새로 설치됨"으로 보여주는 결함이 있었다, issue #19).
  const commonWorkflows = [];
  const typeWorkflows = [];
  const typePrefixes = types.map((t) => `${WORKFLOW_PREFIX}-${t.toUpperCase()}-`);
  for (const filename of copiedFiles) {
    if (!filename.startsWith(`${WORKFLOW_PREFIX}-`)) continue; // PROJECT-*만
    if (filename.startsWith(`${WORKFLOW_COMMON_PREFIX}-`)) {
      commonWorkflows.push(filename);
    } else if (typePrefixes.some((p) => filename.startsWith(p))) {
      typeWorkflows.push(filename);
    }
  }

  if (commonWorkflows.length > 0 || typeWorkflows.length > 0) {
    err(`  📦 새로 설치됨 (${commonWorkflows.length + typeWorkflows.length}개):`);
    for (const wf of commonWorkflows) err(`     📌 ${wf}`);
    for (const wf of typeWorkflows) err(`     🎯 ${wf}`);
  }

  err("");
  err("  🔧 .github/scripts/");
  err("     ├─ version_manager.py");
  err("     ├─ changelog_manager.py");
  err("     ├─ truncate_release_notes.py");
  err("     └─ issue_helper.py");
  err("");

  // 입력한 환경설정 값 (#80) — 마지막으로 눈으로 검산할 기회. 종전에는 답변이 워크플로우
  // YAML 안으로만 사라져, 오타를 내도 배포가 실패한 뒤에야 알 수 있었다.
  if (answers.length) {
    err("  ⚙️  적용된 환경설정:");
    for (const a of answers) {
      const mark = a.isDefault ? paint(" (기본값)", A.dim, enabled) : "";
      err(`     • ${a.label}: ${paint(a.value, A.green, enabled)}${mark}`);
    }
    err("");
  }
  // 배포 방식을 바꿔 재설치한 경우, 이전 CD를 어떻게 처리했는지 알린다 (#80).
  if (cleanup?.removed?.length || cleanup?.backedUp?.length) {
    err("  🧹 이전 배포 방식 정리:");
    for (const f of cleanup.removed || []) err(`     • ${f} ${paint("삭제 (손대지 않은 파일)", A.dim, enabled)}`);
    for (const f of cleanup.backedUp || []) err(`     • ${f} → ${f}.bak ${paint("수정하신 내용이 있어 백업", A.dim, enabled)}`);
    err("");
  }
  if (logPath) {
    err(`  📋 실행 로그: ${logPath}`);
    err("     → 무엇을 어떤 값으로 설치했는지 시간순으로 남아 있습니다 (git에 올라가지 않습니다)");
    err("");
  }
  if (legacyMdLogs) {
    err("  ℹ️  이전 버전의 설치 기록(.md)이 git에 추적 중입니다:");
    err("     git rm -r --cached .github/.wizard/logs");
    err("");
  }

  // 프로젝트 타입별 안내
  if (types.includes("spring")) {
    err("  💡 Spring 프로젝트 추가 설정:");
    err("     • build.gradle / build.gradle.kts / pom.xml 의 버전 정보가 자동 동기화됩니다");
    err("");
  }

  err("  📖 REPO: https://github.com/Twin-Fang/project-auto-wizard");
  err("");

  // 필수 작업 안내
  err(SEPARATOR);
  err("");
  err(paint(paint("⚠️  다음 작업을 확인해주세요:", A.yellow, enabled), A.bold, enabled));
  err("");

  let step = 0;
  const num = () => ["1️⃣ ", "2️⃣ ", "3️⃣ ", "4️⃣ ", "5️⃣ "][step++] || " •";

  // 미치환 플레이스홀더 (#81) — 이 상태로는 해당 워크플로우가 동작하지 않으므로 제일 먼저 알린다.
  if (unresolved.length) {
    err(`  ${num()} ${paint("값이 채워지지 않은 항목이 있습니다 — 직접 채워야 동작합니다", A.red, enabled)}`);
    for (const u of unresolved) {
      err(`     → ${u.filename}:${u.line}  ${paint(u.token, A.bold, enabled)}`);
    }
    err("");
  }

  // 설치된 워크플로우가 실제로 요구하는 Secret (#80) — 종전에는 하나도 안내되지 않아
  // "설치 성공"인데 배포는 돌지 않는 상태로 끝났다.
  if (secrets.size) {
    err(`  ${num()} 아래 GitHub Secret을 등록해야 배포 워크플로우가 동작합니다 (${secrets.size}개)`);
    err("     → Settings > Secrets and variables > Actions");
    for (const [name, users] of secrets) {
      err(`     → ${paint(name, A.bold, enabled)}  ${paint(users.join(", "), A.dim, enabled)}`);
    }
    err("");
  }

  err(`  ${num()} 릴리스 automerge용 PAT (선택 — 없으면 GITHUB_TOKEN 폴백으로 자동 진행)`);
  err("     → Repository Settings > Secrets > Actions");
  err("     → Secret Name: WORKFLOW_PAT (Scopes: repo, workflow)");
  err("     → 등록 시 개인 계정이 아닌 조직 bot/machine 계정으로 발급하세요");
  err("     → 없어도 자동 복구되며, 있으면 병합~Release 반영이 조금 더 빠릅니다");
  err("");
  err(`  ${num()} GitHub Actions 권한 확인`);
  err("     → Settings > Actions > Workflow permissions: Read and write");
  err("");
  err(SEPARATOR);
  err("");
  err(paint("📖 워크플로우 구성과 릴리스 흐름은 README를 참고하세요.", A.cyan, enabled));
  err("");
}
