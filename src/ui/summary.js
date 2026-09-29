// 완료 요약 출력. 전부 stderr.
// ctx: { mode, types:[], version, copiedFiles:[], branches?, gitignoreUpdated?, readme?, scripts? }
import { WORKFLOW_PREFIX, WORKFLOW_COMMON_PREFIX } from "../core/paths.js";
import { paint, A, colorEnabled } from "./ansi.js";
import { EITHER_SEP } from "../core/verify.js";
import { BUILD_NUMBER_TYPES } from "../core/types.js";
import { SCRIPT_NAMES } from "../core/copy/simple.js";

const SEPARATOR = "────────────────────────────────────────";

export function printSummary(ctx) {
  const { mode, types = [], version = "", versionCode = null, copiedFiles = [], autoUpdated = [], branches = null, gitignoreUpdated = false,
    // pr-flow인데 원격에 develop을 만들지 못한 경우 — 구성 줄만 보면 이미 준비된 것처럼 보이므로 따로 알린다.
    developMissing = false,
    // 설치 후 검증·기록
    answers = [], unresolved = [], secrets = new Map(), optionalSecrets = new Map(), logPath = "", legacyMdLogs = false, cleanup = null,
    // Flutter 스토어 배포 — 앱 파일 생성/유지와 스토어 선택 해제 정리 결과
    flutterApp = null, storeCleanup = null,
    // 이번 실행의 실제 결과 — README 버전 섹션 처리 상태(addVersionSectionToReadme 반환값)와 스크립트별 결과.
    // 고정 문구로 찍으면 README.md가 없어 아무것도 하지 않은 실행도 "추가됨"으로 보고하게 된다.
    readme = null, scripts = null } = ctx || {};
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

  // README 버전 섹션이 실제로 있는 경우(이번에 추가했거나 원래 있던 경우)에만 자동 업데이트를 안내한다.
  const readmeTracked = readme === "added" || readme === "skip-marker" || readme === "skip-version-line";
  if (mode === "full") {
    err("  ✅ 버전 관리 시스템 (version.yml)");
    if (readmeTracked) err("  ✅ README.md 자동 버전 업데이트");
    err("  ✅ GitHub Actions 워크플로우 (릴리스 자동화 포함)");
    if (gitignoreUpdated) err("  ✅ .gitignore 백업 파일 제외 항목 (*.bak/*.template.yaml)");
  }

  // 브랜치 모드 + 릴리스 요약 엔진 안내
  if (branches) {
    err("");
    err("브랜치 구성:");
    if (branches.mode === "trunk-based") {
      err(`  🌿 ${branches.main} 단일 브랜치 (trunk-based) — RELEASE-PUBLISH 하나가 버전확정→체인지로그→tag→Release를 순차 처리`);
    } else {
      err(`  🌿 개발 ${branches.develop} → 릴리스 ${branches.main} (pr-flow) — 릴리스 PR에서 버전확정·체인지로그·automerge`);
      if (developMissing) {
        err(`     ⚠️  '${branches.develop}' 브랜치가 아직 원격에 없습니다 — 만들기 전에는 개발 브랜치 워크플로우가 동작하지 않습니다`);
        err(`        → 설치 파일을 커밋해 ${branches.main}을 push한 뒤: git push origin ${branches.main}:${branches.develop}`);
      }
    }
  }
  if (mode === "full" || mode === "workflows") {
    err("");
    err("릴리스 노트 요약 엔진:");
    err("  🤖 AI_API_KEY(선택) → Copilot(선택·AI Credits 소비, 기본 꺼짐) → 규칙 fallback — 릴리스는 절대 막히지 않음");
  }

  err("");
  err("추가된 파일:");
  err(`  📄 version.yml (버전: ${version}, 타입: ${types.join(",")})`);
  if (versionCode != null && types.some((t) => BUILD_NUMBER_TYPES.has(t))) {
    err(`     빌드 번호: ${versionCode}`);
  }
  if (readme === "added") err("  📝 README.md (버전 섹션 추가)");
  if (readme === "skip-no-readme") {
    err("  ℹ️  README.md가 없어 버전 섹션을 추가하지 않았습니다");
    err("     → README.md를 만든 뒤 다시 실행하면 추가됩니다 (그 전까지 README 버전 갱신 워크플로우는 건너뜁니다)");
  }
  err("");
  err("추가된 워크플로우:");

  // 실제로 이번 실행에서 복사된 파일만 분류한다 (copyWorkflows()가 반환한 copiedFiles —
  // 디렉터리 재스캔은 재실행 시 skip된 파일까지 "새로 설치됨"으로 보여주는 결함이 있었다).
  // 자동 갱신분(사용자 미수정 파일을 최신으로 교체)도 copiedFiles에 들어 있다 — 새로 설치한 것과 나눠 보여준다.
  const updated = new Set(autoUpdated);
  const commonWorkflows = [];
  const typeWorkflows = [];
  const typePrefixes = types.map((t) => `${WORKFLOW_PREFIX}-${t.toUpperCase()}-`);
  for (const filename of copiedFiles) {
    if (!filename.startsWith(`${WORKFLOW_PREFIX}-`)) continue; // PROJECT-*만
    if (updated.has(filename)) continue;
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
  if (updated.size > 0) {
    err(`  🔄 업데이트됨 (${updated.size}개, 수정하지 않은 파일을 최신으로 교체):`);
    for (const wf of updated) err(`     • ${wf}`);
  }

  err("");
  err("  🔧 .github/scripts/");
  const scriptRows = scripts
    ? scripts.map(({ name, action }) => (action === "overwrite" ? `${name} ${paint("(기존 파일을 새 버전으로 덮어씀)", A.dim, enabled)}` : name))
    : SCRIPT_NAMES;
  scriptRows.forEach((row, i) => err(`     ${i === scriptRows.length - 1 ? "└─" : "├─"} ${row}`));
  err("");

  // 입력한 환경설정 값 — 마지막으로 눈으로 검산할 기회. 종전에는 답변이 워크플로우
  // YAML 안으로만 사라져, 오타를 내도 배포가 실패한 뒤에야 알 수 있었다.
  if (answers.length) {
    err("  ⚙️  적용된 환경설정:");
    for (const a of answers) {
      const mark = a.isDefault ? paint(" (기본값)", A.dim, enabled) : "";
      err(`     • ${a.label}: ${paint(a.value, A.green, enabled)}${mark}`);
    }
    err("");
  }
  // 배포 방식을 바꿔 재설치한 경우, 이전 CD를 어떻게 처리했는지 알린다.
  printCleanup(err, enabled, "이전 배포 방식 정리", cleanup);
  // 스토어 배포 대상을 해제한 경우도 같은 규칙으로 정리한 결과를 알린다.
  printCleanup(err, enabled, "선택 해제한 스토어 배포 정리", storeCleanup);
  // Fastfile·ExportOptions.plist는 사용자 소유라 없을 때만 만든다 — 만든 것과 그대로 둔 것을 나눠 보여준다.
  const { created: appCreated = [], kept: appKept = [] } = flutterApp || {};
  if (appCreated.length || appKept.length) {
    err("  📱 Flutter 스토어 배포 파일:");
    for (const f of appCreated) err(`     • ${f} ${paint("새로 생성", A.dim, enabled)}`);
    for (const f of appKept) err(`     • ${f} ${paint("기존 파일 유지", A.dim, enabled)}`);
    if (appCreated.some((f) => f.endsWith("ExportOptions.plist"))) {
      err("     → ExportOptions.plist의 __TEAM_ID__ · __BUNDLE_ID__ · __PROVISIONING_PROFILE_NAME__ 을 실제 값으로 채워야 iOS 배포가 동작합니다");
    }
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

  // 미치환 플레이스홀더 — 이 상태로는 해당 워크플로우가 동작하지 않으므로 제일 먼저 알린다.
  if (unresolved.length) {
    err(`  ${num()} ${paint("값이 채워지지 않은 항목이 있습니다 — 직접 채워야 동작합니다", A.red, enabled)}`);
    for (const u of unresolved) {
      err(`     → ${u.filename}:${u.line}  ${paint(u.token, A.bold, enabled)}`);
    }
    err("");
  }

  // 설치된 워크플로우가 실제로 요구하는 Secret — 종전에는 하나도 안내되지 않아
  // "설치 성공"인데 배포는 돌지 않는 상태로 끝났다.
  // "A 또는 B"는 둘 중 하나만 등록하면 되는 폴백 쌍이라 한 항목으로 센다.
  if (secrets.size) {
    err(`  ${num()} 아래 GitHub Secret을 등록해야 배포 워크플로우가 동작합니다 (${secrets.size}개)`);
    err("     → Settings > Secrets and variables > Actions");
    for (const [name, users] of secrets) {
      const either = name.includes(EITHER_SEP) ? paint(" (둘 중 하나)", A.dim, enabled) : "";
      err(`     → ${paint(name, A.bold, enabled)}${either}  ${paint(users.join(", "), A.dim, enabled)}`);
    }
    err("");
  }
  // 기본값이 있거나 없어도 동작하는 secret — 필수 개수에 섞지 않고 따로 알린다.
  if (optionalSecrets.size) {
    err(`  ${paint("ℹ️", A.dim, enabled)}  선택 Secret (없어도 동작합니다 — 필요할 때 등록, ${optionalSecrets.size}개)`);
    for (const [name, users] of optionalSecrets) {
      err(`     · ${name}  ${paint(users.join(", "), A.dim, enabled)}`);
    }
    err("");
  }

  // 설치 파일은 아직 커밋 전이다. develop을 이번 실행에서 만들었다면 설치 전 커밋 기준이라 워크플로우가 없다 —
  // 한쪽 브랜치에만 커밋하면 다른 쪽에는 VERSION-CONTROL 등이 빠진 채로 남는다.
  if (branches) {
    err(`  ${num()} 설치된 파일을 커밋해 ${branches.main}에 push하세요`);
    if (branches.mode !== "trunk-based") {
      err(`     → ${branches.develop}에도 같은 파일이 있어야 합니다 — 한쪽에 커밋한 뒤 다른 쪽에 병합하세요`);
      err(`       예) git checkout ${branches.develop} && git merge ${branches.main} && git push`);
    }
    err("     → README의 '전체 버전 기록 보기'(CHANGELOG.md) 링크는 첫 릴리스에서 CHANGELOG가 생성된 뒤부터 열립니다");
    err("");
  }

  err(`  ${num()} 릴리스 automerge용 PAT (선택 — 없으면 GITHUB_TOKEN 폴백으로 자동 진행)`);
  err("     → Repository Settings > Secrets > Actions");
  err("     → Secret Name: WORKFLOW_PAT (Scopes: repo, workflow)");
  err("     → 등록 시 개인 계정이 아닌 조직 bot/machine 계정으로 발급하세요");
  err("     → 없어도 태그·Release 발행과 배포 워크플로우 실행까지 자동으로 이어지며, 있으면 조금 더 빠릅니다");
  err("");
  // 설치 워크플로우는 필요한 권한을 각자 선언한다 — doctor 안내와 같은 기준으로 알린다.
  err(`  ${num()} GitHub Actions 권한 (변경 불필요)`);
  err("     → Workflow permissions가 기본값 Read여도 설치된 워크플로우는 그대로 동작합니다");
  err("     → 직접 추가한 워크플로우가 permissions 선언 없이 쓰기 작업을 할 때만 Read and write로 올리세요");
  err("");
  err(SEPARATOR);
  err("");
  err(paint("📖 워크플로우 구성과 릴리스 흐름은 README를 참고하세요.", A.cyan, enabled));
  err("");
}

// 삭제·백업 정리 결과 한 블록 — 이전 배포 방식 정리와 스토어 선택 해제 정리가 같은 형식을 쓴다.
function printCleanup(err, enabled, title, cleanup) {
  if (!cleanup?.removed?.length && !cleanup?.backedUp?.length) return;
  err(`  🧹 ${title}:`);
  for (const f of cleanup.removed || []) err(`     • ${f} ${paint("삭제 (손대지 않은 파일)", A.dim, enabled)}`);
  for (const f of cleanup.backedUp || []) err(`     • ${f} → ${f}.bak ${paint("수정하신 내용이 있어 백업", A.dim, enabled)}`);
  err("");
}
