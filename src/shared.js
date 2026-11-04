// What the player and the standalone prefetch entry have in common. No side effects, and no
// reference to the element, so `aurb/prefetch` stays a few hundred bytes.

export const ALIASES = { running: "working", busy: "working", loading: "thinking", processing: "thinking", talking: "speaking", recording: "listening", done: "success", failed: "error", sleeping: "asleep", dormant: "asleep", default: "idle" };

// Every orb is an npm package, served free by jsDelivr from the edge nearest each visitor. An orb is a name, such as
// "aurora" (@aurb/aurora at the latest 1.x, so improved renders arrive without a code change), a pinned version, such
// as "aurora@1.0.2", any npm package, such as "npm:aurb-orb-nebula@1.0.2", or the URL of a folder you host yourself.
export const NPM = "https://cdn.jsdelivr.net/npm";
export const folder = (orb) => orb.startsWith("npm:") ? `${NPM}/${orb.slice(4).replace(/\/$/, "")}` : orb.includes("/") ? orb.replace(/\/$/, "") : `${NPM}/@aurb/${orb.includes("@") ? orb : orb + "@1"}`;

export const parseList = (v) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);
const TIERS = { sm: 80, md: 160, lg: 320, xl: 640 };
export const parseSizes = (v) => parseList(v || "80,160,320").map((s) => TIERS[s] ?? +s).sort((a, b) => a - b);
export const pickSize = (sizes, cssWidth) => sizes.find((s) => s >= cssWidth * (globalThis.devicePixelRatio || 1)) ?? sizes[sizes.length - 1];
export const file = (base, state, theme, size, ext) => `${base}/${state}-${theme}-${size}.${ext}`;
export const warn = (msg) => console.warn(`aurb: ${msg}`);

export const slowNetwork = () => {
  const c = globalThis.navigator?.connection;
  return !!c && (c.saveData || /2g/.test(c.effectiveType || ""));
};

let webm;
export const supportsWebm = () => webm ??= !!document.createElement("video").canPlayType('video/webm; codecs="vp09.00.10.08"');

export function detectTheme(forced) {
  if (forced === "dark" || forced === "light") return forced;
  for (const el of [document.documentElement, document.body]) {
    const attr = el?.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    if (el?.classList.contains("dark")) return "dark";
    if (el?.classList.contains("light")) return "light";
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Resolves to a blob: URL, to 0 when the server says the file isn't there (a 4xx), or to null when it couldn't be
// reached, which is worth trying again. Every file is fetched whole and played from memory. Static hosts may ignore Range requests, which Safari needs to
// stream a video, and a loop of a few dozen KB gains nothing from streaming. Kept by URL, so nothing downloads twice,
// even on a host without cache headers.
export const blobs = new Map();
export function load(url, priority) {
  if (!blobs.has(url)) blobs.set(url, fetch(url, { priority })
    .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
    .then((b) => URL.createObjectURL(b))
    .catch((e) => (blobs.delete(url), e > 399 && e < 500 ? 0 : null)));
  return blobs.get(url);
}

/**
 * Fetch states ahead of time, at low priority, so the first switch to them is instant. Does nothing
 * on Save-Data or 2G, and never fetches the same file twice.
 */
export function prefetch({ orb, states, theme, width = 120, sizes }) {
  if (typeof document === "undefined" || slowNetwork() || !orb) return;
  const size = pickSize(parseSizes(sizes), width);
  const t = detectTheme(theme);
  const ext = supportsWebm() ? "webm" : "mp4";
  for (const state of [].concat(states)) load(file(folder(orb), ALIASES[state] ?? state, t, size, ext), "low").then((u) => u || warn(`${orb}: no ${state}`));
}
