// 타입 전용 앱 파일(사용자 소유, 없을 때만 생성) 설치 — 타입 훅(planAppFiles/copyAppFiles)을 돌려 합친다.
// 어떤 파일이 대상인지는 훅이 정하므로 여기서는 타입 이름을 알지 못한다.
import { hooksFor, typeInfo } from "../types.js";

// 읽기 전용 — dry-run이 쓴다. 반환: { created:[], kept:[] }
export function planTypeAppFiles(context, payloadRoot, targetRoot = ".") {
  const result = { created: [], kept: [] };
  for (const { hook } of hooksFor(context.types || [], "planAppFiles")) {
    const r = hook(context, payloadRoot, targetRoot);
    result.created.push(...r.created);
    result.kept.push(...r.kept);
  }
  return result;
}

// onFile(tag, action, relPath): 파일마다 호출되는 로그 콜백. 반환: { created:[], kept:[] }
export function copyTypeAppFiles(context, payloadRoot, targetRoot = ".", onFile = () => {}) {
  const result = { created: [], kept: [] };
  for (const { id, hook } of hooksFor(context.types || [], "copyAppFiles")) {
    const tag = typeInfo(id).hooks.appFilesTag ?? id;
    const r = hook(context, payloadRoot, targetRoot);
    for (const f of r.created) onFile(tag, "create", f);
    for (const f of r.kept) onFile(tag, "keep", f);
    result.created.push(...r.created);
    result.kept.push(...r.kept);
  }
  return result;
}
