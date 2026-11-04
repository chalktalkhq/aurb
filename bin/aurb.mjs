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
const THEMES = ["dark", "light"];
const SIZES = [80, 160, 320];
const MAX_FILE_KB = 2048, MAX_ORB_MB = 120; // jsDelivr serves packages up to 150 MB; the 640px files are most of an orb
const tty = process.stdout.isTTY && process.stdin.isTTY;
const paint = (code) => (s) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint(1), dim = paint(2), green = paint(32), red = paint(31), cyan = paint(36);

const HELP = `${bold("aurb")}: animated orbs for AI products

  ${cyan("npx aurb")}                       pick an orb and get its code
  ${cyan("npx aurb add")} aurora            the code for one orb  ${dim("--html  --state thinking  --json")}
  ${cyan("npx aurb list")}                  every orb  ${dim("--json")}
  ${cyan("npx aurb preview")} aurora        play it in your browser, every state  ${dim("--port 4300")}
  ${cyan("npx aurb download")} aurora       save the files to host yourself  ${dim("--out public/orbs")}

Making an orb
  ${cyan("npx aurb pack")} ./loops --name nebula   encode your loops into an orb  ${dim('--note "..."  --xl  --out orbs')}
  ${cyan("npx aurb preview")} orbs/nebula        try it before you share it
  ${cyan("npx aurb check")} orbs/nebula          the check a submission runs  ${dim("also npm:aurb-orb-nebula@1.0.0")}
  ${cyan("npx aurb publish")} orbs/nebula        publish it to npm as your own package  ${dim("--dry-run")}

  ./loops holds one seamless, square loop per state and theme, named like idle-dark.mp4 and idle-light.mov:
  ${STATES.join(", ")}; dark on black, light on white, all the same length.
  Anyone can use it once it's published, as orb="npm:aurb-orb-nebula@1.0.0". To get it listed: ${LIST}
`;

function die(msg, fix) {
  console.error(`${red("✕")} ${msg}${fix ? `\n  ${fix}` : ""}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const [k, v] = a.slice(2).split("=");
    const flag = ["html", "react", "json", "xl", "help", "no-open", "dry-run"].includes(k); // these never take a value
    out[k] = v ?? (!flag && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true);
  }
  return out;
}

async function index() {
  try {
    if (!/^https?:/.test(INDEX)) return JSON.parse(fs.readFileSync(INDEX, "utf8")); // a local list, for trying orbs before they're published
    const r = await fetch(INDEX);
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } catch (e) {
    die(`Couldn't load the list of orbs (${e.message}).`, `Check your connection, or open ${INDEX}`);
  }
}

