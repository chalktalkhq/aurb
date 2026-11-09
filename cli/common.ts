// What every command needs from the terminal: colours, errors and how a command stops, arguments, and downloads.
import { styleText } from "./style.js";

/** A person is at the terminal, so menus, colours and progress lines make sense. */
export const tty = !!(process.stdout.isTTY && process.stdin.isTTY);

const paint = (format: string) => (text: string) => styleText(format, text);
export const bold = paint("bold");
export const dim = paint("dim");
export const green = paint("green");
export const red = paint("red");
export const cyan = paint("cyan");
export const yellow = paint("yellow");

export const OFFLINE = "Check your connection. Behind a proxy? Set HTTPS_PROXY and NODE_USE_ENV_PROXY=1, which recent Node versions read";

/** Thrown by stop() to unwind a command from wherever it is. The entry point catches it and does nothing more. */
export class Exit extends Error {}

/**
 * End the command with this exit code. Not process.exit(): on Windows, Node can crash inside it shortly after a
 * fetch, exiting 127 instead (nodejs/node#56645). So the process ends by itself once nothing is left running, and a
 * timer that doesn't keep it alive ends it anyway in case something still holds it open.
 */
export function stop(code: number): never {
  process.exitCode = code;
  setTimeout(() => process.exit(), 2000).unref();
  throw new Exit();
}

/** Print an error, and what to do about it. */
export function fail(message: string, fix?: string): void {
  console.error(`${red("✕")} ${message}${fix ? `\n  ${fix}` : ""}`);
  process.exitCode = 1;
}

/** Stop with an error, and what to do about it. */
export function die(message: string, fix?: string): never {
  fail(message, fix);
  stop(1);
}

// ------------------------------------------------------------------ arguments

/** `--name value` and `--name=value` options, and `--flag`s, which are true. */
export type Options = Record<string, string | true>;

const FLAGS = ["html", "react", "json", "xl", "help", "no-open", "dry-run", "readme"]; // these never take a value

export function parseArgs(argv: string[]): { positional: string[]; options: Options } {
  const positional: string[] = [];
  const options: Options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const key = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq < 0 ? undefined : arg.slice(eq + 1);
    const next = argv[i + 1];
    const takesNext = !FLAGS.includes(key) && next && !next.startsWith("--");
    options[key] = inline ?? (takesNext ? argv[++i]! : true);
  }
  return { positional, options };
}

/** An option's value, if it was given. An option given with no value is a mistake. */
export function option(options: Options, key: string): string | undefined {
  const value = options[key];
  if (value === undefined) return undefined;
  if (value === true) die(`--${key} needs a value.`);
  return String(value);
}

// ------------------------------------------------------------------ downloads

/**
 * The response to a URL, with one retry, since a CDN edge can drop a request. Null when it isn't there (a 404), and
 * undefined when it couldn't be reached.
 */
async function fetchOk(url: string): Promise<Response | null | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url).catch(() => null);
    if (r?.status === 404) return null;
    if (r?.ok) return r;
  }
  return undefined;
}

/** JSON from a URL: null when it isn't there or isn't JSON, undefined when it couldn't be reached. */
export async function getJson<T = unknown>(url: string): Promise<T | null | undefined> {
  const r = await fetchOk(url);
  return r ? r.json().catch(() => null) : r;
}

/** A file from a URL: null when it isn't there, undefined when it couldn't be reached. */
export async function getBytes(url: string): Promise<Buffer | null | undefined> {
  const r = await fetchOk(url);
  return r ? Buffer.from(await r.arrayBuffer()) : r;
}
