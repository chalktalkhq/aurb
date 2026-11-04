#!/usr/bin/env node
// npx aurb: find an orb and get the code for it, preview one, download one to host yourself, or make and publish one.
// No dependencies, so it starts at once. Menus when a person is at a terminal, plain flags and output everywhere else.
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const NPM = "https://cdn.jsdelivr.net/npm";
const INDEX = process.env.AURB_INDEX || `${NPM}/@aurb/index@1/index.json`;
const LIST = "https://github.com/chalktalkhq/aurb-orbs";
const STATES = ["idle", "listening", "thinking", "working", "speaking", "success", "error", "asleep"];
const ALIASES = { running: "working", busy: "working", loading: "thinking", processing: "thinking", talking: "speaking", recording: "listening", done: "success", failed: "error", sleeping: "asleep", dormant: "asleep", default: "idle" };
const THEMES = ["dark", "light"];
const SIZES = [80, 160, 320]; // the player's sm, md and lg: every orb needs these
const MAX_FILE_KB = 2048, MAX_ORB_MB = 120; // jsDelivr serves packages up to 150 MB; the 640px files are most of an orb
const NAME = /^[a-z][a-z0-9-]{1,30}$/;
const NPM_REF = /^npm:((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)@(\d+\.\d+\.\d+)$/;
const FILE = /^[a-z0-9][\w.-]*$/i; // a plain file name: anything with a slash or .. could write outside the folder
const OUTPUT = /^(poster-(dark|light)|[a-z][\w-]*-(dark|light))-\d+\.(mp4|webm|jpg)$/; // what pack writes
const SHIPS = (f) => OUTPUT.test(f) || ["manifest.json", "package.json"].includes(f) || /^(licen[cs]e|readme)(\.\w+)?$/i.test(f);
const tty = process.stdout.isTTY && process.stdin.isTTY;
const paint = (code) => (s) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint(1), dim = paint(2), green = paint(32), red = paint(31), cyan = paint(36), yellow = paint(33);

const HELP = `${bold("aurb")}: animated orbs for AI products

  ${cyan("npx aurb")}                       pick an orb and get its code
  ${cyan("npx aurb add")} aurora            the code for one orb  ${dim("--html  --state thinking  --json")}
  ${cyan("npx aurb list")}                  every orb  ${dim("--json")}
  ${cyan("npx aurb preview")} aurora        play it in your browser, every state  ${dim("--port 4300")}
  ${cyan("npx aurb download")} aurora       save the files to host yourself  ${dim("--out public/orbs  --theme dark")}

Making an orb
  ${cyan("npx aurb pack")} ./loops --name nebula   encode your loops into an orb  ${dim('--note "..."  --xl  --out orbs')}
  ${cyan("npx aurb preview")} orbs/nebula        try it before you share it
  ${cyan("npx aurb check")} orbs/nebula          the check a submission runs  ${dim("also npm:aurb-orb-nebula@1.0.0")}
  ${cyan("npx aurb publish")} orbs/nebula        publish it to npm as your own package  ${dim("--dry-run")}

  ./loops holds one seamless, square loop per state and theme, named like idle-dark.mp4 and idle-light.mov:
  ${STATES.join(", ")}; dark on black, light on white, all the same length.
  Only dark ones, or only light ones, makes an orb for that theme alone.
  Anyone can use it once it's published, as orb="npm:aurb-orb-nebula@1.0.0". To get it listed: ${LIST}
`;

function die(msg, fix) {
  console.error(`${red("✕")} ${msg}${fix ? `\n  ${fix}` : ""}`);
  process.exit(1);
}
const OFFLINE = "Check your connection. Behind a proxy? Set HTTPS_PROXY and NODE_USE_ENV_PROXY=1, which recent Node versions read";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const eq = a.indexOf("="), k = eq < 0 ? a.slice(2) : a.slice(2, eq), v = eq < 0 ? undefined : a.slice(eq + 1);
    const flag = ["html", "react", "json", "xl", "help", "no-open", "dry-run"].includes(k); // these never take a value
    out[k] = v ?? (!flag && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true);
  }
  return out;
}
const option = (args, k) => (args[k] === undefined ? undefined : args[k] === true ? die(`--${k} needs a value.`) : String(args[k]));

async function get(url, as = "json") {
  for (let attempt = 0; attempt < 2; attempt++) { // one retry: a CDN edge can drop a request
    const r = await fetch(url).catch(() => null);
    if (r?.status === 404) return null;
    if (r?.ok) return as === "json" ? r.json().catch(() => null) : Buffer.from(await r.arrayBuffer());
  }
  return undefined; // couldn't reach it, as opposed to null: it isn't there
}

// The list of orbs. With soft, a failure returns null instead of stopping, for checks that can do without it.
async function index({ soft } = {}) {
  let orbs;
  try { orbs = /^https?:/.test(INDEX) ? await get(INDEX) : JSON.parse(fs.readFileSync(INDEX, "utf8")); } catch {} // a local list, for trying orbs before they're published
  if (Array.isArray(orbs)) return orbs.filter((o) => o && NAME.test(o.name ?? ""));
  if (soft) return null;
  die("Couldn't load the list of orbs.", orbs === undefined ? OFFLINE : `${INDEX} isn't a list of orbs. Try again in a minute`);
}

