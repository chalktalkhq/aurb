// The orb renderer: one frame per pixel on the CPU, piped into ffmpeg.
//
// Every state shares one "body": the same large folds, on the same one-cycle clock, for the
// same loop length. A state only adds behaviour on top. That is what makes a crossfade between
// two states read as one object changing mood rather than two videos dissolving.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isMainThread, parentPort, workerData } from "node:worker_threads";

export const GENERATOR_VERSION = 1;
const TAU = Math.PI * 2;
const BALL = 0.8; // sphere radius as a share of the half frame; the margin holds the glow
const DRIFT = 0.42;

// Behaviour per state. All cycle counts are whole numbers, so every loop closes exactly.
//   energy: overall light    flow/flowN: fast fine motion    orbit/orbitN: a core circling inside
//   sweep/sweepN: light running round the rim    pulse/pulseN: light beating (two rates, less robotic)
//   breathe/breatheN: the outline growing and shrinking    rim: edge brightness
//   rimBeat/rimBeatN: the rim swelling    coreBeat/coreBeatN: the inner glow beating
//   tint: default colour for this state
// Keep one clear signature per state: at 40px a person reads motion, not texture. Avoid concentric
// rings here: they look like a target, and they were tried and removed.
export const STATES = {
  idle: { energy: 1 },
  listening: { energy: 1.08, breathe: 0.014, breatheN: 2, rim: 1.2, rimBeat: 0.75, rimBeatN: 2 },
  thinking: { energy: 1.05, flow: 0.55, flowN: 3, orbit: 0.42, orbitN: 2 },
  working: { energy: 1, flow: 0.3, flowN: 2, sweep: 1.3, sweepN: 3 },
  speaking: { energy: 1.08, pulse: 0.12, pulseN: [5, 8], breathe: 0.01, breatheN: 5, coreBeat: 1.5, coreBeatN: 5 },
  success: { energy: 1.2, rim: 1.5, breathe: 0.012, breatheN: 1, tint: "#22c55e" },
  error: { energy: 1.05, flow: 0.4, flowN: 4, pulse: 0.18, pulseN: [2, 3], tint: "#ef4444" },
  asleep: { energy: 0.45, breathe: 0.008, breatheN: 1 },
};
export const ALIASES = { running: "working", loading: "thinking", busy: "working", talking: "speaking", processing: "thinking", recording: "listening", done: "success", failed: "error", sleeping: "asleep", dormant: "asleep", default: "idle" };

// One recipe per theme: on dark everything is light; on light it is ink, so the crescent moves to
// the far side (a shadow on the lit side reads as a hole) and hugs the rim (or the ball goes grey).
export const STYLES = {
  silk: {
    dark: { core: 0.3, veil: 1.7, limit: 1.6, crescent: 1.5, crescentPow: 1.7, edge: 1, nearCentre: 0.7, nearBase: 0.1, sheet: 0.04 },
    light: { core: 0.13, veil: 1.5, limit: 3.2, crescent: 1.5, crescentPow: 3.4, edge: 1.7, nearCentre: 0.8, nearBase: 0.2, sheet: 0.02 },
  },
  glass: {
    dark: { core: 0.1, veil: 0.55, limit: 1.6, crescent: 1.6, crescentPow: 2.4, edge: 1.2, nearCentre: 0.4, nearBase: 0.05, sheet: 0, spot: 0.16 },
    light: { core: 0.04, veil: 0.6, limit: 3.2, crescent: 1.3, crescentPow: 4.2, edge: 1.9, nearCentre: 0.5, nearBase: 0.1, sheet: 0 },
  },
  smoke: {
    dark: { core: 0.2, field: 0.6, crescent: 1.2, crescentPow: 2, edge: 0.8 },
    light: { core: 0.08, field: 0.3, crescent: 1.2, crescentPow: 3.6, edge: 1.6 },
  },
  plasma: {
    dark: { core: 0.1, field: 1.15, crescent: 0.7, crescentPow: 2.4, edge: 0.7 },
    light: { core: 0.03, field: 0.6, crescent: 0.6, crescentPow: 4, edge: 1.2 },
  },
  dots: {
    dark: { core: 0.08, field: 1.05, crescent: 0.3, crescentPow: 3, edge: 0.5 },
    light: { core: 0.02, field: 0.85, crescent: 0.3, crescentPow: 4.5, edge: 0.8 },
  },
};

const ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- noise
const PERM = new Uint8Array(512);
const VALS = new Float32Array(256);
{
  let seed = 4242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) VALS[i] = rnd();
}
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10), w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  const at = (a, b, c) => VALS[PERM[PERM[PERM[(X + a) & 255] + ((Y + b) & 255)] + ((Z + c) & 255)]];
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(at(0, 0, 0), at(1, 0, 0), u), l(at(0, 1, 0), at(1, 1, 0), u), v),
    l(l(at(0, 0, 1), at(1, 0, 1), u), l(at(0, 1, 1), at(1, 1, 1), u), v),
    w,
  );
}

// ---------------------------------------------------------------- textures
// Thin fold lines on a warped field. Off-axis, so the lattice never shows as straight edges.
function veil(ix, iy, iz, ox, oy, seed, sheetShare, detail) {
  const nx = 0.61 * ix + 0.53 * iy - 0.59 * iz;
  const ny = -0.34 * ix + 0.85 * iy + 0.4 * iz;
  const nz = 0.71 * ix - 0.05 * iy + 0.7 * iz;
  const warp = noise(nx * 0.95 + ox + seed, ny * 0.95 + oy, nz * 0.95 + seed * 0.5);
  const warp2 = noise(nx * 0.8 - oy + seed + 9, ny * 0.8 + ox + 4, nz * 0.8 + 2);
  // Twist stays low: more of it closes the lines of the field into rings, which look like planets.
  const phase = (nx * 0.75 + ny * 1.05 + nz * 0.5) * detail + (warp * 2 + warp2) * 0.5;
  const s = Math.sin(phase * Math.PI);
  const fold = Math.exp(-(s * s) / 0.085);
  const sheet = 0.5 + 0.5 * s;
  const presence = ss(0.2, 0.58, noise(nx * 1.25 - ox + seed + 31, ny * 1.25 + oy + 5, nz * 1.25 + 8));
  return (1 - sheetShare) * fold * presence + sheetShare * sheet * sheet;
}

function smokeField(x, y, z, ox, oy, detail) {
  const f = 1.25 * detail;
  const wx = noise(x * f + 3 + ox, y * f + 9, z * f + 1 + oy) - 0.5;
  const wy = noise(x * f + 17, y * f + 2 + oy, z * f + 12 - ox) - 0.5;
  const q = 1.6 * detail;
  const a = noise(x * q + wx * 1.9 + ox * 0.6, y * q + wy * 1.9 - oy * 0.6, z * q + 4);
  const b = noise(x * q * 2.03 + wy + 11, y * q * 2.03 + wx + 7, z * q * 2.03 + 3);
  // A wide ramp: a narrow one gives hard-edged patches that read as camouflage, not vapour.
  return ss(0.2, 0.85, 0.72 * a + 0.28 * b);
}

function plasmaField(x, y, z, ox, oy, detail) {
  const a = noise(x * 0.9 * detail + ox + 5, y * 0.9 * detail + oy, z * 0.9 * detail + 2);
  const b = noise(y * 1.1 * detail - oy + 21, z * 1.1 * detail + ox, x * 1.1 * detail + 8);
  return 0.5 + 0.5 * Math.sin(Math.PI * (a * 3.2 + b * 2 + x * 0.5 + y * 0.4));
}

