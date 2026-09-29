// 파일시스템 공용 유틸 (LF 보존 바이트 복사). 텍스트는 그대로 복사해 원본 줄바꿈 유지.
import {
  cpSync, existsSync, readFileSync, writeFileSync, mkdirSync,
  readdirSync, rmSync, accessSync, constants,
} from "node:fs";
import { dirname, join } from "node:path";

export const exists = (p) => existsSync(p);
export const readText = (p) => readFileSync(p, "utf8");

export function writeText(p, s) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s);
}

// 단일 파일 복사 (부모 디렉토리 자동 생성, 바이트 그대로)
export function copyFileSync(src, dst) {
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
}

// 디렉토리 재귀 복사 (내용을 dst 하위로)
export function copyDirSync(src, dst) {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
}

// 파일/폴더 삭제 (없어도 무해)
export function remove(p) {
  rmSync(p, { recursive: true, force: true });
}

// 디렉토리 직하위 .yaml/.yml 파일명 목록. 하위 폴더 제외.
// 정렬 순서는 .sh의 glob `"$_dir"/*.yaml "$_dir"/*.yml` 와 일치시킨다:
// 확장자로 1차 그룹(.yaml 먼저 → .yml 나중), 각 그룹 안에서 알파벳순.
// (단순 .sort()는 확장자를 섞어 정렬해 .sh와 파일 순회 순서가 갈리고,
//  그 결과 version.yml deploy 블록의 키 순서까지 달라진다. 확장자 그룹핑으로 바이트 등가 확보.)
export function listYamlFiles(dir) {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ya?ml)$/.test(e.name))
    .map((e) => e.name);
  const yaml = names.filter((n) => n.endsWith(".yaml")).sort();
  const yml = names.filter((n) => n.endsWith(".yml")).sort();
  return [...yaml, ...yml];
}

// 쓰기 전에 권한을 미리 확인한다 — 중간에 EACCES로 멈추면 일부만 설치된 상태가 남고,
// 다음 실행에서는 기준점(baseline)이 없어 이미 쓴 파일이 전부 충돌로 분류된다.
// dirs: 파일을 만들 폴더(없으면 만들어질 가장 가까운 상위 폴더를 본다), files: 이미 있으면 덮어쓸 파일.
// 반환: 쓸 수 없는 경로(root 기준 상대경로) 목록.
export function findUnwritable(root, dirs = [], files = []) {
  const writable = (p) => { try { accessSync(p, constants.W_OK); return true; } catch { return false; } };
  const blocked = new Set();
  for (const rel of dirs) {
    let cur = rel;
    while (cur !== "." && !existsSync(join(root, cur))) cur = dirname(cur);
    if (!writable(join(root, cur))) blocked.add(cur);
  }
  for (const rel of files) {
    if (existsSync(join(root, rel)) && !writable(join(root, rel))) blocked.add(rel);
  }
  return [...blocked];
}
