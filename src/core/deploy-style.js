// 배포 방식 — 서버 배포 CD 워크플로우는 서로 대체재다.
// Nginx 무중단과 Traefik 무중단을 동시에 쓰는 경우는 없으므로 하나만 설치한다.
// 고른 것은 push 트리거까지 켜서 설치한다 — 설치했는데 안 도는 상태를 만들지 않는다.
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { sha256 } from "./baseline.js";
import { PAYLOAD } from "./paths.js";

// 파일명 접미사로 식별한다 — 타입 접두사(PROJECT-SPRING- 등)는 타입마다 다르기 때문.
export const DEPLOY_STYLES = [
  { value: "simple", suffix: "-SIMPLE-CICD.yaml", label: "단일 서버 배포 — 컨테이너를 내렸다 올린다 (가장 단순, 짧은 다운타임)" },
  { value: "nginx", suffix: "-NONSTOP-NGINX-CICD.yaml", label: "무중단 배포 (Nginx) — nginx config의 proxy_pass 포트를 Blue/Green으로 토글" },
  { value: "traefik", suffix: "-NONSTOP-TRAEFIK-CICD.yaml", label: "무중단 배포 (Traefik) — Traefik 라우팅으로 Blue/Green 전환" },
];

export const DEFAULT_DEPLOY_STYLE = "simple";

// 서버 배포 자체를 하지 않는 프로젝트(프론트엔드 전용, 라이브러리 등)를 위한 값.
// DEPLOY_STYLES에는 넣지 않는다 — isDeployWorkflow/suffixOf가 이 배열을 순회하는데, 빈 접미사를
// 돌려주면 endsWith("")가 항상 참이라 모든 파일이 CD로 오판되어 cleanupOtherDeployWorkflows가
// 설치된 워크플로우 전체를 지우는 회귀가 생긴다.
export const NO_DEPLOY_STYLE = "none";

export const isDeployStyle = (v) => v === NO_DEPLOY_STYLE || DEPLOY_STYLES.some((s) => s.value === v);

// 이 파일이 CD 본체인가 (= 택1 대상인가). PR 프리뷰는 배포 방식과 직교하는 축이라 제외한다.
export const isDeployWorkflow = (filename) => DEPLOY_STYLES.some((s) => filename.endsWith(s.suffix));

// 배포 방식 변형 없이 서버 배포 CD가 하나뿐인 타입(react·next). 단일 서버 배포와 같은 축이다.
const SINGLE_SERVER_CD = new Set(["PROJECT-REACT-CICD.yaml", "PROJECT-NEXT-CICD.yaml"]);
const PREVIEW_SUFFIX = "-PR-PREVIEW.yaml";

// 서버에 배포하는 워크플로우 전부 — CD 본체, 단일 CD(react·next), PR 프리뷰.
// "배포 안 함"은 이 전부를 모든 타입에서 똑같이 뺀다. 일부만 빼면 서버 Secret 요구가 남는다.
export const isServerDeployWorkflow = (filename) =>
  isDeployWorkflow(filename) || SINGLE_SERVER_CD.has(filename) || filename.endsWith(PREVIEW_SUFFIX);

// 선택한 타입 중 서버 배포 워크플로우를 가진 타입이 있는가 — payload 파일로 판정한다.
// 없으면(node·flutter 등) 배포 방식은 설치 결과에 아무 영향이 없으므로 묻지도 기록하지도 않는다.
export function hasServerDeployWorkflows(payloadRoot, types = []) {
  const base = join(payloadRoot, PAYLOAD.workflowsDir);
  return types.some((type) => [join(base, type), join(base, type, "server-deploy")]
    .some((dir) => existsSync(dir) && readdirSync(dir).some(isServerDeployWorkflow)));
}

// 선택한 타입 중 무중단(nginx·traefik) 워크플로우가 있는 타입이 있는가 — 없으면 무중단 선택지를 보이지 않는다.
export function hasNonstopWorkflows(payloadRoot, types = []) {
  const base = join(payloadRoot, PAYLOAD.workflowsDir);
  const nonstop = DEPLOY_STYLES.filter((s) => s.value !== DEFAULT_DEPLOY_STYLE).map((s) => s.suffix);
  return types.some((type) => [join(base, type), join(base, type, "server-deploy")]
    .some((dir) => existsSync(dir) && readdirSync(dir).some((f) => nonstop.some((sfx) => f.endsWith(sfx)))));
}

// payload/workflows/** 의 워크플로우 파일명 전체. 파일명은 PROJECT-{TYPE}- 접두사로 타입 간 유일하다.
export function payloadWorkflowNames(payloadRoot) {
  const names = new Set();
  const root = join(payloadRoot, PAYLOAD.workflowsDir);
  if (!existsSync(root)) return names;
  for (const e of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && /\.ya?ml$/.test(e.name)) names.add(e.name);
  }
  return names;
}

// 모르는 값은 기본값으로 수렴시킨다. 빈 접미사를 돌려주면 endsWith("")가 항상 참이라
// "전부 통과"가 되어, 잘못된 값이 조용히 CD 전부 설치로 새어나간다.
const suffixOf = (style) =>
  (DEPLOY_STYLES.find((s) => s.value === style) ?? DEPLOY_STYLES.find((s) => s.value === DEFAULT_DEPLOY_STYLE)).suffix;
