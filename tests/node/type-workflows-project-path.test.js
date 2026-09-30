// tests/node/type-workflows-project-path.test.js
// 모노레포(--paths)에서 Spring·React·Next·Python·Go 워크플로우가 레포 루트가 아니라 타입별 하위 폴더에서
// 빌드하는지 고정한다. PROJECT_PATH는 설치 때 auto:project-path 마커로 치환되고, 빌드 명령·Docker context가
// 그 값을 따라야 한다.
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

// `- name: <name>` 스텝 블록들 (다음 스텝·job 전까지)
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

test("대상 워크플로우 목록이 비어 있지 않다", () => {
  assert.ok(FILES.length >= 15, `got ${FILES.length}`);
});

for (const file of FILES) {
  const text = read(file);

  test(`${file}: PROJECT_PATH가 auto:project-path 마커로 선언된다`, () => {
    assert.match(text, /^ {2}PROJECT_PATH: "\."\s+# @wizard auto:project-path$/m);
  });

  test(`${file}: Docker context가 레포 루트('.')로 고정돼 있지 않다`, () => {
    assert.doesNotMatch(text, /^\s*context: \.\s*$/m);
    for (const line of text.split("\n").filter((l) => /^\s*context: /.test(l))) {
      assert.match(line, /context: \$\{\{ env\.PROJECT_PATH \}\}/, line);
    }
  });
}

test("CI 빌드 job은 PROJECT_PATH를 작업 디렉터리로 쓴다", () => {
  for (const file of ["go/PROJECT-GO-CI.yaml", "next/PROJECT-NEXT-CI.yaml", "python/PROJECT-PYTHON-CI.yaml", "react/PROJECT-REACT-CI.yaml", "spring/PROJECT-SPRING-CI.yml"]) {
    assert.ok(read(file).includes(`    defaults:\n      run:\n        ${WD}\n`), `${file}: job defaults 누락`);
  }
});

test("React·Next CICD build job은 PROJECT_PATH를 작업 디렉터리로 쓴다", () => {
  for (const file of ["react/PROJECT-REACT-CICD.yaml", "next/PROJECT-NEXT-CICD.yaml"]) {
    assert.ok(read(file).includes(`    defaults:\n      run:\n        ${WD}\n`), `${file}: job defaults 누락`);
  }
});

test("Spring 배포 워크플로우의 Gradle 스텝은 PROJECT_PATH에서 실행된다", () => {
  const cases = [
    ["spring/server-deploy/PROJECT-SPRING-SIMPLE-CICD.yaml", ["Make Gradle wrapper executable", "Build with Gradle"]],
    ["spring/server-deploy/PROJECT-SPRING-NONSTOP-NGINX-CICD.yaml", ["Make Gradle wrapper executable", "Build with Gradle"]],
    ["spring/server-deploy/PROJECT-SPRING-NONSTOP-TRAEFIK-CICD.yaml", ["Make Gradle wrapper executable", "Build with Gradle"]],
    ["spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml", ["Set Gradle permissions", "Gradle build"]],
  ];
  for (const [file, names] of cases) {
    const text = read(file);
    for (const name of names) {
      const blocks = stepBlocks(text, name);
      assert.ok(blocks.length > 0, `${file}: '${name}' 스텝 없음`);
      for (const b of blocks) assert.ok(b.includes(WD), `${file}: '${name}' working-directory 누락`);
    }
  }
});

test("Go·Python 배포/프리뷰의 .env는 PROJECT_PATH 안에 만든다 (Docker context에 포함돼야 한다)", () => {
  const cases = [
    ["go/PROJECT-GO-SIMPLE-CICD.yaml", "Create .env file"],
    ["python/PROJECT-PYTHON-SIMPLE-CICD.yaml", "Create .env file"],
    ["go/PROJECT-GO-PR-PREVIEW.yaml", '"[Required] Create .env file"'],
    ["python/PROJECT-PYTHON-PR-PREVIEW.yaml", '"[Required] Create .env file"'],
  ];
  for (const [file, name] of cases) {
    const blocks = stepBlocks(read(file), name);
    assert.ok(blocks.length > 0, `${file}: '${name}' 스텝 없음`);
    for (const b of blocks) assert.ok(b.includes(WD), `${file}: '${name}' working-directory 누락`);
  }
});

test("모노레포에서 서버 배포·프리뷰의 이미지·컨테이너 이름에 타입 접미사가 붙는다 (타입끼리 덮어쓰지 않는다)", () => {
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
      assert.ok(!text.includes("${{ env.PROJECT_NAME }}"), `${file}: 접미사 없는 PROJECT_NAME 참조가 남아 있습니다`);
      assert.ok(text.includes(expr), `${file}: 타입 접미사 표현식 누락`);
    }
  }
});
