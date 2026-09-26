// 대화형 프롬프트 래핑 (.sh interactive_menu/choose_menu/ask_* 등가).
// node:readline 기반 자체 엔진 사용 (@clack/prompts 는 Windows TTY에서 Enter가 멈추는 버그로 제거).
// 취소(ESC/Ctrl+C)는 각 함수가 CANCEL 심볼을 반환 → 호출부가 정상 종료(exit 0) 처리.
import * as engine from "./readline-engine.js";
import { DEPLOY_STYLES, NO_DEPLOY_STYLE } from "../core/deploy-style.js";
import { ENV_MODES, DEFAULT_ENV_MODE, STORE_PLATFORMS, DEPLOY_MODES, DEFAULT_DEPLOY_MODE } from "../core/flutter-options.js";

export const CANCEL = engine.CANCEL;

// 모드 선택 — 한국어 라벨, 내부 키 반환. 취소 시 CANCEL.
// again=true는 읽기 전용 모드(status/doctor)를 실행하고 메뉴로 돌아온 재진입이다 —
// 이때 "무엇을 설치할까요?"를 다시 묻는 건 어색하므로 문구를 바꾼다.
export async function selectMode({ again = false } = {}) {
  return engine.select({
    message: again ? "다음으로 무엇을 할까요?" : "무엇을 설치할까요?",
    options: [
      { value: "full", label: "설치 / 업데이트 — 버전관리 + 자동화 워크플로우 (처음이라면 추천)" },
      { value: "uninstall", label: "완전 삭제 — 마법사가 설치·수정한 모든 항목 제거(확인 후, README·gitignore·version.yml 포함)" },
      { value: "status", label: "설치 상태 확인 — 읽기 전용, 버전·타입·드리프트 확인" },
      { value: "doctor", label: "환경 진단 — 읽기 전용, gh CLI·권한·secret 설정 점검" },
    ],
  });
}

// 프로젝트 확인 화면 메뉴 (계속/수정/취소).
export async function confirmProjectMenu() {
  return engine.select({
    message: "이 정보로 진행할까요?",
    options: [
      { value: "continue", label: "예, 계속 진행" },
      { value: "edit", label: "수정하기" },
      { value: "cancel", label: "아니오, 취소" },
    ],
  });
}

// 수정 메뉴 항목 — showFlutter=Flutter 타입일 때만 환경변수 방식/스토어 배포 대상/배포 모드 노출 (이슈 #131).
// 라벨·순서를 테스트할 수 있도록 순수 함수로 분리했다.
export function editMenuOptions({ showFlutter = false } = {}) {
  const options = [
    { value: "type", label: "프로젝트 타입" },
    { value: "version", label: "버전" },
    { value: "branch", label: "기본 브랜치" },
  ];
  if (showFlutter) {
    options.push({ value: "envMode", label: "환경변수 방식" });
    options.push({ value: "flutterStore", label: "스토어 배포 대상" });
    options.push({ value: "deployMode", label: "배포 모드" });
  }
  options.push({ value: "done", label: "모두 맞음, 계속" });
  return options;
}

// 수정 메뉴 — 어떤 항목을 고칠지.
export async function editMenu({ showFlutter = false } = {}) {
  return engine.select({ message: "어떤 항목을 수정할까요?", options: editMenuOptions({ showFlutter }) });
}

const ALL_TYPES = ["spring", "flutter", "next", "react", "react-native", "react-native-expo", "node", "python", "basic", "go"];

// 타입 멀티선택.
export async function selectTypes(current = []) {
  return engine.multiselect({
    message: "프로젝트 타입을 선택하세요 (Space 토글, Enter 확정)",
    options: ALL_TYPES.map((t) => ({ value: t, label: t })),
    initialValues: current.length ? current : ["basic"],
    required: true,
  });
}

// 감지 직후 타입 확정 (이슈 #78). selectTypes와 달리 감지 근거 파일을 라벨에 붙여
// "왜 이렇게 판단했는지"를 보여준다 — 근거가 보여야 맞는지 틀린지 판단할 수 있다.
// 감지 결과가 맞으면 Enter 한 번으로 끝난다.
export async function confirmTypes({ types = [], markers = null } = {}) {
  const detected = new Set(types);
  engine.note(
    "선택한 타입에 따라 설치되는 CI/CD 워크플로우와 버전 동기화 대상 파일이 달라집니다.\n" +
    "감지 결과가 맞으면 그대로 Enter를 누르세요.",
    "프로젝트 타입 확정",
  );
  return engine.multiselect({
    message: "이 프로젝트의 타입입니다 (Space 토글, Enter 확정)",
    options: ALL_TYPES.map((t) => {
      const marker = markers?.get?.(t);
      // 감지된 타입만 근거를 붙인다 — 나머지는 후보로만 나열한다.
      return { value: t, label: detected.has(t) && marker ? `${t} — ${marker} 발견` : t };
    }),
    initialValues: types.length ? types : ["basic"],
    required: true,
  });
}

