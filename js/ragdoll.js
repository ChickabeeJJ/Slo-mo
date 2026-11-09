'use strict';
/* =========================================================================
   Bodies. A blocky figure of eleven points. While alive the points spring
   toward an animated pose (run, aim, jump, flip, slide), so hits make them
   flinch and wobble. On death the springs let go and it becomes a verlet
   ragdoll that drains to white, and shortly after it breaks into separate
   limb blocks (Pieces) that tumble and settle on the floor.
   ========================================================================= */

const J = { HEAD: 0, NECK: 1, PELVIS: 2, FELB: 3, FHAND: 4, BELB: 5, BHAND: 6, FKNEE: 7, FFOOT: 8, BKNEE: 9, BFOOT: 10 };
const LEN = { thigh: 22, shin: 22, upper: 16, fore: 16, torso: 34, neck: 13 };
// sticks: [a, b, length, thickness, depth, role]
const STICKS = [
  [J.NECK, J.PELVIS, LEN.torso, 22, 0.075, 'torso'],
  [J.NECK, J.HEAD, LEN.neck, 20, 0.07, 'head'],
  [J.NECK, J.BELB, LEN.upper, 9, 0.045, 'barm'], [J.BELB, J.BHAND, LEN.fore, 8, 0.045, 'barm'],
  [J.PELVIS, J.BKNEE, LEN.thigh, 11, 0.05, 'bleg'], [J.BKNEE, J.BFOOT, LEN.shin, 10, 0.05, 'bleg'],
  [J.PELVIS, J.FKNEE, LEN.thigh, 11, 0.05, 'fleg'], [J.FKNEE, J.FFOOT, LEN.shin, 10, 0.05, 'fleg'],
  [J.NECK, J.FELB, LEN.upper, 9, 0.045, 'farm'], [J.FELB, J.FHAND, LEN.fore, 8, 0.045, 'farm'],
];
const DRAW_ORDER = [2, 3, 4, 5, 0, 1, 6, 7, 8, 9];
const GRAV = 2300;

function ik(ax, ay, bx, by, l1, l2, bend) {
  let dx = bx - ax, dy = by - ay;
  let d = Math.hypot(dx, dy) || 0.001;
  const max = l1 + l2 - 0.01;
  if (d > max) { bx = ax + dx / d * max; by = ay + dy / d * max; dx = bx - ax; dy = by - ay; d = max; }
  d = Math.max(d, Math.abs(l1 - l2) + 0.01);
  const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const base = Math.atan2(dy, dx) + bend * a;
  return [ax + Math.cos(base) * l1, ay + Math.sin(base) * l1, bx, by];
}

class Body {
  constructor(o) {
    this.s = o.scale || 1;
    this.color = o.color; this.dark = o.dark || shade(o.color, -0.22);
    this.shine = !!o.shine; this.rainbow = !!o.rainbow;
    this.hat = o.hat || 'none';
    this.deadColor = o.deadColor || '#eeeef1';
    this.facing = o.facing || 1;
    this.pts = [];
    for (let i = 0; i < 11; i++) this.pts.push({ x: o.x, y: o.y, vx: 0, vy: 0, px: o.x, py: o.y });
    this.T = this.pts.map(() => ({ x: 0, y: 0 }));
    this.dead = false; this.deadT = 0; this.broken = false; this.whiteT = 0;
    this.headless = false;
    this.phase = 0; this.t = Math.random() * 10;
    this.flash = 0;
    this.gunLen = 0; this.gunAng = 0; this.gunId = null;
    this.lastRoot = { x: o.x, y: o.y };
    this.first = true;
  }

