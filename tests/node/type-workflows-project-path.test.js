// tests/node/type-workflows-project-path.test.js
// In a monorepo (--paths), pins that the Spring, React, Next, Python and Go workflows build in the per-type subfolder
// rather than the repo root. PROJECT_PATH is substituted via the auto:project-path marker at install, and the build commands and Docker context
// must follow that value.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOWS_DIR = join(REPO_ROOT, "payload", "workflows");
const TYPES = ["spring", "react", "next", "python", "go"];
const WD = "working-directory: ${{ env.PROJECT_PATH }}";

const FILES = TYPES.flatMap((type) =>
  readdirSync(join(WORKFLOWS_DIR, type), { recursive: true })
    .map(String)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => `${type}/${f}`),
);

const read = (file) => readFileSync(join(WORKFLOWS_DIR, file), "utf8");

// `- name: <name>` step blocks (up to the next step or job)
function stepBlocks(text, name) {
  const lines = text.split("\n");
  const blocks = [];
  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)- name: (.*)$/);
    if (!m || m[2].trim() !== name) return;
    const indent = m[1].length;
    const body = [line];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() !== "" && l.match(/^ */)[0].length <= indent) break;
      body.push(l);
    }
    blocks.push(body.join("\n"));
  });
  return blocks;
}

test("the target workflow list is not empty", () => {
  assert.ok(FILES.length >= 15, `got ${FILES.length}`);
});

for (const file of FILES) {
  const text = read(file);

  test(`${file}: PROJECT_PATH is declared with the auto:project-path marker`, () => {
    assert.match(text, /^ {2}PROJECT_PATH: "\."\s+# @wizard auto:project-path$/m);
  });

  test(`${file}: Docker context is not pinned to the repo root ('.')`, () => {
    assert.doesNotMatch(text, /^\s*context: \.\s*$/m);
    for (const line of text.split("\n").filter((l) => /^\s*context: /.test(l))) {
      assert.match(line, /context: \$\{\{ env\.PROJECT_PATH \}\}/, line);
    }
  });
}

test("the CI build job uses PROJECT_PATH as its working directory", () => {
  for (const file of ["go/PROJECT-GO-CI.yaml", "next/PROJECT-NEXT-CI.yaml", "python/PROJECT-PYTHON-CI.yaml", "react/PROJECT-REACT-CI.yaml", "spring/PROJECT-SPRING-CI.yml"]) {
    assert.ok(read(file).includes(`    defaults:\n      run:\n        ${WD}\n`), `${file}: job defaults missing`);
  }
});

test("the React/Next CICD build job uses PROJECT_PATH as its working directory", () => {
  for (const file of ["react/PROJECT-REACT-CICD.yaml", "next/PROJECT-NEXT-CICD.yaml"]) {
    assert.ok(read(file).includes(`    defaults:\n      run:\n        ${WD}\n`), `${file}: job defaults missing`);
  }
});

test("Gradle steps of the Spring deploy workflows run in PROJECT_PATH", () => {
  const cases = [
    ["spring/server-deploy/PROJECT-SPRING-SIMPLE-CICD.yaml", ["Gradle Wrapper 실행권한 부여", "Build with Gradle"]],
    ["spring/server-deploy/PROJECT-SPRING-NONSTOP-NGINX-CICD.yaml", ["Gradle Wrapper 실행권한 부여", "Build with Gradle"]],
    ["spring/server-deploy/PROJECT-SPRING-NONSTOP-TRAEFIK-CICD.yaml", ["Gradle Wrapper 실행권한 부여", "Build with Gradle"]],
    ["spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml", ["Gradle 권한 설정", "Gradle 빌드"]],
  ];
  for (const [file, names] of cases) {
    const text = read(file);
    for (const name of names) {
      const blocks = stepBlocks(text, name);
      assert.ok(blocks.length > 0, `${file}: step '${name}' not found`);
      for (const b of blocks) assert.ok(b.includes(WD), `${file}: '${name}' working-directory missing`);
    }
  }
});

test("the .env of Go/Python deploy/preview is created inside PROJECT_PATH (it must be in the Docker context)", () => {
  const cases = [
    ["go/PROJECT-GO-SIMPLE-CICD.yaml", ".env 파일 생성"],
    ["python/PROJECT-PYTHON-SIMPLE-CICD.yaml", ".env 파일 생성"],
    ["go/PROJECT-GO-PR-PREVIEW.yaml", '"[필수] .env 파일 생성"'],
    ["python/PROJECT-PYTHON-PR-PREVIEW.yaml", '"[필수] .env 파일 생성"'],
  ];
  for (const [file, name] of cases) {
    const blocks = stepBlocks(read(file), name);
    assert.ok(blocks.length > 0, `${file}: step '${name}' not found`);
    for (const b of blocks) assert.ok(b.includes(WD), `${file}: '${name}' working-directory missing`);
  }
});

test("in a monorepo, image and container names of server deploy/preview get a type suffix (types do not overwrite each other)", () => {
  const cases = {
    go: ["go/PROJECT-GO-PR-PREVIEW.yaml", "go/PROJECT-GO-SIMPLE-CICD.yaml"],
    python: ["python/PROJECT-PYTHON-PR-PREVIEW.yaml", "python/PROJECT-PYTHON-SIMPLE-CICD.yaml"],
    spring: [
      "spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml",
      "spring/server-deploy/PROJECT-SPRING-SIMPLE-CICD.yaml",
      "spring/server-deploy/PROJECT-SPRING-NONSTOP-NGINX-CICD.yaml",
      "spring/server-deploy/PROJECT-SPRING-NONSTOP-TRAEFIK-CICD.yaml",
    ],
  };
  for (const [type, files] of Object.entries(cases)) {
    const expr = `\${{ env.PROJECT_PATH != '.' && format('{0}-${type}', env.PROJECT_NAME) || env.PROJECT_NAME }}`;
    for (const file of files) {
      const text = read(file);
      assert.ok(!text.includes("${{ env.PROJECT_NAME }}"), `${file}: a PROJECT_NAME reference without a suffix remains`);
      assert.ok(text.includes(expr), `${file}: type suffix expression missing`);
    }
  }
});