// 배포 방식 선택 (이슈 #80, #126). 서버 배포 CD 워크플로우는 서로 대체재라 하나만 쓴다.
// 고른 것만 설치하고 push 트리거까지 켜준다 — 종전에는 넷을 다 깔고 SIMPLE만 켜져 있어,
// 무중단을 원한 사람은 설치 후 YAML을 직접 고쳐야 했다.
// "서버 배포 안 함"은 server-deploy 폴더 자체(PR 프리뷰 포함)를 제외한다 — 서버 배포를
// 하지 않는 프로젝트(프론트엔드 전용, 라이브러리 등)를 위한 선택지다.
export async function selectDeployStyle() {
  engine.note(
    "서버 배포 워크플로우는 서로 대체재입니다 (Nginx와 Traefik을 동시에 쓰지 않습니다).\n" +
    "고른 방식만 설치하고 자동 실행(push 트리거)까지 켭니다. PR 프리뷰는 선택과 무관하게 함께 설치됩니다\n" +
    "(단, server-deploy 폴더가 있는 타입(spring)은 \"서버 배포 안 함\"을 고르면 PR 프리뷰도 함께 제외됩니다).",
    "배포 방식",
  );
  return engine.select({
    message: "서버 배포는 어떤 방식으로 할까요?",
    options: [
      ...DEPLOY_STYLES.map((s) => ({ value: s.value, label: s.label })),
      { value: NO_DEPLOY_STYLE, label: "서버 배포 안 함 — CD 워크플로우/배포 설정을 생성하지 않음" },
    ],
  });
}

// ── Flutter 옵션 (이슈 #131) ─────────────────────────────────────────
// 프로젝트 타입에 flutter가 포함된 경우에만 interactive.js가 묻는다. 세 함수 모두 취소(ESC) 시 CANCEL을
// 그대로 돌려주고, "ESC = 기본값" 처리는 호출부가 한다 (selectDeployStyle과 같은 규약).
const ENV_MODE_LABELS = {
  "dart-define": "dart-define (신규 설치 기본) — 시크릿을 --dart-define-from-file로 빌드에 전달, 프로젝트에 .env를 만들지 않음",
  dotenv: "dotenv — Flutter 루트에 .env를 만들어 flutter_dotenv·envied가 읽음 (기존 설치 유지값)",
};

const STORE_LABELS = {
  android: "Android — Google Play Store (fastlane)",
  ios: "iOS — TestFlight / App Store Connect (fastlane)",
};

const DEPLOY_MODE_LABELS = {
  android: {
    store_only: "store_only — internal 트랙에 업로드 (기본)",
    store_prepare: "store_prepare — production 트랙에 draft로 업로드 (Play Console에서 직접 출시)",
    store_submit: "store_submit — production 심사 제출까지",
  },
  ios: {
    store_only: "store_only — TestFlight 업로드 (기본)",
    store_prepare: "store_prepare — 앱 버전·메타데이터 준비까지 (심사 제출 안 함)",
    store_submit: "store_submit — 심사 제출까지",
  },
};

const PLATFORM_TITLES = { android: "Android (Play Store)", ios: "iOS (TestFlight)" };

// 환경변수 방식 — 시크릿 ENV_FILE(.env 형식)을 Flutter 빌드에 넘기는 방법.
export async function selectEnvMode({ initialValue = DEFAULT_ENV_MODE } = {}) {
  engine.note(
    "시크릿 ENV_FILE(.env 형식)을 Flutter 빌드에 넘기는 방식입니다.\n" +
    "dart-define은 String.fromEnvironment로 읽고, dotenv는 flutter_dotenv·envied가 .env 파일을 읽습니다.\n" +
    "나중에 확인 화면의 '수정하기 > 환경변수 방식'에서 바꿀 수 있습니다.",
    "환경변수 방식",
  );
  return engine.select({
    message: "Flutter 환경변수는 어떤 방식으로 넘길까요?",
    options: ENV_MODES.map((value) => ({ value, label: ENV_MODE_LABELS[value] })),
    initialIndex: Math.max(0, ENV_MODES.indexOf(initialValue)),
  });
}

