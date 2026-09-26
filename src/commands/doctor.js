// doctor 명령 — 로컬 환경 진단(읽기 전용, 규칙 기반). gh CLI에 위임해 원격 상태를 점검한다.
// AI 진단은 포함하지 않는다(스펙 §4에서 검토 후 기각 — 복잡도 대비 이득 낮음).
//
// 출력 설계 — `flutter doctor` 패턴을 차용한다.
//   ① 항목 라벨에 purpose("무엇을 위한 설정인지")를 병기한다. `WORKFLOW_PAT`만 보고는 그게
//      자기 릴리스 흐름의 무엇을 담당하는지 알 수 없다 — flutter의
//      `Android toolchain - develop for Android devices`와 같은 이유다.
//   ② 도구가 "설치해도 된다/안 된다"를 판정하지 않는다. 발견한 사실(문제 N개)만 진술하고
//      그게 자신에게 문제인지는 사용자가 판단한다.
//   ③ 문제 항목만 `현상 → 영향 → 조치 → 문서` 4단으로 펼치고, 정상 항목은 한 줄로 압축한다.
//   ④ GitHub 설정 화면에 실제로 표시되는 문자열("Read and write permissions" 등)은 번역하지
//      않는다. 번역하면 설명은 읽히지만 정작 화면에서 그 항목을 찾지 못한다.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { A, paint, colorEnabled, visualWidth } from "../ui/ansi.js";
import { PATHS } from "../core/paths.js";
import { parseExisting } from "../core/version-yml.js";
import { STORE_PLATFORMS, STORE_APP_FILES, parseStoreList, storeAppFilesFor } from "../core/flutter-options.js";
import { inferInstalledStores } from "../core/installed-stores.js";

const defaultExec = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });

// 해결 가이드 링크 (스펙 2026-07-25-osscontest-scope-design.md §3.3② "각 실패 항목에 대한
// 해결 가이드 링크(README 앵커)"). README에 심은 영문 HTML 앵커를 가리킨다 — 한글 헤딩
// 자동 앵커는 URL 인코딩되어 터미널에서 알아볼 수 없게 깨진다.
const REPO_URL = "https://github.com/Twin-Fang/project-auto-wizard";
export const DOC = {
  postInstall: `${REPO_URL}#post-install`,
  flutterStore: `${REPO_URL}#flutter-store`,
};

