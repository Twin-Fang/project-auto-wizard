// doctor 명령 — 로컬 환경 진단(읽기 전용, 규칙 기반). gh CLI에 위임해 원격 상태를 점검한다.
// AI 진단은 포함하지 않는다(스펙 §4에서 검토 후 기각 — 복잡도 대비 이득 낮음).
//
// 출력 설계(이슈 #29) — `flutter doctor` 패턴을 차용한다.
//   ① 항목 라벨에 purpose("무엇을 위한 설정인지")를 병기한다. `WORKFLOW_PAT`만 보고는 그게
//      자기 릴리스 흐름의 무엇을 담당하는지 알 수 없다 — flutter의
//      `Android toolchain - develop for Android devices`와 같은 이유다.
//   ② 도구가 "설치해도 된다/안 된다"를 판정하지 않는다. 발견한 사실(문제 N개)만 진술하고
//      그게 자신에게 문제인지는 사용자가 판단한다.
//   ③ 문제 항목만 `현상 → 영향 → 조치 → 문서` 4단으로 펼치고, 정상 항목은 한 줄로 압축한다.
//   ④ GitHub 설정 화면에 실제로 표시되는 문자열("Read and write permissions" 등)은 번역하지
//      않는다. 번역하면 설명은 읽히지만 정작 화면에서 그 항목을 찾지 못한다.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { A, paint, colorEnabled, visualWidth } from "../ui/ansi.js";

const defaultExec = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });

// 해결 가이드 링크 (스펙 2026-07-25-osscontest-scope-design.md §3.3② "각 실패 항목에 대한
// 해결 가이드 링크(README 앵커)"). README에 심은 영문 HTML 앵커를 가리킨다 — 한글 헤딩
// 자동 앵커는 URL 인코딩되어 터미널에서 알아볼 수 없게 깨진다.
const REPO_URL = "https://github.com/Twin-Fang/project-auto-wizard";
export const DOC = {
  postInstall: `${REPO_URL}#post-install`,
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
  if (perm.status !== 0) {
    add({
      name: "Workflow permissions", purpose: "버전 커밋 자동 push", status: "WARN",
      value: "설정을 조회하지 못했습니다.",
      impact: ["레포 관리자 권한이 없으면 이 설정은 조회되지 않습니다 — 값 자체는 정상일 수 있습니다."],
      actions: ["레포 관리자에게 Settings → Actions → General → Workflow permissions 값을 확인하세요"],
      doc: DOC.postInstall,
    });
  } else if (permValue === "write") {
    add({ name: "Workflow permissions", purpose: "버전 커밋 자동 push", status: "OK", value: "Read and write" });
  } else {
    add({
      name: "Workflow permissions", purpose: "버전 커밋 자동 push", status: "WARN",
      value: `현재 ${permValue || "확인불가"} 입니다.`,
      impact: ["워크플로가 버전 올림 커밋을 push하지 못해 릴리스가 중단됩니다."],
      actions: [
        "레포 Settings → Actions → General → Workflow permissions",
        '"Read and write permissions" 선택 후 Save',
      ],
      doc: DOC.postInstall,
    });
  }

  const secrets = exec("gh", ["secret", "list", "--repo", `${owner}/${repo}`]);
  const hasPat = secrets.status === 0 && (secrets.stdout || "").split("\n").some((l) => l.startsWith("WORKFLOW_PAT"));
  add(hasPat
    ? { name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: "자동 태그·Release 발행", status: "OK", value: "등록됨" }
    : {
      name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: "자동 태그·Release 발행", status: "WARN",
      value: "secret이 등록되어 있지 않습니다.",
      impact: [
        "PR 자동 머지 뒤 태그·Release 워크플로가 이어지지 않습니다.",
        "(GitHub 정책상 기본 토큰으로 만든 커밋은 다음 워크플로를 깨우지 못합니다)",
      ],
      actions: [
        "개인 액세스 토큰 발급 (scopes: repo, workflow)",
        "레포 Settings → Secrets and variables → Actions",
        "New repository secret · 이름은 WORKFLOW_PAT",
      ],
      doc: DOC.postInstall,
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
    name: "GitHub Models 활성화", label: "GitHub Models", purpose: "AI 릴리스 노트 생성", status: "INFO",
    note: [
      "조직 정책으로 차단됐는지는 자동으로 확인할 수 없습니다 (Settings → Models).",
      "차단돼 있어도 규칙 기반 요약으로 자동 전환되므로 그대로 두셔도 됩니다.",
    ],
  });

  return results;
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
