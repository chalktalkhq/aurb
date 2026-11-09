// What the player and the standalone prefetch entry have in common. No side effects, and no
// reference to the element, so `@aurb/player/prefetch` stays a few hundred bytes.
import type { AurbState, PrefetchOptions, Theme } from "./types.js";

/** Other names for the built-in states, so an app can use its own words. */
export const ALIASES: Record<string, string> = {
  running: "working",
  busy: "working",
  loading: "thinking",
  processing: "thinking",
  talking: "speaking",
  recording: "listening",
  done: "success",
  failed: "error",
  sleeping: "asleep",
  dormant: "asleep",
  default: "idle",
};

/** The state a name stands for: an alias resolved, or the name itself. */
export const canonical = (state: string): string => ALIASES[state] ?? state;

// Every orb is an npm package, served free by jsDelivr from the edge nearest each visitor. An orb is a name, such as
// "aurora" (@aurb/aurora at the latest 1.x, so improved renders arrive without a code change), a pinned version, such
// as "aurora@1.0.0", any npm package, such as "npm:aurb-orb-nebula@1.0.0", or the URL of a folder you host yourself.
export const NPM = "https://cdn.jsdelivr.net/npm";

/** The URL of the folder that holds an orb's files. */
export const folder = (orb: string): string =>
  orb.startsWith("npm:") ? `${NPM}/${orb.slice(4).replace(/\/$/, "")}` // a community orb's package
  : orb.includes("/") ? orb.replace(/\/$/, "") // a folder you host
  : `${NPM}/@aurb/${orb.includes("@") ? orb : orb + "@1"}`; // one of ours, by name

export const parseList = (value: string | null | undefined): string[] =>
  (value || "").split(",").map((s) => s.trim()).filter(Boolean);

const TIERS: Record<string, number> = { sm: 80, md: 160, lg: 320, xl: 640 };

/** Pixel sizes, smallest first, from a list of tiers or numbers such as "sm,md,lg" or "160,320". */
export const parseSizes = (value: string | null | undefined): number[] =>
  parseList(value || "80,160,320")
    .map((s) => TIERS[s] ?? +s)
    .sort((a, b) => a - b);

/** The smallest size that stays sharp at this CSS width on this screen, or the largest there is. */
export const pickSize = (sizes: number[], cssWidth: number): number =>
  sizes.find((s) => s >= cssWidth * (globalThis.devicePixelRatio || 1)) ?? sizes[sizes.length - 1]!;

export const file = (base: string, state: string, theme: Theme, size: number, ext: string): string =>
  `${base}/${state}-${theme}-${size}.${ext}`;

export const warn = (message: string): void => console.warn(`aurb: ${message}`);

/** Save-Data is on, or the connection is 2G: show posters, fetch no video. */
export function slowNetwork(): boolean {
  const connection = (globalThis.navigator as { connection?: { saveData?: boolean; effectiveType?: string } } | undefined)?.connection;
  return !!connection && (connection.saveData || /2g/.test(connection.effectiveType || ""));
}

let webm: boolean | undefined;
export const supportsWebm = (): boolean =>
  (webm ??= !!document.createElement("video").canPlayType('video/webm; codecs="vp09.00.10.08"'));

/** The forced theme if there is one, else the page's: a data-theme or dark/light class, else the system setting. */
export function detectTheme(forced?: string | null): Theme {
  if (forced === "dark" || forced === "light") return forced;
  for (const el of [document.documentElement, document.body]) {
    const attr = el?.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    if (el?.classList.contains("dark")) return "dark";
    if (el?.classList.contains("light")) return "light";
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * A download: a blob: URL once it's in, 0 when the server says the file isn't there (a 4xx), or null when it
 * couldn't be reached, which is worth trying again.
 */
export type Loaded = Promise<string | 0 | null>;

// Every file is fetched whole and played from memory. Static hosts may ignore Range requests, which Safari needs to
// stream a video, and a loop of a few dozen KB gains nothing from streaming. Kept by URL, so nothing downloads twice,
// even on a host without cache headers.
const blobs = new Map<string, Loaded>();

export function load(url: string, priority?: RequestPriority): Loaded {
  if (!blobs.has(url)) {
    const loaded: Loaded = fetch(url, { priority } as RequestInit) // undefined priority is the browser's default
      .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
      .then((b) => URL.createObjectURL(b))
      .catch((status) => {
        blobs.delete(url);
        return status > 399 && status < 500 ? 0 : null;
      });
    blobs.set(url, loaded);
  }
  return blobs.get(url)!;
}

/**
 * Fetch states ahead of time, at low priority, so the first switch to them is instant. Does nothing
 * on Save-Data or 2G, and never fetches the same file twice.
 */
export function prefetch({ orb, states, theme, width = 120, sizes }: PrefetchOptions): void {
  if (typeof document === "undefined" || slowNetwork() || !orb) return;
  const size = pickSize(parseSizes(sizes), width);
  const t = detectTheme(theme);
  const ext = supportsWebm() ? "webm" : "mp4";
  for (const state of ([] as AurbState[]).concat(states)) {
    load(file(folder(orb), canonical(state), t, size, ext), "low").then((u) => u || warn(`${orb}: no ${state}`));
  }
}
