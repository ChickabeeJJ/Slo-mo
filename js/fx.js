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

  /* --------------------------------------------------------- explosions */
  // Billow textures: soft, lumpy alpha masks built once from overlapping blurred blobs, then tinted
  // per colour on demand and cached. Fire and smoke are made of these, so they read as volume
  // rather than flat circles.
  const masks = [], tinted = new Map();
  function mask(i) {
    if (masks[i]) return masks[i];
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), R = mulberry32(i * 977 + 13);
    for (let k = 0; k < 18; k++) {
      const a = R() * TAU, d = R() * 26, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, r = 18 + R() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    // a little grain so the billow isn't perfectly smooth
    const img = g.getImageData(0, 0, 128, 128), d = img.data;
    for (let q = 3; q < d.length; q += 4) d[q] = Math.min(255, d[q] * (0.82 + R() * 0.36));
    g.putImageData(img, 0, 0);
    return (masks[i] = c);
  }
  function sprite(i, col) {
    const key = i + col;
    let c = tinted.get(key);
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.drawImage(mask(i), 0, 0);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, 128, 128);
    tinted.set(key, c);
    return c;
  }
  // colour temperature of burning gas, hottest first
  const HEAT = ['#fffdf2', '#fff3c4', '#ffe08a', '#ffc24d', '#ff9a2e', '#f2701f', '#d24c17', '#9c3415', '#5e2a1e', '#3b2b27'];
  const SMOKE = ['#2b2b30', '#38383e', '#47474d', '#57575d', '#6a6a70', '#7e7e84'];

  function explosion(x, y, R, groundY) {
    // white-hot flash and heat bloom
    add({ k: 'xflash', x, y, life: 0.22, t: 0, r: R * 1.6 });
    // the fireball: billows thrown out fast, then dragged to a halt, cooling and rising
    for (let i = 0; i < 26; i++) {
      const a = rand(0, TAU), sp = rand(0.6, 2.6) * R;
      add({ k: 'xfire', x: x + rand(-6, 6), y: y + rand(-6, 6), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 - rand(30, 120), drag: 5.5, g: -160,
        life: rand(0.45, 0.95), t: rand(-0.05, 0), r: rand(0.22, 0.42) * R, grow: rand(0.6, 1.2), rot: rand(0, TAU), vr: rand(-2, 2), m: i % 6 });
    }
    // heavy smoke that takes over from the fire and rolls upward
    for (let i = 0; i < 22; i++) {
      const a = rand(0, TAU), sp = rand(0.2, 1.1) * R;
      add({ k: 'xsmoke', x: x + Math.cos(a) * R * 0.2, y: y + Math.sin(a) * R * 0.15, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - rand(40, 110), drag: 2.2, g: -55,
        life: rand(1.6, 2.8), t: rand(-0.3, -0.05), r: rand(0.3, 0.5) * R, grow: rand(1.1, 1.9), rot: rand(0, TAU), vr: rand(-0.6, 0.6), m: (i + 3) % 6, a0: rand(0.42, 0.62) });
    }
    // burning debris arcing out on smoke trails
    for (let i = 0; i < 12; i++) {
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05), sp = rand(380, 900);
      add({ k: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 1500, life: rand(0.8, 1.5), t: 0, s: rand(2.5, 6), rot: rand(0, TAU), vr: rand(-18, 18), bounce: true, hot: Math.random() < 0.6 });
    }
    // sparks: thin, fast, motion-blurred
    for (let i = 0; i < 40; i++) {
      const a = rand(0, TAU), v = rand(500, 1400);
      add({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200, life: rand(0.18, 0.55), t: 0, col: Math.random() < 0.6 ? '#fff0b8' : '#ffb347', g: 1300, w: rand(1.2, 2.4) });
    }
    // embers that drift up long after the bang
    for (let i = 0; i < 24; i++) add({ k: 'ember', x: x + rand(-R * 0.5, R * 0.5), y: y + rand(-R * 0.4, R * 0.2), vx: rand(-80, 80), vy: rand(-220, -60), life: rand(1.2, 2.6), t: rand(-0.4, 0), r: rand(1.2, 2.6), g: -30, drag: 0.8 });
    // a fast, faint pressure ring
    rings.push({ x, y, r: R * 1.9, col: '#ffffff', w: 4, t: 0, life: 0.22, soft: true });
    // dust thrown along the floor
    if (groundY != null && groundY - y < R * 1.2) {
      for (let i = 0; i < 18; i++) {
        const dir = i % 2 ? 1 : -1;
        add({ k: 'xsmoke', x: x + dir * rand(0, 24), y: groundY - rand(4, 14), vx: dir * rand(300, 700), vy: rand(-40, -10), drag: 3.5, g: -10,
          life: rand(0.9, 1.6), t: 0, r: rand(0.14, 0.24) * R, grow: rand(1.4, 2.2), rot: rand(0, TAU), vr: rand(-1, 1), m: i % 6, a0: 0.5, dust: true });
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
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
      if (p.k === 'debris' && p.hot && Math.random() < 0.7 && parts.length < MAX) parts.push({ k: 'xsmoke', x: p.x, y: p.y, vx: rand(-15, 15), vy: rand(-30, -10), drag: 1, g: -20, life: rand(0.5, 0.9), t: 0, r: rand(4, 8), grow: 2.2, rot: rand(0, TAU), vr: 0, m: (Math.random() * 6) | 0, a0: 0.5 });
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
    // smoke first (under everything), then the fireball
    for (const p of parts) {
      if (p.k !== 'xsmoke' || p.t < 0) continue;
      const k = p.t / p.life;
      const col = p.dust ? (dark ? '#4a4f5c' : '#cfc9bd') : SMOKE[Math.min(SMOKE.length - 1, Math.floor(k * SMOKE.length))];
      const r = p.r * (1 + p.grow * easeOut(k));
      ctx.globalAlpha = p.a0 * (k < 0.12 ? k / 0.12 : 1) * (1 - k) * (dark ? 0.9 : 1);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot + p.vr * p.t);
      ctx.drawImage(sprite(p.m, col), -r, -r, r * 2, r * 2);
      ctx.restore();
    }
    for (const p of parts) {
      if (p.k !== 'xfire' || p.t < 0) continue;
      const k = p.t / p.life;
      const col = HEAT[Math.min(HEAT.length - 1, Math.floor(Math.pow(k, 0.8) * HEAT.length))];
      const r = p.r * (0.55 + p.grow * easeOut(Math.min(1, k * 1.6)));
      ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot + p.vr * p.t);
      ctx.drawImage(sprite(p.m, col), -r, -r, r * 2, r * 2);
      if (k < 0.35) { ctx.globalAlpha = (0.35 - k) / 0.35 * 0.9; ctx.drawImage(sprite(p.m, '#ffffff'), -r * 0.55, -r * 0.55, r * 1.1, r * 1.1); }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
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
        case 'xflash': {
          const k = p.t / p.life;
          Glow.draw(ctx, '#fff6dc', p.x, p.y, p.r * (0.6 + 0.6 * k), (1 - k) * 0.95);
          Glow.draw(ctx, '#ffffff', p.x, p.y, p.r * 0.35, (1 - k));
          break;
        }
        case 'xfire': case 'xsmoke': break;
        case 'debris':
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.hot ? (p.t / p.life < 0.5 ? '#ffb347' : '#5a3a2a') : (dark ? '#20232c' : '#3a3d48');
          ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.7);
          ctx.restore();
          if (p.hot && p.t / p.life < 0.5) Glow.draw(ctx, '#ff9a2e', p.x, p.y, 7, 0.6);
          break;
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
          ctx.strokeStyle = rgba(p.col, a); ctx.lineWidth = p.w; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.stroke();
          ctx.fillStyle = `rgba(255,255,240,${a})`; ctx.fillRect(p.x - p.w / 2, p.y - p.w / 2, p.w, p.w);
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
      if (r.soft) { ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.35})`; ctx.lineWidth = r.w + 6 * (1 - k); ctx.beginPath(); ctx.arc(r.x, r.y, r.r * easeOut(k), 0, TAU); ctx.stroke(); continue; }
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
