// Flutter 타입 훅 — types.js 레지스트리의 flutter 항목이 가리키는 구현 모음.
// 공통 코드는 flutter를 직접 알지 못하고 훅 이름으로만 호출한다(각 훅의 계약은 types.js 머리말 참고).
import { existsSync } from "node:fs";
import {
  ENV_MODES, DEPLOY_MODES, DEFAULT_ENV_MODE, DEFAULT_DEPLOY_MODE, STORE_PLATFORMS, NO_STORE,
  isEnvMode, isDeployMode, parseStoreList, formatStoreList, deployModeWarning,
  storeWorkflowFilter, cleanupDeselectedStoreWorkflows, resolveFlutterOptions,
} from "./flutter-options.js";
import { planFlutterAppFiles, copyFlutterAppFiles } from "./copy/flutter-app.js";
import { flutterStoreChecks } from "./flutter-doctor.js";
import { inferInstalledStores } from "./installed-stores.js";
import { escapeYamlDoubleQuoted } from "./wizard-env.js";
import { CliError } from "./errors.js";

// 저장값이 없으면 그 상태에서 실제로 적용되는 동작을 함께 알린다.
function statusLabels(options) {
  return [
    ` env_mode=${options.envMode ?? "미설정(dotenv 유지)"}`,
    ` flutter_store=${options.flutterStore ?? "미설정(둘 다 설치)"}`,
    ` android_deploy_mode=${options.androidDeployMode ?? "미설정(store_only)"}`,
    ` ios_deploy_mode=${options.iosDeployMode ?? "미설정(store_only)"}`,
  ].join("");
}

// 스토어 저장값이 없는 기존 Flutter 설치는 설치돼 있는 스토어 워크플로우로 추론한다(대화형과 같은 결론).
// 추론하지 않으면 미결정이 "둘 다"로 확정 저장되어, 지웠던 플랫폼의 워크플로우·fastlane 파일이 되살아난다.
// workflowsDir가 없으면(status 등 읽기 전용 경로) 추론하지 않는다.
function resolveOptions({ opts = {}, existing = null, workflowsDir = null }) {
  const inferredStores = workflowsDir && opts.flutterStore == null && existing?.types?.includes("flutter")
    && existing.options?.flutterStore == null && existsSync(workflowsDir)
    ? inferInstalledStores(workflowsDir) : null;
  return resolveFlutterOptions({
    cli: {
      envMode: opts.flutterEnvMode ?? "", stores: opts.flutterStore ?? inferredStores,
      androidDeployMode: opts.androidDeployMode ?? "", iosDeployMode: opts.iosDeployMode ?? "",
    },
    existing,
  });
}

// version.yml options 아래 Flutter 블록(6칸 들여쓰기). 값이 비었으면 워크플로우 템플릿 기본값과 같은 값으로 채운다 —
// 저장값과 실제 설치 내용이 어긋나지 않게. stores가 null(미결정)이면 현행 동작대로 둘 다 설치되므로 "android,ios"로 기록한다.
function versionOptionsBlock({ envMode, stores, androidDeployMode, iosDeployMode } = {}) {
  const quote = (v) => `"${escapeYamlDoubleQuoted(v)}"`;
  return [
    `      env_mode: ${quote(envMode || DEFAULT_ENV_MODE)} # ${ENV_MODES.join(" | ")} (Flutter 환경변수 주입 방식)`,
    `      flutter_store: ${quote(formatStoreList(stores ?? STORE_PLATFORMS))} # android | ios | android,ios | none (스토어 배포 대상)`,
    `      android_deploy_mode: ${quote(androidDeployMode || DEFAULT_DEPLOY_MODE)} # ${DEPLOY_MODES.join(" | ")} (Play Store 배포 모드)`,
    `      ios_deploy_mode: ${quote(iosDeployMode || DEFAULT_DEPLOY_MODE)} # ${DEPLOY_MODES.join(" | ")} (iOS 배포 모드)`,
  ].join("\n");
}

