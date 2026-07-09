// 완료 요약 출력 (.sh print_summary 등가). 전부 stderr.
// ctx: { mode, types:[], version, counters:{ workflows } }
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PATHS, WORKFLOW_PREFIX, WORKFLOW_COMMON_PREFIX } from "../core/paths.js";
import { listYamlFiles } from "../core/fsutil.js";

const SEPARATOR = "────────────────────────────────────────";

export function printSummary(ctx, targetRoot = ".") {
  const { mode, types = [], version = "", counters = {} } = ctx || {};
  const err = (s = "") => process.stderr.write(`${s}\n`);
  // 색상은 TTY일 때만 (.sh YELLOW/CYAN/NC 등가)
  const isTty = !!process.stderr.isTTY;
  const YELLOW = isTty ? "\x1b[1;33m" : "";
  const CYAN = isTty ? "\x1b[0;36m" : "";
  const NC = isTty ? "\x1b[0m" : "";
  const workflowsCopied = counters.workflows ?? 0;

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
      err("  ✅ .gitignore 필수 항목");
      break;
    case "version":
      err("  ✅ 버전 관리 시스템 (version.yml)");
      err("  ✅ README.md 자동 버전 업데이트");
      err("  ✅ .gitignore 필수 항목");
      break;
    case "workflows":
      err("  ✅ GitHub Actions 워크플로우 (AI 릴리스 자동화 포함)");
      break;
  }

  err("");
  err("추가된 파일:");
  err(`  📄 version.yml (버전: ${version}, 타입: ${types.join(",")})`);
  err("  📝 README.md (버전 섹션 추가)");
  err("");
  err("추가된 워크플로우:");

  // 실제 복사된 워크플로우 분류
  const commonWorkflows = [];
  const typeWorkflows = [];
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  if (existsSync(workflowsDir)) {
    const typePrefixes = types.map((t) => `${WORKFLOW_PREFIX}-${t.toUpperCase()}-`);
    for (const filename of listYamlFiles(workflowsDir)) {
      if (!filename.startsWith(`${WORKFLOW_PREFIX}-`)) continue; // PROJECT-*.{yaml,yml}만
      if (filename.startsWith(`${WORKFLOW_COMMON_PREFIX}-`)) {
        commonWorkflows.push(filename);
      } else if (typePrefixes.some((p) => filename.startsWith(p))) {
        typeWorkflows.push(filename);
      }
    }
  }

  if (commonWorkflows.length > 0 || typeWorkflows.length > 0) {
    err(`  📦 새로 설치됨 (${workflowsCopied}개):`);
    for (const wf of commonWorkflows) err(`     📌 ${wf}`);
    for (const wf of typeWorkflows) err(`     🎯 ${wf}`);
  }

  err("");
  err("  🔧 .github/scripts/");
  err("     ├─ version_manager.py");
  err("     └─ changelog_manager.py");
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
  err(`${YELLOW}⚠️  다음 작업을 확인해주세요:${NC}`);
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
  err(`${CYAN}📖 워크플로우 구성과 릴리스 흐름은 README를 참고하세요.${NC}`);
  err("");
}
