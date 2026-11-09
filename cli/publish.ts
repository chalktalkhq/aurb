// `publish <folder>`: publish a packed orb as its own npm package. A version is never edited by hand: changed files go
// up one patch from what npm has, unless package.json asks for a higher one, and unchanged files publish nothing. Only
// the orb's own files are published, from a copy, so the folder never changes.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { check } from "./check.js";
import { snippet } from "./code.js";
import { LIST, NPM, OFFLINE, STATES, THEMES, bold, cyan, die, dim, green, ships, value, type Manifest, type Options, type Orb, type PackageJson } from "./common.js";

/** npm, with arguments that survive a Windows shell. With talk, npm can show its sign-in link or ask for a 2FA code. */
function npm(args: string[], { talk = false } = {}) {
  const win = process.platform === "win32";
  const quoted = win ? args.map((x) => (/[\s"&|<>^]/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x)) : args;
  const r = spawnSync("npm", quoted, { encoding: "utf8", shell: win, stdio: talk ? "inherit" : "pipe" });
  if (r.error) die("Couldn't run npm.", "Install Node.js, which comes with npm, from nodejs.org");
  return r;
}

type Version = [number, number, number];
const semver = (v: string | undefined): Version | undefined => /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? "")?.slice(1).map(Number) as Version | undefined;
function newer(a: Version, b: Version): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

/**
 * The README an orb's npm page shows, written from its manifest and package.json when its folder has none: what it
 * is, a still of it, the exact code to use it, and what it contains. `version` is the version being published; the
 * change check renders it with a placeholder, so an unchanged orb doesn't look changed because its version moved on.
 */
function orbReadme(pkg: PackageJson, manifest: Manifest, version: string): string {
  const ours = pkg.name.startsWith("@aurb/");
  const themes = manifest.themes ?? THEMES;
  const t = themes.includes("light") ? "light" : themes[0]!;
  const orb: Orb = { name: manifest.name, themes, ...(pkg.aurb?.fade === "rest" ? { fade: "rest" as const } : {}), ...(ours ? {} : { package: pkg.name, version }) };
  const title = manifest.name[0]!.toUpperCase() + manifest.name.slice(1);
  const kb = manifest.kb ?? {};
  const firstLoad = Math.round((kb[`poster-${t}-160.jpg`] ?? 0) + (kb[`idle-${t}-160.webm`] ?? 0));
  const see = /^SEE LICEN[CS]E IN (.+)$/i.exec(pkg.license ?? "")?.[1];
  const licence =
    ours ? "The [aurb Orb Licence](./LICENSE): use it in anything, commercial products included, without attribution. Don't sell or redistribute the orbs on their own."
    : see ? `See [${see}](./${see}).`
    : `${pkg.license}.`;
  const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
  const states = [...manifest.states].sort((a, b) => (STATES.indexOf(a) + 1 || 99) - (STATES.indexOf(b) + 1 || 99));

  return `# ${title}

[![npm](https://img.shields.io/npm/v/${pkg.name}?color=cb3837&logo=npm)](https://www.npmjs.com/package/${pkg.name})
[![jsDelivr](https://data.jsdelivr.com/v1/package/npm/${pkg.name}/badge)](https://www.jsdelivr.com/package/npm/${pkg.name})
[![player](https://img.shields.io/npm/v/@aurb/player?label=%40aurb%2Fplayer&color=6e56cf)](https://www.npmjs.com/package/@aurb/player)

${pkg.description}

<p align="center"><img src="${NPM}/${pkg.name}@${ours ? "1" : version}/poster-${t}-320.jpg" width="160" height="160" alt="${title}, at rest"></p>

An orb for [aurb](https://github.com/chalktalkhq/aurb), a 4 KB player for animated orbs in AI products. Its files load from jsDelivr, only the states you use, so there is nothing to host.${themes.length === 1 ? ` It is made for ${t} backgrounds only.` : ""}

## Use it

\`\`\`bash
npm i @aurb/player
\`\`\`

\`\`\`jsx
${snippet(orb, {})}
\`\`\`

Or with no build step:

\`\`\`html
${snippet(orb, { html: true })}
\`\`\`

Set \`state\` to any of its states and it moves between them. To see every one: \`npx @aurb/player preview ${value(orb)}\`

## What's in it

| | |
|---|---|
| States | ${states.map((x) => `\`${x}\``).join(", ")} |
| Themes | ${themes.length === 1 ? `${t} only` : "dark and light"} |
| Sizes | ${manifest.sizes.join(", ")} px |
| First load at 160 px | ${firstLoad} KB (its poster and idle loop) |
| Changing state | ${orb.fade === "rest" ? 'through a shared rest pose; needs `import "@aurb/player/rest"` and `transition="rest"`' : "a crossfade"} |

## Licence

${licence}${author ? ` Made by ${author}.` : ""}
`;
}

/** The version npm has and the fingerprint of its files, or nothing for a package npm hasn't seen. */
function published(name: string): { version?: string; hash?: string } {
  const view = npm(["view", name, "version", "aurb.hash", "--json"]);
  if (view.status) {
    if (/E404|404 Not Found/.test(view.stderr)) return {};
    const reason = view.stderr.trim().split("\n").find((l) => /npm error (?!A complete)/.test(l)) ?? OFFLINE;
    die(`Couldn't ask npm about ${name}.`, reason.replace(/^npm error /, ""));
  }
  let now: string | { version?: string; "aurb.hash"?: string } | null = null;
  try {
    now = JSON.parse(view.stdout || "null");
  } catch {}
  // A package with no aurb.hash yet answers with its version alone.
  if (typeof now === "string") return { version: now };
  return { ...(now?.version ? { version: now.version } : {}), ...(now?.["aurb.hash"] ? { hash: now["aurb.hash"] } : {}) };
}

