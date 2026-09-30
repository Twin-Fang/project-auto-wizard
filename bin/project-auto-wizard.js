#!/usr/bin/env node
// project-auto-wizard CLI entry: passes argv to run() in src/index.js.
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 12)) {
  // Plain English fallback: the message catalog may not even load on an unsupported Node.
  let message = `Node.js 20.12 or later is required (current: ${process.versions.node})`;
  try {
    // Resolve the language cheaply (--lang flag -> env var) so the message matches the requested language.
    const argv = process.argv.slice(2);
    const at = argv.lastIndexOf("--lang");
    const norm = (v) => String(v ?? "").trim().toLowerCase();
    const { t, setLanguage } = await import(pathToFileURL(join(here, "..", "src", "i18n", "index.js")).href);
    setLanguage(norm(process.env.PROJECT_AUTO_WIZARD_LANG)); // invalid values are ignored by setLanguage
    if (at >= 0) setLanguage(norm(argv[at + 1]));
    const inline = argv.findLast((a) => a.startsWith("--lang="));
    if (inline) setLanguage(norm(inline.slice("--lang=".length)));
    message = t("cli.bin.nodeVersion", { current: process.versions.node });
  } catch { /* keep the English fallback */ }
  console.error(message);
  process.exit(1);
}

const indexPath = join(here, "..", "src", "index.js");
const { run } = await import(pathToFileURL(indexPath).href);

const code = await run(process.argv.slice(2), { cwd: process.cwd() });
// Set exitCode instead of calling process.exit() so piped stdout/stderr is fully flushed before exit.
process.exitCode = code;
