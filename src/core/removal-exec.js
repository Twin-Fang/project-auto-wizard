// uninstall·purge 공통 삭제 실행부 — 두 명령은 옵션을 삭제 계획으로 바꾸기만 하고,
// 실제 삭제와 기록은 여기서 한 번에 처리한다. 대상 판별은 removal-plan.js(읽기 전용)가 맡는다.
import { join, posix } from "node:path";
import { readdirSync, rmdirSync } from "node:fs";
import { PATHS } from "./paths.js";
import { remove } from "./fsutil.js";
import { removeVersionSectionFromReadme } from "./copy/readme.js";
import { removeAutoAddedEntriesFromGitignore } from "./copy/gitignore.js";
import { logRemovals } from "./logger.js";

// 파일을 지운 뒤 비게 된 상위 폴더를 레포 루트 직전까지 정리한다(마법사가 만든 fastlane/ 등).
// 비어 있지 않은 폴더를 만나면 멈추므로 사용자 파일이 남은 폴더는 건드리지 않는다.
export function pruneEmptyDirs(targetRoot, relDir) {
  let rel = relDir;
  while (rel && rel !== "." && rel !== "/") {
    const abs = join(targetRoot, rel);
    try {
      if (readdirSync(abs).length) break;
      rmdirSync(abs);
    } catch { break; }
    rel = posix.dirname(rel);
  }
}

// Flutter 앱 파일 제거 — 미수정분만 plan에 들어오므로 그대로 지우고 빈 폴더를 정리한다.
// 로그는 삭제가 끝난 뒤 한꺼번에 남기므로 기록할 항목을 done에 모은다.
export function removeAppFiles(targetRoot, appFiles, done = []) {
  for (const rel of appFiles) {
    remove(join(targetRoot, rel));
    pruneEmptyDirs(targetRoot, posix.dirname(rel));
    done.push(["remove", "flutter-app", rel]);
  }
}

// 설치물을 지운 뒤 비게 된 .github/workflows·.github/scripts(와 .github)를 정리한다.
// 이번에 그 폴더에서 무언가를 지웠을 때만 — 원래 비어 있던 폴더까지 손대지 않는다.
export function pruneInstallDirs(targetRoot, plan) {
  if (plan.workflows.length || plan.baseline?.length) pruneEmptyDirs(targetRoot, PATHS.workflowsDir);
  if (plan.scripts.length) pruneEmptyDirs(targetRoot, PATHS.scriptsDir);
}

// plan: { workflows, scripts, appFiles, baseline, versionYml, readme, gitignore, changelog } — 모두 "삭제 대상" 여부/목록.
// options.logOrder: 뒤쪽 항목(version·readme·gitignore·changelog)의 기록 순서 — 명령마다 기존 순서를 유지한다.
// options.gitignoreDetail(status): .gitignore 기록 문구. null을 돌려주면 기록하지 않는다.
// 반환: 실제로 제거된 결과 — readme/gitignore는 plan이 대상으로 봤어도 안전하게 포기(skip-*)될 수 있어 실제 결과로 덮어쓴다.
export function executeRemoval(targetRoot, plan, { logOrder, gitignoreDetail }) {
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  const done = [];
  for (const name of plan.workflows) { remove(join(wfDir, name)); done.push(["remove", "workflow", name]); }
  for (const name of plan.scripts) { remove(join(targetRoot, PATHS.scriptsDir, name)); done.push(["remove", "script", name]); }
  removeAppFiles(targetRoot, plan.appFiles, done);
  for (const p of plan.baseline || []) { remove(join(targetRoot, p)); done.push(["remove", "metadata", p]); }
  pruneInstallDirs(targetRoot, plan);

  const entries = { version: [], readme: [], gitignore: [], changelog: [] };
  const readme = !!plan.readme && removeVersionSectionFromReadme(targetRoot) === "removed";
  const gitignoreStatus = plan.gitignore ? removeAutoAddedEntriesFromGitignore(targetRoot) : null;
  const gitignore = gitignoreStatus === "removed" || gitignoreStatus === "file-deleted";
  if (plan.versionYml) { remove(join(targetRoot, PATHS.versionFile)); entries.version.push(["remove", "version", PATHS.versionFile]); }
  for (const f of plan.changelog || []) { remove(join(targetRoot, f)); entries.changelog.push(["remove", "changelog", f]); }
  if (readme) entries.readme.push(["remove", "readme", "README.md 버전 섹션"]);
  const detail = gitignoreStatus && gitignoreDetail(gitignoreStatus);
  if (detail) entries.gitignore.push(["remove", "gitignore", detail]);
  for (const k of logOrder) done.push(...entries[k]);
  logRemovals(targetRoot, done);
  return { readme, gitignore };
}
