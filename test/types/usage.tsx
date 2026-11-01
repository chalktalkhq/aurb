// Compiled with strict settings by `npm test`. @ts-expect-error fails the build if the line stops being
// an error, so this file also proves that mistakes are caught.
import { useRef } from "react";
import { AurbOrb, prefetch, type AurbErrorDetail, type AurbState } from "aurb";
import { prefetch as alone } from "aurb/prefetch";
import { Aurb, type AurbProps } from "aurb/react";

// The element.
const el = document.querySelector("aurb-orb")!;
el.state = "thinking";
el.state = "running"; // a CLI alias works here too
el.paused = true;
el.flash("success", 1000);
el.prefetch(["working", "thinking"]);
el.refresh();
const off: () => void = el.prefetchOn(document.body, "thinking");
off();
el.addEventListener("aurbstatechange", (e) => { const s: AurbState = e.detail.state; void s; });
el.addEventListener("aurberror", (e) => { const r: "missing" | "blocked" = e.detail.reason; void r; });
el.addEventListener("click", (e) => { void e.clientX; });
const made = new AurbOrb();
void made;

// Prefetching.
prefetch({ src: "/x", states: ["idle", "thinking"], width: 120 });
alone({ src: "/x", states: "idle", theme: "dark" });

// Mistakes that must not compile.
// @ts-expect-error a typo in a state name
el.state = "thinkin";
// @ts-expect-error a typo in a state name
el.flash("sucess");
// @ts-expect-error src is required
prefetch({ states: "idle" });
// @ts-expect-error a typo in a state name
prefetch({ src: "/x", states: "thinkin" });
// @ts-expect-error a typo in a state name
export const typo: AurbProps = { src: "/x", state: "thinkin" };

// Custom states extend the type and nothing else.
declare module "aurb" {
  interface AurbStates {
    celebrate: true;
  }
}
el.state = "celebrate";

// React.
export function App() {
  const ref = useRef<AurbOrb>(null);
  const onError = (d: AurbErrorDetail) => console.log(d.url);
  return (
    <>
      <Aurb src="/x" />
      <Aurb src="/x" ref={ref} state="thinking" transition="500 thinking:250" hold={100} speed={1.5} static paused={false} loading="eager" theme="auto" surface="none" prefetch="working" sizes="160,320" />
      <Aurb src="/x" className="a" style={{ width: 120 }} aria-label="Assistant" data-testid="o" id="orb" onClick={() => ref.current?.flash("success")} />
      <Aurb src="/x" onStateChange={(s) => { const a: AurbState = s; void a; }} onReady={() => {}} onError={onError} />
      <aurb-orb src="/x" state="idle" static class="b" />
      {/* @ts-expect-error src is required */}
      <Aurb />
      {/* @ts-expect-error a typo in a state name */}
      <Aurb src="/x" state="thinkin" />
      {/* @ts-expect-error an unknown theme */}
      <Aurb src="/x" theme="blue" />
      {/* @ts-expect-error a typo in a state name, on the raw element */}
      <aurb-orb src="/x" state="thinkin" />
    </>
  );
}