  /* ---------------------------------------------------------------- pose */
  // st: { x, y, facing, aim, vx, vy, grounded, slide, flip, speedMax, gun, twoHand, dual, kick, melee, sprint, dead }
  pose(st, dt) {
    const s = this.s, f = st.facing;
    this.facing = f;
    this.t += dt;
    const speed = Math.abs(st.vx);
    const mf = speed > 5 ? Math.sign(st.vx) * f : 1;
    if (st.grounded && !st.slide) this.phase += speed * dt / 15;
    const T = this.T;
    const set = (i, x, y) => { T[i].x = x; T[i].y = y; };
    let pel = [0, -44], neck;
    const run = st.grounded && !st.slide ? clamp(speed / 160, 0, 1) : 0;
    const sprint = st.sprint ? 1 : 0;
    let fFoot, bFoot;
    if (st.slide) {
      pel = [-4, -16];
      neck = [-17, -46];
      fFoot = [34, -3]; bFoot = [14, -3];
    } else if (!st.grounded) {
      pel = [0, -48];
      const fall = clamp(st.vy / 600, -1, 1);
      neck = [2, -82];
      fFoot = [9 - fall * 4, -14 + fall * 10]; bFoot = [-7, -10 + fall * 8];
      if (st.flip) { fFoot = [8, -24]; bFoot = [-2, -22]; pel = [0, -44]; neck = [4, -76]; }
    } else {
      const ph = this.phase;
      pel = [0, -44 - Math.abs(Math.cos(ph)) * 2.5 * run + (1 - run) * Math.sin(this.t * 2.2) * 0.6];
      const lean = mf * run * (4 + sprint * 7);
      neck = [pel[0] + lean, pel[1] - LEN.torso + Math.abs(lean) * 0.2];
      const stride = (12 + sprint * 9) * run;
      const lift = (7 + sprint * 6) * run;
      const legAt = p => [Math.sin(p) * stride * mf, -Math.max(0, Math.cos(p)) * lift];
      fFoot = run > 0.05 ? legAt(ph) : [7, 0];
      bFoot = run > 0.05 ? legAt(ph + Math.PI) : [-6, 0];
    }
    set(J.PELVIS, pel[0], pel[1]);
    set(J.NECK, neck[0], neck[1]);
    const tdx = neck[0] - pel[0], tdy = neck[1] - pel[1], tl = Math.hypot(tdx, tdy) || 1;
    set(J.HEAD, neck[0] + tdx / tl * LEN.neck, neck[1] + tdy / tl * LEN.neck);
    // legs (knees point forward)
    let k = ik(pel[0], pel[1], fFoot[0], fFoot[1], LEN.thigh, LEN.shin, -1);
    set(J.FKNEE, k[0], k[1]); set(J.FFOOT, k[2], k[3]);
    k = ik(pel[0], pel[1], bFoot[0], bFoot[1], LEN.thigh, LEN.shin, -1);
    set(J.BKNEE, k[0], k[1]); set(J.BFOOT, k[2], k[3]);
    // arms
    const sh = [neck[0], neck[1] + 4];
    if (st.gun) {
      const al = f > 0 ? st.aim : Math.PI - st.aim;
      const ca = Math.cos(al), sa = Math.sin(al);
      const kick = (st.kick || 0) * 7;
      const reach = st.twoHand ? 26 : 29;
      const fh = [sh[0] + ca * (reach - kick), sh[1] + sa * (reach - kick)];
      let bh;
      if (st.dual) bh = [sh[0] + Math.cos(al + 0.12) * (28 - (st.kick2 || 0) * 7), sh[1] + Math.sin(al + 0.12) * (28 - (st.kick2 || 0) * 7)];
      else if (st.twoHand) bh = [fh[0] + ca * 11 - sa * 2, fh[1] + sa * 11 + ca * 2];
      else bh = [fh[0] - ca * 2 - sa * 3, fh[1] - sa * 2 + ca * 3];
      if (st.reload > 0) { const r = Math.sin(st.reload * Math.PI); fh[1] += r * 10; bh[0] -= r * 6 * ca; bh[1] += r * 14; }
      k = ik(sh[0], sh[1], fh[0], fh[1], LEN.upper, LEN.fore, 1);
      set(J.FELB, k[0], k[1]); set(J.FHAND, k[2], k[3]);
      k = ik(sh[0], sh[1] + 1, bh[0], bh[1], LEN.upper, LEN.fore, 1);
      set(J.BELB, k[0], k[1]); set(J.BHAND, k[2], k[3]);
      this.gunAng = st.aim;
    } else {
      const ph = this.phase;
      const swing = run * 14;
      let fh = [sh[0] + Math.sin(ph + Math.PI) * swing * mf + 3, sh[1] + 27 - run * 4];
      let bh = [sh[0] + Math.sin(ph) * swing * mf - 2, sh[1] + 27 - run * 4];
      if (st.slide) { fh = [sh[0] + 10, sh[1] + 14]; bh = [sh[0] - 14, sh[1] + 20]; }
      if (!st.grounded && !st.slide) { fh = [sh[0] + 14, sh[1] - 12]; bh = [sh[0] - 12, sh[1] - 8]; }
      if (st.melee != null) {
        const m = st.melee;   // 0..1: wind up then slash
        if (m < 0.5) fh = [sh[0] - 10, sh[1] - 24];
        else fh = [sh[0] + 30, sh[1] + 6];
      }
      k = ik(sh[0], sh[1], fh[0], fh[1], LEN.upper, LEN.fore, 1);
      set(J.FELB, k[0], k[1]); set(J.FHAND, k[2], k[3]);
      k = ik(sh[0], sh[1], bh[0], bh[1], LEN.upper, LEN.fore, 1);
      set(J.BELB, k[0], k[1]); set(J.BHAND, k[2], k[3]);
    }
    // flips rotate the whole figure around the waist
    if (st.flip) {
      const c = Math.cos(st.flip), sn = Math.sin(st.flip), ox = 0, oy = -46;
      for (const p of T) { const x = p.x - ox, y = p.y - oy; p.x = ox + x * c - y * sn; p.y = oy + x * sn + y * c; }
    }
    // to world
    for (const p of T) { p.x = st.x + p.x * f * s; p.y = st.y + p.y * s; }
    if (st.gun && st.dual) this.gunAng2 = st.aim + 0.12 * f;

    // follow: carry the root's motion, then spring toward the pose
    const dxr = st.x - this.lastRoot.x, dyr = st.y - this.lastRoot.y;
    this.lastRoot.x = st.x; this.lastRoot.y = st.y;
    if (this.first) { this.first = false; for (let i = 0; i < 11; i++) { this.pts[i].x = T[i].x; this.pts[i].y = T[i].y; } return; }
    const K = st.slide || st.flip ? 1400 : 1000, D = 2 * Math.sqrt(K) * 0.75;
    for (let i = 0; i < 11; i++) {
      const p = this.pts[i];
      p.x += dxr; p.y += dyr;
      const ax = (T[i].x - p.x) * K - p.vx * D, ay = (T[i].y - p.y) * K - p.vy * D;
      p.vx += ax * dt; p.vy += ay * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      // never lag far behind the pose
      const ex = p.x - T[i].x, ey = p.y - T[i].y, el = Math.hypot(ex, ey);
      if (el > 26) { p.x = T[i].x + ex / el * 26; p.y = T[i].y + ey / el * 26; }
    }
  }

