// Flutter 타입 훅 — types.js 레지스트리의 flutter 항목이 가리키는 구현 모음.
// 공통 코드는 flutter를 직접 알지 못하고 훅 이름으로만 호출한다(각 훅의 계약은 types.js 머리말 참고).
import { storeWorkflowFilter, cleanupDeselectedStoreWorkflows } from "./flutter-options.js";
import { planFlutterAppFiles, copyFlutterAppFiles } from "./copy/flutter-app.js";
import { flutterStoreChecks } from "./flutter-doctor.js";

// 저장값이 없으면 그 상태에서 실제로 적용되는 동작을 함께 알린다.
function statusLabels(options) {
  return [
    ` env_mode=${options.envMode ?? "미설정(dotenv 유지)"}`,
    ` flutter_store=${options.flutterStore ?? "미설정(둘 다 설치)"}`,
    ` android_deploy_mode=${options.androidDeployMode ?? "미설정(store_only)"}`,
    ` ios_deploy_mode=${options.iosDeployMode ?? "미설정(store_only)"}`,
  ].join("");
}

export const flutterHooks = {
  // 스토어 대상이 배열일 때만 스토어 워크플로우 필터를 건다(null=미결정 → 전부 설치).
  workflowFilter: ({ flutterStore }) => (Array.isArray(flutterStore) ? storeWorkflowFilter(flutterStore) : null),
  // 선택 해제된 스토어 워크플로우 정리 — 대상이 미결정(null)이면 아무것도 지우지 않는다.
  cleanupWorkflows: (workflowsDir, installed, context, baseline, opts) => (Array.isArray(context.flutterStore)
    ? cleanupDeselectedStoreWorkflows(workflowsDir, installed, context.flutterStore, baseline, opts)
    : { removed: [], backedUp: [] }),
  appFilesTag: "flutter-app",
  planAppFiles: planFlutterAppFiles,
  copyAppFiles: copyFlutterAppFiles,
  statusLabels,
  doctorChecks: flutterStoreChecks,
};
