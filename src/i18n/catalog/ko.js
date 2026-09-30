// Korean message catalog. Merges the per-area parts (./ko/); keys must match en.js (checked by tests).
import cli from "./ko/cli.js";
import commands from "./ko/commands.js";
import ui from "./ko/ui.js";
import core from "./ko/core.js";
import core2 from "./ko/core2.js";
import copy from "./ko/copy.js";

export const PARTS = { cli, commands, ui, core, core2, copy };
export default Object.assign({}, cli, commands, ui, core, core2, copy);
