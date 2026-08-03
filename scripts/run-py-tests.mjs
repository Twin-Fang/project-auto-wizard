// 파이썬 테스트 크로스플랫폼 런처 (issue #15).
//
// `python3`는 Windows에 존재하지 않는다 — 있어도 Microsoft Store 스텁이라
// 실행 시 exit 49로 죽는다. 반대로 일부 Linux 배포판에는 `python`이 없다.
// 두 이름을 순서대로 시도해 실제로 동작하는 인터프리터를 고른다.
//
// Node는 npm 스크립트 실행 시점에 반드시 존재하므로 추가 의존성이 없다
// (zero-dependency 원칙 유지). package.json의 files 화이트리스트
// (bin/·src/·payload/)에 없으므로 npm 패키지에는 실리지 않는다.
import { spawnSync } from "node:child_process";

const CANDIDATES = ["python3", "python"];
const ARGS = ["-m", "unittest", "discover", "-s", "tests/py", "-v"];

// 해당 이름이 "실제로 쓸 수 있는" 파이썬인지 확인한다.
// Windows Store 스텁은 `--version`에도 0을 반환하지 않으므로 이걸로 걸러진다.
function isUsable(cmd) {
  const probe = spawnSync(cmd, ["-c", "import sys; print(sys.version_info[0])"], {
    encoding: "utf8",
    // 스텁이 stdin을 기다리며 매달리지 않도록 즉시 EOF를 준다
    input: "",
  });
  return probe.status === 0 && probe.stdout.trim() === "3";
}

const python = CANDIDATES.find(isUsable);

if (!python) {
  console.error(
    `파이썬 3을 찾을 수 없습니다 (시도: ${CANDIDATES.join(", ")}).\n` +
    "Python 3을 설치하고 PATH에 등록한 뒤 다시 실행하세요."
  );
  process.exit(1);
}

// 한글 출력이 Windows 기본 코드페이지(cp949)에서 깨지지 않도록 강제한다.
const result = spawnSync(python, ARGS, {
  stdio: "inherit",
  env: { ...process.env, PYTHONIOENCODING: "utf-8" },
});

process.exit(result.status ?? 1);
