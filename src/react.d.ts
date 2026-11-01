import type { CSSProperties, FunctionComponent } from "react";

export interface AurbProps {
  /** Folder made by `aurb add`. */
  src: string;
  /** idle, thinking, and so on. Change it at any time. */
  state?: string;
  /** Crossfade in ms. Default 500. */
  transition?: number | string;
  /** Minimum ms a state stays before the next, so fast responses do not flicker. Default 200. */
  hold?: number | string;
  /** auto paints the colour behind it, none blends onto the page, or any CSS colour. */
  surface?: string;
  theme?: "auto" | "dark" | "light";
  /** States to fetch once the page is idle, comma separated. */
  prefetch?: string;
  /** lazy waits for the page to finish loading. Default lazy. */
  loading?: "lazy" | "eager";
  /** Sizes the folder holds. Default "160,320". */
  sizes?: string;
  /** Show the still poster and fetch no video. */
  static?: boolean;
  className?: string;
  style?: CSSProperties;
}

export const Aurb: FunctionComponent<AurbProps>;
