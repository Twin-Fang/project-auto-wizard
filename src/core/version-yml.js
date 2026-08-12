import { DEFAULT_DEPLOY_STYLE } from "./deploy-style.js";
import { escapeYamlDoubleQuoted } from "./wizard-env.js";

// version.yml 파싱·생성 (.sh create_version_yml 등가, 전체 재생성 전략 D4).
// ⚠️ YAML 재직렬화 금지 — 주석이 데이터.
// 레이아웃 단일 진실 = payload/version.yml.template (호출부가 templateText로 주입).

// version.yml.template이 아는 최상위 키 — 이 밖의 최상위 키는 사용자가 직접 추가한 것으로 간주한다.
// "project_type"(단수)은 더 이상 렌더하지 않는 레거시 키지만 이 집합에는 남겨둔다 (issue #62):
// 빼면 기존 파일의 단수 줄이 "사용자가 추가한 필드"로 오인돼 재생성 때 되살아난다. 아는 키로
// 둬야 재통합 시 흡수되어 사라진다.
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "version", "version_code", "project_types", "project_type", "project_paths", "metadata", "deploy",
]);

// 최상위 레벨의 알려지지 않은 필드(사용자가 직접 추가한 임의 필드)를 원본 그대로 보존한다
// (issue #20 M8). 각 알려지지 않은 최상위 키부터 다음 최상위 키 직전까지를 통째로 한 블록으로
// 캡처한다(중첩 구조가 있어도 유효한 YAML로 남기기 위함). metadata/project_paths/deploy처럼
// 이 모듈이 이미 아는 블록 "내부"의 알려지지 않은 하위 키는 대상이 아니다(범위 밖 — issue #20 결정).
export function parseExtraTopLevel(content) {
  const blocks = [];
  let current = null;
  for (const line of String(content || "").split("\n")) {
    // 최상위 키는 하이픈을 포함할 수 있다(YAML 관례) — issue #20 M8 리뷰에서 지적된 놓침 방지.
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):/);
    if (m) {
      if (current) blocks.push(current.join("\n"));
      current = KNOWN_TOP_LEVEL_KEYS.has(m[1]) ? null : [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current.join("\n"));
  return blocks;
}

