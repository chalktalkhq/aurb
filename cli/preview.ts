// `preview <name|folder>`: serve the player and a page that plays every state of an orb, from a local folder or the CDN.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES, base, bold, cyan, die, dim, find, green, manifestOf, manifestProblems, option, single, tty, value, yellow, type Manifest, type Options } from "./common.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const TYPES: Record<string, string> = { webm: "video/webm", mp4: "video/mp4", jpg: "image/jpeg", js: "text/javascript" };

// A manifest is someone else's data: never let it close the script, or the page's HTML.
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const text = (v: unknown) => String(v).replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Open a URL in the default browser. */
function open(url: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

export async function preview(target: string | undefined, options: Options): Promise<void> {
  if (!target) die("Which orb?", "npx @aurb/player preview aurora, a folder: npx @aurb/player preview orbs/nebula, or a package: npm:aurb-orb-nebula@1.0.0");
  const port = Number(option(options, "port") ?? 4300);
  if (!Number.isInteger(port) || port < 1 || port > 65535) die("--port is a number from 1 to 65535.");

  const local = fs.existsSync(path.join(target, "manifest.json")) ? path.resolve(target) : null;
  let manifest: Manifest;
  let orb: string;
  let fade: string | undefined;
  if (local) {
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(local, "manifest.json"), "utf8"));
    } catch {
      die(`${target}/manifest.json isn't valid JSON.`, "Pack it again with npx @aurb/player pack");
    }
    const problems = manifestProblems(manifest);
    if (problems.length) die(`${target} has a broken manifest.json:\n  ${problems.join("\n  ")}`, `npx @aurb/player check ${target} lists everything to fix`);
    orb = `http://localhost:${port}/o`;
  } else {
    if (fs.existsSync(target)) die(`${target} has no manifest.json.`, "Make one with npx @aurb/player pack");
    const found = await find(target);
    fade = found.fade;
    orb = base(found);
    manifest = await manifestOf(orb, value(found));
  }

  const dist = path.join(here, "..", "dist");
  if (!fs.existsSync(path.join(dist, "aurb.js"))) die("The player isn't built.", "Run npm run build in the aurb repo");
  const page = fs
    .readFileSync(path.join(here, "preview.html"), "utf8")
    .replaceAll("__NAME__", text(manifest.name))
    .replaceAll("__ORB__", orb)
    .replace("__STATES__", json(manifest.states))
    .replace("__REST__", json(!!manifest.rest || fade === "rest"))
    .replace("__KB__", json(manifest.kb))
    .replace("__THEMES__", json(manifest.themes ?? THEMES))
    .replaceAll("__SIZES__", manifest.sizes.join(","));

  http
    .createServer((req, res) => {
      const url = req.url!.split("?")[0]!;
      // The orb's own files, from a local folder, and the player's.
      const media = local && /^\/o\/([\w-]+\.(webm|mp4|jpg))$/.exec(url);
      const js = /^\/(aurb|rest|shared)\.js$/.test(url) && path.join(dist, url);
      const file = media ? path.join(local, media[1]!) : js;
      if (file) {
        const ok = fs.existsSync(file);
        res.writeHead(ok ? 200 : 404, { "content-type": TYPES[path.extname(file).slice(1)] });
        return res.end(ok ? fs.readFileSync(file) : "");
      }
      if (url !== "/") {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
    })
    .listen(port, () => {
      const url = `http://localhost:${port}`;
      const theme = single(manifest);
      console.log(`${green("✓")} ${bold(manifest.name)} at ${cyan(url)}${theme ? yellow(`  ${theme} only`) : ""}  ${dim("Ctrl+C to stop")}`);
      if (tty && !options["no-open"]) open(url);
    })
    .on("error", (e: NodeJS.ErrnoException) => die(e.code === "EADDRINUSE" ? `Port ${port} is in use.` : e.message, `Try npx @aurb/player preview ${target} --port ${port + 1}`));
}