// What goes in orb="...": a name for our own @aurb orbs, which follow 1.x, and the exact approved version of a
// community orb's own package, so nobody gets an update that hasn't been reviewed.
const value = (o) => (o.package ? `npm:${o.package}@${o.version}` : o.name);
// Where its files are on jsDelivr: the same URL the player builds from that value.
const base = (o) => (o.package ? `${NPM}/${o.package}@${o.version}` : `${NPM}/@aurb/${o.name}@1`);
const NPM_REF = /^npm:((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)@(\d+\.\d+\.\d+[\w.+-]*)$/i;

async function get(url, as = "json") {
  const r = await fetch(url).catch((e) => ({ ok: false, status: e.message }));
  if (!r.ok) return null;
  return as === "json" ? r.json().catch(() => null) : Buffer.from(await r.arrayBuffer());
}

async function find(name) {
  const ref = NPM_REF.exec(name); // a package nobody has listed yet, such as one under review
  if (ref) {
    const manifest = await get(`${NPM}/${ref[1]}@${ref[2]}/manifest.json`);
    if (!manifest) die(`${ref[1]}@${ref[2]} has no manifest.json on jsDelivr.`, "Check the package name and its exact version");
    const pkg = (await get(`${NPM}/${ref[1]}@${ref[2]}/package.json`)) ?? {};
    return { name: manifest.name, description: pkg.description ?? "", author: pkg.author, package: ref[1], version: ref[2], ...pkg.aurb };
  }
  if (name.startsWith("npm:")) die(`${name} needs an exact version.`, "Such as npm:aurb-orb-nebula@1.0.0");
  const orbs = await index();
  const orb = orbs.find((o) => o.name === name);
  if (!orb) {
    const near = orbs.filter((o) => o.name.startsWith(name[0])).map((o) => o.name);
    die(`There's no orb called "${name}".`, near.length ? `Did you mean ${near.join(", ")}? Or run npx aurb list` : "Run npx aurb list to see them all");
  }
  return orb;
}

// ------------------------------------------------------------------ the code a developer pastes

function snippet(orb, { html, state = "idle" }) {
  const rest = orb.fade === "rest";
  // rest extends the module build, so a solid orb loads the player as modules rather than the global script.
  const dist = "https://cdn.jsdelivr.net/npm/aurb/dist";
  if (html) return `${rest ? `<script type="module" src="${dist}/aurb.js"></script>\n<script type="module" src="${dist}/rest.js"></script>` : `<script src="${dist}/aurb.global.js" defer></script>`}

<aurb-orb orb="${value(orb)}" state="${state}"${rest ? ' transition="rest"' : ""} style="width:120px"></aurb-orb>`;
  return `import { Aurb } from "aurb/react";${rest ? '\nimport "aurb/rest";' : ""}

<Aurb orb="${value(orb)}" state="${state}"${rest ? ' transition="rest"' : ""} style={{ width: 120 }} />`;
}

function copy(text) {
  const tools = process.platform === "win32" ? [["clip"]] : process.platform === "darwin" ? [["pbcopy"]] : [["wl-copy"], ["xclip", "-selection", "clipboard"]];
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

function give(orb, opts) {
  const code = snippet(orb, opts);
  if (opts.json) return console.log(JSON.stringify({ ...orb, orb: value(orb), code, install: opts.html ? null : "npm i aurb" }, null, 2));
  if (!tty) return console.log(code);
  const install = opts.html ? null : installHint();
  const copied = copy(code);
  console.log(`\n${code.split("\n").map((l) => `  ${l}`).join("\n")}\n`);
  console.log(copied ? `${green("✓")} Copied to your clipboard.` : dim("Select the code above to copy it."));
  if (install) console.log(`${dim("First, in this project:")} ${cyan(install)}`);
  console.log(dim(`See every state: npx aurb preview ${orb.package ? value(orb) : orb.name}\n`));
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

async function pick(args) {
  if (!tty) return console.log(HELP);
  const orbs = await index();
  const width = Math.max(...orbs.map((o) => o.name.length));
  const orb = await choose("Orb", orbs, { label: (o) => o.name.padEnd(width), hint: (o) => o.description });
  const kinds = ["React", "HTML"];
  const kind = await choose("For", kinds, { label: (k) => k, hint: (k) => (k === "React" ? "a typed component" : "a script tag, no build step"), start: usesReact() || args.react ? 0 : 1 });
  give(orb, { html: kind === "HTML", state: args.state });
}

// ------------------------------------------------------------------ list, add, download

async function list(args) {
  const orbs = await index();
  if (args.json || !process.stdout.isTTY) return console.log(args.json ? JSON.stringify(orbs, null, 2) : orbs.map((o) => o.name).join("\n"));
  const width = Math.max(...orbs.map((o) => o.name.length));
  console.log(`${bold(`${orbs.length} orbs`)}, all free\n`);
  for (const o of orbs) console.log(`  ${cyan(o.name.padEnd(width))}  ${o.description}${o.author ? dim(`  by ${o.author}`) : ""}`);
  console.log(dim(`\nnpx aurb add <name> for its code, npx aurb preview <name> to see it`));
}

async function add(name, args) {
  if (!name) return pick(args);
  give(await find(name), { html: !!args.html, state: args.state, json: args.json });
}

async function download(name, args) {
  if (!name) die("Which orb?", "npx aurb download aurora");
  const orb = await find(name), from = base(orb);
  const manifest = await get(`${from}/manifest.json`);
  if (!manifest) die(`Couldn't download ${orb.name}'s manifest.json.`, "Try again in a minute");
  const out = path.resolve(String(args.out ?? "orbs"), orb.name);
  fs.mkdirSync(out, { recursive: true });
  const files = ["manifest.json", ...Object.keys(manifest.kb)];
  let n = 0;
  for (const f of files) {
    const r = await fetch(`${from}/${f}`);
    if (!r.ok) die(`Couldn't download ${f} (${r.status}).`, "Try again in a minute");
    fs.writeFileSync(path.join(out, f), Buffer.from(await r.arrayBuffer()));
    if (tty) process.stdout.write(`\r${dim(`Downloading ${++n} of ${files.length}`)}`);
  }
  const rel = path.relative(process.cwd(), out).split(path.sep).join("/");
  console.log(`\r${green("✓")} Saved ${files.length} files to ${rel}`);
  console.log(`Serve that folder with your site, then use ${cyan(`orb="/${rel.replace(/^public\//, "")}"`)}, the URL it is served at.`);
}

// ------------------------------------------------------------------ preview

// Serves the player and a page that plays the orb, from a local folder or from the CDN by name.
async function preview(target, args) {
  if (!target) die("Which orb?", "npx aurb preview aurora, a folder: npx aurb preview orbs/nebula, or a package: npm:aurb-orb-nebula@1.0.0");
  const port = Number(args.port ?? 4300);
  const local = fs.existsSync(path.join(target, "manifest.json")) ? path.resolve(target) : null;
  let manifest, orb;
  if (local) {
    manifest = JSON.parse(fs.readFileSync(path.join(local, "manifest.json"), "utf8"));
    orb = `http://localhost:${port}/o`;
  } else {
    if (fs.existsSync(target)) die(`${target} has no manifest.json.`, "Make one with npx aurb pack");
    orb = base(await find(target));
    manifest = await get(`${orb}/manifest.json`);
    if (!manifest) die(`Couldn't load ${target}'s manifest.json.`, "Try again in a minute");
  }
  const dist = path.join(here, "..", "dist");
  if (!fs.existsSync(path.join(dist, "aurb.js"))) die("The player isn't built.", "Run npm run build in the aurb repo");
  const page = fs.readFileSync(path.join(here, "preview.html"), "utf8").replaceAll("__NAME__", manifest.name).replaceAll("__ORB__", orb)
    .replace("__STATES__", JSON.stringify(manifest.states)).replace("__REST__", JSON.stringify(!!manifest.rest)).replace("__KB__", JSON.stringify(manifest.kb)).replaceAll("__SIZES__", manifest.sizes.join(","));
  const TYPES = { webm: "video/webm", mp4: "video/mp4", jpg: "image/jpeg", js: "text/javascript" };
  http.createServer((req, res) => {
    const media = local && /^\/o\/([\w-]+\.(webm|mp4|jpg))$/.exec(req.url);
    const js = /^\/(aurb|rest|shared)\.js$/.test(req.url) && path.join(dist, req.url);
    const f = media ? path.join(local, media[1]) : js;
    if (f) {
      const ok = fs.existsSync(f);
      res.writeHead(ok ? 200 : 404, { "content-type": TYPES[path.extname(f).slice(1)] });
      return res.end(ok ? fs.readFileSync(f) : "");
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page);
  }).listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`${green("✓")} ${bold(manifest.name)} at ${cyan(url)}  ${dim("Ctrl+C to stop")}`);
    if (tty && !args["no-open"]) spawn(process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open", process.platform === "win32" ? ["/c", "start", "", url] : [url], { stdio: "ignore", detached: true }).unref();
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

// Square size and length, read from ffmpeg's own report.
function probe(bin, file) {
  const err = spawnSync(bin, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr;
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(err), s = /, (\d{2,5})x(\d{2,5})[,\s]/.exec(err);
  if (!d || !s) die(`ffmpeg can't read ${path.basename(file)}.`);
  return { seconds: +d[1] * 3600 + +d[2] * 60 + +d[3], w: +s[1], h: +s[2] };
}

// Tiny sizes are compressed harder, where nobody can see it; the same curve the built-in orbs use.
const crfFor = (size) => 21 + (size <= 100 ? 5 : size <= 200 ? 2 : size <= 400 ? 0 : -2);

async function pack(src, args) {
  const name = String(args.name ?? "").toLowerCase();
  if (!src || !/^[a-z][a-z0-9-]{1,30}$/.test(name)) die("Pack needs a folder of loops and a name.", "npx aurb pack ./loops --name nebula  (lowercase letters, digits and -)");
  const bin = ffmpeg();
  const sizes = args.xl ? [...SIZES, 640] : SIZES;
  const files = fs.readdirSync(src);
  const loops = {}, problems = [];
  for (const state of STATES) for (const theme of THEMES) {
    const f = files.find((x) => path.parse(x).name === `${state}-${theme}`);
    if (!f) { problems.push(`missing ${state}-${theme}`); continue; }
    loops[`${state}-${theme}`] = { file: path.join(src, f), ...probe(bin, path.join(src, f)) };
  }
  const all = Object.values(loops);
  for (const [k, l] of Object.entries(loops)) {
    if (l.w !== l.h) problems.push(`${k} is ${l.w}x${l.h}, not square`);
    if (l.w < sizes.at(-1)) problems.push(`${k} is ${l.w}px; it needs at least ${sizes.at(-1)}px`);
    if (all.length && Math.abs(l.seconds - all[0].seconds) > 0.05) problems.push(`${k} is ${l.seconds}s, the others ${all[0].seconds}s: every state must be the same length, so they stay in step`);
  }
  if (problems.length) die(`The loops in ${src} aren't ready:\n  ${problems.join("\n  ")}`, "Every state needs a dark loop (on black) and a light one (on white), named like idle-dark.mp4.");

  const out = path.resolve(String(args.out ?? "orbs"), name);
  fs.mkdirSync(out, { recursive: true });
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
    p.on("close", (code) => {
      if (code) return rej(new Error(`ffmpeg failed on ${f}: ${err}`));
      kb[f] = Math.ceil(fs.statSync(path.join(out, f)).size / 1024);
      if (tty) process.stdout.write(`\r${dim(`Encoding ${++n} of ${jobs.length}`)}  `);
      res();
    });
  });
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await run(queue.shift()); })).catch((e) => die(e.message));

  const hash = createHash("sha1");
  for (const f of Object.keys(kb).sort()) hash.update(fs.readFileSync(path.join(out, f)));
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ name, version: hash.digest("hex").slice(0, 8), states: STATES, themes: THEMES, sizes, kb }, null, 2) + "\n");
  // The orb is your own npm package, aurb-orb-<name>, so it carries your name and its own download counts.
  const pkgFile = path.join(out, "package.json");
  if (!fs.existsSync(pkgFile)) {
    const author = spawnSync("git", ["config", "user.name"], { encoding: "utf8" }).stdout?.trim() || undefined;
    const note = args.note ? String(args.note) : "";
    fs.writeFileSync(pkgFile, JSON.stringify({ name: `aurb-orb-${name}`, version: "1.0.0", description: note, author, keywords: ["aurb", "aurb-orb"], aurb: {} }, null, 2) + "\n");
    console.log(`\n${dim(`${note ? "" : "Add a one-line description, and "}choose a licence, in`)} ${pkgFile}`);
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
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];
    return { label: target, read: (f) => fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f)) : null, files: async () => Object.fromEntries(files.map((f) => [f, fs.statSync(path.join(dir, f)).size / 1024])) };
  }
  const from = `${NPM}/${ref[1]}@${ref[2]}`, cache = {};
  const read = async (f) => (cache[f] ??= await get(`${from}/${f}`, "bytes"));
  return {
    label: `${ref[1]}@${ref[2]}`, pkg: ref[1], read,
    files: async (names) => {
      const queue = [...names], out = {};
      await Promise.all(Array.from({ length: 8 }, async () => { while (queue.length) { const f = queue.shift(), b = await read(f); if (b) out[f] = b.length / 1024; } }));
      return out;
    },
  };
}

