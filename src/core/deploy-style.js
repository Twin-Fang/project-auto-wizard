// 배포 방식 (이슈 #80) — 서버 배포 CD 워크플로우는 서로 대체재다.
// Nginx 무중단과 Traefik 무중단을 동시에 쓰는 경우는 없으므로 하나만 설치한다.
// 고른 것은 push 트리거까지 켜서 설치한다 — 설치했는데 안 도는 상태를 만들지 않는다.
import { join } from "node:path";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { sha256 } from "./baseline.js";

// 파일명 접미사로 식별한다 — 타입 접두사(PROJECT-SPRING- 등)는 타입마다 다르기 때문.
export const DEPLOY_STYLES = [
  { value: "simple", suffix: "-SIMPLE-CICD.yaml", label: "단일 서버 배포 — 컨테이너를 내렸다 올린다 (가장 단순, 짧은 다운타임)" },
  { value: "nginx", suffix: "-NONSTOP-NGINX-CICD.yaml", label: "무중단 배포 (Nginx) — nginx config의 proxy_pass 포트를 Blue/Green으로 토글" },
  { value: "traefik", suffix: "-NONSTOP-TRAEFIK-CICD.yaml", label: "무중단 배포 (Traefik) — Traefik 라우팅으로 Blue/Green 전환" },
];

export const DEFAULT_DEPLOY_STYLE = "simple";

export const isDeployStyle = (v) => DEPLOY_STYLES.some((s) => s.value === v);

// 이 파일이 CD 본체인가 (= 택1 대상인가). PR 프리뷰는 배포 방식과 직교하는 축이라 제외한다.
export const isDeployWorkflow = (filename) => DEPLOY_STYLES.some((s) => filename.endsWith(s.suffix));

// 모르는 값은 기본값으로 수렴시킨다. 빈 접미사를 돌려주면 endsWith("")가 항상 참이라
// "전부 통과"가 되어, 잘못된 값이 조용히 CD 전부 설치로 새어나간다.
const suffixOf = (style) =>
  (DEPLOY_STYLES.find((s) => s.value === style) ?? DEPLOY_STYLES.find((s) => s.value === DEFAULT_DEPLOY_STYLE)).suffix;

// 파일 필터 — 고른 방식의 CD만 통과. CD가 아닌 파일(PR 프리뷰·common 등)은 항상 통과.
export function deployFilter(style) {
  const suffix = suffixOf(style);
  return (filename) => !isDeployWorkflow(filename) || filename.endsWith(suffix);
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
// 반환: { removed:[], backedUp:[] } — 완료 화면·설치 기록에 그대로 보고한다.
export function cleanupOtherDeployWorkflows(workflowsDir, installedFilenames, style, baseline) {
  const keep = deployFilter(style);
  const removed = [];
  const backedUp = [];

  for (const filename of installedFilenames) {
    if (!isDeployWorkflow(filename) || keep(filename)) continue;
    const p = join(workflowsDir, filename);
    if (!existsSync(p)) continue;

    const known = baseline?.files?.[filename]?.installed;
    const untouched = known && sha256(readFileSync(p, "utf8")) === known;
    if (untouched) {
      rmSync(p, { force: true });
      removed.push(filename);
    } else {
      renameSync(p, `${p}.bak`);
      backedUp.push(filename);
    }
  }
  return { removed, backedUp };
}
