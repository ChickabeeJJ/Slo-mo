'use strict';
/* =========================================================================
   Title sequence: the most cinematic thing in the game.

   A canvas laid over the home screen plays a bullet-time shot on a loop:
     muzzle flash off-screen  >  a round streaks in  >  TIME DILATES  >
     it crawls through S, L, O, punching each letter (the letter recoils on
     a spring and sheds shards that hang in the air)  >  it punches through
     the MO block in a burst of cyan glass  >  time SNAPS back and all the
     debris that was hanging suddenly flies, falls and fades.
   While time is slow: letterbox bars slide in, the logo splits into cyan /
   red ghosts, the round leaves expanding pressure rings and an anamorphic
   lens streak follows it.

   Everything runs on a single "film time" scale (fx), so the springs, the
   shards and the rings all slow down and speed up together.
   ========================================================================= */

const TitleFx = (() => {
  let cv, ctx, home, title, letters = [], mo, raf = 0, last = 0, dpr = 1;
  let T = -1.7;                  // film clock for the loop; starts negative for the intro
  let fx = 1;                    // time scale of the effects layer (1 = real time, ~0.07 = bullet time)
  let parts = [], rings = [], flashes = [];
  let bullet = null;
  let springs = [];              // one per letter + one for MO: { x, y, r, vx, vy, vr }
  let geo = null;                // cached rectangles for this cycle
  let hitDone = [], introDone = [], reduced = false;
  const LOOP = 10.5;             // seconds between shots
  const CY = '69,220,255';

  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = t => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

  function init() {
    home = document.getElementById('home');
    title = home && home.querySelector('.title');
    if (!title) return;
    reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    cv = document.createElement('canvas');
    cv.id = 'titleFx';
    home.appendChild(cv);
    ctx = cv.getContext('2d');
    letters = [...title.querySelectorAll('.t1 span')];
    mo = title.querySelector('.t2');
    springs = [...letters, mo].map(() => ({ x: 0, y: 0, r: 0, vx: 0, vy: 0, vr: 0 }));
    resize();
    window.addEventListener('resize', resize);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function resize() {
    if (!cv) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
    geo = null;
  }

  // where the letters are right now, in screen pixels (measured without the spring offsets)
  function measure() {
    const els = [...letters, mo];
    const keep = els.map(e => e.style.transform);
    els.forEach(e => { e.style.transform = ''; });
    const rs = els.map(e => e.getBoundingClientRect());
    els.forEach((e, i) => { e.style.transform = keep[i]; });
    const all = title.getBoundingClientRect();
    const k = rs[0].height / 65 || 1;                           // scale of everything relative to a 72px logo
    geo = { rs, k, y: rs[0].top + rs[0].height * 0.52, x0: all.left - 420 * k, xIn: rs[0].left - 34 * k, xOut: rs[rs.length - 1].right + 30 * k, xEnd: innerWidth + 200, left: all.left, right: all.right, top: all.top, bottom: all.bottom };
  }

  /* ----------------------------------------------------------- spawners */
  function shards(x, y, n, col, speed, dirx) {
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI, Math.PI), s = rand(0.25, 1) * speed;
      parts.push({
        x: x + rand(-6, 6), y: y + rand(-14, 14), vx: Math.cos(a) * s * 0.7 + dirx * speed * rand(0.3, 1.1), vy: Math.sin(a) * s - speed * 0.25,
        rot: rand(0, 6.28), vr: rand(-9, 9), w: rand(3, 11) * geo.k, h: rand(2, 6) * geo.k, life: rand(1.3, 2.3), t: 0, col, tri: Math.random() < 0.6,
      });
    }
  }
  function sparks(x, y, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = rand(-0.9, 0.9) + (Math.random() < 0.3 ? Math.PI : 0), s = rand(0.4, 1) * speed;
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, spark: true, life: rand(0.5, 1.1), t: 0, col: Math.random() < 0.5 ? '#ffffff' : '#9fe9ff', len: rand(8, 22) * geo.k });
    }
  }
  const ring = (x, y, r0, r1, life, w, squash = 1) => rings.push({ x, y, r0, r1, life, t: 0, w, squash });
  const flash = (x, y, r, life, col = CY) => flashes.push({ x, y, r, life, t: 0, col });
  function kick(i, x, y, r) { const s = springs[i]; s.vx += x; s.vy += y; s.vr += r; }

  /* ------------------------------------------------------------ timeline */
  // Film time T runs at real speed; the effects layer runs at `fx`. Shot timing (seconds):
  const FIRE = 0, SLOW_AT = 0.16, CRAWL = 3.1, SNAP = SLOW_AT + CRAWL, EXIT = SNAP + 0.3;
  function bulletX(t) {
    const g = geo;
    if (t < SLOW_AT) return g.x0 + (g.xIn - g.x0) * (t / SLOW_AT);                      // streak in
    if (t < SNAP) { const u = (t - SLOW_AT) / CRAWL; return g.xIn + (g.xOut - g.xIn) * (u * 0.82 + 0.18 * u * u); }   // the crawl
    return g.xOut + (g.xEnd - g.xOut) * Math.min(1, (t - SNAP) / 0.3);                  // and gone
  }

  function step(dt) {
    const prevT = T;
    T += dt;
    if (T >= LOOP) { T -= LOOP; hitDone = []; geo = null; }
    if (!geo || T < 0) measure();                 // during the intro the letters are still flying in, so re-measure
    const g = geo, k = g.k;

    // ---- intro: sparks and dust as each letter (CSS) slams in, then the MO block
    if (prevT < 0) {
      const it = T + 1.7;
      letters.forEach((el, i) => {
        if (!introDone[i] && it > 0.34 + i * 0.09) { introDone[i] = true; const r = g.rs[i]; sparks(r.left + r.width / 2, r.bottom - 6 * k, 9, 260 * k); ring(r.left + r.width / 2, r.bottom - 4 * k, 4 * k, 46 * k, 0.5, 2, 0.3); kick(i, 0, 150, rand(-1, 1)); }
      });
      if (!introDone.mo && it > 1.0) { introDone.mo = true; const r = g.rs[3]; shards(r.left + r.width * 0.5, r.top + r.height / 2, 16, 'rgb(' + CY + ')', 240 * k, -0.5); ring(r.left + r.width / 2, r.top + r.height / 2, 10 * k, 150 * k, 0.7, 3); flash(r.left + r.width / 2, r.top + r.height / 2, 190 * k, 0.4); kick(3, -260, 0, 1.2); }
    }

    // ---- the shot
    let wantFx = 1;
    if (T >= FIRE && T < EXIT) {
      if (prevT < FIRE || !bullet) { bullet = { x: g.x0, px: g.x0, ringAt: 0 }; flash(g.x0 + 60 * k, g.y, 260 * k, 0.28, '255,236,200'); }
      bullet.px = bullet.x; bullet.x = bulletX(T);
      if (T > SLOW_AT && T < SNAP) {
        wantFx = 0.07;
        // pressure rings left hanging in the air behind the round
        if (bullet.x - bullet.ringAt > 34 * k) { bullet.ringAt = bullet.x; ring(bullet.x - 6 * k, g.y, 3 * k, 26 * k, 0.5, 1.6, 0.42); }
      }
      // punch each letter as the nose reaches its middle
      g.rs.forEach((r, i) => {
        const cx = r.left + r.width * (i === 3 ? 0.22 : 0.5);
        if (hitDone[i] || bullet.x < cx) return;
        hitDone[i] = true;
        if (i < 3) { shards(cx, g.y, 13, '#ffffff', 300 * k, 0.9); sparks(cx, g.y, 6, 420 * k); kick(i, 520, -170, rand(2.5, 4.5) * (i % 2 ? -1 : 1)); ring(cx, g.y, 4 * k, 60 * k, 0.45, 2, 0.6); }
        else { shards(cx, g.y, 20, 'rgb(' + CY + ')', 360 * k, 0.9); shards(cx, g.y, 8, '#0a3a48', 260 * k, 0.9); sparks(cx, g.y, 10, 520 * k); kick(3, 640, -90, 2.2); ring(cx, g.y, 6 * k, 120 * k, 0.5, 3, 0.7); flash(cx, g.y, 170 * k, 0.5); }
      });
      // exit wound on the far side of MO, right as time snaps back
      if (!hitDone.exit && T >= SNAP) {
        hitDone.exit = true; const r = g.rs[3], ex = r.right - 4 * k;
        shards(ex, g.y, 26, 'rgb(' + CY + ')', 620 * k, 1.5); sparks(ex, g.y, 16, 900 * k);
        ring(ex, g.y, 10 * k, 260 * k, 0.6, 4); flash(ex, g.y, 320 * k, 0.45, '255,255,255');
        kick(3, 300, 60, -1.6); letters.forEach((_, i) => kick(i, 120, rand(-80, 80), rand(-1.5, 1.5)));
      }
    } else if (bullet && T >= EXIT) bullet = null;

    // the film-time scale eases into bullet time and SNAPS out of it
    fx += (wantFx - fx) * Math.min(1, dt * (wantFx < fx ? 9 : 16));
    const slow = T > SLOW_AT - 0.05 && T < SNAP;
    home.classList.toggle('bullet-time', slow);
    title.classList.toggle('dilated', slow);

    // ---- springs (letters recoil slowly in bullet time, then whip back)
    const sdt = dt * Math.max(fx, 0.12);
    const els = [...letters, mo];
    springs.forEach((s, i) => {
      const K = 260, D = 13;
      s.vx += (-K * s.x - D * s.vx) * sdt; s.vy += (-K * s.y - D * s.vy) * sdt; s.vr += (-K * s.r - D * s.vr) * sdt;
      s.x += s.vx * sdt; s.y += s.vy * sdt; s.r += s.vr * sdt;
      if (T < -0.45) return;                                         // the CSS intro still owns the transform
      const still = Math.abs(s.x) + Math.abs(s.y) < 0.05 && Math.abs(s.r) < 0.002 && Math.abs(s.vx) + Math.abs(s.vy) < 1;
      els[i].style.transform = still ? '' : `translate(${(s.x * k).toFixed(2)}px, ${(s.y * k).toFixed(2)}px) rotate(${(s.r * 4).toFixed(2)}deg)`;
    });

    // ---- particles, rings, flashes on film time
    const fdt = dt * fx;
    for (const p of parts) {
      p.t += fdt + dt * 0.03;                                        // they still age a little while frozen
      p.vy += (p.spark ? 500 : 900) * k * fdt;
      p.vx *= 1 - Math.min(1, (p.spark ? 2.2 : 0.9) * fdt);
      p.x += p.vx * fdt; p.y += p.vy * fdt;
      if (!p.spark) p.rot += p.vr * fdt;
    }
    parts = parts.filter(p => p.t < p.life && p.y < innerHeight + 40);
    for (const r of rings) r.t += fdt + dt * 0.05;
    rings = rings.filter(r => r.t < r.life);
    for (const f of flashes) f.t += dt;
    flashes = flashes.filter(f => f.t < f.life);
  }

  /* --------------------------------------------------------------- draw */
  function draw() {
    const g = geo, k = g.k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalCompositeOperation = 'lighter';
    const slowK = 1 - Math.min(1, (fx - 0.07) / 0.5);              // 1 deep in bullet time

    for (const f of flashes) {
      const a = 1 - f.t / f.life, gr = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      gr.addColorStop(0, `rgba(${f.col},${0.55 * a})`); gr.addColorStop(1, `rgba(${f.col},0)`);
      ctx.fillStyle = gr; ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }
    for (const r of rings) {
      const u = r.t / r.life, rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - u, 3));
      ctx.strokeStyle = `rgba(190,240,255,${0.75 * (1 - u)})`; ctx.lineWidth = r.w * (1 - u * 0.6);
      ctx.beginPath(); ctx.ellipse(r.x, r.y, rad * r.squash, rad, 0, 0, 6.2832); ctx.stroke();
    }
    if (bullet) {
      const x = bullet.x, y = g.y, v = Math.abs(bullet.x - bullet.px);
      const tail = Math.min(520, 26 + v * 9) * k;
      // anamorphic lens streak: a long thin line of light through the round
      if (slowK > 0.05) {
        const lg = ctx.createLinearGradient(x - 420 * k, 0, x + 420 * k, 0);
        lg.addColorStop(0, `rgba(${CY},0)`); lg.addColorStop(0.5, `rgba(${CY},${0.5 * slowK})`); lg.addColorStop(1, `rgba(${CY},0)`);
        ctx.fillStyle = lg; ctx.fillRect(x - 420 * k, y - 1 * k, 840 * k, 2 * k);
        const hg = ctx.createRadialGradient(x, y, 0, x, y, 70 * k);
        hg.addColorStop(0, `rgba(${CY},${0.4 * slowK})`); hg.addColorStop(1, `rgba(${CY},0)`);
        ctx.fillStyle = hg; ctx.fillRect(x - 70 * k, y - 70 * k, 140 * k, 140 * k);
      }
      const tg = ctx.createLinearGradient(x - tail, 0, x, 0);
      tg.addColorStop(0, `rgba(${CY},0)`); tg.addColorStop(0.7, `rgba(${CY},0.55)`); tg.addColorStop(1, 'rgba(255,255,255,0.95)');
      ctx.strokeStyle = tg; ctx.lineWidth = 3 * k; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - tail, y); ctx.lineTo(x, y); ctx.stroke();
      // the round itself: a brass slug with a hot nose, slowly spinning rifling marks in bullet time
      ctx.globalCompositeOperation = 'source-over';
      const L = 17 * k, H = 6.5 * k;
      ctx.fillStyle = '#f3e3b0';
      ctx.beginPath(); ctx.moveTo(x - L, y - H / 2); ctx.lineTo(x - L * 0.3, y - H / 2); ctx.quadraticCurveTo(x + 2 * k, y - H / 2, x + 4 * k, y); ctx.quadraticCurveTo(x + 2 * k, y + H / 2, x - L * 0.3, y + H / 2); ctx.lineTo(x - L, y + H / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(120,90,30,0.55)';
      for (let i = 0; i < 3; i++) { const sx = x - L + ((T * 30 + i * 5) % 11) * k; ctx.fillRect(sx, y - H / 2, 1.3 * k, H); }
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(x - L, y - H / 2, L * 0.9, 1.4 * k);
      ctx.globalCompositeOperation = 'lighter';
    }
    for (const p of parts) {
      const a = Math.min(1, (1 - p.t / p.life) * 2.2);
      if (p.spark) {
        const sp = Math.hypot(p.vx, p.vy) || 1, l = p.len * Math.min(1, sp / 300);
        ctx.strokeStyle = p.col; ctx.globalAlpha = a; ctx.lineWidth = 1.6 * k;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx / sp * l, p.y - p.vy / sp * l); ctx.stroke();
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = a; ctx.fillStyle = p.col;
        ctx.beginPath();
        if (p.tri) { ctx.moveTo(-p.w / 2, p.h / 2); ctx.lineTo(p.w / 2, p.h / 2); ctx.lineTo(p.w * 0.1, -p.h); } else ctx.rect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, 1);      // a glint on one edge
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const showing = !home.classList.contains('hidden') && !document.hidden;
    if (!showing) {
      if (cv.dataset.clear !== '1') { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); cv.dataset.clear = '1'; home.classList.remove('bullet-time'); }
      T = Math.min(T, -0.2) < -0.2 ? T : 0.6 * LOOP;                 // coming back to the menu, the next shot isn't far off
      return;
    }
    cv.dataset.clear = '';
    step(dt);
    draw();
  }

  return { init, get T() { return T; }, set T(v) { T = v; hitDone = []; }, get fx() { return fx; } };
})();
