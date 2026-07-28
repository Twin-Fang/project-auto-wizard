import { test } from "node:test";
import assert from "node:assert";
import {
  parseWizardPrompts, wfField, workflowDisplayName, loadWizardPrompts,
} from "../../src/core/wizard-labels.js";

test("parseWizardPrompts: block form with label/help/example", () => {
  const text = `
PROJECT_NAME:
  label: "프로젝트 이름"
  help: "레포 이름과 다르게 쓰고 싶을 때만"
  example: "my-app"
`;
  const { fields } = parseWizardPrompts(text);
  assert.deepStrictEqual(fields.get("PROJECT_NAME"), {
    label: "프로젝트 이름", help: "레포 이름과 다르게 쓰고 싶을 때만", example: "my-app",
  });
});

test("parseWizardPrompts: legacy one-line form becomes label only", () => {
  const text = `PROJECT_NAME: "프로젝트 이름"\n`;
  const { fields } = parseWizardPrompts(text);
  assert.strictEqual(fields.get("PROJECT_NAME").label, "프로젝트 이름");
});

test("parseWizardPrompts: type-scoped override key is distinct from bare key", () => {
  const text = `
APP_ARTIFACT_NAME:
  label: "기본 아티팩트 이름"

flutter.APP_ARTIFACT_NAME:
  label: "Flutter 아티팩트 이름"
`;
  const { fields } = parseWizardPrompts(text);
  assert.strictEqual(fields.get("APP_ARTIFACT_NAME").label, "기본 아티팩트 이름");
  assert.strictEqual(fields.get("flutter.APP_ARTIFACT_NAME").label, "Flutter 아티팩트 이름");
});

test("parseWizardPrompts: _workflow_names block populates workflowNames", () => {
  const text = `
_workflow_names:
  REACT-CI: "React CI"
  REACT-CICD: "React CI+CD"
`;
  const { workflowNames } = parseWizardPrompts(text);
  assert.deepStrictEqual(workflowNames, [
    { key: "REACT-CI", value: "React CI" },
    { key: "REACT-CICD", value: "React CI+CD" },
  ]);
});

test("wfField: type-scoped override wins over bare key", () => {
  const prompts = parseWizardPrompts(`
APP_ARTIFACT_NAME:
  label: "기본"

flutter.APP_ARTIFACT_NAME:
  label: "Flutter 전용"
`);
  assert.strictEqual(wfField(prompts, "flutter", "APP_ARTIFACT_NAME", "label"), "Flutter 전용");
  assert.strictEqual(wfField(prompts, "react", "APP_ARTIFACT_NAME", "label"), "기본");
});

test("wfField: missing field falls back to key name for label, empty string otherwise", () => {
  assert.strictEqual(wfField(null, "react", "UNKNOWN_KEY", "label"), "UNKNOWN_KEY");
  assert.strictEqual(wfField(null, "react", "UNKNOWN_KEY", "help"), "");
});

test("workflowDisplayName: longest matching key wins (REACT-CICD over REACT-CI)", () => {
  const prompts = parseWizardPrompts(`
_workflow_names:
  REACT-CI: "React CI"
  REACT-CICD: "React CI+CD"
`);
  assert.strictEqual(workflowDisplayName(prompts, "PROJECT-REACT-CICD.yaml"), "React CI+CD");
  assert.strictEqual(workflowDisplayName(prompts, "PROJECT-REACT-CI.yaml"), "React CI");
});

test("workflowDisplayName: no match falls back to filename without extension", () => {
  assert.strictEqual(workflowDisplayName(null, "PROJECT-BASIC-CI.yaml"), "PROJECT-BASIC-CI");
});

test("loadWizardPrompts: prefers target repo override over payload bundle", () => {
  const fakeFs = {
    existsSync: (p) => String(p).includes("target"),
    readFileSync: () => `PROJECT_NAME:\n  label: "override"\n`,
  };
  const result = loadWizardPrompts("target", "payload", fakeFs);
  assert.strictEqual(result.fields.get("PROJECT_NAME").label, "override");
});

test("loadWizardPrompts: falls back to payload bundle when target has no override", () => {
  const fakeFs = {
    existsSync: (p) => String(p).includes("payload"),
    readFileSync: () => `PROJECT_NAME:\n  label: "bundled"\n`,
  };
  const result = loadWizardPrompts("target", "payload", fakeFs);
  assert.strictEqual(result.fields.get("PROJECT_NAME").label, "bundled");
});

test("loadWizardPrompts: returns null when neither exists", () => {
  const fakeFs = { existsSync: () => false, readFileSync: () => "" };
  assert.strictEqual(loadWizardPrompts("target", "payload", fakeFs), null);
});
