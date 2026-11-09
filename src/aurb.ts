/*
 * aurb: a tiny player for multi-state animated orbs. Video decodes off the main thread, so an orb
 * can never delay a click. It only ever downloads what is on screen, in the current state, theme,
 * and the smallest size that stays sharp.
 */
import { canonical, detectTheme, file, folder, load, parseList, parseSizes, pickSize, prefetch, slowNetwork, supportsWebm, warn, type Loaded } from "./shared.js";
import type { AurbErrorDetail, AurbOrbEventMap, AurbState, Theme } from "./types.js";

export { prefetch };
export type { AurbErrorDetail, AurbOrbEventMap, AurbState, AurbStates, PrefetchOptions } from "./types.js";

/** Runs just before a new video is cut in, to line it up with the one showing. @internal */
export type Join = (to: HTMLVideoElement, from: HTMLVideoElement | null) => Promise<void>;
/** Shows a file: resolves to 1 once it's on screen, or undefined when it couldn't be. @internal */
export type Show = (url: string, state: string, join?: Join) => Promise<1 | undefined>;

const CSS = `
:host{display:inline-block;width:120px;aspect-ratio:1;vertical-align:middle;flex:none}
.s{position:relative;width:100%;height:100%;border-radius:50%;isolation:isolate;overflow:hidden}
:host([surface=none]) .s{isolation:auto;overflow:visible;border-radius:0}
.k{position:absolute;inset:0;background:center/cover no-repeat;-webkit-mask-image:radial-gradient(closest-side,#000 90%,transparent);mask-image:radial-gradient(closest-side,#000 90%,transparent)}
video{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;pointer-events:none}`;

/** Whether a computed background colour lets what's behind it show through. */
function transparent(color: string): boolean {
  if (!color || color === "transparent") return true;
  const alpha = /,\s*([\d.]+)\)$/.exec(color) || /\/\s*([\d.]+)(%?)\s*\)$/.exec(color);
  return !!alpha && +alpha[1]! / (alpha[2] ? 100 : 1) < 0.99;
}

const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

// One set of observers for every orb on the page, so ten orbs cost the same as one to watch.
const orbs = new Set<AurbOrb>();
// An orb made in one theme has no files in the other: the theme it does have, by folder, once a poster is missing.
// An empty string means it has neither.
const only = new Map<string, Theme | "">();
let intersections: IntersectionObserver | undefined;
let resizes: ResizeObserver | undefined;
let pageTheme: Theme | undefined;

const refreshAll = (): void => orbs.forEach((o) => o.refresh());

function watchPage(): void {
  if (intersections) return;
  const onTheme = () => {
    // Most changes to <html> and <body> classes have nothing to do with theme, so ignore those.
    const theme = detectTheme();
    if (theme !== pageTheme) {
      pageTheme = theme;
      refreshAll();
    }
  };
  pageTheme = detectTheme();
  intersections = new IntersectionObserver((entries) => entries.forEach((e) => (e.target as AurbOrb)._seen(e.isIntersecting)), { rootMargin: "200px" });
  resizes = new ResizeObserver((entries) => entries.forEach((e) => (e.target as AurbOrb)._grown()));
  const mutations = new MutationObserver(onTheme);
  for (const el of [document.documentElement, document.body]) {
    if (el) mutations.observe(el, { attributes: true, attributeFilter: ["class", "data-theme"] });
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onTheme);
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", refreshAll);
  document.addEventListener("visibilitychange", refreshAll);
  addEventListener("online", refreshAll);
  if (document.readyState !== "complete") addEventListener("load", refreshAll, { once: true });
}

// Guarded, so a page that renders on the server can import it.
const Base = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement;

export class AurbOrb extends Base {
  static observedAttributes: string[] = ["state", "orb", "sizes", "theme", "surface", "paused", "speed", "static", "prefetch"];

  /**
   * Set by `@aurb/player/rest`, which can take a change of state over. Returns true when it has.
   * @internal
   */
  static rest?: (orb: AurbOrb, url: string, show: Show) => boolean;

