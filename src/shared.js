// What the player and the standalone prefetch entry have in common. No side effects, and no
// reference to the element, so `aurb/prefetch` stays a few hundred bytes.

export const ALIASES = { running: "working", busy: "working", loading: "thinking", processing: "thinking", talking: "speaking", recording: "listening", done: "success", failed: "error", sleeping: "asleep", dormant: "asleep", default: "idle" };

export const clean = (src) => (src || "").replace(/\/$/, "");
export const parseList = (v) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);
export const parseSizes = (v) => parseList(v || "160,320").map(Number).sort((a, b) => a - b);
export const pickSize = (sizes, cssWidth) => sizes.find((s) => s >= cssWidth * (globalThis.devicePixelRatio || 1)) ?? sizes[sizes.length - 1];
export const file = (src, state, theme, size, ext) => `${src}/${state}-${theme}-${size}.${ext}`;
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

// Prefetched files are kept as blobs, not left to the HTTP cache. On a host without cache headers
// the cache would miss and the file would download a second time, making prefetch worse than nothing.
export const blobs = new Map();

/**
 * Fetch states ahead of time, at low priority, so the first switch to them is instant. Does nothing
 * on Save-Data or 2G, and never fetches the same file twice.
 */
export function prefetch({ src, states, theme, width = 120, sizes }) {
  if (typeof document === "undefined" || slowNetwork()) return;
  const size = pickSize(parseSizes(sizes), width);
  const t = detectTheme(theme);
  const ext = supportsWebm() ? "webm" : "mp4";
  for (const state of [].concat(states)) {
    const url = file(clean(src), ALIASES[state] ?? state, t, size, ext);
    if (blobs.has(url)) continue;
    blobs.set(url, fetch(url, { priority: "low" })
      .then((r) => { if (!r.ok) throw warn(`could not prefetch ${url} (${r.status}). Was "${state}" built with: aurb add --states ...?`); return r.blob(); })
      .then((b) => URL.createObjectURL(b))
      .catch(() => { blobs.delete(url); return null; }));
  }
}
