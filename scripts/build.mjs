// Builds dist/ and enforces the size budgets. A library that promises to be tiny should fail its own
// build the day it stops being tiny.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

// rest is opt-in, for solid orbs only, so the player itself stays inside its 4 KB.
const BUDGET = { player: 4096, prefetch: 1100, react: 500, rest: 900 }; // rest: 900 since it holds each sheet on its last frame, so a busy page can never see one wrap round
fs.rmSync("dist", { recursive: true, force: true });

const common = { bundle: true, minify: true, target: "es2022", legalComments: "none", logLevel: "warning" };
// Split, so the player and the standalone prefetch entry share one set of prefetched files.
await build({ ...common, entryPoints: ["src/aurb.js", "src/prefetch.js", "src/rest.js"], outdir: "dist", format: "esm", splitting: true, chunkNames: "shared" });
await build({ ...common, entryPoints: ["src/aurb.js"], outfile: "dist/aurb.global.js", format: "iife", globalName: "aurb" });
await build({ ...common, entryPoints: ["src/react.js"], outfile: "dist/react.js", format: "esm", external: ["react", "./aurb.js"], banner: { js: '"use client";' } });
for (const f of ["aurb", "react", "prefetch", "global", "rest"]) fs.copyFileSync(`src/${f}.d.ts`, `dist/${f}.d.ts`);

// The CLI, cli/ into bin/. Its menus' library is bundled in, so installing @aurb/player installs nothing else, and split
// into a file of its own that only the menus load, so every other command starts as fast as it would without it.
fs.rmSync("bin", { recursive: true, force: true });
const nodeUtil = { // the library imports styleText from node:util, which Node 18 lacks: it gets the CLI's own, which also follows NO_COLOR
  name: "node-util",
  setup: (b) => b.onResolve({ filter: /^node:util$/ }, (a) => (a.importer.includes("node_modules") ? { path: path.resolve("cli/style.mjs") } : undefined)),
};
const cli = await build({
  entryPoints: { aurb: "cli/aurb.mjs" }, outdir: "bin", bundle: true, splitting: true, format: "esm", platform: "node", target: "node18",
  chunkNames: "[name]", outExtension: { ".js": ".mjs" }, minifySyntax: true, legalComments: "none", logLevel: "warning", metafile: true, plugins: [nodeUtil],
});
fs.copyFileSync("cli/preview.html", "bin/preview.html");
fs.chmodSync("bin/aurb.mjs", 0o755);
// Their licences ask for their notices to travel with the code.
const bundled = [...new Set(Object.keys(cli.metafile.inputs).map((f) => f.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]).filter(Boolean))].sort();
fs.writeFileSync("bin/THIRD-PARTY-NOTICES", `The menus in this folder include these packages.\n\n${bundled.map((name) => {
  const dir = `node_modules/${name}`, { version, license } = JSON.parse(fs.readFileSync(`${dir}/package.json`, "utf8"));
  const file = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  return `${name}@${version} (${license})\n\n${file ? fs.readFileSync(`${dir}/${file}`, "utf8").trim() : ""}`;
}).join(`\n\n${"-".repeat(72)}\n\n`)}\n`);
const kb = (f) => (fs.statSync(`bin/${f}`).size / 1024).toFixed(1);
for (const f of fs.readdirSync("bin").filter((f) => f.endsWith(".mjs"))) console.log(`${`bin/${f}`.padEnd(14)} ${kb(f).padStart(5)} KB`);
console.log(`bundled: ${bundled.join(", ")}`);

const gz = (...files) => gzipSync(Buffer.concat(files.map((f) => fs.readFileSync(`dist/${f}`))), { level: 9 }).length;
const sizes = { player: gz("aurb.js", "shared.js"), prefetch: gz("prefetch.js", "shared.js"), react: gz("react.js"), rest: gz("rest.js") }; // on top of the player, whose shared code it reuses
let over = false;
for (const [name, bytes] of Object.entries(sizes)) {
  console.log(`${name.padEnd(9)} ${String(bytes).padStart(5)} B gzip  (budget ${BUDGET[name]})`);
  if (bytes > BUDGET[name]) over = true;
}
if (over) { console.error("Over budget."); process.exit(1); }
