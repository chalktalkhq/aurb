// End-to-end: serves two small pre-rendered orbs (test/orbs, made by the studio) as plain static files the way the CDN
// does (no Range support, no cache headers: the worst case), and checks behaviour and exactly which bytes get downloaded
// in a real browser. Run with: npm test
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(".tmp/test");
fs.rmSync(root, { recursive: true, force: true });
// chalk: idle, thinking and working at 80, 160 and 320, both themes. ferro: a solid orb with rest sheets, for the rest
// transitions. Both are short loops, so the fixtures stay small.
fs.cpSync("test/orbs", root, { recursive: true });
const folderName = "chalk";
const blob = path.join(root, folderName);
fs.copyFileSync("dist/aurb.global.js", path.join(root, "aurb.global.js"));
const restFolder = "ferro";
for (const f of ["aurb.js", "shared.js", "rest.js"]) fs.copyFileSync(`dist/${f}`, path.join(root, f)); // the module build, for rest

let served = {}; // bytes actually sent per media file
const TYPES = { js: "text/javascript", webm: "video/webm", mp4: "video/mp4", jpg: "image/jpeg" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/__page") { res.writeHead(200, { "content-type": "text/html" }); res.end(global.__page); return; }
  const file = path.join(root, url), ext = path.extname(file).slice(1);
  if (!file.startsWith(root) || !TYPES[ext] || !fs.existsSync(file)) { res.writeHead(404, { "access-control-allow-origin": "*" }); res.end(); return; }
  const body = fs.readFileSync(file);
  if (ext !== "js") served[path.basename(file)] = (served[path.basename(file)] ?? 0) + body.length;
  res.writeHead(200, { "content-type": TYPES[ext], "access-control-allow-origin": "*" });
  res.end(body);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

let failed = 0, total = 0;
const check = (name, ok, detail = "") => { total++; if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`); };

const pageHtml = (body, htmlClass = "dark", esm) => `<!doctype html><html class="${htmlClass}"><body style="margin:0;background:${htmlClass === "dark" ? "#191919" : "#f5f5f3"}">${esm ? '<script type="module" src="/aurb.js"></script><script type="module" src="/rest.js"></script>' : '<script src="/aurb.global.js"></script>'}${body}</body></html>`;

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"] });

// Every file plays from a blob: link; remember which file each one came from, so the tests can name it.
const names = () => {
  window.__names = {};
  const blob = Response.prototype.blob, make = URL.createObjectURL;
  Response.prototype.blob = async function () { const b = await blob.call(this); b.__url = this.url; return b; };
  URL.createObjectURL = (b) => { const u = make(b); if (b.__url) window.__names[u] = b.__url; return u; };
};

async function open(body, { htmlClass = "dark", ctxOptions = {}, init, esm } = {}) {
  global.__page = pageHtml(body, htmlClass, esm);
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1, ...ctxOptions });
  const page = await ctx.newPage();
  const media = new Set();
  page.on("request", (r) => { if (/\.(mp4|webm|jpg)/.test(r.url())) media.add(r.url().split("?")[0].split("/").pop()); });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(names);
  if (init) await page.addInitScript(init);
  await page.goto(`${BASE}/__page`);
  return { ctx, page, media, errors };
}
const src = `orb="${BASE}/${folderName}"`;
const props = `orb: ${JSON.stringify(`${BASE}/${folderName}`)}`;
const status = (page, id = "o") => page.evaluate((id) => {
  const o = document.getElementById(id);
  const vs = [...o.shadowRoot.querySelectorAll("video")];
  const top = vs.find((v) => getComputedStyle(v).opacity === "1") ?? vs[0];
  return { state: o.state, file: decodeURI(window.__names[top.currentSrc] ?? top.currentSrc).split("/").pop(), opacity: getComputedStyle(top).opacity, paused: top.paused, playing: vs.filter((v) => !v.paused).length };
}, id);

