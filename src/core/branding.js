// 브랜치 플레이스홀더 치환 파이프라인 (DESIGN-SPEC §4).
// payload 워크플로우의 {{MAIN_BRANCH}}/{{DEVELOP_BRANCH}}를 설치 시 실제 브랜치명으로 바꾼다.
// ⚠️ GitHub Actions 표현식 `${{ ... }}`은 우리 토큰이 아니다 — `$` 선행 시 제외(lookbehind).
// 치환 후 알 수 없는 {{TOKEN}}이 남으면 throw — 복사 무결성 가드 (오타·누락 조기 검출).

const TOKEN_RE = /(?<!\$)\{\{([A-Z][A-Z0-9_]*)\}\}/g;

// substitute(text, {main, develop}) — 브랜치 토큰 치환. 미지 토큰 발견 시 throw.
export function substitute(text, { main, develop }) {
  const map = { MAIN_BRANCH: main, DEVELOP_BRANCH: develop };
  return String(text).replace(TOKEN_RE, (_, name) => {
    if (name in map) return map[name];
    throw new Error(`알 수 없는 플레이스홀더가 남았습니다: {{${name}}}`);
  });
}
