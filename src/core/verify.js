// 설치 후 검증 (이슈 #81, #80) — 설치된 워크플로우를 다시 읽어 "이대로 돌아가는가"를 본다.
//
// 왜 설치 전이 아니라 후인가: 치환은 파일 단위로 흩어져 일어나고 auto 토큰은 resolver 결과에
// 의존한다. 최종 디스크 내용을 보는 것이 실제로 배포될 것과 같은 것을 보는 유일한 방법이다.
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// 치환 대상이 아닌 토큰 — 워크플로우 스크립트 안의 heredoc 구분자다. 값이 아니라 문법이므로
// 미치환 검사에서 제외한다. (예: cat <<'__SUH_FILE_CONTENT_EOF__')
const SENTINEL_RE = /^__SUH_[A-Z0-9_]*__$/;
const PLACEHOLDER_RE = /__[A-Z][A-Z0-9_]*__/g;

// 주석으로 죽어 있는 줄 — 실행되지 않으므로 검사 대상이 아니다.
// 템플릿에는 "[선택] ..." 예시 스텝이 통째로 주석 처리돼 들어 있는데, 이걸 세면
// 쓰지도 않는 Secret을 "등록하세요"라고 안내하게 된다.
const isCommented = (line) => /^\s*#/.test(line);

// 미치환 플레이스홀더 스캔 (이슈 #81).
// 종전에는 auto 토큰 계산이 실패해도(예: application.yaml을 못 찾아 경로가 빈 문자열) 그 줄을
// 건드리지 않고 넘어가, __APPLICATION_YML_DIR__ 이 그대로 남은 워크플로우가 "설치 성공"으로
// 끝났다. 배포 시점에야 그 이름의 디렉토리가 만들어지며 문제가 드러난다.
//
// 반환: [{ filename, line, token, text }] — 사람이 바로 고칠 수 있게 줄 번호까지 준다.
export function scanUnsubstituted(workflowsDir, filenames = []) {
  const found = [];
  for (const filename of filenames) {
    const p = join(workflowsDir, filename);
    if (!existsSync(p)) continue;
    let content;
    try { content = readFileSync(p, "utf8"); } catch { continue; }
    content.split(/\r?\n/).forEach((text, i) => {
      if (isCommented(text)) return;
      for (const token of text.match(PLACEHOLDER_RE) || []) {
        if (SENTINEL_RE.test(token)) continue;
        found.push({ filename, line: i + 1, token, text: text.trim() });
      }
    });
  }
  return found;
}

// GITHUB_TOKEN은 Actions가 자동 주입하므로 사용자가 등록할 대상이 아니다.
const AUTO_SECRETS = new Set(["GITHUB_TOKEN"]);
// 없어도 워크플로우가 도는 secret — 폴백이 문서화돼 있다. 필수와 섞어 "등록해야 동작합니다"라고
// 하면 안내 자체를 못 믿게 되므로 분리한다.
//   AI_API_KEY   → 없으면 GitHub Models(무료) → 규칙 fallback
//   WORKFLOW_PAT → 없으면 GITHUB_TOKEN
export const OPTIONAL_SECRETS = new Set(["AI_API_KEY", "WORKFLOW_PAT"]);
const SECRET_RE = /secrets\.([A-Z][A-Z0-9_]*)/g;

// 설치된 워크플로우가 요구하는 GitHub Secret 목록 (이슈 #80).
// 완료 화면이 WORKFLOW_PAT와 권한만 안내하는 바람에, 배포 워크플로우가 실제로 필요로 하는
// SERVER_HOST·SSH_KEY 같은 값이 하나도 안내되지 않았다. 설치 직후 상태로는 배포가 돌지 않는데
// 그 사실이 어디에도 드러나지 않는다.
//
// 반환: Map<secretName, string[] 그 secret을 쓰는 파일명>
export function collectRequiredSecrets(workflowsDir, filenames = []) {
  const out = new Map();
  for (const filename of filenames) {
    const p = join(workflowsDir, filename);
    if (!existsSync(p)) continue;
    let content;
    try { content = readFileSync(p, "utf8"); } catch { continue; }
    for (const line of content.split(/\r?\n/)) {
      if (isCommented(line)) continue;
      for (const m of line.matchAll(SECRET_RE)) {
        const name = m[1];
        if (AUTO_SECRETS.has(name) || OPTIONAL_SECRETS.has(name)) continue;
        if (!out.has(name)) out.set(name, []);
        const users = out.get(name);
        if (!users.includes(filename)) users.push(filename);
      }
    }
  }
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

// SSH 인증 방식에 따라 둘 중 하나만 필요한 secret — 사용자가 이미 답한 값으로 목록을 좁힌다.
// 안 쓸 secret까지 "등록하세요"라고 하면 안내 자체를 신뢰하지 않게 된다.
export function narrowSecretsBySshAuth(secrets, sshAuthMethod) {
  if (!sshAuthMethod) return secrets;
  const drop = sshAuthMethod === "key" ? "SERVER_PASSWORD" : "SSH_KEY";
  const out = new Map(secrets);
  out.delete(drop);
  return out;
}
