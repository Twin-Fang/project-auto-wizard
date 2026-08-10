// 완료 요약 출력 (.sh print_summary 등가). 전부 stderr.
// ctx: { mode, types:[], version, copiedFiles:[], branches?, gitignoreUpdated? }
import { WORKFLOW_PREFIX, WORKFLOW_COMMON_PREFIX } from "../core/paths.js";
import { paint, A, colorEnabled } from "./ansi.js";

const SEPARATOR = "────────────────────────────────────────";

export function printSummary(ctx) {
  const { mode, types = [], version = "", versionCode = null, copiedFiles = [], branches = null, gitignoreUpdated = false } = ctx || {};
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
  err("     └─ truncate_release_notes.py");
  err("");

  // 프로젝트 타입별 안내
  if (types.includes("spring")) {
    err("  💡 Spring 프로젝트 추가 설정:");
    err("     • build.gradle의 버전 정보가 자동 동기화됩니다");
    err("     • CI/CD 워크플로우에서 GitHub Secrets 설정이 필요합니다");
    err("");
  }

  err("  📖 REPO: https://github.com/Twin-Fang/project-auto-wizard");
  err("");

  // 필수 작업 안내
  err(SEPARATOR);
  err("");
  err(paint(paint("⚠️  다음 작업을 확인해주세요:", A.yellow, enabled), A.bold, enabled));
  err("");
  err("  1️⃣  릴리스 automerge용 PAT (선택 — 없으면 GITHUB_TOKEN 사용)");
  err("     → Repository Settings > Secrets > Actions");
  err("     → Secret Name: WORKFLOW_PAT (Scopes: repo, workflow)");
  err("     → GITHUB_TOKEN 머지는 후속 워크플로우를 트리거하지 않습니다");
  err("");
  err("  2️⃣  GitHub Actions 권한 확인");
  err("     → Settings > Actions > Workflow permissions: Read and write");
  err("");
  err(SEPARATOR);
  err("");
  err(paint("📖 워크플로우 구성과 릴리스 흐름은 README를 참고하세요.", A.cyan, enabled));
  err("");
}