// What goes in orb="...": a name for our own @aurb orbs, which follow 1.x, and the exact approved version of a
// community orb's own package, so nobody gets an update that hasn't been reviewed.
const value = (o) => (o.package ? `npm:${o.package}@${o.version}` : o.name);
// Where its files are on jsDelivr: the same URL the player builds from that value.
const base = (o) => (o.package ? `${NPM}/${o.package}@${o.version}` : `${NPM}/@aurb/${o.name}@1`);
// The one theme an orb is made in, or null when it has both. Lists from before themes were recorded have both.
const single = (o) => (o.themes?.length === 1 ? o.themes[0] : null);
const onlyNote = (t) => `${t === "dark" ? "Dark" : "Light"} only: it's made for ${t} backgrounds. theme="${t}" keeps it that way, and it never downloads ${t === "dark" ? "light" : "dark"} files. On a ${t === "dark" ? "light" : "dark"} page, give it a ${t} panel.`;

// What a manifest must hold, as a list of problems. Older manifests have no themes, which means both.
function manifestProblems(m) {
  const p = [];
  if (!m || typeof m !== "object") return ["manifest.json isn't an object"];
  if (!NAME.test(m.name ?? "")) p.push(`manifest.json name "${m.name}" should be lowercase letters, digits and -`);
  const themes = m.themes ?? THEMES;
  if (!Array.isArray(themes) || !themes.length || themes.some((t) => !THEMES.includes(t)) || new Set(themes).size !== themes.length) p.push(`manifest.json themes should be ["dark"], ["light"] or ["dark", "light"]`);
  if (!Array.isArray(m.sizes) || m.sizes.some((s) => !Number.isInteger(s) || s < 16 || s > 2048)) p.push("manifest.json sizes should be a list of widths in pixels");
  else for (const s of SIZES) if (!m.sizes.includes(s)) p.push(`manifest.json sizes needs ${s}: the player picks from ${SIZES.join(", ")}`);
  if (!Array.isArray(m.states) || m.states.some((s) => !NAME.test(s))) p.push("manifest.json states should be a list of state names");
  else for (const s of STATES) if (!m.states.includes(s)) p.push(`manifest.json states is missing ${s}`);
  if (!m.kb || typeof m.kb !== "object" || Array.isArray(m.kb)) p.push("manifest.json kb should list every file with its size");
  else for (const f of Object.keys(m.kb)) if (!FILE.test(f)) p.push(`manifest.json lists "${f}", which isn't a plain file name`);
  return p;
}

// Every file a complete orb has, from its manifest. A solid orb (rest) also has a way in and out of every state.
function expected(m) {
  const out = [], exts = ["webm", "mp4"];
  for (const theme of m.themes ?? THEMES) for (const size of m.sizes) {
    out.push(`poster-${theme}-${size}.jpg`);
    for (const ext of exts) {
      for (const state of m.states) {
        out.push(`${state}-${theme}-${size}.${ext}`);
        if (m.rest) out.push(`${state}-in-${theme}-${size}.${ext}`, `${state}-out-${theme}-${size}.${ext}`);
      }
      if (m.rest) out.push(`rest-${theme}-${size}.${ext}`);
    }
  }
  return out;
}

async function manifestOf(from, label) {
  const m = await get(`${from}/manifest.json`);
  if (m === undefined) die(`Couldn't reach ${label}.`, OFFLINE);
  if (!m) die(`${label} has no manifest.json.`, "Check the name and version. Just published? jsDelivr can take a minute to see it");
  const p = manifestProblems(m);
  if (p.length) die(`${label} has a broken manifest.json:\n  ${p.join("\n  ")}`);
  return m;
}

async function find(name) {
  name = name.trim();
  const ref = NPM_REF.exec(name); // a package nobody has listed yet, such as one under review
  if (ref) {
    const from = `${NPM}/${ref[1]}@${ref[2]}`, manifest = await manifestOf(from, `${ref[1]}@${ref[2]}`);
    const pkg = (await get(`${from}/package.json`)) ?? {};
    return { name: manifest.name, description: pkg.description ?? "", author: pkg.author, package: ref[1], version: ref[2], themes: manifest.themes ?? THEMES, ...(pkg.aurb?.fade === "rest" ? { fade: "rest" } : {}) };
  }
  if (name.startsWith("npm:")) die(`${name} needs a package name and an exact version.`, "Such as npm:aurb-orb-nebula@1.0.0");
  const orbs = await index();
  const want = name.toLowerCase().replace(/^@aurb\//, "").replace(/@1$/, "");
  const orb = orbs.find((o) => o.name === want);
  if (!orb) {
    const near = orbs.filter((o) => o.name[0] === want[0] || o.name.includes(want) || want.includes(o.name)).map((o) => o.name);
    die(`There's no orb called "${name}".`, near.length ? `Did you mean ${near.join(", ")}? Or run npx aurb list` : "Run npx aurb list to see them all");
  }
  return orb;
}

// ------------------------------------------------------------------ the code a developer pastes

function snippet(orb, { html, state = "idle" }) {
  const rest = orb.fade === "rest", t = single(orb);
  const extra = `${rest ? ' transition="rest"' : ""}${t ? ` theme="${t}"` : ""}`;
  // rest extends the module build, so a solid orb loads the player as modules rather than the global script.
  const dist = "https://cdn.jsdelivr.net/npm/aurb/dist";
  if (html) return `${rest ? `<script type="module" src="${dist}/aurb.js"></script>\n<script type="module" src="${dist}/rest.js"></script>` : `<script src="${dist}/aurb.global.js" defer></script>`}

<aurb-orb orb="${value(orb)}" state="${state}"${extra} style="width:120px"></aurb-orb>`;
  return `import { Aurb } from "aurb/react";${rest ? '\nimport "aurb/rest";' : ""}

<Aurb orb="${value(orb)}" state="${state}"${extra} style={{ width: 120 }} />`;
}

function copy(text) {
  const tools = process.platform === "win32" ? [["clip"]] : process.platform === "darwin" ? [["pbcopy"]] : [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];
  for (const [cmd, ...a] of tools) if (spawnSync(cmd, a, { input: text }).status === 0) return true;
  return false;
}

// What to run to install the player, in the package manager this project already uses. Null if it has it, or isn't a project.
function installHint() {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync("package.json", "utf8")); } catch { return null; }
  if ({ ...pkg.dependencies, ...pkg.devDependencies }.aurb) return null;
  const pm = fs.existsSync("pnpm-lock.yaml") ? "pnpm add" : fs.existsSync("yarn.lock") ? "yarn add" : fs.existsSync("bun.lockb") || fs.existsSync("bun.lock") ? "bun add" : "npm i";
  return `${pm} aurb`;
}

