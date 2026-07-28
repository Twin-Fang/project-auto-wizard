// doctor 명령 — 로컬 환경 진단(읽기 전용, 규칙 기반). gh CLI에 위임해 원격 상태를 점검한다.
// AI 진단은 포함하지 않는다(스펙 §4에서 검토 후 기각 — 복잡도 대비 이득 낮음).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const defaultExec = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });

export function runDoctor(cwd = process.cwd(), { exec = defaultExec } = {}) {
  const results = [];
  const add = (name, status, detail) => { results.push({ name, status, detail }); return results; };

  const installed = existsSync(join(cwd, "version.yml"));
  add("설치 여부", installed ? "OK" : "WARN",
    installed ? "version.yml 발견" : "이 디렉터리에 project-auto-wizard가 설치되어 있지 않습니다 (version.yml 없음)");

  const ghVersion = exec("gh", ["--version"]);
  if (ghVersion.error || ghVersion.status !== 0) {
    add("gh CLI", "WARN", "gh CLI를 찾을 수 없습니다 — 원격 점검을 건너뜁니다 (https://cli.github.com/ 설치 권장)");
    return results;
  }
  add("gh CLI", "OK", (ghVersion.stdout || "").split("\n")[0] || "설치됨");

  const auth = exec("gh", ["auth", "status"]);
  const authOk = !auth.error && auth.status === 0;
  add("gh 인증", authOk ? "OK" : "FAIL", authOk ? "인증됨" : "`gh auth login`이 필요합니다");
  if (!authOk) return results;

  const remote = exec("git", ["-C", cwd, "remote", "get-url", "origin"]);
  const url = remote.status === 0 ? (remote.stdout || "").trim() : "";
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
  if (!match) {
    add("GitHub 원격", "WARN", "origin 리모트에서 GitHub owner/repo를 확인하지 못했습니다");
    return results;
  }
  const [, owner, repo] = match;

  const perm = exec("gh", ["api", `repos/${owner}/${repo}/actions/permissions/workflow`, "--jq", ".default_workflow_permissions"]);
  const permValue = (perm.stdout || "").trim();
  add("Workflow permissions", perm.status === 0 && permValue === "write" ? "OK" : "WARN",
    perm.status === 0
      ? `현재값: ${permValue || "확인불가"} (Settings → Actions → General → Workflow permissions: Read and write 권장)`
      : "조회 실패 — repo 관리자 권한이 필요할 수 있습니다");

  const secrets = exec("gh", ["secret", "list", "--repo", `${owner}/${repo}`]);
  const hasPat = secrets.status === 0 && (secrets.stdout || "").split("\n").some((l) => l.startsWith("WORKFLOW_PAT"));
  add("WORKFLOW_PAT secret", hasPat ? "OK" : "WARN",
    hasPat
      ? "등록됨"
      : "미등록 — automerge 후 후속 워크플로우(tag/Release)가 트리거되지 않을 수 있습니다. Settings → Secrets → Actions에 등록 (scopes: repo, workflow)");

  const mergeSettings = exec("gh", ["api", `repos/${owner}/${repo}`, "--jq", ".allow_merge_commit"]);
  const automergeOk = mergeSettings.status === 0 && mergeSettings.stdout.trim() === "true";
  add("automerge 호환성(merge commit 허용)", automergeOk ? "OK" : "WARN",
    mergeSettings.status === 0
      ? (automergeOk
        ? "머지 커밋 허용됨"
        : "이 레포는 merge commit이 비활성화되어 있습니다 — automerge/RELEASE-PUBLISH가 머지 커밋 subject를 감지하는 방식과 충돌할 수 있습니다. Settings → General → Pull Requests → Allow merge commits 활성화 권장")
      : "조회 실패 — repo 관리자 권한이 필요할 수 있습니다");

  add("GitHub Models 활성화", "INFO",
    "자동 확인 불가 — Settings → Models에서 조직 정책으로 차단되지 않았는지 직접 확인하세요 (차단 시 규칙 기반 fallback으로 자동 전환됩니다)");

  return results;
}

export function printDoctorReport(results) {
  const icon = { OK: "✅", WARN: "⚠️ ", FAIL: "❌", INFO: "ℹ️ " };
  const lines = ["", "project-auto-wizard doctor — 환경 진단 결과", ""];
  for (const r of results) lines.push(`${icon[r.status] || "  "} [${r.status}] ${r.name} — ${r.detail}`);
  lines.push("");
  console.log(lines.join("\n"));
}