const TILT = { cx: Math.cos(0.42), sx: Math.sin(0.42), cz: Math.cos(-0.3), sz: Math.sin(-0.3) };
const SYMMETRY = 12;
// A lattice of dots: the rotation is a whole step of its symmetry, so the loop closes exactly.
function dotsField(x, y, z, t, lit, detail) {
  const rings = Math.round(38 * detail);
  const x1 = x * TILT.cz + y * TILT.sz, y1 = -x * TILT.sz + y * TILT.cz;
  const y2 = y1 * TILT.cx + z * TILT.sx, z2 = -y1 * TILT.sx + z * TILT.cx;
  const lat = Math.asin(Math.max(-1, Math.min(1, y2)));
  const lon = Math.atan2(x1, z2) - (TAU / SYMMETRY) * t;
  const ring = Math.min(rings - 1, Math.max(0, Math.floor(((lat + Math.PI / 2) / Math.PI) * rings)));
  const ringLat = -Math.PI / 2 + (Math.PI * (ring + 0.5)) / rings;
  const count = Math.max(SYMMETRY, Math.round((Math.cos(ringLat) * 2 * rings) / SYMMETRY) * SYMMETRY);
  const step = TAU / count;
  const shifted = lon + (ring % 2) * 0.5 * step;
  const dLon = shifted - Math.round(shifted / step) * step;
  const dist = Math.hypot(lat - ringLat, dLon * Math.cos(lat));
  const key = ss(-0.34, 0.95, lit);
  const radius = (Math.PI / rings) * (0.1 + 0.17 * key);
  // Rings bunch into a visible spiral at the pole, so the lattice dissolves before it gets there.
  return ss(radius * 1.35, radius * 0.5, dist) * (0.06 + 0.94 * key ** 1.3) * ss(0.04, 0.22, Math.cos(lat));
}

// ---------------------------------------------------------------- colour
export function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// A navy glow disappears on black and a yellow ink disappears on white: nudge it until it reads.
function legible(rgb, theme) {
  const l = luminance(rgb);
  if (theme === "dark" && l < 0.3) { const s = 0.3 - l; return rgb.map((c) => Math.min(1, c + s * 0.9)); }
  if (theme === "light" && l > 0.42) { const s = 0.42 / l; return rgb.map((c) => c * s); }
  return rgb;
}
function rampFor(colors, theme) {
  if (!colors.length) return [theme === "dark" ? [1, 1, 1] : [0, 0, 0]];
  return colors.map((c) => legible(parseHex(c), theme));
}

// ---------------------------------------------------------------- one frame
export function makeDither(size) {
  const d = new Float32Array(size * size);
  for (let i = 0; i < d.length; i++) {
    const a = Math.sin(i * 12.9898) * 43758.5453, b = Math.sin(i * 78.233) * 12543.123;
    d[i] = ((a - Math.floor(a)) - (b - Math.floor(b))) * 0.6;
  }
  return d; // static: moving grain costs far more bytes than it hides banding
}