// What a submission must pass, from a folder or a published package. Every problem is listed at once, each with what to do.
async function check(targets) {
  if (!targets.length) die("Which orbs?", "npx aurb check orbs/nebula, or a published one: npx aurb check npm:aurb-orb-nebula@1.0.0");
  let failed = 0;
  for (const target of targets) {
    if (target.startsWith("npm:") && !NPM_REF.test(target)) { failed++; console.log(`${red("✕")} ${bold(target)}\n  needs an exact version, such as npm:aurb-orb-nebula@1.0.0`); continue; }
    const src = await source(target), problems = [];
    const json = async (f) => {
      const b = await src.read(f);
      try { if (b) return JSON.parse(String(b)); } catch {}
      problems.push(`${f} is missing or isn't valid JSON${src.pkg ? " (is the package published at that exact version?)" : ""}`);
      return null;
    };
    const pkg = await json("package.json"), manifest = await json("manifest.json");
    const name = manifest?.name ?? path.basename(path.resolve(target));
    if (manifest && !/^[a-z][a-z0-9-]{1,30}$/.test(name)) problems.push(`manifest.json name "${name}" should be lowercase letters, digits and -`);
    if (pkg) {
      if (pkg.name !== `aurb-orb-${name}` && pkg.name !== `@aurb/${name}`) problems.push(`package.json name should be "aurb-orb-${name}", after the orb's name in manifest.json`);
      if (src.pkg && pkg.name !== src.pkg) problems.push(`package.json says ${pkg.name}, but this is ${src.pkg}`);
      if (!pkg.description || pkg.description.length > 160) problems.push("package.json needs a description of one short sentence");
      if (/[–—]/.test(pkg.description ?? "")) problems.push("the description has a long dash; use a comma or a colon");
    }
    const needed = [];
    for (const state of STATES) for (const theme of THEMES) for (const size of SIZES) for (const ext of ["webm", "mp4"]) needed.push(`${state}-${theme}-${size}.${ext}`);
    for (const theme of THEMES) for (const size of SIZES) needed.push(`poster-${theme}-${size}.jpg`);
    const files = await src.files([...new Set([...needed, ...Object.keys(manifest?.kb ?? {})])]);
    if (manifest) for (const f of needed) if (!(f in files)) problems.push(`missing ${f}`);
    for (const f of Object.keys(manifest?.kb ?? {})) if (!needed.includes(f) && !(f in files)) problems.push(`manifest.json lists ${f}, which is missing`);
    let total = 0;
    for (const [f, kb] of Object.entries(files)) {
      total += kb;
      if (kb > MAX_FILE_KB) problems.push(`${f} is ${Math.round(kb)} KB; keep every file under ${MAX_FILE_KB} KB (a shorter loop, or less detail)`);
    }
    if (total / 1024 > MAX_ORB_MB) problems.push(`the orb is ${(total / 1024).toFixed(1)} MB; keep it under ${MAX_ORB_MB} MB`);
    if (src.pkg && manifest) { // a submission: the name must be free, or already this package's
      const taken = (await index()).find((o) => o.name === name);
      if (taken && taken.package !== src.pkg) problems.push(`the name "${name}" is taken; choose another in manifest.json and package.json`);
    }
    if (problems.length) { failed++; console.log(`${red("✕")} ${bold(src.label)}\n  ${problems.slice(0, 20).join("\n  ")}${problems.length > 20 ? `\n  and ${problems.length - 20} more` : ""}`); }
    else console.log(`${green("✓")} ${bold(src.label)}  ${dim(`${(total / 1024).toFixed(1)} MB`)}`);
  }
  if (failed) die(`${failed} of ${targets.length} not ready.`, "Fix the lines above, then run npx aurb check again");
}