export function runDoctor(cwd = process.cwd(), { exec = defaultExec } = {}) {
  const results = [];
  // name은 항목 식별자(테스트·프로그램 참조용), label은 화면 표기용. label 생략 시 name을 쓴다.
  const add = (item) => { results.push({ actions: [], ...item }); return results; };

  const installed = existsSync(join(cwd, "version.yml"));
  // 미설치는 문제가 아니다 — doctor는 설치 "전에" 돌려보는 것이 정상 사용 경로다.
  add(installed
    ? { name: "설치 여부", label: "설치 상태", purpose: "이 폴더의 마법사 설치 여부", status: "OK", value: "version.yml 있음" }
    : {
      name: "설치 여부", label: "설치 상태", purpose: "이 폴더의 마법사 설치 여부", status: "INFO",
      note: ["이 폴더엔 아직 설치되지 않았습니다 — 지금 설치하면 됩니다."],
    });

  // Flutter 스토어 배포 파일 점검 — 로컬 파일만 보므로 gh 조회 결과와 무관하게 수행한다.
  if (installed) for (const item of flutterStoreChecks(cwd)) add(item);

  const ghVersion = exec("gh", ["--version"]);
  if (ghVersion.error || ghVersion.status !== 0) {
    add({
      name: "gh CLI", purpose: "레포 설정 조회용", status: "WARN",
      value: "gh CLI를 찾을 수 없습니다.",
      impact: ["레포 권한·secret 설정을 조회할 수 없어 아래 원격 점검을 모두 건너뜁니다."],
      actions: ["https://cli.github.com/ 에서 gh CLI를 설치한 뒤 다시 실행하세요"],
    });
    return results;
  }
  add({
    name: "gh CLI", purpose: "레포 설정 조회용", status: "OK",
    value: (ghVersion.stdout || "").split("\n")[0] || "설치됨",
  });

  const auth = exec("gh", ["auth", "status"]);
  const authOk = !auth.error && auth.status === 0;
  if (!authOk) {
    add({
      name: "gh 인증", label: "GitHub 로그인", purpose: "레포 설정 조회 권한", status: "FAIL",
      value: "로그인되어 있지 않습니다.",
      impact: ["레포 설정을 읽을 수 없어 아래 원격 점검을 모두 건너뜁니다."],
      actions: ["터미널에서 `gh auth login` 실행"],
    });
    return results;
  }
  add({ name: "gh 인증", label: "GitHub 로그인", purpose: "레포 설정 조회 권한", status: "OK", value: "인증됨" });

  const remote = exec("git", ["-C", cwd, "remote", "get-url", "origin"]);
  const url = remote.status === 0 ? (remote.stdout || "").trim() : "";
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
  if (!match) {
    add({
      name: "GitHub 원격", purpose: "점검 대상 레포 식별", status: "WARN",
      value: "origin 리모트에서 GitHub owner/repo를 찾지 못했습니다.",
      impact: ["어느 레포를 점검해야 할지 알 수 없어 아래 원격 점검을 모두 건너뜁니다."],
      actions: ["`git remote -v`로 origin이 GitHub 주소를 가리키는지 확인하세요"],
    });
    return results;
  }
  const [, owner, repo] = match;

  const perm = exec("gh", ["api", `repos/${owner}/${repo}/actions/permissions/workflow`, "--jq", ".default_workflow_permissions"]);
  const permValue = (perm.stdout || "").trim();
  // 이 값은 "워크플로우가 permissions를 생략했을 때 적용되는 기본값"이지 상한이 아니다.
  // 마법사가 설치하는 워크플로우는 전부 자체 permissions를 선언하므로(회귀 가드:
  // tests/node/payload-workflow-permissions.test.js) read여도 정상 동작한다 — 이 레포 자체가
  // read인데 VERSION-CONTROL이 버전 커밋 push에 성공하는 것이 그 증거다.
  const PERM_PURPOSE = "직접 추가한 워크플로우의 기본 권한";
  if (perm.status !== 0) {
    // 조회 실패는 오진이 아니라 실제로 정보를 얻지 못한 상태다 — 관리자 확인이라는 조치가 있다.
    add({
      name: "Workflow permissions", purpose: PERM_PURPOSE, status: "WARN",
      value: "설정을 조회하지 못했습니다.",
      impact: ["레포 관리자 권한이 없으면 이 설정은 조회되지 않습니다 — 값 자체는 정상일 수 있습니다."],
      actions: ["레포 관리자에게 Settings → Actions → General → Workflow permissions 값을 확인하세요"],
      doc: DOC.postInstall,
    });
  } else if (permValue === "write") {
    add({ name: "Workflow permissions", purpose: PERM_PURPOSE, status: "OK", value: "Read and write" });
  } else {
    // 조치가 필요 없으므로 WARN이 아니라 INFO다. 경고로 띄우면 없는 장애를 알리고
    // 불필요한 권한 상향을 유도해 최소 권한 원칙에 역행한다.
    add({
      name: "Workflow permissions", purpose: PERM_PURPOSE, status: "INFO",
      note: [
        `현재 ${permValue || "확인불가"} 입니다 — 마법사가 설치한 워크플로우는 각자 권한을 선언하므로 그대로 동작합니다.`,
        "직접 추가한 워크플로우에서 permissions를 생략했다면 이 기본값을 따르므로, 그때만 Read and write로 올리세요.",
      ],
    });
  }

  const secrets = exec("gh", ["secret", "list", "--repo", `${owner}/${repo}`]);
  const hasPat = secrets.status === 0 && (secrets.stdout || "").split("\n").some((l) => l.startsWith("WORKFLOW_PAT"));
  add(hasPat
    ? { name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: "자동 태그·Release 발행", status: "OK", value: "등록됨" }
    : {
      // 조치가 필요 없으므로 WARN이 아니라 INFO다 — 위 Workflow permissions 항목과 동일 이유:
      // 폴백(wait-for-merge-and-trigger-release / Trigger NPM-PUBLISH)이 GITHUB_TOKEN만으로
      // 파이프라인을 끝까지 이어가므로, 없는 장애를 경고로 띄우지 않는다.
      name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: "자동 태그·Release 발행", status: "INFO",
      note: [
        "secret이 없어도 폴백이 자동으로 이어받아 태그·Release까지 진행됩니다 — 실제 병합 후 최대 ~20초 정도 더 걸릴 뿐입니다.",
        "속도를 더 원한다면 PAT을 등록할 수 있습니다 — 반드시 개인 계정이 아닌 조직 bot/machine 계정으로 발급하세요 (scopes: repo, workflow).",
        "등록: 레포 Settings → Secrets and variables → Actions → New repository secret · 이름은 WORKFLOW_PAT",
      ],
    });

  const mergeSettings = exec("gh", ["api", `repos/${owner}/${repo}`, "--jq", ".allow_merge_commit"]);
  const automergeOk = mergeSettings.status === 0 && mergeSettings.stdout.trim() === "true";
  if (mergeSettings.status !== 0) {
    add({
      name: "automerge 호환성(merge commit 허용)", label: "merge commit 허용", purpose: "릴리스 PR 자동 머지 조건", status: "WARN",
      value: "설정을 조회하지 못했습니다.",
      impact: ["레포 관리자 권한이 없으면 이 설정은 조회되지 않습니다 — 값 자체는 정상일 수 있습니다."],
      actions: ["레포 관리자에게 Settings → General → Pull Requests 설정을 확인하세요"],
      doc: DOC.postInstall,
    });
  } else if (automergeOk) {
    add({ name: "automerge 호환성(merge commit 허용)", label: "merge commit 허용", purpose: "릴리스 PR 자동 머지 조건", status: "OK", value: "허용됨" });
  } else {
    add({
      name: "automerge 호환성(merge commit 허용)", label: "merge commit 허용", purpose: "릴리스 PR 자동 머지 조건", status: "WARN",
      value: "이 레포는 merge commit이 꺼져 있습니다.",
      impact: ["RELEASE-PUBLISH가 머지 커밋 제목으로 릴리스를 감지하므로 자동 머지 흐름이 어긋날 수 있습니다."],
      actions: [
        "레포 Settings → General → Pull Requests",
        "Allow merge commits 체크",
      ],
      doc: DOC.postInstall,
    });
  }

  add({
    name: "Copilot AI 요약", label: "Copilot AI 요약", purpose: "AI 릴리스 노트 생성(선택)", status: "INFO",
    note: [
      "기본은 꺼져 있습니다 (version.yml의 copilot_ai: false).",
      "켜면 GitHub Copilot AI Credits가 소비됩니다 — 조직은 'Allow use of Copilot CLI billed to the organization' 정책이 필요합니다.",
      "꺼져 있거나 사용할 수 없으면 규칙 기반 요약으로 자동 전환되므로 그대로 두셔도 됩니다.",
    ],
  });

  return results;
}

