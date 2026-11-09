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
    this.buildDecor(map);
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
          case 'q': this.props.push({ type: 'plant', x: x + 8, y: floorY, w: 24, h: 46 }); break;
          case 'w': this.props.push({ type: 'cooler', x: x + 10, y: floorY, w: 20, h: 58 }); break;
          case 'u': this.addProp('pallet', x + 3, floorY, 74, 30); break;
          case 'v': this.addProp('server', x + 4, floorY, 32, 82); break;
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

  /* --------------------------------------------------------------- decor */
  // Chapter-specific dressing on the back wall, laid out from a hash of the map so it never changes.
  buildDecor(map) {
    let h = 7;
    for (const row of map) for (let i = 0; i < row.length; i++) h = (h * 31 + row.charCodeAt(i)) >>> 0;
    const R = mulberry32(h);
    this.decor = [];
    const kind = this.theme.decor;
    // interior span per column (tile rows)
    const span = tx => {
      let top = -1, bot = -1;
      for (let ty = 0; ty < this.rows; ty++) {
        const solid = this.collCell(tx * 2, ty * 2) && this.collCell(tx * 2 + 1, ty * 2);
        if (!solid && top < 0 && this.inside[ty * 2 * this.sc + tx * 2]) top = ty;
        if (solid && top >= 0) { bot = ty; break; }
      }
      return top < 0 || bot < 0 ? null : { top, bot };
    };
    const blocked = new Set();
    const block = (tx, r) => { for (let k = -r; k <= r; k++) blocked.add(tx + k); };
    map.forEach(row => [...row].forEach((ch, tx) => { if (ch === 'P' || ch === 'D') block(tx, 2); if (ch === 'G') block(tx, 1); }));
    for (const T of this.texts) block(Math.round(T.x / TILE), 3);
    const place = (w, minRows) => {
      for (let tries = 0; tries < 30; tries++) {
        const tx = 2 + Math.floor(R() * (this.cols - 4 - w));
        let ok = true, top = 0, bot = 99;
        for (let k = 0; k < w; k++) {
          const sp = span(tx + k);
          if (!sp || blocked.has(tx + k) || sp.bot - sp.top < minRows) { ok = false; break; }
          top = Math.max(top, sp.top); bot = Math.min(bot, sp.bot);
        }
        if (!ok || bot - top < minRows) continue;
        for (let k = -1; k <= w; k++) blocked.add(tx + k);
        return { tx, top, bot };
      }
      return null;
    };
    const n = Math.max(1, Math.round(this.cols / 11));
    for (let i = 0; i < n; i++) {
      if (kind === 'office') {
        const pick = R();
        if (pick < 0.55) { const p = place(3, 4); if (p) this.decor.push({ k: 'blinds', x: p.tx * TILE + 6, y: (p.top + 0.9) * TILE, w: 3 * TILE - 12, h: 1.9 * TILE }); }
        else if (pick < 0.8) { const p = place(1, 4); if (p) this.decor.push({ k: 'poster', x: p.tx * TILE + 4, y: (p.top + 1.1) * TILE, w: 32, h: 44, c: ['#ff9a76', '#7ed9b8', '#a18df0', '#f2c45a'][Math.floor(R() * 4)] }); }
        else { const p = place(1, 4); if (p) this.decor.push({ k: 'clock', x: p.tx * TILE + 20, y: (p.top + 1) * TILE }); }
      } else if (kind === 'warehouse') {
        if (R() < 0.5) { const p = place(3, 4); if (p) this.decor.push({ k: 'shutter', x: p.tx * TILE + 4, y: (p.bot - Math.min(3, p.bot - p.top - 1)) * TILE, w: 3 * TILE - 8, h: Math.min(3, p.bot - p.top - 1) * TILE }); }
        else { const p = place(1, 3); if (p) this.decor.push({ k: 'stencil', x: p.tx * TILE + 20, y: (p.top + 1) * TILE, t: 'ABCDE'[Math.floor(R() * 5)] + (1 + Math.floor(R() * 9)) }); }
      } else if (kind === 'highrise') {
        const p = place(4, 4); if (p) this.decor.push({ k: 'skyline', x: p.tx * TILE + 4, y: (p.top + 0.6) * TILE, w: 4 * TILE - 8, h: Math.min(2.6, p.bot - p.top - 1.4) * TILE, seed: R() * 1000 });
      } else if (kind === 'night') {
        if (R() < 0.6) { const p = place(2, 4); if (p) this.decor.push({ k: 'neon', x: p.tx * TILE + 6, y: (p.top + 0.9) * TILE, w: 2 * TILE - 12, h: 34, c: ['#ff4fd8', '#4ff0ff', '#ffd34d', '#7dff8a'][Math.floor(R() * 4)], shape: Math.floor(R() * 3) }); }
        else { const p = place(1, 4); if (p) this.decor.push({ k: 'leds', x: p.tx * TILE + 6, y: (p.top + 1) * TILE, w: 28, h: 50 }); }
      } else {
        if (R() < 0.6) { const p = place(1, 4); if (p) this.decor.push({ k: 'vent', x: p.tx * TILE + 6, y: (p.top + 0.9) * TILE, w: 28, h: 18 }); }
      }
    }
    // floor and ceiling runs for the bands (merged per height)
    const runs = (test, yOf) => {
      const out = [];
      for (let ty = 0; ty < this.rows; ty++) {
        let start = -1;
        for (let tx = 0; tx <= this.cols; tx++) {
          const on = tx < this.cols && test(tx, ty);
          if (on && start < 0) start = tx;
          if (!on && start >= 0) { out.push({ x1: start * TILE, x2: tx * TILE, y: yOf(ty) }); start = -1; }
        }
      }
      return out;
    };
    const airT = (tx, ty) => !this.collCell(tx * 2, ty * 2) && !this.collCell(tx * 2 + 1, ty * 2 + 1) && this.inside[ty * 2 * this.sc + tx * 2];
    const solidT = (tx, ty) => this.collCell(tx * 2, ty * 2) && this.collCell(tx * 2 + 1, ty * 2) && this.collCell(tx * 2, ty * 2 + 1) && this.collCell(tx * 2 + 1, ty * 2 + 1);
    this.floorRuns = runs((tx, ty) => airT(tx, ty) && solidT(tx, ty + 1), ty => (ty + 1) * TILE);
    this.ceilRuns = runs((tx, ty) => airT(tx, ty) && solidT(tx, ty - 1), ty => ty * TILE);
    // full-width bands
    if (kind === 'warehouse') this.decor.push({ k: 'hazard' });
    if (kind === 'warehouse' || kind === 'night') this.decor.push({ k: 'pipe' });
  }

  drawDecor(ctx, t) {
    const th = this.theme, z = 0.99, k = View.k(z);
    const P = (x, y) => [View.px(x, z), View.py(y, z)];
    for (const d of this.decor) {
      if (d.k === 'hazard' || d.k === 'pipe') {
        // runs along the back wall just above every floor / just under every ceiling
        for (const r of (d.k === 'hazard' ? this.floorRuns : this.ceilRuns)) {
          if (d.k === 'hazard') {
            const [x, y] = P(r.x1, r.y - 12), w = (r.x2 - r.x1) * k;
            ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, 10 * k); ctx.clip();
            ctx.fillStyle = '#ffd34d'; ctx.fillRect(x, y, w, 10 * k);
            ctx.fillStyle = '#2a2c33';
            for (let sx = x - 20; sx < x + w; sx += 16 * k) { ctx.beginPath(); ctx.moveTo(sx, y + 10 * k); ctx.lineTo(sx + 8 * k, y + 10 * k); ctx.lineTo(sx + 18 * k, y); ctx.lineTo(sx + 10 * k, y); ctx.fill(); }
            ctx.restore();
          } else {
            const [x, y] = P(r.x1, r.y + 8), w = (r.x2 - r.x1) * k;
            ctx.fillStyle = th.dark ? '#3a4152' : '#a9afb8'; ctx.fillRect(x, y, w, 7 * k);
            ctx.fillStyle = th.dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.5)'; ctx.fillRect(x, y + 1 * k, w, 1.5 * k);
          }
        }
        continue;
      }
      const [x, y] = P(d.x, d.y);
      const w = (d.w || 0) * k, h = (d.h || 0) * k;
      switch (d.k) {
        case 'vent':
          ctx.fillStyle = shade(th.back, -0.12); ctx.fillRect(x, y, w, h);
          ctx.fillStyle = shade(th.back, -0.28);
          for (let i = 0; i < 4; i++) ctx.fillRect(x + 3 * k, y + (3 + i * 4) * k, w - 6 * k, 1.6 * k);
          break;
        case 'blinds': {
          ctx.fillStyle = shade(th.back, -0.14); ctx.fillRect(x - 3 * k, y - 3 * k, w + 6 * k, h + 6 * k);
          const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#cfe6ff'); g.addColorStop(1, '#fff3dc');
          ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
          ctx.fillStyle = 'rgba(160,140,115,0.55)';
          for (let by = 0; by < h; by += 6 * k) ctx.fillRect(x, y + by, w, 3.2 * k);
          ctx.fillStyle = shade(th.back, -0.2); ctx.fillRect(x + w / 2 - 1 * k, y, 2 * k, h);
          break;
        }
        case 'poster':
          ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 2 * k, y - 2 * k, w + 4 * k, h + 4 * k);
          ctx.fillStyle = d.c; ctx.fillRect(x, y, w, h);
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath(); ctx.arc(x + w * 0.6, y + h * 0.38, w * 0.22, 0, TAU); ctx.fill();
          ctx.fillRect(x + w * 0.15, y + h * 0.72, w * 0.7, 3 * k); ctx.fillRect(x + w * 0.15, y + h * 0.82, w * 0.45, 3 * k);
          break;
        case 'clock': {
          ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#4a4f60'; ctx.lineWidth = 2.5 * k;
          ctx.beginPath(); ctx.arc(x, y, 13 * k, 0, TAU); ctx.fill(); ctx.stroke();
          const a1 = t * 0.6, a2 = t * 0.05;
          ctx.lineWidth = 1.6 * k; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(a1) * 10 * k, y - Math.cos(a1) * 10 * k); ctx.stroke();
          ctx.lineWidth = 2.4 * k; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(a2) * 6 * k, y - Math.cos(a2) * 6 * k); ctx.stroke();
          break;
        }
        case 'shutter':
          ctx.fillStyle = shade(th.back, -0.2); ctx.fillRect(x - 4 * k, y - 6 * k, w + 8 * k, h + 6 * k);
          ctx.fillStyle = shade(th.side, 0.12); ctx.fillRect(x, y, w, h);
          ctx.fillStyle = 'rgba(0,0,0,0.12)';
          for (let sy = 0; sy < h; sy += 7 * k) ctx.fillRect(x, y + sy, w, 2 * k);
          ctx.fillStyle = '#ffd34d'; ctx.fillRect(x, y + h - 6 * k, w, 6 * k);
          break;
        case 'stencil':
          ctx.fillStyle = shade(th.back, -0.2); ctx.font = '900 ' + (30 * k).toFixed(1) + 'px Rubik, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(d.t, x, y);
          break;
        case 'skyline': {
          // a tall window onto the city
          const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#8ec5ff'); g.addColorStop(1, '#e8f4ff');
          ctx.fillStyle = shade(th.back, -0.12); ctx.fillRect(x - 4 * k, y - 4 * k, w + 8 * k, h + 8 * k);
          ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
          const R = mulberry32(d.seed | 0);
          ctx.fillStyle = 'rgba(120,150,190,0.55)';
          for (let bx = 0; bx < w; bx += 12 * k) { const bh = (0.25 + R() * 0.55) * h; ctx.fillRect(x + bx, y + h - bh, 10 * k, bh); }
          ctx.fillStyle = 'rgba(90,120,165,0.6)';
          for (let bx = 6 * k; bx < w; bx += 17 * k) { const bh = (0.15 + R() * 0.35) * h; ctx.fillRect(x + bx, y + h - bh, 9 * k, bh); }
          ctx.fillStyle = shade(th.back, -0.08);
          for (let mx = 1; mx < 4; mx++) ctx.fillRect(x + w * mx / 4 - 1.5 * k, y, 3 * k, h);
          ctx.fillRect(x, y + h * 0.45, w, 2.5 * k);
          break;
        }
        case 'neon': {
          const flick = Math.sin(t * 23 + d.x) > 0.96 ? 0.3 : 1;
          Glow.draw(ctx, d.c, x + w / 2, y + h / 2, w * 0.8, 0.35 * flick);
          ctx.strokeStyle = d.c; ctx.lineWidth = 3 * k; ctx.lineJoin = 'round'; ctx.globalAlpha = flick;
          ctx.beginPath();
          if (d.shape === 0) ctx.roundRect(x, y, w, h, 8 * k);
          else if (d.shape === 1) { ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w * 0.6, y + h / 2); ctx.moveTo(x + w * 0.45, y + 4 * k); ctx.lineTo(x + w * 0.75, y + h / 2); ctx.lineTo(x + w * 0.45, y + h - 4 * k); }
          else { for (let i = 0; i <= 5; i++) { const px = x + w * i / 5, py = y + (i % 2 ? h - 4 * k : 4 * k); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } }
          ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1 * k; ctx.stroke(); ctx.globalAlpha = 1;
          break;
        }
        case 'leds':
          ctx.fillStyle = '#151820'; ctx.fillRect(x, y, w, h);
          for (let i = 0; i < 12; i++) {
            const on = Math.sin(t * (3 + i) + i * 7) > 0;
            ctx.fillStyle = on ? (i % 3 ? '#4ff0ff' : '#7dff8a') : '#2a3040';
            ctx.fillRect(x + (4 + (i % 3) * 8) * k, y + (5 + Math.floor(i / 3) * 11) * k, 4 * k, 3 * k);
          }
          break;
        default: break;
      }
    }
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

    this.drawDecor(ctx, t);

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

  // door: null = entry door, otherwise { open, anim (0..1 swing), left (enemies still up) }
  drawDoor(ctx, d, st, t) {
    const th = this.theme, z = 0.95, k = View.k(z);
    const x = View.px(d.x - 23, z), y = View.py(d.y - 104, z);
    const W = 46 * k, H = 104 * k;
    ctx.fillStyle = shade(th.back, th.dark ? 0.08 : -0.1);
    ctx.fillRect(x - 4 * k, y - 4 * k, W + 8 * k, H + 4 * k);
    const anim = st ? st.anim || 0 : 0;
    if (anim > 0.01) {
      // the doorway behind: bright light spilling out onto the floor
      const lg = ctx.createLinearGradient(0, y, 0, y + H);
      lg.addColorStop(0, '#fffdf4'); lg.addColorStop(1, '#e8f6ff');
      ctx.fillStyle = lg; ctx.fillRect(x, y, W, H);
      Glow.draw(ctx, '#fff6d8', x + W / 2, y + H * 0.6, 90 * k * anim, 0.55 * anim);
      ctx.fillStyle = `rgba(255,250,225,${0.35 * anim})`;
      ctx.beginPath(); ctx.moveTo(x, y + H); ctx.lineTo(x + W, y + H); ctx.lineTo(x + W + 40 * k * anim, y + H + 26 * k); ctx.lineTo(x - 40 * k * anim, y + H + 26 * k); ctx.fill();
    }
    // the panel swings open on its hinge
    const pw = W * (1 - anim * 0.82);
    ctx.fillStyle = th.door;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + pw, y + anim * 6 * k); ctx.lineTo(x + pw, y + H - anim * 6 * k); ctx.lineTo(x, y + H); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, y, pw, 6 * k);
    if (anim < 0.5) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + pw - 10 * k, y + 52 * k, 5 * k, 3 * k); }
    if (!st) return;
    // status lamp above the exit
    const lc = st.open ? '#3ee08b' : '#ff4f5e';
    const lx = x + W / 2, ly = y - 13 * k;
    Glow.draw(ctx, lc, lx, ly, 26 * k, 0.6 + (st.open ? 0.25 * Math.sin(t * 6) : 0));
    ctx.fillStyle = lc;
    ctx.fillRect(lx - 10 * k, ly - 3.5 * k, 20 * k, 7 * k);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (st.open) {
      // big pulsing EXIT arrow so the way out is never missed
      const a = 0.6 + 0.4 * Math.sin(t * 5);
      ctx.fillStyle = rgba('#2fbf73', a);
      ctx.font = '900 ' + (13 * k).toFixed(1) + 'px Rubik, sans-serif';
      ctx.fillText('EXIT', lx, ly - 15 * k);
      if (anim < 0.3) {
        const cy = y + 50 * k, cx = x + 17 * k + Math.sin(t * 5) * 3 * k;
        ctx.fillStyle = rgba('#3ee08b', a);
        ctx.beginPath(); ctx.moveTo(cx, cy - 12 * k); ctx.lineTo(cx + 14 * k, cy); ctx.lineTo(cx, cy + 12 * k); ctx.lineTo(cx, cy + 5 * k); ctx.lineTo(cx + 6 * k, cy); ctx.lineTo(cx, cy - 5 * k); ctx.fill();
      }
    } else if (st.left > 0 && st.near) {
      ctx.fillStyle = '#e2434b';
      ctx.font = '900 ' + (12 * k).toFixed(1) + 'px Rubik, sans-serif';
      ctx.fillText(st.left + ' LEFT', lx, ly - 15 * k);
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
      if (p.type === 'table' && th.decor === 'office') {
        // office desk: monitor, keyboard and a mug
        const mx = p.x + p.w * 0.55;
        prism(ctx, [[mx, ty - 30], [mx + 34, ty - 30], [mx + 34, ty - 8], [mx, ty - 8]], 0.42, 0.48, '#2b2f3a', '#3b4050', '#1d2029');
        prism(ctx, [[mx + 2, ty - 28], [mx + 32, ty - 28], [mx + 32, ty - 10], [mx + 2, ty - 10]], 0.415, 0.42, '#7fb0e2', '#9fd0ff', '#5a8cc2');
        prism(ctx, [[mx + 15, ty - 8], [mx + 19, ty - 8], [mx + 19, ty], [mx + 15, ty]], 0.44, 0.47, '#2b2f3a', '#3b4050', '#1d2029');
        prism(ctx, [[p.x + 14, ty - 3], [p.x + 40, ty - 3], [p.x + 40, ty], [p.x + 14, ty]], 0.25, 0.36, '#d6dae0', '#eef0f3', '#b8bdc6');
        prism(ctx, [[p.x + 8, ty - 9], [p.x + 15, ty - 9], [p.x + 15, ty], [p.x + 8, ty]], 0.3, 0.38, '#ff9a76', '#ffb89c', '#de7553');
      } else if (p.type === 'table') {
        // a laptop or a mug for life
        const ix = p.x + p.w * 0.62;
        prism(ctx, [[ix, ty - 4], [ix + 22, ty - 4], [ix + 22, ty], [ix, ty]], 0.3, 0.5, shade(th.side, -0.1), shade(th.side, 0.1), shade(th.side, -0.2));
        prism(ctx, [[ix + 2, ty - 18], [ix + 4, ty - 18], [ix + 4, ty - 4], [ix + 2, ty - 4]], 0.48, 0.52, shade(th.side, -0.25), shade(th.side, -0.15), shade(th.side, -0.3));
      }
    } else if (p.type === 'plant') {
      const cx = p.x + p.w / 2;
      prism(ctx, [[p.x + 2, p.y - 18], [p.x + p.w - 2, p.y - 18], [p.x + p.w - 5, p.y], [p.x + 5, p.y]], 0.5, 0.8, '#c9a477', '#ddc08f', '#a8875c');
      for (const [dx, hh, ww] of [[-6, 34, 7], [5, 40, 7], [0, 46, 6], [-10, 26, 6], [10, 30, 6]]) {
        prism(ctx, [[cx + dx - ww / 2, p.y - 18 - hh], [cx + dx + ww / 2, p.y - 18 - hh * 0.9], [cx + dx * 0.3 + 1.5, p.y - 18], [cx + dx * 0.3 - 1.5, p.y - 18]], 0.6, 0.7, '#5fb37a', '#7ed9a0', '#3f8a59');
      }
    } else if (p.type === 'cooler') {
      prism(ctx, [[p.x, p.y - 36], [p.x + p.w, p.y - 36], [p.x + p.w, p.y], [p.x, p.y]], 0.62, 0.9, frontC, topC, th.side);
      prism(ctx, [[p.x + 2, p.y - 58], [p.x + p.w - 2, p.y - 58], [p.x + p.w - 2, p.y - 36], [p.x + 2, p.y - 36]], 0.66, 0.86, 'rgba(120,190,240,0.75)', 'rgba(170,215,250,0.8)', 'rgba(90,160,220,0.75)');
      prism(ctx, [[p.x + 4, p.y - 30], [p.x + 8, p.y - 30], [p.x + 8, p.y - 26], [p.x + 4, p.y - 26]], 0.6, 0.64, '#4da3ff', '#4da3ff', '#2f7fd0');
    } else if (p.type === 'pallet') {
      const wood = th.dark ? '#6d5a44' : '#c7a273', top = p.y - p.h;
      for (const lx of [p.x, p.x + p.w / 2 - 4, p.x + p.w - 8]) prism(ctx, [[lx, top + 5], [lx + 8, top + 5], [lx + 8, p.y], [lx, p.y]], 0.15, 0.75, shade(wood, -0.12), wood, shade(wood, -0.2));
      prism(ctx, [[p.x, top], [p.x + p.w, top], [p.x + p.w, top + 5], [p.x, top + 5]], 0.12, 0.78, wood, shade(wood, 0.12), shade(wood, -0.15));
      prism(ctx, [[p.x + 6, top - 18], [p.x + p.w * 0.55, top - 18], [p.x + p.w * 0.55, top], [p.x + 6, top]], 0.25, 0.6, th.dark ? '#5a6070' : '#d6dae0', th.dark ? '#6a7080' : '#e8eaee', th.dark ? '#454a58' : '#b8bdc6');
    } else if (p.type === 'server') {
      const top = p.y - p.h;
      prism(ctx, [[p.x, top], [p.x + p.w, top], [p.x + p.w, p.y], [p.x, p.y]], 0.55, 0.95, '#1d2029', '#2c303c', '#13151b');
      const t = performance.now() / 1000;
      for (let i = 0; i < 7; i++) {
        const yy = top + 6 + i * 11;
        prism(ctx, [[p.x + 3, yy], [p.x + p.w - 3, yy], [p.x + p.w - 3, yy + 8], [p.x + 3, yy + 8]], 0.54, 0.6, '#262a35', '#323746', '#1a1d25');
        for (let j = 0; j < 3; j++) {
          const on = Math.sin(t * (2 + j + i) + i * 3 + j) > 0.2;
          if (on) { const lx = View.px(p.x + 6 + j * 5, 0.54), ly = View.py(yy + 4, 0.54); ctx.fillStyle = j === 2 ? '#7dff8a' : '#4ff0ff'; ctx.fillRect(lx, ly - 1, 2.5, 2.5); }
        }
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
