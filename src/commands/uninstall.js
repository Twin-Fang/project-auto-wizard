// uninstall 모드 — revert(payload 파일명 일치분)보다 넓게, README/.gitignore/version.yml까지 선택적으로 제거.
// 대화형 체크리스트 또는 --force + --purge-* 로 항목별 opt-in. revert.js는 건드리지 않고 읽기 전용으로만 재사용한다.
import { join } from "node:path";
import { existsSync, renameSync } from "node:fs";
import { PATHS } from "../core/paths.js";
import { remove } from "../core/fsutil.js";
import { planRevert } from "./revert.js";
import { removeVersionSectionFromReadme, hasVersionSection } from "../core/copy/readme.js";
import { removeAutoAddedEntriesFromGitignore, hasAutoAddedEntries } from "../core/copy/gitignore.js";

// selection: { workflows, scripts, coderabbit, readme, gitignore, versionYml } (모두 boolean).
// 반환: 위와 동일한 키의 boolean/배열 — 실제로 제거 "대상"인지 여부(순수 함수, 아무것도 지우지 않음).
export function planUninstall(payloadRoot, targetRoot, selection) {
  const revertPlan = planRevert(payloadRoot, targetRoot);
  return {
    workflows: selection.workflows ? revertPlan.workflows : [],
    scripts: selection.scripts ? revertPlan.scripts : [],
    coderabbit: selection.coderabbit ? revertPlan.coderabbit : false,
    readme: selection.readme ? hasVersionSection(targetRoot) : false,
    gitignore: selection.gitignore ? hasAutoAddedEntries(targetRoot) : false,
    versionYml: selection.versionYml ? existsSync(join(targetRoot, PATHS.versionFile)) : false,
  };
}

// 반환: planUninstall과 동일한 형태 — 실제로 제거된 항목.
export function runUninstall(context, payloadRoot, targetRoot, selection) {
  const plan = planUninstall(payloadRoot, targetRoot, selection);
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  for (const name of plan.workflows) remove(join(wfDir, name));
  for (const name of plan.scripts) remove(join(targetRoot, PATHS.scriptsDir, name));
  if (plan.coderabbit) {
    const cr = join(targetRoot, ".coderabbit.yaml");
    remove(cr);
    if (existsSync(cr + ".bak")) renameSync(cr + ".bak", cr);
  }
  if (plan.readme) removeVersionSectionFromReadme(targetRoot);
  if (plan.gitignore) removeAutoAddedEntriesFromGitignore(targetRoot);
  if (plan.versionYml) remove(join(targetRoot, PATHS.versionFile));
  return plan;
}