  // a shove on a living body (flinch)
  shove(vx, vy, idx = J.NECK) {
    for (let i = 0; i < 11; i++) { const k = i === idx ? 1 : 0.35; this.pts[i].vx += vx * k; this.pts[i].vy += vy * k; }
  }

  /* --------------------------------------------------------------- death */
  die(vx, vy, idx = J.NECK, room) {
    if (this.dead) return;
    this.dead = true; this.deadT = 0;
    const h = 1 / 120;
    for (let i = 0; i < 11; i++) {
      const p = this.pts[i];
      const k = i === idx ? 1 : i === J.HEAD || i === J.NECK ? 0.75 : 0.45;
      const ivx = p.vx * 0.5 + vx * k, ivy = p.vy * 0.5 + vy * k;
      p.px = p.x - ivx * h; p.py = p.y - ivy * h;
    }
    // spin: head one way, feet the other
    const spin = clamp(vx * 0.03, -10, 10) * h * 60;
    this.pts[J.HEAD].px -= spin * 0.03; this.pts[J.FFOOT].px += spin * 0.02; this.pts[J.BFOOT].px += spin * 0.02;
    this.acc = 0;
  }
  push(x, y, vx, vy, r = 40) {
    const h = 1 / 120;
    for (const p of this.pts) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > r) continue;
      const k = 1 - d / r;
      if (this.dead) { p.px -= vx * k * h; p.py -= vy * k * h; } else { p.vx += vx * k * 0.3; p.vy += vy * k * 0.3; }
    }
  }

  simulate(dt, room, panes) {
    if (!this.dead || this.broken) return;
    this.deadT += dt; this.whiteT = clamp(this.whiteT + dt / 0.4, 0, 1);
    const h = 1 / 120;
    this.acc += dt;
    let n = 0;
    while (this.acc >= h && n < 8) {
      this.acc -= h; n++;
      for (const p of this.pts) {
        const vx = (p.x - p.px) * 0.995, vy = (p.y - p.py) * 0.995;
        p.px = p.x; p.py = p.y;
        p.x += vx; p.y += vy + GRAV * h * h;
      }
      for (let it = 0; it < 4; it++) {
        for (const st of STICKS) {
          if (st[5] === 'head' && this.headless) continue;
          const a = this.pts[st[0]], b = this.pts[st[1]];
          const L = st[2] * this.s;
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.001;
          const diff = (d - L) / d * 0.5;
          a.x += dx * diff; a.y += dy * diff; b.x -= dx * diff; b.y -= dy * diff;
        }
        // keep the head roughly in line with the spine
        if (!this.headless) {
          const a = this.pts[J.HEAD], b = this.pts[J.PELVIS];
          const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, min = 38 * this.s;
          if (d < min) { const k = (d - min) / d * 0.5; a.x += (b.x - a.x) * k; a.y += (b.y - a.y) * k; b.x -= (b.x - a.x) * k; b.y -= (b.y - a.y) * k; }
        }
        for (let i = 0; i < 11; i++) room.collidePoint(this.pts[i], i === J.HEAD ? 9 : i === J.PELVIS || i === J.NECK ? 8 : 5, 0.75, panes);
      }
    }
  }

  // split the ragdoll into separate limb blocks
  breakApart(vx = 0, vy = 0) {
    if (this.broken) return [];
    this.broken = true;
    const out = [];
    for (const st of STICKS) {
      if (st[5] === 'head' && this.headless) continue;
      const a = this.pts[st[0]], b = this.pts[st[1]];
      out.push(makePiece(a, b, st, this, vx, vy));
    }
    return out;
  }
  // knock the head clean off (headshots)
  popHead(vx, vy) {
    if (this.headless) return null;
    this.headless = true;
    const st = STICKS[1];
    return makePiece(this.pts[J.NECK], this.pts[J.HEAD], st, this, vx * 1.3, vy * 1.3 - 250);
  }

  /* ----------------------------------------------------------------- hit */
  // returns { idx, head } of the closest stick within r of (x, y), or null
  hitTest(x, y, r) {
    let best = null, bd = 1e9;
    for (let i = 0; i < STICKS.length; i++) {
      const st = STICKS[i];
      if (st[5] === 'head' && this.headless) continue;
      const a = this.pts[st[0]], b = this.pts[st[1]];
      let ax = a.x, ay = a.y, bx = b.x, by = b.y;
      if (st[5] === 'head') { const dx = bx - ax, dy = by - ay; ax += dx * 0.3; ay += dy * 0.3; bx += dx * 0.5; by += dy * 0.5; }
      const q = segPointDist(ax, ay, bx, by, x, y);
      const rad = st[3] * this.s * 0.5 + r;
      if (q.d < rad && q.d < bd) { bd = q.d; best = { idx: st[1], head: st[5] === 'head', stick: i }; }
    }
    return best;
  }
  center() { const a = this.pts[J.NECK], b = this.pts[J.PELVIS]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  muzzle(len, second) {
    const h = this.pts[second ? J.BHAND : J.FHAND], a = second ? this.gunAng2 : this.gunAng;
    return { x: h.x + Math.cos(a) * len, y: h.y + Math.sin(a) * len - 3 };
  }

  /* ---------------------------------------------------------------- draw */
  tint() {
    let c = this.color;
    if (this.rainbow) c = hsl((this.t * 60) % 360, 70, 72);
    if (this.flash > 0) c = mixHex(c, '#ffffff', this.flash);
    return mixHex(c, this.deadColor, this.whiteT);
  }
  draw(ctx) {
    if (this.broken) return;
    const base = this.tint();
    const dark = mixHex(this.rainbow ? shade(base, -0.2) : this.dark, shade(this.deadColor, -0.12), this.whiteT);
    const f = this.facing;
    for (const si of DRAW_ORDER) {
      const st = STICKS[si];
      if (st[5] === 'head' && this.headless) continue;
      const a = this.pts[st[0]], b = this.pts[st[1]];
      const back = st[5] === 'barm' || st[5] === 'bleg';
      const col = back ? dark : base;
      if (st[5] === 'head') drawHead(ctx, a, b, st[3] * this.s, col, this, f);
      else limb(ctx, a.x, a.y, b.x, b.y, st[3] * this.s, st[4], col, st[5] === 'torso' ? 1.4 : 1);
      // the gun sits in the hands, between the arms
      if (si === 4 && this.gunId && !this.dead && this.dual) drawGun(ctx, this.pts[J.BHAND], this.gunAng2 != null && this.dual ? this.gunAng2 : this.gunAng, this.gunId, this.dual);
      if (si === 9 && this.gunId && !this.dead) drawGun(ctx, this.pts[J.FHAND], this.gunAng, this.gunId, false);
    }
  }
}

