# aurb

Animated orbs for AI products. Multi-state, smooth transitions, a 3.6 KB player, and it never blocks your page.

```bash
npm i aurb
npx aurb add aurora --states idle,thinking,working
```

With a bundler:

```js
import "aurb";
```

Or with no build step, using the copy `aurb add` puts next to your orb:

```html
<script src="/aurb/aurora-1a2b3c4d/aurb.global.js" defer></script>
```

Then, either way:

```html
<aurb-orb src="/aurb/aurora-1a2b3c4d" prefetch="thinking" style="width:120px"></aurb-orb>
```
```js
document.querySelector("aurb-orb").state = "thinking"; // it crossfades
```

## How it works, and its limits

aurb plays small pre-rendered video loops. Browsers decode video away from the main thread, which is the thread that handles clicks, so an orb can't delay one.

- **Size:** a 120px orb costs about 30 KB on first load, including the player. Rive's WebGL runtime and an orb asset measured about 825 KB in the project this came from.
- **Main thread:** playback adds about 0.3% of one CPU core there, with no long tasks.
- **Total CPU:** one playing orb used about 9% of one core in our tests, mostly on the GPU. That is not free, and it adds up: 10 at once used 34 to 48%. See [Many orbs on a page](#many-orbs-on-a-page).
- **Fixed motion:** loops are pre-rendered, so an orb can't follow a live audio level or the mouse. If you need that, use a shader.

Tested in Chrome on Windows. Safari and iOS are not yet tested.

## Pay only for what you use

There is no giant package of videos. `npm i aurb` installs the player and the command line tool, and `aurb add` renders only what you ask for into your own project.

| You want | What happens |
|---|---|
| One orb, one state | `aurb add chalk --states idle --themes dark` makes just that: one file per size |
| A small avatar | The player picks the smallest size that stays sharp. 160px is about 40% fewer bytes than 320px. If the orb grows, it moves up to a sharper file |
| Dark mode only | `--themes dark`; the other theme is never rendered |
| Any modern browser | VP9, about 40% smaller than H.264. H.264 is the automatic fallback |

At runtime, the player only ever fetches:

- **The current state**, in the current theme. Other states are fetched when first asked for, or when you prefetch them.
- **Only when near the screen and in a visible tab.** An orb below the fold, or a state change while offscreen, downloads no video.
- **After the page has loaded,** unless you set `loading="eager"`. The poster (3 to 6 KB) shows until then.
- **Nothing on Save-Data, 2G, or reduced motion:** those get the still poster.

Once on screen, only one video decodes per orb, and it pauses when scrolled away or when the tab is hidden.

## Prefetching

The first switch to a new state has to download it first. Prefetching took that from about 424 ms to 48 ms on slow 4G in our tests. Choose by how sure you are that a state will be needed:

```html
<!-- Very likely: fetch once the page is idle -->
<aurb-orb src="..." prefetch="thinking,working"></aurb-orb>
```
```js
// Likely: fetch when someone shows intent, such as hovering the send button
orb.prefetchOn(sendButton, "thinking");

// You know best: fetch right now
orb.prefetch(["thinking"]);

// On the page before, without shipping the player to it (about 1 KB)
import { prefetch } from "aurb/prefetch";
prefetch({ src: "/aurb/aurora-1a2b3c4d", states: "idle", width: 120 });
```

All of these stay off on Save-Data and 2G, use low network priority where the browser supports it, and never fetch a file twice. Prefetched files stay in memory until the page unloads, so a state costs its file size (about 40 to 70 KB) once fetched. On another origin, your host must allow CORS, or prefetch falls back to normal loading.

## Presets

Run `npx aurb presets`, or `npx aurb gallery` for a picture of all of them.

| Preset | Look |
|---|---|
| `chalk` | Monochrome silk. The most premium default |
| `pearl` | Clear, minimal glass |
| `mist` | Soft monochrome vapour |
| `lattice` | A sphere of fine dots |
| `aurora` | Violet into cyan |
| `nova` | Pink, violet, blue |
| `ember` | Warm coral into amber |
| `lagoon` | Cyan and green silk |
| `iris` | Soft violet silk |
| `rose` | Pink glass |
| `moss` | Green and teal vapour |
| `signal` | Blue dots |

Make any of them yours. `aurb draft` gives you a still sheet in seconds, so you can judge a look before rendering:

```bash
npx aurb draft aurora --color "#ff5ca8,#ffb020"
npx aurb add aurora --color "#ff5ca8,#ffb020" --detail 1.4 --glow 1.5
```

| Flag | Default | Effect |
|---|---|---|
| `--style` | `silk` | `silk`, `glass`, `smoke`, `plasma`, `dots` |
| `--color` | none | One or more hex colours; none is monochrome |
| `--color-dark`, `--color-light` | | Different colours per theme |
| `--detail` | `1` | More or fewer folds |
| `--energy` | `1` | Overall brightness |
| `--glow` | `1` | The halo outside the ball |
| `--wobble` | `0.024` | Outline movement. Above 0.08 reads as jelly |
| `--softness` | `1` | Edge softness |
| `--speed` | `1` | Speed of each state's motion |
| `--state-color` | | `error=#f97316,success=none`; `none` keeps the orb's colour |
| `--sizes` | `160,320` | File sizes. Pass the same list to the `sizes` attribute |
| `--seconds`, `--fps`, `--crf` | `10`, `24`, `21` | Loop length, frame rate, quality (higher is smaller) |

Rendering needs [ffmpeg](https://ffmpeg.org) on your machine, but nothing needs it at runtime. Adding a built-in state or size later reuses the files you already have.

## States

| State | What it does | Also accepts |
|---|---|---|
| `idle` | Slow drift | `default` |
| `listening` | The rim swells, a slow breath | `recording` |
| `thinking` | A glow orbits inside | `loading`, `processing` |
| `working` | Light sweeps round the rim | `running`, `busy` |
| `speaking` | The core beats irregularly | `talking` |
| `success` | Green and calm; try `flash()` | `done` |
| `error` | Red and agitated; try `flash()` | `failed` |
| `asleep` | Dim and slow | `sleeping`, `dormant` |

**Why transitions look like one object:** every state shares one body, the same folds on the same clock for the same length, and each adds its own behaviour on top. The player starts the new state at the same moment in the loop and fades it in over the old, so nothing dips or doubles.

### Your own states and orbs

Put them in `aurb.config.json`, then run `npx aurb build`:

```json
{
  "out": "public/aurb",
  "states": {
    "celebrate": { "extends": "success", "sweep": 1, "sweepN": 2, "tint": "#f59e0b" }
  },
  "orbs": {
    "assistant": { "preset": "aurora", "states": ["idle", "thinking", "celebrate"], "themes": ["dark", "light"] }
  }
}
```

Each orb takes the same names as the flags above. A state can start from a built-in with `extends` and set any of these:

| Field | Range | Effect |
|---|---|---|
| `energy` | 0.1 to 2 | Overall light |
| `flow`, `flowN` | 0 to 1.5, 1 to 12 | Faster inner motion, and how many cycles per loop |
| `orbit`, `orbitN` | 0 to 0.9, 1 to 12 | A glow circling inside |
| `sweep`, `sweepN` | 0 to 3, 1 to 12 | Light running round the rim |
| `pulse`, `pulseN` | 0 to 0.6, `[a, b]` | Light beating at two rates, which looks less mechanical |
| `breathe`, `breatheN` | 0 to 0.05, 1 to 12 | The outline moving gently |
| `rim`, `rimBeat`, `rimBeatN` | 0 to 3, 0 to 2, 1 to 12 | Edge brightness and swell |
| `coreBeat`, `coreBeatN` | 0 to 4, 1 to 12 | The inner glow beating |
| `tint` | hex | This state's colour |

Cycle counts have to be whole numbers, or the loop would jump, so the config rejects anything else. Changing a custom state re-renders that orb in a new folder. `aurb build` also writes `aurb-states.d.ts`, so TypeScript accepts your states; commit it with your code.

## The element

| Attribute | Default | Meaning |
|---|---|---|
| `src` | | Folder made by `aurb add` |
| `state` | `idle` | Change it at any time; the newest request wins |
| `transition` | `500` | Crossfade in ms, optionally per state: `"500 thinking:250 error:150"` |
| `hold` | `200` | Minimum ms a state stays, so fast responses don't flicker |
| `surface` | `auto` | See below |
| `theme` | `auto` | Follows `.dark`, `.light`, or `data-theme` on `<html>` or `<body>`, then the system |
| `prefetch` | | States to fetch once the page is idle |
| `loading` | `lazy` | `eager` starts before the page's load event |
| `sizes` | `160,320` | Sizes in the folder, if you changed them with `--sizes` |
| `speed` | `1` | Playback speed |
| `paused` | | Freeze on the current frame and stop decoding |
| `static` | | Poster only; no video is fetched |

**Methods:** `orb.flash("success", 1500)` shows a state, then returns. `orb.prefetch(states)` and `orb.prefetchOn(element, states)` fetch ahead. `orb.refresh()` re-reads the theme and the colour behind the orb, for when your app changes them in a way the orb can't see.

**Events:** `aurbready` when the first frame shows, `aurbstatechange` with `detail.state`, and `aurberror` with `detail.reason`, either `missing` (no file for that state) or `blocked` (the browser refused autoplay). In both error cases the current picture stays.

**Styling:** set the size with CSS `width`. The `surface` and `stack` parts are available through `::part()`.

### Surface

The videos have no alpha channel: they blend with the page, which is how they stay so small. A blend needs something to land on.

- `auto`: reads the colour behind the orb and paints it. Right for almost everything.
- A colour such as `#202020`: for a translucent panel, or when auto guesses wrong.
- `none`: blends straight onto the page, for an image or gradient backdrop. A parent with `transform`, `filter`, `opacity` below 1, or `isolation` will break this, because it cuts the blend off from the backdrop.

### Many orbs on a page

Each playing orb decodes its own video. For a list, keep one or two moving: use `static` on the rest, or set `paused` and unpause on hover.

## React

```tsx
import { Aurb } from "aurb/react";
import type { AurbOrb } from "aurb";

const ref = useRef<AurbOrb>(null);

<Aurb
  src="/aurb/aurora-1a2b3c4d"
  ref={ref}
  state={busy ? "thinking" : "idle"}
  prefetch="thinking"
  onStateChange={(state) => {}}
  style={{ width: 120 }}
/>;
```

Works with React 18 and 19, and is safe to server-render: the size is reserved before the element upgrades, so nothing shifts. For Vue, Svelte, and everything else, the element works as it is.

## TypeScript

Types ship with the package. State names are checked, so `state="thinkin"` is a compile error, on the element, the React component, and `prefetch()`. Custom states are added by the generated `aurb-states.d.ts`:

```ts
declare module "aurb" {
  interface AurbStates {
    celebrate: true;
  }
}
```

## Caching

Folder names are a hash of the look, so they can be cached forever, and a changed orb can never be served stale:

```js
// next.config.js
{ source: "/aurb/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }
```

## Development

```bash
npm test
```

This builds, fails if the player goes over 4 KB gzip, compiles strict type tests, renders a real orb, and checks in a real browser exactly which files download and how the states behave.

## License

MIT
