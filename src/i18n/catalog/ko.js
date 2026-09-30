// 한국어 메시지 카탈로그. 영역별 파트(./ko/)를 합치며, 키는 en.js와 동일해야 한다(테스트가 검사).
import cli from "./ko/cli.js";
import commands from "./ko/commands.js";
import ui from "./ko/ui.js";
import core from "./ko/core.js";
import core2 from "./ko/core2.js";
import copy from "./ko/copy.js";

export const PARTS = { cli, commands, ui, core, core2, copy };
export default Object.assign({}, cli, commands, ui, core, core2, copy);
