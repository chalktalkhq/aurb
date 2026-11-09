// How the package is built, by tsdown (Rolldown and Oxc): TypeScript in, minified JavaScript and one bundled .d.ts per
// entry out. `npm run build` runs this, then scripts/build.mjs checks the size budgets.
import path from "node:path";
import { defineConfig, type UserConfig } from "tsdown";

const browser: UserConfig = {
  platform: "browser",
  target: "es2022",
  minify: true,
  hash: false, // stable file names: the preview server and the size budgets name them
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
    entry: { aurb: "src/aurb.ts", prefetch: "src/prefetch.ts", rest: "src/rest.ts", react: "src/react.ts", global: "src/global.ts" },
    format: "esm",
    dts: true,
    clean: true,
    deps: { neverBundle: ["react"] },
    // React Server Components need to know the component runs on the client.
    banner: (chunk) => (chunk.fileName === "react.js" ? '"use client";' : ""),
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
    deps: { onlyBundle: ["@clack/core", "@clack/prompts", "fast-string-width", "fast-string-truncated-width", "fast-wrap-ansi", "sisteransi"] },
    plugins: [nodeUtil],
    copy: [{ from: "cli/preview.html", to: "bin" }],
  },
]);
