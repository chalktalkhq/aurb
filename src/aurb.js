/*
 * aurb: a tiny player for multi-state animated orbs. Nothing here runs on the render path: video
 * decodes off the main thread, so an orb can never delay a click. It only ever downloads what is
 * on screen, in the current state, theme, and the smallest size that stays sharp.
 */

const prefetched = new Set();

const clean = (src) => (src || "").replace(/\/$/, "");
const slowNetwork = () => {
  const c = globalThis.navigator?.connection;
  return !!c && (c.saveData || /2g/.test(c.effectiveType || ""));
};
const parseList = (v) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);
const parseSizes = (v) => parseList(v || "160,320").map(Number).sort((a, b) => a - b);
const pickSize = (sizes, cssWidth) => sizes.find((s) => s >= cssWidth * (globalThis.devicePixelRatio || 1)) ?? sizes[sizes.length - 1];

let webm;
const supportsWebm = () => webm ??= !!document.createElement("video").canPlayType('video/webm; codecs="vp09.00.10.08"');
const file = (src, state, theme, size, ext) => `${src}/${state}-${theme}-${size}.${ext}`;

function detectTheme(forced) {
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
 * Fetch states ahead of time, at low priority, so the first switch to them is instant. Does nothing
 * on Save-Data or 2G, and never fetches the same file twice.
 */
export function prefetch({ src, states, theme, width = 120, sizes }) {
  if (typeof document === "undefined" || slowNetwork()) return;
  const size = pickSize(parseSizes(sizes), width);
  const t = detectTheme(theme);
  const ext = supportsWebm() ? "webm" : "mp4";
  for (const state of [].concat(states)) {
    const url = file(clean(src), state, t, size, ext);
    if (prefetched.has(url)) continue;
    prefetched.add(url);
    fetch(url, { priority: "low" }).catch(() => prefetched.delete(url));
  }
}

const CSS = `
:host{display:inline-block;width:120px;aspect-ratio:1;vertical-align:middle;flex:none}
.s{position:relative;width:100%;height:100%;border-radius:50%;isolation:isolate;overflow:hidden}
:host([surface=none]) .s{isolation:auto;overflow:visible;border-radius:0}
.k{position:absolute;inset:0;background:center/cover no-repeat;-webkit-mask-image:radial-gradient(closest-side,#000 90%,transparent);mask-image:radial-gradient(closest-side,#000 90%,transparent)}
video{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;pointer-events:none}`;

const transparent = (c) => {
  if (!c || c === "transparent") return true;
  const m = /,\s*([\d.]+)\)$/.exec(c) || /\/\s*([\d.]+)(%?)\s*\)$/.exec(c);
  return !!m && m[1] / (m[2] ? 100 : 1) < 0.99;
};