  #surface: HTMLDivElement;
  #stack: HTMLDivElement;
  #videos: HTMLVideoElement[];
  /** The video on top, and the file it plays once it has faded in. */
  #active: HTMLVideoElement | null = null;
  #shownSrc: string | null = null;
  /** The file showing or on its way, so a refresh that asks for it again does nothing. */
  #shown: string | null = null;
  /** Bumped by every switch, so a slower one that finishes late knows it's stale. */
  #token = 0;
  /** No new switch until then, so a fade always finishes. */
  #busyUntil = 0;
  #size: number | undefined;
  #poster: string | null | undefined;
  #posterLoaded: Loaded | undefined;
  #visible = false;
  #hold: ReturnType<typeof setTimeout> | undefined;
  #repaint: ReturnType<typeof setTimeout> | undefined;
  #flashBack: AurbState | undefined;
  #flashTimer: ReturnType<typeof setTimeout> | undefined;
  #mp4Only = false;
  #ready = false;
  #queued = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    const video = '<video muted loop playsinline disablepictureinpicture tabindex="-1"></video>';
    root.innerHTML = `<style>${CSS}</style><div class="s" part="surface"><div class="k" part="stack">${video}${video}</div></div>`;
    this.#surface = root.lastChild as HTMLDivElement;
    this.#stack = this.#surface.firstChild as HTMLDivElement;
    this.#videos = [...this.#stack.children] as HTMLVideoElement[];
  }

  get state(): AurbState {
    return (this.getAttribute("state") || "idle") as AurbState;
  }
  set state(value: AurbState) {
    this.setAttribute("state", value);
  }

  /** Freeze on the current frame and stop decoding. Useful for lists of many orbs. */
  get paused(): boolean {
    return this.hasAttribute("paused");
  }
  set paused(value: boolean) {
    this.toggleAttribute("paused", !!value);
  }

  /** Show a state briefly, then return to the one before it. */
  flash(state: AurbState, ms = 1500): void {
    const back = (this.#flashBack ??= this.state);
    this.state = state;
    clearTimeout(this.#flashTimer);
    this.#flashTimer = setTimeout(() => {
      this.state = back;
      this.#flashBack = undefined;
    }, ms);
  }

  #fetchAhead(states?: AurbState | readonly AurbState[]): void {
    const orb = this.getAttribute("orb");
    prefetch({
      orb: orb!,
      states: states ?? (parseList(this.getAttribute("prefetch")) as AurbState[]),
      theme: this.#theme(folder(orb || "")),
      width: this.clientWidth || 120,
      sizes: this.getAttribute("sizes"),
    });
  }

  // A method to call and an attribute to set, under one name. React 19 assigns a prop as a property when
  // the element has one by that name, so a plain method would be replaced by the string.
  /** Fetch states now, for this orb's size and theme. Defaults to the `prefetch` attribute. */
  get prefetch(): (states?: AurbState | readonly AurbState[]) => void {
    return this.#fetchAhead;
  }
  set prefetch(value: string | null | undefined) {
    if (value == null) this.removeAttribute("prefetch");
    else this.setAttribute("prefetch", value);
  }

  // Spare states wait until the page has settled; an orb is never worth slowing first load.
  #fetchWhenIdle(): void {
    const whenIdle = (globalThis.requestIdleCallback ?? setTimeout) as typeof requestIdleCallback;
    whenIdle(() => this.isConnected && this.prefetch(), { timeout: 4000 });
  }

  /** Fetch states on hover, focus, or touch of another element, such as the send button. Returns a cleanup function. */
  prefetchOn(target: EventTarget, states: AurbState | readonly AurbState[]): () => void {
    const go = () => this.prefetch(states);
    const events = ["pointerenter", "focusin", "touchstart"];
    for (const e of events) target.addEventListener(e, go, { once: true, passive: true });
    return () => events.forEach((e) => target.removeEventListener(e, go));
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("aria-hidden", "true");
    watchPage();
    orbs.add(this);
    intersections!.observe(this);
    resizes!.observe(this);
    this.refresh();
    if (this.hasAttribute("prefetch")) this.#fetchWhenIdle();
  }

  disconnectedCallback(): void {
    orbs.delete(this);
    intersections!.unobserve(this);
    resizes!.unobserve(this);
    this.#token++;
    clearTimeout(this.#flashTimer);
    clearTimeout(this.#hold);
    clearTimeout(this.#repaint);
    for (const v of this.#videos) {
      v.pause();
      v.removeAttribute("src");
      v.load();
      v.style.opacity = "0";
    }
    this.#active = this.#shown = this.#shownSrc = null;
    this.#visible = false;
    this.#busyUntil = 0;
  }

  attributeChangedCallback(name: string, before: string | null, after: string | null): void {
    if (before === after || !this.isConnected) return;
    if (name === "prefetch") return this.#fetchWhenIdle();
    // Another orb or tier list may not have the size picked for the old one: the other presets stop at lg.
    if (name === "orb" || name === "sizes") this.#size = undefined;
    // Frameworks set several attributes in a row, such as orb then sizes. Act once, on all of them.
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      this.refresh();
    });
  }

  /** Called by the shared observers when the orb comes near the screen or leaves it. @internal */
  _seen(visible: boolean): void {
    this.#visible = visible;
    this.refresh();
  }

  /** Called by the shared observers when the orb changes size. @internal */
  _grown(): void {
    // Only ever upward: a larger file is already downloaded, so shrinking would waste a fetch.
    const next = this.clientWidth && pickSize(parseSizes(this.getAttribute("sizes")), this.clientWidth);
    if (next > (this.#size ?? 0)) {
      this.#size = next;
      this.refresh();
    }
  }

  /** Paint the surface behind the orb: the colour of whatever is behind it on the page, unless told otherwise. */
  #paint(theme: Theme): void {
    const surface = this.getAttribute("surface") || "auto";
    let background = surface;
    if (surface === "auto") {
      background = theme === "dark" ? "#000" : "#fff";
      for (let n = this.parentElement; n; n = n.parentElement) {
        const color = getComputedStyle(n).backgroundColor;
        if (!transparent(color)) {
          background = color;
          break;
        }
      }
    }
    this.#surface.style.background = background;
  }

  /** The page's theme, unless this orb only comes in the other one. */
  #theme(src: string): Theme {
    return only.get(src) || detectTheme(this.getAttribute("theme"));
  }

  /** Re-read the theme and the colour behind the orb, if your app changes them in a way it can't see. */
  refresh(): void {
    const orb = this.getAttribute("orb");
    if (!orb) return;
    const src = folder(orb);
    const theme = this.#theme(src);
    const sizes = parseSizes(this.getAttribute("sizes"));
    if (!this.#size && this.clientWidth) this.#size = pickSize(sizes, this.clientWidth);
    const size = this.#size ?? sizes[sizes.length - 1]!;

    this.#showPoster(orb, src, theme, size);
    this.#stack.style.mixBlendMode = theme === "dark" ? "screen" : "multiply";
    this.#paint(theme);
    // A theme change usually animates its colours; look again once they have settled.
    clearTimeout(this.#repaint);
    this.#repaint = setTimeout(() => this.#paint(this.#theme(src)), 350);

    // Poster only: asked for, reduced motion, or a data-saving connection. No video is fetched.
    if (this.hasAttribute("static") || reducedMotion() || slowNetwork()) {
      for (const v of this.#videos) {
        v.pause();
        v.style.opacity = "0";
      }
      this.#active = this.#shown = null;
      return;
    }
    this.#sync();
    // Nothing downloads until the orb is near the screen, the tab is showing, and the page has loaded.
    const pageLoaded = document.readyState === "complete" || this.getAttribute("loading") === "eager";
    if (!this.#visible || !this.#size || document.visibilityState !== "visible" || !pageLoaded) return;

    const state = canonical(this.state);
    const url = file(src, state, theme, size, !this.#mp4Only && supportsWebm() ? "webm" : "mp4");
    if (url === this.#shown) return;
    // @aurb/player/rest can take a change over: solid orbs move through a rest pose instead of crossfading.
    if (AurbOrb.rest?.(this, url, this.#switch.bind(this))) return;
    // Wait for a fade to finish: the next video takes the element underneath it, and swapping that
    // mid-fade leaves a hole in the picture. The hold also stops fast responses flickering past.
    const wait = this.#busyUntil - Date.now();
    clearTimeout(this.#hold);
    if (this.#active && wait > 0) {
      this.#hold = setTimeout(() => this.refresh(), wait);
      return;
    }
    this.#switch(url, state);
  }

  // The poster is fetched like the videos, alongside the first one, and the old poster stays until the new one is in,
  // so a change of theme or size never flashes empty. A missing poster means the orb has no such theme: one made
  // in one theme switches to it, videos too. Missing in both, the name or URL is wrong. Unreachable, it's retried.
  #showPoster(orb: string, src: string, theme: Theme, size: number): void {
    const poster = `${src}/poster-${theme}-${size}.jpg`;
    if (poster === this.#poster) return;
    this.#poster = poster;
    this.#posterLoaded = load(poster);
    this.#posterLoaded.then((url) => {
      if (this.#poster !== poster) return;
      if (url) {
        this.#stack.style.backgroundImage = `url("${url}")`;
      } else if (url === null) {
        this.#poster = null; // unreachable: forget it, so the next refresh tries again
      } else if (!only.has(src)) {
        only.set(src, theme === "dark" ? "light" : "dark");
        this.refresh();
      } else if (only.get(src) === theme) {
        only.set(src, "");
        warn(`${orb}: nothing at ${src}`);
        this.#emit("aurberror", { state: this.state, url: poster, reason: "missing" });
      }
    });
  }

  /** Play or pause the video on top, to match whether the orb can be seen. */
  #sync(): void {
    const video = this.#active;
    if (!video) return;
    video.playbackRate = Number(this.getAttribute("speed") ?? 1);
    if (this.#visible && document.visibilityState === "visible" && !this.paused) video.play().catch(() => {});
    else video.pause();
  }

  /** The crossfade into a state, in ms: "500", or "500 thinking:250 error:150" to set some states apart. */
  #fadeFor(state: string): number {
    let ms = 500;
    for (const part of (this.getAttribute("transition") ?? "").split(/\s+/)) {
      const [name, value] = part.split(":");
      if (value === undefined) {
        // A word, such as rest for @aurb/player/rest, leaves the default.
        if (name && +name >= 0) ms = +name;
      } else if (name === state) {
        return Number(value);
      }
    }
    return ms;
  }

  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // The new video fades in on top of the old, which stays solid, so brightness never dips. Every
  // state shares one body and starts at the same moment in the loop, so it reads as one object.
  async #switch(url: string, state: string, join?: Join): Promise<1 | undefined> {
    const token = ++this.#token;
    const from = this.#active;
    const to = this.#videos[from === this.#videos[0] ? 1 : 0]!;
    const style = to.style;
    const done = new AbortController();
    this.#shown = url;
    try {
      const held = await load(url);
      if (token !== this.#token) return;
      if (!held) throw held;
      style.transition = "none";
      style.opacity = "0";
      to.src = held;
      await new Promise((resolve, reject) => {
        to.addEventListener("loadedmetadata", resolve, { signal: done.signal });
        to.addEventListener("error", () => reject(new Error("load")), { signal: done.signal });
      });
      if (token !== this.#token) return;
      if (join) await join(to, from);
      else if (from?.duration && to.duration) to.currentTime = from.currentTime % to.duration;
      to.playbackRate = Number(this.getAttribute("speed") ?? 1);
      await to.play();
      await new Promise((resolve) => (to.requestVideoFrameCallback ? to.requestVideoFrameCallback(resolve) : setTimeout(resolve, 50)));
    } catch (e) {
      if (token !== this.#token) return;
      this.#shown = this.#shownSrc;
      // Blocked autoplay is not a broken file: stay on the poster and download nothing more.
      if ((e as Error | null)?.name === "NotAllowedError") {
        this.#emit("aurberror", { state, url, reason: "blocked" } satisfies AurbErrorDetail);
        return;
      }
      // Couldn't reach it: nothing is wrong with the orb, so change nothing, and try again: on coming back online,
      // or in a few seconds when a server failed. The current picture stays meanwhile.
      if (e === null) {
        if (navigator.onLine) setTimeout(() => token === this.#token && this.refresh(), 5e3);
        return;
      }
      if (e === 0) {
        // Not there, and nor is this theme's poster: the orb has no such theme, and the poster's answer moves it over.
        // A rest sheet that fails is a missing file too: @aurb/player/rest falls back to a crossfade.
        if ((await this.#posterLoaded) === 0 || token !== this.#token) return;
      } else if (!join && url.endsWith("webm")) {
        // Downloaded but wouldn't play: VP9 can be advertised and still fail, so H.264 from here on.
        this.#mp4Only = true;
        this.refresh();
        return;
      }
      warn(`${this.getAttribute("orb")}: no ${state}`);
      this.#emit("aurberror", { state, url, reason: "missing" } satisfies AurbErrorDetail);
      return;
    } finally {
      done.abort();
    }
    if (token !== this.#token) return;

    const ms = join ? 30 : from ? this.#fadeFor(state) : 350; // a join is always onto a matching, held frame
    if (from) from.style.zIndex = "0";
    style.zIndex = "1";
    to.getBoundingClientRect(); // commit the starting opacity before animating it
    style.transition = `opacity ${ms}ms ease-in-out`;
    style.opacity = "1";
    this.#active = to;
    this.#shownSrc = url;
    this.#busyUntil = Date.now() + Math.max(ms + 60, Number(this.getAttribute("hold") ?? 200));
    if (!this.#ready) {
      this.#ready = true;
      this.#emit("aurbready");
    }
    this.#emit("aurbstatechange", { state: this.state });
    this.#sync();
    if (from) {
      setTimeout(() => {
        if (token !== this.#token) return;
        from.pause();
        from.style.transition = "none";
        from.style.opacity = "0";
      }, ms + 40);
    }
    return 1;
  }
}

// Typed events: `orb.addEventListener("aurbstatechange", (e) => e.detail.state)`. Types only, so nothing ships.
export interface AurbOrb {
  addEventListener<K extends keyof AurbOrbEventMap>(type: K, listener: (this: AurbOrb, event: AurbOrbEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof AurbOrbEventMap>(type: K, listener: (this: AurbOrb, event: AurbOrbEventMap[K]) => unknown, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "aurb-orb": AurbOrb;
  }
}

if (globalThis.customElements && !customElements.get("aurb-orb")) customElements.define("aurb-orb", AurbOrb);
