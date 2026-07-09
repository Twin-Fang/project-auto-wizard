// revert 모드 — payload 유래 파일만 제거 (DESIGN-SPEC §4 되돌리기).
// 원칙: payload에 존재하는 파일명과 정확히 일치하는 것만 지운다.
// 사용자가 직접 만든 워크플로우·version.yml·README·.gitignore는 건드리지 않는다
// (version.yml은 사용자 버전 데이터 — 제거 대상이 아니라 산출물이다).
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { PATHS, PAYLOAD } from "../core/paths.js";
import { remove } from "../core/fsutil.js";

// payload/workflows/** 전체(하위 폴더 포함)의 yaml 파일명 집합.
function payloadWorkflowNames(payloadRoot) {
  const names = new Set();
  const root = join(payloadRoot, PAYLOAD.workflowsDir);
  if (!existsSync(root)) return names;
  for (const e of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && /\.(ya?ml)$/.test(e.name)) names.add(e.name);
  }
  return names;
}

// 반환: { workflows: [...제거된 파일명], scripts: [...], coderabbit: bool }
export function runRevert(context, payloadRoot, targetRoot = ".") {
  const removedWf = [];
  const removedScripts = [];

  // 1. 워크플로우 — payload 파일명 일치분 + 마법사가 만든 .template.yaml/.bak 파생본
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  const names = payloadWorkflowNames(payloadRoot);
  if (existsSync(wfDir)) {
    for (const name of names) {
      const p = join(wfDir, name);
      if (existsSync(p)) { remove(p); removedWf.push(name); }
      const templateName = (name.endsWith(".yaml") ? name.slice(0, -".yaml".length) : name) + ".template.yaml";
      const tp = join(wfDir, templateName);
      if (existsSync(tp)) { remove(tp); removedWf.push(templateName); }
      const bp = p + ".bak";
      if (existsSync(bp)) { remove(bp); removedWf.push(name + ".bak"); }
    }
  }

  // 2. 스크립트 — payload가 설치한 2종만
  for (const s of ["version_manager.py", "changelog_manager.py"]) {
    const p = join(targetRoot, PATHS.scriptsDir, s);
    if (existsSync(p)) { remove(p); removedScripts.push(s); }
  }

  // 3. .coderabbit.yaml — payload 원본과 바이트 일치할 때만 제거 (사용자 자체 파일 보호).
  //    설치 시 백업(.bak)이 있으면 복원한다.
  let coderabbit = false;
  const cr = join(targetRoot, ".coderabbit.yaml");
  const crSrc = join(payloadRoot, "coderabbit.yaml");
  if (existsSync(cr) && existsSync(crSrc)
    && readFileSync(cr, "utf8") === readFileSync(crSrc, "utf8")) {
    remove(cr);
    coderabbit = true;
    if (existsSync(cr + ".bak")) renameSync(cr + ".bak", cr);
  }

  return { workflows: removedWf, scripts: removedScripts, coderabbit };
}
