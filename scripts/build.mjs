// Builds everything with tsdown (see tsdown.config.ts), then enforces the size budgets. A library that promises to be
// tiny should fail its own build the day it stops being tiny.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "tsdown";

// rest is opt-in, for solid orbs only, so the player itself stays inside its 4 KB.
const BUDGET = { player: 4096, prefetch: 1100, react: 510, rest: 910 }; // rest: 910 since it holds each sheet on its last frame, so a busy page can never see one wrap round

// Type-check all of it first: tsdown strips types without checking them.
for (const project of [".", "cli"]) execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", project], { stdio: "inherit" });
await build({ logLevel: "warn" });
fs.chmodSync("bin/aurb.mjs", 0o755);

// The menus' libraries ask for their licence notices to travel with the code.
const bundled = ["@clack/core", "@clack/prompts", "fast-string-truncated-width", "fast-string-width", "fast-wrap-ansi", "sisteransi"];
const notice = (name) => {
  const dir = `node_modules/${name}`;
  const { version, license } = JSON.parse(fs.readFileSync(`${dir}/package.json`, "utf8"));
  const file = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  return `${name}@${version} (${license})\n\n${file ? fs.readFileSync(`${dir}/${file}`, "utf8").trim() : ""}`;
};
fs.writeFileSync("bin/THIRD-PARTY-NOTICES", `The menus in this folder include these packages.\n\n${bundled.map(notice).join(`\n\n${"-".repeat(72)}\n\n`)}\n`);
for (const f of fs.readdirSync("bin").filter((f) => f.endsWith(".mjs"))) {
  console.log(`${`bin/${f}`.padEnd(22)} ${(fs.statSync(`bin/${f}`).size / 1024).toFixed(1).padStart(5)} KB`);
}

// What a page downloads for an entry: the file and every chunk it imports, the player's shared code included.
function files(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const [, dep] of fs.readFileSync(`dist/${file}`, "utf8").matchAll(/(?:from|import)\s*"\.\/([\w.-]+\.js)"/g)) files(dep, seen);
  return seen;
}
const gz = (entry, skip = []) => {
  const parts = [...files(entry)].filter((f) => !skip.includes(f)).map((f) => fs.readFileSync(`dist/${f}`));
  return gzipSync(Buffer.concat(parts), { level: 9 }).length;
};
// react and rest come on top of the player, whose code they reuse.
const player = [...files("aurb.js")];
const sizes = { player: gz("aurb.js"), prefetch: gz("prefetch.js"), react: gz("react.js", player), rest: gz("rest.js", player) };
let over = false;
for (const [name, bytes] of Object.entries(sizes)) {
  console.log(`${name.padEnd(9)} ${String(bytes).padStart(5)} B gzip  (budget ${BUDGET[name]})`);
  if (bytes > BUDGET[name]) over = true;
}
if (over) {
  console.error("Over budget.");
  process.exit(1);
}
