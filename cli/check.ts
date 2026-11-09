// `check <folder|npm:pkg@x.y.z>`: what a submission must pass. Every problem is listed at once, each with what to do.
import fs from "node:fs";
import path from "node:path";
import { folder } from "../src/shared.js";
import { bold, die, dim, getBytes, green, OFFLINE, red } from "./common.js";
import { expected, index, manifestProblems, MAX_FILE_KB, MAX_ORB_MB, NAME, NPM_REF, otherTheme, ships, THEMES, type Manifest, type Orb, type PackageJson } from "./orbs.js";

/** An orb's files, from a folder or from its npm package on jsDelivr. */
interface Source {
  label: string;
  /** The package, when it's checked from npm. */
  pkg?: string;
  /** Files in the folder that won't be published. */
  left?: string[];
  /** A file's bytes: null when it isn't there, undefined when it couldn't be reached. */
  read(file: string): Promise<Buffer | null | undefined>;
  /** The size in KB of each of these files that exists, or undefined for one that couldn't be reached. */
  files(names: string[]): Promise<Record<string, number | undefined>>;
}

// Fetching every file through jsDelivr also keeps a copy there for good, so an approved version keeps working even if
// its package is later unpublished.
function source(target: string): Source {
  const ref = NPM_REF.exec(target);
  if (!ref) {
    const dir = path.resolve(target);
    const all = fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];
    const kb = Object.fromEntries(all.filter(ships).map((f) => [f, fs.statSync(path.join(dir, f)).size / 1024]));
    return {
      label: target,
      left: all.filter((f) => !ships(f)),
      read: async (f) => (f in kb ? fs.readFileSync(path.join(dir, f)) : null),
      files: async () => kb,
    };
  }

  const [, pkg, version] = ref as unknown as [string, string, string];
  const from = folder(target);
  const cache: Record<string, Buffer | null | undefined> = {};
  const read = async (f: string) => (cache[f] ??= await getBytes(`${from}/${f}`)); // a failure is asked again
  return {
    label: `${pkg}@${version}`,
    pkg,
    read,
    files: async (names) => {
      const queue = [...names];
      const out: Record<string, number | undefined> = {};
      // Eight at a time.
      await Promise.all(
        Array.from({ length: 8 }, async () => {
          while (queue.length) {
            const f = queue.shift()!;
            const b = await read(f);
            if (b) out[f] = b.length / 1024;
            else if (b === undefined) out[f] = undefined;
          }
        }),
      );
      return out;
    },
  };
}

/** What a package.json must say. */
async function packageProblems(pkg: PackageJson, name: string, manifest: Manifest | null, src: Source): Promise<string[]> {
  const p: string[] = [];
  if (pkg.name !== `aurb-orb-${name}` && pkg.name !== `@aurb/${name}`) p.push(`package.json name should be "aurb-orb-${name}", after the orb's name in manifest.json`);
  if (src.pkg && pkg.name !== src.pkg) p.push(`package.json says ${pkg.name}, but this is ${src.pkg}`);
  if (typeof pkg.description !== "string" || !pkg.description.trim() || pkg.description.length > 160) p.push("package.json needs a description of one short sentence");
  if (/[–—]/.test(pkg.description ?? "")) p.push("the description has a long dash; use a comma or a colon");
  if (pkg.aurb !== undefined && (typeof pkg.aurb !== "object" || (pkg.aurb.fade !== undefined && pkg.aurb.fade !== "rest"))) p.push(`package.json aurb.fade is "rest" or left out`);
  if (pkg.aurb?.fade === "rest" && manifest && !manifest.rest) p.push(`package.json says fade "rest", but manifest.json has no rest: render the rest sheets, or remove fade`);
  if (pkg.private) p.push("package.json says private: an orb has to be public");
  // A licence: a name such as MIT, or "SEE LICENSE IN <file>" with that file alongside.
  const see = /^SEE LICEN[CS]E IN (.+)$/i.exec(pkg.license ?? "")?.[1]?.trim();
  if (!pkg.license) p.push(`package.json needs a licence, such as "license": "MIT"`);
  else if (see && !(await src.read(see))) p.push(`package.json points to ${see} for its licence, which isn't here${pkg.name.startsWith("@aurb/") ? ": copy in the aurb Orb Licence" : ""}`);
  return p;
}