// Publishes a packed orb as its own npm package. A version is never edited by hand: changed files go up one patch from
// what npm has, and unchanged files publish nothing. A copy is published, so the folder never changes.
async function publish(dir, args) {
  if (!dir || !fs.existsSync(path.join(dir, "package.json"))) die("Which orb folder?", "npx aurb publish orbs/nebula, after npx aurb pack");
  await check([dir]);
  const dry = !!args["dry-run"];
  const npm = (...a) => execNpm(a);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const hash = createHash("sha1");
  for (const f of fs.readdirSync(dir).filter((f) => f !== "package.json").sort()) hash.update(f).update(fs.readFileSync(path.join(dir, f)));
  const digest = hash.digest("hex").slice(0, 12);
  let now = null;
  try { now = JSON.parse(npm("view", pkg.name, "version", "aurb.hash", "--json").stdout); } catch {} // a 404 is a new orb
  const version = typeof now === "string" ? now : now?.version;
  const name = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).name;
  const use = (v) => (pkg.name.startsWith("@aurb/") ? `orb="${name}"` : `orb="npm:${pkg.name}@${v}"`);
  if (now?.["aurb.hash"] === digest) return console.log(`${green("✓")} ${pkg.name}@${version} already has these files. ${dim(use(version))}`);
  const next = version ? version.replace(/\d+$/, (n) => +n + 1) : pkg.version;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aurb-"));
  fs.cpSync(dir, tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ ...pkg, version: next, aurb: { ...pkg.aurb, hash: digest } }, null, 2));
  if (dry) { fs.rmSync(tmp, { recursive: true, force: true }); return console.log(`Would publish ${bold(`${pkg.name}@${next}`)}  ${dim(use(next))}`); }
  console.log(`Publishing ${bold(`${pkg.name}@${next}`)}`);
  const r = npm("publish", tmp, "--access", "public", ...(process.env.CI ? ["--provenance"] : []));
  fs.rmSync(tmp, { recursive: true, force: true });
  if (r.status) die(`npm couldn't publish ${pkg.name}@${next}.`, "See npm's message above. Not logged in? Run npm login, then try again");
  console.log(`${green("✓")} Published ${bold(`${pkg.name}@${next}`)}. Anyone can use it now: ${cyan(use(next))}`);
  if (!pkg.name.startsWith("@aurb/")) console.log(dim(`To list it on the site and in npx aurb, submit npm:${pkg.name}@${next} at ${LIST}`));
}

// A publish talks to you directly, so npm can show its sign-in link or ask for a 2FA code.
function execNpm(a) {
  const r = spawnSync("npm", a, { encoding: "utf8", shell: process.platform === "win32", stdio: a[0] === "publish" ? "inherit" : "pipe" });
  if (a[0] === "view" && r.status) throw new Error(r.stderr);
  return r;
}

const args = parseArgs(process.argv.slice(2));
const [command, target, ...more] = args._;
if (args.help || command === "help") console.log(HELP);
else if (!command) await pick(args);
else if (command === "add") await add(target, args);
else if (command === "list" || command === "ls") await list(args);
else if (command === "preview") await preview(target, args);
else if (command === "download") await download(target, args);
else if (command === "pack") await pack(target, args);
else if (command === "check") await check([target, ...more].filter(Boolean));
else if (command === "publish") await publish(target, args);
else if (STATES.length && /^[a-z][a-z0-9-]*$/.test(command) && !target) await add(command, args); // npx aurb aurora
else die(`Unknown command "${command}".`, "Run npx aurb --help");
