'use strict';
/* =========================================================================
   Rigid boxes: loose limb blocks and pushable crates. Each box has mass,
   rotational inertia, angular velocity, restitution and friction. Contacts
   are found at the box corners (and along long edges) against the tile
   grid, one-way platforms and glass, then resolved with impulses, so blocks
   tip over edges, roll, slide to a stop and settle flat. Boxes also push
   each other apart, so they pile up instead of overlapping.
   ========================================================================= */

const Rigid = (() => {
  const G = 3000, H = 1 / 120;          // heavy: debris drops and lands with weight

  // o: { x, y, a, vx, vy, w, L (length along the box axis), T (thickness), density, e, mu }
  function make(o) {
    const L = Math.max(4, o.L), T = Math.max(4, o.T);
    const m = (L * T / 400) * (o.density || 1);
    return Object.assign({ x: 0, y: 0, a: 0, vx: 0, vy: 0, w: 0, e: 0.18, mu: 0.65, acc: 0, sleep: 0, life: 0 }, o, {
      L, T, m, I: m * (L * L + T * T) / 12,
    });
  }

  // contact sample points: corners, plus points along the long edges so thin limbs can't straddle a corner
  function points(b) {
    const c = Math.cos(b.a), s = Math.sin(b.a), hl = b.L / 2, ht = b.T / 2;
    const out = [];
    const n = Math.max(1, Math.round(b.L / Math.max(b.T, 12)));
    for (let i = 0; i <= n; i++) {
      const u = -hl + (b.L * i) / n;
      for (const v of [-ht, ht]) out.push({ x: b.x + c * u - s * v, y: b.y + s * u + c * v });
    }
    return out;
  }
  function corners(b) {
    const c = Math.cos(b.a), s = Math.sin(b.a), hl = b.L / 2, ht = b.T / 2;
    return [[-hl, -ht], [hl, -ht], [hl, ht], [-hl, ht]].map(([u, v]) => [b.x + c * u - s * v, b.y + s * u + c * v]);
  }
  function contains(b, x, y, pad = 0) {
    const c = Math.cos(b.a), s = Math.sin(b.a), dx = x - b.x, dy = y - b.y;
    const u = dx * c + dy * s, v = -dx * s + dy * c;
    return Math.abs(u) <= b.L / 2 + pad && Math.abs(v) <= b.T / 2 + pad;
  }
  // axis-aligned extent
  function extent(b) {
    const c = Math.abs(Math.cos(b.a)), s = Math.abs(Math.sin(b.a));
    return { hw: (b.L * c + b.T * s) / 2, hh: (b.L * s + b.T * c) / 2 };
  }

  // penetration of a point into the world: { d, nx, ny } or null
  function probe(room, panes, x, y) {
    const cx = Math.floor(x / SUB), cy = Math.floor(y / SUB);
    if (room.collCell(cx, cy)) {
      let best = null;
      const consider = (d, nx, ny) => { if (!best || d < best.d) best = { d, nx, ny }; };
      if (!room.collCell(cx, cy - 1)) consider(y - cy * SUB, 0, -1);
      if (!room.collCell(cx - 1, cy)) consider(x - cx * SUB, -1, 0);
      if (!room.collCell(cx + 1, cy)) consider((cx + 1) * SUB - x, 1, 0);
      if (!room.collCell(cx, cy + 1)) consider((cy + 1) * SUB - y, 0, 1);
      return best || { d: y - cy * SUB + 1, nx: 0, ny: -1 };
    }
    if (panes) for (const g of panes) {
      if (g.broken || x < g.x || x > g.x + g.w || y < g.y || y > g.y + g.h) continue;
      const l = x - g.x, r = g.x + g.w - x;
      return l < r ? { d: l, nx: -1, ny: 0 } : { d: r, nx: 1, ny: 0 };
    }
    return null;
  }

  function applyImpulse(b, rx, ry, jx, jy) {
    b.vx += jx / b.m; b.vy += jy / b.m;
    b.w += (rx * jy - ry * jx) / b.I;
  }
  // impulse from outside (bullets, kicks): point (x, y), impulse (jx, jy)
  function impulse(b, x, y, jx, jy) {
    applyImpulse(b, x - b.x, y - b.y, jx, jy);
    b.sleep = 0;
  }
  function blast(b, x, y, R, f) {
    const d = dist(b.x, b.y, x, y);
    if (d > R) return;
    const k = (1 - d / R) * f * b.m, a = Math.atan2(b.y - y, b.x - x);
    b.vx += Math.cos(a) * k / b.m; b.vy += (Math.sin(a) * k - 250 * b.m) / b.m;
    b.w += rand(-14, 14) * (1 - d / R);
    b.sleep = 0;
  }

  function resolve(b, px, py, c) {
    const rx = px - b.x, ry = py - b.y;
    // push out of the surface (shared between simultaneous contacts)
    b.x += c.nx * c.d * 0.5; b.y += c.ny * c.d * 0.5;
    let vpx = b.vx - b.w * ry, vpy = b.vy + b.w * rx;
    const vn = vpx * c.nx + vpy * c.ny;
    if (vn >= 0) return false;
    const e = vn < -140 ? b.e : 0;
    const rn = rx * c.ny - ry * c.nx;
    const j = -(1 + e) * vn / (1 / b.m + rn * rn / b.I);
    applyImpulse(b, rx, ry, c.nx * j, c.ny * j);
    // Coulomb friction along the surface
    vpx = b.vx - b.w * ry; vpy = b.vy + b.w * rx;
    const tx = -c.ny, ty = c.nx;
    const vt = vpx * tx + vpy * ty;
    const rt = rx * ty - ry * tx;
    let jt = -vt / (1 / b.m + rt * rt / b.I);
    jt = clamp(jt, -b.mu * j, b.mu * j);
    applyImpulse(b, rx, ry, tx * jt, ty * jt);
    return -vn;
  }

  // one fixed substep for one box: gravity, integrate, resolve against the world
  function substep(b, room, panes, plats) {
    const before = points(b);
    b.vy += G * H;
    b.vx *= 0.9995; b.vy *= 0.9995; b.w *= 0.996;
    b.x += b.vx * H; b.y += b.vy * H; b.a += b.w * H;
    let touching = false;
    for (let it = 0; it < 3; it++) {
      const pts = points(b);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        let c = probe(room, panes, p.x, p.y);
        if (!c && plats) {
          // one-way platforms only catch points coming down onto them
          for (const pl of plats) {
            if (pl.crate === b || p.x < pl.x1 || p.x > pl.x2) continue;
            if (before[i].y <= pl.y + 1 && p.y > pl.y && p.y < pl.y + 14) { c = { d: p.y - pl.y, nx: 0, ny: -1 }; break; }
          }
        }
        if (c) { touching = true; const v = resolve(b, p.x, p.y, c); if (v) b.hit = Math.max(b.hit, v); }
      }
    }
    // rolling resistance: blocks on the ground stop rocking instead of teetering forever
    if (touching) { b.w *= 0.94; if (Math.abs(b.vx) < 25) b.vx *= 0.9; }
  }

  // advance every box together so stacked boxes are resolved against each other every substep.
  // Each box gets b.hit = the hardest impact speed this frame (for sounds).
  let accAll = 0;
  function stepAll(list, dt, room, panes, plats) {
    for (const b of list) { b.life += dt; b.hit = 0; b.x0 = b.x; b.y0 = b.y; b.a0 = b.a; }
    accAll = Math.min(accAll + dt, H * 8);
    let n = 0;
    while (accAll >= H && n < 8) {
      accAll -= H; n++;
      for (const b of list) if (b.sleep <= 0.5) substep(b, room, panes, plats);
      separate(list);
    }
    for (const b of list) {
      if (b.y > room.h + 400) { b.sleep = 9; continue; }
      // asleep once it has barely moved this frame (works for boxes resting on other boxes too)
      const moved = Math.abs(b.x - b.x0) + Math.abs(b.y - b.y0) + Math.abs(b.a - b.a0) * b.L * 0.5;
      const slow = moved < 0.7 * dt * 60 && Math.abs(b.w) < 1.5;
      b.sleep = slow ? b.sleep + dt : Math.min(b.sleep, 0);
      if (b.sleep > 0.5) { b.vx = 0; b.vy = 0; b.w = 0; }
    }
  }

  // boxes push each other apart: each box is a row of circles along its axis
  function circles(b) {
    const n = Math.max(1, Math.round(b.L / b.T)), out = [], c = Math.cos(b.a), s = Math.sin(b.a);
    const r = Math.min(b.T, b.L) / 2 * 0.95;
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : -b.L / 2 + r + (b.L - 2 * r) * i / (n - 1);
      out.push([b.x + c * u, b.y + s * u, r]);
    }
    return out;
  }
  function separate(list) {
    for (let i = 0; i < list.length; i++) {
      const A = list[i], ea = extent(A);
      for (let j = i + 1; j < list.length; j++) {
        const B = list[j];
        if (A.sleep > 0.5 && B.sleep > 0.5) continue;
        const eb = extent(B);
        if (Math.abs(A.x - B.x) > ea.hw + eb.hw || Math.abs(A.y - B.y) > ea.hh + eb.hh) continue;
        for (const ca of circles(A)) for (const cb of circles(B)) {
          const dx = cb[0] - ca[0], dy = cb[1] - ca[1], d = Math.hypot(dx, dy), min = ca[2] + cb[2];
          if (d >= min || d < 0.001) continue;
          const nx = dx / d, ny = dy / d, over = min - d;
          // a sleeping box is treated as immovable, so piles don't shove each other into the floor
          const wa = A.sleep > 0.5 ? 0 : B.sleep > 0.5 ? 1 : B.m / (A.m + B.m), wb = 1 - wa;
          A.x -= nx * over * wa * 0.6; A.y -= ny * over * wa * 0.6;
          B.x += nx * over * wb * 0.6; B.y += ny * over * wb * 0.6;
          // inelastic exchange along the contact normal
          const px = ca[0] + nx * ca[2], py = ca[1] + ny * ca[2];
          const va = [A.vx - A.w * (py - A.y), A.vy + A.w * (px - A.x)], vb = [B.vx - B.w * (py - B.y), B.vy + B.w * (px - B.x)];
          const vn = (vb[0] - va[0]) * nx + (vb[1] - va[1]) * ny;
          if (vn < -4) {
            const jn = -vn / (1 / A.m + 1 / B.m) * 0.9;
            applyImpulse(A, px - A.x, py - A.y, -nx * jn, -ny * jn);
            applyImpulse(B, px - B.x, py - B.y, nx * jn, ny * jn);
            // friction between the two boxes so piles hold together
            const tx = -ny, ty = nx;
            const vt = (vb[0] - va[0]) * tx + (vb[1] - va[1]) * ty;
            const jt = clamp(-vt / (1 / A.m + 1 / B.m) * 0.5, -0.6 * jn, 0.6 * jn);
            applyImpulse(A, px - A.x, py - A.y, -tx * jt, -ty * jt);
            applyImpulse(B, px - B.x, py - B.y, tx * jt, ty * jt);
            if (jn / Math.min(A.m, B.m) > 60) { A.sleep = 0; B.sleep = 0; }
          }
        }
      }
    }
  }

  return { make, stepAll, impulse, blast, contains, corners, extent };
})();
