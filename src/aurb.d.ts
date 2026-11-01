export interface PrefetchOptions {
  /** Folder made by `aurb add`. */
  src: string;
  states: string | string[];
  /** Defaults to the page's current theme. */
  theme?: "dark" | "light" | null;
  /** Display width in CSS pixels; picks the file size. Defaults to 120. */
  width?: number;
  /** Sizes the folder holds. Defaults to "160,320". */
  sizes?: string | null;
}

/** Fetch states ahead at low priority. Does nothing on Save-Data or 2G. */
export function prefetch(options: PrefetchOptions): void;

export class AurbOrb extends HTMLElement {
  state: string;
  /** Show a state briefly, then return to the one before it. */
  flash(state: string, ms?: number): void;
  /** Fetch states now, for this orb's size and theme. Defaults to the `prefetch` attribute. */
  prefetch(states?: string | string[]): void;
  /** Fetch states on hover, focus, or touch of another element. Returns a cleanup function. */
  prefetchOn(target: EventTarget, states: string | string[]): () => void;
}

declare global {
  interface HTMLElementTagNameMap {
    "aurb-orb": AurbOrb;
  }
  interface HTMLElementEventMap {
    aurbstatechange: CustomEvent<{ state: string }>;
  }
}
