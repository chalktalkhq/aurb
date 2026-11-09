#!/usr/bin/env node
// npx @aurb/player: find an orb and get the code for it, preview one, download one to host yourself, or make and publish one.
// Menus when a person is at a terminal, plain flags and output everywhere else. The build bundles this into bin/aurb.mjs,
// with the menus' library in a file of their own that loads only when they're shown, so @aurb/player has no dependencies.
import { check } from "./check.js";
import { add, list, pick } from "./code.js";
import { Exit, NAME, NPM_REF, die, fail, parseArgs } from "./common.js";
import { download } from "./download.js";
import { HELP } from "./help.js";
import { pack } from "./pack.js";
import { preview } from "./preview.js";
import { publish } from "./publish.js";

// A command stops by throwing Exit (see stop() in common.ts), which needs nothing more. Anything else is a bug.
const unexpected = (e: unknown) => {
  if (e instanceof Exit) return;
  fail(`Something went wrong: ${(e as Error)?.message ?? e}`, `Please report it, with the command you ran: https://github.com/chalktalkhq/aurb/issues`);
};
// For a stop from a callback, such as the preview server's error event, outside the try below.
process.on("uncaughtException", unexpected);
process.on("unhandledRejection", unexpected);

const { positional, options } = parseArgs(process.argv.slice(2));
const [command, target, ...more] = positional;

try {
  if (options.help || command === "help") console.log(HELP);
  else if (!command) await pick(options);
  else if (command === "add") await add(target, options);
  else if (command === "list" || command === "ls") await list(options);
  else if (command === "preview") await preview(target, options);
  else if (command === "download") await download(target, options);
  else if (command === "pack") await pack(target, options);
  else if (command === "check") await check([target, ...more].filter((t): t is string => !!t));
  else if (command === "publish") await publish(target, options);
  else if ((NAME.test(command) || NPM_REF.test(command)) && !target) await add(command, options); // npx @aurb/player aurora
  else die(`Unknown command "${command}".`, "Run npx @aurb/player --help");
} catch (e) {
  unexpected(e);
}
