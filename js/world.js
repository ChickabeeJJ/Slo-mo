'use strict';
/* =========================================================================
   World: one room at a time. Parses the ASCII map into a 20px collision
   grid, one-way platforms, props and spawns, and renders the room as a
   cut-away box in one-point perspective: every solid is extruded from the
   front plane (z = 0) to the back wall (z = 1) toward a vanishing point that
   follows the camera. Characters, bullets and debris live on the gameplay
   plane at z = ZP.
   ========================================================================= */

const DEPTH_S = 0.8;                    // back wall scale relative to the front plane
const ZP = 0.3;                         // gameplay plane depth
const KP = lerp(1, DEPTH_S, ZP);        // gameplay plane scale

const View = {
  V: { x: 0, y: 0 },                    // vanishing point (world coords)
  rel: false,                           // true while drawing inside the gameplay-plane transform
  k(z) { return lerp(1, DEPTH_S, z) / (this.rel ? KP : 1); },
  px(x, z) { return this.V.x + (x - this.V.x) * this.k(z); },
  py(y, z) { return this.V.y + (y - this.V.y) * this.k(z); },
};

class Room {
  constructor(def, themeIdx) {
    this.def = def;
    this.theme = THEMES[def.theme != null ? def.theme : themeIdx] || THEMES[0];
    const map = def.map;
    this.rows = map.length;
    this.cols = Math.max(...map.map(r => r.length));
    this.w = this.cols * TILE; this.h = this.rows * TILE;
    this.sc = this.cols * 2; this.sr = this.rows * 2;
    this.coll = new Uint8Array(this.sc * this.sr);      // collision cells
    this.rend = new Uint8Array(this.sc * this.sr);      // render cells (slopes drawn separately)
    this.inside = new Uint8Array(this.sc * this.sr);
    this.slopeTile = new Uint8Array(this.cols * this.rows);
    this.slopes = []; this.crateTiles = []; this.platforms = []; this.props = []; this.lights = [];
    this.panesDef = []; this.enemyDefs = []; this.crateDefs = []; this.barrelDefs = [];
    this.texts = (def.text || []).map(([x, y, k]) => ({ x: x * TILE, y: y * TILE, k }));
    this.spawn = { x: 2 * TILE, y: this.h - TILE };
    this.door = null; this.entry = null;
    this.decals = [];
    this.parse(map);
    this.buildFaces();
  }

  /* ----------------------------------------------------------------- parse */
  parse(map) {
    const setC = (sx, sy, v, rend = v) => { const i = sy * this.sc + sx; this.coll[i] = v; this.rend[i] = rend; };
    const pattern = {
      '#': [1, 1, 1, 1], 'X': [1, 1, 1, 1], '/': [0, 1, 1, 1], '\\': [1, 0, 1, 1],
      'a': [1, 1, 1, 0], 'b': [1, 1, 0, 1],
    };
    let ledgeRun = null;
    for (let ty = 0; ty < this.rows; ty++) {
      for (let tx = 0; tx < this.cols; tx++) {
        const ch = map[ty][tx] || ' ';
        const x = tx * TILE, y = ty * TILE, floorY = y + TILE;
        if (ch !== ' ') for (let k = 0; k < 4; k++) this.inside[(ty * 2 + (k >> 1)) * this.sc + tx * 2 + (k & 1)] = 1;
        const p = pattern[ch];
        if (p) {
          const slope = ch === 'a' || ch === 'b';
          for (let k = 0; k < 4; k++) setC(tx * 2 + (k & 1), ty * 2 + (k >> 1), p[k], slope ? 0 : p[k]);
          if (slope) { this.slopes.push({ x, y, kind: ch }); this.slopeTile[ty * this.cols + tx] = 1; }
          if (ch === 'X') this.crateTiles.push({ x, y });
        }
        if (ch === '=') {
          if (ledgeRun && ledgeRun.y === y && ledgeRun.x2 === x) ledgeRun.x2 = x + TILE;
          else { ledgeRun = { x1: x, x2: x + TILE, y, kind: 'ledge', th: 10 }; this.platforms.push(ledgeRun); }
        }
        switch (ch) {
          case 'P': this.spawn = { x: x + TILE / 2, y: floorY }; this.entry = { x: x + TILE / 2, y: floorY }; break;
          case 'D': this.door = { x: x + TILE / 2, y: floorY, w: 46, h: 104 }; break;
          case 'l': this.lights.push({ x: x + TILE, y: y + 6, w: 76 }); break;
          case 'T': this.addProp('table', x + 4, floorY, 112, 34); break;
          case 'B': this.addProp('bench', x + 6, floorY, 68, 18); break;
          case 'L': this.addProp('shelf', x + 5, floorY, 70, 78); break;
          case 'C': this.crateDefs.push({ x: x + TILE / 2, y: floorY - 16 }); break;
          case 'O': this.barrelDefs.push({ x: x + TILE / 2, y: floorY }); break;
          case 'G': {
            const last = this.panesDef.find(g => g.tx === tx && g.y + g.h === y);
            if (last) last.h += TILE; else this.panesDef.push({ tx, x: x + TILE / 2 - 4, y, w: 8, h: TILE });
            break;
          }
          default: {
            const type = ENEMY_CHARS[ch.toLowerCase()];
            if (type && ch !== 'l' && ch !== 'L') this.enemyDefs.push({ type, x: x + TILE / 2, y: floorY, away: ch !== ch.toLowerCase() });
          }
        }
      }
    }
    // glass panes stretch to touch the floor and ceiling around them
    for (const g of this.panesDef) {
      if (this.collCell(Math.floor((g.x + 4) / SUB), Math.floor((g.y - 1) / SUB))) { /* already touching */ }
    }
  }

