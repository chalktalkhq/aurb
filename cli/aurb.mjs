#!/usr/bin/env node
// The aurb command. Renders orbs into your project, only the states, themes, and sizes you ask for.
// Nothing here ships to the browser.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { PRESETS } from "./presets.mjs";
import { ALIASES, GENERATOR_VERSION, STATES, STYLES, encodeStill, findFfmpeg, makeDither, parseHex, renderFrame } from "./render.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BUDGET_KB = 150; // per served file; VP9 is what most browsers download
const die = (msg) => { console.error(`\naurb: ${msg}\n`); process.exit(1); };

const HELP = `aurb: animated orbs for AI products

  aurb presets                         list the ready-made looks
  aurb add <preset> [options]          render an orb into your project
  aurb draft <preset> [options]        a fast still sheet, to judge a look first
  aurb gallery --out <folder>          a sheet of every preset

What to build (ask only for what you use; nothing else is rendered or served)
  --states idle,thinking   ${Object.keys(STATES).join(", ")}
                           also: ${Object.keys(ALIASES).join(", ")}
  --themes dark,light      which page themes
  --sizes 160,320          file sizes; the player picks the smallest that stays sharp
  --out public/aurb        where it goes; a versioned folder is made inside
  --name my-orb            folder name, when not using a preset

The look (overrides the preset)
  --style silk             ${Object.keys(STYLES).join(", ")}
  --color "#7c5cff,#22d3ee"  one or more hex colours
  --detail 1  --energy 1  --glow 1  --wobble 0.024  --softness 1  --speed 1
  --state-color error=#f97316,success=none

Encoding
  --seconds 10  --fps 24  --crf 21  --force (re-render existing files)
`;

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) { a._.push(k); continue; }
    const key = k.slice(2);
    if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) a[key] = true;
    else a[key] = argv[++i];
  }
  return a;
}

function buildConfig(args, presetName) {
  const preset = presetName ? PRESETS[presetName] : {};
  if (presetName && !preset) die(`no preset called "${presetName}". See: aurb presets`);
  const pick = (k) => args[k] ?? preset[k];
  const num = (k, d, lo, hi) => { const raw = pick(k); const v = raw === undefined ? d : Number(raw); if (!Number.isFinite(v) || v < lo || v > hi) die(`--${k} must be a number from ${lo} to ${hi}`); return v; };
  const style = pick("style") ?? "silk";
  if (!STYLES[style]) die(`unknown --style "${style}". Choose from: ${Object.keys(STYLES).join(", ")}`);
  const colors = pick("color") && pick("color") !== true ? String(pick("color")).split(",").map((s) => s.trim()).filter(Boolean) : [];
  for (const c of colors) if (!parseHex(c)) die(`"${c}" is not a hex colour like #7c5cff`);
  const stateColors = {};
  if (args["state-color"]) for (const pair of String(args["state-color"]).split(",")) {
    const [s, c] = pair.split("=");
    if (c !== "none" && !parseHex(c)) die(`"${pair}" should look like error=#f97316, or error=none to keep the orb's own colour`);
    stateColors[ALIASES[s] ?? s] = c;
  }
  return {
    style, colors, stateColors,
    detail: num("detail", 1, 0.3, 3), energy: num("energy", 1, 0.3, 2), glow: num("glow", 1, 0, 3),
    wobble: num("wobble", 0.024, 0, 0.25), softness: num("softness", 1, 0.5, 6), speed: num("speed", 1, 0.25, 3),
    // Fine moving detail is what costs bytes, so dots start lower to land inside the budget.
    seconds: num("seconds", 10, 2, 30), fps: num("fps", style === "dots" ? 20 : 24, 12, 60), crf: num("crf", style === "dots" ? 27 : 21, 10, 40),
  };
}

function parseStates(args) {
  const list = String(args.states ?? "idle,thinking").split(",").map((s) => s.trim()).filter(Boolean).map((s) => ALIASES[s] ?? s);
  for (const s of list) if (!STATES[s]) die(`unknown state "${s}". Available: ${Object.keys(STATES).join(", ")}, or: ${Object.keys(ALIASES).join(", ")}`);
  return [...new Set(["idle", ...list])]; // idle is the resting state and the source of the poster
}
function parseThemes(args) {
  const list = String(args.themes ?? "dark,light").split(",").map((s) => s.trim());
  for (const t of list) if (t !== "dark" && t !== "light") die(`--themes takes dark and/or light, not "${t}"`);
  return list;
}

