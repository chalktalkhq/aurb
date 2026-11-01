// Builds dist/ and enforces the size budget. A library that promises to be tiny should fail its
// own build the day it stops being tiny.
import { build } from "esbuild";
import fs from "node:fs";
import { gzipSync } from "node:zlib";

const BUDGET_GZIP = 4096;
fs.rmSync("dist", { recursive: true, force: true });

const common = { bundle: true, minify: true, target: "es2021", legalComments: "none", logLevel: "warning" };
await build({ ...common, entryPoints: ["src/aurb.js"], outfile: "dist/aurb.js", format: "esm" });
await build({ ...common, entryPoints: ["src/aurb.js"], outfile: "dist/aurb.global.js", format: "iife", globalName: "aurb" });
await build({ ...common, entryPoints: ["src/react.js"], outfile: "dist/react.js", format: "esm", external: ["react", "./aurb.js"], banner: { js: '"use client";' } });
fs.copyFileSync("src/aurb.d.ts", "dist/aurb.d.ts");
fs.copyFileSync("src/react.d.ts", "dist/react.d.ts");

for (const f of ["aurb.js", "aurb.global.js", "react.js"]) {
  const raw = fs.readFileSync(`dist/${f}`);
  const gz = gzipSync(raw, { level: 9 }).length;
  console.log(`${f.padEnd(16)} ${raw.length} B  ${gz} B gzip`);
  if (f === "aurb.js" && gz > BUDGET_GZIP) { console.error(`Over budget: ${gz} B is more than ${BUDGET_GZIP} B gzip.`); process.exit(1); }
}
