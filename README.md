# aurb

Animated orbs for AI products. Multi-state, smooth transitions, a 3.3 KB player, and it never blocks your page.

```bash
npm i aurb
npx aurb add aurora --states idle,thinking,working
```
```html
<script type="module">import "aurb";</script>
<aurb-orb src="/aurb/aurora-1a2b3c4d" prefetch="thinking" style="width:120px"></aurb-orb>
```
```js
document.querySelector("aurb-orb").state = "thinking"; // it crossfades
```

## Why not Rive, Lottie, or WebGL?

Those run on the main thread, which is the thread that handles clicks, and usually download a runtime first. aurb plays small video loops, which browsers decode off the main thread. An orb can't delay a click, and nothing starts downloading until the page has finished loading.

|  | aurb | A typical Rive orb |
|---|---|---|
| Script | 3.3 KB gzip | Runtime and WASM, 800 KB or more |
| A 120px orb, first load | About 30 KB | The same 800 KB or more |
| Main thread | None for playback | Renders there |

The catch: loops are pre-rendered, so an orb can't follow a live audio level or the mouse. If you need that, use a shader.

## Pay only for what you use

There is no giant package of videos. `npm i aurb` installs the player and the command line tool, and `aurb add` renders only what you ask for into your own project.

| You want | What happens |
|---|---|
| One orb, one state | `aurb add chalk --states idle --themes dark` makes just that: one file per size |
| A small avatar | The player picks the smallest size that stays sharp for the display. 160px is about 40% fewer bytes than 320px |
| Dark mode only | `--themes dark`; the other theme is never rendered |
| Any modern browser | VP9, about 40% smaller than H.264. H.264 is the automatic fallback |

At runtime, the player only ever fetches:

- **The current state**, in the current theme. Other states are fetched when first asked for, or when you prefetch them.
- **Only when visible.** An orb below the fold, or a state change while offscreen, downloads no video.
- **After the page has loaded,** unless you set `loading="eager"`. The poster (3 to 6 KB) shows until then.
- **Nothing on Save-Data, 2G, or reduced motion:** those get the still poster.

Once on screen, only one video decodes, and it pauses in a hidden tab or when scrolled away. Folder names are a hash of the look, so serve them with a year-long cache and they can never go stale.

## Prefetching

The first switch to a new state has to download it first. Choose by how sure you are that it will be needed:

```html
<!-- Very likely: fetch once the page is idle -->
<aurb-orb src="..." prefetch="thinking,working"></aurb-orb>
```
```js
// Likely: fetch when someone shows intent, such as hovering the send button
orb.prefetchOn(sendButton, "thinking");

// You know best: fetch right now
orb.prefetch(["thinking"]);

// Before any orb exists, for example on the page before
import { prefetch } from "aurb";
prefetch({ src: "/aurb/aurora-1a2b3c4d", states: "idle", width: 120 });
```

All of these stay off on Save-Data and 2G, use low network priority, and never fetch the same file twice.

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

Flags: `--style` (silk, glass, smoke, plasma, dots), `--color`, `--detail`, `--energy`, `--glow`, `--wobble`, `--softness`, `--speed`, `--state-color`, `--sizes`, `--themes`, `--seconds`, `--fps`, `--crf`. Rendering needs [ffmpeg](https://ffmpeg.org) on your machine, but nothing needs it at runtime. Adding a state or size later reuses the files you already have.

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

Aliases are for `aurb add`. On the element, use the state's main name.

**Why transitions look like one object:** every state shares one body, the same folds on the same clock for the same length, and each adds its own behaviour on top. The player starts the new state at the same moment in the loop and fades it in over the old, so nothing dips or doubles.

## The element

```html
<aurb-orb src state transition hold surface theme prefetch loading sizes static></aurb-orb>
```

| Attribute | Default | Meaning |
|---|---|---|
| `src` | | Folder made by `aurb add` |
| `state` | `idle` | Change it at any time; the newest request wins |
| `transition` | `500` | Crossfade in ms. Try 250 for reactions, 800 for mood |
| `hold` | `200` | Minimum ms a state stays, so fast responses don't flicker |
| `surface` | `auto` | See below |
| `theme` | `auto` | Follows `.dark`, `.light`, or `data-theme` on `<html>` or `<body>`, then the system |
| `prefetch` | | States to fetch once the page is idle |
| `loading` | `lazy` | `eager` starts before the page's load event |
| `sizes` | `160,320` | Sizes in the folder, if you changed them with `--sizes` |
| `static` | | Poster only; no video is fetched |

Methods: `orb.flash("success", 1500)`, `orb.prefetch(states)`, `orb.prefetchOn(element, states)`. Event: `aurbstatechange`.

### Surface

The videos have no alpha channel: they blend with the page, which is how they stay so small. A blend needs something to land on.

- `auto`: reads the colour behind the orb and paints it. Right for almost everything.
- A colour such as `#202020`: for a translucent panel, or when auto guesses wrong.
- `none`: blends straight onto the page, for an image or gradient backdrop. A parent with `transform`, `filter`, `opacity` below 1, or `isolation` will break this, because it cuts the blend off from the backdrop.

## React

```tsx
import { Aurb } from "aurb/react";

<Aurb src="/aurb/aurora-1a2b3c4d" state={busy ? "thinking" : "idle"} prefetch="thinking" style={{ width: 120 }} />;
```

Safe to server-render. The size is reserved before the element upgrades, so nothing shifts. For Vue, Svelte, and everything else, the element works as it is.

## Caching

```js
// next.config.js
{ source: "/aurb/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }
```

## Development

```bash
npm test
```

This builds, fails if the player goes over 4 KB gzip, renders a real orb, and checks in a real browser exactly which files download and how the states behave.

## License

MIT
