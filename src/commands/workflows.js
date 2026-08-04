// workflows 모드 (.sh execute_integration workflows case 등가).
// 순서: copy_workflows → update_version_yml_deploy(version.yml 있을 때만) → scripts.
// (version.yml 생성 안 함 — 기존 version.yml이 있을 때만 deploy 블록 추가.
//  util/config/setup-guide 설치는 project-auto-wizard 스코프에서 제외 — DESIGN-SPEC §2)
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PATHS } from "../core/paths.js";
import { copyWorkflows } from "../core/copy/workflows.js";
import { copyScripts } from "../core/copy/simple.js";
import { escapeYamlDoubleQuoted } from "../core/wizard-env.js";

export function runWorkflows(context, payloadRoot, targetRoot = ".", hooks = {}) {
  const wf = copyWorkflows(context, payloadRoot, targetRoot, hooks);

  // update_version_yml_deploy: 기존 version.yml이 있고 ask 값이 있을 때만 deploy 블록 갱신
  const vy = join(targetRoot, PATHS.versionFile);
  if (existsSync(vy) && wf.deployValues && wf.deployValues.size) {
    writeFileSync(vy, upsertDeployBlock(readFileSync(vy, "utf8"), wf.deployValues));
  }

  copyScripts(payloadRoot, targetRoot);
  return { workflows: wf };
}

// 기존 version.yml에서 deploy: 블록을 제거하고 새로 append (.sh update_version_yml_deploy 멱등).
export function upsertDeployBlock(content, deployValues) {
  // 기존 deploy: 블록 제거 (deploy: 라인 ~ 다음 최상위 키 전까지)
  const lines = content.split(/\r?\n/);
  const out = [];
  let inDeploy = false;
  for (const line of lines) {
    if (/^deploy:/.test(line)) { inDeploy = true; continue; }
    if (inDeploy) {
      if (/^\s/.test(line) || line === "") continue; // 들여쓰기/빈줄 = deploy 내부
      inDeploy = false;
    }
    out.push(line);
  }
  let text = out.join("\n").replace(/\n+$/, "\n");
  // 새 deploy 블록 append
  const deployTypes = [...deployValues.keys()].filter((t) => deployValues.get(t)?.size);
  if (deployTypes.length) {
    text += `\ndeploy:                          # 마법사가 기억하는 배포 설정 (비민감 / 직접 수정 가능)\n`;
    for (const t of deployTypes) {
      text += `  ${t}:\n`;
      // 동일한 이스케이프를 재사용 — deploy 값도 @wizard ask 값과 같은 경로로 들어오므로
      // 큰따옴표가 섞이면 YAML이 깨진다 (issue #20 L9, 세 번째 지점).
      for (const [k, v] of deployValues.get(t)) text += `    ${k}: "${escapeYamlDoubleQuoted(v)}"\n`;
    }
  }
  return text;
}