const usesReact = () => {
  try { const p = JSON.parse(fs.readFileSync("package.json", "utf8")); return !!{ ...p.dependencies, ...p.devDependencies }.react; } catch { return false; }
};

function stateOf(args) {
  const s = option(args, "state");
  if (s === undefined) return "idle";
  if (!STATES.includes(s) && !ALIASES[s]) die(`There's no state called "${s}".`, `Choose one of ${STATES.join(", ")}`);
  return s;
}

function give(orb, opts) {
  const code = snippet(orb, opts), t = single(orb);
  if (opts.json) return console.log(JSON.stringify({ ...orb, orb: value(orb), theme: t, code, install: opts.html ? null : "npm i aurb" }, null, 2));
  if (!tty) { console.log(code); if (t) console.error(onlyNote(t)); return; }
  const install = opts.html ? null : installHint();
  const copied = copy(code);
  console.log(`\n${code.split("\n").map((l) => `  ${l}`).join("\n")}\n`);
  console.log(copied ? `${green("✓")} Copied to your clipboard.` : dim("Select the code above to copy it."));
  if (t) console.log(yellow(onlyNote(t)));
  if (install) console.log(`${dim("First, in this project:")} ${cyan(install)}`);
  console.log(dim(`See every state: npx aurb preview ${value(orb)}\n`));
}

// ------------------------------------------------------------------ menus