/** Every file the manifest promises is there, none too big, and the orb's size in KB. */
async function fileProblems(manifest: Manifest, src: Source): Promise<{ problems: string[]; notes: string[]; total: number }> {
  const problems: string[] = [];
  const notes: string[] = [];
  const needed = expected(manifest);
  const files = await src.files([...new Set([...needed, ...Object.keys(manifest.kb)])]);
  const unreachable = Object.keys(files).filter((f) => files[f] === undefined);
  if (unreachable.length) problems.push(`couldn't reach ${unreachable.length} files. ${OFFLINE}`);
  for (const f of needed) if (!(f in files)) problems.push(`missing ${f}`);
  for (const f of Object.keys(manifest.kb)) if (!needed.includes(f) && !(f in files)) problems.push(`manifest.json lists ${f}, which is missing`);

  const has = manifest.themes ?? THEMES;
  if (has.length === 1) {
    const other = otherTheme(has[0]!);
    if (Object.keys(files).some((f) => f.includes(`-${other}-`))) problems.push(`manifest.json says ${has[0]} only, but there are ${other} files: pack it again`);
  }
  let total = 0;
  for (const [f, kb] of Object.entries(files)) {
    if (kb === undefined) continue;
    total += kb;
    if (kb > MAX_FILE_KB) problems.push(`${f} is ${Math.round(kb)} KB; keep every file under ${MAX_FILE_KB} KB (a shorter loop, or less detail)`);
  }
  if (total / 1024 > MAX_ORB_MB) problems.push(`the orb is ${(total / 1024).toFixed(1)} MB; keep it under ${MAX_ORB_MB} MB`);
  if (has.length === 1) notes.push(`${has[0]} only`);
  return { problems, notes, total };
}

export async function check(targets: string[], { quiet = false } = {}): Promise<void> {
  if (!targets.length) die("Which orbs?", "npx @aurb/player check orbs/nebula, or a published one: npx @aurb/player check npm:aurb-orb-nebula@1.0.0");
  let failed = 0;
  let listed: Orb[] | null | undefined; // loaded once, the first time a name needs checking

  for (const target of targets) {
    if (target.startsWith("npm:") && !NPM_REF.test(target)) {
      failed++;
      console.log(`${red("✕")} ${bold(target)}\n  needs a package name and an exact version, such as npm:aurb-orb-nebula@1.0.0`);
      continue;
    }
    const src = source(target);
    const problems: string[] = [];
    const notes: string[] = [];
    const json = async <T>(f: string): Promise<T | null> => {
      const b = await src.read(f);
      if (b === undefined) {
        problems.push(`couldn't reach ${f}. ${OFFLINE}`);
        return null;
      }
      try {
        if (b) return JSON.parse(String(b));
      } catch {}
      problems.push(`${f} is missing or isn't valid JSON${src.pkg ? ". Check the exact version; just published? jsDelivr can take a minute to see it" : ""}`);
      return null;
    };

    const pkg = await json<PackageJson>("package.json");
    const manifest = await json<Manifest>("manifest.json");
    if (manifest) problems.push(...manifestProblems(manifest));
    const manifestOk = manifest && !manifestProblems(manifest).length;
    const name = manifest?.name ?? path.basename(path.resolve(target));
    if (pkg) problems.push(...(await packageProblems(pkg, name, manifest, src)));
    let total = 0;
    if (manifestOk) {
      const files = await fileProblems(manifest, src);
      problems.push(...files.problems);
      notes.push(...files.notes);
      total = files.total;
    }
    if (src.left?.length) notes.push(`not published: ${src.left.slice(0, 5).join(", ")}${src.left.length > 5 ? ` and ${src.left.length - 5} more` : ""}`);

    // A community orb's name must be free, or already this package's. The list is a courtesy when offline.
    if (manifest && NAME.test(name) && !pkg?.name?.startsWith("@aurb/")) {
      listed ??= await index({ soft: true });
      const taken = listed?.find((o) => o.name === name);
      if (taken && taken.package !== (src.pkg ?? pkg?.name)) problems.push(`the name "${name}" is taken; choose another in manifest.json and package.json`);
      if (!listed) notes.push("couldn't load the list, so the name wasn't checked");
    }

    if (problems.length) {
      failed++;
      const more = problems.length > 20 ? `\n  and ${problems.length - 20} more` : "";
      console.log(`${red("✕")} ${bold(src.label)}\n  ${problems.slice(0, 20).join("\n  ")}${more}`);
    } else if (!quiet || notes.length) {
      console.log(`${green("✓")} ${bold(src.label)}  ${dim([`${(total / 1024).toFixed(1)} MB`, ...notes].join(", "))}`);
    }
  }
  if (failed) die(`${failed} of ${targets.length} not ready.`, "Fix the lines above, then run npx @aurb/player check again");
}
