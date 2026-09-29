// tests/node/release-options.test.js
// semver_auto·copilot_ai 값 결정 규칙 — 비대화형과 대화형이 같은 함수를 쓰므로 여기서 한 번에 고정한다.
import { test } from "node:test";
import assert from "node:assert";
import { pickReleaseOptions, resolveReleaseOptions } from "../../src/core/release-options.js";

const saved = (semverAuto, copilotAi) => ({ options: { semverAuto, copilotAi } });

test("신규 설치 기본값: semver_auto 켜짐, copilot 꺼짐", () => {
  assert.deepStrictEqual(resolveReleaseOptions({}, null), { includeSemverAuto: true, includeCopilotAi: false });
});

test("저장값이 없는 기존 설치: semver_auto도 꺼짐으로 둔다", () => {
  assert.deepStrictEqual(resolveReleaseOptions({}, saved(null, null)), { includeSemverAuto: false, includeCopilotAi: false });
});

test("저장값이 기본값보다 우선한다", () => {
  assert.deepStrictEqual(resolveReleaseOptions({}, saved(true, true)), { includeSemverAuto: true, includeCopilotAi: true });
  assert.deepStrictEqual(resolveReleaseOptions({}, saved(false, false)), { includeSemverAuto: false, includeCopilotAi: false });
});

test("명시값(플래그·답변)이 저장값보다 우선한다", () => {
  assert.deepStrictEqual(
    resolveReleaseOptions({ semverAuto: false, copilotAi: true }, saved(true, false)),
    { includeSemverAuto: false, includeCopilotAi: true });
  assert.deepStrictEqual(
    resolveReleaseOptions({ semverAuto: true, copilotAi: false }, saved(false, true)),
    { includeSemverAuto: true, includeCopilotAi: false });
});

test("pickReleaseOptions는 정해지지 않은 값을 null로 남긴다 — 대화형은 이 값으로 질문 여부를 가른다", () => {
  assert.deepStrictEqual(pickReleaseOptions({}, null), { semverAuto: null, copilotAi: null });
  assert.deepStrictEqual(pickReleaseOptions({ copilotAi: undefined }, saved(false, null)), { semverAuto: false, copilotAi: null });
  assert.deepStrictEqual(pickReleaseOptions({ semverAuto: true }, saved(false, true)), { semverAuto: true, copilotAi: true });
});