// One list, arrows to move, typing filters, Enter picks. Esc or Ctrl+C leaves without doing anything.
function choose(title, items, { label, hint, start = 0 }) {
  return new Promise((resolve) => {
    const out = process.stdout;
    let at = start, filter = "", drawn = 0;
    const shown = () => items.filter((x) => label(x).toLowerCase().includes(filter.toLowerCase()));
    const rows = Math.max(5, Math.min(10, (out.rows || 24) - 6));
    const draw = () => {
      const list = shown();
      at = Math.min(at, Math.max(0, list.length - 1));
      const top = Math.max(0, Math.min(at - Math.floor(rows / 2), list.length - rows));
      const lines = [`${bold(title)}${filter ? `  ${cyan(filter)}` : dim("  type to filter")}`];
      list.slice(top, top + rows).forEach((x, i) => {
        const on = top + i === at;
        lines.push(`${on ? cyan("›") : " "} ${on ? bold(label(x)) : label(x)}${hint ? `  ${dim(hint(x))}` : ""}`);
      });
      if (!list.length) lines.push(dim("  nothing matches"));
      lines.push(dim(`${list.length > rows ? `${at + 1} of ${list.length}  ` : ""}↑↓ move  enter choose  esc quit`));
      out.write(`${drawn ? `\x1b[${drawn}A` : ""}\x1b[0J${lines.map((l) => l.slice(0, (out.columns || 80) + 40)).join("\n")}\n`);
      drawn = lines.length;
    };
    const done = (v) => {
      process.stdin.off("keypress", key);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      out.write(`\x1b[${drawn}A\x1b[0J\x1b[?25h`);
      if (v === undefined) { out.write(dim("Nothing chosen.\n")); process.exit(0); }
      out.write(`${green("✓")} ${title} ${bold(label(v))}\n`);
      resolve(v);
    };
    const key = (s, k = {}) => {
      const list = shown();
      if ((k.ctrl && k.name === "c") || k.name === "escape") return done();
      if (k.name === "return") return list.length && done(list[at]);
      if (k.name === "up" || (k.ctrl && k.name === "p")) at = (at - 1 + list.length) % Math.max(1, list.length);
      else if (k.name === "down" || k.name === "tab" || (k.ctrl && k.name === "n")) at = (at + 1) % Math.max(1, list.length);
      else if (k.name === "backspace") filter = filter.slice(0, -1);
      else if (s && /^[\w-]$/.test(s)) { filter += s; at = 0; }
      draw();
    };
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", key);
    out.write("\x1b[?25l");
    draw();
  });
}

const tag = (o) => (single(o) ? ` [${single(o)} only]` : "");

async function pick(args) {
  if (!tty) return console.log(HELP);
  const state = stateOf(args);
  const orbs = await index();
  if (!orbs.length) die("No orbs are listed yet.", "Try again later");
  const width = Math.max(...orbs.map((o) => o.name.length));
  const orb = await choose("Orb", orbs, { label: (o) => o.name.padEnd(width), hint: (o) => `${o.description ?? ""}${tag(o)}` });
  const kinds = ["React", "HTML"];
  const kind = await choose("For", kinds, { label: (k) => k, hint: (k) => (k === "React" ? "a typed component" : "a script tag, no build step"), start: usesReact() || args.react ? 0 : 1 });
  give(orb, { html: kind === "HTML", state });
}

// ------------------------------------------------------------------ list, add, download

async function list(args) {
  const orbs = await index();
  if (args.json || !process.stdout.isTTY) return console.log(args.json ? JSON.stringify(orbs, null, 2) : orbs.map((o) => o.name).join("\n"));
  if (!orbs.length) return console.log("No orbs are listed yet.");
  const width = Math.max(...orbs.map((o) => o.name.length));
  console.log(`${bold(`${orbs.length} orbs`)}, all free\n`);
  for (const o of orbs) console.log(`  ${cyan(o.name.padEnd(width))}  ${o.description ?? ""}${single(o) ? yellow(tag(o)) : ""}${o.author ? dim(`  by ${o.author}`) : ""}`);
  console.log(dim(`\nnpx aurb add <name> for its code, npx aurb preview <name> to see it`));
}

async function add(name, args) {
  if (!name) return pick(args);
  const state = stateOf(args);
  give(await find(name), { html: !!args.html, state, json: args.json });
}

async function download(name, args) {
  if (!name) die("Which orb?", "npx aurb download aurora");
  const orb = await find(name), from = base(orb);
  const manifest = await manifestOf(from, value(orb));
  const has = manifest.themes ?? THEMES;
  // One theme, for a site that only ever shows that one: about half the files. The element must then say so.
  let theme = option(args, "theme") ?? null;
  if (theme && !THEMES.includes(theme)) die(`--theme is ${THEMES.join(" or ")}.`);
  if (theme && !has.includes(theme)) die(`${orb.name} is ${has[0]} only, so it has no ${theme} files.`, `Leave out --theme, or choose an orb made in ${theme}`);
  if (!theme && has.length === 1) theme = has[0];
  const other = theme && THEMES.find((t) => t !== theme);
  const files = ["manifest.json", ...Object.keys(manifest.kb).filter((f) => !other || !f.includes(`-${other}-`))];
  const out = path.resolve(option(args, "out") ?? "orbs", orb.name);
  try { fs.mkdirSync(out, { recursive: true }); } catch (e) { die(`Couldn't make ${out} (${e.code}).`, "Choose another folder with --out"); }
  let n = 0, bytes = 0;
  for (const f of files) {
    const b = await get(`${from}/${f}`, "bytes");
    if (!b) die(`Couldn't download ${f}${b === null ? ": it's listed but missing" : ""}.`, b === null ? "The orb is broken; tell its author" : `${OFFLINE}, then run the same command again`);
    fs.writeFileSync(path.join(out, f), b);
    bytes += b.length;
    if (tty) process.stdout.write(`\r${dim(`Downloading ${++n} of ${files.length}`)}`);
  }
  const rel = path.relative(process.cwd(), out).split(path.sep).join("/");
  console.log(`\r${green("✓")} Saved ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB, to ${rel}`);
  const attr = theme ? ` theme="${theme}"` : "";
  if (rel.startsWith("..") || path.isAbsolute(rel)) console.log(`Serve that folder with your site, then use orb="<the URL it is served at>"${attr}.`);
  else console.log(`Serve that folder with your site, then use ${cyan(`orb="/${rel.replace(/^(public|static|www)\//, "")}"${attr}`)}, the URL it is served at.`);
  if (theme && has.length === 1) console.log(yellow(onlyNote(theme)));
  else if (theme) console.log(dim(`theme="${theme}" is needed: without it, a visitor in ${other} mode would ask for ${other} files that aren't there.`));
}

// ------------------------------------------------------------------ preview

// Serves the player and a page that plays the orb, from a local folder or from the CDN by name.
async function preview(target, args) {
  if (!target) die("Which orb?", "npx aurb preview aurora, a folder: npx aurb preview orbs/nebula, or a package: npm:aurb-orb-nebula@1.0.0");
  const port = Number(option(args, "port") ?? 4300);
  if (!Number.isInteger(port) || port < 1 || port > 65535) die("--port is a number from 1 to 65535.");
  const local = fs.existsSync(path.join(target, "manifest.json")) ? path.resolve(target) : null;
  let manifest, orb, fade;
  if (local) {
    try { manifest = JSON.parse(fs.readFileSync(path.join(local, "manifest.json"), "utf8")); } catch { die(`${target}/manifest.json isn't valid JSON.`, "Pack it again with npx aurb pack"); }
    const p = manifestProblems(manifest);
    if (p.length) die(`${target} has a broken manifest.json:\n  ${p.join("\n  ")}`, `npx aurb check ${target} lists everything to fix`);
    orb = `http://localhost:${port}/o`;
  } else {
    if (fs.existsSync(target)) die(`${target} has no manifest.json.`, "Make one with npx aurb pack");
    const found = await find(target);
    fade = found.fade;
    orb = base(found);
    manifest = await manifestOf(orb, value(found));
  }
  const dist = path.join(here, "..", "dist");
  if (!fs.existsSync(path.join(dist, "aurb.js"))) die("The player isn't built.", "Run npm run build in the aurb repo");
  const json = (v) => JSON.stringify(v).replace(/</g, "\\u003c"); // a manifest is someone else's data: never let it close the script
  const text = (v) => String(v).replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const page = fs.readFileSync(path.join(here, "preview.html"), "utf8").replaceAll("__NAME__", text(manifest.name)).replaceAll("__ORB__", orb)
    .replace("__STATES__", json(manifest.states)).replace("__REST__", json(!!manifest.rest || fade === "rest")).replace("__KB__", json(manifest.kb))
    .replace("__THEMES__", json(manifest.themes ?? THEMES)).replaceAll("__SIZES__", manifest.sizes.join(","));
  const TYPES = { webm: "video/webm", mp4: "video/mp4", jpg: "image/jpeg", js: "text/javascript" };
  http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    const media = local && /^\/o\/([\w-]+\.(webm|mp4|jpg))$/.exec(url);
    const js = /^\/(aurb|rest|shared)\.js$/.test(url) && path.join(dist, url);
    const f = media ? path.join(local, media[1]) : js;
    if (f) {
      const ok = fs.existsSync(f);
      res.writeHead(ok ? 200 : 404, { "content-type": TYPES[path.extname(f).slice(1)] });
      return res.end(ok ? fs.readFileSync(f) : "");
    }
    if (url !== "/") { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
  }).listen(port, () => {
    const url = `http://localhost:${port}`;
    const t = single(manifest);
    console.log(`${green("✓")} ${bold(manifest.name)} at ${cyan(url)}${t ? yellow(`  ${t} only`) : ""}  ${dim("Ctrl+C to stop")}`);
    if (tty && !args["no-open"]) spawn(process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open", process.platform === "win32" ? ["/c", "start", "", url] : [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  }).on("error", (e) => die(e.code === "EADDRINUSE" ? `Port ${port} is in use.` : e.message, `Try npx aurb preview ${target} --port ${port + 1}`));
}

// ------------------------------------------------------------------ making an orb

function ffmpeg() {
  for (const bin of [process.env.FFMPEG, "ffmpeg"].filter(Boolean)) {
    const r = spawnSync(bin, ["-hide_banner", "-encoders"], { encoding: "utf8", maxBuffer: 1 << 24 });
    if (r.stdout?.includes("libx264") && r.stdout.includes("libvpx-vp9")) return bin;
  }
  const how = process.platform === "win32" ? "winget install ffmpeg" : process.platform === "darwin" ? "brew install ffmpeg" : "sudo apt install ffmpeg";
  die("Packing needs ffmpeg with libx264 and libvpx-vp9.", `Install it with ${how}, or set FFMPEG to its path`);
}

// Square size and length, read from ffmpeg's own report. Null if ffmpeg can't read it.
function probe(bin, file) {
  const err = spawnSync(bin, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr ?? "";
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(err), s = /, (\d{2,5})x(\d{2,5})[,\s]/.exec(err);
  return d && s ? { seconds: +d[1] * 3600 + +d[2] * 60 + +d[3], w: +s[1], h: +s[2] } : null;
}

// Tiny sizes are compressed harder, where nobody can see it; the same curve the built-in orbs use.
const crfFor = (size) => 21 + (size <= 100 ? 5 : size <= 200 ? 2 : size <= 400 ? 0 : -2);

async function pack(src, args) {
  const name = String(args.name === true ? "" : args.name ?? "").toLowerCase();
  if (!src || !NAME.test(name)) die("Pack needs a folder of loops and a name.", "npx aurb pack ./loops --name nebula  (lowercase letters, digits and -)");
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) die(`There's no folder ${src}.`, "Point it at the folder holding idle-dark.mp4 and the rest");
  const out = path.resolve(option(args, "out") ?? "orbs", name);
  if (out === path.resolve(src)) die("--out can't be the folder of loops.", "Leave out --out, or choose another folder");
  const bin = ffmpeg();
  const sizes = args.xl ? [...SIZES, 640] : SIZES;
  const files = fs.readdirSync(src).filter((f) => fs.statSync(path.join(src, f)).isFile() && !f.startsWith("."));
  const loops = {}, problems = [], warnings = [];
  const byName = {};
  for (const f of files) (byName[path.parse(f).name] ??= []).push(f);
  // Only dark loops, or only light ones, is an orb for that theme alone. Some of each is a mistake.
  const themes = THEMES.filter((t) => STATES.some((s) => byName[`${s}-${t}`]));
  if (!themes.length) die(`There are no loops in ${src}.`, `Name them like idle-dark.mp4 and idle-light.mov, one per state: ${STATES.join(", ")}`);
  for (const [base, fs_] of Object.entries(byName)) {
    const m = /^(.+)-(dark|light)$/.exec(base);
    if (m && !STATES.includes(m[1])) warnings.push(`${fs_[0]} isn't a state, so it's left out${STATES.find((s) => s.startsWith(m[1].slice(0, 3))) ? ` (did you mean ${STATES.find((s) => s.startsWith(m[1].slice(0, 3)))}-${m[2]}?)` : ""}`);
    if (m && STATES.includes(m[1]) && fs_.length > 1) problems.push(`${fs_.join(" and ")} are both ${base}: keep one`);
  }
  // Some loops in a theme, but not all, is a mistake either way: say which, and both ways to fix it.
  if (themes.length === 2) for (const t of THEMES) {
    const got = STATES.filter((s) => byName[`${s}-${t}`]);
    if (got.length < STATES.length && got.length <= STATES.length / 2) {
      const o = THEMES.find((x) => x !== t);
      die(`There are ${t} loops for ${got.join(", ")} only.`, `Add the other ${STATES.length - got.length} for an orb in both themes, or remove those for an orb in ${o} only`);
    }
  }
  for (const state of STATES) for (const theme of themes) {
    const f = byName[`${state}-${theme}`]?.[0];
    if (!f) { problems.push(`missing ${state}-${theme}`); continue; }
    const info = probe(bin, path.join(src, f));
    if (!info) { problems.push(`ffmpeg can't read ${f}`); continue; }
    loops[`${state}-${theme}`] = { file: path.join(src, f), ...info };
  }
  const all = Object.values(loops);
  for (const [k, l] of Object.entries(loops)) {
    if (l.w !== l.h) problems.push(`${k} is ${l.w}x${l.h}, not square`);
    if (l.w < sizes.at(-1)) problems.push(`${k} is ${l.w}px; it needs at least ${sizes.at(-1)}px${args.xl ? " for --xl" : ""}`);
    if (l.seconds < 0.5) problems.push(`${k} is ${l.seconds}s; a loop needs at least half a second`);
    if (all.length && Math.abs(l.seconds - all[0].seconds) > 0.05) problems.push(`${k} is ${l.seconds}s, the others ${all[0].seconds}s: every state must be the same length, so they stay in step`);
  }
  for (const w of warnings) console.log(`${yellow("!")} ${w}`);
  if (problems.length) die(`The loops in ${src} aren't ready:\n  ${problems.join("\n  ")}`, `Every state needs a loop for each theme: dark on black, light on white, named like idle-dark.mp4.`);
  if (themes.length === 1) console.log(yellow(`${themes[0] === "dark" ? "Dark" : "Light"} only: there are no ${themes[0] === "dark" ? "light" : "dark"} loops, so this orb is for ${themes[0]} backgrounds alone.`));

  fs.mkdirSync(out, { recursive: true });
  // A packed folder holds only this pack: files from an earlier one, such as another theme or size, would ship too.
  for (const f of fs.readdirSync(out)) if (OUTPUT.test(f)) fs.rmSync(path.join(out, f));
  const kb = {}, jobs = [];
  for (const [k, l] of Object.entries(loops)) for (const size of sizes) {
    const vf = `scale=${size}:${size}:flags=lanczos:out_color_matrix=bt709,format=yuv420p`;
    const crf = crfFor(size);
    jobs.push([`${k}-${size}.mp4`, ["-i", l.file, "-an", "-vf", vf, "-r", "24", "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", String(crf), "-movflags", "+faststart"]]);
    jobs.push([`${k}-${size}.webm`, ["-i", l.file, "-an", "-vf", vf, "-r", "24", "-c:v", "libvpx-vp9", "-crf", String(crf + 13), "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2"]]);
    if (k.startsWith("idle-")) jobs.push([`poster-${k.slice(5)}-${size}.jpg`, ["-i", l.file, "-frames:v", "1", "-vf", `scale=${size}:${size}:flags=lanczos`, "-q:v", "3"]]);
  }
  let n = 0;
  const run = (job) => new Promise((res, rej) => {
    const [f, a] = job;
    const p = spawn(bin, ["-y", "-loglevel", "error", ...a, path.join(out, f)]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", rej);
    p.on("close", (code) => {
      if (code) return rej(new Error(`ffmpeg failed on ${f}: ${err.trim().split("\n").slice(-3).join(" ")}`));
      kb[f] = Math.ceil(fs.statSync(path.join(out, f)).size / 1024);
      if (tty) process.stdout.write(`\r${dim(`Encoding ${++n} of ${jobs.length}`)}  `);
      res();
    });
  });
  const queue = [...jobs];
  const workers = Math.max(1, Math.min(4, os.cpus().length));
  await Promise.all(Array.from({ length: workers }, async () => { while (queue.length) await run(queue.shift()); })).catch((e) => die(e.message, "Fix the loop it names, then pack again"));

  const hash = createHash("sha1");
  for (const f of Object.keys(kb).sort()) hash.update(fs.readFileSync(path.join(out, f)));
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ name, version: hash.digest("hex").slice(0, 8), states: STATES, themes, sizes, kb }, null, 2) + "\n");
  // The orb is your own npm package, aurb-orb-<name>, so it carries your name and its own download counts.
  const pkgFile = path.join(out, "package.json");
  if (!fs.existsSync(pkgFile)) {
    const author = spawnSync("git", ["config", "user.name"], { encoding: "utf8" }).stdout?.trim() || undefined;
    const note = typeof args.note === "string" ? args.note : "";
    fs.writeFileSync(pkgFile, JSON.stringify({ name: `aurb-orb-${name}`, version: "1.0.0", description: note, author, keywords: ["aurb", "aurb-orb"], aurb: {} }, null, 2) + "\n");
    console.log(`\n${dim(`${note ? "" : "Add a one-line description, and "}choose a licence ("license": "MIT", say), in`)} ${pkgFile}`);
  }
  const rel = path.relative(process.cwd(), out);
  console.log(`\r${green("✓")} Packed ${bold(name)}: ${Object.keys(kb).length} files, ${(Object.values(kb).reduce((a, b) => a + b, 0) / 1024).toFixed(1)} MB in ${rel}`);
  console.log(`Try it: ${cyan(`npx aurb preview ${rel}`)}, then ${cyan(`npx aurb publish ${rel}`)}`);
}

// The files of an orb, from a folder or from its npm package on jsDelivr. Fetching every file through jsDelivr also
// keeps a copy there for good, so an approved version keeps working even if its package is later unpublished.
async function source(target) {
  const ref = NPM_REF.exec(target);
  if (!ref) {
    const dir = path.resolve(target);
    const all = fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];
    const kb = Object.fromEntries(all.filter(SHIPS).map((f) => [f, fs.statSync(path.join(dir, f)).size / 1024]));
    return { label: target, local: true, left: all.filter((f) => !SHIPS(f)), read: async (f) => (f in kb ? fs.readFileSync(path.join(dir, f)) : null), files: async () => kb };
  }
  const from = `${NPM}/${ref[1]}@${ref[2]}`, cache = {};
  const read = async (f) => (cache[f] ??= await get(`${from}/${f}`, "bytes"));
  return {
    label: `${ref[1]}@${ref[2]}`, pkg: ref[1], read,
    files: async (names) => {
      const queue = [...names], out = {};
      await Promise.all(Array.from({ length: 8 }, async () => { while (queue.length) { const f = queue.shift(), b = await read(f); if (b) out[f] = b.length / 1024; else if (b === undefined) out[f] = undefined; } }));
      return out;
    },
  };
}