export function renderFrame(t, stateName, theme, cfg, dither) {
  const S = cfg.size;
  const st = { energy: 1, flow: 0, flowN: 1, orbit: 0, orbitN: 1, sweep: 0, sweepN: 1, pulse: 0, pulseN: [1, 1], breathe: 0, breatheN: 1, rim: 1, rimBeat: 0, rimBeatN: 1, coreBeat: 0, coreBeatN: 1, ...STATES[stateName], ...cfg.customStates?.[stateName] };
  const style = STYLES[cfg.style][theme];
  const LIGHT = theme === "dark" ? [-0.58, 0.68, 0.45] : [0.58, -0.68, 0.45];
  const override = cfg.stateColors[stateName];
  const tintHex = override === "none" ? undefined : override ?? st.tint;
  const ramp = rampFor(tintHex ? [tintHex] : (theme === "dark" ? cfg.colorsDark : cfg.colorsLight) ?? cfg.colors, theme);

  // Whole numbers only, or the loop would not close.
  const speed = (n) => Math.max(1, Math.round(n * cfg.speed));
  const flowN = speed(st.flowN), orbitN = speed(st.orbitN), sweepN = speed(st.sweepN), breatheN = speed(st.breatheN);
  const rimLevel = st.rim * (1 + st.rimBeat * (0.5 + 0.5 * Math.sin(TAU * speed(st.rimBeatN) * t)));
  const coreLevel = 1 + st.coreBeat * (0.5 + 0.5 * (0.6 * Math.sin(TAU * speed(st.coreBeatN) * t) + 0.4 * Math.sin(TAU * speed(st.coreBeatN + 3) * t + 1.1)));

  // The shared body: one cycle in every state, so states stay matched during a crossfade.
  const bodyX = Math.cos(TAU * t) * DRIFT, bodyY = Math.sin(TAU * t) * DRIFT;
  const ox = bodyX + Math.cos(TAU * flowN * t) * st.flow, oy = bodyY + Math.sin(TAU * flowN * t) * st.flow;
  const bx = Math.cos(TAU * t + 1) * 0.22, by = Math.sin(TAU * t + 1) * 0.22;
  const breath = 1 + st.breathe * Math.sin(TAU * breatheN * t);
  const pulse = 1 + st.pulse * (0.6 * Math.sin(TAU * speed(st.pulseN[0]) * t) + 0.4 * Math.sin(TAU * speed(st.pulseN[1]) * t + 1.1));
  const orbitX = Math.cos(TAU * orbitN * t) * st.orbit, orbitY = Math.sin(TAU * orbitN * t) * st.orbit;
  const sweepAt = (sweepN * t) % 1;
  const gain = st.energy * cfg.energy * pulse;
  const feather = 0.018 * cfg.softness;
  const multi = ramp.length > 1;

  const rgb = Buffer.alloc(S * S * 3);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const i = py * S + px;
    const sx = ((px + 0.5) / (S / 2) - 1) / BALL / breath;
    const sy = (1 - (py + 0.5) / (S / 2)) / BALL / breath;
    const rr = Math.hypot(sx, sy);
    const dirx = rr > 0 ? sx / rr : 0, diry = rr > 0 ? sy / rr : 0;
    // The outline only breathes. A big wobble is what makes an orb look like jelly.
    const R = 1 + cfg.wobble * (noise(dirx * 1.1 + bx + 20, diry * 1.1 + by + 20, 3.1) - 0.5);
    const sideLit = ss(-0.6, 0.95, (dirx * LIGHT[0] + diry * LIGHT[1]) / 0.894);
    const halo = (0.015 + 0.13 * sideLit) * cfg.glow;
    // Light has to reach exactly nothing before the frame's circle. Even 1 percent left at the
    // clip edge is a visible faint disc on a flat panel, and exp() alone never gets there.
    const frameR = Math.hypot((px + 0.5) / (S / 2) - 1, (py + 0.5) / (S / 2) - 1);
    const toEdge = ss(0.985, 0.86, frameR);

    let v, hx = sx, hy = sy, hz = 0;
    if (rr >= R) {
      v = halo * Math.exp(-(rr - R) / 0.075) * Math.min(gain, 1.3) * toEdge;
    } else {
      const x = sx / R, y = sy / R;
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      const graze = 1 - z;
      hx = x; hy = y; hz = z;
      const lit = x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2];
      const crescent = graze ** style.crescentPow * ss(-0.25, 0.92, lit + 0.12) * style.crescent;
      const bounce = graze ** 2.4 * ss(0.15, 0.95, -(x * LIGHT[0] + y * LIGHT[1]) / 0.894) * 0.3;
      const edge = graze ** 9 * (0.34 + 0.5 * sideLit) * style.edge * rimLevel;
      const body = 0.018 + 0.05 * ss(-0.5, 1, lit);

      let fill;
      if (cfg.style === "silk" || cfg.style === "glass") {
        const near = veil(x, y, z, ox, oy, 0, style.sheet, cfg.detail) * (style.nearBase + 0.24 * ss(-0.3, 0.95, lit)) * (style.nearCentre + (1 - style.nearCentre) * ss(0.05, 0.75, graze));
        const far = veil(x, y, -z, -oy * 0.7, ox * 0.7, 13, style.sheet, cfg.detail) * 0.05 * (0.5 + 0.5 * z);
        // Ribbons that bunch up settle at a soft limit instead of pooling into knots.
        fill = ((near + far) * style.veil) / (1 + (near + far) * style.veil * style.limit);
        if (style.spot) { const dx = x - LIGHT[0] * 0.62, dy = y - LIGHT[1] * 0.62; fill += style.spot * Math.exp(-(dx * dx + dy * dy) / 0.09); }
      } else if (cfg.style === "smoke") {
        fill = style.field * (smokeField(x, y, z, ox, oy, cfg.detail) * (0.28 + 0.5 * ss(-0.4, 0.95, lit)) + 0.25 * smokeField(x, y, -z, -oy, ox, cfg.detail) * 0.4);
      } else if (cfg.style === "plasma") {
        fill = style.field * (0.12 + 0.62 * plasmaField(x, y, z, ox, oy, cfg.detail)) * (0.55 + 0.45 * ss(-0.5, 0.9, lit)) * (1 - 0.35 * graze ** 3);
      } else {
        const swell = 1 + 0.25 * Math.sin(2.6 * x + 1.7 * y + 1.1 * z - TAU * t) + st.flow * 0.5 * Math.sin(-1.9 * x + 2.8 * y - TAU * flowN * t);
        fill = style.field * dotsField(x, y, z, t, lit, cfg.detail) * swell;
      }

      // A soft glow wanders inside; in "thinking" it tightens and circles.
      const gx = x + LIGHT[0] * 0.3 + oy * 0.32 + orbitX, gy = y + LIGHT[1] * 0.3 - ox * 0.32 + orbitY;
      const coreSize = st.orbit ? 0.11 : 0.2;
      const core = style.core * (st.orbit ? 1.9 : 1) * coreLevel * Math.exp(-(gx * gx + gy * gy) / coreSize);

      let extra = 0;
      if (st.sweep) {
        // A long fading tail with a soft head: without the head fade it cuts a hard wedge.
        const a = ((Math.atan2(y, x) / TAU + 1 - sweepAt) % 1 + 1) % 1;
        extra += st.sweep * graze ** 2.2 * Math.exp(-a * 4.5) * ss(0, 0.07, a);
      }
      v =(body + crescent + bounce + edge + fill + core + extra) * gain;
      v = (v * ss(R, R - feather, rr) + halo * ss(R - feather, R, rr)) * toEdge;
    }

    const I = 1 - Math.exp(-v * 1.75);
    let c = ramp[0];
    if (multi) {
      // Hue follows a slow field of its own, so colour pools instead of banding by position.
      const hn = Math.min(0.999, Math.max(0, (noise(hx * 0.8 + bodyX * 0.5 + 40, hy * 0.8 + bodyY * 0.5 + 9, hz * 0.8 + 3) - 0.22) / 0.56)) * (ramp.length - 1);
      const a = Math.floor(hn), f = hn - a, A = ramp[a], B = ramp[Math.min(ramp.length - 1, a + 1)];
      c = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
    }
    const d = I < 0.004 ? 0 : dither[i]; // pure black or white stays pure, or the blend shows it
    for (let k = 0; k < 3; k++) {
      let out;
      if (theme === "dark") {
        const hot = ss(0.62, 1, I); // the hottest light always burns towards white, as real light does
        out = (c[k] * (1 - hot) + hot) * I;
      } else {
        out = 1 - Math.min(1, I * 0.96) * (1 - c[k]);
      }
      rgb[i * 3 + k] = Math.max(0, Math.min(255, Math.round(out * 255 + d)));
    }
  }
  return rgb;
}

