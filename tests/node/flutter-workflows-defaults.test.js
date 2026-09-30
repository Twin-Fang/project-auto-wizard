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

test("both iOS TestFlight workflows check Secrets, ExportOptions placeholders and the Fastfile early in the prepare job", () => {
  for (const [f, job] of [["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml", "prepare-build"], ["PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml", "prepare-test-build"]]) {
    const text = read(f);
    const jobStart = text.indexOf(`\n  ${job}:\n`);
    const preflight = text.indexOf("- name: Validate deploy settings", jobStart);
    assert.ok(jobStart !== -1 && preflight !== -1, `${f}: pre-check step is missing`);
    // Inside the same job and before the certificate import / Flutter install, so a default project reaches the guidance message
    const nextJob = text.slice(jobStart + 1).search(/\n  [a-z][\w-]*:\n/) + jobStart + 1;
    assert.ok(preflight < nextJob, `${f}: pre-check is outside ${job}`);
    assert.ok(preflight < text.indexOf("- name: Import Code-Signing Certificates"), `${f}: pre-check comes after the certificate import`);
    assert.ok(preflight < text.indexOf("uses: subosito/flutter-action@v2"), `${f}: pre-check comes after the Flutter install`);
    const step = text.slice(preflight, text.indexOf("\n      - name: ", preflight + 1));
    for (const secret of ["APPLE_CERTIFICATE_BASE64", "APPLE_PROVISIONING_PROFILE_BASE64", "IOS_PROVISIONING_PROFILE_NAME",
      "APP_STORE_CONNECT_API_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID", "APP_STORE_CONNECT_API_KEY_BASE64"]) {
      assert.ok(step.includes(`${secret}: \${{ secrets.${secret} }}`), `${f}: ${secret} check is missing`);
    }
    assert.ok(step.includes("grep -Eq '__[A-Z][A-Z0-9_]*__' ios/ExportOptions.plist"), `${f}: placeholder check is missing`);
    assert.ok(step.includes("ios/fastlane/Fastfile"), `${f}: Fastfile check is missing`);
    assert.ok(step.includes("exit 1"), `${f}: does not stop when something is missing`);
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
  // 스토어 배포는 스토어에 등록된 키와 달라지면 안 되므로 빈 서명 Secret이면 실패한다
  for (const f of ["PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml", "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml"]) {
    const text = read(f);
    const start = text.indexOf("- name: Setup Release Keystore");
    const step = text.slice(start, text.indexOf("\n      - name: ", start));
    assert.ok(step.includes("for name in RELEASE_KEYSTORE_BASE64 RELEASE_KEYSTORE_PASSWORD RELEASE_KEY_ALIAS RELEASE_KEY_PASSWORD; do"), `${f}: 서명 Secret 검사 누락`);
    // the message text lives in the catalog; the step must fail through the signing_secrets_empty key
    assert.ok(step.includes("::error::$(m flutter_a.signing_secrets_empty"), `${f}: 빈 서명 Secret으로 실패하지 않습니다`);
    assert.ok(step.indexOf("exit 1") < step.indexOf("m flutter_a.release_keystore_created"), `${f}: 검사 전에 성공 메시지를 냅니다`);
  }
  const selfhosted = read("PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml");
  assert.ok(selfhosted.includes('if [ -z "$DEBUG_KEYSTORE" ]; then'), "SELFHOSTED: DEBUG_KEYSTORE 검사 누락");
  assert.ok(selfhosted.includes("# DEBUG_KEYSTORE (optional):"), "SELFHOSTED: 실제로 쓰는 DEBUG_KEYSTORE가 상단 안내에 없습니다");
});

test("테스트·내부 배포 빌드는 서명 Secret이 없으면 경고 후 기본 debug 서명으로 진행한다", () => {
  const cases = [
    ["PROJECT-FLUTTER-ANDROID-TEST-APK.yaml", "Setup Release Keystore", "Create key.properties", "release", "mode=debug"],
    ["PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml", "Setup Debug Keystore", "Setup Keystore and key.properties", "keystore", "mode=default"],
  ];
  for (const [f, signingStep, propsStep, mode, fallback] of cases) {
    const text = read(f);
    const start = text.indexOf(`- name: ${signingStep}\n        id: signing\n`);
    assert.ok(start !== -1, `${f}: 서명 스텝에 id: signing이 없습니다`);
    const step = text.slice(start, text.indexOf("\n      - name: ", start));
    // 비어 있으면 실패 대신 경고 + debug 서명
    assert.ok(step.includes("::warning::"), `${f}: 빈 Secret 경고가 없습니다`);
    assert.ok(!/::error::\$\(m [\w.]*signing_secrets_empty/.test(step), `${f}: 빈 Secret으로 실패합니다`);
    assert.ok(step.indexOf(fallback) < step.indexOf("exit 0"), `${f}: 폴백 후 종료가 없습니다`);
    // 깨진 값은 base64 디코딩이 실패하며 중단된다 (|| 로 삼키지 않음)
    assert.ok(/printf '%s' "\$\w+" \| base64 -d > \S+\n/.test(step), `${f}: 디코딩 실패를 삼킵니다`);
    // keystore를 만들지 못했으면 key.properties도 만들지 않는다 (빈 설정이 프로젝트 기본 서명을 덮지 않게)
    assert.ok(text.includes(`- name: ${propsStep}\n        if: steps.signing.outputs.mode == '${mode}'\n`), `${f}: key.properties 생성 조건 누락`);
  }
});

test("수동 실행(workflow_dispatch) 배포 모드 기본값이 설치 시 선택한 모드를 따른다", async () => {
  const { makeSrcText } = await import("../../src/core/copy/workflows.js");
  const { substituteEnv } = await import("../../src/core/wizard-env.js");
  for (const [f, token] of [["PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml", "android-deploy-mode"], ["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml", "ios-deploy-mode"]]) {
    assert.ok(read(f).includes(`        default: "store_only"  # @wizard auto:${token}\n`), `${f}: dispatch 기본값 마커 누락`);
    const source = makeSrcText({ main: "main", develop: "develop", mode: "pr-flow" })(join(FLUTTER_DIR, f));
    const rendered = substituteEnv(source, { type: "flutter", resolvers: { [token]: () => "store_submit" } });
    assert.ok(rendered.includes('        default: "store_submit"\n'), `${f}: dispatch 기본값이 선택값으로 바뀌지 않았습니다`);
    assert.ok(rendered.includes("|| 'store_submit' }}"), `${f}: 폴백과 dispatch 기본값이 어긋납니다`);
  }
});

test("CI changes job은 push 때 이번 push의 커밋만 비교한다 (기본 브랜치 누적 diff 금지)", () => {
  const text = read("PROJECT-FLUTTER-CI.yaml");
  const filter = text.slice(text.indexOf("uses: dorny/paths-filter@v4"), text.indexOf("filters: |"));
  assert.ok(
    filter.includes("base: ${{ github.event_name == 'push' && github.event.before != '0000000000000000000000000000000000000000' && github.event.before || '' }}"),
    "push 이벤트 base가 github.event.before가 아닙니다",
  );
});

// Secret 없이 실행하면 빌드를 몇 분 진행한 뒤에야(또는 빈 SMB 주소로) 실패했다.
// 첫 job의 체크아웃 직후에 필요한 Secret을 모두 점검하고, 선택 Secret은 점검하지 않는다.
test("Android 배포 워크플로우는 체크아웃 직후 필수 Secret을 한꺼번에 점검한다", () => {
  const STEP = "- name: Pre-deploy check (Secrets)";
  const SIGN = ["RELEASE_KEYSTORE_BASE64", "RELEASE_KEYSTORE_PASSWORD", "RELEASE_KEY_ALIAS", "RELEASE_KEY_PASSWORD"];
  const cases = [
    ["PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml", ["SERVER_HOST", "SERVER_USER", "SERVER_PASSWORD"], ["DEBUG_KEYSTORE", "GOOGLE_SERVICES_JSON"]],
    ["PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml", [...SIGN, "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64", "ANDROID_PACKAGE_NAME"], ["GOOGLE_SERVICES_JSON", "ENV_FILE"]],
    ["PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml", [...SIGN, "FIREBASE_SERVICE_ACCOUNT_JSON_BASE64"], ["GOOGLE_SERVICES_JSON", "ENV_FILE"]],
  ];
  for (const [f, required, optional] of cases) {
    const lines = read(f).split("\n");
    const at = lines.findIndex((l) => l.trim() === STEP);
    assert.ok(at > 0, `${f}: 사전 점검 스텝 없음`);
    // 파일에서 첫 번째 스텝이 체크아웃이고, 바로 다음 스텝이 사전 점검이어야 한다
    const steps = lines.flatMap((l, i) => (/^      - name: /.test(l) ? [i] : []));
    assert.match(lines[steps[0]], /Check ?out repository/, `${f}: 첫 스텝이 체크아웃이 아님`);
    assert.strictEqual(steps[1], at, `${f}: 사전 점검이 체크아웃 바로 다음이 아님`);
    const block = lines.slice(at, steps[2]).join("\n");
    for (const name of required) assert.ok(block.includes(`${name}: \${{ secrets.${name}`), `${f}: ${name} 점검 누락`);
    for (const name of optional) assert.ok(!block.includes(`secrets.${name} `), `${f}: 선택 Secret ${name}을 필수로 점검함`);
    assert.match(block, /::error title=\$\(m flutter_a\.precheck_missing_title\)::\$\(m flutter_a\.precheck_missing_body missing="\$MISSING"\)/);
    assert.match(block, /exit 1/);
  }
});
