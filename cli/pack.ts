// `pack ./loops --name nebula`: encode a folder of loops into an orb, every state, theme and size, ready to publish.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NAME, OUTPUT, RESERVED, SIZES, STATES, THEMES, bold, cyan, die, dim, green, option, otherTheme, tty, yellow, type Options } from "./common.js";

/** An ffmpeg that can encode both H.264 and VP9: $FFMPEG, or the one on the PATH. */
function ffmpeg(): string {
  for (const bin of [process.env.FFMPEG, "ffmpeg"]) {
    if (!bin) continue;
    const r = spawnSync(bin, ["-hide_banner", "-encoders"], { encoding: "utf8", maxBuffer: 1 << 24 });
    if (r.stdout?.includes("libx264") && r.stdout.includes("libvpx-vp9")) return bin;
  }
  const how = process.platform === "win32" ? "winget install ffmpeg" : process.platform === "darwin" ? "brew install ffmpeg" : "sudo apt install ffmpeg";
  die("Packing needs ffmpeg with libx264 and libvpx-vp9.", `Install it with ${how}, or set FFMPEG to its path`);
}

interface Loop {
  file: string;
  seconds: number;
  w: number;
  h: number;
}

/** A video's size and length, read from ffmpeg's own report. Null if ffmpeg can't read it. */
function probe(bin: string, file: string): Omit<Loop, "file"> | null {
  const report = spawnSync(bin, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr ?? "";
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(report);
  const s = /, (\d{2,5})x(\d{2,5})[,\s]/.exec(report);
  if (!d || !s) return null;
  return { seconds: +d[1]! * 3600 + +d[2]! * 60 + +d[3]!, w: +s[1]!, h: +s[2]! };
}

/** Tiny sizes are compressed harder, where nobody can see it; the same curve the built-in orbs use. */
const crfFor = (size: number): number => 21 + (size <= 100 ? 5 : size <= 200 ? 2 : size <= 400 ? 0 : -2);

/** Each file to encode, and ffmpeg's arguments for it. */
type Job = [file: string, args: string[]];

function jobsFor(key: string, loop: Loop, size: number): Job[] {
  const vf = `scale=${size}:${size}:flags=lanczos:out_color_matrix=bt709,format=yuv420p`;
  const crf = crfFor(size);
  const jobs: Job[] = [
    [`${key}-${size}.mp4`, ["-i", loop.file, "-an", "-vf", vf, "-r", "24", "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", String(crf), "-movflags", "+faststart"]],
    [`${key}-${size}.webm`, ["-i", loop.file, "-an", "-vf", vf, "-r", "24", "-c:v", "libvpx-vp9", "-crf", String(crf + 13), "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2"]],
  ];
  // The poster is the idle loop's first frame.
  if (key.startsWith("idle-")) jobs.push([`poster-${key.slice(5)}-${size}.jpg`, ["-i", loop.file, "-frames:v", "1", "-vf", `scale=${size}:${size}:flags=lanczos`, "-q:v", "3"]]);
  return jobs;
}

export async function pack(src: string | undefined, options: Options): Promise<void> {
  const name = String(options.name === true ? "" : (options.name ?? "")).toLowerCase();
  if (!src || !NAME.test(name)) die("Pack needs a folder of loops and a name.", "npx @aurb/player pack ./loops --name nebula  (lowercase letters, digits and -)");
  if (RESERVED.includes(name)) die(`"${name}" can't be an orb's name.`, "Choose another with --name");
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) die(`There's no folder ${src}.`, "Point it at the folder holding idle-dark.mp4 and the rest");
  const out = path.resolve(option(options, "out") ?? "orbs", name);
  if (out === path.resolve(src)) die("--out can't be the folder of loops.", "Leave out --out, or choose another folder");
  const bin = ffmpeg();
  const sizes = options.xl ? [...SIZES, 640] : SIZES;
  const largest = sizes[sizes.length - 1]!;

  // The loops, by name without extension: idle-dark, idle-light and so on.
  const files = fs.readdirSync(src).filter((f) => fs.statSync(path.join(src, f)).isFile() && !f.startsWith("."));
  const byName: Record<string, string[]> = {};
  for (const f of files) (byName[path.parse(f).name] ??= []).push(f);

  // Only dark loops, or only light ones, is an orb for that theme alone. Some of each is a mistake.
  const themes = THEMES.filter((t) => STATES.some((s) => byName[`${s}-${t}`]));
  if (!themes.length) die(`There are no loops in ${src}.`, `Name them like idle-dark.mp4 and idle-light.mov, one per state: ${STATES.join(", ")}`);

  const problems: string[] = [];
  const warnings: string[] = [];
  for (const [stem, same] of Object.entries(byName)) {
    const m = /^(.+)-(dark|light)$/.exec(stem);
    if (!m) continue;
    const [, state, theme] = m as unknown as [string, string, string];
    if (!STATES.includes(state)) {
      const guess = STATES.find((s) => s.startsWith(state.slice(0, 3)));
      warnings.push(`${same[0]} isn't a state, so it's left out${guess ? ` (did you mean ${guess}-${theme}?)` : ""}`);
    } else if (same.length > 1) {
      problems.push(`${same.join(" and ")} are both ${stem}: keep one`);
    }
  }
  // Some loops in a theme, but not all, is a mistake either way: say which, and both ways to fix it.
  if (themes.length === 2) {
    for (const t of THEMES) {
      const got = STATES.filter((s) => byName[`${s}-${t}`]);
      if (got.length < STATES.length && got.length <= STATES.length / 2) {
        die(`There are ${t} loops for ${got.join(", ")} only.`, `Add the other ${STATES.length - got.length} for an orb in both themes, or remove those for an orb in ${otherTheme(t)} only`);
      }
    }
  }

  const loops: Record<string, Loop> = {};
  for (const state of STATES) {
    for (const theme of themes) {
      const f = byName[`${state}-${theme}`]?.[0];
      if (!f) {
        problems.push(`missing ${state}-${theme}`);
        continue;
      }
      const info = probe(bin, path.join(src, f));
      if (!info) {
        problems.push(`ffmpeg can't read ${f}`);
        continue;
      }
      loops[`${state}-${theme}`] = { file: path.join(src, f), ...info };
    }
  }
  const first = Object.values(loops)[0];
  for (const [key, l] of Object.entries(loops)) {
    if (l.w !== l.h) problems.push(`${key} is ${l.w}x${l.h}, not square`);
    if (l.w < largest) problems.push(`${key} is ${l.w}px; it needs at least ${largest}px${options.xl ? " for --xl" : ""}`);
    if (l.seconds < 0.5) problems.push(`${key} is ${l.seconds}s; a loop needs at least half a second`);
    if (first && Math.abs(l.seconds - first.seconds) > 0.05) problems.push(`${key} is ${l.seconds}s, the others ${first.seconds}s: every state must be the same length, so they stay in step`);
  }
  for (const w of warnings) console.log(`${yellow("!")} ${w}`);
  if (problems.length) die(`The loops in ${src} aren't ready:\n  ${problems.join("\n  ")}`, `Every state needs a loop for each theme: dark on black, light on white, named like idle-dark.mp4.`);
  if (themes.length === 1) {
    const [only] = themes as [typeof themes[0]];
    console.log(yellow(`${only === "dark" ? "Dark" : "Light"} only: there are no ${otherTheme(only)} loops, so this orb is for ${only} backgrounds alone.`));
  }

  fs.mkdirSync(out, { recursive: true });
  // A packed folder holds only this pack: files from an earlier one, such as another theme or size, would ship too.
  for (const f of fs.readdirSync(out)) if (OUTPUT.test(f)) fs.rmSync(path.join(out, f));
  const kb = await encode(bin, out, Object.entries(loops).flatMap(([key, loop]) => sizes.flatMap((size) => jobsFor(key, loop, size))));

  // The manifest's version is a fingerprint of the files, so the player can tell a new render from an old one.
  const hash = createHash("sha1");
  for (const f of Object.keys(kb).sort()) hash.update(fs.readFileSync(path.join(out, f)));
  const manifest = { name, version: hash.digest("hex").slice(0, 8), states: STATES, themes, sizes, kb };
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  // The orb is your own npm package, aurb-orb-<name>, so it carries your name and its own download counts.
  const pkgFile = path.join(out, "package.json");
  if (!fs.existsSync(pkgFile)) {
    const author = spawnSync("git", ["config", "user.name"], { encoding: "utf8" }).stdout?.trim() || undefined;
    const note = typeof options.note === "string" ? options.note : "";
    fs.writeFileSync(pkgFile, JSON.stringify({ name: `aurb-orb-${name}`, version: "1.0.0", description: note, author, keywords: ["aurb", "aurb-orb"], aurb: {} }, null, 2) + "\n");
    console.log(`\n${dim(`${note ? "" : "Add a one-line description, and "}choose a licence ("license": "MIT", say), in`)} ${pkgFile}`);
  }
  const rel = path.relative(process.cwd(), out);
  const mb = (Object.values(kb).reduce((a, b) => a + b, 0) / 1024).toFixed(1);
  console.log(`\r${green("✓")} Packed ${bold(name)}: ${Object.keys(kb).length} files, ${mb} MB in ${rel}`);
  console.log(`Try it: ${cyan(`npx @aurb/player preview ${rel}`)}, then ${cyan(`npx @aurb/player publish ${rel}`)}`);
}

/** Run the jobs, a few at once, and return each file's size in KB. Stops at the first that fails. */
async function encode(bin: string, out: string, jobs: Job[]): Promise<Record<string, number>> {
  const kb: Record<string, number> = {};
  let done = 0;
  const run = ([file, args]: Job) =>
    new Promise<void>((resolve, reject) => {
      const p = spawn(bin, ["-y", "-loglevel", "error", ...args, path.join(out, file)]);
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("error", reject);
      p.on("close", (code) => {
        if (code) return reject(new Error(`ffmpeg failed on ${file}: ${err.trim().split("\n").slice(-3).join(" ")}`));
        kb[file] = Math.ceil(fs.statSync(path.join(out, file)).size / 1024);
        if (tty) process.stdout.write(`\r${dim(`Encoding ${++done} of ${jobs.length}`)}  `);
        resolve();
      });
    });
  const queue = [...jobs];
  const workers = Math.max(1, Math.min(4, os.cpus().length));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (queue.length) await run(queue.shift()!);
    }),
  ).catch((e: Error) => die(e.message, "Fix the loop it names, then pack again"));
  return kb;
}