function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const fn = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [fn(0), fn(8), fn(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// a block limb as a small prism around the gameplay plane
function limb(ctx, ax, ay, bx, by, th, dz, col, ext = 1) {
  const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l, nx = -uy * th / 2, ny = ux * th / 2;
  const e = 2.5 * ext;
  const x0 = ax - ux * e, y0 = ay - uy * e, x1 = bx + ux * e, y1 = by + uy * e;
  prism(ctx, [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], ZP - dz, ZP + dz, col, shade(col, 0.16), shade(col, -0.14), shade(col, -0.24));
}

function drawHead(ctx, neck, head, size, col, body, f) {
  const dx = head.x - neck.x, dy = head.y - neck.y, l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l;
  const cx = neck.x + ux * (LEN.neck * body.s * 0.75 + 2), cy = neck.y + uy * (LEN.neck * body.s * 0.75 + 2);
  const h = size / 2, w = size / 2 * 0.95;
  const vx = -ux, vy = -uy;          // "up" of the head is along neck→head
  const rx = -vy, ry = vx;           // right
  const P = (a, b) => [cx + rx * a + ux * b, cy + ry * a + uy * b];
  prism(ctx, [P(-w, -h), P(w, -h), P(w, h), P(-w, h)], ZP - 0.07, ZP + 0.07, col, shade(col, 0.16), shade(col, -0.14), shade(col, -0.24));
  if (body.shine && !body.dead) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    const p = P(-w * 0.5 * f, h * 0.6);
    ctx.beginPath(); ctx.arc(p[0], p[1], 2.5, 0, TAU); ctx.fill();
  }
  if (body.hat && body.hat !== 'none' && !body.dead) drawHat(ctx, body.hat, cx, cy, ux, uy, size, f);
}

function drawHat(ctx, hat, cx, cy, ux, uy, size, f) {
  const rx = uy, ry = -ux;
  const P = (a, b) => [cx + rx * a * f + ux * b, cy + ry * a * f + uy * b];
  const h = size / 2;
  const box = (a0, b0, a1, b1, c, z = 0.075) => prism(ctx, [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)], ZP - z, ZP + z, c, shade(c, 0.18), shade(c, -0.15));
  switch (hat) {
    case 'band': box(-h - 1, h * 0.35, h + 1, h * 0.05, '#ff5d73', 0.078); box(-h - 6, h * 0.3, -h - 1, h * 0.1, '#ff5d73', 0.02); break;
    case 'cap': box(-h - 1, h + 5, h + 1, h * 0.4, '#2f3646'); box(h - 2, h * 0.55, h + 9, h * 0.4, '#2f3646', 0.06); break;
    case 'shades': box(-1, h * 0.35, h + 1.5, -h * 0.05, '#111318', 0.078); break;
    case 'visor': box(-2, h * 0.5, h + 2, -h * 0.15, '#58e1ff', 0.078); break;
    case 'tophat': box(-h + 1, h + 15, h - 1, h + 1, '#15171d', 0.06); box(-h - 3, h + 3, h + 3, h, '#15171d', 0.075); box(-h + 1, h + 5, h - 1, h + 3, '#ff4f5e', 0.061); break;
    case 'crown': {
      const c = '#ffd34d';
      box(-h, h + 6, h, h, c, 0.072);
      for (const a of [-h, -1.5, h - 3]) box(a, h + 11, a + 3, h + 6, c, 0.03);
      break;
    }
    case 'halo': {
      const p = P(0, h + 10);
      Glow.draw(ctx, '#fff3a8', p[0], p[1], 16, 0.7);
      ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(p[0], p[1], 11, 3.5, Math.atan2(ry, rx), 0, TAU); ctx.stroke();
      break;
    }
    default: break;
  }
}