  addProp(type, x, floorY, w, h) {
    const p = { type, x, y: floorY, w, h };
    this.props.push(p);
    this.platforms.push({ x1: x, x2: x + w, y: floorY - h, kind: type, th: type === 'shelf' ? 4 : 6, prop: p });
  }

  /* ------------------------------------------------------------- queries */
  collCell(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.sc || cy >= this.sr) return 1;
    return this.coll[cy * this.sc + cx];
  }
  isInside(x, y) {
    const cx = Math.floor(x / SUB), cy = Math.floor(y / SUB);
    if (cx < 0 || cy < 0 || cx >= this.sc || cy >= this.sr) return false;
    return !!this.inside[cy * this.sc + cx];
  }
  solidAt(x, y, panes) {
    if (this.collCell(Math.floor(x / SUB), Math.floor(y / SUB))) return true;
    if (panes) for (const g of panes) if (!g.broken && x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) return g;
    return false;
  }
  boxHit(x0, y0, x1, y1, panes) {
    const c0 = Math.floor(x0 / SUB), c1 = Math.floor(x1 / SUB), r0 = Math.floor(y0 / SUB), r1 = Math.floor(y1 / SUB);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (this.collCell(c, r)) return true;
    if (panes) for (const g of panes) if (!g.broken && x1 > g.x && x0 < g.x + g.w && y1 > g.y && y0 < g.y + g.h) return g;
    return false;
  }

  // Move an upright body (x = centre, y = feet). Returns { wall, pane, landed, ceiling }.
  moveBody(e, dt, panes) {
    const out = { wall: 0, pane: null, landed: false, ceiling: false, stepped: false };
    const hw = e.w / 2;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(e.vx), Math.abs(e.vy)) * dt / 12));
    const sdt = dt / steps;
    const wasGrounded = e.grounded;
    e.grounded = false;
    for (let s = 0; s < steps; s++) {
      // ---- horizontal
      const dx = e.vx * sdt;
      if (dx) {
        const nx = e.x + dx;
        const hit = this.boxHit(nx - hw, e.y - e.h + 1, nx + hw, e.y - 1, panes);
        if (!hit) e.x = nx;
        else {
          let ok = false;
          // step up small ledges and stairs
          if (wasGrounded || e.grounded) {
            for (const up of [10, SUB + 1]) {
              if (!this.boxHit(nx - hw, e.y - e.h + 1 - up, nx + hw, e.y - 1 - up, panes)) { e.x = nx; e.y -= up; ok = true; out.stepped = true; break; }
            }
          }
          if (!ok) {
            if (hit !== true) out.pane = hit;
            // creep to contact
            const dir = Math.sign(dx);
            for (let i = 0; i < Math.ceil(Math.abs(dx)); i++) {
              const tx = e.x + dir;
              if (this.boxHit(tx - hw, e.y - e.h + 1, tx + hw, e.y - 1, panes)) break;
              e.x = tx;
            }
            out.wall = dir; e.vx = 0;
          }
        }
      }
      // ---- vertical
      const dy = e.vy * sdt;
      if (dy > 0) {
        const ny = e.y + dy;
        let land = null;
        if (this.boxHit(e.x - hw, ny - 1, e.x + hw, ny, panes)) land = Math.floor(ny / SUB) * SUB;
        for (const p of this.platforms) {
          if (e.dropPlat === p || e.x + hw <= p.x1 || e.x - hw >= p.x2) continue;
          if (e.y <= p.y + 0.5 && ny >= p.y && (land === null || p.y < land)) land = p.y;
        }
        if (land !== null && land >= e.y - 0.5) { e.y = land; e.vy = 0; e.grounded = true; e.plat = this.platforms.find(p => p.y === land && e.x + hw > p.x1 && e.x - hw < p.x2) || null; out.landed = !wasGrounded; }
        else if (land !== null) { e.vy = 0; }
        else e.y = ny;
      } else if (dy < 0) {
        const ny = e.y + dy;
        if (this.boxHit(e.x - hw, ny - e.h, e.x + hw, ny - e.h + 1, panes)) {
          e.y = (Math.floor((ny - e.h) / SUB) + 1) * SUB + e.h + 0.01; e.vy = 0; out.ceiling = true;
        } else e.y = ny;
      }
    }
    // stick to the ground on the way down stairs, and refresh the grounded flag
    if (!e.grounded && e.vy >= 0) {
      const probe = wasGrounded ? SUB + 2 : 1;
      for (let d = 1; d <= probe; d++) {
        if (this.boxHit(e.x - hw, e.y + d - 1, e.x + hw, e.y + d, panes)) { e.y = Math.floor((e.y + d) / SUB) * SUB; e.grounded = true; e.vy = 0; break; }
        const p = this.platforms.find(p => e.dropPlat !== p && e.x + hw > p.x1 && e.x - hw < p.x2 && Math.abs(p.y - (e.y + d)) < 1);
        if (p) { e.y = p.y; e.grounded = true; e.plat = p; e.vy = 0; break; }
      }
    }
    if (!e.grounded) e.plat = null;
    return out;
  }

  // standing room above a box (can the body stand up from a slide?)
  canStand(e, h, panes) {
    return !this.boxHit(e.x - e.w / 2 + 1, e.y - h, e.x + e.w / 2 - 1, e.y - 2, panes);
  }
  groundAhead(x, y) {
    if (this.boxHit(x - 2, y + 1, x + 2, y + SUB + 4)) return true;
    return this.platforms.some(p => x > p.x1 + 4 && x < p.x2 - 4 && Math.abs(p.y - y) < 3);
  }

  // point vs world for ragdoll points and debris; p: {x,y,px,py}; returns true on contact
  collidePoint(p, r, fric = 0.6, panes) {
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      const c0 = Math.floor((p.x - r) / SUB), c1 = Math.floor((p.x + r) / SUB);
      const r0 = Math.floor((p.y - r) / SUB), r1 = Math.floor((p.y + r) / SUB);
      let best = null;
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        if (!this.collCell(cx, cy)) continue;
        const ox1 = (cx + 1) * SUB - (p.x - r), ox2 = (p.x + r) - cx * SUB;
        const oy1 = (cy + 1) * SUB - (p.y - r), oy2 = (p.y + r) - cy * SUB;
        const m = Math.min(ox1, ox2, oy1, oy2);
        if (!best || m < best.m) best = { m, ox1, ox2, oy1, oy2 };
      }
      if (panes) for (const g of panes) {
        if (g.broken || p.x + r < g.x || p.x - r > g.x + g.w || p.y + r < g.y || p.y - r > g.y + g.h) continue;
        const ox1 = g.x + g.w - (p.x - r), ox2 = (p.x + r) - g.x;
        const m = Math.min(ox1, ox2);
        if (!best || m < best.m) best = { m, ox1, ox2, oy1: 1e9, oy2: 1e9 };
      }
      if (!best) break;
      hit = true;
      const { m, ox1, ox2, oy1, oy2 } = best;
      const vx = p.x - p.px, vy = p.y - p.py;
      if (m === oy2) { p.y -= oy2; p.py = p.y + vy * 0.3; p.px = p.x - vx * fric; }
      else if (m === oy1) { p.y += oy1; p.py = p.y; }
      else if (m === ox1) { p.x += ox1; p.px = p.x + vx * 0.3; }
      else { p.x -= ox2; p.px = p.x + vx * 0.3; }
    }
    // one-way platforms catch falling points
    for (const pl of this.platforms) {
      if (p.x < pl.x1 || p.x > pl.x2) continue;
      if (p.py + r <= pl.y + 1 && p.y + r > pl.y) {
        const vx = p.x - p.px, vy = p.y - p.py;
        p.y = pl.y - r; p.py = p.y + vy * 0.3; p.px = p.x - vx * fric; hit = true;
      }
    }
    return hit;
  }

  // first solid point along a segment (bullets). Returns { x, y, nx, ny, pane } or null
  ray(x0, y0, x1, y1, panes, step = 4) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(len / step));
    let lx = x0, ly = y0;
    for (let i = 1; i <= n; i++) {
      const x = x0 + dx * i / n, y = y0 + dy * i / n;
      const s = this.solidAt(x, y, panes);
      if (s) {
        // which face did we cross?
        let nx = 0, ny = 0;
        if (s !== true) nx = -Math.sign(dx) || 1;
        else {
          const pcx = Math.floor(lx / SUB), pcy = Math.floor(ly / SUB), cx = Math.floor(x / SUB), cy = Math.floor(y / SUB);
          if (pcx !== cx && !this.collCell(cx, pcy)) nx = -Math.sign(dx);
          else if (pcy !== cy) ny = -Math.sign(dy);
          else nx = -Math.sign(dx);
        }
        return { x: lx, y: ly, nx, ny, pane: s === true ? null : s };
      }
      lx = x; ly = y;
    }
    return null;
  }
  // line of sight (glass is see-through)
  los(x0, y0, x1, y1) {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(len / 10);
    for (let i = 1; i < n; i++) if (this.collCell(Math.floor(lerp(x0, x1, i / n) / SUB), Math.floor(lerp(y0, y1, i / n) / SUB))) return false;
    return true;
  }

  /* -------------------------------------------------------- render prep */
  buildFaces() {
    const sc = this.sc, sr = this.sr;
    const solid = (x, y) => (x < 0 || y < 0 || x >= sc || y >= sr ? 1 : this.rend[y * sc + x]);
    const slopeCell = (x, y) => x >= 0 && y >= 0 && x < sc && y < sr && this.slopeTile[(y >> 1) * this.cols + (x >> 1)];
    const air = (x, y) => x >= 0 && y >= 0 && x < sc && y < sr && !this.rend[y * sc + x] && this.inside[y * sc + x] && !slopeCell(x, y);
    const H = new Map(), Vt = new Map();
    const addH = (key, x) => { if (!H.has(key)) H.set(key, []); H.get(key).push(x); };
    const addV = (key, y) => { if (!Vt.has(key)) Vt.set(key, []); Vt.get(key).push(y); };
    for (let y = 0; y < sr; y++) for (let x = 0; x < sc; x++) {
      if (!solid(x, y)) continue;
      if (air(x, y - 1)) addH('top|' + y, x);
      if (air(x, y + 1)) addH('bottom|' + (y + 1), x);
      if (air(x - 1, y)) addV('left|' + x, y);
      if (air(x + 1, y)) addV('right|' + (x + 1), y);
    }
    const faces = [];
    const runs = list => { list.sort((a, b) => a - b); const out = []; let s = list[0], p = list[0]; for (let i = 1; i <= list.length; i++) { if (list[i] === p + 1) { p = list[i]; continue; } out.push([s, p + 1]); s = p = list[i]; } return out; };
    for (const [key, xs] of H) { const [type, y] = key.split('|'); for (const [a, b] of runs(xs)) faces.push({ type, x1: a * SUB, y1: +y * SUB, x2: b * SUB, y2: +y * SUB }); }
    for (const [key, ys] of Vt) { const [type, x] = key.split('|'); for (const [a, b] of runs(ys)) faces.push({ type, x1: +x * SUB, y1: a * SUB, x2: +x * SUB, y2: b * SUB }); }
    // ledges are thin full-depth slabs
    for (const p of this.platforms) {
      if (p.kind !== 'ledge') continue;
      faces.push({ type: 'top', x1: p.x1, y1: p.y, x2: p.x2, y2: p.y });
      faces.push({ type: 'bottom', x1: p.x1, y1: p.y + p.th, x2: p.x2, y2: p.y + p.th });
      faces.push({ type: 'left', x1: p.x1, y1: p.y, x2: p.x1, y2: p.y + p.th });
      faces.push({ type: 'right', x1: p.x2, y1: p.y, x2: p.x2, y2: p.y + p.th });
    }
    this.faces = faces;
    // greedy rectangles for the front faces
    const used = new Uint8Array(sc * sr), rects = [];
    for (let y = 0; y < sr; y++) for (let x = 0; x < sc; x++) {
      if (!this.rend[y * sc + x] || used[y * sc + x]) continue;
      let w = 1; while (x + w < sc && this.rend[y * sc + x + w] && !used[y * sc + x + w]) w++;
      let h = 1;
      outer: while (y + h < sr) { for (let i = 0; i < w; i++) if (!this.rend[(y + h) * sc + x + i] || used[(y + h) * sc + x + i]) break outer; h++; }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) used[(y + j) * sc + x + i] = 1;
      rects.push({ x: x * SUB, y: y * SUB, w: w * SUB, h: h * SUB });
    }
    this.frontRects = rects;
    // back wall: interior runs per tile row
    const back = [];
    for (let ty = 0; ty < this.rows; ty++) {
      let start = -1;
      for (let tx = 0; tx <= this.cols; tx++) {
        const ins = tx < this.cols && this.inside[(ty * 2) * sc + tx * 2];
        if (ins && start < 0) start = tx;
        if (!ins && start >= 0) { back.push({ x: start * TILE, y: ty * TILE, w: (tx - start) * TILE, h: TILE }); start = -1; }
      }
    }
    this.backRects = back;
    let minY = 1e9, maxY = -1e9;
    for (const b of back) { minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y + b.h); }
    this.backTop = minY; this.backBot = maxY;
  }

  /* -------------------------------------------------------------- render */
  // pass 1: back wall, wall decor, side faces, props. Call before gameplay objects.
  drawBack(ctx, t, doorOpen, panes) {
    const th = this.theme, V = View.V, S = DEPTH_S;
    const P = (x, y, z) => [View.px(x, z), View.py(y, z)];
    // back wall with light falling off from the ceiling
    const gy0 = View.py(this.backTop, 1), gy1 = View.py(this.backBot, 1);
    const grd = ctx.createLinearGradient(0, gy0, 0, gy1);
    grd.addColorStop(0, shade(th.back, th.dark ? -0.25 : -0.09));
    grd.addColorStop(0.28, th.back);
    grd.addColorStop(1, shade(th.back, th.dark ? 0.04 : 0.35));
    ctx.fillStyle = grd;
    ctx.beginPath();
    for (const b of this.backRects) {
      const [x, y] = P(b.x - 1, b.y - 1, 1);
      ctx.rect(x, y, (b.w + 2) * S, (b.h + 2) * S);
    }
    ctx.fill();

    // decals on the back wall (bullet holes, scorch)
    for (const d of this.decals) {
      const [x, y] = P(d.x, d.y, 1);
      if (d.kind === 'scorch') { ctx.globalAlpha = 0.5; ctx.drawImage(Glow.get('#2a2a30'), x - d.r * S, y - d.r * S, d.r * 2 * S, d.r * 2 * S); ctx.globalAlpha = 1; continue; }
      ctx.fillStyle = th.dark ? 'rgba(0,0,0,0.5)' : 'rgba(60,60,70,0.55)';
      ctx.beginPath(); ctx.arc(x, y, 2.6 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = th.dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(x + 1, y + 1.4, 2.2 * S, 0, Math.PI); ctx.fill();
    }

    // light panels
    for (const L of this.lights) {
      const [x, y] = P(L.x - L.w / 2, L.y, 0.98), k = View.k(0.98);
      Glow.draw(ctx, th.light, x + L.w * k / 2, y + 8 * k, 90 * k, th.dark ? 0.55 : 0.35);
      ctx.fillStyle = shade(th.under, -0.05);
      ctx.fillRect(x - 3 * k, y - 2 * k, (L.w + 6) * k, 17 * k);
      ctx.fillStyle = th.light;
      ctx.fillRect(x, y, L.w * k, 12 * k);
      if (th.dark) {
        // light cone down onto the floor
        const cx = x + L.w * k / 2;
        const cg = ctx.createLinearGradient(0, y, 0, y + 260 * k);
        cg.addColorStop(0, 'rgba(220,235,255,0.13)'); cg.addColorStop(1, 'rgba(220,235,255,0)');
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.moveTo(cx - 34 * k, y + 12 * k); ctx.lineTo(cx + 34 * k, y + 12 * k); ctx.lineTo(cx + 120 * k, y + 260 * k); ctx.lineTo(cx - 120 * k, y + 260 * k); ctx.fill();
      }
    }

    // painted tutorial text
    if (this.texts.length) {
      const k = View.k(0.985);
      ctx.fillStyle = th.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '500 ' + (21 * k).toFixed(1) + 'px Rubik, sans-serif';
      const touch = document.body.classList.contains('touch');
      for (const T of this.texts) {
        const str = (TUTORIAL_TEXT[T.k] || [T.k])[touch ? 1 : 0] || T.k;
        const lines = str.split('\n');
        const [x, y] = P(T.x, T.y, 0.985);
        lines.forEach((ln, i) => ctx.fillText(ln, x, y + (i - (lines.length - 1) / 2) * 24 * k));
      }
    }

    // doors
    if (this.entry) this.drawDoor(ctx, this.entry, null, t);
    if (this.door) this.drawDoor(ctx, this.door, doorOpen, t);

    // side faces, farthest first
    const vis = [];
    for (const f of this.faces) {
      let ok = false;
      if (f.type === 'top') ok = V.y < f.y1 - 0.5;
      else if (f.type === 'bottom') ok = V.y > f.y1 + 0.5;
      else if (f.type === 'left') ok = V.x < f.x1 - 0.5;
      else ok = V.x > f.x1 + 0.5;
      if (ok) { f.d = Math.hypot((f.x1 + f.x2) / 2 - V.x, (f.y1 + f.y2) / 2 - V.y); vis.push(f); }
    }
    vis.sort((a, b) => b.d - a.d);
    const col = { top: th.top, bottom: th.under, left: th.side, right: shade(th.side, th.dark ? 0.05 : -0.04) };
    for (const f of vis) {
      const a = P(f.x1, f.y1, 1), b = P(f.x2, f.y2, 1);
      ctx.fillStyle = col[f.type];
      ctx.strokeStyle = col[f.type];
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.lineTo(b[0], b[1]); ctx.lineTo(a[0], a[1]); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (f.type === 'top' && !th.dark) {
        // soft contact shadow where the floor meets the back wall
        ctx.fillStyle = 'rgba(0,0,0,0.045)';
        const m1 = P(f.x1, f.y1, 0.8), m2 = P(f.x2, f.y2, 0.8);
        ctx.beginPath(); ctx.moveTo(m1[0], m1[1]); ctx.lineTo(m2[0], m2[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(a[0], a[1]); ctx.fill();
      }
    }
    // ceiling slopes
    for (const s of this.slopes) {
      const e = s.kind === 'a' ? [s.x, s.y + TILE, s.x + TILE, s.y] : [s.x, s.y, s.x + TILE, s.y + TILE];
      const mx = (e[0] + e[2]) / 2, my = (e[1] + e[3]) / 2;
      const nx = s.kind === 'a' ? 1 : -1, ny = 1;
      if ((V.x - mx) * nx + (V.y - my) * ny <= 0) continue;
      const a = P(e[0], e[1], 1), b = P(e[2], e[3], 1);
      ctx.fillStyle = mixHex(th.under, th.side, 0.5); ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath(); ctx.moveTo(e[0], e[1]); ctx.lineTo(e[2], e[3]); ctx.lineTo(b[0], b[1]); ctx.lineTo(a[0], a[1]); ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    // props
    for (const p of this.props) this.drawProp(ctx, p);
    // glass panes span the full depth
    for (const g of panes || []) if (!g.broken) drawGlass(ctx, g, th);
  }

  drawDoor(ctx, d, open, t) {
    const th = this.theme, z = 0.95, k = View.k(z);
    const x = View.px(d.x - 23, z), y = View.py(d.y - 104, z);
    ctx.fillStyle = shade(th.back, th.dark ? 0.08 : -0.1);
    ctx.fillRect(x - 4 * k, y - 4 * k, 54 * k, 108 * k);
    ctx.fillStyle = th.door;
    ctx.fillRect(x, y, 46 * k, 104 * k);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, y, 46 * k, 6 * k);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x + 36 * k, y + 52 * k, 5 * k, 3 * k);
    if (open === null || open === undefined) return;
    // status lamp above the exit
    const lc = open ? '#3ee08b' : '#ff4f5e';
    const lx = x + 23 * k, ly = y - 13 * k;
    Glow.draw(ctx, lc, lx, ly, 22 * k, 0.6 + (open ? 0.25 * Math.sin(t * 6) : 0));
    ctx.fillStyle = lc;
    ctx.fillRect(lx - 8 * k, ly - 3 * k, 16 * k, 6 * k);
    if (open) {
      // chevron hint
      ctx.fillStyle = rgba('#3ee08b', 0.55 + 0.35 * Math.sin(t * 5));
      const cy = y + 50 * k;
      ctx.beginPath(); ctx.moveTo(x + 17 * k, cy - 10 * k); ctx.lineTo(x + 29 * k, cy); ctx.lineTo(x + 17 * k, cy + 10 * k); ctx.lineTo(x + 17 * k, cy + 4 * k); ctx.lineTo(x + 22 * k, cy); ctx.lineTo(x + 17 * k, cy - 4 * k); ctx.fill();
    }
  }

  drawProp(ctx, p) {
    const th = this.theme;
    const legC = shade(th.side, -0.05), topC = shade(th.top, th.dark ? 0.05 : 0.03), frontC = shade(th.front, th.dark ? 0.02 : -0.02);
    if (p.type === 'table' || p.type === 'bench') {
      const z0 = p.type === 'table' ? 0.12 : 0.2, z1 = p.type === 'table' ? 0.75 : 0.6;
      const ty = p.y - p.h, thk = p.type === 'table' ? 6 : 6;
      // legs
      for (const lx of [p.x + 4, p.x + p.w - 10]) for (const z of [z1 - 0.04, z0 + 0.02]) prism(ctx, [[lx, ty + thk], [lx + 6, ty + thk], [lx + 6, p.y], [lx, p.y]], z - 0.025, z + 0.025, legC, shade(legC, -0.06), shade(legC, 0.05));
      prism(ctx, [[p.x, ty], [p.x + p.w, ty], [p.x + p.w, ty + thk], [p.x, ty + thk]], z0, z1, frontC, topC, th.side);
      if (p.type === 'table') {
        // a laptop or a mug for life
        const ix = p.x + p.w * 0.62;
        prism(ctx, [[ix, ty - 4], [ix + 22, ty - 4], [ix + 22, ty], [ix, ty]], 0.3, 0.5, shade(th.side, -0.1), shade(th.side, 0.1), shade(th.side, -0.2));
        prism(ctx, [[ix + 2, ty - 18], [ix + 4, ty - 18], [ix + 4, ty - 4], [ix + 2, ty - 4]], 0.48, 0.52, shade(th.side, -0.25), shade(th.side, -0.15), shade(th.side, -0.3));
      }
    } else if (p.type === 'shelf') {
      const z0 = 0.7, z1 = 0.96, top = p.y - p.h;
      for (const lx of [p.x, p.x + p.w - 4]) prism(ctx, [[lx, top], [lx + 4, top], [lx + 4, p.y], [lx, p.y]], z0, z1, legC, legC, shade(legC, -0.05));
      for (let i = 0; i < 4; i++) {
        const sy = top + i * (p.h / 3.2);
        prism(ctx, [[p.x, sy], [p.x + p.w, sy], [p.x + p.w, sy + 4], [p.x, sy + 4]], z0, z1, frontC, topC, th.side);
        if (i < 3) {
          const bx = p.x + 8 + ((i * 23) % 30);
          prism(ctx, [[bx, sy + p.h / 3.2 - 14], [bx + 16, sy + p.h / 3.2 - 14], [bx + 16, sy + p.h / 3.2], [bx, sy + p.h / 3.2]], z0 + 0.04, z1 - 0.04, shade(th.front, -0.04), topC, th.side);
        }
      }
    }
  }

  // pass 2: front faces of the cut, drawn over props
  drawFront(ctx) {
    const th = this.theme;
    ctx.fillStyle = th.front;
    ctx.beginPath();
    for (const r of this.frontRects) ctx.rect(r.x - 0.3, r.y - 0.3, r.w + 0.6, r.h + 0.6);
    for (const s of this.slopes) {
      if (s.kind === 'a') { ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + TILE, s.y); ctx.lineTo(s.x, s.y + TILE); ctx.closePath(); }
      else { ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + TILE, s.y); ctx.lineTo(s.x + TILE, s.y + TILE); ctx.closePath(); }
    }
    for (const p of this.platforms) if (p.kind === 'ledge') ctx.rect(p.x1, p.y, p.x2 - p.x1, p.th);
    ctx.fill();
    // crisp cut edges
    ctx.strokeStyle = th.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const f of this.faces) { ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); }
    for (const s of this.slopes) { if (s.kind === 'a') { ctx.moveTo(s.x, s.y + TILE); ctx.lineTo(s.x + TILE, s.y); } else { ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + TILE, s.y + TILE); } }
    ctx.stroke();
    // crate blocks
    for (const c of this.crateTiles) {
      ctx.strokeStyle = th.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x + 4, c.y + 4, TILE - 8, TILE - 8);
      ctx.beginPath(); ctx.moveTo(c.x + 4, c.y + TILE - 4); ctx.lineTo(c.x + TILE - 4, c.y + 4); ctx.stroke();
    }
  }
}

