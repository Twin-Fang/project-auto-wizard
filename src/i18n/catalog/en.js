// English message catalog (default language), assembled from per-area parts in ./en/.
// Keys are flat and dotted: `<area>.<topic>.<name>`. Params are written as {name}.
// Every key must also exist in ko.js (checked by tests); a key may be defined in one part only.
import cli from "./en/cli.js";
import commands from "./en/commands.js";
import ui from "./en/ui.js";
import core from "./en/core.js";
import core2 from "./en/core2.js";
import copy from "./en/copy.js";

export const PARTS = { cli, commands, ui, core, core2, copy };
export default Object.assign({}, cli, commands, ui, core, core2, copy);