function drawGun(ctx, hand, ang, id, dual) {
  const w = WEAPON[id] || { len: 16 };
  const L = w.len, c = Math.cos(ang), s = Math.sin(ang);
  const x0 = hand.x - c * 4, y0 = hand.y - s * 4 - 3;
  const nx = -s, ny = c;
  const q = (a, b) => [x0 + c * a + nx * b, y0 + s * a + ny * b];
  const col = '#4a4e5c';
  const up = Math.cos(ang) >= 0 ? 1 : -1;
  // body
  prism(ctx, [q(0, -3 * up), q(L, -3 * up), q(L, 2 * up), q(0, 2 * up)], ZP - 0.03, ZP + 0.03, col, '#6a6f80', '#33363f');
  // grip
  prism(ctx, [q(1, 2 * up), q(6, 2 * up), q(4, 9 * up), q(-1, 9 * up)], ZP - 0.025, ZP + 0.025, '#3b3e48', '#5a5e6c', '#2a2c33');
  if (id === 'shotgun' || id === 'rifle') prism(ctx, [q(-9, -2 * up), q(0, -2 * up), q(0, 4 * up), q(-9, 5 * up)], ZP - 0.025, ZP + 0.025, '#3b3e48', '#5a5e6c', '#2a2c33');
  if (id === 'rifle' || id === 'smg') prism(ctx, [q(10, 2 * up), q(14, 2 * up), q(15, 10 * up), q(11, 10 * up)], ZP - 0.02, ZP + 0.02, '#3b3e48', '#5a5e6c', '#2a2c33');
}