export async function publish(dir: string | undefined, options: Options): Promise<void> {
  if (!dir || !fs.existsSync(path.join(dir, "package.json"))) die("Which orb folder?", "npx @aurb/player publish orbs/nebula, after npx @aurb/player pack");
  const dry = !!options["dry-run"];
  await check([dir], { quiet: dry && !!options.readme }); // a README preview prints only the README
  const pkg: PackageJson = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const own = semver(pkg.version);
  if (!own) die(`package.json version "${pkg.version}" should be like 1.0.0.`);
  const files = fs.readdirSync(dir).filter((f) => ships(f) && fs.statSync(path.join(dir, f)).isFile()).sort();

  // An orb's own README wins; without one, a generated README ships, and counts as one of its files.
  const ownReadme = files.find((f) => /^readme(\.\w+)?$/i.test(f));
  const readme = ownReadme ? null : (v: string) => orbReadme(pkg, manifest, v);
  // The fingerprint of what ships, with the README always last, generated or a file, so republishing an orb downloaded
  // from npm, README and all, finds nothing changed (and matches the fingerprints already published).
  const hash = createHash("sha1");
  for (const f of files.filter((f) => f !== "package.json" && f !== ownReadme)) hash.update(f).update(fs.readFileSync(path.join(dir, f)));
  hash.update(ownReadme ?? "README.md").update(ownReadme ? fs.readFileSync(path.join(dir, ownReadme)) : readme!("VERSION"));
  const digest = hash.digest("hex").slice(0, 12);

  const now = published(pkg.name);
  const use = (v: string) => (pkg.name.startsWith("@aurb/") ? `orb="${manifest.name}"` : `orb="npm:${pkg.name}@${v}"`);
  if (now.version && now.hash === digest) return console.log(`${green("✓")} ${pkg.name}@${now.version} already has these files. ${dim(use(now.version))}`);
  const latest = semver(now.version);
  if (now.version && !latest) die(`npm has ${pkg.name}@${now.version}, which isn't like 1.0.0.`, "Set a higher version in package.json");
  const bumped: Version | undefined = latest && [latest[0], latest[1], latest[2] + 1];
  const next = (!bumped || newer(own, bumped) ? own : bumped).join(".");

  if (dry) {
    if (readme && options.readme) return console.log(readme(next));
    return console.log(`Would publish ${bold(`${pkg.name}@${next}`)}: ${files.length + (readme ? 1 : 0)} files${readme ? ", with a generated README (see it: --dry-run --readme)" : ""}  ${dim(use(next))}`);
  }

  if (!process.env.GITHUB_ACTIONS && npm(["whoami"]).status) die("You're not logged in to npm.", "Run npm login, then try again");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aurb-"));
  try {
    for (const f of files) fs.copyFileSync(path.join(dir, f), path.join(tmp, f));
    if (readme) fs.writeFileSync(path.join(tmp, "README.md"), readme(next));
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ ...pkg, version: next, aurb: { ...pkg.aurb, hash: digest } }, null, 2));
    console.log(`Publishing ${bold(`${pkg.name}@${next}`)}`);
    const provenance = process.env.GITHUB_ACTIONS && process.env.ACTIONS_ID_TOKEN_REQUEST_URL ? ["--provenance"] : [];
    const r = npm(["publish", tmp, "--access", "public", ...provenance], { talk: true });
    if (r.status) {
      const why = pkg.name.startsWith("@aurb/") ? "Publishing to @aurb needs a member of the npm org" : "Is the name free on npm? If not, choose another orb name";
      die(`npm couldn't publish ${pkg.name}@${next}.`, `See npm's message above. ${why}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${green("✓")} Published ${bold(`${pkg.name}@${next}`)}. Anyone can use it now: ${cyan(use(next))}`);
  console.log(dim("jsDelivr can take a minute to see a new version."));
  if (!pkg.name.startsWith("@aurb/")) console.log(dim(`To list it on the site and in npx @aurb/player, submit npm:${pkg.name}@${next} at ${LIST}`));
}
