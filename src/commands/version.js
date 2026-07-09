// version 모드 (.sh execute_integration version case 등가).
// 순서: version.yml → readme → scripts → gitignore.
// (워크플로우 미복사 → deploy 블록 없음. util·issue·coderabbit·setup-guide는 스코프 제외.)
import { join } from "node:path";
import { writeText } from "../core/fsutil.js";
import { PATHS } from "../core/paths.js";
import { buildVersionYml } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { markerForType } from "../core/detect.js";
import { addVersionSectionToReadme } from "../core/copy/readme.js";
import { copyScripts } from "../core/copy/simple.js";
import { ensureGitignore } from "../core/copy/gitignore.js";

export function runVersion(context, payloadRoot, targetRoot = ".") {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    now, today, templateVersion = "unknown", includeNexus = false, includeSecretBackup = false } = context;

  const pathMarkers = new Map();
  for (const [t] of paths) pathMarkers.set(t, markerForType(t));

  writeText(join(targetRoot, PATHS.versionFile),
    buildVersionYml({
      templateText: readVersionYmlTemplate(payloadRoot),
      version, types, paths, pathMarkers, branch, branches: context.branches, versionCode, now, today,
      templateOptions: { templateVersion, includeNexus, includeSecretBackup, optionsDate: today },
    }));
  addVersionSectionToReadme(version, targetRoot);
  copyScripts(payloadRoot, targetRoot);
  ensureGitignore(targetRoot);
}