/* -------------------------------------------------------------- prisms */
// Draw a convex polygon (world coords on the gameplay x/y axes) extruded from z0 to z1.
// front: colour of the z0 face, cols for sides facing up/down/sideways.
function prism(ctx, poly, z0, z1, front, upC, sideC, downC) {
  const V = View.V, k0 = View.k(z0), k1 = View.k(z1);
  const n = poly.length;
  const f = poly.map(([x, y]) => [V.x + (x - V.x) * k0, V.y + (y - V.y) * k0]);
  const b = poly.map(([x, y]) => [V.x + (x - V.x) * k1, V.y + (y - V.y) * k1]);
  // winding to know outward normals
  let area = 0;
  for (let i = 0; i < n; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n]; area += x1 * y2 - x2 * y1; }
  const wnd = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = poly[j][0] - poly[i][0], ey = poly[j][1] - poly[i][1];
    const nx = ey * wnd, ny = -ex * wnd;          // outward normal (canvas y down)
    const mx = (f[i][0] + f[j][0]) / 2, my = (f[i][1] + f[j][1]) / 2;
    if ((V.x - mx) * nx + (V.y - my) * ny <= 0) continue;
    const len = Math.hypot(nx, ny) || 1;
    const up = -ny / len;
    ctx.fillStyle = up > 0.5 ? upC : up < -0.5 ? (downC || shade(sideC, -0.12)) : sideC;
    ctx.beginPath(); ctx.moveTo(f[i][0], f[i][1]); ctx.lineTo(f[j][0], f[j][1]); ctx.lineTo(b[j][0], b[j][1]); ctx.lineTo(b[i][0], b[i][1]); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = front;
  ctx.beginPath(); ctx.moveTo(f[0][0], f[0][1]); for (let i = 1; i < n; i++) ctx.lineTo(f[i][0], f[i][1]); ctx.closePath(); ctx.fill();
}

