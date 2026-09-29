// tests/node/stale-workflows.test.js
// payload에서 이름이 바뀌거나 빠진 옛 워크플로우는 업데이트 때 정리한다 — 남겨두면 옛 트리거로 계속 돈다.
// 규칙은 배포 방식 정리와 같다: 손대지 않은 파일은 삭제, 손댄 파일은 .bak, 마법사가 설치한 기록이 없는 파일은 그대로.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull, postInstallNotices } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runStatus } from "../../src/commands/status.js";
import { sha256, BASELINE_PATH } from "../../src/core/baseline.js";
import { MANAGED_WORKFLOW_MARKER } from "../../src/core/removal-plan.js";

const PAYLOAD = resolvePayloadRoot();
const WF = join(".github", "workflows");

function ctx() {
  return createContext({
    mode: "full", force: true, types: ["python"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), now: "2026-09-01 00:00:00", today: "2026-09-01", templateVersion: "0.12.2",
  });
}

// 예전 버전이 설치한 파일을 흉내낸다 — 관리 마커 + baseline 기록.
function plantOld(target, name, body, { recorded = true } = {}) {
  const text = `${MANAGED_WORKFLOW_MARKER}\nname: ${body}\non: push\n`;
  writeFileSync(join(target, WF, name), text);
  if (recorded) {
    const bp = join(target, BASELINE_PATH);
    const bl = JSON.parse(readFileSync(bp, "utf8"));
    bl.files[name] = { installed: sha256(text), rendered: sha256(text) };
    writeFileSync(bp, JSON.stringify(bl, null, 2));
  }
  return join(target, WF, name);
}

test("업데이트: payload에 없는 옛 워크플로우 — 미수정은 삭제, 수정본은 .bak, 기록 없는 파일은 유지", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-stale-"));
  try {
    runFull(ctx(), PAYLOAD, target);
    const untouched = plantOld(target, "PROJECT-PYTHON-OLD-TRIGGER.yaml", "old-trigger");
    const edited = plantOld(target, "PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml", "secret-upload");
    writeFileSync(edited, readFileSync(edited, "utf8") + "# my edit\n");
    const userCopy = plantOld(target, "MY-APP-DEPLOY.yaml", "my-copy", { recorded: false });

    // 업데이트 전 status가 알려 준다
    assert.deepStrictEqual(runStatus(PAYLOAD, target).staleFiles,
      ["PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml", "PROJECT-PYTHON-OLD-TRIGGER.yaml"]);

    const r = runFull(ctx(), PAYLOAD, target);
    assert.deepStrictEqual(r.staleCleanup.removed, ["PROJECT-PYTHON-OLD-TRIGGER.yaml"]);
    assert.deepStrictEqual(r.staleCleanup.backedUp, ["PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml"]);
    assert.ok(!existsSync(untouched));
    assert.ok(!existsSync(edited) && existsSync(`${edited}.bak`));
    assert.ok(existsSync(userCopy), "마법사가 설치한 기록이 없는 파일은 건드리지 않는다");
    assert.ok(r.gitignoreUpdated, ".bak이 생겼으므로 .gitignore를 갱신한다");
    assert.match(postInstallNotices(r).join("\n"), /PROJECT-PYTHON-OLD-TRIGGER\.yaml — 삭제/);

    const bl = JSON.parse(readFileSync(join(target, BASELINE_PATH), "utf8"));
    assert.ok(!bl.files["PROJECT-PYTHON-OLD-TRIGGER.yaml"] && !bl.files["PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml"],
      "정리한 파일의 기준점도 baseline에서 뺀다");
    assert.deepStrictEqual(runStatus(PAYLOAD, target).staleFiles, []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("업데이트: 현재 payload에 있는 파일은 옛 워크플로우로 보지 않는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-stale-"));
  try {
    runFull(ctx(), PAYLOAD, target);
    const r = runFull(ctx(), PAYLOAD, target);
    assert.deepStrictEqual(r.staleCleanup, { removed: [], backedUp: [] });
    assert.deepStrictEqual(postInstallNotices(r), []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
