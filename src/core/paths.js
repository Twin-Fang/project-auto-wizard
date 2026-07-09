// 경로 상수 — 설치 대상(사용자 레포) 경로 + payload 내부 레이아웃.
export const PATHS = {
  versionFile: "version.yml",
  workflowsDir: ".github/workflows",
  scriptsDir: ".github/scripts",
};

// payload/ 내부 레이아웃 (payload 단일 진실 — DESIGN-SPEC §3)
export const PAYLOAD = {
  workflowsDir: "workflows",   // payload/workflows/{common,spring,flutter,...}
  scriptsDir: "scripts",       // payload/scripts/*.py
  configDir: "config",         // payload/config/wizard-prompts.yml 등 (마법사 런타임용)
};

export const WORKFLOW_PREFIX = "PROJECT";
export const WORKFLOW_COMMON_PREFIX = "PROJECT-COMMON";
