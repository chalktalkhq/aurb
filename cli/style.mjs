// Colour, one rule for the whole CLI: only on a terminal, never with NO_COLOR (https://no-color.org) or TERM=dumb, always
// with FORCE_COLOR. The build points the prompt library's `import { styleText } from "node:util"` here too, so its menus
// follow the same rule, on every Node version: styleText only arrived in Node 20.12, and before 22.13 it ignored NO_COLOR.
import { inspect } from "node:util";

export { stripVTControlCharacters } from "node:util";

const env = process.env;
export const colour = () =>
  env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0" ? true : !!process.stdout.isTTY && !env.NO_COLOR && env.TERM !== "dumb";

// The same as Node's: a format such as "cyan", or several, ["bold", "cyan"], each closed with its own code so they nest.
export function styleText(format, text) {
  let s = String(text);
  if (!colour()) return s;
  for (const f of [format].flat().reverse()) {
    const c = inspect.colors[f];
    if (c) s = `\x1b[${c[0]}m${s}\x1b[${c[1]}m`;
  }
  return s;
}
