// 릴리스 옵션(semver_auto·copilot_ai) 값 결정 규칙 — 비대화형(index.js)과 대화형(interactive.js)이 공유한다.
// 우선순위: 명시값(CLI 플래그·질문 답변) → version.yml 저장값 → 기본값. 경로마다 따로 두면
// 같은 레포가 실행 방식에 따라 다른 설정으로 설치된다.

// 명시값과 저장값만 반영한다 — null이면 아직 정해지지 않은 것(대화형은 이 값으로 질문 여부를 가른다).
export function pickReleaseOptions(explicit = {}, existing = null) {
  return {
    semverAuto: explicit.semverAuto ?? existing?.options?.semverAuto ?? null,
    copilotAi: explicit.copilotAi ?? existing?.options?.copilotAi ?? null,
  };
}

// 최종값 — 정해지지 않은 옵션에 기본값을 채운다.
// semver_auto: 신규 설치만 true. 기존 version.yml에 키가 없던 설치(기능 추가 이전 설치)가 조용히 켜지면
//   애매한 커밋 하나로 major가 승격될 수 있어 false로 둔다.
// copilot_ai: AI Credits를 소비하는 opt-in이라 신규·기존 모두 명시하지 않으면 false.
export function resolveReleaseOptions(explicit = {}, existing = null) {
  const { semverAuto, copilotAi } = pickReleaseOptions(explicit, existing);
  return {
    includeSemverAuto: semverAuto === null ? !existing : semverAuto !== false,
    includeCopilotAi: copilotAi === true,
  };
}