const SIMPLE_SUFFIX = suffixOf(DEFAULT_DEPLOY_STYLE);

// 고른 방식의 CD가 없는 타입의 단일 서버 배포 CD인가 (예: nginx를 골랐는데 python·go에는 NONSTOP이 없다).
// 그런 타입은 단일 서버 배포로 대신 설치한다 — 설치 직후 지우거나 .bak으로 옮기면 배포가 사라진다.
function isFallbackSimple(filename, style, available) {
  if (!available || !filename.endsWith(SIMPLE_SUFFIX)) return false;
  const prefix = filename.slice(0, -SIMPLE_SUFFIX.length);
  return !available.has(prefix + suffixOf(style));
}

// 파일 필터 — 고른 방식의 CD만 통과. CD가 아닌 파일(PR 프리뷰·common 등)은 항상 통과.
// "none"은 서버 배포 워크플로우(CD·단일 CD·PR 프리뷰)를 하나도 설치하지 않는다.
// available: payload 워크플로우 파일명 집합(payloadWorkflowNames). 주면 고른 방식이 없는 타입은
// 단일 서버 배포로 대체한다. 없으면 접미사만으로 가른다.
export function deployFilter(style, available = null) {
  if (style === NO_DEPLOY_STYLE) return (filename) => !isServerDeployWorkflow(filename);
  const suffix = suffixOf(style);
  return (filename) => !isDeployWorkflow(filename) || filename.endsWith(suffix)
    || isFallbackSimple(filename, style, available);
}

// 고른 방식(nginx·traefik)의 워크플로우가 없어 단일 서버 배포로 대신 설치하는 타입 목록 — 안내용.
export function fallbackStyleTypes(payloadRoot, types = [], style) {
  if (!style || style === NO_DEPLOY_STYLE || suffixOf(style) === SIMPLE_SUFFIX) return [];
  const base = join(payloadRoot, PAYLOAD.workflowsDir);
  return types.filter((type) => {
    const files = [join(base, type), join(base, type, "server-deploy")]
      .filter((dir) => existsSync(dir)).flatMap((dir) => readdirSync(dir));
    return files.some(isServerDeployWorkflow) && !files.some((f) => f.endsWith(suffixOf(style)));
  });
}

// 무중단 템플릿은 push 트리거가 주석 처리된 채 들어 있다(기본 배포가 단일 서버라서).
// 사용자가 그 방식을 고른 이상 트리거는 켜져 있어야 한다 — 안 그러면 설치해도 아무 일이
// 일어나지 않고 사용자가 YAML을 직접 고쳐야 한다.
//
// 첫 `on:` 블록 안에서 `# ` 두 글자만 떼므로 안쪽 들여쓰기 계층이 그대로 보존된다.
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
    if (/^\S/.test(line)) break; // 최상위 키를 다시 만나면 on 블록 종료
    const m = line.match(/^(\s*)# ?(.*)$/);
    if (!m || !TRIGGER_CONTENT.test(m[2])) continue;
    lines[i] = `${m[1]}${m[2]}`;
    changed = true;
  }
  return changed ? lines.join(eol) : content;
}

// 방식을 바꿔 재설치했을 때 이전 CD를 정리한다.
//
// 남겨두면 이전 방식의 push 트리거가 살아 있어 배포가 두 번 돈다. 그렇다고 사용자에게
// "직접 지우세요"라고 떠넘기면 설치가 끝나도 레포가 정상이 아닌 상태로 남는다. 마법사가
// 깐 파일은 마법사가 정리한다.
//
//   손대지 않은 것(baseline의 installed 해시와 동일) → 삭제. 물어볼 이유가 없다.
//   손댄 것                                          → .bak으로 옮긴다. 내용은 지키고 트리거만 죽인다.
//
// opts.available  — payload 워크플로우 파일명 집합. 주면 그 안의 파일(마법사가 까는 파일)만 정리하고,
//                   고른 방식이 없는 타입의 단일 서버 배포는 남긴다.
// opts.justWritten — 이번 실행에서 마법사가 방금 쓴 파일. 첫 설치처럼 baseline이 없어도 수정본으로 오인하지 않는다.
// opts.dryRun      — 판정만 하고 파일은 건드리지 않는다. --dry-run 미리보기가 실제 실행과 같은 판정을 쓰게 한다.
// 반환: { removed:[], backedUp:[] } — 완료 화면·설치 기록에 그대로 보고한다.
export function cleanupOtherDeployWorkflows(workflowsDir, installedFilenames, style, baseline, { available = null, justWritten = [], dryRun = false } = {}) {
  const keep = deployFilter(style, available);
  const written = new Set(justWritten);
  const removed = [];
  const backedUp = [];

  for (const filename of installedFilenames) {
    if (!isServerDeployWorkflow(filename) || keep(filename)) continue;
    if (available && !available.has(filename)) continue; // 사용자가 만든 비슷한 이름의 워크플로우는 건드리지 않는다
    const p = join(workflowsDir, filename);
    if (!existsSync(p)) continue;

    const known = baseline?.files?.[filename]?.installed;
    const untouched = written.has(filename) || (known && sha256(readFileSync(p, "utf8")) === known);
    if (untouched) {
      if (!dryRun) rmSync(p, { force: true });
      removed.push(filename);
    } else {
      if (!dryRun) renameSync(p, `${p}.bak`);
      backedUp.push(filename);
    }
  }
  return { removed, backedUp };
}
