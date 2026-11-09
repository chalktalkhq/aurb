// The code a developer pastes: `add`, `list`, and the picker that runs with no command.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { ALIASES, STATES, bold, cyan, die, dim, find, green, index, onlyNote, option, projectPackage, single, tty, value, yellow, type Options, type Orb } from "./common.js";
import { HELP } from "./help.js";

interface SnippetOptions {
  html?: boolean | undefined;
  state?: string | undefined;
}

/** The code for an orb: a React component, or with html, a script tag and the element. */
export function snippet(orb: Orb, { html, state = "idle" }: SnippetOptions): string {
  const rest = orb.fade === "rest";
  const theme = single(orb);
  const extra = `${rest ? ' transition="rest"' : ""}${theme ? ` theme="${theme}"` : ""}`;
  if (html) {
    // rest extends the module build, so a solid orb loads the player as modules rather than the global script.
    // Pinned to the major, like orbs follow @1: fixes arrive on their own, a breaking release never does.
    const dist = "https://cdn.jsdelivr.net/npm/@aurb/player@0/dist";
    const scripts = rest
      ? `<script type="module" src="${dist}/aurb.js"></script>\n<script type="module" src="${dist}/rest.js"></script>`
      : `<script src="${dist}/aurb.global.js" defer></script>`;
    return `${scripts}

<aurb-orb orb="${value(orb)}" state="${state}"${extra} style="width:120px"></aurb-orb>`;
  }
  return `import { Aurb } from "@aurb/player/react";${rest ? '\nimport "@aurb/player/rest";' : ""}

<Aurb orb="${value(orb)}" state="${state}"${extra} style={{ width: 120 }} />`;
}

/** Copy to the clipboard with whatever tool this system has. False if none worked. */
function copy(text: string): boolean {
  const tools =
    process.platform === "win32" ? [["clip"]]
    : process.platform === "darwin" ? [["pbcopy"]]
    : [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];
  for (const [cmd, ...args] of tools) {
    if (spawnSync(cmd!, args, { input: text }).status === 0) return true;
  }
  return false;
}

/** What to run to install the player, in the package manager this project already uses. Null if it has it, or isn't a project. */
function installHint(): string | null {
  const pkg = projectPackage();
  if (!pkg || { ...pkg.dependencies, ...pkg.devDependencies }["@aurb/player"]) return null;
  const pm =
    fs.existsSync("pnpm-lock.yaml") ? "pnpm add"
    : fs.existsSync("yarn.lock") ? "yarn add"
    : fs.existsSync("bun.lockb") || fs.existsSync("bun.lock") ? "bun add"
    : "npm i";
  return `${pm} @aurb/player`;
}

function usesReact(): boolean {
  const pkg = projectPackage();
  return !!pkg && !!{ ...pkg.dependencies, ...pkg.devDependencies }.react;
}

/** The --state option, checked: a state or one of its other names. */
function stateOf(options: Options): string {
  const state = option(options, "state");
  if (state === undefined) return "idle";
  if (!STATES.includes(state) && !ALIASES[state]) die(`There's no state called "${state}".`, `Choose one of ${STATES.join(", ")}`);
  return state;
}

/** Hand over an orb's code: as JSON, plain for a pipe, or copied and explained at a terminal. */
function give(orb: Orb, opts: SnippetOptions & { json?: boolean | undefined }): void {
  const code = snippet(orb, opts);
  const theme = single(orb);
  if (opts.json) {
    console.log(JSON.stringify({ ...orb, orb: value(orb), theme, code, install: opts.html ? null : "npm i @aurb/player" }, null, 2));
    return;
  }
  if (!tty) {
    console.log(code);
    if (theme) console.error(onlyNote(theme));
    return;
  }
  const install = opts.html ? null : installHint();
  const copied = copy(code);
  console.log(`\n${code.split("\n").map((l) => `  ${l}`).join("\n")}\n`);
  console.log(copied ? `${green("✓")} Copied to your clipboard.` : dim("Select the code above to copy it."));
  if (theme) console.log(yellow(onlyNote(theme)));
  if (install) console.log(`${dim("First, in this project:")} ${cyan(install)}`);
  console.log(`${dim("See every state:")} ${cyan(`npx @aurb/player preview ${value(orb)}`)}\n`);
}

/** No command: choose an orb, then React or HTML, from menus. Help instead, when nobody is at the terminal. */
export async function pick(options: Options): Promise<void> {
  if (!tty) return console.log(HELP);
  const state = stateOf(options);
  const { intro, menu, outro, cancelled } = await import("./menu.js");
  intro();
  const orbs = await index();
  if (!orbs.length) die("No orbs are listed yet.", "Try again later");
  const choose = async <T>(opts: Parameters<typeof menu<T>>[0]): Promise<T> => {
    const chosen = await menu(opts);
    if (chosen === undefined) {
      cancelled();
      process.exit(0);
    }
    return chosen;
  };
  const orb = await choose({
    question: "Choose an orb",
    answer: "Orb",
    filter: true,
    items: orbs.map((o) => ({ value: o, label: o.name, hint: o.description, tag: single(o) && `${single(o)} only` })),
  });
  const html = await choose({
    question: "Use it with",
    answer: "With",
    start: usesReact() || options.react ? 0 : 1,
    items: [
      { value: false, label: "React", hint: "a typed component" },
      { value: true, label: "HTML", hint: "a script tag, no build step" },
    ],
  });
  outro(`${bold(orb.name)} for ${html ? "HTML" : "React"}`);
  give(orb, { html, state });
}

/** `list`: every orb, with its description, or names only for a pipe. */
export async function list(options: Options): Promise<void> {
  const orbs = await index();
  if (options.json) return console.log(JSON.stringify(orbs, null, 2));
  if (!process.stdout.isTTY) return console.log(orbs.map((o) => o.name).join("\n"));
  if (!orbs.length) return console.log("No orbs are listed yet.");
  const width = Math.max(...orbs.map((o) => o.name.length));
  console.log(`${bold(`${orbs.length} orbs`)}, all free\n`);
  for (const o of orbs) {
    const theme = single(o);
    console.log(`  ${cyan(o.name.padEnd(width))}  ${o.description ?? ""}${theme ? yellow(` [${theme} only]`) : ""}${o.author ? dim(`  by ${o.author}`) : ""}`);
  }
  console.log(dim(`\nnpx @aurb/player add <name> for its code, npx @aurb/player preview <name> to see it`));
}

/** `add <name>`: one orb's code. With no name, the picker. */
export async function add(name: string | undefined, options: Options): Promise<void> {
  if (!name) return pick(options);
  const state = stateOf(options);
  give(await find(name), { html: !!options.html, state, json: !!options.json });
}
