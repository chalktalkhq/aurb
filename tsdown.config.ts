// How the package is built, by tsdown (Rolldown and Oxc): TypeScript in, minified JavaScript and one bundled .d.ts per
// entry out. A library that promises to be tiny fails its own build the day it stops being tiny: see the budgets below.
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { defineConfig, type UserConfig } from "tsdown";

// Bytes after gzip, for what a page downloads. rest is opt-in, for solid orbs only, so the player itself stays inside
// its 4 KB; it needs 910 since it holds each sheet on its last frame, so a busy page can never see one wrap round.
// react and rest are counted on top of the player, whose code they reuse.
const BUDGET: Record<string, number> = { "aurb.js": 4096, "prefetch.js": 1100, "react.js": 510, "rest.js": 910 };

type Chunk = { type: string; fileName: string; code?: string; imports?: string[]; moduleIds?: string[] };

/** Fail the build when an entry, with every chunk it imports, is over its budget. */
function checkBudgets(chunks: Chunk[]): void {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const withImports = (name: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(name)) return seen;
    seen.add(name);
    for (const dep of byName.get(name)?.imports ?? []) if (byName.has(dep)) withImports(dep, seen); // not react: the app's own
    return seen;
  };
  const player = withImports("aurb.js");
  const over: string[] = [];
  for (const [name, budget] of Object.entries(BUDGET)) {
    const files = [...withImports(name)].filter((f) => name === "aurb.js" || name === "prefetch.js" || !player.has(f));
    const bytes = gzipSync(files.map((f) => byName.get(f)!.code).join(""), { level: 9 }).length;
    console.log(`${name.padEnd(12)} ${String(bytes).padStart(5)} B gzip  (budget ${budget})`);
    if (bytes > budget) over.push(name);
  }
  if (over.length) throw new Error(`Over budget: ${over.join(", ")}`);
}

/** The bundled packages' licences ask for their notices to travel with the code: one file listing each. */
function writeNotices(chunks: Chunk[]): void {
  const ids = chunks.flatMap((c) => c.moduleIds ?? []);
  const names = [...new Set(ids.map((id) => id.replaceAll("\\", "/").match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]).filter((n): n is string => !!n))].sort();
  const notice = (name: string) => {
    const dir = `node_modules/${name}`;
    const { version, license } = JSON.parse(fs.readFileSync(`${dir}/package.json`, "utf8"));
    const file = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
    return `${name}@${version} (${license})\n\n${file ? fs.readFileSync(`${dir}/${file}`, "utf8").trim() : ""}`;
  };
  fs.writeFileSync("bin/THIRD-PARTY-NOTICES", `The menus in this folder include these packages.\n\n${names.map(notice).join(`\n\n${"-".repeat(72)}\n\n`)}\n`);
}

const browser: UserConfig = {
  platform: "browser",
  target: "es2022",
  minify: true,
  hash: false, // stable file names: the preview server serves them by name
  outDir: "dist",
};

// The menus' library imports styleText from node:util, which Node 18 lacks. It gets the CLI's own, which also follows
// NO_COLOR, so every line the CLI draws follows one rule.
const nodeUtil = {
  name: "aurb:node-util",
  resolveId(id: string, importer: string | undefined) {
    if (id === "node:util" && importer?.includes("node_modules")) return path.resolve("cli/style.ts");
  },
};

export default defineConfig([
  // The player as ES modules, with types. The player and the standalone prefetch entry share one chunk, so a page
  // that uses both downloads that code once.
  {
    ...browser,
    entry: { aurb: "src/aurb.ts", prefetch: "src/prefetch.ts", rest: "src/rest.ts", react: "src/react.ts" },
    format: "esm",
    dts: true,
    clean: true,
    deps: { neverBundle: ["react"] },
    // React Server Components need to know the component runs on the client.
    banner: (chunk) => (chunk.fileName === "react.js" ? '"use client";' : ""),
    // The script-tag build's types: window.aurb. Types only, so it's a file of its own, not an entry.
    copy: [{ from: "src/global.d.ts", to: "dist" }],
    hooks: { "build:done": ({ chunks }) => checkBudgets(chunks) },
  },
  // The player for a script tag: one file that defines <aurb-orb> and sets window.aurb.
  {
    ...browser,
    entry: { aurb: "src/aurb.ts" },
    format: "iife",
    globalName: "aurb",
    outputOptions: { entryFileNames: "aurb.global.js" },
    dts: false,
    clean: false,
  },
  // The CLI. Its menus' library is bundled in, so installing @aurb/player installs nothing else, and split into a
  // file of its own that only the menus load, so every other command starts as fast as it would without it.
  {
    entry: { aurb: "cli/aurb.ts" },
    outDir: "bin",
    platform: "node",
    target: "node18",
    format: "esm",
    minify: true,
    hash: false,
    dts: false,
    clean: true,
    // Only these may be bundled: a new dependency of the menus fails the build until its licence is looked at.
    deps: { onlyBundle: ["@clack/core", "@clack/prompts", "fast-string-width", "fast-string-truncated-width", "fast-wrap-ansi", "sisteransi"] },
    plugins: [nodeUtil],
    copy: [{ from: "cli/preview.html", to: "bin" }],
    hooks: { "build:done": ({ chunks }) => writeNotices(chunks) },
  },
]);
