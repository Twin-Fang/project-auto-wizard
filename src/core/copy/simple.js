// 단순 복사 함수 (무조건 덮어쓰기류).
// payload 단일 진실: 스크립트는 payload/scripts/*.py → 사용자 레포 .github/scripts/ 로 설치된다.
// 워크플로우 전부가 이 경로(python3 .github/scripts/*.py)를 호출하므로 누락 시 설치물이 런타임에 죽는다.
import { join } from "node:path";
import { chmodSync, readFileSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { PATHS, PAYLOAD } from "../paths.js";
import { exists, copyFileSync } from "../fsutil.js";

export const SCRIPT_NAMES = ["version_manager.py", "changelog_manager.py", "truncate_release_notes.py", "issue_helper.py"];

// 파일별로 무엇이 일어날지 계산한다(아무것도 쓰지 않음) — 실제 복사와 --dry-run이 같은 판정을 쓴다.
// 반환: [{ name, action: "create" | "overwrite" | "unchanged" }]
export function planScripts(payloadRoot, targetRoot = ".") {
  const out = [];
  for (const name of SCRIPT_NAMES) {
    const src = join(payloadRoot, PAYLOAD.scriptsDir, name);
    if (!exists(src)) continue;
    const dst = join(targetRoot, PATHS.scriptsDir, name);
    const action = !exists(dst) ? "create"
      : readFileSync(dst).equals(readFileSync(src)) ? "unchanged" : "overwrite";
    out.push({ name, action });
  }
  return out;
}

// 스크립트는 항상 payload 버전으로 덮어쓴다 (+chmod — Windows에선 무의미하나 무해).
// 사용자가 고친 스크립트도 덮이므로, 호출부가 로그에 남길 수 있게 파일별 결과를 돌려준다.
export function copyScripts(payloadRoot, targetRoot = ".") {
  const results = planScripts(payloadRoot, targetRoot);
  for (const { name } of results) {
    const dst = join(targetRoot, PATHS.scriptsDir, name);
    copyFileSync(join(payloadRoot, PAYLOAD.scriptsDir, name), dst);
    try { chmodSync(dst, 0o755); } catch { /* Windows 등 chmod 무의미 */ }
  }
  return results;
}

// 예전 버전의 워크플로우는 스크립트 import가 남긴 바이트코드를 봇 커밋에 섞어 올렸다.
// 지금은 생성 자체를 막지만 이미 커밋된 pyc는 업데이트로 사라지지 않으므로 여기서 지운다.
// 범위는 마법사 스크립트 폴더의 pyc와 그 __pycache__뿐이다 — 다른 경로는 건드리지 않는다.
// 반환: 지울(지운) 파일의 targetRoot 기준 상대 경로 목록 — 삭제는 사용자가 설치 파일과 함께 커밋한다
export function planScriptBytecode(targetRoot = ".") {
  const base = join(targetRoot, PATHS.scriptsDir);
  const list = (rel) => {
    try {
      return readdirSync(join(base, rel), { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".pyc"))
        .map((e) => [PATHS.scriptsDir, rel, e.name].filter(Boolean).join("/"));
    } catch { return []; }
  };
  return [...list(""), ...list("__pycache__")];
}

export function removeScriptBytecode(targetRoot = ".") {
  const removed = planScriptBytecode(targetRoot);
  for (const rel of removed) rmSync(join(targetRoot, rel), { force: true });
  if (removed.some((rel) => rel.includes("/__pycache__/"))) {
    // 비었을 때만 지운다 — 다른 파일이 있으면 그대로 둔다
    try { rmdirSync(join(targetRoot, PATHS.scriptsDir, "__pycache__")); } catch { /* 비어 있지 않음 */ }
  }
  return removed;
}