const PLATFORM_ROW_NAME = { android: "Flutter Android 배포 파일", ios: "Flutter iOS 배포 파일" };
const PLACEHOLDER_RE = /__[A-Z][A-Z0-9_]*__/g; // 감지 규칙은 ExportOptions.plist 템플릿·IOS-TESTFLIGHT 검증과 동일
const EXPORT_OPTIONS_REL = STORE_APP_FILES.ios.find((rel) => rel.endsWith("ExportOptions.plist"));

// Flutter 스토어 배포 진단 — 선택한 플랫폼의 필수 파일과 ExportOptions.plist 플레이스홀더.
// 스토어 시크릿 등록 여부는 이번 범위 밖이다. 반환: doctor 결과 행 배열.
function flutterStoreChecks(cwd) {
  const existing = parseExisting(readFileSync(join(cwd, PATHS.versionFile), "utf8"));
  if (!existing.types.includes("flutter")) return [];
  const saved = existing.options.flutterStore == null ? null : parseStoreList(existing.options.flutterStore);
  // 저장값 없는 기존 설치는 설치된 스토어 워크플로우로 추론한다 (interactive와 같은 규칙).
  const stores = saved ?? inferInstalledStores(join(cwd, PATHS.workflowsDir));
  const flutterRoot = existing.paths.get("flutter") || ".";
  const rows = [];

  for (const platform of STORE_PLATFORMS.filter((p) => stores.includes(p))) {
    const files = storeAppFilesFor([platform]).map((rel) => posix.join(flutterRoot, rel));
    const missing = files.filter((file) => !existsSync(join(cwd, file)));
    const head = { name: PLATFORM_ROW_NAME[platform], purpose: "fastlane 스토어 업로드에 필요한 파일" };
    rows.push(missing.length
      ? {
        ...head, status: "WARN", value: `없는 파일: ${missing.join(", ")}`,
        impact: ["이 파일이 없으면 스토어 배포 워크플로우가 fastlane 단계에서 실패합니다."],
        actions: ["마법사를 다시 실행하면 없는 파일만 새로 만들어 줍니다 (이미 있는 파일은 덮어쓰지 않음)"],
        doc: DOC.flutterStore,
      }
      : { ...head, status: "OK", value: `${files.length}개 있음` });
  }

  const plistPath = posix.join(flutterRoot, EXPORT_OPTIONS_REL);
  if (stores.includes("ios") && existsSync(join(cwd, plistPath))) {
    const head = { name: "ExportOptions.plist", purpose: "iOS 서명·내보내기 설정" };
    const left = [...new Set(readFileSync(join(cwd, plistPath), "utf8").match(PLACEHOLDER_RE) ?? [])];
    rows.push(left.length
      ? {
        ...head, status: "WARN", value: `채워지지 않은 값: ${left.join(", ")}`,
        impact: ["채우지 않으면 IOS-TESTFLIGHT 워크플로우가 ExportOptions.plist 검증 단계에서 중단됩니다."],
        actions: [`${plistPath} 의 플레이스홀더를 실제 값(Team ID · 번들 ID · 프로비저닝 프로파일 이름)으로 바꾸세요`],
        doc: DOC.flutterStore,
      }
      : { ...head, status: "OK", value: "플레이스홀더 없음" });
  }
  return rows;
}

