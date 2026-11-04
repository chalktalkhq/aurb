// `import "@aurb/player/rest"`: lets an orb with transition="rest" move between states through a shared rest pose instead of
// crossfading. For solid orbs whose outline changes, like ferro, where a crossfade would show two sets of spikes at once.
// The orb's folder must have what the studio renders for it: <state>-out (sinking into the rest pose), rest (the pose
// itself, a loop), and <state>-in (rising out of it). Kept out of the player, so orbs that don't need it don't pay for it.
// An ES module only: it waits on the player's own download cache, which a separate script-tag build could not see.
import { ALIASES, load } from "./shared.js";

const SEGMENT = 0.5; // one segment of a sheet: 12 frames at 24 fps, as the studio renders them
const FILE = /([^/]+)-((?:dark|light)-\d+\.\w+)$/; // a state's name, and the theme, size and type after it
const last = new WeakMap(); // the file each orb shows, or is about to
const busy = new WeakSet();
const at = (url, name) => url.replace(FILE, `${name}-$2`);

// Join at a segment boundary: every sheet runs on the loop's clock, and each segment holds its first two frames and its
// last two, so the pictures match there. The next file starts playing out of sight, in step with the one showing, and
// is cut in on a held frame: `lead` seconds before the boundary when leaving a sheet (its last frames), and just after it
// when entering one (its first), since a video shown from hiding can open on a frame or two from before the cut.
// Starting playback can take half a second on a busy device, so it happens first, never at the cut.
// A sheet starts over every segment, so on a busy page, where timers fire late, it could wrap round and show its start
// again for a frame. So a sheet is held from the moment it is cut in: it plays its one sink or rise and stops on its
// last held frame until the walk moves on, which it then does at once.
const join = (lead, sheet) => async (to, from) => {
  // A held sheet has stopped, but the loop's clock has not: carry on from where it would be now.
  const d = from.duration, now = () => from.currentTime + (from.paused && from.at ? ((performance.now() - from.at) / 1e3) * from.playbackRate : 0);
  to.playbackRate = from.playbackRate;
  to.currentTime = (now() + 0.01) % d;
  await to.play().catch(() => {});
  // The cut lands in the held frames either side of a boundary: before it, leaving a sheet (never the next segment);
  // just after it, entering one. If those frames are already showing, it cuts at once.
  const t = from.paused ? now() : Math.ceil((from.currentTime + (lead > 0 ? 0.02 : -0.06)) / SEGMENT) * SEGMENT - lead;
  const src = to.src, end = t + lead + SEGMENT - 0.06;
  const hold = () => to.src === src && (to.currentTime > end && !to.paused && (to.pause(), (to.at = performance.now())), to.requestVideoFrameCallback?.(hold));
  if (sheet) hold();
  await new Promise((res) => setTimeout(res, Math.max(0, t - now()) / (from.playbackRate || 1) * 1e3));
};

// A sinking or rising sheet lasts one segment and then starts over, so the file after it must already be downloaded
// when it starts, or the orb would sink and pop back. Fetch through the player's own cache, and wait for it.
const ready = (url, names) => Promise.all(names.map((n) => load(at(url, n))));

// Walk from what is showing to the state asked for: A, A-out, rest, B-in, B. The rest pose always sits between: an -out
// sheet restarts its sink every segment and an -in sheet its rise, so a direct cut from one to the other has no safe
// moment (a little early shows B fully formed, a little late shows A again), while rest is rest on every frame. With B
// already fetched, rest shows for about a tenth of a second, both cuts round the same boundary. Only loops are places
// to wait, so files are fetched before leaving one. The target is read again at every step, so a change part way
// through heads for the newest state from wherever the orb is.
async function walk(orb, url, show) {
  busy.add(orb);
  for (let cur, want; (cur = last.get(orb).match(FILE)[1]) !== (want = ALIASES[orb.state] ?? orb.state) && orb.isConnected; ) {
    const base = cur.replace(/-(out|in)$/, "");
    let next;
    if (cur === "rest") {
      await ready(url, [want + "-in", want, want + "-out"]);
      if ((ALIASES[orb.state] ?? orb.state) !== want) continue; // changed its mind while waiting
      next = want + "-in";
    } else if (cur.endsWith("-out")) next = "rest";
    // Part way up into a state it no longer wants: finish rising into it first. Its rise restarts every segment and its
    // sink starts fully formed, so cutting from one straight to the other would jump.
    else if (cur.endsWith("-in")) next = base;
    else {
      // Fetch the next state's files while this one sinks, so the walk need not stop in the rest loop.
      ready(url, [want + "-in", want, want + "-out"]).catch(() => {});
      await ready(url, [base + "-out", "rest"]);
      if ((ALIASES[orb.state] ?? orb.state) === base) continue; // changed its mind back while waiting
      next = base + "-out";
    }
    const u = at(url, next);
    // Noted before it shows, not after: a click that lands while this step is on its way must see it as under way, or
    // the player would take the change over and cut across the walk.
    last.set(orb, u);
    if (!(await show(u, next, join(/-(out|in)$/.test(cur) ? 0.075 : -0.04, /-(out|in)$/.test(next))))) {
      // A sheet that won't load (an orb rendered without them at this size) must not strand the orb on the state it
      // was leaving: forget the walk, and the player crossfades straight to the state asked for.
      last.delete(orb);
      busy.delete(orb);
      return orb.refresh();
    }
    // Arrived in a state: have its way out ready, so the next change starts at once.
    if (next === want) ready(url, [want + "-out", "rest"]).catch(() => {});
    // The next step loads into the element this one was just cut over: let the cut finish first, or the poster
    // underneath shows through for a frame.
    await new Promise((r) => setTimeout(r, 50));
  }
  busy.delete(orb);
}

// The player asks before every change. A first picture, a new theme or size, or an orb without transition="rest" is
// left to the player's own crossfade.
// Guarded, so a page that renders on the server can import it.
globalThis.customElements?.whenDefined("aurb-orb").then((AurbOrb) => (AurbOrb.rest = (orb, url, show) => {
  const was = last.get(orb)?.match(FILE);
  // The same file again means the player has not shown it yet (it held for a fade): it is still the player's to show.
  const rest = /\brest\b/.test(orb.getAttribute("transition"));
  if (!rest || !was || was[2] !== url.match(FILE)[2] || was[0] === url.match(FILE)[0]) {
    // The first picture of a rest orb: fetch its way out now, so the first change starts at once.
    if (rest && !was) ready(url, [url.match(FILE)[1] + "-out", "rest"]).catch(() => {});
    return last.set(orb, url) && false;
  }
  if (!busy.has(orb)) walk(orb, url, show);
  return true;
}));
