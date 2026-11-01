/*
 * aurb: a tiny player for multi-state animated orbs. Video decodes off the main thread, so an orb
 * can never delay a click. It only ever downloads what is on screen, in the current state, theme,
 * and the smallest size that stays sharp.
 */
import { ALIASES, blobs, clean, detectTheme, file, parseList, parseSizes, pickSize, prefetch, slowNetwork, supportsWebm, warn } from "./shared.js";

export { prefetch };

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
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// One set of observers for every orb on the page, so ten orbs cost the same as one to watch.
const orbs = new Set();
let io, ro, pageTheme;
const each = (f) => orbs.forEach(f);
function watchPage() {
  if (io) return;
  const onTheme = () => {
    // Most changes to <html> and <body> classes have nothing to do with theme, so ignore those.
    const t = detectTheme();
    if (t !== pageTheme) { pageTheme = t; each((o) => o.refresh()); }
  };
  pageTheme = detectTheme();
  io = new IntersectionObserver((es) => es.forEach((e) => e.target._seen(e.isIntersecting)), { rootMargin: "200px" });
  ro = new ResizeObserver((es) => es.forEach((e) => e.target._grown()));
  const mo = new MutationObserver(onTheme);
  for (const el of [document.documentElement, document.body]) el && mo.observe(el, { attributes: true, attributeFilter: ["class", "data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onTheme);
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => each((o) => o.refresh()));
  document.addEventListener("visibilitychange", () => each((o) => o.refresh()));
  if (document.readyState !== "complete") addEventListener("load", () => each((o) => o.refresh()), { once: true });
}

export class AurbOrb extends (globalThis.HTMLElement ?? class {}) {
  static observedAttributes = ["state", "src", "theme", "surface", "paused", "speed", "static"];
  #surface; #stack; #videos; #active = null; #shown = null; #shownSrc = null; #token = 0; #busyUntil = 0;
  #size; #visible = false; #hold; #repaint; #flashBack; #flashTimer; #mp4Only = false; #ready = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    const v = '<video muted loop playsinline disablepictureinpicture tabindex="-1"></video>';
    root.innerHTML = `<style>${CSS}</style><div class="s" part="surface"><div class="k" part="stack">${v}${v}</div></div>`;
    this.#surface = root.lastChild;
    this.#stack = this.#surface.firstChild;
    this.#videos = [...this.#stack.children];
  }

  get state() { return this.getAttribute("state") || "idle"; }
  set state(v) { this.setAttribute("state", v); }
  get paused() { return this.hasAttribute("paused"); }
  set paused(v) { this.toggleAttribute("paused", !!v); }

  /** Show a state briefly, then return to the one before it. */
  flash(state, ms = 1500) {
    const back = (this.#flashBack ??= this.state);
    this.state = state;
    clearTimeout(this.#flashTimer);
    this.#flashTimer = setTimeout(() => { this.state = back; this.#flashBack = undefined; }, ms);
  }

  /** Fetch states now, for this orb's size and theme. Defaults to the `prefetch` attribute. */
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
    watchPage();
    orbs.add(this);
    io.observe(this);
    ro.observe(this);
    this.refresh();
    // Spare states wait until the page has settled; an orb is never worth slowing first load.
    if (this.hasAttribute("prefetch")) (globalThis.requestIdleCallback ?? setTimeout)(() => this.isConnected && this.prefetch(), { timeout: 4000 });
  }

  disconnectedCallback() {
    orbs.delete(this);
    io.unobserve(this);
    ro.unobserve(this);
    this.#token++;
    clearTimeout(this.#flashTimer);
    clearTimeout(this.#hold);
    clearTimeout(this.#repaint);
    for (const v of this.#videos) { v.pause(); v.removeAttribute("src"); v.load(); v.style.opacity = 0; }
    this.#active = this.#shown = this.#shownSrc = null;
    this.#visible = false;
    this.#busyUntil = 0;
  }

  attributeChangedCallback(_, a, b) { if (a !== b && this.isConnected) this.refresh(); }

  // Called by the shared observers.
  _seen(on) { this.#visible = on; this.refresh(); }
  _grown() {
    // Only ever upward: a larger file is already downloaded, so shrinking would waste a fetch.
    const next = this.clientWidth && pickSize(parseSizes(this.getAttribute("sizes")), this.clientWidth);
    if (next > (this.#size ?? 0)) { this.#size = next; this.refresh(); }
  }

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

  /** Re-read the theme and the colour behind the orb, if your app changes them in a way it can't see. */
  refresh() {
    const src = clean(this.getAttribute("src"));
    if (!src) return;
    const theme = detectTheme(this.getAttribute("theme"));
    const sizes = parseSizes(this.getAttribute("sizes"));
    if (!this.#size && this.clientWidth) this.#size = pickSize(sizes, this.clientWidth);
    const size = this.#size ?? sizes[sizes.length - 1];
    this.#stack.style.backgroundImage = `url("${src}/poster-${theme}-${size}.jpg")`;
    this.#stack.style.mixBlendMode = theme === "dark" ? "screen" : "multiply";
    this.#paint(theme);
    // A theme change usually animates its colours; look again once they have settled.
    clearTimeout(this.#repaint);
    this.#repaint = setTimeout(() => this.#paint(detectTheme(this.getAttribute("theme"))), 350);

    // Poster only: asked for, reduced motion, or a data-saving connection. No video is fetched.
    if (this.hasAttribute("static") || reducedMotion() || slowNetwork()) {
      for (const v of this.#videos) { v.pause(); v.style.opacity = 0; }
      this.#active = this.#shown = null;
      return;
    }
    this.#sync();
    // Nothing downloads until the orb is near the screen, the tab is showing, and the page has loaded.
    if (!this.#visible || !this.#size || document.visibilityState !== "visible" || (document.readyState !== "complete" && this.getAttribute("loading") !== "eager")) return;

    const state = ALIASES[this.state] ?? this.state;
    const url = file(src, state, theme, size, !this.#mp4Only && supportsWebm() ? "webm" : "mp4");
    if (url === this.#shown) return;
    // Wait for a fade to finish: the next video takes the element underneath it, and swapping that
    // mid-fade leaves a hole in the picture. The hold also stops fast responses flickering past.
    const wait = this.#busyUntil - Date.now();
    clearTimeout(this.#hold);
    if (this.#active && wait > 0) { this.#hold = setTimeout(() => this.refresh(), wait); return; }
    this.#switch(url, state);
  }

  #sync() {
    const v = this.#active;
    if (!v) return;
    v.playbackRate = Number(this.getAttribute("speed") ?? 1);
    if (this.#visible && document.visibilityState === "visible" && !this.paused) v.play().catch(() => {});
    else v.pause();
  }

  #fadeFor(state) {
    // "500" or "500 thinking:250 error:150"
    let ms = 500;
    for (const part of (this.getAttribute("transition") ?? "").split(/\s+/)) {
      const [a, b] = part.split(":");
      if (b === undefined) { if (a) ms = Number(a); } else if (a === state) return Number(b);
    }
    return ms;
  }

  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // The new video fades in on top of the old, which stays solid, so brightness never dips. Every
  // state shares one body and starts at the same moment in the loop, so it reads as one object.
  async #switch(url, state) {
    const token = ++this.#token;
    const from = this.#active;
    const to = this.#videos[from === this.#videos[0] ? 1 : 0];
    const s = to.style;
    const done = new AbortController();
    this.#shown = url;
    try {
      const held = await blobs.get(url);
      if (token !== this.#token) return;
      s.transition = "none";
      s.opacity = 0;
      to.src = held ?? url;
      await new Promise((res, rej) => {
        to.addEventListener("loadedmetadata", res, { signal: done.signal });
        to.addEventListener("error", () => rej(new Error("load")), { signal: done.signal });
      });
      if (token !== this.#token) return;
      if (from?.duration && to.duration) to.currentTime = from.currentTime % to.duration;
      to.playbackRate = Number(this.getAttribute("speed") ?? 1);
      await to.play();
      await new Promise((res) => (to.requestVideoFrameCallback ? to.requestVideoFrameCallback(res) : setTimeout(res, 50)));
    } catch (e) {
      if (token !== this.#token) return;
      this.#shown = this.#shownSrc;
      // Blocked autoplay is not a broken file: stay on the poster and download nothing more.
      if (e.name === "NotAllowedError") return this.#emit("aurberror", { state, url, reason: "blocked" });
      // VP9 may be advertised and still fail, so try H.264 once. If that fails too, the file is just
      // missing: VP9 was never the problem, so keep it, and the current picture stays.
      if (url.endsWith(".webm")) { this.#mp4Only = true; return this.refresh(); }
      this.#mp4Only = false;
      warn(`no video at ${url}. Build this state with: aurb add --states ${state}`);
      return this.#emit("aurberror", { state, url, reason: "missing" });
    } finally {
      done.abort();
    }
    if (token !== this.#token) return;
    const ms = from ? this.#fadeFor(state) : 350;
    if (from) from.style.zIndex = 0;
    s.zIndex = 1;
    to.getBoundingClientRect(); // commit the starting opacity before animating it
    s.transition = `opacity ${ms}ms ease-in-out`;
    s.opacity = 1;
    this.#active = to;
    this.#shownSrc = url;
    this.#busyUntil = Date.now() + Math.max(ms + 60, Number(this.getAttribute("hold") ?? 200));
    if (!this.#ready) { this.#ready = true; this.#emit("aurbready"); }
    this.#emit("aurbstatechange", { state: this.state });
    this.#sync();
    if (from) setTimeout(() => {
      if (token !== this.#token) return;
      from.pause();
      from.style.transition = "none";
      from.style.opacity = 0;
    }, ms + 40);
  }
}

if (globalThis.customElements && !customElements.get("aurb-orb")) customElements.define("aurb-orb", AurbOrb);