// What a submission must pass, from a folder or a published package. Every problem is listed at once, each with what to do.
async function check(targets, { quiet } = {}) {
  if (!targets.length) die("Which orbs?", "npx aurb check orbs/nebula, or a published one: npx aurb check npm:aurb-orb-nebula@1.0.0");
  let failed = 0, listed;
  for (const target of targets) {
    if (target.startsWith("npm:") && !NPM_REF.test(target)) { failed++; console.log(`${red("✕")} ${bold(target)}\n  needs a package name and an exact version, such as npm:aurb-orb-nebula@1.0.0`); continue; }
    const src = await source(target), problems = [], notes = [];
    const json = async (f) => {
      const b = await src.read(f);
      if (b === undefined) { problems.push(`couldn't reach ${f}. ${OFFLINE}`); return null; }
      try { if (b) return JSON.parse(String(b)); } catch {}
      problems.push(`${f} is missing or isn't valid JSON${src.pkg ? ". Check the exact version; just published? jsDelivr can take a minute to see it" : ""}`);
      return null;
    };
    const pkg = await json("package.json"), manifest = await json("manifest.json");
    if (manifest) problems.push(...manifestProblems(manifest));
    const ok = manifest && !manifestProblems(manifest).length;
    const name = manifest?.name ?? path.basename(path.resolve(target));
    if (pkg) {
      if (pkg.name !== `aurb-orb-${name}` && pkg.name !== `@aurb/${name}`) problems.push(`package.json name should be "aurb-orb-${name}", after the orb's name in manifest.json`);
      if (src.pkg && pkg.name !== src.pkg) problems.push(`package.json says ${pkg.name}, but this is ${src.pkg}`);
      if (typeof pkg.description !== "string" || !pkg.description.trim() || pkg.description.length > 160) problems.push("package.json needs a description of one short sentence");
      if (/[–—]/.test(pkg.description ?? "")) problems.push("the description has a long dash; use a comma or a colon");
      if (pkg.aurb !== undefined && (typeof pkg.aurb !== "object" || (pkg.aurb.fade !== undefined && pkg.aurb.fade !== "rest"))) problems.push(`package.json aurb.fade is "rest" or left out`);
      if (pkg.aurb?.fade === "rest" && manifest && !manifest.rest) problems.push(`package.json says fade "rest", but manifest.json has no rest: render the rest sheets, or remove fade`);
      if (pkg.private) problems.push("package.json says private: an orb has to be public");
      // A licence: a name such as MIT, or "SEE LICENSE IN <file>" with that file alongside.
      const see = /^SEE LICEN[CS]E IN (.+)$/i.exec(pkg.license ?? "");
      if (!pkg.license) problems.push(`package.json needs a licence, such as "license": "MIT"`);
      else if (see && !(await src.read(see[1].trim()))) problems.push(`package.json points to ${see[1].trim()} for its licence, which isn't here${pkg.name.startsWith("@aurb/") ? ": copy in the aurb Orb Licence" : ""}`);
    }
    let total = 0;
    if (ok) {
      const needed = expected(manifest);
      const files = await src.files([...new Set([...needed, ...Object.keys(manifest.kb)])]);
      const missing = needed.filter((f) => !(f in files)), unreachable = Object.keys(files).filter((f) => files[f] === undefined);
      if (unreachable.length) problems.push(`couldn't reach ${unreachable.length} files. ${OFFLINE}`);
      for (const f of missing) problems.push(`missing ${f}`);
      for (const f of Object.keys(manifest.kb)) if (!needed.includes(f) && !(f in files)) problems.push(`manifest.json lists ${f}, which is missing`);
      const has = manifest.themes ?? THEMES;
      if (has.length === 1 && Object.keys(files).some((f) => f.includes(`-${THEMES.find((t) => t !== has[0])}-`))) problems.push(`manifest.json says ${has[0]} only, but there are ${THEMES.find((t) => t !== has[0])} files: pack it again`);
      for (const [f, kb] of Object.entries(files)) {
        if (kb === undefined) continue;
        total += kb;
        if (kb > MAX_FILE_KB) problems.push(`${f} is ${Math.round(kb)} KB; keep every file under ${MAX_FILE_KB} KB (a shorter loop, or less detail)`);
      }
      if (total / 1024 > MAX_ORB_MB) problems.push(`the orb is ${(total / 1024).toFixed(1)} MB; keep it under ${MAX_ORB_MB} MB`);
      if (has.length === 1) notes.push(`${has[0]} only`);
    }
    if (src.left?.length) notes.push(`not published: ${src.left.slice(0, 5).join(", ")}${src.left.length > 5 ? ` and ${src.left.length - 5} more` : ""}`);
    // A community orb's name must be free, or already this package's. The list is a courtesy when offline.
    if (manifest && NAME.test(name) && !pkg?.name?.startsWith("@aurb/")) {
      listed ??= await index({ soft: true });
      const taken = listed?.find((o) => o.name === name);
      if (taken && taken.package !== (src.pkg ?? pkg?.name)) problems.push(`the name "${name}" is taken; choose another in manifest.json and package.json`);
      if (!listed) notes.push("couldn't load the list, so the name wasn't checked");
    }
    if (problems.length) { failed++; console.log(`${red("✕")} ${bold(src.label)}\n  ${problems.slice(0, 20).join("\n  ")}${problems.length > 20 ? `\n  and ${problems.length - 20} more` : ""}`); }
    else if (!quiet || notes.length) console.log(`${green("✓")} ${bold(src.label)}  ${dim([`${(total / 1024).toFixed(1)} MB`, ...notes].join(", "))}`);
  }
  if (failed) die(`${failed} of ${targets.length} not ready.`, "Fix the lines above, then run npx aurb check again");
}

