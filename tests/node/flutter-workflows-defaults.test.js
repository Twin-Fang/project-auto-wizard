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

test("iOS TestFlight 2종은 준비 job 초반에 Secret·ExportOptions 플레이스홀더·Fastfile을 먼저 검사한다", () => {
  for (const [f, job] of [["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml", "prepare-build"], ["PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml", "prepare-test-build"]]) {
    const text = read(f);
    const jobStart = text.indexOf(`\n  ${job}:\n`);
    const preflight = text.indexOf("- name: 배포 설정 사전 검증", jobStart);
    assert.ok(jobStart !== -1 && preflight !== -1, `${f}: 사전 검증 스텝이 없습니다`);
    // 같은 job 안, 인증서 import·Flutter 설치보다 앞이어야 기본 상태에서 안내 메시지에 도달한다
    const nextJob = text.slice(jobStart + 1).search(/\n  [a-z][\w-]*:\n/) + jobStart + 1;
    assert.ok(preflight < nextJob, `${f}: 사전 검증이 ${job} 밖에 있습니다`);
    assert.ok(preflight < text.indexOf("- name: Import Code-Signing Certificates"), `${f}: 인증서 import보다 뒤`);
    assert.ok(preflight < text.indexOf("uses: subosito/flutter-action@v2"), `${f}: Flutter 설치보다 뒤`);
    const step = text.slice(preflight, text.indexOf("\n      - name: ", preflight + 1));
    for (const secret of ["APPLE_CERTIFICATE_BASE64", "APPLE_PROVISIONING_PROFILE_BASE64", "IOS_PROVISIONING_PROFILE_NAME",
      "APP_STORE_CONNECT_API_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID", "APP_STORE_CONNECT_API_KEY_BASE64"]) {
      assert.ok(step.includes(`${secret}: \${{ secrets.${secret} }}`), `${f}: ${secret} 검사 누락`);
    }
    assert.ok(step.includes("grep -Eq '__[A-Z][A-Z0-9_]*__' ios/ExportOptions.plist"), `${f}: 플레이스홀더 검사 누락`);
    assert.ok(step.includes("ios/fastlane/Fastfile"), `${f}: Fastfile 검사 누락`);
    assert.ok(step.includes("exit 1"), `${f}: 누락 시 중단하지 않습니다`);
  }
});

test("빈 서명·자격증명 Secret을 성공처럼 넘기지 않는다", () => {
  for (const f of FILES) {
    const text = read(f);
    // 실패를 삼키는 `|| echo "... failed"` 패턴이 없어야 한다
    assert.ok(!/\|\| echo "[^"]*failed"/i.test(text), `${f}: 실패를 echo로 삼키는 코드가 남아 있습니다`);
    // Secret을 run 본문에 직접 펼쳐 base64로 풀면 빈 값이 조용히 빈 파일이 된다
    assert.ok(!/echo "\$\{\{ secrets\.[A-Z_]+ \}\}" \| base64/.test(text), `${f}: Secret을 검사 없이 디코딩합니다`);
    assert.ok(!text.includes("${{ secrets.GOOGLE_SERVICES_JSON }}\n          EOF"), `${f}: 빈 google-services.json을 만들 수 있습니다`);
  }
  for (const f of ["PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml", "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml", "PROJECT-FLUTTER-ANDROID-TEST-APK.yaml"]) {
    const text = read(f);
    const start = text.indexOf("- name: Setup Release Keystore");
    const step = text.slice(start, text.indexOf("\n      - name: ", start));
    assert.ok(step.includes("for name in RELEASE_KEYSTORE_BASE64 RELEASE_KEYSTORE_PASSWORD RELEASE_KEY_ALIAS RELEASE_KEY_PASSWORD; do"), `${f}: 서명 Secret 검사 누락`);
    assert.ok(step.indexOf("exit 1") < step.indexOf("✅ Release Keystore 생성 완료"), `${f}: 검사 전에 성공 메시지를 냅니다`);
  }
  const selfhosted = read("PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml");
  assert.ok(selfhosted.includes('if [ -z "$DEBUG_KEYSTORE" ]; then'), "SELFHOSTED: DEBUG_KEYSTORE 검사 누락");
  assert.ok(selfhosted.includes("# DEBUG_KEYSTORE:"), "SELFHOSTED: 실제로 쓰는 DEBUG_KEYSTORE가 상단 안내에 없습니다");
});