function drawGlass(ctx, g, th) {
  const V = View.V;
  const corners = [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]];
  const k1 = View.k(1);
  ctx.fillStyle = th.dark ? 'rgba(150,200,255,0.10)' : 'rgba(150,200,240,0.18)';
  const side = V.x > g.x + g.w ? g.x + g.w : g.x;
  ctx.beginPath();
  ctx.moveTo(side, g.y); ctx.lineTo(side, g.y + g.h);
  ctx.lineTo(V.x + (side - V.x) * k1, V.y + (g.y + g.h - V.y) * k1); ctx.lineTo(V.x + (side - V.x) * k1, V.y + (g.y - V.y) * k1);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = th.dark ? 'rgba(190,225,255,0.35)' : 'rgba(120,170,215,0.55)';
  ctx.lineWidth = 1.2; ctx.stroke();
  // diagonal sheen streaks
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
  const mx = lerp(side, V.x + (side - V.x) * k1, 0.35);
  ctx.beginPath(); ctx.moveTo(mx, g.y + 12); ctx.lineTo(mx + 8, g.y + 40); ctx.stroke();
  ctx.fillStyle = th.dark ? 'rgba(170,215,255,0.35)' : 'rgba(170,210,240,0.7)';
  ctx.fillRect(corners[0][0], g.y, g.w, g.h);
}