// ---------------------------------------------------------------- ffmpeg
export function findFfmpeg() {
  const works = (bin) => { try { return spawnSync(bin, ["-hide_banner", "-encoders"], { encoding: "utf8", maxBuffer: 1 << 24 }).stdout?.includes("libx264"); } catch { return false; } };
  const candidates = [process.env.FFMPEG, "ffmpeg"].filter(Boolean);
  for (const c of candidates) if (works(c)) return c;
  // Remotion and ffmpeg-static projects already ship one; look before asking for an install.
  const walk = (dir, depth) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && /^ffmpeg(\.exe)?$/.test(e.name) && works(full)) return full;
      if (e.isDirectory() && depth > 0 && /compositor|ffmpeg|^@remotion$|^\.pnpm$|^node_modules$/.test(e.name)) { const r = walk(full, depth - 1); if (r) return r; }
    }
    return null;
  };
  let dir = process.cwd();
  for (let up = 0; up < 4; up++) { const r = walk(path.join(dir, "node_modules"), 6); if (r) return r; dir = path.dirname(dir); }
  return null;
}

// Frames go in as BMP: stripped builds (Remotion's, for one) have no rawvideo input, but every
// build reads BMP through image2pipe, and writing one is a header and a row flip.
function toBmp(rgb, w, h) {
  const stride = (w * 3 + 3) & ~3;
  const out = Buffer.alloc(54 + stride * h);
  out.write("BM", 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(stride * h, 34);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * stride, i = y * w * 3;
    for (let x = 0; x < w; x++, i += 3, o += 3) { out[o] = rgb[i + 2]; out[o + 1] = rgb[i + 1]; out[o + 2] = rgb[i]; }
  }
  return out;
}