console.log("\n-- Downloads only what is needed --");
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" ${src} style="width:120px"></aurb-orb>`);
  await page.waitForTimeout(1500);
  const st = await status(page);
  check("one state fetched: poster and idle, nothing else", media.size === 2 && media.has("idle-dark-160.webm") && media.has("poster-dark-160.jpg"), [...media].join(", "));
  check("prefers VP9", st.file.endsWith(".webm"), st.file);
  check("small orb takes the small file", st.file === "idle-dark-160.webm", st.file);
  check("other theme is not fetched", ![...media].some((f) => f.includes("light")));
  await page.evaluate(() => { document.getElementById("o").state = "thinking"; });
  await page.waitForTimeout(1200);
  check("a state is fetched only when asked for", media.has("thinking-dark-160.webm") && !media.has("working-dark-160.webm"));
  const st2 = await status(page);
  check("one video decoding once settled", st2.playing === 1, st2.playing);
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" ${src} style="width:240px"></aurb-orb>`);
  await page.waitForTimeout(1200);
  check("large orb takes the large file", media.has("idle-dark-320.webm"), [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" ${src} style="width:120px"></aurb-orb>`, { ctxOptions: { deviceScaleFactor: 2 } });
  await page.waitForTimeout(1200);
  check("retina doubles the size it asks for", media.has("idle-dark-320.webm"), [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<div style="height:3000px"></div><aurb-orb id="o" ${src} style="width:120px"></aurb-orb>`);
  await page.waitForTimeout(1200);
  check("offscreen orb fetches no video", ![...media].some((f) => /\.(webm|mp4)$/.test(f)), [...media].join(", ") || "nothing");
  await page.evaluate(() => { document.getElementById("o").state = "thinking"; });
  await page.waitForTimeout(500);
  check("state changes offscreen fetch nothing", ![...media].some((f) => /\.(webm|mp4)$/.test(f)));
  await page.evaluate(() => window.scrollTo(0, 3000));
  await page.waitForTimeout(1200);
  check("scrolling in fetches only the current state", media.has("thinking-dark-160.webm") && !media.has("idle-dark-160.webm"), [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" static ${src} style="width:120px"></aurb-orb>`);
  await page.waitForTimeout(800);
  check("static: poster only", media.size === 1 && media.has("poster-dark-160.jpg"), [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" ${src} style="width:120px"></aurb-orb>`, { ctxOptions: { reducedMotion: "reduce" } });
  await page.waitForTimeout(800);
  check("reduced motion: poster only", media.size === 1, [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" ${src} style="width:120px"></aurb-orb>`, { init: () => Object.defineProperty(navigator, "connection", { value: { saveData: true } }) });
  await page.waitForTimeout(800);
  check("Save-Data: poster only", media.size === 1, [...media].join(", "));
  await ctx.close();
}

console.log("\n-- Prefetch --");
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" ${src} prefetch="thinking" style="width:120px"></aurb-orb>`);
  await page.waitForTimeout(1500);
  check("attribute fetches the listed state once idle", media.has("thinking-dark-160.webm") && !media.has("working-dark-160.webm"), [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" ${src} style="width:120px"></aurb-orb><button id="b" style="position:fixed;left:300px;top:300px;width:100px;height:50px">Send</button>`);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getElementById("o").prefetchOn(document.getElementById("b"), "working"));
  check("intent: nothing before hover", !media.has("working-dark-160.webm"));
  await page.hover("#b");
  await page.waitForTimeout(500);
  check("intent: fetched on hover", media.has("working-dark-160.webm"), [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" ${src} prefetch="thinking" style="width:120px"></aurb-orb>`, { init: () => Object.defineProperty(navigator, "connection", { value: { effectiveType: "2g" } }) });
  await page.waitForTimeout(1200);
  check("2G: prefetch stays off", !media.has("thinking-dark-160.webm"), [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open("");
  await page.evaluate((orb) => { aurb.prefetch({ orb, states: ["thinking", "working"], theme: "light", width: 200 }); }, `${BASE}/${folderName}`);
  await page.waitForTimeout(600);
  check("standalone prefetch() works before any orb exists", media.has("thinking-light-320.webm") && media.has("working-light-320.webm"), [...media].join(", "));
  await ctx.close();
}

for (const theme of ["dark", "light"]) {
  console.log(`\n-- Behaviour, ${theme} --`);
  const { ctx, page, errors } = await open(`<aurb-orb id="o" ${src} style="width:240px"></aurb-orb>
    <div id="panel" style="margin:20px;padding:20px;width:160px;background:${theme === "dark" ? "#2a2a40" : "#e8e4dc"}"><aurb-orb id="p" ${src} style="width:120px"></aurb-orb></div>`, { htmlClass: theme, init: () => { window.__long = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: true }); } });
  await page.waitForTimeout(1800);
  for (const s of ["thinking", "working", "idle"]) {
    await page.evaluate((s) => { document.getElementById("o").state = s; }, s);
    await page.waitForTimeout(1100);
    const st = await status(page);
    check(`switches to ${s}`, st.file === `${s}-${theme}-320.webm` && st.opacity === "1" && !st.paused, st.file);
  }
  const sync = await page.evaluate(async () => {
    const o = document.getElementById("o");
    const vs = [...o.shadowRoot.querySelectorAll("video")];
    const from = vs.find((v) => !v.paused), to = vs.find((v) => v !== from);
    o.state = "thinking";
    await new Promise((r) => o.addEventListener("aurbstatechange", r, { once: true }));
    return Math.abs(from.currentTime - to.currentTime);
  });
  check("incoming state starts in sync", sync < 0.2, `${sync.toFixed(3)}s`);
  await page.waitForTimeout(800);
  await page.evaluate(async () => { const o = document.getElementById("o"); for (const s of ["idle", "working", "thinking", "idle", "working", "thinking", "idle"]) { o.state = s; await new Promise((r) => setTimeout(r, 30)); } });
  await page.waitForTimeout(1400);
  const end = await status(page);
  check("rapid switching settles on the last state", end.state === "idle" && end.file === `idle-${theme}-320.webm` && end.opacity === "1", end.file);
  await page.evaluate(() => { document.getElementById("o").state = "nope"; });
  await page.waitForTimeout(1000);
  const miss = await status(page);
  check("a missing state keeps the picture", miss.opacity === "1" && !miss.paused, miss.file);
  await page.evaluate(() => { document.getElementById("o").state = "idle"; });
  await page.waitForTimeout(1000);
  const back = await status(page);
  check("recovers afterwards", back.file === `idle-${theme}-320.webm` && !back.paused, back.file);
  await page.evaluate(() => document.getElementById("o").flash("working", 700));
  await page.waitForTimeout(350);
  const during = (await status(page)).state;
  await page.waitForTimeout(1100);
  const after = (await status(page)).state;
  check("flash() shows a state and returns", during === "working" && after === "idle", `${during} then ${after}`);

  // No square and no disc: walk around the orb's edge on the coloured panel and compare with what is behind it.
  const shot = (await page.screenshot()).toString("base64");
  const box = await page.locator("#p").boundingBox();
  const worst = await page.evaluate(async ({ shot, box }) => {
    const img = new Image(); img.src = "data:image/png;base64," + shot; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const at = (x, y) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data];
    const ref = at(box.x - 6, box.y + box.height / 2);
    let w = 0;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = box.width / 2;
    const pts = [[box.x + 1, box.y + 1], [box.x + box.width - 2, box.y + 1], [box.x + 1, box.y + box.height - 2], [box.x + box.width - 2, box.y + box.height - 2]];
    for (let a = 0; a < 24; a++) pts.push([cx + Math.cos((a / 24) * 6.283) * r * 0.99, cy + Math.sin((a / 24) * 6.283) * r * 0.99]);
    for (const [x, y] of pts) { const q = at(x, y); for (let k = 0; k < 3; k++) w = Math.max(w, Math.abs(q[k] - ref[k])); }
    return w;
  }, { shot, box });
  check("no square or disc on a coloured panel", worst <= 1, `worst ${worst}/255`);

  const long = await page.evaluate(() => window.__long);
  check("no long main-thread stalls", long.filter((d) => d > 200).length === 0, `longest ${Math.max(0, ...long)}ms`);
  check("no script errors", errors.length === 0, errors[0] ?? "");
  await ctx.close();
}

console.log("\n-- Audit findings: each of these failed before it was fixed --");
const settled = (page, id = "o") => page.waitForFunction((id) => [...document.getElementById(id).shadowRoot.querySelectorAll("video")].some((v) => getComputedStyle(v).opacity === "1"), id, { timeout: 15000 });
{
  // Was 31%: the picture showed through when a state changed during a fade.
  const { ctx, page } = await open(`<aurb-orb id="o" hold="0" loading="eager" ${src} style="width:240px"></aurb-orb>`);
  await settled(page);
  const r = await page.evaluate(async () => {
    const e = document.getElementById("o");
    const [a, b] = e.shadowRoot.querySelectorAll("video");
    let low = 1, stop = false;
    const tick = () => { low = Math.min(low, 1 - (1 - +getComputedStyle(a).opacity) * (1 - +getComputedStyle(b).opacity)); if (!stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    e.state = "thinking";
    await new Promise((r) => e.addEventListener("aurbstatechange", r, { once: true }));
    await new Promise((r) => setTimeout(r, 180));
    e.state = "working";
    await new Promise((r) => setTimeout(r, 1800));
    stop = true;
    return { low, state: e.state, file: (({ currentSrc: s }) => decodeURI(window.__names[s] ?? s).split("/").pop())([a, b].find((v) => getComputedStyle(v).opacity === "1")) };
  });
  check("a switch during a fade leaves no hole in the picture", r.low > 0.995, `lowest coverage ${(r.low * 100).toFixed(0)}%`);
  check("and still arrives at the newest state", r.file === "working-dark-320.webm", r.file);
  await ctx.close();
}
{
  // Was 2.00x: prefetch downloaded the file twice on a host with no cache headers.
  served = {};
  const { ctx, page } = await open(`<aurb-orb id="o" prefetch="thinking" ${src} style="width:120px"></aurb-orb>`);
  await settled(page);
  await page.waitForTimeout(1200);
  const ms = await page.evaluate(() => new Promise((res) => { const e = document.getElementById("o"), t = performance.now(); e.addEventListener("aurbstatechange", () => res(performance.now() - t), { once: true }); e.state = "thinking"; }));
  await page.waitForTimeout(300);
  const size = fs.statSync(path.join(blob, "thinking-dark-160.webm")).size;
  check("prefetch downloads a file once, with no cache headers", served["thinking-dark-160.webm"] === size, `${(served["thinking-dark-160.webm"] / size).toFixed(2)}x`);
  check("a prefetched switch is fast", ms < 200, `${Math.round(ms)}ms`);
  await ctx.close();
}
{
  // Was downloading both copies: blocked autoplay was mistaken for a broken codec.
  served = {};
  const { ctx, page } = await open(`<aurb-orb id="o" loading="eager" ${src} style="width:120px"></aurb-orb>`, { init: () => { HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException("blocked", "NotAllowedError")); }; window.__errs = []; addEventListener("DOMContentLoaded", () => document.getElementById("o").addEventListener("aurberror", (e) => window.__errs.push(e.detail.reason))); } });
  await page.waitForTimeout(1500);
  const vids = Object.keys(served).filter((k) => /\.(mp4|webm)$/.test(k));
  check("blocked autoplay downloads no second copy", vids.length === 1, vids.join(", "));
  check("blocked autoplay is reported, not hidden", (await page.evaluate(() => window.__errs))[0] === "blocked");
  await ctx.close();
}
{
  // Was stuck on the 160px file at 600px.
  const { ctx, page } = await open(`<aurb-orb id="o" ${src} style="width:40px"></aurb-orb>`);
  await settled(page);
  await page.evaluate(() => { document.getElementById("o").style.width = "600px"; });
  await page.waitForTimeout(1400);
  const st = await status(page);
  check("growing an orb moves it to a sharper file", st.file === "idle-dark-320.webm", st.file);
  await page.evaluate(() => { document.getElementById("o").style.width = "40px"; });
  await page.waitForTimeout(900);
  check("shrinking keeps the file already downloaded", (await status(page)).file === "idle-dark-320.webm");
  await ctx.close();
}
{
  // Was +100 listeners per 100 switches.
  const { ctx, page } = await open(`<aurb-orb id="o" hold="0" transition="20" loading="eager" ${src} style="width:120px"></aurb-orb>`);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  await settled(page);
  const count = async () => { await cdp.send("HeapProfiler.collectGarbage"); await page.waitForTimeout(300); return (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "JSEventListeners").value; };
  const before = await count();
  await page.evaluate(async () => { const e = document.getElementById("o"); for (let i = 0; i < 40; i++) { await new Promise((res) => { e.addEventListener("aurbstatechange", res, { once: true }); e.state = i % 2 ? "idle" : "thinking"; setTimeout(res, 1000); }); await new Promise((r) => setTimeout(r, 90)); } });
  const after = await count();
  check("no listeners left behind by 40 switches", after - before <= 2, `+${after - before}`);
  await ctx.close();
}
{
  // Was 8 ms per change with 30 orbs, because every orb re-read its ancestors' colours.
  const { ctx, page } = await open(`<aurb-orb id="o" static ${src} style="width:80px"></aurb-orb>`.repeat(5));
  await page.waitForTimeout(700);
  const calls = await page.evaluate(async () => {
    let n = 0; const real = window.getComputedStyle;
    window.getComputedStyle = (...a) => { n++; return real.apply(window, a); };
    document.body.style.overflow = "hidden";
    document.body.classList.add("modal-open");
    document.documentElement.classList.add("scroll-lock");
    await new Promise((r) => setTimeout(r, 500));
    return n;
  });
  check("unrelated page changes cost the orbs nothing", calls === 0, `${calls} style reads`);
  await ctx.close();
}
{
  // Was a silent 404.
  const { ctx, page } = await open(`<aurb-orb id="o" loading="eager" ${src} style="width:120px"></aurb-orb>`);
  const logs = [];
  page.on("console", (m) => { if (m.type() === "warning") logs.push(m.text()); });
  await settled(page);
  await page.evaluate(() => { document.getElementById("o").state = "running"; });
  await page.waitForTimeout(1100);
  check("CLI aliases work on the element too", (await status(page)).file === "working-dark-160.webm", (await status(page)).file);
  const reason = await page.evaluate(() => new Promise((res) => { const e = document.getElementById("o"); e.addEventListener("aurberror", (x) => res(x.detail.reason), { once: true }); e.state = "nope"; setTimeout(() => res(null), 2500); }));
  check("a missing state fires an error event", reason === "missing", reason);
  check("a missing state explains itself in the console", logs.some((l) => l.includes("no nope")), logs[0]?.slice(0, 70));
  await ctx.close();
}
{
  // Remove and re-add, which is what React StrictMode and list re-orders do.
  const { ctx, page } = await open(`<div id="p"><aurb-orb id="o" ${src} style="width:120px"></aurb-orb></div>`);
  await settled(page);
  await page.evaluate(async () => { const e = document.getElementById("o"), p = e.parentNode; e.remove(); await new Promise((r) => setTimeout(r, 50)); p.append(e); });
  await page.waitForTimeout(1200);
  const st = await status(page);
  check("works after being removed and re-added", st.opacity === "1" && !st.paused && st.file === "idle-dark-160.webm", st.file);
  await ctx.close();
}

console.log("\n-- Runtime controls --");
{
  const { ctx, page } = await open(`<aurb-orb id="o" transition="900 thinking:120" hold="0" ${src} style="width:120px"></aurb-orb>`);
  await settled(page);
  const fade = (s) => page.evaluate(async (s) => { const e = document.getElementById("o"); await new Promise((r) => { e.addEventListener("aurbstatechange", r, { once: true }); e.state = s; }); return getComputedStyle([...e.shadowRoot.querySelectorAll("video")].find((v) => v.style.zIndex === "1")).transitionDuration; }, s);
  const perState = await fade("thinking");
  check("a per-state transition applies", perState === "0.12s", perState);
  await page.waitForTimeout(300);
  const fallback = await fade("idle");
  check("the default transition applies elsewhere", fallback === "0.9s", fallback);
  await page.waitForTimeout(1100);
  const playing = () => page.evaluate(() => [...document.getElementById("o").shadowRoot.querySelectorAll("video")].filter((v) => !v.paused).length);
  await page.evaluate(() => { document.getElementById("o").paused = true; });
  await page.waitForTimeout(150);
  check("paused stops decoding", (await playing()) === 0);
  await page.evaluate(() => { document.getElementById("o").paused = false; });
  await page.waitForTimeout(150);
  check("unpausing resumes", (await playing()) === 1);
  await page.evaluate(() => document.getElementById("o").setAttribute("speed", "1.5"));
  await page.waitForTimeout(150);
  check("speed sets the playback rate", await page.evaluate(() => [...document.getElementById("o").shadowRoot.querySelectorAll("video")].find((v) => !v.paused).playbackRate === 1.5));
  await ctx.close();
}
{
  const { ctx, page } = await open(`<script>window.__r=0;addEventListener("DOMContentLoaded",()=>document.getElementById("o").addEventListener("aurbready",()=>window.__r++))</script><aurb-orb id="o" ${src} style="width:120px"></aurb-orb>`);
  await settled(page);
  await page.evaluate(() => { document.getElementById("o").state = "thinking"; });
  await page.waitForTimeout(900);
  check("the ready event fires once", (await page.evaluate(() => window.__r)) === 1);
  await ctx.close();
}

console.log("\n-- React --");
{
  const { build } = await import("esbuild");
  await build({ stdin: { contents: `
    import { createElement as h, createRef, useState } from "react";
    import { createRoot } from "react-dom/client";
    import { Aurb } from ${JSON.stringify(path.resolve("dist/react.js").replaceAll("\\", "/"))};
    window.__events = []; window.__ref = createRef();
    function App() {
      const [state, setState] = useState("idle");
      const [isStatic, setStatic] = useState(false);
      window.__set = setState; window.__static = setStatic;
      return h(Aurb, { id: "o", ref: window.__ref, ${props}, state, static: isStatic, paused: false, className: "c", style: { width: 120 }, onStateChange: (s) => window.__events.push(s), onReady: () => window.__events.push("ready") });
    }
    createRoot(document.getElementById("root")).render(h(App));
  `, resolveDir: path.resolve(".") }, bundle: true, outfile: path.join(root, "react-app.js"), logLevel: "error", define: { "process.env.NODE_ENV": '"production"' } });
  const { ctx, page } = await open(`<div id="root"></div><script src="/react-app.js"></script>`);
  await page.waitForFunction(() => window.__ref?.current, null, { timeout: 8000 });
  await settled(page);
  check("ref reaches the element", await page.evaluate(() => window.__ref.current.tagName === "AURB-ORB" && typeof window.__ref.current.flash === "function"));
  check("static={false} and paused={false} leave no attribute", await page.evaluate(() => !window.__ref.current.hasAttribute("static") && !window.__ref.current.hasAttribute("paused")));
  check("className becomes class", await page.evaluate(() => window.__ref.current.getAttribute("class") === "c"));
  await page.evaluate(() => window.__set("thinking"));
  await page.waitForTimeout(900);
  check("the state prop drives the orb", (await status(page)).file === "thinking-dark-160.webm");
  const ev = await page.evaluate(() => window.__events);
  check("onReady and onStateChange fire", ev.includes("ready") && ev.includes("thinking"), ev.join(","));
  await page.evaluate(() => window.__static(true));
  await page.waitForTimeout(300);
  check("static={true} stops the video", await page.evaluate(() => window.__ref.current.hasAttribute("static") && [...window.__ref.current.shadowRoot.querySelectorAll("video")].every((v) => v.paused)));
  await ctx.close();
}
{
  // React 19 writes a prop as a property when the element has one by that name, and prefetch is also a method.
  const { build } = await import("esbuild");
  await build({ stdin: { contents: `
    import { createElement as h, createRef, useState } from "react";
    import { createRoot } from "react-dom/client";
    import { Aurb } from ${JSON.stringify(path.resolve("dist/react.js").replaceAll("\\", "/"))};
    window.__ref = createRef();
    function App() {
      const [list, setList] = useState("working");
      window.__list = setList;
      return h("div", null,
        h(Aurb, { ref: window.__ref, ${props}, prefetch: list, style: { width: 120 } }),
        h("aurb-orb", { id: "raw", ${props}, prefetch: "thinking", theme: "light", style: { width: 120 } }));
    }
    createRoot(document.getElementById("root")).render(h(App));
  `, resolveDir: path.resolve(".") }, bundle: true, outfile: path.join(root, "react-prefetch.js"), logLevel: "error", define: { "process.env.NODE_ENV": '"production"' } });
  const { ctx, page, media, errors } = await open(`<div id="root"></div><script src="/react-prefetch.js"></script>`);
  await page.waitForFunction(() => window.__ref?.current, null, { timeout: 8000 });
  await page.waitForTimeout(1500);
  check("the prefetch prop fetches its state", media.has("working-dark-160.webm"), [...media].join(", "));
  check("prefetch on a bare <aurb-orb> in React fetches too", media.has("thinking-light-160.webm"), [...media].join(", "));
  check("prefetch props never replace the method", await page.evaluate(() => typeof window.__ref.current.prefetch === "function" && typeof document.getElementById("raw").prefetch === "function"));
  await page.evaluate(() => window.__list("thinking"));
  await page.waitForTimeout(800);
  check("a changed prefetch prop fetches the new state", media.has("thinking-dark-160.webm"), [...media].join(", "));
  await page.evaluate(() => { window.__ref.current.prefetch(["idle"]); window.__list(undefined); });
  await page.waitForTimeout(300);
  check("removing the prop removes the attribute", await page.evaluate(() => !window.__ref.current.hasAttribute("prefetch")));
  check("nothing throws", errors.length === 0, errors.join("; "));
  await ctx.close();
}

console.log("\n-- Fallback and theme --");
{
  // A browser that cannot play VP9 gets H.264 from the same markup.
  const { ctx, page, media } = await open(`<aurb-orb id="o" ${src} style="width:120px"></aurb-orb>`, { init: () => { HTMLVideoElement.prototype.canPlayType = () => ""; } });
  await page.waitForTimeout(1200);
  const st = await status(page);
  check("falls back to H.264 when VP9 is unsupported", st.file === "idle-dark-160.mp4" && !st.paused, st.file);
  await ctx.close();
}
{
  const { ctx, page } = await open(`<aurb-orb id="o" ${src} style="width:120px"></aurb-orb>`);
  await page.waitForTimeout(1200);
  await page.evaluate(() => { document.documentElement.className = "light"; document.body.style.background = "#f5f5f3"; });
  await page.waitForTimeout(1300);
  const st = await status(page);
  const blend = await page.evaluate(() => document.getElementById("o").shadowRoot.querySelector(".k").style.mixBlendMode);
  check("follows a live theme switch", st.file === "idle-light-160.webm" && blend === "multiply", `${st.file}, ${blend}`);
  await ctx.close();
}

console.log("\n-- Rest transitions --");
{
  // A state change on a solid orb walks through the rest pose, each step joined on a segment boundary.
  const tag = (extra) => `<aurb-orb id="o" orb="${BASE}/${restFolder}" sizes="80" ${extra} style="width:80px"></aurb-orb>`;
  const watch = (page) => page.evaluate(async () => {
    const o = document.getElementById("o"), out = [];
    const top = () => [...o.shadowRoot.querySelectorAll("video")].find((v) => v.style.zIndex === "1");
    o.state = "thinking";
    for (const end = performance.now() + 3500; performance.now() < end; await new Promise((r) => setTimeout(r, 10))) {
      const v = top(), f = (window.__names[v?.src] ?? v?.src)?.split("/").pop();
      if (f && f !== out.at(-1)?.f) out.push({ f, t: v.currentTime });
    }
    return out;
  });
  const name = (s) => s.f.replace(/-(dark|light)-\d+\.\w+$/, "");
  {
    const { ctx, page, errors } = await open(tag('transition="rest"'), { esm: true });
    await settled(page);
    const seen = await watch(page);
    check("a solid orb moves through its rest pose", seen.map(name).join() === "idle,idle-out,rest,thinking-in,thinking", seen.map(name).join(", "));
    const off = (t) => Math.min(t % 0.5, 0.5 - (t % 0.5));
    check("each step joins on a segment boundary", seen.length > 1 && seen.slice(1).every((s) => off(s.t) < 0.1), seen.map((s) => s.t.toFixed(2)).join(", "));
    check("nothing throws", !errors.length, errors.join("; "));
    // A change of mind part way through: back to idle while it is still sinking. It must still arrive, through the rest pose.
    const end = await page.evaluate(async () => {
      const o = document.getElementById("o"), top = () => [...o.shadowRoot.querySelectorAll("video")].find((v) => v.style.zIndex === "1");
      o.state = "idle";
      await new Promise((r) => setTimeout(r, 150));
      o.state = "thinking";
      await new Promise((r) => setTimeout(r, 150));
      o.state = "idle";
      await new Promise((r) => setTimeout(r, 3000));
      return (window.__names[top()?.src] ?? top()?.src)?.split("/").pop();
    });
    check("a change of mind part way through still arrives", end === "idle-dark-80.webm", end);
    await ctx.close();
  }
  {
    const { ctx, page, media } = await open(tag(""), { esm: true });
    await settled(page);
    const seen = await watch(page);
    check("without transition=rest it crossfades as before", seen.map(name).join() === "idle,thinking" && ![...media].some((m) => /-(out|in)-/.test(m)), seen.map(name).join(", "));
    await ctx.close();
  }
}

await browser.close();
server.close();
console.log(`\n${total - failed}/${total} passed.`);
process.exit(failed ? 1 : 0);
