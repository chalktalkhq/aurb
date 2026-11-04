import type { DetailedHTMLProps, ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from "react";
import type { AurbErrorDetail, AurbOrb, AurbState } from "./aurb.js";

export type { AurbErrorDetail, AurbOrb, AurbState } from "./aurb.js";

/** The element's own attributes. */
export interface AurbAttributes {
  /** A folder on aurb's CDN, such as "aurora", or the URL of a folder you host yourself. */
  orb: string;
  /** Change it at any time; it crossfades. */
  state?: AurbState | undefined;
  /** Crossfade in ms, optionally per state: "500 thinking:250 error:150". Default 500. */
  transition?: number | string | undefined;
  /** Minimum ms a state stays before the next, so fast responses do not flicker. Default 200. */
  hold?: number | string | undefined;
  /** auto paints the colour behind it, none blends onto the page, or any CSS colour. */
  surface?: string | undefined;
  theme?: "auto" | "dark" | "light" | undefined;
  /** States to fetch once the page is idle, comma separated. */
  prefetch?: string | undefined;
  /** lazy waits for the page to finish loading. Default lazy. */
  loading?: "lazy" | "eager" | undefined;
  /** Tiers the player may choose from: sm, md, lg, xl, or pixel sizes. Default "sm,md,lg". Set one to force it. */
  sizes?: string | undefined;
  /** Playback speed; 1 is normal. */
  speed?: number | string | undefined;
}

export interface AurbProps extends AurbAttributes, Omit<HTMLAttributes<AurbOrb>, "onError" | keyof AurbAttributes> {
  /** Show the still poster and fetch no video. */
  static?: boolean | undefined;
  /** Freeze on the current frame and stop decoding. */
  paused?: boolean | undefined;
  /** A new state is on screen. */
  onStateChange?: ((state: AurbState) => void) | undefined;
  /** The first video frame is showing. */
  onReady?: (() => void) | undefined;
  /** A state could not be shown. The current picture stays. */
  onError?: ((detail: AurbErrorDetail) => void) | undefined;
}

export const Aurb: ForwardRefExoticComponent<AurbProps & RefAttributes<AurbOrb>>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "aurb-orb": DetailedHTMLProps<HTMLAttributes<AurbOrb>, AurbOrb> & AurbAttributes & { class?: string | undefined; static?: boolean | undefined; paused?: boolean | undefined };
    }
  }
}