export class AurbOrb extends (globalThis.HTMLElement ?? class {}) {
  static observedAttributes = ["state", "src", "theme", "surface"];
  #surface; #stack; #videos; #active = null; #shown = null; #token = 0; #since = 0;
  #size; #visible = false; #off = []; #hold; #repaint; #flashBack; #flashTimer; #mp4Only = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    const v = '<video muted loop playsinline disablepictureinpicture tabindex="-1"></video>';
    root.innerHTML = `<style>${CSS}</style><div class="s" part="surface"><div class="k" part="stack">${v}${v}</div></div>`;
    this.#surface = root.firstChild.nextSibling;
    this.#stack = this.#surface.firstChild;
    this.#videos = [...this.#stack.children];
  }

  get state() { return this.getAttribute("state") || "idle"; }
  set state(v) { this.setAttribute("state", v); }

  /** Show a state briefly, then return to the one before it. */
  flash(state, ms = 1500) {
    const back = (this.#flashBack ??= this.state);
    this.state = state;
    clearTimeout(this.#flashTimer);
    this.#flashTimer = setTimeout(() => { this.state = back; this.#flashBack = undefined; }, ms);
  }

  /** Fetch states now, for this orb's size and theme. */
  prefetch(states) {
    prefetch({ src: this.getAttribute("src"), states: states ?? parseList(this.getAttribute("prefetch")), theme: this.getAttribute("theme"), width: this.clientWidth || 120, sizes: this.getAttribute("sizes") });
  }

  /** Fetch states the moment someone shows intent on an element, such as hovering the send button. */
  prefetchOn(target, states) {
    const go = () => this.prefetch(states);
    const events = ["pointerenter", "focusin", "touchstart"];
    for (const e of events) target.addEventListener(e, go, { once: true, passive: true });
    return () => events.forEach((e) => target.removeEventListener(e, go));
  }

  connectedCallback() {
    if (!this.hasAttribute("role")) this.setAttribute("aria-hidden", "true");
    const refresh = () => this.#refresh();
    const listen = (t, e, f) => { t.addEventListener(e, f); this.#off.push(() => t.removeEventListener(e, f)); };
    listen(matchMedia("(prefers-reduced-motion: reduce)"), "change", refresh);
    listen(matchMedia("(prefers-color-scheme: dark)"), "change", refresh);
    listen(document, "visibilitychange", () => this.#sync());
    // The site's own theme switch, on <html> or <body>.
    const mo = new MutationObserver(refresh);
    for (const el of [document.documentElement, document.body]) mo.observe(el, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    this.#off.push(() => mo.disconnect());
    const io = new IntersectionObserver(([e]) => { this.#visible = e.isIntersecting; this.#refresh(); this.#sync(); }, { rootMargin: "200px" });
    io.observe(this);
    this.#off.push(() => io.disconnect());
    if (document.readyState !== "complete" && this.getAttribute("loading") !== "eager") listen(window, "load", refresh);
    this.#refresh();
    // Spare states wait until the page has settled; an orb is never worth slowing first load.
    if (this.hasAttribute("prefetch")) (globalThis.requestIdleCallback ?? setTimeout)(() => this.isConnected && this.prefetch(), { timeout: 4000 });
  }

  disconnectedCallback() {
    this.#off.forEach((f) => f());
    this.#off = [];
    clearTimeout(this.#flashTimer);
    clearTimeout(this.#hold);
    clearTimeout(this.#repaint);
    for (const v of this.#videos) { v.pause(); v.removeAttribute("src"); v.load(); }
    this.#active = this.#shown = null;
  }

  attributeChangedCallback(_, a, b) { if (a !== b && this.isConnected) this.#refresh(); }

  #paint(theme) {
    const s = this.getAttribute("surface") || "auto";
    let bg = s === "none" ? "none" : s;
    if (s === "auto") {
      bg = theme === "dark" ? "#000" : "#fff";
      for (let n = this.parentElement; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (!transparent(c)) { bg = c; break; }
      }
    }
    this.#surface.style.background = bg;
  }

  #refresh() {
    const src = clean(this.getAttribute("src"));
    if (!src) return;
    const theme = detectTheme(this.getAttribute("theme"));
    this.#size ??= this.clientWidth ? pickSize(parseSizes(this.getAttribute("sizes")), this.clientWidth) : undefined;
    const size = this.#size ?? pickSize(parseSizes(this.getAttribute("sizes")), 1e4);
    this.#stack.style.backgroundImage = `url("${src}/poster-${theme}-${size}.jpg")`;
    this.#stack.style.mixBlendMode = theme === "dark" ? "screen" : "multiply";
    this.#paint(theme);
    // A theme change usually animates its colours; look again once they have settled.
    clearTimeout(this.#repaint);
    this.#repaint = setTimeout(() => this.#paint(detectTheme(this.getAttribute("theme"))), 350);

    // Poster only: asked for, reduced motion, or a data-saving connection. No video is fetched.
    if (this.hasAttribute("static") || matchMedia("(prefers-reduced-motion: reduce)").matches || slowNetwork()) {
      for (const v of this.#videos) { v.pause(); v.style.opacity = 0; }
      this.#active = this.#shown = null;
      return;
    }
    // Nothing downloads until the orb is near the screen and the page has finished loading.
    if (!this.#visible || !this.#size || (document.readyState !== "complete" && this.getAttribute("loading") !== "eager")) return;

    const url = file(src, this.state, theme, size, !this.#mp4Only && supportsWebm() ? "webm" : "mp4");
    if (url === this.#shown) return;
    // Anti-flicker: a fast response should not flash through every state on its way past.
    const wait = Number(this.getAttribute("hold") ?? 200) - (Date.now() - this.#since);
    clearTimeout(this.#hold);
    if (this.#active && wait > 0) { this.#hold = setTimeout(() => this.#refresh(), wait); return; }
    this.#switch(url);
  }

  #sync() {
    const play = this.#visible && document.visibilityState === "visible";
    if (this.#active) play ? this.#active.play().catch(() => {}) : this.#active.pause();
  }

  // The new video fades in on top of the old, which stays solid, so brightness never dips. Every
  // state shares one body and starts at the same moment in the loop, so it reads as one object.
  async #switch(url) {
    const token = ++this.#token;
    const from = this.#active;
    const to = this.#videos[from === this.#videos[0] ? 1 : 0];
    const s = to.style;
    this.#shown = url;
    s.transition = "none";
    s.opacity = 0;
    to.src = url;
    try {
      await new Promise((res, rej) => {
        to.addEventListener("loadedmetadata", res, { once: true });
        to.addEventListener("error", rej, { once: true });
      });
      if (token !== this.#token) return;
      if (from?.duration && to.duration) to.currentTime = from.currentTime % to.duration;
      await to.play();
      await new Promise((res) => (to.requestVideoFrameCallback ? to.requestVideoFrameCallback(res) : setTimeout(res, 50)));
    } catch {
      if (token !== this.#token) return;
      this.#shown = from?.src ?? null;
      // VP9 may be advertised and still fail, so try H.264 once. If that fails too, the file is just
      // missing: VP9 was never the problem, so keep it, and the current picture stays.
      if (url.endsWith(".webm")) { this.#mp4Only = true; this.#refresh(); } else this.#mp4Only = false;
      return;
    }
    if (token !== this.#token) return;
    const ms = from ? Number(this.getAttribute("transition") ?? 500) : 350;
    if (from) from.style.zIndex = 0;
    s.zIndex = 1;
    to.getBoundingClientRect(); // commit the starting opacity before animating it
    s.transition = `opacity ${ms}ms ease-in-out`;
    s.opacity = 1;
    this.#active = to;
    this.#since = Date.now();
    this.dispatchEvent(new CustomEvent("aurbstatechange", { detail: { state: this.state } }));
    setTimeout(() => {
      if (token !== this.#token || !from) return;
      from.pause();
      from.style.transition = "none";
      from.style.opacity = 0;
    }, ms + 40);
    this.#sync();
  }
}

if (globalThis.customElements && !customElements.get("aurb-orb")) customElements.define("aurb-orb", AurbOrb);
