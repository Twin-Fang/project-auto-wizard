// tests/node/deploy-preflight.test.js
// 서버 배포·PR 프리뷰 워크플로우는 체크아웃 직후 필수 Secret과 Dockerfile을 먼저 점검해,
// 기본 상태(Secret·Dockerfile 없음)에서 docker 로그인 같은 서드파티 오류 대신 빠진 항목을 알려 줘야 한다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOWS_DIR = fileURLToPath(new URL("../../payload/workflows", import.meta.url));
const STEP = "- name: Deploy pre-check (Secrets and Dockerfile)";

// [파일, 빌드 job 수, SSH_AUTH_METHOD 지원 여부]
const CASES = [
  ["go/PROJECT-GO-SIMPLE-CICD.yaml", 1, true],
  ["python/PROJECT-PYTHON-SIMPLE-CICD.yaml", 1, true],
  ["react/PROJECT-REACT-CICD.yaml", 1, true],
  ["next/PROJECT-NEXT-CICD.yaml", 1, true],
  ["spring/server-deploy/PROJECT-SPRING-SIMPLE-CICD.yaml", 1, true],
  ["spring/server-deploy/PROJECT-SPRING-NONSTOP-NGINX-CICD.yaml", 1, true],
  ["spring/server-deploy/PROJECT-SPRING-NONSTOP-TRAEFIK-CICD.yaml", 1, true],
  ["go/PROJECT-GO-PR-PREVIEW.yaml", 3, true],
  ["python/PROJECT-PYTHON-PR-PREVIEW.yaml", 3, true],
  ["spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml", 3, true],
];

for (const [file, count, sshAware] of CASES) {
  const text = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
  const lines = text.split("\n");

  test(`${file}: 모든 빌드 job에 사전 점검이 있고 docker 로그인보다 먼저 실행된다`, () => {
    const starts = lines.flatMap((l, i) => (l.trim() === STEP ? [i] : []));
    assert.strictEqual(starts.length, count);
    const logins = lines.flatMap((l, i) => (/uses: docker\/login-action@/.test(l) ? [i] : []));
    for (const login of logins) {
      assert.ok(starts.some((s) => s < login), `docker 로그인(${login + 1}행) 앞에 사전 점검이 없습니다`);
    }
  });

  test(`${file}: 사전 점검은 빠진 Secret 이름과 Dockerfile 유무를 알리고 실패한다`, () => {
    const i = lines.findIndex((l) => l.trim() === STEP);
    const block = lines.slice(i, i + 45).join("\n");
    for (const name of ["DOCKERHUB_USERNAME", "DOCKERHUB_TOKEN", "SERVER_HOST", "SERVER_USER", "SERVER_PASSWORD"]) {
      assert.ok(block.includes(`${name}: \${{ secrets.${name} }}`), `${name} 점검 누락`);
    }
    if (sshAware) assert.ok(block.includes("SSH_KEY: ${{ secrets.SSH_KEY }}"), "SSH_KEY 점검 누락");
    // The messages come from the catalog (cicd.precheck_*), so assert the annotations and the catalog keys
    assert.strictEqual((block.match(/::error title=/g) || []).length, 2, "missing-Secret and missing-Dockerfile errors");
    assert.match(block, /precheck_secret_title/);
    assert.match(block, /precheck_dockerfile_title/);
    assert.match(block, /working-directory: \$\{\{ env\.PROJECT_PATH \}\}/);
    assert.match(block, /exit 1/);
  });
}

// 같은 SSH 서버 배포인데 타입마다 접속 설정이 다르면 키 인증 전용 서버(AWS EC2 등)에 일부 타입만 배포되지 않는다
for (const [file, , sshAware] of CASES) {
  if (!sshAware) continue;
  test(`${file}: SSH 인증 방식(password|key)과 SSH 포트를 설정으로 받는다`, () => {
    const text = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
    assert.match(text, /^  SSH_AUTH_METHOD: "password"  # @wizard ask:password$/m);
    assert.match(text, /^  SSH_PORT: "__SSH_PORT__"  # @wizard ask:2022$/m);
    const actions = text.split("uses: appleboy/ssh-action@").slice(1).map((s) => s.slice(0, s.indexOf("script:")));
    assert.ok(actions.length > 0, "SSH 배포 스텝 없음");
    for (const block of actions) {
      assert.ok(block.includes("key: ${{ secrets.SSH_KEY }}"), "SSH 키 인증 누락");
      assert.ok(block.includes("port: ${{ env.SSH_PORT }}"), "SSH 포트가 고정값입니다");
    }
    assert.match(text, /if \[ "\$\{SSH_AUTH_METHOD:-password\}" = "key" \]; then\n\s+\[ -n "\$SSH_KEY" \] \|\| MISSING="\$MISSING SSH_KEY"/,
      "사전 점검이 인증 방식에 맞는 Secret을 확인해야 한다");
  });
}