const ffmpegHelp = () => `ffmpeg with libx264 and libvpx-vp9 was not found. It is only needed to render, never at runtime.
  Windows:  winget install Gyan.FFmpeg
  macOS:    brew install ffmpeg
  Linux:    sudo apt install ffmpeg
  Or point at one you have: FFMPEG=/path/to/ffmpeg aurb ...`;

function sheet(ffmpeg, cells, T, columns, file) {
  const rows = Math.ceil(cells.length / columns);
  const W = T * columns, H = T * rows, out = Buffer.alloc(W * H * 3, 128);
  cells.forEach(({ cfg, state, theme, t }, n) => {
    const frame = renderFrame(t, state, theme, { ...cfg, size: T }, makeDither(T));
    const bg = theme === "dark" ? 25 : 247, ox = (n % columns) * T, oy = Math.floor(n / columns) * T;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) for (let k = 0; k < 3; k++) {
      const f = frame[(y * T + x) * 3 + k];
      out[((y + oy) * W + x + ox) * 3 + k] = theme === "dark" ? 255 - ((255 - f) * (255 - bg)) / 255 : (f * bg) / 255;
    }
  });
  encodeStill(ffmpeg, out, W, H, file);
}

async function add(args, presetName) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) die(ffmpegHelp());
  const cfg = buildConfig(args, presetName);
  const states = parseStates(args), themes = parseThemes(args);
  const sizes = String(args.sizes ?? "160,320").split(",").map((s) => Math.round(Number(s) / 2) * 2).sort((a, b) => a - b);
  for (const s of sizes) if (!(s >= 48 && s <= 1024)) die("--sizes takes pixel sizes from 48 to 1024");
  const slug = String(args.name ?? presetName ?? "orb").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "orb";
  // The folder name is a hash of the look, so a changed orb can never be served from a stale
  // year-long cache. Adding a state or size keeps the hash and reuses the existing files.
  const hash = createHash("sha1").update(JSON.stringify([GENERATOR_VERSION, cfg])).digest("hex").slice(0, 8);
  const folder = path.resolve(String(args.out ?? "public/aurb"), `${slug}-${hash}`);
  fs.mkdirSync(folder, { recursive: true });

  const jobs = [];
  for (const size of sizes) for (const state of states) for (const theme of themes) {
    const base = path.join(folder, `${state}-${theme}-${size}`);
    if (fs.existsSync(`${base}.mp4`) && fs.existsSync(`${base}.webm`) && !args.force) continue;
    jobs.push({ ffmpeg, cfg: { ...cfg, size }, state, theme, base, poster: state === "idle" ? path.join(folder, `poster-${theme}-${size}.jpg`) : null });
  }
  const started = Date.now();
  console.log(`Rendering ${jobs.length} loop(s), ${Math.round(cfg.seconds * cfg.fps)} frames each...`);
  const results = [], failures = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(os.cpus().length - 1, jobs.length)) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      await new Promise((res) => {
        const w = new Worker(new URL("./render.mjs", import.meta.url), { workerData: job });
        w.once("message", (m) => { if (m.ok) { results.push(m.ok); console.log(`  ${m.ok.state}-${m.ok.theme}-${m.ok.size}: ${m.ok.webmKb} KB VP9, ${m.ok.kb} KB H.264`); } else failures.push(m.err); });
        w.once("error", (e) => failures.push(String(e)));
        w.once("exit", res);
      });
    }
  }));
  if (failures.length) die(failures.join("\n"));

  const warnings = [];
  for (const r of results) {
    const name = `${r.state}-${r.theme}-${r.size}`;
    if (r.seam > 2.5) warnings.push(`${name}: the loop may visibly jump (seam is ${r.seam}x a normal frame step)`);
    if (r.rim > 1) warnings.push(`${name}: the frame edge is not clean (${r.rim}/255 off), a faint disc will show. Reduce --glow or --energy.`);
    if (r.webmKb > BUDGET_KB) warnings.push(`${name}: ${r.webmKb} KB is over the ${BUDGET_KB} KB budget. Try --crf ${cfg.crf + 3} or a lower --detail.`);
  }

  // Everything the preview needs travels with the orb, so it opens by double-clicking.
  fs.copyFileSync(path.join(here, "..", "dist", "aurb.global.js"), path.join(folder, "aurb.global.js"));
  const kbOf = Object.fromEntries(fs.readdirSync(folder).filter((f) => /\.(mp4|webm|jpg)$/.test(f)).map((f) => [f, Math.round(fs.statSync(path.join(folder, f)).size / 1024)]));
  const allSizes = [...new Set(Object.keys(kbOf).map((f) => /-(\d+)\.\w+$/.exec(f)?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);
  const allStates = [...new Set(Object.keys(kbOf).filter((f) => !f.startsWith("poster")).map((f) => f.split("-")[0]))];
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name: slug, version: hash, generator: GENERATOR_VERSION, states: allStates, themes, sizes: allSizes, config: cfg, kb: kbOf }, null, 2));
  const tpl = fs.readFileSync(path.join(here, "..", "assets", "preview.html"), "utf8");
  fs.writeFileSync(path.join(folder, "preview.html"), tpl.replaceAll("__NAME__", slug).replace("__STATES__", JSON.stringify(allStates)).replace("__KB__", JSON.stringify(kbOf)).replaceAll("__SIZES__", allSizes.join(",")));

  const rel = path.relative(process.cwd(), folder).replaceAll("\\", "/");
  const web = rel.startsWith("..") ? `/your-static-path/${slug}-${hash}` : "/" + rel.replace(/^(public|static|assets)\//, "");
  const sizeAttr = allSizes.join(",") === "160,320" ? "" : ` sizes="${allSizes.join(",")}"`;
  const other = allStates.filter((s) => s !== "idle");
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s.`);
  console.log(`See it: ${path.join(folder, "preview.html")}`);
  if (warnings.length) console.log(`\nWARNINGS:\n  ${warnings.join("\n  ")}`); else if (results.length) console.log("Checks passed: seamless loops, clean edges, within budget.");
  console.log(`\nUse it:\n  import "aurb";\n  <aurb-orb src="${web}" state="idle"${other.length ? ` prefetch="${other.join(",")}"` : ""}${sizeAttr} style="width:120px"></aurb-orb>\n  document.querySelector("aurb-orb").state = "${other[0] ?? "idle"}";`);
}

function draft(args, presetName) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) die(ffmpegHelp());
  const cfg = buildConfig(args, presetName), states = parseStates(args), themes = parseThemes(args);
  const out = path.resolve(String(args.out ?? "."));
  fs.mkdirSync(out, { recursive: true });
  const cells = themes.flatMap((theme) => [0.1, 0.45].flatMap((t) => states.map((state) => ({ cfg, state, theme, t }))));
  const file = path.join(out, `draft-${presetName ?? args.name ?? "orb"}.png`);
  sheet(ffmpeg, cells, 240, states.length, file);
  console.log(`Draft: ${file}\nColumns: ${states.join(", ")}\nRows: ${themes.flatMap((t) => [t, t]).join(", ")} (two moments each)`);
}

function gallery(args) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) die(ffmpegHelp());
  const out = path.resolve(String(args.out ?? "."));
  fs.mkdirSync(out, { recursive: true });
  const names = Object.keys(PRESETS);
  const cells = ["dark", "light"].flatMap((theme) => names.map((n) => ({ cfg: buildConfig({}, n), state: "idle", theme, t: 0.3 })));
  const file = path.join(out, "gallery.png");
  sheet(ffmpeg, cells, 200, names.length, file);
  console.log(`Gallery: ${file}\nColumns: ${names.join(", ")}`);
}

const args = parseArgs(process.argv.slice(2));
const [command, target] = args._;
if (!command || args.help) console.log(HELP);
else if (command === "presets") for (const [n, p] of Object.entries(PRESETS)) console.log(`  ${n.padEnd(9)} ${p.style.padEnd(7)} ${p.note}`);
else if (command === "add") add(args, target).catch((e) => die(String(e.stack || e)));
else if (command === "draft") draft(args, target);
else if (command === "gallery") gallery(args);
else die(`unknown command "${command}". Run: aurb --help`);
