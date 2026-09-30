// tests/node/deploy-preflight.test.js
// Server-deploy and PR-preview workflows must check required Secrets and the Dockerfile right after checkout,
// so that in the default state (no Secrets, no Dockerfile) the missing items are reported instead of a third-party error such as a docker login failure.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOWS_DIR = fileURLToPath(new URL("../../payload/workflows", import.meta.url));
const STEP = "- name: Deploy pre-check (Secrets and Dockerfile)";

// [file, number of build jobs, whether SSH_AUTH_METHOD is supported]
const CASES = [
  ["go/PROJECT-GO-SIMPLE-CICD.yaml", 1, true],
  ["python/PROJECT-PYTHON-SIMPLE-CICD.yaml", 1, true],
  ["react/PROJECT-REACT-CICD.yaml", 1, true],
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

  test(`${file}: every build job has a pre-check that runs before docker login`, () => {
    const starts = lines.flatMap((l, i) => (l.trim() === STEP ? [i] : []));
    assert.strictEqual(starts.length, count);
    const logins = lines.flatMap((l, i) => (/uses: docker\/login-action@/.test(l) ? [i] : []));
    for (const login of logins) {
      assert.ok(starts.some((s) => s < login), `no pre-check before docker login (line ${login + 1})`);
    }
  });

  test(`${file}: pre-check reports missing Secret names and Dockerfile presence, then fails`, () => {
    const i = lines.findIndex((l) => l.trim() === STEP);
    const block = lines.slice(i, i + 45).join("\n");
    for (const name of ["DOCKERHUB_USERNAME", "DOCKERHUB_TOKEN", "SERVER_HOST", "SERVER_USER", "SERVER_PASSWORD"]) {
      assert.ok(block.includes(`${name}: \${{ secrets.${name} }}`), `${name} check is missing`);
    }
    if (sshAware) assert.ok(block.includes("SSH_KEY: ${{ secrets.SSH_KEY }}"), "SSH_KEY check is missing");
    // The messages come from the catalog (cicd.precheck_*), so assert the annotations and the catalog keys
    assert.strictEqual((block.match(/::error title=/g) || []).length, 2, "missing-Secret and missing-Dockerfile errors");
    assert.match(block, /precheck_secret_title/);
    assert.match(block, /precheck_dockerfile_title/);
    assert.match(block, /working-directory: \$\{\{ env\.PROJECT_PATH \}\}/);
    assert.match(block, /exit 1/);
  });
}

// If SSH connection settings differ per type for the same SSH server deploy, only some types can deploy to key-auth-only servers (e.g. AWS EC2)
for (const [file, , sshAware] of CASES) {
  if (!sshAware) continue;
  test(`${file}: SSH auth method (password|key) and SSH port are configurable`, () => {
    const text = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
    assert.match(text, /^  SSH_AUTH_METHOD: "password"  # @wizard ask:password$/m);
    assert.match(text, /^  SSH_PORT: "__SSH_PORT__"  # @wizard ask:2022$/m);
    const actions = text.split("uses: appleboy/ssh-action@").slice(1).map((s) => s.slice(0, s.indexOf("script:")));
    assert.ok(actions.length > 0, "no SSH deploy step");
    for (const block of actions) {
      assert.ok(block.includes("key: ${{ secrets.SSH_KEY }}"), "SSH key auth is missing");
      assert.ok(block.includes("port: ${{ env.SSH_PORT }}"), "SSH port is hard-coded");
    }
    assert.match(text, /if \[ "\$\{SSH_AUTH_METHOD:-password\}" = "key" \]; then\n\s+\[ -n "\$SSH_KEY" \] \|\| MISSING="\$MISSING SSH_KEY"/,
      "the pre-check must verify the Secret matching the auth method");
  });
}