// 값 목록 검증 플래그 하나를 만든다 — 값이 목록 밖이면 CliError.
const enumFlag = (flag, field, isValid, allowed) => ({
  flag, field, initial: "",
  parse(v) {
    if (!isValid(v)) throw new CliError(`${flag} 값이 올바르지 않습니다: ${v ?? "(없음)"} (${allowed.join(" | ")})`);
    return v;
  },
});

export const flutterHooks = {
  resolveOptions,
  // 확정된 옵션 → 설치 컨텍스트 필드. 기본값은 옵션이 없을 때의 "미결정" 상태다.
  contextDefaults: {
    envMode: "",             // "dart-define" | "dotenv". ""=미결정 → 템플릿 기본값(dart-define)
    flutterStore: null,      // 스토어 배포 대상 string[] (예: ["android","ios"]). null=미결정 → 둘 다(현행 동작)
    androidDeployMode: "",   // store_only | store_prepare | store_submit. ""=미결정 → store_only
    iosDeployMode: "",       // 위와 동일 (iOS)
  },
  contextFields: (options) => ({
    envMode: options.envMode,
    flutterStore: options.stores,
    androidDeployMode: options.androidDeployMode,
    iosDeployMode: options.iosDeployMode,
  }),
  optionsFromContext: ({ envMode, flutterStore, androidDeployMode, iosDeployMode }) => ({
    envMode, stores: flutterStore, androidDeployMode, iosDeployMode,
  }),
  versionOptionsBlock,
  // version.yml 저장 키 → 파싱 결과 필드. 값은 원문 문자열로 돌려주고, 유효성 판정은 resolveOptions 몫이다.
  savedOptionKeys: {
    env_mode: "envMode", flutter_store: "flutterStore",
    android_deploy_mode: "androidDeployMode", ios_deploy_mode: "iosDeployMode",
  },
  // CLI 플래그 — 파싱 결과 필드(opts)와 값 검증. initial은 미지정 값이다.
  cliFlags: [
    enumFlag("--flutter-env-mode", "flutterEnvMode", isEnvMode, ENV_MODES),
    {
      flag: "--flutter-store", field: "flutterStore", initial: null,
      parse(v) {
        // 빈 문자열은 parseStoreList가 []로 보지만, 스토어를 안 고르겠다는 뜻은 명시적인 none으로만 받는다.
        const stores = v ? parseStoreList(v) : null;
        if (stores === null) {
          throw new CliError(`--flutter-store 값이 올바르지 않습니다: ${v || "(없음)"} (${[STORE_PLATFORMS.join(","), ...STORE_PLATFORMS, NO_STORE].join(" | ")})`);
        }
        return stores;
      },
    },
    enumFlag("--android-deploy-mode", "androidDeployMode", isDeployMode, DEPLOY_MODES),
    enumFlag("--ios-deploy-mode", "iosDeployMode", isDeployMode, DEPLOY_MODES),
  ],
  // 설치 직후 알릴 경고 — store_submit은 main push마다 심사를 자동 제출하므로 선택하지 않은 스토어에는 뜨면 안 된다.
  installNotices: ({ stores, androidDeployMode, iosDeployMode }) => [
    (stores === null || stores.includes("android")) && deployModeWarning(androidDeployMode),
    (stores === null || stores.includes("ios")) && deployModeWarning(iosDeployMode),
  ],
  // 설치 로그에 남길 선택값 [이름, 값] 목록
  logChoices: (context) => {
    const stores = Array.isArray(context.flutterStore) ? (context.flutterStore.join(",") || "없음") : "미결정(둘 다)";
    return [["flutter",
      `env=${context.envMode || "-"} stores=${stores} android=${context.androidDeployMode || "-"} ios=${context.iosDeployMode || "-"}`]];
  },
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