// npm, with arguments that survive a Windows shell. A publish talks to you directly, so npm can show its sign-in link
// or ask for a 2FA code.
function npm(args, { talk } = {}) {
  const win = process.platform === "win32";
  const a = win ? args.map((x) => (/[\s"&|<>^]/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x)) : args;
  const r = spawnSync("npm", a, { encoding: "utf8", shell: win, stdio: talk ? "inherit" : "pipe" });
  if (r.error) die("Couldn't run npm.", "Install Node.js, which comes with npm, from nodejs.org");
  return r;
}

const semver = (v) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? "")?.slice(1).map(Number);
const newer = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

// Publishes a packed orb as its own npm package. A version is never edited by hand: changed files go up one patch from
// what npm has, unless package.json asks for a higher one, and unchanged files publish nothing. Only the orb's own
// files are published, from a copy, so the folder never changes.
async function publish(dir, args) {
  if (!dir || !fs.existsSync(path.join(dir, "package.json"))) die("Which orb folder?", "npx aurb publish orbs/nebula, after npx aurb pack");
  await check([dir]);
  const dry = !!args["dry-run"];
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const name = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).name;
  const own = semver(pkg.version);
  if (!own) die(`package.json version "${pkg.version}" should be like 1.0.0.`);
  const ships = fs.readdirSync(dir).filter((f) => SHIPS(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
  const hash = createHash("sha1");
  for (const f of ships.filter((f) => f !== "package.json")) hash.update(f).update(fs.readFileSync(path.join(dir, f)));
  const digest = hash.digest("hex").slice(0, 12);

  const view = npm(["view", pkg.name, "version", "aurb.hash", "--json"]);
  let now = null;
  if (view.status) {
    if (!/E404|404 Not Found/.test(view.stderr)) die(`Couldn't ask npm about ${pkg.name}.`, (view.stderr.trim().split("\n").find((l) => /npm error (?!A complete)/.test(l)) ?? OFFLINE).replace(/^npm error /, ""));
  } else { try { now = JSON.parse(view.stdout || "null"); } catch {} }
  const version = typeof now === "string" ? now : now?.version;
  const use = (v) => (pkg.name.startsWith("@aurb/") ? `orb="${name}"` : `orb="npm:${pkg.name}@${v}"`);
  if (version && now?.["aurb.hash"] === digest) return console.log(`${green("✓")} ${pkg.name}@${version} already has these files. ${dim(use(version))}`);
  const latest = semver(version);
  if (version && !latest) die(`npm has ${pkg.name}@${version}, which isn't like 1.0.0.`, "Set a higher version in package.json");
  const bumped = latest && [latest[0], latest[1], latest[2] + 1];
  const next = (!bumped || newer(own, bumped) ? own : bumped).join(".");
  if (dry) return console.log(`Would publish ${bold(`${pkg.name}@${next}`)}: ${ships.length} files  ${dim(use(next))}`);

  if (!process.env.GITHUB_ACTIONS && npm(["whoami"]).status) die("You're not logged in to npm.", "Run npm login, then try again");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aurb-"));
  try {
    for (const f of ships) fs.copyFileSync(path.join(dir, f), path.join(tmp, f));
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ ...pkg, version: next, aurb: { ...pkg.aurb, hash: digest } }, null, 2));
    console.log(`Publishing ${bold(`${pkg.name}@${next}`)}`);
    const provenance = process.env.GITHUB_ACTIONS && process.env.ACTIONS_ID_TOKEN_REQUEST_URL ? ["--provenance"] : [];
    const r = npm(["publish", tmp, "--access", "public", ...provenance], { talk: true });
    if (r.status) die(`npm couldn't publish ${pkg.name}@${next}.`, `See npm's message above. ${pkg.name.startsWith("@aurb/") ? "Publishing to @aurb needs a member of the npm org" : "Is the name free on npm? If not, choose another orb name"}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${green("✓")} Published ${bold(`${pkg.name}@${next}`)}. Anyone can use it now: ${cyan(use(next))}`);
  console.log(dim("jsDelivr can take a minute to see a new version."));
  if (!pkg.name.startsWith("@aurb/")) console.log(dim(`To list it on the site and in npx aurb, submit npm:${pkg.name}@${next} at ${LIST}`));
}

const args = parseArgs(process.argv.slice(2));
const [command, target, ...more] = args._;
try {
  if (args.help || command === "help") console.log(HELP);
  else if (!command) await pick(args);
  else if (command === "add") await add(target, args);
  else if (command === "list" || command === "ls") await list(args);
  else if (command === "preview") await preview(target, args);
  else if (command === "download") await download(target, args);
  else if (command === "pack") await pack(target, args);
  else if (command === "check") await check([target, ...more].filter(Boolean));
  else if (command === "publish") await publish(target, args);
  else if ((NAME.test(command) || NPM_REF.test(command)) && !target) await add(command, args); // npx aurb aurora
  else die(`Unknown command "${command}".`, "Run npx aurb --help");
} catch (e) {
  die(`Something went wrong: ${e.message}`, `Please report it, with the command you ran: https://github.com/chalktalkhq/aurb/issues`);
}
