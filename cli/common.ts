// What every command shares: the constants, colours, errors, downloads, the list of orbs and what a manifest must hold.
import fs from "node:fs";
import { styleText } from "./style.js";

export const NPM = "https://cdn.jsdelivr.net/npm";
export const INDEX = process.env.AURB_INDEX || `${NPM}/@aurb/index@1/index.json`;
export const LIST = "https://github.com/chalktalkhq/aurb-orbs";
export const STATES = ["idle", "listening", "thinking", "working", "speaking", "success", "error", "asleep"];
export const ALIASES: Record<string, string> = {
  running: "working",
  busy: "working",
  loading: "thinking",
  processing: "thinking",
  talking: "speaking",
  recording: "listening",
  done: "success",
  failed: "error",
  sleeping: "asleep",
  dormant: "asleep",
  default: "idle",
};
export type Theme = "dark" | "light";
export const THEMES: Theme[] = ["dark", "light"];
export const SIZES = [80, 160, 320]; // the player's sm, md and lg: every orb needs these
export const MAX_FILE_KB = 2048;
export const MAX_ORB_MB = 120; // jsDelivr serves packages up to 150 MB; the 640px files are most of an orb
export const NAME = /^[a-z][a-z0-9-]{1,30}$/;
export const RESERVED = ["index", "player"]; // @aurb/index is the list and @aurb/player the player, so no orb can have those names
export const NPM_REF = /^npm:((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)@(\d+\.\d+\.\d+)$/;
export const FILE = /^[a-z0-9][\w.-]*$/i; // a plain file name: anything with a slash or .. could write outside the folder
export const OUTPUT = /^(poster-(dark|light)|[a-z][\w-]*-(dark|light))-\d+\.(mp4|webm|jpg)$/; // what pack writes

/** Whether a file in an orb's folder is published with it. */
export const ships = (f: string): boolean =>
  OUTPUT.test(f) || ["manifest.json", "package.json"].includes(f) || /^(licen[cs]e|readme)(\.\w+)?$/i.test(f);

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

// ------------------------------------------------------------------ orbs

/** An orb in the list. One of ours has a name; a community orb also has its own package, at the exact approved version. */
export interface Orb {
  name: string;
  description?: string;
  author?: string | undefined;
  package?: string;
  version?: string;
  themes?: Theme[];
  fade?: "rest";
}

/** What an orb's manifest.json says about it. Older manifests have no themes, which means both. */
export interface Manifest {
  name: string;
  version?: string;
  states: string[];
  themes?: Theme[];
  sizes: number[];
  kb: Record<string, number>;
  rest?: unknown;
}

/** The parts of an orb's package.json the CLI reads. */
export interface PackageJson {
  name: string;
  version?: string;
  description?: string;
  author?: string | { name: string };
  license?: string;
  private?: boolean;
  aurb?: { fade?: string; hash?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** The list of orbs. With soft, a failure returns null instead of stopping, for checks that can do without it. */
export async function index(opts: { soft: true }): Promise<Orb[] | null>;
export async function index(opts?: { soft?: false }): Promise<Orb[]>;
export async function index({ soft = false } = {}): Promise<Orb[] | null> {
  let orbs: unknown;
  try {
    // A local list, for trying orbs before they're published.
    orbs = /^https?:/.test(INDEX) ? await getJson(INDEX) : JSON.parse(fs.readFileSync(INDEX, "utf8"));
  } catch {}
  if (Array.isArray(orbs)) {
    // A community entry plays from its package at one exact version: one without both can't be played, so it's left out.
    return orbs.filter((o: Orb) => o && NAME.test(o.name ?? "") && (!o.package || NPM_REF.test(value(o))));
  }
  if (soft) return null;
  die("Couldn't load the list of orbs.", orbs === undefined ? OFFLINE : `${INDEX} isn't a list of orbs. Try again in a minute`);
}

/**
 * What goes in orb="...": a name for our own @aurb orbs, which follow 1.x, and the exact approved version of a
 * community orb's own package, so nobody gets an update that hasn't been reviewed.
 */
export const value = (o: Orb): string => (o.package ? `npm:${o.package}@${o.version}` : o.name);

/** Where its files are on jsDelivr: the same URL the player builds from that value. */
export const base = (o: Orb): string => (o.package ? `${NPM}/${o.package}@${o.version}` : `${NPM}/@aurb/${o.name}@1`);

/** The one theme an orb is made in, or null when it has both. Lists from before themes were recorded have both. */
export const single = (o: { themes?: Theme[] | undefined }): Theme | null => (o.themes?.length === 1 ? o.themes[0]! : null);

export const otherTheme = (t: Theme): Theme => (t === "dark" ? "light" : "dark");

export function onlyNote(t: Theme): string {
  const other = otherTheme(t);
  return `${t === "dark" ? "Dark" : "Light"} only: it's made for ${t} backgrounds. theme="${t}" keeps it that way, and it never downloads ${other} files. On a ${other} page, give it a ${t} panel.`;
}

/** What a manifest must hold, as a list of problems. */
export function manifestProblems(m: Manifest | null | undefined): string[] {
  if (!m || typeof m !== "object") return ["manifest.json isn't an object"];
  const p: string[] = [];
  if (!NAME.test(m.name ?? "")) p.push(`manifest.json name "${m.name}" should be lowercase letters, digits and -`);
  else if (RESERVED.includes(m.name)) p.push(`"${m.name}" can't be an orb's name; choose another`);

  const themes = m.themes ?? THEMES;
  const themesOk = Array.isArray(themes) && themes.length && themes.every((t) => THEMES.includes(t)) && new Set(themes).size === themes.length;
  if (!themesOk) p.push(`manifest.json themes should be ["dark"], ["light"] or ["dark", "light"]`);

  if (!Array.isArray(m.sizes) || m.sizes.some((s) => !Number.isInteger(s) || s < 16 || s > 2048)) {
    p.push("manifest.json sizes should be a list of widths in pixels");
  } else {
    for (const s of SIZES) if (!m.sizes.includes(s)) p.push(`manifest.json sizes needs ${s}: the player picks from ${SIZES.join(", ")}`);
  }

  if (!Array.isArray(m.states) || m.states.some((s) => !NAME.test(s))) {
    p.push("manifest.json states should be a list of state names");
  } else {
    for (const s of STATES) if (!m.states.includes(s)) p.push(`manifest.json states is missing ${s}`);
  }

  if (!m.kb || typeof m.kb !== "object" || Array.isArray(m.kb)) {
    p.push("manifest.json kb should list every file with its size");
  } else {
    for (const f of Object.keys(m.kb)) if (!FILE.test(f)) p.push(`manifest.json lists "${f}", which isn't a plain file name`);
  }
  return p;
}

/** Every file a complete orb has, from its manifest. A solid orb (rest) also has a way in and out of every state. */
export function expected(m: Manifest): string[] {
  const out: string[] = [];
  for (const theme of m.themes ?? THEMES) {
    for (const size of m.sizes) {
      out.push(`poster-${theme}-${size}.jpg`);
      for (const ext of ["webm", "mp4"]) {
        for (const state of m.states) {
          out.push(`${state}-${theme}-${size}.${ext}`);
          if (m.rest) out.push(`${state}-in-${theme}-${size}.${ext}`, `${state}-out-${theme}-${size}.${ext}`);
        }
        if (m.rest) out.push(`rest-${theme}-${size}.${ext}`);
      }
    }
  }
  return out;
}

/** An orb's manifest from its folder on jsDelivr, or stop and say why it can't be had. */
export async function manifestOf(from: string, label: string): Promise<Manifest> {
  const m = await getJson<Manifest>(`${from}/manifest.json`);
  if (m === undefined) die(`Couldn't reach ${label}.`, OFFLINE);
  if (!m) die(`${label} has no manifest.json.`, "Check the name and version. Just published? jsDelivr can take a minute to see it");
  const p = manifestProblems(m);
  if (p.length) die(`${label} has a broken manifest.json:\n  ${p.join("\n  ")}`);
  return m;
}

/** An orb by its name in the list, or by npm:<package>@<version> for one nobody has listed yet, such as one under review. */
export async function find(input: string): Promise<Orb> {
  const name = input.trim();
  const ref = NPM_REF.exec(name);
  if (ref) {
    const [, pkgName, version] = ref as unknown as [string, string, string];
    const from = `${NPM}/${pkgName}@${version}`;
    const manifest = await manifestOf(from, `${pkgName}@${version}`);
    const pkg = (await getJson<PackageJson>(`${from}/package.json`)) ?? ({} as Partial<PackageJson>);
    return {
      name: manifest.name,
      description: pkg.description ?? "",
      author: pkg.author as string | undefined,
      package: pkgName,
      version,
      themes: manifest.themes ?? THEMES,
      ...(pkg.aurb?.fade === "rest" ? { fade: "rest" as const } : {}),
    };
  }
  if (name.startsWith("npm:")) die(`${name} needs a package name and an exact version.`, "Such as npm:aurb-orb-nebula@1.0.0");

  const orbs = await index();
  const want = name.toLowerCase().replace(/^@aurb\//, "").replace(/@1$/, "");
  const orb = orbs.find((o) => o.name === want);
  if (orb) return orb;
  const near = orbs.filter((o) => o.name[0] === want[0] || o.name.includes(want) || want.includes(o.name)).map((o) => o.name);
  die(`There's no orb called "${name}".`, near.length ? `Did you mean ${near.join(", ")}? Or run npx @aurb/player list` : "Run npx @aurb/player list to see them all");
}

/** This project's package.json, or null outside a project. */
export function projectPackage(): PackageJson | null {
  try {
    return JSON.parse(fs.readFileSync("package.json", "utf8"));
  } catch {
    return null;
  }
}
