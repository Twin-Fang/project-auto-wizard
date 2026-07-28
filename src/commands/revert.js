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

// payload에 존재하는 파일명과 정확히 일치하는 것만 제거 대상으로 계획한다.
// 아무것도 지우지 않는 순수 함수 — --dry-run과 status류 기능에서 재사용.
export function planRevert(payloadRoot, targetRoot = ".") {
  const removedWf = [];
  const removedScripts = [];
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  const names = payloadWorkflowNames(payloadRoot);
  if (existsSync(wfDir)) {
    for (const name of names) {
      const p = join(wfDir, name);
      if (existsSync(p)) removedWf.push(name);
      const templateName = (name.endsWith(".yaml") ? name.slice(0, -".yaml".length) : name) + ".template.yaml";
      if (existsSync(join(wfDir, templateName))) removedWf.push(templateName);
      if (existsSync(p + ".bak")) removedWf.push(name + ".bak");
    }
  }
  for (const s of ["version_manager.py", "changelog_manager.py"]) {
    if (existsSync(join(targetRoot, PATHS.scriptsDir, s))) removedScripts.push(s);
  }
  let coderabbit = false;
  const cr = join(targetRoot, ".coderabbit.yaml");
  const crSrc = join(payloadRoot, "coderabbit.yaml");
  if (existsSync(cr) && existsSync(crSrc) && readFileSync(cr, "utf8") === readFileSync(crSrc, "utf8")) {
    coderabbit = true;
  }
  return { workflows: removedWf, scripts: removedScripts, coderabbit };
}

// 반환: { workflows: [...제거된 파일명], scripts: [...], coderabbit: bool } — planRevert와 동일한 형태.
export function runRevert(context, payloadRoot, targetRoot = ".") {
  const plan = planRevert(payloadRoot, targetRoot);
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  for (const name of plan.workflows) remove(join(wfDir, name));
  for (const name of plan.scripts) remove(join(targetRoot, PATHS.scriptsDir, name));
  if (plan.coderabbit) {
    const cr = join(targetRoot, ".coderabbit.yaml");
    remove(cr);
    if (existsSync(cr + ".bak")) renameSync(cr + ".bak", cr);
  }
  return plan;
}
