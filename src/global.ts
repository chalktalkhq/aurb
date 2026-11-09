// Types only, for the script-tag build (dist/aurb.global.js): it defines <aurb-orb> and sets window.aurb.
import type { AurbOrb, prefetch } from "./aurb.js";

export * from "./aurb.js";

declare global {
  interface Window {
    aurb: { prefetch: typeof prefetch; AurbOrb: typeof AurbOrb };
  }
}
