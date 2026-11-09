'use strict';
/* =========================================================================
   Effects on the gameplay plane: sparks, dust, smoke, glass shards, chips,
   shell casings, muzzle flashes, shock rings and floating style text.
   ========================================================================= */

const Fx = (() => {
  let parts = [], casings = [], flashes = [], rings = [], texts = [];
  const MAX = 900;

  function clear() { parts = []; casings = []; flashes = []; rings = []; texts = []; }

  function add(p) { if (parts.length < MAX) parts.push(p); }

  function sparks(x, y, ang, n = 6, col = '#ffd27a', spd = 420) {
    for (let i = 0; i < n; i++) {
      const a = ang + rand(-0.8, 0.8), v = rand(0.3, 1) * spd;
      add({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.12, 0.3), t: 0, col, g: 900, w: rand(1.2, 2.2) });
    }
  }
  function dust(x, y, n = 6, col = '#c9c9cf', spread = 1) {
    for (let i = 0; i < n; i++) {
      add({ k: 'dust', x: x + rand(-6, 6), y: y + rand(-4, 2), vx: rand(-80, 80) * spread, vy: rand(-90, -10) * spread, life: rand(0.4, 0.9), t: 0, col, r: rand(4, 9), g: -30 });
    }
  }
  function chips(x, y, vx, vy, col, n = 8) {
    for (let i = 0; i < n; i++) {
      add({ k: 'chip', x, y, vx: vx * rand(0.1, 0.5) + rand(-160, 160), vy: vy * rand(0.1, 0.5) + rand(-260, 40), life: rand(0.5, 1.3), t: 0, col, s: rand(2.5, 5), rot: rand(0, TAU), vr: rand(-14, 14), g: 1500, bounce: true });
    }
  }
  function shards(x, y, h, vx) {
    for (let i = 0; i < 26; i++) {
      add({ k: 'shard', x: x + rand(-3, 3), y: y + rand(0, h), vx: vx * rand(0.15, 0.6) + rand(-120, 120), vy: rand(-220, 60), life: rand(0.8, 1.8), t: 0, s: rand(3, 9), rot: rand(0, TAU), vr: rand(-12, 12), g: 1300, bounce: true });
    }
  }
  function smoke(x, y, n = 10, col = '#9b9ba3', big = 1) {
    for (let i = 0; i < n; i++) {
      add({ k: 'smoke', x: x + rand(-14, 14) * big, y: y + rand(-14, 14) * big, vx: rand(-60, 60) * big, vy: rand(-120, -20) * big, life: rand(0.8, 1.8), t: 0, col, r: rand(10, 24) * big, g: -40 });
    }
  }
  function fire(x, y, n = 18) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), v = rand(80, 520);
      add({ k: 'fire', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 100, life: rand(0.25, 0.6), t: 0, r: rand(8, 20), g: -200 });
    }
  }
  function trail(x, y, col) { add({ k: 'dust', x, y, vx: rand(-15, 15), vy: rand(-30, -5), life: 0.35, t: 0, col, r: rand(3, 6), g: 0 }); }

  // A layered, toon-style blast that reads on white rooms: a white flash core, solid fireball puffs
  // cooling from white to yellow to orange to soot, two shockwave rings, a dust wave along the floor,
  // hot debris streaks, drifting embers and a slow smoke column.
  function explosion(x, y, R, groundY) {
    add({ k: 'flash', x, y, life: 0.16, t: 0, r: R * 1.1 });
    for (let i = 0; i < 16; i++) {
      const a = rand(0, TAU), d = rand(0, R * 0.38);
      add({ k: 'puff', x: x + Math.cos(a) * d * 0.4, y: y + Math.sin(a) * d * 0.3, vx: Math.cos(a) * d * 3.2, vy: Math.sin(a) * d * 2.4 - rand(40, 160), life: rand(0.45, 0.8), t: rand(-0.06, 0), r: rand(0.16, 0.3) * R, g: -120 });
    }
    rings.push({ x, y, r: R * 1.15, col: '#ffffff', w: 14, t: 0, life: 0.32, edge: true });
    rings.push({ x, y, r: R * 1.5, col: '#ffb347', w: 5, t: -0.06, life: 0.5 });
    for (let i = 0; i < 26; i++) {
      const a = rand(-Math.PI, 0) + (Math.random() < 0.25 ? Math.PI : 0), v = rand(350, 950);
      add({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.25, 0.6), t: 0, col: Math.random() < 0.5 ? '#ffd27a' : '#ff8a3d', g: 1100, w: rand(1.6, 3) });
    }
    for (let i = 0; i < 18; i++) add({ k: 'ember', x: x + rand(-R * 0.4, R * 0.4), y: y + rand(-R * 0.3, R * 0.2), vx: rand(-60, 60), vy: rand(-160, -40), life: rand(0.8, 1.8), t: 0, r: rand(1.5, 3), g: -20 });
    for (let i = 0; i < 14; i++) add({ k: 'soot', x: x + rand(-R * 0.3, R * 0.3), y: y + rand(-R * 0.3, R * 0.1), vx: rand(-40, 40), vy: rand(-120, -50), life: rand(1.6, 2.8), t: rand(-0.35, -0.1), r: rand(0.14, 0.26) * R, g: -15 });
    if (groundY != null && groundY - y < R) {
      for (let i = 0; i < 22; i++) {
        const dir = i % 2 ? 1 : -1;
        add({ k: 'dust', x: x + dir * rand(0, 20), y: groundY - rand(2, 10), vx: dir * rand(250, 620), vy: rand(-40, -5), life: rand(0.5, 0.9), t: 0, col: '#c9c9cf', r: rand(6, 13), g: 0 });
      }
    }
  }

  function casing(x, y, facing, col = '#d9b25c') {
    casings.push({ x, y, vx: -facing * rand(90, 190), vy: rand(-300, -180), rot: rand(0, TAU), vr: rand(-22, 22), col, bounces: 0, sleep: false });
    if (casings.length > 140) casings.shift();
  }
  function muzzle(x, y, ang, big = 1) {
    flashes.push({ x, y, ang, t: 0, life: 0.06 * big + 0.03, big });
  }
  function ring(x, y, r, col = '#ffffff', w = 4, life = 0.4) { rings.push({ x, y, r, col, w, t: 0, life }); }
  function text(x, y, str, col = '#1d2130', size = 22, sub = '') {
    // stack popups that land on top of each other
    for (let i = 0; i < 4; i++) {
      if (!texts.some(t => t.t < 0.6 && Math.abs(t.x - x) < 110 && Math.abs(t.y - y) < 30)) break;
      y -= 34;
    }
    texts.push({ x, y, str, col, size, sub, t: 0, life: 1.1 });
    if (texts.length > 12) texts.shift();
  }

  function update(dt, room, panes) {
    for (const p of parts) {
      p.t += dt;
      if (p.t < 0) continue;
      p.vy += (p.g || 0) * dt;
      if (p.k === 'smoke' || p.k === 'dust' || p.k === 'soot' || p.k === 'puff') { p.vx *= 1 - 3 * dt; p.vy *= 1 - 2 * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.rot != null) p.rot += p.vr * dt;
      if (p.bounce && room.solidAt(p.x, p.y)) { p.y -= p.vy * dt; p.vy *= -0.3; p.vx *= 0.6; p.vr *= 0.5; }
    }
    parts = parts.filter(p => p.t < p.life);
    for (const c of casings) {
      if (c.sleep) continue;
      c.vy += 1500 * dt;
      const nx = c.x + c.vx * dt, ny = c.y + c.vy * dt;
      c.rot += c.vr * dt;
      if (room.solidAt(nx, ny + 2, panes) || room.platforms.some(p => nx > p.x1 && nx < p.x2 && c.y + 2 <= p.y && ny + 2 >= p.y)) {
        if (c.vy > 0 && Math.abs(c.vy) > Math.abs(c.vx)) { c.vy *= -0.32; c.vx *= 0.6; } else { c.vx *= -0.4; }
        c.vr *= 0.5;
        if (c.bounces++ === 0) Sfx.shell();
        if (Math.abs(c.vy) < 40 && Math.abs(c.vx) < 30) { c.sleep = true; c.rot = Math.round(c.rot / Math.PI) * Math.PI; }
      } else { c.x = nx; c.y = ny; }
    }
    for (const f of flashes) f.t += dt;
    flashes = flashes.filter(f => f.t < f.life);
    for (const r of rings) r.t += dt;
    rings = rings.filter(r => r.t < r.life);
    for (const t of texts) t.t += dt;
    texts = texts.filter(t => t.t < t.life);
  }

  function draw(ctx, dark) {
    // casings
    for (const c of casings) {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
      ctx.fillStyle = c.col; ctx.fillRect(-3, -1.3, 6, 2.6);
      ctx.restore();
    }
    // soot first so the fire sits on top of it
    for (const p of parts) {
      if (p.k !== 'soot' || p.t < 0) continue;
      const k = p.t / p.life;
      ctx.fillStyle = dark ? `rgba(40,42,52,${0.55 * (1 - k)})` : `rgba(120,120,130,${0.45 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.7 + k * 0.9), 0, TAU); ctx.fill();
    }
    for (const p of parts) {
      if (p.t < 0) continue;
      const a = 1 - p.t / p.life;
      switch (p.k) {
        case 'flash': {
          const k = p.t / p.life;
          ctx.fillStyle = `rgba(255,255,255,${0.95 * (1 - k)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.35 + 0.65 * easeOut(k)), 0, TAU); ctx.fill();
          ctx.strokeStyle = `rgba(255,210,120,${0.9 * (1 - k)})`; ctx.lineWidth = 3;
          ctx.stroke();
          break;
        }
        case 'puff': {
          // solid toon fireball puff cooling over its life
          const k = p.t / p.life;
          const col = k < 0.1 ? '#ffffff' : k < 0.26 ? '#ffe680' : k < 0.46 ? '#ffb020' : k < 0.68 ? '#ff6420' : '#5c5c66';
          const rr = p.r * (k < 0.25 ? 0.6 + k * 2.4 : 1.2 - (k - 0.25) * 1.1);
          if (rr <= 0) break;
          ctx.fillStyle = col; ctx.globalAlpha = k > 0.75 ? (1 - k) * 4 : 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, TAU); ctx.fill();
          if (k > 0.1 && k < 0.7) { ctx.strokeStyle = 'rgba(190,70,20,0.45)'; ctx.lineWidth = 2; ctx.stroke(); }
          if (k < 0.6) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(p.x - rr * 0.25, p.y - rr * 0.3, rr * 0.35, 0, TAU); ctx.fill(); }
          ctx.globalAlpha = 1;
          break;
        }
        case 'ember':
          ctx.fillStyle = `rgba(255,${180 + Math.floor(60 * a)},90,${a})`;
          ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
          break;
        case 'soot': break;
        case 'spark':
          ctx.strokeStyle = rgba(p.col, a); ctx.lineWidth = p.w;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025); ctx.stroke();
          break;
        case 'dust': case 'smoke':
          ctx.fillStyle = rgba(p.col, a * (p.k === 'smoke' ? 0.45 : 0.35));
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + p.t / p.life * 0.8), 0, TAU); ctx.fill();
          break;
        case 'fire': {
          const col = p.t / p.life < 0.3 ? '#fff2b0' : p.t / p.life < 0.6 ? '#ffb347' : '#ff6a3d';
          Glow.draw(ctx, col, p.x, p.y, p.r * 1.8, a);
          break;
        }
        case 'chip':
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.globalAlpha = Math.min(1, a * 2);
          ctx.fillStyle = p.col; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s);
          ctx.restore(); ctx.globalAlpha = 1;
          break;
        case 'shard':
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.globalAlpha = Math.min(1, a * 2);
          ctx.fillStyle = dark ? 'rgba(170,215,255,0.6)' : 'rgba(150,200,235,0.85)';
          ctx.beginPath(); ctx.moveTo(-p.s / 2, -p.s / 3); ctx.lineTo(p.s / 2, 0); ctx.lineTo(-p.s / 4, p.s / 2); ctx.fill();
          ctx.restore(); ctx.globalAlpha = 1;
          break;
        default: break;
      }
    }
    for (const r of rings) {
      const k = r.t / r.life;
      if (k < 0) continue;
      if (r.edge) { ctx.strokeStyle = `rgba(90,90,100,${(1 - k) * 0.5})`; ctx.lineWidth = r.w * (1 - k) + 3; ctx.beginPath(); ctx.arc(r.x, r.y, r.r * easeOut(k), 0, TAU); ctx.stroke(); }
      ctx.strokeStyle = rgba(r.col, (1 - k) * 0.85); ctx.lineWidth = r.w * (1 - k) + 0.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r * easeOut(k), 0, TAU); ctx.stroke();
    }
    for (const f of flashes) {
      const k = 1 - f.t / f.life;
      Glow.draw(ctx, '#ffe9a8', f.x, f.y, 28 * f.big * k + 6, 0.9 * k);
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.ang);
      ctx.fillStyle = rgba('#fff6d8', k);
      ctx.beginPath(); ctx.moveTo(0, -5 * f.big); ctx.lineTo(22 * f.big * k + 6, 0); ctx.lineTo(0, 5 * f.big); ctx.fill();
      ctx.fillStyle = rgba('#ffc861', k * 0.9);
      ctx.beginPath(); ctx.moveTo(2, -9 * f.big * k); ctx.lineTo(8, 0); ctx.lineTo(2, 9 * f.big * k); ctx.fill();
      ctx.restore();
    }
  }

  // floating style text, drawn last and unscaled by slow motion
  function drawTexts(ctx, zoom) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of texts) {
      const k = t.t / t.life;
      const pop = k < 0.12 ? easeOutBack(k / 0.12) : 1;
      const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      const y = t.y - 40 * easeOut(k);
      ctx.globalAlpha = a;
      const s = t.size * pop / zoom * Math.max(1, zoom * 0.9);
      ctx.font = '900 ' + s.toFixed(1) + 'px Rubik, sans-serif';
      ctx.lineWidth = s * 0.22; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineJoin = 'round';
      ctx.strokeText(t.str, t.x, y);
      ctx.fillStyle = t.col; ctx.fillText(t.str, t.x, y);
      if (t.sub) {
        ctx.font = '800 ' + (s * 0.55).toFixed(1) + 'px Rubik, sans-serif';
        ctx.strokeText(t.sub, t.x, y + s * 0.8);
        ctx.fillStyle = '#1d2130'; ctx.fillText(t.sub, t.x, y + s * 0.8);
      }
    }
    ctx.globalAlpha = 1;
  }

  return { explosion, clear, sparks, dust, chips, shards, smoke, fire, trail, casing, muzzle, ring, text, update, draw, drawTexts, get count() { return parts.length; } };
})();
