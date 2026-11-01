"use client";
import { createElement } from "react";
import "./aurb.js";

/** The orb as a React component. Safe to server-render: the size is reserved before it upgrades. */
export function Aurb({ className, style, ...props }) {
  return createElement("aurb-orb", { ...props, class: className, style: { display: "inline-block", aspectRatio: "1", ...style } });
}
