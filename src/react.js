import { createElement, forwardRef, useCallback, useEffect, useRef } from "react";
import "./aurb.js";

// Attributes that are on or off. React 18 writes static={false} as static="false", and the element
// only asks whether the attribute exists, so these have to be left out when false.
const FLAGS = ["static", "paused"];

/** The orb as a React component. Safe to server-render: the size is reserved before it upgrades. */
export const Aurb = forwardRef(function Aurb({ className, style, onStateChange, onReady, onError, ...props }, ref) {
  const el = useRef(null);
  const handlers = useRef();
  handlers.current = { aurbstatechange: (e) => onStateChange?.(e.detail.state), aurbready: () => onReady?.(), aurberror: (e) => onError?.(e.detail) };

  useEffect(() => {
    const node = el.current;
    const on = (e) => handlers.current[e.type](e);
    for (const type in handlers.current) node.addEventListener(type, on);
    return () => { for (const type in handlers.current) node.removeEventListener(type, on); };
  }, []);

  const setRef = useCallback((node) => {
    el.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  const attrs = { ...props };
  for (const f of FLAGS) { if (attrs[f]) attrs[f] = ""; else delete attrs[f]; }
  // The element hides itself from screen readers when it upgrades, which can happen before hydration.
  // Rendering the same attribute up front keeps server and client HTML identical.
  if (!attrs.role && !("aria-hidden" in attrs)) attrs["aria-hidden"] = "true";
  return createElement("aurb-orb", { ...attrs, ref: setRef, class: className, style: { display: "inline-block", aspectRatio: "1", ...style } });
});