// 스토어 배포 대상 — 고른 플랫폼의 워크플로우와 fastlane 템플릿만 설치한다. 아무것도 안 고르면 스토어 배포 없이 설치.
export async function selectFlutterStores({ initialValues = [] } = {}) {
  engine.note(
    "고른 플랫폼의 스토어 배포 워크플로우와 fastlane 파일(Fastfile 등)만 설치합니다.\n" +
    "아무것도 고르지 않으면 스토어 배포 없이 설치합니다 (Firebase·Selfhosted·Test APK·CI는 항상 설치).",
    "스토어 배포 대상",
  );
  return engine.multiselect({
    message: "스토어에 배포할 플랫폼을 선택하세요 (Space 토글, Enter 확정)",
    options: STORE_PLATFORMS.map((value) => ({ value, label: STORE_LABELS[value] })),
    initialValues,
    required: false,
  });
}

// 배포 모드 — 플랫폼별로 한 번씩 묻는다. 런타임의 저장소 변수와 workflow_dispatch 입력이 항상 이 값보다 우선한다.
export async function selectDeployMode({ platform, initialValue = DEFAULT_DEPLOY_MODE }) {
  return engine.select({
    message: `${PLATFORM_TITLES[platform]} 배포 모드를 선택하세요`,
    options: DEPLOY_MODES.map((value) => ({ value, label: DEPLOY_MODE_LABELS[platform][value] })),
    initialIndex: Math.max(0, DEPLOY_MODES.indexOf(initialValue)),
  });
}

// store_submit은 main push마다 심사를 제출하므로 고른 직후 한 줄로 알린다. 호출부(interactive)가 note로 출력한다.
export function deployModeWarning(mode) {
  return mode === "store_submit" ? "store_submit을 고르면 main push마다 심사가 자동 제출됩니다." : "";
}

// 브랜치 전략 선택 (이슈 #93). 종전에는 "릴리스 브랜치"/"개발 브랜치" 두 질문에
// 같은 이름을 입력해야만 trunk-based가 됐는데, 그 규칙이 사전에 안내되지 않아
// 의도치 않게 pr-flow로 흘러갔다. 전략을 먼저 명시적으로 고르게 해 이를 없앤다.
// 옵션 순서(pr-flow 먼저)는 비-TTY 환경의 기본값과 직결되므로 바꾸지 않는다.
export async function selectBranchStrategy() {
  engine.note(
    "pr-flow는 develop에서 작업해 main으로 PR을 올리는 팀 협업 흐름입니다.\n" +
    "trunk-based는 브랜치를 하나만 두고 그 브랜치에서 바로 작업하는 단순한 흐름입니다.",
    "브랜치 전략",
  );
  return engine.select({
    message: "브랜치 전략을 선택하세요",
    options: [
      { value: "pr-flow", label: "develop → main PR 흐름 (pr-flow) — 팀 협업/리뷰 프로세스가 필요할 때" },
      { value: "trunk-based", label: "main 단일 브랜치 (trunk-based) — 개인/소규모 프로젝트로 브랜치 없이 단순하게 쓸 때" },
    ],
  });
}

// 텍스트 입력 (빈 입력=기본값 유지).
export async function askText(message, defaultValue = "") {
  const v = await engine.text({ message, defaultValue });
  if (v === CANCEL) return CANCEL;
  return v === "" || v == null ? defaultValue : v;
}

// 예/아니오.
export async function askYesNo(message, initial = true) {
  return engine.confirm({ message, initialValue: initial });
}

// 배너·안내 출력.
export function intro(text) { engine.intro(text); }
export function outro(text) { engine.outro(text); }
export function note(text, title) { engine.note(text, title); }
export function cancelMessage(text = "취소했습니다.") { engine.cancelMessage(text); }

// ── #446 첫 화면 UI 5층 + SP2-C 대화형 계층 실물 io ─────────────────
// runInteractive는 io.<method>?.() 옵셔널 호출 — 테스트 스텁은 이 메서드들을 생략해
// 시각 층·env 질문을 건너뛴다 (실행 계약은 그대로).
import { printBanner as _printBanner } from "./banner.js";
import {
  printDetectionLog as _detLog, printAnalysisCard as _card,
  printInstallKind as _installKind,
} from "./status-cards.js";
import { printSummary as _summary } from "./summary.js";

export function banner(info) { _printBanner(info); }
export function detectionLog(info) { _detLog(info); }
export function analysisCard(info) { _card(info); }
export function installKind(info) { _installKind(info); }
export function summary(ctx) { _summary(ctx); }

// env 계획·경로 해석·충돌 메뉴가 쓰는 저수준 엔진 io (env-plan/paths-resolve의 io 계약)
export const engineIo = {
  select: engine.select,
  multiselect: engine.multiselect,
  text: engine.text,
  confirm: engine.confirm,
};
