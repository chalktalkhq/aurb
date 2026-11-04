# aurb

Animated orbs for AI products. Multi-state, smooth transitions, a 4 KB player, and it never blocks your page.

```bash
npm i aurb
```

```js
import "aurb";
```

```html
<aurb-orb orb="aurora" prefetch="thinking" style="width:120px"></aurb-orb>
```
```js
document.querySelector("aurb-orb").state = "thinking"; // it crossfades
```

Or with no build step: `<script src="https://cdn.jsdelivr.net/npm/aurb/dist/aurb.global.js" defer></script>`.

There are no files to download, render, or host, and no key. Every orb is free, for any project, including commercial ones. Pick one from [Orbs](#orbs), or run `npx aurb` to browse them, and the player fetches it from jsDelivr, a free public CDN, at the edge nearest your visitor.

To host the files yourself, run `npx aurb download aurora --out public/orbs` and set `orb` to the folder's URL: `orb="/orbs/aurora"`.

## Command line

```bash
npx aurb                   # pick an orb, get its code, copied to your clipboard
npx aurb add aurora        # the same for one orb: --html, --state thinking, --json
npx aurb list              # every orb
npx aurb preview aurora    # play every state in your browser
npx aurb download aurora   # save the files to host yourself
```

To make an orb of your own, `npx aurb pack` turns your loops into one, and [aurb-orbs](https://github.com/chalktalkhq/aurb-orbs) explains how to share it with everyone.

## How it works, and its limits

aurb plays small pre-rendered video loops. Browsers decode video away from the main thread, which is the thread that handles clicks, so an orb can't delay one.

- **Size:** a 120px orb costs about 30 KB on first load, including the player. Rive's WebGL runtime and an orb asset measured about 825 KB in the project this came from.
- **Main thread:** playback adds about 0.3% of one CPU core there, with no long tasks.
- **Total CPU:** one playing orb used about 9% of one core in our tests, mostly on the GPU. That is not free, and it adds up: 10 at once used 34 to 48%. See [Many orbs on a page](#many-orbs-on-a-page).
- **Fixed motion:** loops are pre-rendered, so an orb can't follow a live audio level or the mouse. If you need that, use a shader.

Tested in Chrome on Windows. Safari and iOS are not yet tested.

## Only what is on screen

At runtime, the player only ever fetches:

- **The current state**, in the current theme. Other states are fetched when first asked for, or when you prefetch them.
- **Only when near the screen and in a visible tab.** An orb below the fold, or a state change while offscreen, downloads no video.
- **After the page has loaded,** unless you set `loading="eager"`. The poster (3 to 6 KB) shows until then.
- **Nothing on Save-Data, 2G, or reduced motion:** those get the still poster.

Once on screen, only one video decodes per orb, and it pauses when scrolled away or when the tab is hidden.

It picks the smallest size that stays sharp for the orb's width and the screen, compresses tiny ones harder where nobody can see it, and moves up to a sharper file if the orb grows. VP9 is used where supported, about 40% smaller than H.264, which is the automatic fallback.

## Prefetching

The first switch to a new state has to download it first. Prefetching took that from about 424 ms to 48 ms on slow 4G in our tests. Choose by how sure you are that a state will be needed:

```html
<!-- Very likely: fetch once the page is idle -->
<aurb-orb orb="aurora" prefetch="thinking,working"></aurb-orb>
```
```js
// Likely: fetch when someone shows intent, such as hovering the send button
orb.prefetchOn(sendButton, "thinking");

// You know best: fetch right now
orb.prefetch(["thinking"]);

// On the page before, without shipping the player to it (about 1 KB)
import { prefetch } from "aurb/prefetch";
prefetch({ orb: "aurora", states: "idle", width: 120 });
```

All of these stay off on Save-Data and 2G, use low network priority where the browser supports it, and never fetch a file twice. Prefetched files stay in memory until the page unloads, so a state costs its file size (about 40 to 70 KB) once fetched.

## Orbs

These aren't recolours. Each one has its own material and shape, and moves in its own way in every state. All of them are free.

The value is the orb's name. Each orb is an npm package, `@aurb/<name>`, served by jsDelivr. A name follows the latest 1.x, so an improved render reaches your site within a week without a code change; pin one with `orb="aurora@1.0.2"`. Anyone can add an orb: see [aurb-orbs](https://github.com/chalktalkhq/aurb-orbs).

| `orb` | Character |
|---|---|
| `aurora` | Violet into cyan. Fluid, always folding |
| `chalk` | Monochrome silk. Composed and exact |
| `lattice` | A rigid sphere of dots. Only the light moves |
| `pearl` | A clear bubble with one bead of light inside |
| `mist` | Colour bleeding through air, like watercolour |
| `nova` | Fine and fast. A star that can't sit still |
| `ember` | Molten and heavy. It glows from within |
| `lagoon` | Cyan and green water. Long waves, like a tide |
| `iris` | Tight violet folds that turn like petals |
| `rose` | Pink glass with a heartbeat inside |
| `moss` | Organic and lumpy. It grows and creeps |
| `signal` | A body of dots trying to get out. Every state moves its own way |
| `caustic` | A ball of light with a caustic net through it, like sunlight through moving water |
| `ferro` | Black chrome ferrofluid with a molten core. Use `transition="rest"` with `import "aurb/rest"` |
| `mercury` | A drop of liquid silver that turns to gold when it's done. Use `transition="rest"` with `import "aurb/rest"` |

## States

| State | What it does | Also accepts |
|---|---|---|
| `idle` | Slow drift | `default` |
| `listening` | Sound arrives: waves travel in from the rim, and the rim answers | `recording` |
| `thinking` | The folds churn inside, with irregular sparks and long calm between | `loading`, `processing` |
| `working` | Light circles the ball at a steady, even rhythm | `running`, `busy` |
| `speaking` | Sound leaves: it swells, its outline moves, and waves travel outward | `talking` |
| `success` | Green and calm; try `flash()` | `done` |
| `error` | Red, tense, and shuddering; try `flash()` | `failed` |
| `asleep` | Nearly dark, barely breathing | `sleeping`, `dormant` |

Those are the defaults; each preset changes how it does them.

**Why transitions look like one object:** every state is the same material on the same clock for the same length, and nothing is drawn on top. The player starts the new state at the same moment in the loop and fades it in over the old, so nothing dips or doubles.

## The element

| Attribute | Default | Meaning |
|---|---|---|
| `orb` | | Which orb, such as `aurora`, or the URL of a folder you host |
| `state` | `idle` | Change it at any time; the newest request wins |
| `transition` | `500` | Crossfade in ms, optionally per state: `"500 thinking:250 error:150"` |
| `hold` | `200` | Minimum ms a state stays, so fast responses don't flicker |
| `surface` | `auto` | See below |
| `theme` | `auto` | Follows `.dark`, `.light`, or `data-theme` on `<html>` or `<body>`, then the system |
| `prefetch` | | States to fetch once the page is idle |
| `loading` | `lazy` | `eager` starts before the page's load event |
| `sizes` | `sm,md,lg` | Tiers the player may choose from. Leave it alone for automatic, or set one, such as `sizes="sm"`, to force it |
| `speed` | `1` | Playback speed |
| `paused` | | Freeze on the current frame and stop decoding |
| `static` | | Poster only; no video is fetched |

**Methods:** `orb.flash("success", 1500)` shows a state, then returns. `orb.prefetch(states)` and `orb.prefetchOn(element, states)` fetch ahead. `orb.refresh()` re-reads the theme and the colour behind the orb, for when your app changes them in a way the orb can't see.

**Events:** `aurbready` when the first frame shows, `aurbstatechange` with `detail.state`, and `aurberror` with `detail.reason`, either `missing` (this orb has no such state) or `blocked` (the browser refused autoplay). In both error cases the current picture stays.

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
  orb="aurora"
  ref={ref}
  state={busy ? "thinking" : "idle"}
  prefetch="thinking"
  onStateChange={(state) => {}}
  style={{ width: 120 }}
/>;
```

Works with React 18 and 19, and is safe to server-render: the size is reserved before the element upgrades, so nothing shifts. For Vue, Svelte, and everything else, the element works as it is.

## TypeScript

Types ship with the package. State names are checked, so `state="thinkin"` is a compile error, on the element, the React component, and `prefetch()`. A custom orb with its own states comes with an `aurb-states.d.ts` that adds them:

```ts
declare module "aurb" {
  interface AurbStates {
    celebrate: true;
  }
}
```


## Development

```bash
npm test
```

This builds, fails if the player goes over 4 KB gzip, compiles strict type tests, and checks in a real browser exactly which files download and how the states behave. The browser test plays two small orbs kept in `test/orbs`, so it needs nothing else.

### Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please). Commits on `main` follow [Conventional Commits](https://www.conventionalcommits.org): `fix:` releases a patch, `feat:` a minor, and `feat!:` or a `BREAKING CHANGE:` footer a major (a minor while the version is below 1.0.0). Pull requests are squash-merged, so their titles are checked for this.

Each push to `main` keeps a release pull request up to date with the next version and its `CHANGELOG.md` entry. Merging it tags the release, creates the GitHub release, and publishes it to npm with provenance once the tests pass. Running the Release workflow by hand publishes the version in `package.json` if npm doesn't have it yet.

## License

MIT
