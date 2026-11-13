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
  [J.NECK, J.PELVIS, LEN.torso, 20, 0.066, 'torso'],
  [J.NECK, J.HEAD, LEN.neck, 17, 0.06, 'head'],
  [J.NECK, J.BELB, LEN.upper, 8, 0.04, 'barm'], [J.BELB, J.BHAND, LEN.fore, 7, 0.04, 'barm'],
  [J.PELVIS, J.BKNEE, LEN.thigh, 11, 0.047, 'bleg'], [J.BKNEE, J.BFOOT, LEN.shin, 10, 0.047, 'bleg'],
  [J.PELVIS, J.FKNEE, LEN.thigh, 11, 0.047, 'fleg'], [J.FKNEE, J.FFOOT, LEN.shin, 10, 0.047, 'fleg'],
  [J.NECK, J.FELB, LEN.upper, 8, 0.04, 'farm'], [J.FELB, J.FHAND, LEN.fore, 7, 0.04, 'farm'],
];
const DRAW_ORDER = [2, 3, 4, 5, 0, 1, 6, 7, 8, 9];
const GRAV = 3000;               // bodies are heavy: they drop hard and don't float

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
    this.shine = !!o.shine; this.rainbow = !!o.rainbow; this.prism = !!o.prism;
    this.armor = null; this.armorBroken = {};
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
    const mf = speed > 5 ? Math.sign(st.vx) * f : 1;          // 1 running forward, -1 backpedalling
    // landing impact: remembered from the fall speed, eased out over a moment
    if (!st.grounded) this.fallV = Math.max(this.fallV || 0, st.vy || 0);
    if (st.grounded && this.wasAir && !st.slide) this.land = clamp((this.fallV || 0) / 900, 0.25, 1);
    if (st.grounded) this.fallV = 0;
    this.wasAir = !st.grounded;
    this.land = Math.max(0, (this.land || 0) - dt * 4.5);
    // phase rate matches stride length so planted feet never skate
    const strideLen = (12 + (st.sprint ? 12 : 0)) * clamp(speed / 170, 0.4, 1) * (mf < 0 ? 0.7 : 1);
    if (st.grounded && !st.slide) this.phase += speed * dt / Math.max(8, strideLen);
    const T = this.T;
    const set = (i, x, y) => { T[i].x = x; T[i].y = y; };
    const run = st.grounded && !st.slide ? clamp(speed / 170, 0, 1) : 0;
    const sprint = st.sprint ? 1 : 0;
    this.leanS = lerp(this.leanS || 0, mf * run * (5 + sprint * 9), 1 - Math.exp(-10 * dt));
    let pel, neck, fFoot, bFoot, fBend = -1, bBend = -1;
    if (st.slide) {
      // low power slide: hips almost on the floor, chest reclined, lead leg straight out
      const wob = Math.sin(this.t * 30) * 0.6;
      pel = [-1, -9 + wob];
      // recline angle above the floor; sits up taller when there's a wall close behind
      const back = st.slideBack != null ? st.slideBack : 60;
      const rec = Math.max(0.55, Math.acos(clamp((back - 8) / LEN.torso, 0.15, 1)));
      neck = [pel[0] - Math.cos(rec) * LEN.torso, pel[1] - Math.sin(rec) * LEN.torso];
      const front = st.slideFront != null ? st.slideFront : 60;
      fFoot = [clamp(front - 6, 14, 38), -4]; bFoot = [clamp(front - 26, 4, 12), -3];
    } else if (!st.grounded) {
      const fall = clamp((st.vy || 0) / 650, -1, 1);
      pel = [0, -47];
      neck = [2 + fall * 2, -81];
      if (fall < 0) { fFoot = [10, -22 - fall * 4]; bFoot = [-9, -6]; }               // rising: lead knee up, trail leg back
      else { fFoot = [9 - fall * 2, -14 + fall * 9]; bFoot = [-7, -9 + fall * 7]; }    // falling: legs reach for the floor
      if (st.flip) { fFoot = [8, -26]; bFoot = [0, -24]; pel = [0, -44]; neck = [6, -74]; }
    } else {
      const ph = this.phase;
      const back = mf < 0 ? 0.7 : 1;
      const dip = this.land * 10;
      // contact frames sink the hips, passing frames lift them; the chest trails the hips slightly
      const bob = Math.abs(Math.sin(ph)) * (sprint ? 3.6 : 2.6) * run;
      const sway = Math.sin(ph) * 1.2 * run;
      pel = [this.leanS * 0.25 + sway + (1 - run) * Math.sin(this.t * 0.9) * 1.1, -44 + bob + dip + (1 - run) * Math.sin(this.t * 2.2) * 0.7];
      const lean = this.leanS + this.land * 5 + (sprint ? 0 : 1.5 * run * mf);
      neck = [pel[0] + lean - sway * 0.5, pel[1] - LEN.torso + Math.abs(lean) * 0.18 + Math.cos(ph * 2) * 1.1 * run];
      const stride = (12 + sprint * 12) * run * back;
      const lift = (9 + sprint * 8) * run * back;
      const legAt = p => {
        const sw = Math.cos(p);                                   // >0 swing forward, <0 planted and pushing
        return [Math.sin(p) * stride * mf, -Math.max(0, sw) * lift - Math.max(0, -Math.sin(p) * mf) * sw * 0];
      };
      if (run > 0.05) { fFoot = legAt(ph); bFoot = legAt(ph + Math.PI); }
      else { fFoot = [8, 0]; bFoot = [-7, 0]; }
      // heel kick on the trailing leg while sprinting
      if (sprint && run > 0.5) for (const [ft, p] of [[fFoot, ph], [bFoot, ph + Math.PI]]) if (Math.sin(p) * mf < -0.3 && Math.cos(p) > 0) ft[1] -= 6;
    }
    // front kick: chamber the knee, snap the foot out at hip height, lean back
    if (st.legKick != null) {
      const m = st.legKick, out = m < 0.28 ? m / 0.28 : m < 0.7 ? 1 : 1 - (m - 0.7) / 0.3;
      const hy = st.slide ? -10 : pel[1];
      fFoot = [lerp(10, 44, out), lerp(hy + 22, hy - 2, out)];      // knee bends the normal way (forward)
      neck = [neck[0] - 9 * out, neck[1] + 3 * out];
      if (st.grounded && !st.slide) bFoot = [-6, 0];
    }
    set(J.PELVIS, pel[0], pel[1]);
    set(J.NECK, neck[0], neck[1]);
    // the head turns a little toward where the gun points
    const tdx = neck[0] - pel[0], tdy = neck[1] - pel[1];
    let ha = Math.atan2(tdy, tdx);
    if (st.slide) ha = lerp(ha, -Math.PI / 2 + 0.25, 0.7);          // chin up, eyes on the target
    if (st.gun && st.aim != null) { const al = f > 0 ? st.aim : Math.PI - st.aim; ha += clamp(al * 0.3, -0.35, 0.35); }
    set(J.HEAD, neck[0] + Math.cos(ha) * LEN.neck, neck[1] + Math.sin(ha) * LEN.neck);
    // legs (knees point forward)
    let k = ik(pel[0], pel[1], fFoot[0], fFoot[1], LEN.thigh, LEN.shin, fBend);
    set(J.FKNEE, k[0], k[1]); set(J.FFOOT, k[2], k[3]);
    k = ik(pel[0], pel[1], bFoot[0], bFoot[1], LEN.thigh, LEN.shin, bBend);
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
      if (st.slide && !st.twoHand && !st.dual) bh = [pel[0] - 30, -3];
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
      if (st.slide) { fh = [sh[0] + 22, sh[1] + 2]; bh = [pel[0] - 30, -3]; }
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
    // sliding down stairs: the whole body follows the slope
    if (st.slide && st.slope) {
      const c = Math.cos(st.slope), sn = Math.sin(st.slope);
      for (const p of T) { const x = p.x, y = p.y; p.x = x * c - y * sn; p.y = x * sn + y * c; }
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
    const K = st.slide || st.flip ? 1500 : 1100, D = 2 * Math.sqrt(K) * 0.72;
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
        const vx = (p.x - p.px) * 0.998, vy = (p.y - p.py) * 0.998;
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
    if (this.alpha != null && this.alpha < 1) { ctx.save(); ctx.globalAlpha = Math.max(0, this.alpha); this.alpha = null; this.draw(ctx); this.alpha = ctx.globalAlpha; ctx.restore(); return; }
    const base = this.tint();
    const dark = mixHex(this.rainbow ? shade(base, -0.2) : this.dark, shade(this.deadColor, -0.12), this.whiteT);
    const f = this.facing;
    const crystal = this.prism && this.whiteT < 0.5;
    const A = this.armor && !this.dead ? this.armor : null, broken = this.armorBroken || {};
    for (const si of DRAW_ORDER) {
      const st = STICKS[si];
      if (st[5] === 'head' && this.headless) continue;
      const a = this.pts[st[0]], b = this.pts[st[1]];
      const back = st[5] === 'barm' || st[5] === 'bleg';
      let col = back ? dark : base;
      if (crystal) {
        // diamond: an iridescent tint that drifts across the body, see-through, with a travelling sheen
        const hue = (this.t * 35 + (a.x + a.y) * 1.3) % 360;
        col = mixHex(hsl(hue, 70, back ? 78 : 86), '#ffffff', 0.25 + 0.3 * Math.max(0, Math.sin(this.t * 2.4 - a.x * 0.06)));
        ctx.globalAlpha = back ? 0.62 : 0.78;
      }
      if (st[5] === 'head') drawHead(ctx, a, b, st[3] * this.s, col, this, f);
      else limb(ctx, a.x, a.y, b.x, b.y, st[3] * this.s, st[4], col, st[5] === 'torso' ? 1.4 : 1);
      if (crystal) ctx.globalAlpha = 1;
      if (A) {
        if (st[5] === 'torso' && A.body && !broken.body) drawVest(ctx, a, b, st[3] * this.s, A.body);
        if ((si === 5 || si === 7) && A.legs && !broken.legs) drawGuard(ctx, a, b, st[3] * this.s, A.legs, back);
      }
      // the gun sits in the hands, between the arms
      if (si === 4 && this.gunId && !this.dead && this.dual) drawGun(ctx, this.pts[J.BHAND], this.gunAng2 != null && this.dual ? this.gunAng2 : this.gunAng, this.gunId, this.dual);
      if (si === 9 && this.gunId && !this.dead) drawGun(ctx, this.pts[J.FHAND], this.gunAng, this.gunId, false);
    }
    if (crystal) {
      // glints that twinkle on and off across the crystal
      for (let i = 0; i < 4; i++) {
        const k = (this.t * 0.9 + i * 0.27) % 1, p = this.pts[[J.HEAD, J.NECK, J.PELVIS, J.FKNEE][i]];
        const a = Math.sin(k * Math.PI);
        if (a < 0.2) continue;
        const x = p.x + Math.sin(i * 7.1) * 5, y = p.y + Math.cos(i * 3.3) * 5, r = 2 + a * 4;
        Glow.draw(ctx, '#ffffff', x, y, r * 2.4, a * 0.7);
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.25, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.25, y); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x, y + r * 0.25); ctx.lineTo(x + r, y); ctx.lineTo(x, y - r * 0.25); ctx.closePath(); ctx.fill();
      }
    }
  }
}

