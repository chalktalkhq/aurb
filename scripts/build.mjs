// Builds dist/ and enforces the size budgets. A library that promises to be tiny should fail its own
// build the day it stops being tiny.
import { build } from "esbuild";
import fs from "node:fs";
import { gzipSync } from "node:zlib";

const BUDGET = { player: 4096, prefetch: 1024, react: 500 };
fs.rmSync("dist", { recursive: true, force: true });

const common = { bundle: true, minify: true, target: "es2022", legalComments: "none", logLevel: "warning" };
// Split, so the player and the standalone prefetch entry share one set of prefetched files.
await build({ ...common, entryPoints: ["src/aurb.js", "src/prefetch.js"], outdir: "dist", format: "esm", splitting: true, chunkNames: "shared" });
await build({ ...common, entryPoints: ["src/aurb.js"], outfile: "dist/aurb.global.js", format: "iife", globalName: "aurb" });
await build({ ...common, entryPoints: ["src/react.js"], outfile: "dist/react.js", format: "esm", external: ["react", "./aurb.js"], banner: { js: '"use client";' } });
for (const f of ["aurb", "react", "prefetch", "global"]) fs.copyFileSync(`src/${f}.d.ts`, `dist/${f}.d.ts`);

const gz = (...files) => gzipSync(Buffer.concat(files.map((f) => fs.readFileSync(`dist/${f}`))), { level: 9 }).length;
const sizes = { player: gz("aurb.js", "shared.js"), prefetch: gz("prefetch.js", "shared.js"), react: gz("react.js") };
let over = false;
for (const [name, bytes] of Object.entries(sizes)) {
  console.log(`${name.padEnd(9)} ${String(bytes).padStart(5)} B gzip  (budget ${BUDGET[name]})`);
  if (bytes > BUDGET[name]) over = true;
}
if (over) { console.error("Over budget."); process.exit(1); }
