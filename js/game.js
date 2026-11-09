'use strict';
/* =========================================================================
   Game: rooms, the player, enemies and their AI, bullets, slow motion,
   style scoring, the camera and the render pipeline.
   ========================================================================= */

const Game = (() => {
  // ---- tuning
  const G = 2500, WALK = 250, SPRINT = 425, ACC_G = 3200, ACC_A = 1800, JUMP_V = 840;
  const SLIDE_V = 610, SLIDE_T = 0.5, STAND_H = 92, SLIDE_H = 34;
  const SLOW_SCALE = 0.26;

  let canvas, ctx, dpr = 1, sw = 0, sh = 0;
  const cam = { x: 0, y: 0, zoom: 1, shake: 0, kick: 0, kx: 0, ky: 0, focus: null, focusT: 0 };
  let state = 'menu';           // menu | play | dead | fade | complete
  let mode = 'menu';            // menu | campaign | endless
  let paused = false;
  let level = null, levelIdx = 0, roomIdx = 0, room = null;
  let player = null, enemies = [], bullets = [], pieces = [], corpses = [], pickups = [], crates = [], barrels = [], panes = [], ghosts = [], pendingBooms = [];
  let ts = 1, slowOn = false, focus = 1, forcedT = 0, forcedScale = 1, hitstop = 0, closeCd = 0, heartT = 0, ghostT = 0;
  let clock = 0, roomT = 0, runTime = 0, deathT = 0, fade = null, doorOpen = false, clearT = -1, flash = 0, flashCol = '#ffffff';
  let run = null;               // per-level / per-endless-run stats
  let endless = null;           // { seed, n, revived }
  const input = { left: false, right: false, sprint: false, shoot: false, down: false, mouse: { x: 0, y: 0, on: false }, axis: 0, aimStick: null, touch: false };
  const pressed = new Set();
  let lastKillT = -9, multiCount = 0, menuInset = 0;
  let listeners = {};

  function emit(ev, data) { (listeners[ev] || []).forEach(f => f(data)); }
  function on(ev, f) { (listeners[ev] = listeners[ev] || []).push(f); }

  /* ------------------------------------------------------------ setup */
  function init(c) {
    canvas = c;
    ctx = canvas.getContext('2d');
    resize();
    startMenu();
  }
  function resize() {
    sw = window.innerWidth; sh = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (sw * sh * dpr * dpr > 3.2e6) dpr = Math.max(1, Math.sqrt(3.2e6 / (sw * sh)));
    canvas.width = Math.round(sw * dpr); canvas.height = Math.round(sh * dpr);
    canvas.style.width = sw + 'px'; canvas.style.height = sh + 'px';
  }

  const diff = () => (mode === 'endless' ? clamp(0.2 + endless.n * 0.05, 0, 1) : clamp(levelIdx / (LEVEL_COUNT - 1), 0, 1));

  function newRun() {
    return { score: 0, kills: 0, headshots: 0, deaths: 0, combo: 0, comboT: 0, bestCombo: 0, deflects: 0, time: 0, rooms: 0 };
  }

  // the home screen plays a looping slow-motion shootout behind the menu
  const MENU_MAP = {
    map: [
      '##############################################',
      '#.......l...............l...............l....#',
      '#............................................#',
      '#............................................#',
      '#............................................#',
      '#.P......B..........T................C....D..#',
      '##############################################',
    ],
  };
  let menuT = 0, menuEnemyT = 0;
  function startMenu() {
    mode = 'menu'; state = 'menu'; paused = false;
    level = { name: 'Menu', theme: 0, rooms: [MENU_MAP] };
    room = new Room(MENU_MAP, 0);
    resetRoomEntities();
    run = newRun();
    player.x = 560; player.y = room.h - TILE; player.body = new Body({ x: player.x, y: player.y, color: player.body.color, dark: player.body.dark, shine: player.body.shine, rainbow: player.body.rainbow, hat: Save.data.hat, deadColor: deadCol() });
    menuT = 1.2; menuEnemyT = 0;
    spawnMenuEnemy();
    cam.x = 760; cam.y = room.h / 2; cam.zoom = baseZoom();
    Sfx.setIntensity(0.1);
  }
  function spawnMenuEnemy() {
    const def = ENEMIES[pick(['grunt', 'grunt', 'smg', 'shotgun'])];
    const x = 960 + rand(-20, 50);
    const e = makeChar(x, room.h - TILE, { color: '#e2434b', dark: '#b02a33', deadColor: deadCol(), scale: def.scale });
    e.type = 'menu'; e.def = def; e.hp = 1; e.gun = def.gun; e.facing = -1; e.aim = Math.PI; e.alert = false;
    e.body.gunId = def.gun;
    enemies = [e];
  }

  function startLevel(i) {
    mode = 'campaign'; levelIdx = i; level = getLevel(i);
    run = newRun();
    focus = 1; slowOn = false;
    loadRoom(0);
    state = 'play'; paused = false;
    Platform.gameplayStart();
    Sfx.setMusicPaused(false);
    emit('start');
  }
  function startEndless() {
    mode = 'endless';
    endless = { seed: (Date.now() % 100000) | 0, n: 0, revived: false };
    run = newRun();
    level = { name: 'Endless', theme: 0, rooms: [] };
    focus = 1; slowOn = false;
    loadRoom(0);
    state = 'play'; paused = false;
    Platform.gameplayStart();
    Sfx.setMusicPaused(false);
    emit('start');
  }

  function roomDef(i) { return mode === 'endless' ? endlessRoom(endless.seed, i) : level.rooms[i]; }

  function loadRoom(i) {
    roomIdx = i;
    const def = roomDef(i);
    room = new Room(def, mode === 'endless' ? def.theme : level.theme);
    resetRoomEntities();
    snapCamera();
  }

  function resetRoomEntities() {
    enemies = []; bullets = []; pieces = []; corpses = []; pickups = []; ghosts = []; pendingBooms = [];
    room.decals = [];
    Fx.clear();
    const skin = SKIN[Save.data.skin] || SKINS[0];
    player = makeChar(room.spawn.x, room.spawn.y, {
      color: skin.body, dark: skin.dark, shine: skin.shine, rainbow: skin.rainbow, hat: Save.data.hat, deadColor: deadCol(),
    });
    player.isPlayer = true;
    const w = WEAPON[Save.data.weapon] || WEAPONS[0];
    player.weapon = { id: w.id, ammo: w.mag, cd: 0, reloadT: 0, kick: 0, kick2: 0, alt: 0 };
    player.pickup = null;
    player.facing = 1; player.aim = 0;
    for (const d of room.enemyDefs) {
      const def = ENEMIES[d.type];
      const e = makeChar(d.x, d.y, { color: '#e2434b', dark: '#b02a33', deadColor: deadCol(), scale: def.scale });
      e.type = d.type; e.def = def; e.hp = def.hp; e.gun = def.gun;
      const towardSpawn = room.spawn.x < d.x ? -1 : 1;
      e.facing = d.away ? -towardSpawn : towardSpawn;
      e.aim = e.facing > 0 ? 0.15 : Math.PI - 0.15;
      e.alert = false; e.reactT = 0; e.cd = rand(0.2, 0.6); e.charge = 0; e.burst = 0; e.burstT = 0; e.seeT = 0; e.lostT = 0;
      e.homeX = d.x; e.strafeT = rand(1, 3); e.moveDir = 0; e.meleeT = -1; e.jumpCd = 0; e.flinch = 0;
      e.body.gunId = def.gun;
      enemies.push(e);
    }
    crates = room.crateDefs.map(c => ({ x: c.x, y: c.y + 16, w: 30, h: 30, vx: 0, vy: 0, rot: 0, vr: 0, grounded: false }));
    barrels = room.barrelDefs.map(b => ({ x: b.x, y: b.y, w: 28, h: 40, hp: 1, fuse: -1, gone: false }));
    panes = room.panesDef.map(g => Object.assign({}, g, { broken: false }));
    doorOpen = enemies.length === 0;
    clearT = -1; roomT = 0; deathT = 0;
    forcedT = 0; hitstop = 0;
  }
  const deadCol = () => (room && room.theme.dark ? '#c9cfdb' : '#eeeef1');

  function makeChar(x, y, o) {
    const s = o.scale || 1;
    const c = {
      x, y, vx: 0, vy: 0, w: 24 * s, h: STAND_H * s, s, grounded: true, plat: null, dropPlat: null, dropT: 0,
      facing: 1, aim: 0, alive: true, slideT: 0, slideDir: 1, crawl: false, flip: 0, flipping: false, flipDir: 1,
      coyote: 0, jumpBuf: 0, airT: 0, stepPh: 0,
      body: new Body({ x, y, scale: s, color: o.color, dark: o.dark, shine: o.shine, rainbow: o.rainbow, hat: o.hat, deadColor: o.deadColor }),
    };
    return c;
  }

  /* ------------------------------------------------------------ input */
  function setKey(k, v) { input[k] = v; }
  function press(a) { pressed.add(a); if (a === 'shoot') input.shootBuf = 0.16; }
  function setMouse(x, y) { input.mouse.x = x; input.mouse.y = y; input.mouse.on = true; input.touch = false; }
  function setAxis(x, y) { input.axis = x; input.axisY = y; input.touch = true; }
  function setAimStick(a) { input.aimStick = a; input.touch = true; }   // null or angle

  /* --------------------------------------------------------- camera */
  function viewH() { return clamp(room.h + 360, 640, 900); }
  function snapCamera() {
    const t = cameraTarget();
    cam.x = t.x; cam.y = t.y; cam.zoom = baseZoom();
  }
  function baseZoom() { return Math.min(sh / viewH(), sw / 1150); }
  function cameraTarget() {
    const z = baseZoom() * (1 + cam.kick);
    const hw = sw / 2 / z, hh = sh / 2 / z;
    if (state === 'menu') {
      // centre the demo shootout in the space the menu panel leaves free
      const sx = menuInset + (sw - menuInset) / 2;
      return { x: 770 - (sx - sw / 2) / z, y: room.h / 2 + 10 };
    }
    let tx = player.x, ty = player.y - 70;
    if (!input.touch && input.mouse.on && state === 'play') {
      const m = screenToWorld(input.mouse.x, input.mouse.y);
      tx += clamp((m.x - player.x) * 0.3, -260, 260);
      ty += clamp((m.y - player.y + 70) * 0.12, -80, 80);
    } else tx += Math.cos(player.aim) * 90;
    if (cam.focus && cam.focusT > 0) { tx = lerp(tx, cam.focus.x, 0.7); ty = lerp(ty, cam.focus.y, 0.7); }
    const touch = input.touch || document.body.classList.contains('touch');
    const m = 140, mx = touch ? m + sw * 0.16 / z : m;
    tx = room.w + 2 * mx < hw * 2 ? room.w / 2 : clamp(tx, hw - mx, room.w - hw + mx);
    ty = room.h + 2 * m < hh * 2 ? room.h / 2 : clamp(ty, hh - m, room.h - hh + m);
    // on touch screens lift the room clear of the thumb controls
    if (touch) ty += sh * 0.13 / z;
    return { x: tx, y: ty };
  }
  function screenToWorld(sx, sy) {
    const wx = cam.x + (sx - sw / 2) / cam.zoom, wy = cam.y + (sy - sh / 2) / cam.zoom;
    const V = View.V;
    return { x: V.x + (wx - V.x) / KP, y: V.y + (wy - V.y) / KP };
  }
  function worldToScreen(x, y) {
    const V = View.V;
    const wx = V.x + (x - V.x) * KP, wy = V.y + (y - V.y) * KP;
    return { x: (wx - cam.x) * cam.zoom + sw / 2, y: (wy - cam.y) * cam.zoom + sh / 2 };
  }
  function shake(v) { if (Save.data.settings.shake) cam.shake = Math.max(cam.shake, v); }

  /* ------------------------------------------------------------- time */
  function slowMo(dur, scale) { forcedT = Math.max(forcedT, dur); forcedScale = Math.min(forcedT > 0 ? forcedScale : 1, scale); if (forcedT === dur) forcedScale = scale; }
  function toggleSlow() {
    if (state !== 'play' || !player.alive) return;
    if (!slowOn && focus < 0.08) { Sfx.denied(); emit('noFocus'); return; }
    slowOn = !slowOn;
    if (slowOn) { Sfx.slowIn(); Fx.ring(player.x, player.y - 46, 220, '#7fb0e2', 6, 0.5); }
    else Sfx.slowOut();
  }

  /* ------------------------------------------------------------ update */
  function update(dtReal) {
    clock += dtReal;
    if (paused) { pressed.clear(); return; }
    // fades between rooms
    if (fade) {
      fade.t += dtReal;
      if (fade.phase === 'out' && fade.t >= 0.32) { fade.phase = 'in'; fade.t = 0; fade.cb(); }
      else if (fade.phase === 'in' && fade.t >= 0.32) fade = null;
    }
    // time scale
    let target = 1;
    if (slowOn) target = SLOW_SCALE;
    if (forcedT > 0) { forcedT -= dtReal; target = Math.min(target, forcedScale); if (forcedT <= 0) forcedScale = 1; }
    ts += (target - ts) * (1 - Math.exp(-14 * dtReal));
    let tsEff = ts;
    if (hitstop > 0) { hitstop -= dtReal; tsEff = 0.04; }
    Sfx.setTime(tsEff);
    const wdt = dtReal * tsEff;
    const pdt = dtReal * (1 - (1 - tsEff) * 0.52);
    if (state === 'play') {
      if (slowOn) { focus -= dtReal * 0.19; if (focus <= 0) { focus = 0; slowOn = false; Sfx.slowOut(); } }
      else focus = Math.min(1, focus + dtReal * 0.03);
      run.time += dtReal; roomT += dtReal;
      if (run.comboT > 0) { run.comboT -= dtReal; if (run.comboT <= 0) run.combo = 0; }
    }
    if (ts < 0.6 && state !== 'menu') { heartT -= dtReal; if (heartT <= 0) { heartT = 0.85; Sfx.heartbeat(); } }
    closeCd -= dtReal;
    if (cam.focusT > 0) cam.focusT -= dtReal;
    cam.kick *= Math.exp(-5 * dtReal);
    if (flash > 0) flash = Math.max(0, flash - dtReal * 3);

    const alerted = enemies.some(e => e.alert);
    Sfx.setIntensity(state === 'menu' ? 0.12 : alerted ? 0.9 : 0.4);

    if (state === 'menu') { Fx.update(updateMenu(dtReal), room, panes); }
    else if (!fade || fade.phase === 'in') {
      if (player.alive) updatePlayer(pdt, wdt);
      else { player.body.simulate(wdt, room, panes); deathT += dtReal; }
      for (const e of enemies) updateEnemy(e, wdt);
      updateBullets(wdt);
      updateWorldBits(wdt);
      checkRoomFlow(dtReal);
    }
    // ghosts (slow-motion after-images)
    ghostT -= dtReal;
    if (ts < 0.7 && player.alive && ghostT <= 0 && state === 'play') {
      ghostT = 0.045;
      ghosts.push({ pts: player.body.pts.map(p => ({ x: p.x, y: p.y })), t: 0, col: player.body.color });
    }
    for (const g of ghosts) g.t += dtReal;
    ghosts = ghosts.filter(g => g.t < 0.28);

    if (state !== 'menu') Fx.update(wdt, room, panes);
    // camera
    const t = cameraTarget();
    const k = 1 - Math.exp(-(state === 'menu' ? 1.2 : 7) * dtReal);
    cam.x += (t.x - cam.x) * k; cam.y += (t.y - cam.y) * k;
    cam.zoom += (baseZoom() * (1 + cam.kick + (cam.focusT > 0 ? 0.18 : 0) + (ts < 0.6 && state === 'play' ? 0.04 : 0)) - cam.zoom) * (1 - Math.exp(-6 * dtReal));
    cam.shake *= Math.exp(-9 * dtReal);
    cam.kx = rand(-1, 1) * cam.shake; cam.ky = rand(-1, 1) * cam.shake;
    pressed.clear();
  }

  function updateMenu(dtReal) {
    const wdt = dtReal * 0.32;
    ts = 0.32; Sfx.setTime(1);
    const e = enemies[0];
    const tgt = e && e.alive ? e.body.pts[J.HEAD] : { x: player.x + 400, y: player.y - 80 };
    player.aim = turnTo(player.aim, Math.atan2(tgt.y - (player.y - 74), tgt.x - player.x), dtReal * 2);
    const w = WEAPON[player.weapon.id];
    player.body.gunId = w.id; player.body.dual = !!w.dual;
    player.body.pose({ x: player.x, y: player.y, facing: 1, aim: player.aim, vx: 0, vy: 0, grounded: true, gun: true, twoHand: ['smg', 'shotgun', 'rifle'].includes(w.id), dual: w.dual, kick: player.weapon.kick }, wdt);
    player.weapon.kick = Math.max(0, player.weapon.kick - wdt * 10);
    if (e && e.alive) {
      e.aim = turnTo(e.aim, Math.atan2(player.y - 60 - (e.y - 74), player.x - e.x), wdt * 2);
      e.body.pose({ x: e.x, y: e.y, facing: -1, aim: e.aim, vx: 0, vy: 0, grounded: true, gun: true, twoHand: e.def.gun !== 'pistol' }, wdt);
      menuT -= dtReal;
      if (menuT <= 0) { menuT = 3.2; player.weapon.ammo = 99; player.weapon.cd = 0; fire(player, w, player.weapon); }
    } else {
      menuEnemyT += dtReal;
      if (menuEnemyT > 3.4) { menuEnemyT = 0; menuT = 1.4; spawnMenuEnemy(); corpses = []; }
    }
    updateBullets(wdt);
    updateWorldBits(wdt);
    if (pieces.length > 60) pieces.splice(0, pieces.length - 60);
    return wdt;
  }

  /* ----------------------------------------------------------- player */
  function curWeapon() { return WEAPON[player.pickup ? player.pickup.id : player.weapon.id]; }

  function updatePlayer(dt, wdt) {
    const p = player;
    const w = curWeapon();
    // ---- aim
    if (input.touch) {
      if (typeof input.aimStick === 'number') {
        p.aim = input.aimStick;
        // soft snap to the nearest enemy near the stick direction
        if (Save.data.settings.aimAssist) {
          let best = null, bd = 0.32;
          for (const e of enemies) {
            if (!e.alive) continue;
            const c = e.body.center(); const a = Math.atan2(c.y - (p.y - 74), c.x - p.x);
            const d = Math.abs(angDiff(p.aim, a));
            if (d < bd && room.los(p.x, p.y - 74, c.x, c.y)) { bd = d; best = a; }
          }
          if (best != null) p.aim = best;
        }
      } else {
        let best = null, bd = 1e9;
        for (const e of enemies) {
          if (!e.alive) continue;
          const c = e.body.center(); const d = dist(p.x, p.y, c.x, c.y);
          if (d < bd && d < 1100 && room.los(p.x, p.y - 74, c.x, c.y)) { bd = d; best = Math.atan2(c.y - (p.y - 74), c.x - p.x); }
        }
        const moveA = input.axis > 0.2 ? 0 : input.axis < -0.2 ? Math.PI : (p.facing > 0 ? 0 : Math.PI);
        p.aim = best != null ? best : moveA;
      }
    } else {
      const m = screenToWorld(input.mouse.x, input.mouse.y);
      const sy = p.slideT > 0 || p.crawl ? p.y - 40 : p.y - 74;
      p.aim = Math.atan2(m.y - sy, m.x - p.x);
    }
    const aimF = Math.cos(p.aim) >= 0 ? 1 : -1;
    if (!p.flipping) p.facing = aimF;

    // ---- movement intent
    let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (input.touch && Math.abs(input.axis) > 0.15) mx = input.axis;
    const sprint = input.sprint || (input.touch && Math.abs(input.axis) > 0.88);
    p.sprinting = sprint && Math.abs(mx) > 0.1;
    const want = mx * (p.sprinting ? SPRINT : WALK);

    // timers
    p.coyote = p.grounded ? 0.1 : p.coyote - dt;
    p.jumpBuf -= dt;
    if (pressed.has('jump')) p.jumpBuf = 0.13;
    if (p.dropT > 0) { p.dropT -= dt; if (p.dropT <= 0) p.dropPlat = null; }

    // ---- slide
    if (pressed.has('slide')) {
      if (p.grounded && p.plat && p.plat.kind !== 'ledge' && Math.abs(p.vx) < 60 && Math.abs(mx) < 0.1) { /* stand still on furniture: nothing */ }
      if (p.grounded && p.plat && Math.abs(p.vx) < 60 && Math.abs(mx) < 0.1) { p.dropPlat = p.plat; p.dropT = 0.3; p.grounded = false; p.y += 2; }
      else if (p.grounded && p.slideT <= 0 && !p.crawl) {
        p.slideDir = Math.abs(mx) > 0.1 ? Math.sign(mx) : Math.abs(p.vx) > 40 ? Math.sign(p.vx) : p.facing;
        p.vx = p.slideDir * clamp(Math.abs(p.vx) * 1.2, SLIDE_V, 700);
        p.slideT = SLIDE_T; p.h = SLIDE_H;
        Sfx.slide(); Fx.dust(p.x, p.y, 6);
      }
    }
    if (p.slideT > 0) {
      p.slideT -= dt;
      p.vx = approach(p.vx, 0, 620 * dt);
      if (p.grounded && Math.random() < 0.5) Fx.dust(p.x - p.slideDir * 10, p.y, 1, room.theme.side, 0.4);
      if (p.slideT <= 0 || Math.abs(p.vx) < 120) {
        p.slideT = 0;
        if (room.canStand(p, STAND_H, panes)) { p.h = STAND_H; p.crawl = false; }
        else p.crawl = true;
      }
    }
    if (p.crawl) {
      p.vx = p.slideDir * 230;
      if (room.canStand(p, STAND_H, panes)) { p.crawl = false; p.h = STAND_H; }
    }
    const sliding = p.slideT > 0 || p.crawl;

    // ---- horizontal accel
    if (!sliding) {
      const acc = p.grounded ? ACC_G : ACC_A;
      p.vx = approach(p.vx, want, acc * dt);
    }

    // ---- jump
    if (p.jumpBuf > 0 && (p.grounded || p.coyote > 0) && !p.crawl) {
      p.jumpBuf = 0; p.coyote = 0;
      p.vy = -JUMP_V;
      if (p.slideT > 0) { p.vx *= 1.05; p.slideT = 0; }
      p.h = STAND_H;
      p.grounded = false;
      const moving = Math.abs(p.vx) > 330;
      if (moving && (p.sprinting || sliding)) {
        p.flipping = true; p.flip = 0; p.flipDir = Math.sign(p.vx) * p.facing;
        Sfx.flip();
      } else Sfx.jump();
      Fx.dust(p.x, p.y, 5);
    }

    // ---- glass: barrel through it at speed
    for (const g of panes) {
      if (g.broken) continue;
      const nx = p.x + p.vx * dt;
      if (nx + p.w / 2 > g.x && nx - p.w / 2 < g.x + g.w && p.y > g.y && p.y - p.h < g.y + g.h) {
        if (Math.abs(p.vx) > 300 || sliding || !p.grounded) breakPane(g, p.vx);
      }
    }

    // ---- physics
    p.vy = Math.min(p.vy + G * dt, 1500);
    const wasAir = !p.grounded;
    const fallV = p.vy;
    const out = room.moveBody(p, dt, panes);
    if (out.landed && wasAir) {
      Sfx.land(clamp(fallV / 900, 0.3, 1.2));
      if (fallV > 500) Fx.dust(p.x, p.y, 8);
      if (p.flipping) { p.flipping = false; p.flip = 0; }
    }
    if (!p.grounded) p.airT += dt; else p.airT = 0;
    if (p.flipping) {
      p.flip += dt * 12.5;
      if (p.flip >= TAU) { p.flip = 0; p.flipping = false; }
    }
    // footsteps
    if (p.grounded && !sliding && Math.abs(p.vx) > 60) {
      p.stepPh += Math.abs(p.vx) * dt / 15;
      if (p.stepPh > Math.PI) { p.stepPh -= Math.PI; Sfx.step(); }
    }
    // crates get kicked
    for (const c of crates) {
      if (Math.abs(c.x - p.x) < (c.w + p.w) / 2 + 2 && p.y > c.y - c.h - 4 && p.y - p.h < c.y && Math.abs(p.vx) > 40) {
        c.vx = p.vx * 1.25 + Math.sign(p.vx) * 90; c.vy = -rand(140, 300) * (Math.abs(p.vx) > 300 ? 1.4 : 1); c.vr = Math.sign(p.vx) * rand(6, 12); c.grounded = false;
        Sfx.crate();
      }
    }

    // ---- weapon
    const pw = p.pickup || p.weapon;
    pw.cd -= dt;
    p.weapon.kick = Math.max(0, p.weapon.kick - dt * 10); p.weapon.kick2 = Math.max(0, p.weapon.kick2 - dt * 10);
    if (p.weapon.reloadT > 0 && !p.pickup) {
      p.weapon.reloadT -= dt;
      if (p.weapon.reloadT <= 0) { p.weapon.ammo = WEAPON[p.weapon.id].mag; Sfx.reload(); }
    }
    if (pressed.has('reload') && !p.pickup && p.weapon.reloadT <= 0 && p.weapon.ammo < WEAPON[p.weapon.id].mag) startReload();
    input.shootBuf = (input.shootBuf || 0) - dt;
    const wantShoot = input.touch ? input.aimStick != null : (w.auto ? input.shoot : input.shootBuf > 0);
    if (wantShoot && pw.cd <= 0) {
      input.shootBuf = 0;
      if (p.pickup) {
        if (p.pickup.ammo > 0) fire(p, w, p.pickup);
        if (p.pickup.ammo <= 0) dropPickupGun(true);
      } else if (p.weapon.reloadT <= 0) {
        if (p.weapon.ammo > 0) fire(p, w, p.weapon);
        else { Sfx.dry(); startReload(); pw.cd = 0.2; }
        if (p.weapon.ammo <= 0) startReload();
      }
    }

    // ---- pick up guns
    p.nearPickup = null;
    for (const g of pickups) if (g.t > 0.3 && dist(g.x, g.y, p.x, p.y - 20) < 60) p.nearPickup = g;
    if (pressed.has('pick') && p.nearPickup) takePickup(p.nearPickup);

    // ---- slow motion
    if (pressed.has('slow')) toggleSlow();

    // ---- pose
    const ww = curWeapon();
    p.body.gunId = ww.id;
    p.body.dual = !!ww.dual;
    p.body.pose({
      x: p.x, y: p.y, facing: p.facing, aim: p.aim, vx: p.vx, vy: p.vy, grounded: p.grounded, slide: sliding, flip: p.flipping ? p.flip * p.flipDir : 0,
      sprint: p.sprinting, gun: true, twoHand: ['smg', 'shotgun', 'rifle'].includes(ww.id), dual: ww.dual, kick: p.weapon.kick, kick2: p.weapon.kick2,
      reload: !p.pickup && p.weapon.reloadT > 0 ? 1 - p.weapon.reloadT / WEAPON[p.weapon.id].reload : 0,
    }, dt);
    if (p.body.flash > 0) p.body.flash -= dt * 4;
    if (p.invuln > 0) p.invuln -= dt;
  }

  function startReload() {
    const p = player;
    if (p.pickup || p.weapon.reloadT > 0) return;
    p.weapon.reloadT = WEAPON[p.weapon.id].reload;
    Sfx.dry();
  }

  function fire(c, w, ws) {
    ws.cd = w.rate;
    ws.ammo--;
    ws.held = true;
    const dual = !!w.dual;
    const second = dual && (ws.alt = (ws.alt || 0) ^ 1) === 1;
    const len = w.len;
    const mz = c.body.muzzle(len, second);
    const pellets = w.pellets || 1;
    const spreadK = ts < 0.6 ? 0.5 : 1;
    for (let i = 0; i < pellets; i++) {
      const a = c.aim + (pellets > 1 ? (i / (pellets - 1) - 0.5) * w.spread * 2 + rand(-0.03, 0.03) : rand(-1, 1) * w.spread * spreadK);
      bullets.push({ x: mz.x, y: mz.y, ox: mz.x, oy: mz.y, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, owner: 'p', pierce: w.pierce || 0, life: w.life || 1.4, t: 0, hits: [], shooter: c, big: w.id === 'revolver' || w.id === 'shotgun' });
    }
    if (second) c.weapon.kick2 = (w.kick || 1); else c.weapon.kick = (w.kick || 1);
    c.body.shove(-Math.cos(c.aim) * 60 * (w.kick || 1), -Math.sin(c.aim) * 60 * (w.kick || 1), J.FHAND);
    Fx.muzzle(mz.x, mz.y, c.aim, w.id === 'shotgun' ? 1.6 : w.id === 'revolver' ? 1.4 : 1);
    Fx.casing(mz.x - Math.cos(c.aim) * len * 0.6, mz.y, c.facing, w.id === 'shotgun' ? '#c94b3a' : '#d9b25c');
    Sfx.shot(w.id);
    shake(w.id === 'shotgun' || w.id === 'revolver' ? 7 : 3);
    cam.kick = Math.max(cam.kick, w.id === 'shotgun' ? 0.02 : 0.008);
    // gunfire is loud: everyone close enough hears it
    if (mode !== 'menu') for (const e of enemies) {
      if (!e.alive || e.alert) continue;
      if (dist(e.x, e.y, c.x, c.y) < 950) { e.alert = true; e.reactT = Math.max(e.reactT, e.def.react * reactMul() + 0.25); Fx.text(e.x, e.y - 110 * e.s, '?', '#e2434b', 26); }
    }
    emit('shot');
  }

  function takePickup(g) {
    const p = player;
    if (p.pickup) dropPickupGun(false);
    p.pickup = { id: g.id, ammo: g.ammo, cd: 0.1, held: true };
    pickups.splice(pickups.indexOf(g), 1);
    Sfx.reload();
    Fx.text(p.x, p.y - 120, WEAPON[g.id].name.toUpperCase(), '#1d2130', 18, g.ammo + ' ROUNDS');
    emit('pickup');
  }
  function dropPickupGun(empty) {
    const p = player;
    if (!p.pickup) return;
    if (!empty) pickups.push({ id: p.pickup.id, ammo: p.pickup.ammo, x: p.x, y: p.y - 60, vx: p.facing * 120, vy: -200, rot: p.aim, vr: rand(-8, 8), t: 0 });
    else {
      // empty guns get tossed
      pickups.push({ id: p.pickup.id, ammo: 0, x: p.x, y: p.y - 60, vx: p.facing * 260, vy: -260, rot: p.aim, vr: rand(-14, 14), t: -99, empty: true });
    }
    p.pickup = null;
    p.weapon.cd = 0.15;
  }

  /* ----------------------------------------------------------- enemies */
  const reactMul = () => lerp(1.3, 0.78, diff()) * (mode === 'campaign' && levelIdx === 0 ? 1.5 : 1);

  function updateEnemy(e, dt) {
    if (!e.alive) return;
    const d = e.def, p = player;
    const head = { x: e.x, y: e.y - 80 * e.s };
    const pc = { x: p.x, y: p.y - (p.slideT > 0 || p.crawl ? 24 : 58) };
    const dx = pc.x - e.x, dd = Math.hypot(dx, pc.y - head.y);
    let sees = false;
    if (p.alive && roomT > 0.7 && dd < 1150) {
      const inFront = Math.sign(dx) === e.facing || Math.abs(dx) < 140;
      if ((inFront || e.alert) && room.los(head.x, head.y, pc.x, pc.y)) sees = true;
    }
    if (sees && !e.alert) {
      e.alert = true; e.reactT = d.react * reactMul();
      Fx.text(e.x, e.y - 112 * e.s, '!', '#e2434b', 30);
      Sfx.laser();
    }
    e.seeT = sees ? e.seeT + dt : 0;
    if (sees) { e.lastX = pc.x; e.lastY = pc.y; e.lostT = 0; } else e.lostT += dt;
    if (e.flinch > 0) e.flinch -= dt;
    if (e.body.flash > 0) e.body.flash -= dt * 4;

    let want = 0;
    if (e.alert && p.alive) {
      // face and aim
      const tx = sees ? pc.x : e.lastX != null ? e.lastX : pc.x;
      if (Math.abs(tx - e.x) > 8) e.facing = Math.sign(tx - e.x);
      const sh = { x: e.x, y: e.y - 74 * e.s };
      const ta = Math.atan2((sees ? pc.y : (e.lastY || pc.y)) - sh.y, tx - sh.x);
      e.aim = turnTo(e.aim, ta, (d.turn || 3) * dt);
      if (e.reactT > 0) e.reactT -= dt;
      if (d.melee) {
        // blade: run you down
        const adx = pc.x - e.x, ady = p.y - e.y;
        if (e.meleeT >= 0) {
          e.meleeT += dt;
          if (e.meleeT > 0.2 && e.meleeT - dt <= 0.2) {
            Sfx.swing();
            if (Math.abs(adx) < 62 * e.s && Math.abs(ady) < 70 && Math.sign(adx || 1) === e.facing) killPlayer(e.facing * 600, -260, e);
          }
          if (e.meleeT > 0.55) e.meleeT = -1;
        } else if (e.reactT <= 0) {
          if (Math.abs(adx) < 52 && Math.abs(ady) < 60) { e.meleeT = 0; }
          else want = Math.sign(adx) * d.walk;
          if (e.grounded && e.jumpCd <= 0 && (e.blocked || (ady < -70 && Math.abs(adx) < 220))) { e.vy = -JUMP_V * 0.95; e.grounded = false; e.jumpCd = 0.8; }
        }
        e.jumpCd -= dt;
      } else {
        // shooters
        if (e.reactT <= 0) {
          if (e.burst > 0) {
            e.burstT -= dt;
            if (e.burstT <= 0) { enemyFire(e); e.burst--; e.burstT = d.burstGap || 0.1; if (e.burst <= 0) e.cd = rand(d.cd[0], d.cd[1]) * lerp(1.15, 0.85, diff()); }
          } else if (e.cd > 0) e.cd -= dt;
          else if (sees || (e.charge > 0 && e.lostT < 0.25)) {
            e.charge += dt;
            if (e.charge >= d.aim) { e.charge = 0; e.burst = d.burst || 1; e.burstT = 0; }
          } else e.charge = Math.max(0, e.charge - dt * 2);
        }
        // footwork
        e.strafeT -= dt;
        const adx = Math.abs(pc.x - e.x);
        if (d.advance && sees && adx > 240 && e.charge === 0) want = Math.sign(pc.x - e.x) * d.walk;
        else if (!d.advance && d.walk > 0 && sees && adx < 210 && e.charge === 0 && e.burst === 0) want = -Math.sign(pc.x - e.x) * d.walk;
        else if (!sees && e.lostT > 0.8 && e.lastX != null && d.walk > 0 && Math.abs(e.lastX - e.x) > 30) want = Math.sign(e.lastX - e.x) * d.walk * 0.8;
        else if (d.walk > 0 && e.strafeT < 0 && e.charge === 0) { e.moveDir = pick([-1, 0, 0, 1]); e.strafeT = rand(0.5, 1.4); }
        if (!want && e.moveDir && e.strafeT > 0 && e.charge === 0 && e.burst === 0) want = e.moveDir * d.walk * 0.6;
      }
    } else if (!e.alert) {
      // idle sway
      e.aim = e.facing > 0 ? 0.25 : Math.PI - 0.25;
    }
    // don't walk off edges (blades will drop down after you)
    if (want && !d.melee) {
      const ax = e.x + Math.sign(want) * (e.w / 2 + 8);
      if (!room.groundAhead(ax, e.y) || room.boxHit(ax - 2, e.y - e.h + 4, ax + 2, e.y - 22)) want = 0;
    }
    e.vx = approach(e.vx, want, 1400 * dt);
    e.vy = Math.min(e.vy + G * dt, 1500);
    const wasAir = !e.grounded;
    const out = room.moveBody(e, dt, panes);
    e.blocked = !!out.wall;
    if (out.pane && Math.abs(e.vx) > 100) breakPane(out.pane, e.vx);
    if (out.landed && wasAir) Fx.dust(e.x, e.y, 4);
    const melee = d.melee && e.meleeT >= 0 ? clamp(e.meleeT / 0.35, 0, 1) : null;
    e.body.pose({
      x: e.x, y: e.y, facing: e.facing, aim: e.aim, vx: e.vx, vy: e.vy, grounded: e.grounded, slide: false, flip: 0,
      sprint: d.melee && Math.abs(e.vx) > 200, gun: !!d.gun, twoHand: d.gun === 'smg' || d.gun === 'shotgun' || d.gun === 'rifle', melee,
      kick: e.kick || 0,
    }, dt);
    if (e.kick) e.kick = Math.max(0, e.kick - dt * 8);
  }

  function enemyFire(e) {
    const d = e.def;
    const len = WEAPON[d.gun] ? WEAPON[d.gun].len : 16;
    const mz = e.body.muzzle(len);
    const n = d.pellets || 1;
    for (let i = 0; i < n; i++) {
      const a = e.aim + (n > 1 ? (i / (n - 1) - 0.5) * d.spread * 2 : rand(-1, 1) * d.spread);
      bullets.push({ x: mz.x, y: mz.y, ox: mz.x, oy: mz.y, vx: Math.cos(a) * d.speed, vy: Math.sin(a) * d.speed, owner: 'e', pierce: 0, life: d.life || 3, t: 0, hits: [], shooter: e, near: false, rifle: d.gun === 'rifle' });
    }
    e.kick = 1;
    Fx.muzzle(mz.x, mz.y, e.aim, d.gun === 'shotgun' ? 1.5 : 1);
    Fx.casing(mz.x, mz.y, e.facing);
    Sfx.enemyShot(d.gun);
    shake(1.5);
  }

  /* ---------------------------------------------------------- bullets */
  function updateBullets(dt) {
    const keep = [];
    for (const b of bullets) {
      b.t += dt;
      if (b.t > b.life) continue;
      const sp = Math.hypot(b.vx, b.vy);
      const steps = Math.max(1, Math.ceil(sp * dt / 6));
      let alive = true;
      for (let s = 0; s < steps && alive; s++) {
        const nx = b.x + b.vx * dt / steps, ny = b.y + b.vy * dt / steps;
        // deflect: player rounds knock enemy rounds out of the air
        if (b.owner === 'p') {
          for (const o of bullets) {
            if (o.owner !== 'e' || o.dead || o === b) continue;
            if (segPointDist(b.x, b.y, nx, ny, o.x, o.y).d < 11) {
              o.dead = true; alive = false;
              Fx.sparks(o.x, o.y, Math.atan2(-o.vy, -o.vx), 10, '#ffffff', 520); Fx.ring(o.x, o.y, 30, '#ffd27a', 3, 0.3);
              Sfx.deflect();
              styleEvent(o.x, o.y, 'DEFLECT', 75);
              run.deflects++; track('deflects');
              hitstop = Math.max(hitstop, 0.05);
              break;
            }
          }
          if (!alive) break;
        }
        // bodies
        const targets = b.owner === 'p' ? enemies : [player, ...enemies];
        for (const c of targets) {
          if (!c.alive || c === b.shooter || b.hits.includes(c)) continue;
          if (c === player && c.invuln > 0) continue;
          if (Math.abs(c.x - nx) > 60 || Math.abs(c.y - 50 - ny) > 90) continue;
          const h = c.body.hitTest(nx, ny, b.big ? 4 : 2.5);
          if (!h) continue;
          b.hits.push(c);
          if (c === player) { killPlayer(b.vx * 0.5, b.vy * 0.5 - 120, b.shooter, h.idx); alive = false; break; }
          hitEnemy(c, b, h, nx, ny);
          if (b.pierce > 0) b.pierce--; else { alive = false; break; }
        }
        if (!alive) break;
        // near misses
        if (b.owner === 'e' && player.alive && !b.near) {
          const pcy = player.y - 50;
          const dd = Math.hypot(player.x - nx, pcy - ny);
          if (dd < 46) {
            b.near = true;
            Sfx.whiz();
            if (closeCd <= 0 && state === 'play') {
              closeCd = 5; slowMo(0.55, 0.3);
              b.closeCall = true;
            }
          }
        }
        // corpses and loose blocks get shoved
        for (const cb of corpses) if (Math.abs(cb.pts[J.PELVIS].x - nx) < 60 && Math.abs(cb.pts[J.PELVIS].y - ny) < 70) cb.push(nx, ny, b.vx * 0.5, b.vy * 0.5, 22);
        for (const pc of pieces) {
          const mx = (pc.a.x + pc.b.x) / 2, my = (pc.a.y + pc.b.y) / 2;
          if (Math.abs(mx - nx) < 16 && Math.abs(my - ny) < 16) {
            const h = 1 / 120;
            for (const q of [pc.a, pc.b]) { q.px -= b.vx * 0.25 * h; q.py -= (b.vy * 0.25 - 200) * h; }
            wakePiece(pc);
          }
        }
        for (const c of crates) if (Math.abs(c.x - nx) < 17 && ny > c.y - c.h - 2 && ny < c.y + 2) { c.vx += b.vx * 0.12; c.vy -= 160; c.vr += sign(b.vx) * 8; c.grounded = false; Fx.chips(nx, ny, b.vx, b.vy, '#c9a477', 4); }
        for (const br of barrels) if (!br.gone && Math.abs(br.x - nx) < 15 && ny > br.y - br.h && ny < br.y) { detonate(br, b.owner === 'p'); alive = false; break; }
        if (!alive) break;
        // walls and glass
        const hit = room.solidAt(nx, ny, panes);
        if (hit) {
          if (hit !== true) { breakPane(hit, b.vx); b.x = nx; b.y = ny; continue; }
          const r = room.ray(b.x, b.y, nx, ny, null, 2) || { x: b.x, y: b.y, nx: -sign(b.vx), ny: 0 };
          Fx.sparks(r.x, r.y, Math.atan2(r.ny, r.nx) || Math.atan2(-b.vy, -b.vx), 5, b.owner === 'p' ? '#ffd27a' : '#ffffff', 300);
          Fx.dust(r.x, r.y, 3, room.theme.side, 0.5);
          if (Math.random() < 0.25) Sfx.ricochet(); else Sfx.wallHit();
          if (room.decals.length < 220) room.decals.push({ x: r.x, y: r.y, kind: 'hole' });
          alive = false; break;
        }
        b.x = nx; b.y = ny;
      }
      if (alive && !b.dead) keep.push(b);
    }
    bullets = keep;
  }

  function breakPane(g, vx) {
    if (g.broken) return;
    g.broken = true;
    Fx.shards(g.x + 4, g.y, g.h, vx);
    Sfx.glass();
    slowMo(0.35, 0.35);
    shake(5);
    emit('glass');
  }

  function hitEnemy(e, b, h, x, y) {
    const head = h.head;
    const dmg = head ? 2 : 1;
    e.hp -= e.def.armor && !head ? 1 : dmg;
    e.alert = true; if (e.reactT > 0.15) e.reactT = 0.15;
    Fx.chips(x, y, b.vx, b.vy, '#e2434b', head ? 10 : 6);
    if (e.hp > 0) {
      e.body.flash = 1; e.flinch = 0.2;
      e.body.shove(b.vx * 0.12, b.vy * 0.12, h.idx);
      e.vx += Math.sign(b.vx) * 60;
      Sfx.armor();
      Fx.sparks(x, y, Math.atan2(-b.vy, -b.vx), 6, '#ffffff', 300);
      return;
    }
    const info = { head, pierce: b.hits.length > 1, boom: false, crossfire: b.owner === 'e' };
    killEnemy(e, b.vx * 0.55, b.vy * 0.55 - 150, h.idx, info);
  }

  function killEnemy(e, vx, vy, idx, info) {
    if (!e.alive) return;
    e.alive = false;
    e.body.die(vx, vy, idx || J.NECK, room);
    e.body.gunId = null;
    corpses.push(e.body);
    e.body.breakAt = rand(0.7, 0.95);
    if (info.head) {
      const pc = e.body.popHead(vx * 0.8, vy * 0.8);
      if (pc) pieces.push(pc);
      Sfx.hit(true);
    } else Sfx.hit(false);
    if (info.boom) e.body.breakAt = 0.05;
    // the gun clatters to the floor
    if (e.def.gun) {
      const hnd = e.body.pts[J.FHAND];
      pickups.push({ id: e.def.gun, ammo: e.def.gun === 'shotgun' ? 5 : e.def.gun === 'smg' ? 22 : e.def.gun === 'rifle' ? 8 : 9, x: hnd.x, y: hnd.y, vx: vx * 0.3 + rand(-60, 60), vy: -rand(150, 300), rot: e.aim, vr: rand(-12, 12), t: 0 });
    }
    hitstop = Math.max(hitstop, info.boom ? 0.02 : 0.05);
    cam.kick = Math.max(cam.kick, 0.025);
    shake(6);
    // scoring
    const p = player;
    const tags = [];
    let pts = 100;
    if (info.crossfire) { tags.push('CROSSFIRE'); pts += 80; }
    if (info.head) { tags.push(STYLE.headshot.label); pts += STYLE.headshot.pts; track('headshots'); run.headshots++; }
    if (info.boom) { tags.push(STYLE.boom.label); pts += STYLE.boom.pts; track('boomKills'); }
    if (!info.boom && !info.crossfire && p.alive) {
      if (p.flipping) { tags.push(STYLE.flip.label); pts += STYLE.flip.pts; track('flipKills'); }
      else if (!p.grounded) { tags.push(STYLE.air.label); pts += STYLE.air.pts; track('airKills'); }
      if (p.slideT > 0 || p.crawl) { tags.push(STYLE.slide.label); pts += STYLE.slide.pts; track('slideKills'); }
      if (info.pierce) { tags.push(STYLE.pierce.label); pts += STYLE.pierce.pts; }
    }
    if (ts < 0.6) track('slowKills');
    if (clock - lastKillT < 0.45) { multiCount++; if (multiCount === 1) { tags.push('MULTI KILL'); pts += 100; track('multis'); } } else multiCount = 0;
    lastKillT = clock;
    run.combo++; run.comboT = 3; run.bestCombo = Math.max(run.bestCombo, run.combo);
    const mult = Math.min(4, 1 + (run.combo - 1) * 0.25);
    const total = Math.round(pts * mult);
    run.score += total; run.kills++;
    track('kills');
    const c = e.body.center();
    Fx.text(c.x, c.y - 60, tags.length ? tags.join(' + ') : 'KILL', '#e2434b', tags.length ? 22 : 18, '+' + total + (run.combo > 1 ? '  x' + mult.toFixed(2).replace(/\.?0+$/, '') : ''));
    if (run.combo > 1) Sfx.combo(run.combo);
    focus = Math.min(1, focus + 0.2);
    emit('kill', { combo: run.combo, total });
    // last one in the room: kill cam
    if (mode !== 'menu' && enemies.every(o => !o.alive)) {
      doorOpen = true; clearT = 0;
      slowMo(1.1, 0.16);
      cam.focus = { x: c.x, y: c.y }; cam.focusT = 0.9;
      setTimeout(() => { Sfx.clear(); Sfx.door(); }, 250);
      emit('roomClear');
    }
  }

  function styleEvent(x, y, label, pts) {
    run.score += pts;
    Fx.text(x, y - 30, label, '#1d2130', 18, '+' + pts);
  }

  function killPlayer(vx, vy, killer, idx = J.NECK) {
    const p = player;
    if (!p.alive || state !== 'play') return;
    p.alive = false;
    p.body.die(vx, vy, idx, room);
    p.body.gunId = null;
    slowOn = false;
    slowMo(1.4, 0.2);
    Sfx.hurtPlayer();
    flash = 0.6; flashCol = '#ff4f5e';
    shake(10);
    Fx.chips(p.x, p.y - 60, vx, vy, p.body.color, 12);
    run.deaths++;
    track('deaths');
    state = 'dead'; deathT = 0;
    cam.focus = { x: p.x, y: p.y - 50 }; cam.focusT = 1.2;
    setTimeout(() => { if (!p.body.broken && state === 'dead' && player === p) { pieces.push(...p.body.breakApart()); Sfx.crumble(); } }, 900);
    emit('death', { mode, canRevive: mode === 'endless' && !endless.revived });
  }

  function detonate(br, byPlayer) {
    if (br.gone) return;
    br.gone = true;
    const x = br.x, y = br.y - 20;
    Sfx.boom();
    Fx.fire(x, y, 30); Fx.smoke(x, y, 18, '#8f8f98', 1.4); Fx.ring(x, y, 160, '#ffb347', 10, 0.45); Fx.sparks(x, y, -Math.PI / 2, 24, '#ffd27a', 700);
    room.decals.push({ x, y: y + 10, kind: 'scorch', r: 70 });
    shake(18); flash = 0.35; flashCol = '#fff2c4';
    cam.kick = Math.max(cam.kick, 0.06);
    slowMo(0.6, 0.3);
    const R = 150;
    for (const e of enemies) {
      if (!e.alive) continue;
      const c = e.body.center(), d = dist(c.x, c.y, x, y);
      if (d < R) { const a = Math.atan2(c.y - y, c.x - x); killEnemy(e, Math.cos(a) * 1100, Math.sin(a) * 1100 - 500, J.PELVIS, { boom: true }); }
    }
    if (player.alive) { const d = dist(player.x, player.y - 46, x, y); if (d < R - 20) { const a = Math.atan2(player.y - 46 - y, player.x - x); killPlayer(Math.cos(a) * 1000, Math.sin(a) * 1000 - 500, null, J.PELVIS); } }
    for (const cb of corpses) pushRadial(cb.pts, x, y, R + 40, 1300);
    for (const pc of pieces) { pushRadial([pc.a, pc.b], x, y, R + 60, 1300); wakePiece(pc); }
    for (const c of crates) { const d = dist(c.x, c.y - 15, x, y); if (d < R + 40) { const a = Math.atan2(c.y - 15 - y, c.x - x); c.vx += Math.cos(a) * 900; c.vy += Math.sin(a) * 900 - 300; c.vr += rand(-20, 20); c.grounded = false; } }
    for (const g of panes) if (!g.broken && Math.abs(g.x - x) < R) breakPane(g, g.x - x);
    for (const o of barrels) if (!o.gone && dist(o.x, o.y, br.x, br.y) < R + 30) pendingBooms.push({ br: o, t: 0.12 });
    for (const g of pickups) { g.vx += (g.x - x) * 4; g.vy -= 400; }
    emit('boom');
  }
  function pushRadial(pts, x, y, R, f) {
    const h = 1 / 120;
    for (const q of pts) {
      const d = dist(q.x, q.y, x, y);
      if (d > R) continue;
      const a = Math.atan2(q.y - y, q.x - x), k = (1 - d / R) * f * h;
      if (q.px != null) { q.px -= Math.cos(a) * k; q.py -= Math.sin(a) * k + 300 * h; }
    }
  }

  /* -------------------------------------------------------- world bits */
  function updateWorldBits(dt) {
    for (const pb of pendingBooms) { pb.t -= dt; if (pb.t <= 0) detonate(pb.br, true); }
    pendingBooms = pendingBooms.filter(pb => pb.t > 0);
    for (const cb of corpses) {
      cb.simulate(dt, room, panes);
      if (!cb.broken && cb.deadT > cb.breakAt) { pieces.push(...cb.breakApart()); Sfx.crumble(); Fx.dust(cb.pts[J.PELVIS].x, cb.pts[J.PELVIS].y, 6, '#ffffff'); }
    }
    corpses = corpses.filter(cb => !cb.broken);
    for (const pc of pieces) simPiece(pc, dt, room, panes);
    if (pieces.length > 260) pieces.splice(0, pieces.length - 260);
    // crates
    for (const c of crates) {
      c.vy = Math.min(c.vy + G * dt, 1500);
      if (c.grounded) c.vx = approach(c.vx, 0, 900 * dt), c.vr = approach(c.vr, 0, 20 * dt);
      const out = room.moveBody(c, dt, panes);
      if (out.wall) c.vx = -c.vx * 0.3;
      if (out.landed && Math.abs(c.vy) < 1) { c.vr *= 0.5; Sfx.thud(0.5); }
      c.rot += c.vr * dt;
      if (c.grounded) c.rot = lerp(c.rot, Math.round(c.rot / (Math.PI / 2)) * (Math.PI / 2), 1 - Math.exp(-10 * dt));
    }
    // dropped guns
    for (const g of pickups) {
      g.t += dt;
      g.vy += G * dt;
      const nx = g.x + g.vx * dt, ny = g.y + g.vy * dt;
      const ground = room.solidAt(nx, ny + 3, panes) || room.platforms.some(p => nx > p.x1 && nx < p.x2 && g.y + 3 <= p.y && ny + 3 >= p.y);
      if (ground) { g.vy *= -0.25; g.vx *= 0.5; g.vr *= 0.4; if (Math.abs(g.vy) < 30) { g.vy = 0; g.rest = true; } }
      else if (room.solidAt(nx, ny - 2, panes)) g.vx *= -0.4;
      else { g.x = nx; g.y = ny; g.rest = false; }
      if (g.rest) { g.vx = approach(g.vx, 0, 900 * dt); g.rot = lerp(g.rot, Math.cos(g.rot) >= 0 ? 0 : Math.PI, 1 - Math.exp(-12 * dt)); }
      else g.rot += g.vr * dt;
    }
    pickups = pickups.filter(g => !(g.empty && g.t > -96 && g.rest) && g.y < room.h + 200);
  }

  /* -------------------------------------------------------- room flow */
  function checkRoomFlow(dt) {
    if (clearT >= 0) clearT += dt;
    if (state === 'dead') {
      const again = deathT > 0.45 && (pressed.has('reload') || pressed.has('jump') || pressed.has('shoot'));
      if (mode === 'campaign' && (deathT > 2.6 || again)) restartRoom();
      return;
    }
    if (state !== 'play' || !player.alive || !room.door || fade) return;
    const d = room.door;
    if (doorOpen && Math.abs(player.x - d.x) < 24 && Math.abs(player.y - d.y) < 6) {
      Sfx.door();
      const last = mode === 'campaign' && roomIdx >= level.rooms.length - 1;
      run.rooms++;
      if (mode === 'endless') { endless.n++; track('endlessRooms'); Save.data.endlessRooms++; }
      if (last) { completeLevel(); return; }
      fade = { phase: 'out', t: 0, cb: () => { loadRoom(roomIdx + 1); emit('room'); } };
    }
  }

  function restartRoom() {
    if (fade) return;
    fade = {
      phase: 'out', t: 0.12, cb: () => {
        resetRoomEntities(); snapCamera(); state = 'play'; slowOn = false; focus = Math.max(focus, 0.6);
        emit('respawn');
      },
    };
  }
  function revive() {
    // endless: get back up where you fell, with a moment of grace
    const p = player;
    const skin = SKIN[Save.data.skin] || SKINS[0];
    const np = makeChar(p.x, p.y, { color: skin.body, dark: skin.dark, shine: skin.shine, rainbow: skin.rainbow, hat: Save.data.hat, deadColor: deadCol() });
    np.isPlayer = true; np.weapon = p.weapon; np.weapon.ammo = WEAPON[np.weapon.id].mag; np.weapon.reloadT = 0; np.pickup = null; np.invuln = 2;
    if (!p.body.broken) pieces.push(...p.body.breakApart());
    player = np; endless.revived = true;
    bullets = bullets.filter(b => b.owner === 'p');
    for (const e of enemies) { e.reactT = Math.max(e.reactT, 1); e.cd = Math.max(e.cd, 1); e.charge = 0; e.burst = 0; }
    focus = 1; state = 'play'; deathT = 0;
    Fx.ring(np.x, np.y - 46, 200, '#7fb0e2', 8, 0.6);
    Sfx.slowIn();
  }

  function completeLevel() {
    state = 'complete';
    Sfx.win();
    const par = level.par;
    const stars = 1 + (run.time <= par ? 1 : 0) + (run.deaths === 0 ? 1 : 0);
    emit('complete', { level: levelIdx, stars, time: run.time, par, score: run.score, kills: run.kills, headshots: run.headshots, deaths: run.deaths, bestCombo: run.bestCombo });
  }
  function endEndless() {
    state = 'over';
    const best = Save.data.endlessBest;
    const res = { score: run.score, rooms: endless.n, kills: run.kills, best, isBest: run.score > best, time: run.time, headshots: run.headshots };
    if (res.isBest) { Save.data.endlessBest = run.score; Save.save(); Platform.submitScore(run.score); }
    return res;
  }

  function track(stat, n = 1) {
    if (mode === 'menu') return;
    const done = Save.track(stat, n);
    if (done) emit('mission', done);
  }

  /* ------------------------------------------------------------ render */
  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const th = room.theme;
    // the void around the room
    const bg = ctx.createRadialGradient(sw * 0.5, sh * 0.35, 0, sw * 0.5, sh * 0.4, Math.max(sw, sh) * 0.8);
    bg.addColorStop(0, th.voidHi); bg.addColorStop(1, th.void);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, sw, sh);

    const z = cam.zoom;
    ctx.save();
    ctx.translate(sw / 2, sh / 2); ctx.scale(z, z); ctx.translate(-cam.x + cam.kx, -cam.y + cam.ky);
    View.V.x = cam.x; View.V.y = cam.y + 20;
    View.rel = false;
    room.drawBack(ctx, clock, doorOpen, panes);
    room.drawFront(ctx);

    // gameplay plane
    const V = View.V;
    ctx.save();
    ctx.translate(V.x, V.y); ctx.scale(KP, KP); ctx.translate(-V.x, -V.y);
    View.rel = true;
    drawShadows();
    for (const br of barrels) if (!br.gone) drawBarrel(br);
    for (const c of crates) drawCrate(c);
    for (const g of pickups) drawPickup(g);
    for (const pc of pieces) drawPiece(ctx, pc);
    for (const cb of corpses) cb.draw(ctx);
    for (const e of enemies) if (e.alive) { drawLaser(e); e.body.draw(ctx); }
    drawGhosts();
    if (state !== 'menu' || true) player.body.draw(ctx);
    if (player.invuln > 0 && player.alive) { ctx.globalAlpha = 0.3 + 0.3 * Math.sin(clock * 30); Glow.draw(ctx, '#7fb0e2', player.x, player.y - 46, 70, 0.5); ctx.globalAlpha = 1; }
    drawBullets();
    Fx.draw(ctx, th.dark);
    drawPickupPrompt();
    Fx.drawTexts(ctx, z);
    View.rel = false;
    ctx.restore();
    ctx.restore();

    // screen-space overlays
    drawOverlays();
  }

  function groundBelow(x, y) {
    for (let d = 0; d < 400; d += 4) {
      if (room.solidAt(x, y + d)) return Math.floor((y + d) / SUB) * SUB;
      for (const p of room.platforms) if (x > p.x1 && x < p.x2 && y + d >= p.y && y + d - 4 < p.y) return p.y;
    }
    return null;
  }
  function drawShadows() {
    const list = [player, ...enemies.filter(e => e.alive)];
    ctx.fillStyle = room.theme.dark ? 'rgba(0,0,0,0.35)' : 'rgba(40,40,60,0.13)';
    for (const c of list) {
      const gy = c.grounded ? c.y : groundBelow(c.x, c.y);
      if (gy == null) continue;
      const k = clamp(1 - (gy - c.y) / 300, 0.2, 1);
      ctx.beginPath(); ctx.ellipse(c.x, gy, 22 * c.s * k, 5 * k, 0, 0, TAU); ctx.fill();
    }
  }
  function drawGhosts() {
    for (const g of ghosts) {
      const a = (1 - g.t / 0.28) * 0.28;
      ctx.strokeStyle = rgba(g.col, a); ctx.lineCap = 'square';
      for (const st of STICKS) {
        if (st[5] === 'head') continue;
        ctx.lineWidth = st[3] * 0.9;
        ctx.beginPath(); ctx.moveTo(g.pts[st[0]].x, g.pts[st[0]].y); ctx.lineTo(g.pts[st[1]].x, g.pts[st[1]].y); ctx.stroke();
      }
      ctx.fillStyle = rgba(g.col, a);
      ctx.fillRect(g.pts[J.HEAD].x - 9, g.pts[J.HEAD].y - 9, 18, 18);
    }
  }
  function drawLaser(e) {
    const d = e.def;
    if (!d.gun || !e.alert || e.reactT > 0.35 || !player.alive) return;
    const k = d.laser ? e.charge / d.aim : e.charge / d.aim;
    if (k <= 0 && !d.laser) return;
    const len = WEAPON[d.gun] ? WEAPON[d.gun].len : 16;
    const m = e.body.muzzle(len);
    const ex = m.x + Math.cos(e.aim) * 1400, ey = m.y + Math.sin(e.aim) * 1400;
    const hit = room.ray(m.x, m.y, ex, ey, panes, 8);
    const tx = hit ? hit.x : ex, ty = hit ? hit.y : ey;
    const a = d.laser ? 0.12 + k * 0.6 : k * 0.4;
    ctx.strokeStyle = rgba('#ff3344', a);
    ctx.lineWidth = d.laser ? 1 + k * 1.6 : 1.2;
    ctx.setLineDash(d.laser ? [] : [6, 6]);
    ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.setLineDash([]);
    if (k > 0.6) Glow.draw(ctx, '#ff3344', m.x, m.y, 10 + k * 8, k * 0.8);
    if (d.laser) Glow.draw(ctx, '#ff3344', tx, ty, 8, a);
  }
  function drawBullets() {
    for (const b of bullets) {
      const sp = Math.hypot(b.vx, b.vy), ux = b.vx / sp, uy = b.vy / sp;
      if (b.owner === 'p') {
        const tl = Math.min(dist(b.x, b.y, b.ox, b.oy), 90);
        const g = ctx.createLinearGradient(b.x - ux * tl, b.y - uy * tl, b.x, b.y);
        g.addColorStop(0, 'rgba(255,210,120,0)'); g.addColorStop(1, 'rgba(255,214,130,0.95)');
        ctx.strokeStyle = g; ctx.lineWidth = b.big ? 3.4 : 2.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(b.x - ux * tl, b.y - uy * tl); ctx.lineTo(b.x, b.y); ctx.stroke();
        Glow.draw(ctx, '#ffd27a', b.x, b.y, 7, 0.8);
      } else {
        // enemy rounds: dark slugs with a faint white wake, easy to read in slow motion
        const tl = Math.min(dist(b.x, b.y, b.ox, b.oy), b.rifle ? 140 : 70);
        ctx.strokeStyle = room.theme.dark ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.75)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(b.x - ux * tl, b.y - uy * tl); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(uy, ux));
        ctx.fillStyle = room.theme.dark ? '#ff8a8a' : '#3a3d48';
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(1, -2.6); ctx.lineTo(-8, -2.6); ctx.lineTo(-8, 2.6); ctx.lineTo(1, 2.6); ctx.closePath(); ctx.fill();
        ctx.restore();
        if (ts < 0.6) Glow.draw(ctx, '#ff4f5e', b.x, b.y, 12, 0.35);
      }
    }
  }
  function drawCrate(c) {
    const s = c.w / 2, cy = c.y - s, co = Math.cos(c.rot), si = Math.sin(c.rot);
    const P = (a, b) => [c.x + a * co - b * si, cy + a * si + b * co];
    const col = room.theme.dark ? '#7a6a55' : '#d9c4a0';
    prism(ctx, [P(-s, -s), P(s, -s), P(s, s), P(-s, s)], ZP - 0.06, ZP + 0.06, col, shade(col, 0.15), shade(col, -0.15));
    ctx.strokeStyle = shade(col, -0.25); ctx.lineWidth = 1.5;
    ctx.beginPath(); const a = P(-s + 3, -s + 3), b = P(s - 3, s - 3), q = P(s - 3, -s + 3), r = P(-s + 3, s - 3);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(r[0], r[1]); ctx.closePath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  function drawBarrel(br) {
    const x0 = br.x - br.w / 2, y0 = br.y - br.h;
    prism(ctx, [[x0, y0], [x0 + br.w, y0], [x0 + br.w, br.y], [x0, br.y]], ZP - 0.06, ZP + 0.06, '#ff8a3d', '#ffb070', '#d0632a');
    ctx.fillStyle = '#2a2c33';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x0 + i * 8, y0 + 14); ctx.lineTo(x0 + i * 8 + 5, y0 + 14); ctx.lineTo(x0 + i * 8 + 1, y0 + 24); ctx.lineTo(x0 + i * 8 - 4, y0 + 24); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x0 + 4, y0 + 3, 3, br.h - 6);
    const pulse = 0.5 + 0.5 * Math.sin(clock * 5 + br.x);
    Glow.draw(ctx, '#ff8a3d', br.x, br.y - 20, 34, 0.12 + pulse * 0.1);
  }
  function drawPickup(g) {
    if (g.empty && g.t > 0.5) ctx.globalAlpha = 0.5;
    drawGun(ctx, { x: g.x + 4 * Math.cos(g.rot), y: g.y + 3 + 4 * Math.sin(g.rot) }, g.rot, g.id, false);
    ctx.globalAlpha = 1;
    if (!g.empty && g.rest && player.alive) {
      const a = 0.35 + 0.25 * Math.sin(clock * 4);
      Glow.draw(ctx, '#ffd27a', g.x, g.y - 2, 18, a);
    }
  }
  function drawPickupPrompt() {
    const g = player.nearPickup;
    if (!g || !player.alive || state !== 'play') return;
    const x = g.x, y = g.y - 34;
    ctx.fillStyle = 'rgba(14,16,24,0.85)';
    ctx.beginPath(); ctx.roundRect(x - 44, y - 13, 88, 24, 5); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = '800 11px Rubik, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((input.touch ? 'GRAB ' : 'E  ') + WEAPON[g.id].name.toUpperCase(), x, y);
  }

  function drawOverlays() {
    // slow-motion grade
    const s = clamp((1 - ts) / (1 - SLOW_SCALE), 0, 1);
    if (s > 0.01 && state !== 'menu') {
      const v = ctx.createRadialGradient(sw / 2, sh / 2, Math.min(sw, sh) * 0.35, sw / 2, sh / 2, Math.max(sw, sh) * 0.75);
      v.addColorStop(0, 'rgba(40,70,120,0)');
      v.addColorStop(1, `rgba(30,50,95,${0.32 * s})`);
      ctx.fillStyle = v; ctx.fillRect(0, 0, sw, sh);
      ctx.fillStyle = `rgba(90,140,220,${0.06 * s})`; ctx.fillRect(0, 0, sw, sh);
    }
    // kill cam letterbox
    const lb = cam.focusT > 0 ? Math.min(1, cam.focusT * 4) : 0;
    if (lb > 0) {
      ctx.fillStyle = '#0c0e15';
      const h = sh * 0.07 * lb;
      ctx.fillRect(0, 0, sw, h); ctx.fillRect(0, sh - h, sw, h);
    }
    if (flash > 0) { ctx.fillStyle = rgba(flashCol, flash * 0.45); ctx.fillRect(0, 0, sw, sh); }
    // off-screen threats
    if (state === 'play') {
      for (const e of enemies) {
        if (!e.alive || !e.alert) continue;
        const p = worldToScreen(e.x, e.y - 50);
        if (p.x > 0 && p.x < sw && p.y > 0 && p.y < sh) continue;
        const x = clamp(p.x, 26, sw - 26), y = clamp(p.y, 70, sh - 26);
        const a = Math.atan2(p.y - y, p.x - x);
        ctx.save(); ctx.translate(x, y); ctx.rotate(a);
        ctx.fillStyle = 'rgba(226,67,75,0.85)';
        ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -9); ctx.lineTo(-3, 0); ctx.lineTo(-8, 9); ctx.fill();
        ctx.restore();
      }
      if (doorOpen && room.door && clearT > 0.5) {
        const p = worldToScreen(room.door.x, room.door.y - 50);
        if (p.x < 0 || p.x > sw) {
          const x = clamp(p.x, 34, sw - 34), y = clamp(p.y, 80, sh - 40);
          ctx.save(); ctx.translate(x, y); ctx.rotate(p.x < 0 ? Math.PI : 0);
          ctx.fillStyle = rgba('#3ee08b', 0.7 + 0.3 * Math.sin(clock * 6));
          ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-8, -12); ctx.lineTo(-2, 0); ctx.lineTo(-8, 12); ctx.fill();
          ctx.restore();
        }
      }
    }
    // crosshair
    if (state === 'play' && !input.touch && input.mouse.on && !paused) drawCrosshair(input.mouse.x, input.mouse.y);
    // room fade
    if (fade) {
      const a = fade.phase === 'out' ? clamp(fade.t / 0.32, 0, 1) : 1 - clamp(fade.t / 0.32, 0, 1);
      ctx.fillStyle = rgba(room.theme.void, a); ctx.fillRect(0, 0, sw, sh);
    }
  }
  function drawCrosshair(x, y) {
    const w = curWeapon(), ws = player.pickup || player.weapon;
    const r = 11 + (player.weapon.kick + player.weapon.kick2) * 5;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = room.theme.dark ? '#ffffff' : '#1d2130'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(Math.cos(a) * (r + 7), Math.sin(a) * (r + 7)); ctx.stroke(); }
    ctx.fillStyle = '#e2434b'; ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, TAU); ctx.fill();
    // ammo / reload ring
    if (!player.pickup && player.weapon.reloadT > 0) {
      const k = 1 - player.weapon.reloadT / WEAPON[player.weapon.id].reload;
      ctx.strokeStyle = '#ffc933'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r + 12, -Math.PI / 2, -Math.PI / 2 + k * TAU); ctx.stroke();
    } else {
      const mag = player.pickup ? Math.max(ws.ammo, 1) : w.mag;
      const k = ws.ammo / mag;
      ctx.strokeStyle = room.theme.dark ? 'rgba(255,255,255,0.35)' : 'rgba(29,33,48,0.25)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r + 12, -Math.PI / 2, -Math.PI / 2 + k * TAU); ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------- api */
  return {
    init, resize, update, render, on, setKey, press, setMouse, setAxis, setAimStick,
    startMenu, startLevel, startEndless, restartRoom, revive, endEndless, toggleSlow,
    get state() { return state; }, get mode() { return mode; }, get paused() { return paused; },
    set paused(v) { paused = v; },
    get focus() { return focus; }, get slowOn() { return slowOn; }, get ts() { return ts; },
    get run() { return run; }, get level() { return level; }, get levelIdx() { return levelIdx; }, get roomIdx() { return roomIdx; },
    get roomCount() { return mode === 'endless' ? endless.n + 1 : level.rooms.length; },
    get endless() { return endless; },
    get player() { return player; }, get enemiesLeft() { return enemies.filter(e => e.alive).length; },
    get weaponInfo() {
      if (!player) return null;
      const w = curWeapon(), ws = player.pickup || player.weapon;
      return { name: w.name, ammo: ws.ammo, mag: player.pickup ? null : w.mag, reload: !player.pickup && player.weapon.reloadT > 0, pickup: !!player.pickup };
    },
    get nearPickup() { return player && player.nearPickup; },
    get input() { return input; },
    get doorOpen() { return doorOpen; },
    setMenuInset(px) { menuInset = px; },
    debugRoom(i) { loadRoom(i); state = 'play'; },
    debugClear() { for (const e of enemies) if (e.alive) killEnemy(e, 300, -200, J.NECK, { head: false }); },
    get enemies() { return enemies; }, get pieces() { return pieces; }, worldToScreen,
  };
})();