/* -------------------------------------------------------------- armour */
// partial limb: from t0 to t1 along a->b
function seg(a, b, t0, t1) { return [a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0, a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1]; }
function drawVest(ctx, neck, pel, th, ar) {
  const [x0, y0, x1, y1] = seg(neck, pel, 0.08, 0.86);
  limb(ctx, x0, y0, x1, y1, th + 5, 0.08, ar.col, 0.8);
  const [c0, c1, c2, c3] = seg(neck, pel, 0.08, 0.22);
  limb(ctx, c0, c1, c2, c3, th + 6, 0.085, ar.trim, 0.4);                  // collar
  const [p0, p1, p2, p3] = seg(neck, pel, 0.5, 0.7);
  limb(ctx, p0, p1, p2, p3, th + 6.5, 0.086, shade(ar.col, -0.18), 0.3);     // pouches
  if (ar.ability === 'deflect') { const m = seg(neck, pel, 0.32, 0.32); Glow.draw(ctx, ar.trim, m[0], m[1], 10, 0.5); }
}
function drawGuard(ctx, knee, foot, th, ar, back) {
  const [x0, y0, x1, y1] = seg(knee, foot, 0.12, 0.82);
  limb(ctx, x0, y0, x1, y1, th + 3.5, 0.06, back ? shade(ar.col, -0.15) : ar.col, 0.6);
  limb(ctx, knee.x, knee.y - 1, knee.x, knee.y + 1, th + 4.5, 0.065, back ? shade(ar.trim, -0.15) : ar.trim, 2.2);   // knee cap
}
// helmets replace the hat while worn
function drawHelmet(ctx, ar, cx, cy, ux, uy, size, f) {
  const rx = -uy, ry = ux;
  const P = (a, b) => [cx + rx * a * f + ux * b, cy + ry * a * f + uy * b];
  const h = size / 2;
  const poly = (pts, c, z = 0.085) => prism(ctx, pts.map(([a, b]) => P(a, b)), ZP - z, ZP + z, c, shade(c, 0.2), shade(c, -0.16), shade(c, -0.28));
  const c = ar.col, t = ar.trim;
  switch (ar.id) {
    case 'hood':
      poly([[-h - 2, -h * 0.6], [h * 0.2, -h * 0.6], [h * 0.6, h * 0.6], [h * 0.4, h + 3], [-h * 0.6, h + 4], [-h - 2.5, h + 1]], c);
      break;
    case 'helmet':
      poly([[-h - 2, h * 0.15], [h + 2, h * 0.15], [h + 1.5, h + 3], [h * 0.4, h + 6], [-h * 0.6, h + 6], [-h - 2, h + 3]], c);
      poly([[h - 1, h * 0.3], [h + 6, h * 0.18], [h + 6, h * 0.05], [h - 1, h * 0.12]], t, 0.08);
      break;
    case 'tachelm':
      poly([[-h - 2, h * 0.2], [h + 2, h * 0.2], [h + 1.5, h + 3], [h * 0.4, h + 6], [-h * 0.6, h + 6], [-h - 2, h + 3]], c);
      poly([[h * 0.1, h + 6], [h * 0.7, h + 6], [h * 0.9, h + 2], [h * 0.1, h + 2]], shade(c, -0.25), 0.03);
      poly([[h * 0.5, h + 1], [h + 5, h + 1], [h + 5, h - 3], [h * 0.5, h - 3]], '#20232c', 0.04);
      Glow.draw(ctx, t, P(h + 5, h - 1)[0], P(h + 5, h - 1)[1], 7, 0.8);
      break;
    case 'mirrorvisor':
      poly([[-h - 1.5, h * 0.55], [h + 1.5, h * 0.55], [h + 1.5, h * 0.25], [-h - 1.5, h * 0.25]], shade(c, -0.4), 0.088);
      poly([[0, h * 0.75], [h + 3, h * 0.62], [h + 3, -h * 0.55], [0, -h * 0.35]], c, 0.09);
      Glow.draw(ctx, t, P(h * 0.9, 0)[0], P(h * 0.9, 0)[1], 12, 0.6);
      break;
    case 'titanhelm':
      poly([[-h - 2.5, -h * 0.9], [h + 2.5, -h * 0.9], [h + 2.5, h + 3], [h * 0.4, h + 6], [-h * 0.6, h + 6], [-h - 2.5, h + 3]], c, 0.09);
      poly([[h * 0.15, h * 0.35], [h + 2.8, h * 0.35], [h + 2.8, h * 0.15], [h * 0.15, h * 0.15]], t, 0.092);     // eye slit
      poly([[-h * 0.5, h + 6], [h * 0.3, h + 6], [h * 0.1, h + 12], [-h * 0.3, h + 12]], t, 0.03);              // crest
      break;
    default: break;
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

const FACE_HATS = new Set(['band', 'shades', 'phones', 'visor']);     // worn on the face / ears, not on top
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
  const helm = body.armor && !body.dead && body.armor.head && !(body.armorBroken || {}).head ? body.armor.head : null;
  if (helm) drawHelmet(ctx, helm, cx, cy, ux, uy, size, f);
  // hats are worn with head armour too: ones that sit on top of the head ride on top of the helmet
  if (body.hat && body.hat !== 'none' && !body.dead) {
    const lift = helm && !FACE_HATS.has(body.hat) ? size * 0.2 : 0;
    drawHat(ctx, body.hat, cx + ux * lift, cy + uy * lift, ux, uy, size, f);
  }
}

function drawHat(ctx, hat, cx, cy, ux, uy, size, f) {
  // head-local frame: a = toward the face, b = up out of the head
  const rx = -uy, ry = ux;
  const P = (a, b) => [cx + rx * a * f + ux * b, cy + ry * a * f + uy * b];
  const h = size / 2, t = performance.now() / 1000;
  const poly = (pts, c, z = 0.075) => prism(ctx, pts.map(([a, b]) => P(a, b)), ZP - z, ZP + z, c, shade(c, 0.2), shade(c, -0.16), shade(c, -0.28));
  const box = (a0, b0, a1, b1, c, z) => poly([[a0, b0], [a1, b0], [a1, b1], [a0, b1]], c, z);
  switch (hat) {
    case 'band': {
      const c = '#ff4f5e', w = Math.sin(t * 13) * 2.2, w2 = Math.sin(t * 13 + 1.3) * 2.2;
      poly([[-h - 1, h * 0.12], [-h - 12, h * 0.05 + w2], [-h - 13, h * 0.32 + w2], [-h - 1, h * 0.36]], shade(c, -0.15), 0.02);
      poly([[-h - 1, h * 0.25], [-h - 9, h * 0.3 + w], [-h - 10, h * 0.55 + w], [-h - 1, h * 0.48]], c, 0.03);
      box(-h - 1, h * 0.48, h + 1, h * 0.1, c, 0.079);
      box(-h - 3, h * 0.55, -h, h * 0.05, shade(c, -0.1), 0.04);
      break;
    }
    case 'beanie': {
      const c = '#3b5b8f';
      poly([[-h - 1, h * 0.25], [h + 1, h * 0.25], [h + 0.5, h + 4], [h * 0.45, h + 7.5], [-h * 0.45, h + 7.5], [-h - 0.5, h + 4]], c, 0.078);
      box(-h - 1.5, h * 0.62, h + 1.5, h * 0.12, shade(c, 0.12), 0.081);
      for (const a of [-h * 0.5, 0, h * 0.5]) box(a - 0.6, h * 0.6, a + 0.6, h * 0.14, shade(c, -0.12), 0.082);
      box(-3.5, h + 13, 3.5, h + 6.5, '#f2f2f4', 0.05);
      break;
    }
    case 'cap': {
      const c = '#2f3646';
      poly([[-h - 1, h * 0.45], [h + 1, h * 0.45], [h + 0.5, h + 4], [h * 0.35, h + 7], [-h * 0.55, h + 7], [-h - 1, h + 4]], c, 0.078);
      poly([[h * 0.1, h * 0.45], [h + 1, h * 0.45], [h + 0.5, h + 4], [h * 0.35, h + 7]], '#ff4f5e', 0.079);
      poly([[h - 1, h * 0.62], [h + 12, h * 0.42], [h + 12, h * 0.26], [h - 1, h * 0.36]], shade(c, -0.25), 0.07);
      box(-1.5, h + 8.6, 1.5, h + 6.6, '#ff4f5e', 0.02);
      break;
    }
    case 'party': {
      const c = '#ff5d9e';
      poly([[-h - 1.5, h * 0.25], [h + 1.5, h * 0.25], [0, h + 22]], c, 0.078);
      poly([[-h * 0.82, h * 0.25 + 5], [h * 0.82, h * 0.25 + 5], [h * 0.6, h * 0.25 + 10], [-h * 0.6, h * 0.25 + 10]], '#ffd34d', 0.079);
      poly([[-h * 0.42, h + 8], [h * 0.42, h + 8], [h * 0.24, h + 13], [-h * 0.24, h + 13]], '#58e1ff', 0.079);
      box(-h - 1.5, h * 0.35, h + 1.5, h * 0.18, '#ff8ac0', 0.08);
      box(-3, h + 26, 3, h + 20.5, '#ffd34d', 0.04);
      break;
    }
    case 'shades': {
      box(-h - 1, h * 0.4, h + 2, h * 0.28, '#111318', 0.079);
      poly([[0, h * 0.4], [h + 2, h * 0.4], [h + 1.5, -h * 0.12], [1.5, -h * 0.12]], '#15171e', 0.081);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.1;
      const g1 = P(h * 0.35, h * 0.3), g2 = P(h * 0.9, h * 0.0);
      ctx.beginPath(); ctx.moveTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]); ctx.stroke();
      break;
    }
    case 'phones': {
      const c = '#22252e';
      box(-h * 0.8, h + 5.5, h * 0.8, h + 2.5, c, 0.086);
      poly([[-h * 0.8, h + 5.5], [-h * 0.8, h + 2.5], [-h - 1.5, h * 0.7], [-h - 1.5, h * 0.9 + 2]], c, 0.086);
      box(-2, h + 3, 2, 5, shade(c, 0.1), 0.088);
      box(-5, 5, 5, -6, c, 0.095);
      box(-3, 3, 3, -4, '#58e1ff', 0.097);
      break;
    }
    case 'visor': {
      box(-h - 1, h * 0.38, 0, h * 0.08, '#20232c', 0.079);
      poly([[-1, h * 0.55], [h + 3, h * 0.48], [h + 3, -h * 0.2], [-1, -h * 0.12]], '#58e1ff', 0.081);
      Glow.draw(ctx, '#58e1ff', P(h * 0.7, h * 0.2)[0], P(h * 0.7, h * 0.2)[1], 14, 0.55 + Math.sin(t * 4) * 0.15);
      box(h * 0.2, h * 0.3, h + 2.5, h * 0.2, '#e6fbff', 0.082);
      break;
    }
    case 'cowboy': {
      const c = '#a8743f';
      poly([[-h - 13, h + 5], [-h - 9, h + 1], [h + 9, h + 1], [h + 13, h + 5], [h + 9, h + 3.5], [-h - 9, h + 3.5]], shade(c, -0.08), 0.08);
      poly([[-h + 1, h + 3], [0, h + 3], [0, h + 12], [-h + 2, h + 14]], c, 0.065);
      poly([[0, h + 3], [h - 1, h + 3], [h - 2, h + 14], [0, h + 12]], c, 0.065);
      box(-h + 1, h + 6, h - 1, h + 3, '#4a2f1a', 0.067);
      break;
    }
    case 'tophat': {
      const c = '#15171d';
      box(-h - 5, h + 3.5, h + 5, h + 0.5, c, 0.085);
      poly([[-h + 1, h + 3], [h - 1, h + 3], [h, h + 20], [-h, h + 20]], c, 0.068);
      poly([[-h + 0.9, h + 7.5], [h - 0.9, h + 7.5], [h - 0.95, h + 4], [-h + 0.95, h + 4]], '#ff4f5e', 0.07);
      box(h * 0.4, h + 18, h * 0.65, h + 9, 'rgba(255,255,255,0.18)', 0.07);
      break;
    }
    case 'horns': {
      const c = '#2b2d36', tip = '#f0e6d8';
      for (const [a0, z, col] of [[-6, 0.05, shade(c, -0.15)], [2, 0.08, c]]) {
        poly([[a0, h - 1], [a0 + 5.5, h - 1], [a0 + 7, h + 6], [a0 + 2.5, h + 6.5]], col, z);
        poly([[a0 + 2.5, h + 6.5], [a0 + 7, h + 6], [a0 + 10, h + 13]], tip, z);
      }
      break;
    }
    case 'crown': {
      const c = '#ffd34d';
      for (const a0 of [-h - 0.5, -2.5, h - 4.5]) {
        poly([[a0, h + 4], [a0 + 5, h + 4], [a0 + 2.5, h + 12]], c, 0.07);
        box(a0 + 1.3, h + 14, a0 + 3.7, h + 11.6, '#fff1a8', 0.03);
      }
      box(-h - 0.8, h + 5, h + 0.8, h - 0.5, c, 0.08);
      box(-1.6, h + 3.5, 1.6, h + 0.5, '#e2434b', 0.082);
      box(h - 3.5, h + 3.5, h - 0.8, h + 1, '#4da3ff', 0.082);
      box(-h + 0.8, h + 3.5, -h + 3.5, h + 1, '#45e08a', 0.082);
      break;
    }
    case 'riot': {
      const c = '#2b2f3b';
      poly([[-h - 1.5, h * 0.1], [h + 1.5, h * 0.1], [h + 1, h + 3], [h * 0.4, h + 6], [-h * 0.6, h + 6], [-h - 1.5, h + 3]], c, 0.08);
      poly([[0, h * 0.75], [h + 2.5, h * 0.75], [h + 2.5, -h * 0.4], [2, -h * 0.4]], 'rgba(140,170,200,0.55)', 0.082);
      break;
    }
    case 'olive': {
      const c = '#5d6b4a';
      poly([[-h - 1, h * 0.35], [h + 1, h * 0.35], [h + 0.5, h + 3], [-h * 0.5, h + 5], [-h - 1, h + 3]], c, 0.079);
      poly([[h - 1, h * 0.55], [h + 7, h * 0.4], [h + 7, h * 0.3], [h - 1, h * 0.35]], shade(c, -0.2), 0.07);
      break;
    }
    case 'halo': {
      const p = P(0, h + 11);
      Glow.draw(ctx, '#fff3a8', p[0], p[1], 24, 0.55 + Math.sin(t * 3) * 0.12);
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(Math.atan2(ry, rx));
      ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.ellipse(0, 0, 12, 4, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#fffbe0'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(0, -0.5, 12, 4, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      ctx.restore();
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
  const up = Math.cos(ang) >= 0 ? 1 : -1;
  const q = (a, b) => [x0 + c * a + nx * b * up, y0 + s * a + ny * b * up];
  const part = (pts, col, z = 0.03) => prism(ctx, pts.map(([a, b]) => q(a, b)), ZP - z, ZP + z, col, shade(col, 0.18), shade(col, -0.18), shade(col, -0.3));
  const box = (a0, b0, a1, b1, col, z) => part([[a0, b0], [a1, b0], [a1, b1], [a0, b1]], col, z);
  const metal = '#4a4e5c', dark = '#2f323b', wood = '#7a5235';
  const grip = (col = '#3b3e48') => part([[1, 2], [6, 2], [4, 9], [-1, 9]], col, 0.025);
  switch (id) {
    case 'revolver':
      box(0, -3, L, 1.5, metal); box(2, -3.5, 9, 3, dark, 0.035); grip(wood);
      box(L - 3, -4.5, L - 1, -3, metal, 0.01);
      break;
    case 'smg': case 'burst':
      box(-6, -3, L, 2, metal); box(10, 2, 14, 10, dark, 0.02); grip(); box(-10, -2, -5, 3, dark, 0.02);
      if (id === 'burst') box(4, -3.2, 12, -1.8, '#ff8a3d', 0.032);
      break;
    case 'shotgun':
      box(0, -3, L, 1, metal); box(8, 1, 19, 4, '#6a6f80', 0.028); part([[-11, -2], [0, -2], [0, 4], [-11, 6]], wood, 0.025); grip(wood);
      break;
    case 'rifle':
      box(-4, -3, L, 2, metal); box(12, 2, 16, 11, dark, 0.02); part([[-12, -2], [-4, -2], [-4, 4], [-12, 6]], dark, 0.025); grip(); box(6, -6, 14, -3, dark, 0.015);
      break;
    case 'bouncer':
      box(0, -3.5, L, 2, '#5a5f70'); box(L - 4, -4.5, L, 3, '#ff8a3d', 0.035); grip();
      break;
    case 'splitter':
      box(0, -3, L - 4, 2, metal); grip();
      box(L - 4, -5, L + 2, -3, dark, 0.02); box(L - 4, -1.5, L + 3, 0.5, dark, 0.02); box(L - 4, 2, L + 2, 4, dark, 0.02);
      break;
    case 'smart': {
      box(0, -3, L, 2, '#d7dde6'); grip('#9aa4b4'); box(4, -3.3, 12, -1.6, '#4da3ff', 0.032);
      const g = q(8, -2.5); Glow.draw(ctx, '#4da3ff', g[0], g[1], 9, 0.7);
      break;
    }
    case 'launcher':
      box(-6, -5, L, 4, '#5d6b4a', 0.04); box(L - 3, -6, L + 1, 5, '#3f4a32', 0.045); grip(); box(8, 4, 12, 9, dark, 0.02);
      break;
    case 'minigun': {
      box(-6, -5, 8, 5, dark, 0.045);
      const spin = performance.now() / 40;
      for (let i = 0; i < 3; i++) { const o = Math.sin(spin + i * 2.1) * 2.6; box(8, o - 1, L, o + 1, i === 1 ? metal : '#5a5e6c', 0.02 + i * 0.008); }
      box(L - 2, -4, L, 4, dark, 0.03); box(-2, -9, 6, -5, '#3b3e48', 0.02); grip();
      break;
    }
    case 'railgun': {
      box(-8, -2, L, 2, '#2a2d38', 0.03); box(0, -5, L + 2, -3, metal, 0.02); box(0, 3, L + 2, 5, metal, 0.02);
      for (const a of [6, 14, 22]) { box(a, -3, a + 3, 3, '#58e1ff', 0.035); }
      const g = q(L, 0); Glow.draw(ctx, '#58e1ff', g[0], g[1], 12, 0.6);
      grip(); part([[-14, -2], [-8, -2], [-8, 4], [-14, 6]], dark, 0.025);
      break;
    }
    default:
      box(0, -3, L, 2, metal); grip();
  }
}

/* --------------------------------------------------------------- pieces */
// A loose limb block is a rigid box (see physics.js) carrying its colour and fade-to-white.
function makePiece(a, b, st, body, vx, vy) {
  const h = 1 / 120;
  const role = st[5];
  const isHead = role === 'head';
  let ax = a.x, ay = a.y, bx = b.x, by = b.y;
  if (isHead) { const dx = bx - ax, dy = by - ay; ax += dx * 0.25; ay += dy * 0.25; bx += dx * 0.75; by += dy * 0.75; }
  // velocity of each end: from the verlet history on a ragdoll, from the springs on a living body
  const va = body.dead ? [(a.x - a.px) / h, (a.y - a.py) / h] : [a.vx, a.vy];
  const vb = body.dead ? [(b.x - b.px) / h, (b.y - b.py) / h] : [b.vx, b.vy];
  const L = isHead ? st[3] * body.s * 0.95 : Math.max(6, Math.hypot(bx - ax, by - ay)) + 5;
  const T = st[3] * body.s * (isHead ? 0.95 : 1);
  const ang = Math.atan2(by - ay, bx - ax);
  // spin from the difference between the two ends
  const ux = Math.cos(ang), uy = Math.sin(ang), len = Math.max(6, Math.hypot(bx - ax, by - ay));
  const spin = ((vb[1] - va[1]) * ux - (vb[0] - va[0]) * uy) / len;
  const pc = Rigid.make({
    x: (ax + bx) / 2, y: (ay + by) / 2, a: ang, L, T,
    vx: (va[0] + vb[0]) / 2 + vx + rand(-25, 25), vy: (va[1] + vb[1]) / 2 + vy + rand(-30, 0), w: clamp(spin, -18, 18) + rand(-1.5, 1.5),
    density: role === 'torso' ? 1.8 : role === 'head' ? 1.5 : 1.2, e: 0.08, mu: 0.8,
  });
  return Object.assign(pc, {
    dz: st[4], color: body.tint(), target: body.deadColor, whiteT: body.whiteT, head: isHead,
    back: role === 'barm' || role === 'bleg',
  });
}

// after Rigid.stepAll: fade to white and knock on impact
function simPiece(pc, dt) {
  pc.whiteT = clamp(pc.whiteT + dt / 0.4, 0, 1);
  if (pc.hit > 260 && (pc.lastThud || 0) < pc.life - 0.12) { pc.lastThud = pc.life; Sfx.thud(clamp(pc.hit / 900, 0.2, 0.8)); }
}
function wakePiece(pc) { pc.sleep = 0; }

function drawPiece(ctx, pc) {
  const c = mixHex(pc.color, pc.target, pc.whiteT);
  const col = pc.back ? shade(c, -0.1) : c;
  const dz = pc.head ? 0.07 : pc.dz;
  prism(ctx, Rigid.corners(pc), ZP - dz, ZP + dz, col, shade(col, 0.14), shade(col, -0.13), shade(col, -0.22));
}
