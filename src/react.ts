import { createElement, forwardRef, useCallback, useEffect, useRef, type ForwardedRef, type ForwardRefExoticComponent, type HTMLAttributes, type RefAttributes } from "react";
import type { AurbErrorDetail, AurbOrb, AurbState } from "./aurb.js";
import "./aurb.js";

export type { AurbErrorDetail, AurbOrb, AurbState } from "./aurb.js";

/** The element's own attributes. */
export interface AurbAttributes {
  /** An orb's name, such as "aurora", a pinned version, such as "aurora@1.0.0", a community orb's npm package, such as "npm:aurb-orb-nebula@1.0.0", or the URL of a folder you host yourself. */
  orb: string;
  /** Change it at any time; it crossfades. */
  state?: AurbState | undefined;
  /** Crossfade in ms, optionally per state: "500 thinking:250 error:150". Default 500. "rest" moves a solid orb through its rest pose, with `import "@aurb/player/rest"`. */
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

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      // Referred to by import(), which the generated .d.ts can always name.
      "aurb-orb": import("react").DetailedHTMLProps<import("react").HTMLAttributes<AurbOrb>, AurbOrb> & AurbAttributes & { class?: string | undefined; static?: boolean | undefined; paused?: boolean | undefined };
    }
  }
}

// Attributes that are on or off. React 18 writes static={false} as static="false", and the element
// only asks whether the attribute exists, so these have to be left out when false.
const FLAGS = ["static", "paused"] as const;

/** The orb as a React component. Safe to server-render: the size is reserved before it upgrades. */
export const Aurb: ForwardRefExoticComponent<AurbProps & RefAttributes<AurbOrb>> = forwardRef(function Aurb(
  { className, style, onStateChange, onReady, onError, ...props }: AurbProps,
  ref: ForwardedRef<AurbOrb>,
) {
  const el = useRef<AurbOrb | null>(null);
  // The latest callbacks, read when an event fires, so a new function each render never re-subscribes.
  const handlers = useRef<Record<string, (e: CustomEvent) => void>>({});
  handlers.current = {
    aurbstatechange: (e) => onStateChange?.(e.detail.state),
    aurbready: () => onReady?.(),
    aurberror: (e) => onError?.(e.detail),
  };

  useEffect(() => {
    const node = el.current!;
    const on = (e: Event) => handlers.current[e.type]!(e as CustomEvent);
    for (const type in handlers.current) node.addEventListener(type, on);
    return () => {
      for (const type in handlers.current) node.removeEventListener(type, on);
    };
  }, []);

  const setRef = useCallback(
    (node: AurbOrb | null) => {
      el.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const attrs: Record<string, unknown> = { ...props };
  for (const flag of FLAGS) {
    if (attrs[flag]) attrs[flag] = "";
    else delete attrs[flag];
  }
  // The element hides itself from screen readers when it upgrades, which can happen before hydration.
  // Rendering the same attribute up front keeps server and client HTML identical.
  if (!attrs.role && !("aria-hidden" in attrs)) attrs["aria-hidden"] = "true";
  return createElement("aurb-orb", { ...attrs, ref: setRef, class: className, style: { display: "inline-block", aspectRatio: "1", ...style } });
});
