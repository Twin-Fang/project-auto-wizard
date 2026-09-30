// 설치 설정 해석 단계 — 비대화형(index.js)과 대화형(interactive.js)이 공유한다.
// 값을 채우는 방법(플래그·질문)은 경로마다 다르지만, 타입·버전·배포 방식·옵션을 확정하고
// 설치 컨텍스트로 조립하는 규칙은 한 곳에 둬야 한쪽만 고쳐 두 모드의 결과가 갈라지지 않는다.
import { detectVersion, detectBuildNumber } from "../core/detect-fs.js";
import { createContext } from "../context.js";
import { mergeHookResults } from "../core/types.js";
import { isDeployStyle, DEFAULT_DEPLOY_STYLE, hasServerDeployWorkflows, effectiveDeployStyle } from "../core/deploy-style.js";

// version.yml에 저장된 배포 방식 — 없거나 알 수 없는 값이면 "".
export const savedDeployStyle = (existing) =>
  isDeployStyle(existing?.options?.deployStyle) ? existing.options.deployStyle : "";

// 배포 방식 — 명시값(플래그·질문 답변) → 저장값 → 기본값.
// 서버 배포 워크플로우가 없는 타입은 설치 결과에 영향이 없으므로 기록하지 않는다(null).
export function resolveDeployStyle({ payload, types, explicit = "", existing }) {
  if (!hasServerDeployWorkflows(payload, types)) return null;
  return explicit || savedDeployStyle(existing) || DEFAULT_DEPLOY_STYLE;
}

// 버전 — 기존 version.yml 최우선(재실행 시 덮어쓰기 방지) → 명시값 → 파일 감지.
// detectOpts는 감지 함수로 그대로 넘긴다(types·paths·warn·hint).
export function resolveVersion({ cwd, existing, explicit = "", ...detectOpts }) {
  return existing?.version || explicit || detectVersion(cwd, detectOpts);
}

// 빌드 번호 — 기존 값 보존, 신규 통합이면 프로젝트 파일에서 감지, 못 찾으면 1.
export function resolveVersionCode({ cwd, existing, types, paths }) {
  return existing?.versionCode ?? detectBuildNumber(cwd, { types, paths }) ?? 1;
}

// 확정된 값들을 설치 컨텍스트로 조립한다.
//   deployStyle: resolveDeployStyle 결과(고른 값). 실제 설치되는 방식으로 바꿔 기록한다.
//   typeOptions: 타입 훅(resolveOptions)이 확정한 타입 전용 옵션 — 두 경로 모두 확정된 값. 컨텍스트 필드로의 변환도 타입 훅이 한다.
//   releaseOptions: { includeSemverAuto, includeCopilotAi } — resolveReleaseOptions 결과.
//   extra: 경로별로만 쓰는 필드(envValues 등).
export function buildInstallContext({
  payload, existing, templateVersion, types, deployStyle, typeOptions, releaseOptions, ...rest
}) {
  return createContext({
    types,
    ...releaseOptions,
    // 안내는 고른 값으로 하되, 기록은 실제로 설치되는 방식으로 한다.
    deployStyle: effectiveDeployStyle(payload, types, deployStyle),
    ...mergeHookResults(types, "contextFields", typeOptions),
    previousTemplateVersion: existing?.templateVersion || "",
    templateVersion,
    ...rest,
  });
}
