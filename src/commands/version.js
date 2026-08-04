// version 모드 (.sh execute_integration version case 등가).
// 순서: version.yml → readme → scripts.
// (워크플로우를 복사하지 않으므로 충돌 백업 부산물이 생길 수 없다 — gitignore 갱신 대상 없음, issue #7.
//  util·issue·setup-guide는 스코프 제외.)
import { join } from "node:path";
import { writeText } from "../core/fsutil.js";
import { PATHS } from "../core/paths.js";
import { buildVersionYml } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { markerForType } from "../core/detect.js";
import { addVersionSectionToReadme } from "../core/copy/readme.js";
import { copyScripts } from "../core/copy/simple.js";

export function runVersion(context, payloadRoot, targetRoot = ".") {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false,
    includeSemverAuto } = context;

  const pathMarkers = new Map();
  for (const [t] of paths) pathMarkers.set(t, markerForType(t));

  writeText(join(targetRoot, PATHS.versionFile),
    buildVersionYml({
      templateText: readVersionYmlTemplate(payloadRoot),
      version, types, paths, pathMarkers, branch, branches: context.branches, versionCode, now, today,
      templateOptions: { templateVersion, includeNexus, includeSecretBackup, includeSemverAuto: includeSemverAuto !== false, optionsDate: today },
    }));
  addVersionSectionToReadme(version, targetRoot);
  copyScripts(payloadRoot, targetRoot);
}
