// End-to-end: renders a real orb, serves it over HTTP, and checks behaviour and exactly which bytes
// get downloaded in a real browser. Run with: npm test
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(".tmp/test");
fs.mkdirSync(root, { recursive: true });
console.log("Rendering the test orb...");
execFileSync(process.execPath, ["cli/aurb.mjs", "add", "chalk", "--states", "idle,thinking,working", "--sizes", "160,320", "--out", root, "--seconds", "4"], { stdio: "pipe" });
const folderName = fs.readdirSync(root).find((f) => f.startsWith("chalk-"));
const blob = path.join(root, folderName);
fs.copyFileSync("dist/aurb.global.js", path.join(root, "aurb.global.js"));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mp4": "video/mp4", ".webm": "video/webm", ".jpg": "image/jpeg", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/__page") { res.writeHead(200, { "content-type": "text/html" }); res.end(global.__page); return; }
  const file = path.join(root, url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const size = fs.statSync(file).size, type = TYPES[path.extname(file)] ?? "application/octet-stream";
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
  if (range) {
    const start = Number(range[1]), end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { "content-type": type, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
    fs.createReadStream(file).pipe(res);
  }
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

let failed = 0, total = 0;
const check = (name, ok, detail = "") => { total++; if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`); };

const pageHtml = (body, htmlClass = "dark") => `<!doctype html><html class="${htmlClass}"><body style="margin:0;background:${htmlClass === "dark" ? "#191919" : "#f5f5f3"}"><script src="/aurb.global.js"></script>${body}</body></html>`;

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"] });

async function open(body, { htmlClass = "dark", ctxOptions = {}, init } = {}) {
  global.__page = pageHtml(body, htmlClass);
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1, ...ctxOptions });
  const page = await ctx.newPage();
  const media = new Set();
  page.on("request", (r) => { if (/\.(mp4|webm|jpg)/.test(r.url())) media.add(r.url().split("/").pop()); });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (init) await page.addInitScript(init);
  await page.goto(`${BASE}/__page`);
  return { ctx, page, media, errors };
}
const src = `/${folderName}`;
const status = (page, id = "o") => page.evaluate((id) => {
  const o = document.getElementById(id);
  const vs = [...o.shadowRoot.querySelectorAll("video")];
  const top = vs.find((v) => getComputedStyle(v).opacity === "1") ?? vs[0];
  return { state: o.state, file: decodeURI(top.currentSrc).split("/").pop(), opacity: getComputedStyle(top).opacity, paused: top.paused, playing: vs.filter((v) => !v.paused).length };
}, id);

console.log("\n-- Downloads only what is needed --");
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" src="${src}" style="width:120px"></aurb-orb>`);
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
  const { ctx, page, media } = await open(`<aurb-orb id="o" src="${src}" style="width:240px"></aurb-orb>`);
  await page.waitForTimeout(1200);
  check("large orb takes the large file", media.has("idle-dark-320.webm"), [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" src="${src}" style="width:120px"></aurb-orb>`, { ctxOptions: { deviceScaleFactor: 2 } });
  await page.waitForTimeout(1200);
  check("retina doubles the size it asks for", media.has("idle-dark-320.webm"), [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<div style="height:3000px"></div><aurb-orb id="o" src="${src}" style="width:120px"></aurb-orb>`);
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
  const { ctx, page, media } = await open(`<aurb-orb id="o" static src="${src}" style="width:120px"></aurb-orb>`);
  await page.waitForTimeout(800);
  check("static: poster only", media.size === 1 && media.has("poster-dark-160.jpg"), [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" src="${src}" style="width:120px"></aurb-orb>`, { ctxOptions: { reducedMotion: "reduce" } });
  await page.waitForTimeout(800);
  check("reduced motion: poster only", media.size === 1, [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" src="${src}" style="width:120px"></aurb-orb>`, { init: () => Object.defineProperty(navigator, "connection", { value: { saveData: true } }) });
  await page.waitForTimeout(800);
  check("Save-Data: poster only", media.size === 1, [...media].join(", "));
  await ctx.close();
}

console.log("\n-- Prefetch --");
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" src="${src}" prefetch="thinking" style="width:120px"></aurb-orb>`);
  await page.waitForTimeout(1500);
  check("attribute fetches the listed state once idle", media.has("thinking-dark-160.webm") && !media.has("working-dark-160.webm"), [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" src="${src}" style="width:120px"></aurb-orb><button id="b" style="position:fixed;left:300px;top:300px;width:100px;height:50px">Send</button>`);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getElementById("o").prefetchOn(document.getElementById("b"), "working"));
  check("intent: nothing before hover", !media.has("working-dark-160.webm"));
  await page.hover("#b");
  await page.waitForTimeout(500);
  check("intent: fetched on hover", media.has("working-dark-160.webm"), [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open(`<aurb-orb id="o" src="${src}" prefetch="thinking" style="width:120px"></aurb-orb>`, { init: () => Object.defineProperty(navigator, "connection", { value: { effectiveType: "2g" } }) });
  await page.waitForTimeout(1200);
  check("2G: prefetch stays off", !media.has("thinking-dark-160.webm"), [...media].join(", "));
  await ctx.close();
}
{
  const { ctx, page, media } = await open("");
  await page.evaluate((src) => { aurb.prefetch({ src, states: ["thinking", "working"], theme: "light", width: 200 }); }, src);
  await page.waitForTimeout(600);
  check("standalone prefetch() works before any orb exists", media.has("thinking-light-320.webm") && media.has("working-light-320.webm"), [...media].join(", "));
  await ctx.close();
}

for (const theme of ["dark", "light"]) {
  console.log(`\n-- Behaviour, ${theme} --`);
  const { ctx, page, errors } = await open(`<aurb-orb id="o" src="${src}" style="width:240px"></aurb-orb>
    <div id="panel" style="margin:20px;padding:20px;width:160px;background:${theme === "dark" ? "#2a2a40" : "#e8e4dc"}"><aurb-orb id="p" src="${src}" style="width:120px"></aurb-orb></div>`, { htmlClass: theme, init: () => { window.__long = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: true }); } });
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

console.log("\n-- Fallback and theme --");
{
  // A browser that cannot play VP9 gets H.264 from the same markup.
  const { ctx, page, media } = await open(`<aurb-orb id="o" src="${src}" style="width:120px"></aurb-orb>`, { init: () => { HTMLVideoElement.prototype.canPlayType = () => ""; } });
  await page.waitForTimeout(1200);
  const st = await status(page);
  check("falls back to H.264 when VP9 is unsupported", st.file === "idle-dark-160.mp4" && !st.paused, st.file);
  await ctx.close();
}
{
  const { ctx, page } = await open(`<aurb-orb id="o" src="${src}" style="width:120px"></aurb-orb>`);
  await page.waitForTimeout(1200);
  await page.evaluate(() => { document.documentElement.className = "light"; document.body.style.background = "#f5f5f3"; });
  await page.waitForTimeout(1300);
  const st = await status(page);
  const blend = await page.evaluate(() => document.getElementById("o").shadowRoot.querySelector(".k").style.mixBlendMode);
  check("follows a live theme switch", st.file === "idle-light-160.webm" && blend === "multiply", `${st.file}, ${blend}`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${total - failed}/${total} passed.`);
process.exit(failed ? 1 : 0);