/* --------------------------------------------------------------- pieces */
// A loose block: two verlet points joined by a rigid stick, drawn as a prism.
function makePiece(a, b, st, body, vx, vy) {
  const h = 1 / 120;
  const role = st[5];
  const isHead = role === 'head';
  let ax = a.x, ay = a.y, bx = b.x, by = b.y;
  if (isHead) { const dx = bx - ax, dy = by - ay; ax += dx * 0.25; ay += dy * 0.25; bx += dx * 0.75; by += dy * 0.75; }
  const avx = (a.x - (a.px != null ? a.px : a.x - a.vx * h)) , avy = (a.y - (a.py != null ? a.py : a.y - a.vy * h));
  const bvx = (b.x - (b.px != null ? b.px : b.x - b.vx * h)), bvy = (b.y - (b.py != null ? b.py : b.y - b.vy * h));
  const jx = rand(-60, 60), jy = rand(-80, 0);
  const p1 = { x: ax, y: ay, px: ax - (body.dead ? avx : 0) - (vx + jx) * h, py: ay - (body.dead ? avy : 0) - (vy + jy) * h };
  const p2 = { x: bx, y: by, px: bx - (body.dead ? bvx : 0) - (vx - jx) * h, py: by - (body.dead ? bvy : 0) - (vy + jy) * h };
  return {
    a: p1, b: p2, len: Math.max(6, Math.hypot(bx - ax, by - ay)), th: st[3] * body.s * (isHead ? 0.95 : 1), dz: st[4],
    color: body.tint(), target: body.deadColor, whiteT: body.whiteT, head: isHead, sleep: 0, acc: 0, life: 0,
    back: role === 'barm' || role === 'bleg',
  };
}

