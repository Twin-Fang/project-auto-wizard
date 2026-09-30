// Installs type-specific app files (user-owned, created only when missing) by running the type hooks
// (planAppFiles/copyAppFiles) and merging their results.
// Which files are targeted is decided by the hooks, so this module knows no type names.
import { hooksFor, typeInfo } from "../types.js";

// Read-only, used by dry-run. Returns { created:[], kept:[] }
export function planTypeAppFiles(context, payloadRoot, targetRoot = ".") {
  const result = { created: [], kept: [] };
  for (const { hook } of hooksFor(context.types || [], "planAppFiles")) {
    const r = hook(context, payloadRoot, targetRoot);
    result.created.push(...r.created);
    result.kept.push(...r.kept);
  }
  return result;
}

// onFile(tag, action, relPath): log callback invoked per file. Returns { created:[], kept:[] }
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
