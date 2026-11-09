'use strict';
/* =========================================================================
   Small shared helpers: math, easing, seeded random, colour utilities.
   ========================================================================= */

const TAU = Math.PI * 2;
const TILE = 40;          // map tile size in world px
const SUB = 20;           // collision cell size (half a tile)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const sign = v => (v < 0 ? -1 : 1);
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = t => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const turnTo = (a, b, max) => a + clamp(angDiff(a, b), -max, max);

/* deterministic generator so generated rooms always lay out the same way */
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* closest distance from point p to segment ab, plus the param t along ab */
function segPointDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-6;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  const cx = ax + dx * t, cy = ay + dy * t;
  return { d: Math.hypot(px - cx, py - cy), t };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(lerp(v, B[i], clamp(t, 0, 1))));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
const shade = (hex, t) => (t < 0 ? mixHex(hex, '#000000', -t) : mixHex(hex, '#ffffff', t));

/* pre-rendered radial glow sprites, cached per colour */
const Glow = (() => {
  const cache = new Map();
  function get(color) {
    let c = cache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, rgba(color, 1));
    grd.addColorStop(0.25, rgba(color, 0.55));
    grd.addColorStop(0.6, rgba(color, 0.12));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    cache.set(color, c);
    return c;
  }
  function draw(ctx, color, x, y, r, alpha = 1) {
    if (alpha <= 0 || r <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(get(color), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }
  return { get, draw };
})();

/* CanvasRenderingContext2D.roundRect for older browsers */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(typeof r === 'number' ? r : 0, w / 2, h / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

function fmt(n) {
  return n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.floor(n));
}
function fmtTime(s) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
}
const dayIndex = () => Math.floor(Date.now() / 86400000);
