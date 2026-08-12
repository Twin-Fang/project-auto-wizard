// 배포 방식 선택 (이슈 #80) — server-deploy 폴더의 CD 워크플로우는 서로 대체재다.
// Nginx 무중단과 Traefik 무중단을 동시에 쓰는 경우는 없는데, 종전에는 넷을 전부 설치하고
// SIMPLE만 push 트리거를 켜뒀다. 결과적으로 (a) 안 쓸 워크플로우가 레포에 쌓여 업데이트마다
// 충돌 검사 대상이 되고, (b) 안 쓸 워크플로우 때문에 환경설정 질문이 늘고, (c) 정작 무중단을
// 원한 사람은 설치 후 YAML을 직접 고쳐야 했다.
//
// 기본값은 "all"(종전 동작 그대로)이다. 신규 대화형 설치에서만 물어본다.

// 파일명 접미사로 식별한다 — 타입 접두사(PROJECT-SPRING- 등)는 타입마다 다르기 때문.
const SIMPLE = "-SIMPLE-CICD.yaml";
const NGINX = "-NONSTOP-NGINX-CICD.yaml";
const TRAEFIK = "-NONSTOP-TRAEFIK-CICD.yaml";

// CD 본체가 아닌 것 — PR 프리뷰는 배포 방식과 직교하는 축이라 선택과 무관하게 함께 설치한다.
const CD_SUFFIXES = [SIMPLE, NGINX, TRAEFIK];

export const DEPLOY_STYLES = [
  { value: "simple", suffix: SIMPLE, label: "단일 서버 배포 — 컨테이너를 내렸다 올린다 (가장 단순, 짧은 다운타임)" },
  { value: "nginx", suffix: NGINX, label: "무중단 배포 (Nginx) — nginx config의 proxy_pass 포트를 Blue/Green으로 토글" },
  { value: "traefik", suffix: TRAEFIK, label: "무중단 배포 (Traefik) — Traefik 라우팅으로 Blue/Green 전환" },
  { value: "all", suffix: null, label: "전부 설치하고 나중에 고르기 (종전 동작)" },
];

export const isDeployStyle = (v) => DEPLOY_STYLES.some((s) => s.value === v);

// 이 파일이 CD 본체인가 (선택 대상인가).
export const isDeployWorkflow = (filename) => CD_SUFFIXES.some((s) => filename.endsWith(s));

// 파일 필터 — 고른 방식의 CD만 통과시킨다. CD가 아닌 파일(PR 프리뷰 등)은 항상 통과.
// style이 없거나 "all"이면 전부 통과 = 종전 동작.
export function deployFilter(style) {
  if (!style || style === "all") return () => true;
  const chosen = DEPLOY_STYLES.find((s) => s.value === style);
  if (!chosen?.suffix) return () => true;
  return (filename) => !isDeployWorkflow(filename) || filename.endsWith(chosen.suffix);
}

// 고른 방식이 아닌데 이미 설치돼 있는 CD 워크플로우 (이슈 #80).
// 지우지는 않는다 — 사용자 파일이고, 손댄 내용이 있을 수 있다. 대신 완료 화면에서 알린다.
// 남겨두면 SIMPLE의 push 트리거가 살아 있어 두 배포가 동시에 도는 상황이 생긴다.
export function competingDeployWorkflows(installedFilenames = [], style) {
  if (!style || style === "all") return [];
  const keep = deployFilter(style);
  return installedFilenames.filter((f) => isDeployWorkflow(f) && !keep(f));
}

// 무중단 배포 템플릿은 push 트리거가 주석 처리된 채 배포된다(기본 배포가 SIMPLE이라서).
// 사용자가 그 방식을 고른 이상 트리거는 켜져 있어야 한다 — 안 그러면 설치했는데 아무 일도
// 일어나지 않고, 사용자는 YAML을 직접 고쳐야 한다.
//
// 첫 `on:` 블록 안에서, 주석을 벗기면 push 트리거가 되는 줄만 되살린다.
// `# ` 두 글자만 떼므로 안쪽 들여쓰기(branches/- 의 계층)가 그대로 보존된다.
// 설명문 주석은 벗겨낸 내용이 push/branches/- 로 시작하지 않아 건드리지 않는다.
const TRIGGER_CONTENT = /^\s*(push:|branches:|- )/;

export function activateDeployTrigger(content) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  let inOn = false;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^on:\s*$/.test(line)) { inOn = true; continue; }
    if (!inOn) continue;
    // 최상위 키를 다시 만나면 on 블록 종료 (주석·빈 줄은 블록 안으로 본다)
    if (/^\S/.test(line)) break;
    const m = line.match(/^(\s*)# ?(.*)$/);
    if (!m || !TRIGGER_CONTENT.test(m[2])) continue;
    lines[i] = `${m[1]}${m[2]}`;
    changed = true;
  }
  return changed ? lines.join(eol) : content;
}