function simPiece(pc, dt, room, panes) {
  pc.life += dt;
  pc.whiteT = clamp(pc.whiteT + dt / 0.4, 0, 1);
  if (pc.sleep > 0.6) return;
  const h = 1 / 120;
  pc.acc += dt;
  let n = 0;
  while (pc.acc >= h && n < 8) {
    pc.acc -= h; n++;
    for (const p of [pc.a, pc.b]) {
      const vx = (p.x - p.px) * 0.994, vy = (p.y - p.py) * 0.994;
      p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + GRAV * h * h;
    }
    for (let it = 0; it < 3; it++) {
      const dx = pc.b.x - pc.a.x, dy = pc.b.y - pc.a.y, d = Math.hypot(dx, dy) || 0.001;
      const diff = (d - pc.len) / d * 0.5;
      pc.a.x += dx * diff; pc.a.y += dy * diff; pc.b.x -= dx * diff; pc.b.y -= dy * diff;
      const r = Math.min(pc.th / 2, 10);
      room.collidePoint(pc.a, r, 0.55, panes); room.collidePoint(pc.b, r, 0.55, panes);
    }
  }
  const sp = Math.abs(pc.a.x - pc.a.px) + Math.abs(pc.a.y - pc.a.py) + Math.abs(pc.b.x - pc.b.px) + Math.abs(pc.b.y - pc.b.py);
  pc.sleep = sp < 0.08 ? pc.sleep + dt : 0;
}
function wakePiece(pc) { pc.sleep = 0; }

function drawPiece(ctx, pc) {
  const c = mixHex(pc.color, pc.target, pc.whiteT);
  const col = pc.back ? shade(c, -0.1) : c;
  if (pc.head) {
    const dx = pc.b.x - pc.a.x, dy = pc.b.y - pc.a.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    const cx = (pc.a.x + pc.b.x) / 2, cy = (pc.a.y + pc.b.y) / 2, h = pc.th / 2;
    const P = (a, b) => [cx - uy * a + ux * b, cy + ux * a + uy * b];
    prism(ctx, [P(-h, -h), P(h, -h), P(h, h), P(-h, h)], ZP - 0.07, ZP + 0.07, col, shade(col, 0.14), shade(col, -0.13), shade(col, -0.22));
  } else limb(ctx, pc.a.x, pc.a.y, pc.b.x, pc.b.y, pc.th, pc.dz, col, pc.th > 18 ? 1.4 : 1);
}
