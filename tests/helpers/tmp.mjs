// Shared cleanup for temp directories that hold git repositories.
// git may still be writing into .git (background gc / maintenance) while a test finishes, which makes a plain
// rmSync fail with ENOTEMPTY; retrying lets the directory settle. Background work is also switched off for every
// git process through tests/setup-lang.mjs (GIT_CONFIG_* env).
import { rmSync } from "node:fs";

export const rmTmp = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
