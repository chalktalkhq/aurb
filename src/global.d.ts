// Types for the script-tag build (dist/aurb.global.js): it defines <aurb-orb> and sets window.aurb.
export * from "./aurb.js";

declare global {
  interface Window {
    aurb: typeof import("./aurb.js");
  }
}
