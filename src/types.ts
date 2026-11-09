// The public types. The player's .d.ts files are generated from these and the source, so they can't drift apart.

/**
 * Every state an orb can be in. An orb with states of its own adds them with declaration merging:
 *
 *     declare module "@aurb/player" { interface AurbStates { celebrate: true } }
 */
export interface AurbStates {
  idle: true;
  listening: true;
  thinking: true;
  working: true;
  speaking: true;
  success: true;
  error: true;
  asleep: true;
  // Other names for the same states.
  running: true;
  busy: true;
  loading: true;
  processing: true;
  talking: true;
  recording: true;
  done: true;
  failed: true;
  sleeping: true;
  dormant: true;
  default: true;
}
export type AurbState = keyof AurbStates;

export type Theme = "dark" | "light";

export interface PrefetchOptions {
  /** An orb's name, such as "aurora", a pinned version, such as "aurora@1.0.0", a community orb's npm package, such as "npm:aurb-orb-nebula@1.0.0", or the URL of a folder you host yourself. */
  orb: string;
  states: AurbState | readonly AurbState[];
  /** Defaults to the page's current theme. */
  theme?: Theme | null | undefined;
  /** Display width in CSS pixels; picks the file size. Defaults to 120. */
  width?: number | undefined;
  /** Tiers to choose from: sm, md, lg, xl, or pixel sizes. Defaults to "sm,md,lg". Set one to force it. */
  sizes?: string | null | undefined;
}

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
