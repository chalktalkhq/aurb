/**
 * Every state an orb can be in. Add your own from aurb.config.json with declaration merging, which
 * `aurb build` writes for you:
 *
 *     declare module "aurb" { interface AurbStates { celebrate: true } }
 */
export interface AurbStates {
  idle: true; listening: true; thinking: true; working: true; speaking: true; success: true; error: true; asleep: true;
  // Other names for the same states.
  running: true; busy: true; loading: true; processing: true; talking: true; recording: true; done: true; failed: true; sleeping: true; dormant: true; default: true;
}
export type AurbState = keyof AurbStates;

export interface PrefetchOptions {
  /** An orb's name, such as "aurora", a pinned version, such as "aurora@1.0.2", a community orb's npm package, such as "npm:aurb-orb-nebula@1.0.2", or the URL of a folder you host yourself. */
  orb: string;
  states: AurbState | readonly AurbState[];
  /** Defaults to the page's current theme. */
  theme?: "dark" | "light" | null | undefined;
  /** Display width in CSS pixels; picks the file size. Defaults to 120. */
  width?: number | undefined;
  /** Tiers to choose from: sm, md, lg, xl, or pixel sizes. Defaults to "sm,md,lg". Set one to force it. */
  sizes?: string | null | undefined;
}

/** Fetch states ahead at low priority. Does nothing on Save-Data or 2G. */
export function prefetch(options: PrefetchOptions): void;

export interface AurbErrorDetail {
  state: string;
  url: string;
  /** missing: no file for this state. blocked: the browser refused to autoplay, so the poster stays. */
  reason: "missing" | "blocked";
}

export interface AurbOrbEventMap extends HTMLElementEventMap {
  /** A new state is on screen. */
  aurbstatechange: CustomEvent<{ state: AurbState }>;
  /** The first video frame is showing. */
  aurbready: CustomEvent<undefined>;
  /** A state could not be shown. The current picture stays. */
  aurberror: CustomEvent<AurbErrorDetail>;
}

export class AurbOrb extends HTMLElement {
  state: AurbState;
  /** Freeze on the current frame and stop decoding. Useful for lists of many orbs. */
  paused: boolean;
  /** Show a state briefly, then return to the one before it. */
  flash(state: AurbState, ms?: number): void;
  /** Fetch states now, for this orb's size and theme. Defaults to the `prefetch` attribute. */
  prefetch(states?: AurbState | readonly AurbState[]): void;
  /** Fetch states on hover, focus, or touch of another element. Returns a cleanup function. */
  prefetchOn(target: EventTarget, states: AurbState | readonly AurbState[]): () => void;
  /** Re-read the theme and the colour behind the orb, if your app changes them in a way it can't see. */
  refresh(): void;
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