export function encodeStill(ffmpeg, rgb, w, h, file, extra = []) {
  const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "bmp", "-i", "-", "-frames:v", "1", "-update", "1", ...extra, file], { input: toBmp(rgb, w, h), maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg still failed: ${r.stderr}`);
}

function startEncoder(ffmpeg, cfg, file, codecArgs) {
  const proc = spawn(ffmpeg, [
    "-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "bmp", "-framerate", String(cfg.fps), "-i", "-",
    "-vf", "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p",
    ...codecArgs,
    // A keyframe every second: a state change can seek to the matching moment almost at once.
    "-g", String(cfg.fps), "-threads", "2",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-an", file,
  ], { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (d) => { stderr += d; });
  proc.done = new Promise((res, rej) => proc.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg failed on ${path.basename(file)}: ${stderr}`)))));
  return proc;
}

async function renderJob({ ffmpeg, cfg, state, theme, base, poster }) {
  const S = cfg.size, frames = Math.round(cfg.seconds * cfg.fps);
  const dither = makeDither(S);
  // VP9 is about 40% smaller for the same orb, so it is served first; H.264 is there for the rest.
  const mp4 = `${base}.mp4`, webm = `${base}.webm`;
  const encoders = [
    startEncoder(ffmpeg, cfg, mp4, ["-c:v", "libx264", "-profile:v", "high", "-preset", "veryslow", "-crf", String(cfg.crf), "-aq-mode", "3", "-movflags", "+faststart"]),
    startEncoder(ffmpeg, cfg, webm, ["-c:v", "libvpx-vp9", "-crf", String(cfg.crf + 15), "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2"]),
  ];

  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 3) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length); };
  let first, second, prev;
  for (let f = 0; f < frames; f++) {
    const rgb = renderFrame(f / frames, state, theme, cfg, dither);
    if (f === 0) { first = rgb; if (poster) encodeStill(ffmpeg, rgb, S, S, poster, ["-q:v", "3"]); }
    if (f === 1) second = rgb;
    prev = rgb;
    const bmp = toBmp(rgb, S, S);
    await Promise.all(encoders.map((e) => (e.stdin.write(bmp) ? null : new Promise((r) => e.stdin.once("drain", r)))));
  }
  for (const e of encoders) e.stdin.end();
  await Promise.all(encoders.map((e) => e.done));
  const step = diff(first, second), seam = diff(prev, first);
  // Around the circle the player clips to: anything but pure black or white here shows as a disc.
  const rim = [];
  for (let a = 0; a < 32; a++) {
    const x = Math.round(S / 2 + Math.cos((a / 32) * TAU) * (S / 2) * 0.99 - 0.5), y = Math.round(S / 2 + Math.sin((a / 32) * TAU) * (S / 2) * 0.99 - 0.5);
    rim.push(first[(y * S + x) * 3], first[(y * S + x) * 3 + 1], first[(y * S + x) * 3 + 2]);
  }
  const kb = (f) => Math.round(fs.statSync(f).size / 1024);
  return { state, theme, size: S, kb: kb(mp4), webmKb: kb(webm), seam: +(seam / Math.max(step, 0.001)).toFixed(2), rim: theme === "dark" ? Math.max(...rim) : 255 - Math.min(...rim) };
}

if (!isMainThread) {
  renderJob(workerData).then((r) => parentPort.postMessage({ ok: r }), (e) => parentPort.postMessage({ err: String(e.message || e) }));
}