// metadata.template.options 상태머신 파싱 (.sh read_template_options L2361~2416 등가).
// 반환: { nexus: bool|null, secretBackup: bool|null } — null=미기재.
// 구 synology·coderabbit 키 등 다른 키는 어느 분기에도 안 걸려 자연히 무시된다(파싱 에러 없음).
// (options-ask.js가 이 함수를 import한다 — 순환 방지 위해 여기(version-yml)에 정의.)
export function parseTemplateOptions(content) {
  const out = { nexus: null, secretBackup: null, semverAuto: null, deployStyle: null };
  // 값 정규화: 따옴표 제거 + 트림 (.sh tr -d '"' | tr -d "'" | xargs 등가)
  // 인라인 주석(` # ...`)을 먼저 떼고 따옴표·공백을 정리한다. 문자열 값을 받는 키(deploy_style)는
  // 주석을 안 떼면 "simple # simple | nginx ..." 가 통째로 값이 된다.
  const strip = (s) => String(s).replace(/\s+#.*$/, "").replace(/["']/g, "").trim();
  let inTemplate = false;
  let inOptions = false;
  for (const line of String(content || "").split("\n")) {
    if (/^\s*template:/.test(line)) { inTemplate = true; continue; }
    if (inTemplate && /^\s+options:/.test(line)) { inOptions = true; continue; }
    if (inTemplate && inOptions) {
      let m = line.match(/^\s+nexus:\s*(.+)/);
      if (m) {
        const v = strip(m[1]);
        if (v === "true") out.nexus = true;
        if (v === "false") out.nexus = false;
        continue;
      }
      m = line.match(/^\s+secret_backup:\s*(.+)/);
      if (m) {
        const v = strip(m[1]);
        if (v === "true") out.secretBackup = true;
        if (v === "false") out.secretBackup = false;
        continue;
      }
      m = line.match(/^\s+deploy_style:\s*(.+)/);
      if (m) { const v = strip(m[1]); if (v) out.deployStyle = v; continue; }
      m = line.match(/^\s+semver_auto:\s*(.+)/);
      if (m) {
        const v = strip(m[1]);
        if (v === "true") out.semverAuto = true;
        if (v === "false") out.semverAuto = false;
        continue;
      }
      // 들여쓰기 0~4칸의 다른 키 → options 섹션 종료 (.sh L2404~2408)
      if (/^\s{0,4}[a-z_]+:/.test(line)) { inOptions = false; inTemplate = false; }
    }
    // 최상위 키 → template 섹션 종료 (.sh L2411~2415)
    if (inTemplate && /^[a-z_]+:/.test(line)) { inTemplate = false; inOptions = false; }
  }
  return out;
}

// 기존 version.yml에서 값 추출 (.sh grep/sed 등가, 주석 라인 오탐 방지).
export function parseExisting(content) {
  const text = String(content || "");
  const line = (re) => {
    for (const l of text.split("\n")) {
      if (l.startsWith("#")) continue; // 주석 제외
      const m = l.match(re);
      if (m) return m[1];
    }
    return null;
  };
  // version: "x.y.z" (숫자.숫자.숫자 형태만)
  const version = line(/^version:\s*["']?([0-9][0-9.]*)["']?/) || "";
  // version_code: N (양의 정수, 아니면 1)
  let versionCode = parseInt(line(/^version_code:\s*([0-9]+)/) || "", 10);
  if (!Number.isInteger(versionCode) || versionCode <= 0) versionCode = 1;
  // project_types: ["a","b"]
  const typesRaw = line(/^project_types:\s*(\[[^\]]*\])/);
  let types = [];
  if (typesRaw) types = [...typesRaw.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  // project_paths 블록: "  type: "path""
  const paths = new Map();
  let inPaths = false;
  for (const l of text.split("\n")) {
    if (/^project_paths:/.test(l)) { inPaths = true; continue; }
    if (inPaths) {
      const m = l.match(/^\s+([a-z-]+):\s*"([^"]*)"/);
      if (m) paths.set(m[1], m[2]);
      else if (/^\S/.test(l)) inPaths = false; // 들여쓰기 끝 → 블록 종료
    }
  }
  // template: 블록 내 version
  let templateVersion = "";
  let inTemplate = false;
  for (const l of text.split("\n")) {
    if (/^\s*template:/.test(l)) { inTemplate = true; continue; }
    if (inTemplate) {
      const m = l.match(/^\s*version:\s*"([0-9][0-9.]*)"/);
      if (m) { templateVersion = m[1]; break; }
      if (/^\S/.test(l)) break;
    }
  }
  // 선택 워크플로우 옵션 (metadata.template.options — nexus/secret_backup)
  const options = parseTemplateOptions(text);
  // metadata.template.branches — main/develop/mode (업데이트 모드 재질문 생략용)
  const branches = parseTemplateBranches(text);
  return { version, versionCode, types, paths, templateVersion, options, branches, extraTopLevel: parseExtraTopLevel(text) };
}

// metadata.template.branches 블록 파싱. 셋 다 있어야 유효 — 아니면 null.
export function parseTemplateBranches(content) {
  // 인라인 주석(` # ...`)을 먼저 떼고 따옴표·공백을 정리한다. 문자열 값을 받는 키(deploy_style)는
  // 주석을 안 떼면 "simple # simple | nginx ..." 가 통째로 값이 된다.
  const strip = (s) => String(s).replace(/\s+#.*$/, "").replace(/["']/g, "").trim();
  let inTemplate = false;
  let inBranches = false;
  const out = { main: "", develop: "", mode: "" };
  for (const line of String(content || "").split("\n")) {
    if (/^\s*template:/.test(line)) { inTemplate = true; continue; }
    if (inTemplate && /^\s+branches:/.test(line)) { inBranches = true; continue; }
    if (inTemplate && inBranches) {
      let m = line.match(/^\s+main:\s*(.+)/);
      if (m) { out.main = strip(m[1]); continue; }
      m = line.match(/^\s+develop:\s*(.+)/);
      if (m) { out.develop = strip(m[1]); continue; }
      m = line.match(/^\s+mode:\s*(.+)/);
      if (m) { out.mode = strip(m[1].split("#")[0]); continue; }
      if (/^\s{0,4}[a-z_]+:/.test(line)) { inBranches = false; }
    }
    if (inTemplate && /^[a-z_]+:/.test(line)) { inTemplate = false; inBranches = false; }
  }
  return out.main && out.develop && out.mode ? out : null;
}

// version.yml 전체 생성 — payload/version.yml.template 렌더링.
// opts: { templateText, version, types:[], paths:Map, pathMarkers?:Map,
//         branch, branches?, versionCode, now, today, templateOptions?, deployValues?,
//         extraTopLevel?:string[] }  ← 기존 version.yml의 알려지지 않은 최상위 필드 보존 (issue #20 M8)
//   templateText = payload/version.yml.template 원문 (readVersionYmlTemplate — 필수)
//   now   = "YYYY-MM-DD HH:MM:SS" (UTC) — 결정성 위해 주입 / today = "YYYY-MM-DD"
//   branches = { main, develop, mode } (resolveBranchConfig 결과. 없으면 branch 기반 기본값)
//   pathMarkers = Map<type, markerFilename> (project_paths 주석용)
//   templateOptions = { templateVersion, includeNexus, includeSecretBackup, optionsDate }
export function buildVersionYml({
  templateText, version, types = [], paths = new Map(), pathMarkers = new Map(),
  branch = "main", branches = null, versionCode = 1, now, today,
  templateOptions = null, deployValues = new Map(), extraTopLevel = [],
}) {
  if (!templateText) throw new Error("version.yml.template 원문이 필요합니다 (payload/version.yml.template 누락?)");
  const typesJson = types.length ? `[${types.map((t) => `"${t}"`).join(", ")}]` : `["basic"]`;
  const b = branches || { main: branch || "main", develop: "develop", mode: "pr-flow" };
  const {
    templateVersion = "unknown", includeNexus = false, includeSecretBackup = false,
    includeSemverAuto = true, deployStyle = "", optionsDate = today,
  } = templateOptions || {};

  // project_paths 블록 (full-line 토큰 {{PROJECT_PATHS}} — 없으면 라인 제거)
  let pathsBlock = "";
  if (paths.size) {
    const rows = [`project_paths: # 타입별 프로젝트 폴더 (레포 루트 기준 상대경로)`];
    for (const [t, p] of paths) {
      const marker = pathMarkers.get(t) || "";
      const pf = p === "." ? marker : (marker ? `${p}/${marker}` : p);
      rows.push(marker ? `  ${t}: "${p}" # ${pf}` : `  ${t}: "${p}"`);
    }
    pathsBlock = rows.join("\n");
  }

  // deploy 블록 (full-line 토큰 {{DEPLOY}} — WF ask 값이 있는 타입만, 앞에 빈 줄 1개)
  let deployBlock = "";
  const deployTypes = [...deployValues.keys()].filter((t) => deployValues.get(t) && deployValues.get(t).size > 0);
  if (deployTypes.length) {
    const rows = ["", "deploy: # 마법사가 기억하는 배포 설정 (비민감 / 직접 수정 가능)"];
    for (const t of deployTypes) {
      rows.push(`  ${t}:`);
      // 동일한 이스케이프를 재사용 — deploy 값도 @wizard ask 값과 같은 경로로 들어오므로
      // 큰따옴표가 섞이면 setEnvLine과 동일하게 YAML이 깨진다 (issue #20 L9, 두 번째 지점).
      for (const [k, v] of deployValues.get(t)) rows.push(`    ${k}: "${escapeYamlDoubleQuoted(v)}"`);
    }
    deployBlock = rows.join("\n");
  }

  const scalars = {
    VERSION: version, VERSION_CODE: String(versionCode),
    PROJECT_TYPES: typesJson,
    NOW: now, TODAY: today || optionsDate, DEFAULT_BRANCH: branch,
    TEMPLATE_VERSION: templateVersion,
    MAIN_BRANCH: b.main, DEVELOP_BRANCH: b.develop, BRANCH_MODE: b.mode,
    OPT_NEXUS: String(includeNexus), OPT_SECRET_BACKUP: String(includeSecretBackup),
    OPT_SEMVER_AUTO: String(includeSemverAuto),
    OPT_DEPLOY_STYLE: String(deployStyle || ""),
  };

  const out = [];
  for (const line of String(templateText).split("\n")) {
    const t = line.trim();
    if (t === "{{PROJECT_PATHS}}") { if (pathsBlock) out.push(pathsBlock); continue; }
    if (t === "{{DEPLOY}}") { if (deployBlock) out.push(deployBlock); continue; }
    out.push(line.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_, name) => {
      if (name in scalars) return scalars[name];
      throw new Error(`version.yml.template에 알 수 없는 플레이스홀더: {{${name}}}`);
    }));
  }
  let text = out.join("\n");
  if (extraTopLevel.length) {
    if (!text.endsWith("\n")) text += "\n";
    text += "\n" + extraTopLevel.join("\n\n");
  }
  if (!text.endsWith("\n")) text += "\n";
  return text.replace(/\n{3,}$/, "\n"); // 말미 과잉 빈 줄 정리
}

// context 하나로 version.yml 최종형을 만든다 — 실제 설치(full)와 미리보기(dry-run)가
// 같은 함수를 쓰게 해서 "미리보기와 결과가 다른" 상황을 구조적으로 막는다.
// deployValues는 실제 설치에서만 존재한다(미리보기는 치환을 수행하지 않으므로 빈 Map).
export function renderVersionYml(context, templateText, { pathMarkers, deployValues = new Map(), extraTopLevel = [] }) {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    now, today, templateVersion = "unknown", branches = null,
    includeNexus = false, includeSecretBackup = false, includeSemverAuto, deployStyle } = context;
  return buildVersionYml({
    templateText, version, types, paths, pathMarkers, branch, branches, versionCode, now, today,
    deployValues, extraTopLevel,
    templateOptions: {
      templateVersion, includeNexus, includeSecretBackup,
      includeSemverAuto: includeSemverAuto !== false,
      deployStyle: deployStyle || DEFAULT_DEPLOY_STYLE,
      optionsDate: today,
    },
  });
}
