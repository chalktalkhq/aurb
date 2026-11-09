// `download <name>`: save an orb's files, to host them yourself.
import fs from "node:fs";
import path from "node:path";
import { cyan, die, dim, getBytes, green, OFFLINE, option, tty, yellow, type Options } from "./common.js";
import { base, find, manifestOf, onlyNote, otherTheme, THEMES, value, type Theme } from "./orbs.js";

export async function download(name: string | undefined, options: Options): Promise<void> {
  if (!name) die("Which orb?", "npx @aurb/player download aurora");
  const orb = await find(name);
  const from = base(orb);
  const manifest = await manifestOf(from, value(orb));
  const has = manifest.themes ?? THEMES;

  // One theme, for a site that only ever shows that one: about half the files. The element must then say so.
  const asked = option(options, "theme");
  if (asked && !THEMES.includes(asked as Theme)) die(`--theme is ${THEMES.join(" or ")}.`);
  let theme = (asked as Theme | undefined) ?? null;
  if (theme && !has.includes(theme)) die(`${orb.name} is ${has[0]} only, so it has no ${theme} files.`, `Leave out --theme, or choose an orb made in ${theme}`);
  if (!theme && has.length === 1) theme = has[0]!;
  const other = theme && otherTheme(theme);
  const files = ["manifest.json", ...Object.keys(manifest.kb).filter((f) => !other || !f.includes(`-${other}-`))];

  const out = path.resolve(option(options, "out") ?? "orbs", orb.name);
  try {
    fs.mkdirSync(out, { recursive: true });
  } catch (e) {
    die(`Couldn't make ${out} (${(e as NodeJS.ErrnoException).code}).`, "Choose another folder with --out");
  }
  let done = 0;
  let bytes = 0;
  for (const f of files) {
    const b = await getBytes(`${from}/${f}`);
    if (!b) {
      const missing = b === null;
      die(`Couldn't download ${f}${missing ? ": it's listed but missing" : ""}.`, missing ? "The orb is broken; tell its author" : `${OFFLINE}, then run the same command again`);
    }
    fs.writeFileSync(path.join(out, f), b);
    bytes += b.length;
    if (tty) process.stdout.write(`\r${dim(`Downloading ${++done} of ${files.length}`)}`);
  }

  const rel = path.relative(process.cwd(), out).split(path.sep).join("/");
  console.log(`\r${green("✓")} Saved ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB, to ${rel}`);
  const attr = theme ? ` theme="${theme}"` : "";
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    console.log(`Serve that folder with your site, then use orb="<the URL it is served at>"${attr}.`);
  } else {
    // public/, static/ and www/ are what most frameworks serve from the site's root.
    console.log(`Serve that folder with your site, then use ${cyan(`orb="/${rel.replace(/^(public|static|www)\//, "")}"${attr}`)}, the URL it is served at.`);
  }
  if (theme && has.length === 1) console.log(yellow(onlyNote(theme)));
  else if (theme) console.log(dim(`theme="${theme}" is needed: without it, a visitor in ${other} mode would ask for ${other} files that aren't there.`));
}