const asLines = (v) => (Array.isArray(v) ? v : v ? [String(v)] : []);
const headOf = (r) => `${r.label || r.name}${r.purpose ? ` — ${r.purpose}` : ""}`;

export function printDoctorReport(results, { out = (s) => console.log(s), color = colorEnabled() } = {}) {
  const p = (s, c) => paint(s, c, color);
  const oks = results.filter((r) => r.status === "OK");
  const problems = results.filter((r) => r.status === "WARN" || r.status === "FAIL");
  const infos = results.filter((r) => r.status === "INFO");

  const lines = ["", `${p("◆", A.cyan)}  ${p("환경 진단", A.bold)} ${p("— project-auto-wizard doctor", A.dim)}`, ""];

  // 정상 — 한 줄씩. 값은 라벨 폭에 맞춰 우측으로 정렬한다(CJK 2칸 계산은 visualWidth에 위임).
  if (oks.length) {
    const width = Math.max(...oks.map((r) => visualWidth(headOf(r))));
    for (const r of oks) {
      const head = headOf(r);
      const pad = " ".repeat(width - visualWidth(head) + 4);
      lines.push(`  ${p("[✓]", A.green)} ${head}${r.value ? `${pad}${p(r.value, A.dim)}` : ""}`);
    }
    lines.push("");
  }

  // 문제 — 현상 → 영향 → 조치 → 문서 순으로 펼친다.
  for (const r of problems) {
    const fail = r.status === "FAIL";
    lines.push(`  ${p(fail ? "[✗]" : "[!]", fail ? A.red : A.yellow)} ${p(headOf(r), A.bold)}`);
    if (r.value) lines.push(`      ${p(fail ? "✗" : "✗", fail ? A.red : A.yellow)} ${r.value}`);
    for (const l of asLines(r.impact)) lines.push(`        ${p(l, A.dim)}`);
    for (const a of asLines(r.actions)) lines.push(`      ${p("→", A.cyan)} ${a}`);
    if (r.doc) lines.push(`      ${p("→", A.cyan)} 자세히: ${p(r.doc, A.dim)}`);
    lines.push("");
  }

  // 참고 — 조치가 필요 없는 안내.
  for (const r of infos) {
    lines.push(`  ${p("[i]", A.gray)} ${headOf(r)}`);
    for (const l of asLines(r.note)) lines.push(`      ${p(l, A.dim)}`);
  }
  if (infos.length) lines.push("");

  lines.push(summaryLine(problems, p), "");
  out(lines.join("\n"));
}

// 요약 — "설치해도 된다"는 판정 대신 발견한 사실만 말한다(flutter doctor의 마지막 줄과 같은 태도).
function summaryLine(problems, p) {
  if (!problems.length) return `  ${p("✓", A.green)} 문제를 찾지 못했습니다.`;
  const n = problems.length;
  if (problems.some((r) => r.status === "FAIL")) {
    return `  ${p("✗", A.red)} ${n}개 항목에서 문제를 찾았습니다 — 일부 점검은 실행하지 못했습니다.`;
  }
  return [
    `  ${p("!", A.yellow)} ${n}개 항목에서 문제를 찾았습니다.`,
    `    설치 자체는 지금 진행할 수 있고, 위 ${n}개는 나중에 설정해도 됩니다.`,
  ].join("\n");
}
