// 설정을 하나도 채우지 않은 기본 flutter create 프로젝트에서 Flutter 워크플로우가
// 엉뚱한 곳에서 멈추지 않는지 고정한다 (SDK 버전·gradlew·Podfile·시크릿 사전 검사 등).
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const FLUTTER_DIR = join(resolvePayloadRoot(), "workflows", "flutter");
const FILES = readdirSync(FLUTTER_DIR).filter((f) => f.endsWith(".yaml")).sort();
const read = (f) => readFileSync(join(FLUTTER_DIR, f), "utf8");

// subosito/flutter-action 스텝의 with 블록들
function flutterActionBlocks(text) {
  return [...text.matchAll(/uses: subosito\/flutter-action@v2\n        with:\n((?:          .*\n)+)/g)].map((m) => m[1]);
}

test("Flutter SDK 버전을 특정 버전에 고정하지 않고 stable 최신을 기본으로 쓴다", () => {
  let setups = 0;
  for (const f of FILES) {
    const text = read(f);
    const blocks = flutterActionBlocks(text);
    if (blocks.length === 0) continue;
    // 고정 버전은 최신 flutter create 프로젝트(sdk 제약 상향)에서 pub get부터 실패한다
    assert.match(text, /^  FLUTTER_VERSION: ""$/m, `${f}: FLUTTER_VERSION 기본값은 빈 값이어야 합니다`);
    for (const block of blocks) {
      setups++;
      assert.ok(block.includes("channel: stable\n"), `${f}: channel: stable이 없습니다`);
      assert.ok(block.includes("flutter-version: ${{ env.FLUTTER_VERSION }}\n"), `${f}: FLUTTER_VERSION으로 덮어쓸 수 없습니다`);
      // 버전 문자열로 만든 캐시 키는 빈 값일 때 stable이 올라가도 옛 SDK를 복원한다
      assert.ok(!block.includes("cache-key: flutter-${{ runner.os }}-${{ env.FLUTTER_VERSION }}"), `${f}: 버전 고정 캐시 키`);
    }
  }
  assert.strictEqual(setups, 12, "subosito/flutter-action 스텝 수");
});

test("gradlew·Podfile이 저장소에 없어도(기본 flutter create) 해당 스텝이 실패하지 않는다", () => {
  let gradle = 0;
  let pods = 0;
  for (const f of FILES) {
    const lines = read(f).split("\n");
    lines.forEach((line, i) => {
      const code = line.trim();
      if (code === "chmod +x gradlew") {
        gradle++;
        assert.ok(lines.slice(Math.max(0, i - 3), i).some((l) => l.trim() === "if [ -f gradlew ]; then"), `${f}:${i + 1} gradlew 존재 확인 없이 chmod`);
      }
      if (/pod install/.test(code) && !code.startsWith("echo") && !code.startsWith("#")) {
        pods++;
        assert.ok(lines.slice(Math.max(0, i - 3), i).some((l) => l.trim() === "if [ -f ios/Podfile ]; then"), `${f}:${i + 1} Podfile 존재 확인 없이 pod install`);
      }
    });
  }
  assert.strictEqual(gradle, 3, "gradlew chmod 스텝 수");
  assert.strictEqual(pods, 4, "pod install 스텝 수");
});
