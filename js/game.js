'use strict';
/* =========================================================================
   Game: rooms, the player, enemies and their AI, bullets, slow motion,
   style scoring, the camera and the render pipeline.
   ========================================================================= */

const Game = (() => {
  // ---- tuning
  const G = 2500, WALK = 250, SPRINT = 425, ACC_G = 3200, ACC_A = 1800, JUMP_V = 840;
  const SLIDE_V = 610, SLIDE_T = 0.55, STAND_H = 92, SLIDE_H = 28;
  const SLOW_SCALE = 0.26;
  const RETRY_DELAY = 0.9;
  const FLIP_CHAIN = 3;            // back-to-back flips allowed before you have to touch down properly         // seconds after dying before a click/tap/key restarts the room

  let canvas, ctx, dpr = 1, sw = 0, sh = 0;
  const cam = { x: 0, y: 0, zoom: 1, shake: 0, kick: 0, kx: 0, ky: 0, focus: null, focusT: 0 };
  let state = 'menu';           // menu | play | dead | fade | complete
  let mode = 'menu';            // menu | campaign | endless
  let paused = false;
  let level = null, levelIdx = 0, roomIdx = 0, room = null;
  let ambushes = [], grenades = [];
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

  const diff = () => (mode === 'endless' ? clamp(0.25 + endless.n * 0.06, 0, 1) : mode === 'campaign' ? levelDiff(levelIdx) : 0.3);

  function newRun() {
    return { score: 0, kills: 0, headshots: 0, deaths: 0, combo: 0, comboT: 0, bestCombo: 0, deflects: 0, time: 0, rooms: 0, lives: 3 };
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
    player.x = 560; player.y = room.h - TILE; player.body = new Body({ x: player.x, y: player.y, color: player.body.color, dark: player.body.dark, shine: player.body.shine, rainbow: player.body.rainbow, prism: player.body.prism, hat: Save.data.hat, deadColor: deadCol() });
    applyArmor(player);
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

  let roomFocus = 1, roomPickup = null, roomArmor = null;     // what you walked into the room with
  function loadRoom(i) {
    roomIdx = i;
    roomFocus = i === 0 && mode === 'campaign' ? 1 : focus;    // a retry starts with what you walked in with
    roomPickup = i > 0 && player && player.alive && player.pickup ? { id: player.pickup.id, ammo: player.pickup.ammo } : null;
    roomArmor = i > 0 && player && player.armorHp ? { slots: JSON.parse(JSON.stringify(player.armorHp)), blastUsed: player.blastUsed } : null;
    const def = roomDef(i);
    room = new Room(def, mode === 'endless' ? def.theme : level.theme);
    resetRoomEntities();
    snapCamera();
  }

  function resetRoomEntities() {
    enemies = []; bullets = []; grenades = []; pieces = []; corpses = []; pickups = []; ghosts = []; pendingBooms = [];
    room.decals = [];
    doorAnim = 0;
    Fx.clear();
    const skin = SKIN[Save.data.skin] || SKINS[0];
    player = makeChar(room.spawn.x, room.spawn.y, {
      color: skin.body, dark: skin.dark, shine: skin.shine, rainbow: skin.rainbow, prism: skin.prism, hat: Save.data.hat, deadColor: deadCol(),
    });
    player.isPlayer = true;
    applyArmor(player, mode === 'menu' ? null : roomArmor);
    const w = WEAPON[Save.data.weapon] || WEAPONS[0];
    player.weapon = { id: w.id, ammo: w.mag, cd: 0, reloadT: 0, kick: 0, kick2: 0, alt: 0 };
    player.pickup = roomPickup && mode !== 'menu' ? { id: roomPickup.id, ammo: roomPickup.ammo, cd: 0.2, held: true } : null;
    player.facing = 1; player.aim = 0;
    for (const d of room.enemyDefs) enemies.push(makeEnemy(d.type, d.x, d.y, d.away));
    // each ambush picks where it springs from: behind you most often, sometimes above, sometimes ahead
    ambushes = room.ambushDefs.map((a, i) => Object.assign({}, a, { state: 'wait', t: 0, anim: 0, mode: ['behind', 'above', 'behind', 'ahead'][(i + Math.floor(a.x / 40)) % 4] }));
    room.ambushState = ambushes;
    crates = room.crateDefs.map(c => Object.assign(Rigid.make({ x: c.x, y: c.y, a: 0, L: 32, T: 32, density: 3.2, e: 0.12, mu: 0.75 }), { crate: true, sleep: 1, hp: 4 }));
    room.dyn = [];
    barrels = room.barrelDefs.map(b => ({ x: b.x, y: b.y, w: 30, h: 42, hp: 1, fuse: -1, gone: false, seed: Math.random() * 10 }));
    panes = room.panesDef.map(g => Object.assign({}, g, { broken: false }));
    doorOpen = true;            // exits are always open: clearing the room is optional, just worth points
    clearT = -1; roomT = 0; deathT = 0;
    forcedT = 0; hitstop = 0;
  }
  // Armour durability lasts a whole level (or Endless run): damage carries from room to room and
  // through deaths and retries, and it's only fully repaired when a level starts.
  function applyArmor(p, snap) {
    p.armorHp = {}; p.blastUsed = snap ? snap.blastUsed : false; p.armorInv = 0;
    const show = {}, broken = {};
    for (const slot of ['head', 'body', 'legs']) {
      const ar = ARMOR_BY[Save.data.armor[slot]];
      if (!ar || !Save.owns('armor', ar.id)) continue;
      const prev = snap && snap.slots[slot] && snap.slots[slot].id === ar.id ? snap.slots[slot].hp : ar.hits;
      p.armorHp[slot] = { id: ar.id, hp: prev, max: ar.hits }; show[slot] = ar;
      if (prev <= 0) broken[slot] = true;
    }
    p.body.armor = show; p.body.armorBroken = broken;
  }
  const LEG_JOINTS = new Set([J.FKNEE, J.FFOOT, J.BKNEE, J.BFOOT]);
  // Returns true if armour took the hit. kind: 'shot' | 'melee' | 'blast'
  function armorBlock(idx, kind, killer, vx, vy) {
    const p = player;
    if (!p.armorHp) return false;
    const zone = idx === J.HEAD ? 'head' : LEG_JOINTS.has(idx) ? 'legs' : 'body';
    if (kind === 'blast') {
      const b = p.armorHp.body, ar = b && ARMOR_BY[b.id];
      if (!ar || ar.ability !== 'blast' || p.blastUsed) return false;
      p.blastUsed = true; p.armorInv = 0.4;
      Fx.text(p.x, p.y - 120, 'BLAST PROOF', '#1d2130', 18); Sfx.armor();
      p.vx += Math.sign(vx || 1) * 380; p.vy = Math.min(p.vy, -420); p.grounded = false;
      emit('armor');
      return true;
    }
    if (p.armorInv > 0 && (p.lastBlockZone === zone || kind === 'melee')) return true;    // one shotgun blast or one punch = one hit
    const piece = p.armorHp[zone];
    if (!piece || piece.hp <= 0) return false;
    const ar = ARMOR_BY[piece.id];
    piece.hp--; p.armorInv = kind === 'melee' ? 0.6 : 0.15; p.lastBlockZone = zone;
    const pt = p.body.pts[idx] || p.body.center();
    Sfx.armor(); Fx.sparks(pt.x, pt.y, Math.atan2(-vy, -vx), 10, '#ffffff', 420); Fx.chips(pt.x, pt.y, -vx, -vy, ar.col, 4);
    p.body.flash = 0.7; p.body.shove(vx * 0.3, vy * 0.2, idx);
    p.vx += Math.sign(vx || 1) * (kind === 'melee' ? 420 : 90);
    if (ar.ability === 'focus') { focus = Math.min(1, focus + 0.3); Fx.text(p.x, p.y - 140, '+SLOW-MO', '#4da3ff', 16); }
    if (ar.ability === 'deflect' && kind === 'shot') {
      // the round goes straight back where it came from
      const tgt = killer && killer.alive ? killer.body.center() : { x: pt.x - vx, y: pt.y - vy };
      const a = Math.atan2(tgt.y - pt.y, tgt.x - pt.x);
      bullets.push({ x: pt.x, y: pt.y, ox: pt.x, oy: pt.y, vx: Math.cos(a) * BULLET_SPEED, vy: Math.sin(a) * BULLET_SPEED, owner: 'p', pierce: 0, life: 2.4, t: 0, hits: [], shooter: p, kind: 'deflect', dmg: 1 });
      Fx.ring(pt.x, pt.y, 26, '#8fd0ff', 3, 0.3); Sfx.deflect();
      styleEvent(pt.x, pt.y, 'REFLECT', 60);
    }
    if (ar.ability === 'thorns' && kind === 'melee' && killer && killer.alive) {
      if (killer.def.brute) { killer.bstate = 'stun'; killer.bt = 1.6; killer.vx = -killer.facing * 300; Fx.text(killer.x, killer.y - 140, 'STUNNED', '#1d2130', 16); }
      else killEnemy(killer, -killer.facing * 900, -350, J.NECK, { head: false });
    }
    if (piece.hp <= 0) {
      p.body.armorBroken[zone] = true;
      Fx.chips(pt.x, pt.y, vx, vy - 200, ar.col, 14); Sfx.smash();
      Fx.text(p.x, p.y - 124, zone.toUpperCase() + ' ARMOR BROKEN', '#e2434b', 16);
    } else Fx.text(p.x, p.y - 124, 'BLOCKED', '#1d2130', 15);
    emit('armor');
    return true;
  }

  function makeEnemy(type, x, y, away) {
    const def = ENEMIES[type];
    const e = makeChar(x, y, { color: def.color || '#e2434b', dark: def.dark || '#b02a33', deadColor: deadCol(), scale: def.scale, hat: def.hat });
    e.type = type; e.def = def; e.hp = def.hp; e.gun = def.gun;
    const towardSpawn = room.spawn.x < x ? -1 : 1;
    e.facing = away ? -towardSpawn : towardSpawn;
    e.aim = e.facing > 0 ? 0.15 : Math.PI - 0.15;
    e.alert = false; e.reactT = 0; e.cd = rand(0.2, 0.6); e.charge = 0; e.burst = 0; e.burstT = 0; e.seeT = 0; e.lostT = 0;
    e.homeX = x; e.strafeT = rand(1, 3); e.moveDir = 0; e.meleeT = -1; e.jumpCd = 0; e.flinch = 0;
    e.body.gunId = def.gun;
    return e;
  }

  // Surprise enemies: cross a trigger line and someone appears where you aren't looking: behind
  // you, or up on a ledge or deck above, or further ahead. Still fair: never closer than ~280px,
  // they make a faint sound when they appear (the off-screen arrow points to them), and they take
  // a longer beat before the first shot, longest when they're behind you.
  function standSpot(x, fromY) {
    if (x < 30 || x > room.w - 30) return null;
    const gy = groundBelow(x, fromY);
    if (gy == null) return null;
    if (room.boxHit(x - 13, gy - 92, x + 13, gy - 2, panes) || !room.isInside(x, gy - 40)) return null;
    return { x, y: gy };
  }
  function ambushSpot(a) {
    const p = player, dir = Math.abs(p.vx) > 40 ? Math.sign(p.vx) : p.facing;
    const tries = {
      behind: () => { for (let d = 300; d <= 520; d += 20) { const s = standSpot(p.x - dir * d, p.y - 140); if (s && Math.abs(s.y - p.y) < 180) return s; } return null; },
      above: () => {
        for (let d = 160; d <= 560; d += 40) for (const sg of [dir, -dir]) {
          const x = p.x + sg * d;
          for (let y = p.y - 360; y < p.y - 80; y += 20) { const s = standSpot(x, y); if (s && s.y < p.y - 70) return s; }
        }
        return null;
      },
      ahead: () => (Math.abs(p.x - a.x) >= 280 && (a.x - p.x) * dir > 0 ? { x: a.x, y: a.y } : null),
    };
    for (const m of [a.mode, 'behind', 'above', 'ahead']) { const s = tries[m](); if (s && dist(s.x, s.y, p.x, p.y) >= 280) return { s, m }; }
    return null;
  }
  function updateAmbushes() {
    for (const a of ambushes) {
      if (a.state !== 'wait' || !player.alive || player.x < a.trigger) continue;
      const spot = ambushSpot(a);
      a.state = spot ? 'done' : 'skip';
      if (!spot) { emit('ambushSkip'); continue; }
      // surprise enemies only ever carry light weapons: a pistol or a knife
      const e = makeEnemy(a.type === 'knife' ? 'knife' : 'grunt', spot.s.x, spot.s.y, false);
      e.surpriseT = 1.3;
      e.facing = player.x < e.x ? -1 : 1; e.aim = Math.atan2(player.y - 60 - (e.y - 74), player.x - e.x);
      e.alert = true; e.reactT = e.def.react * reactMul() + (spot.m === 'behind' ? 0.75 : 0.5);
      e.lastX = player.x; e.lastY = player.y - 58;
      e.body.alpha = 0;
      Fx.dust(e.x, e.y, 6, room.theme.side, 0.6);
      Sfx.appear();
      enemies.push(e);
      emit('ambush');
    }
  }

  const deadCol = () => (room && room.theme.dark ? '#c9cfdb' : '#eeeef1');

  function makeChar(x, y, o) {
    const s = o.scale || 1;
    const c = {
      x, y, vx: 0, vy: 0, w: 24 * s, h: STAND_H * s, s, grounded: true, plat: null, dropPlat: null, dropT: 0,
      facing: 1, aim: 0, alive: true, slideT: 0, slideDir: 1, crawl: false, flip: 0, flipping: false, flipDir: 1,
      coyote: 0, jumpBuf: 0, airT: 0, stepPh: 0,
      body: new Body({ x, y, scale: s, color: o.color, dark: o.dark, shine: o.shine, rainbow: o.rainbow, prism: o.prism, hat: o.hat, deadColor: o.deadColor }),
    };
    return c;
  }

  /* ------------------------------------------------------------ input */
  function setKey(k, v) { input[k] = v; }
  function press(a) { pressed.add(a); if (a === 'shoot') input.shootBuf = 0.16; }
  function setMouse(x, y) { input.mouse.x = x; input.mouse.y = y; input.mouse.on = true; input.touch = false; }
  function setAxis(x, y) { input.axis = x; input.axisY = y; input.touch = true; }
  function setAimStick(a) { input.aimStick = a; input.touch = true; }   // null or angle
  // touch: the finger on the right side of the screen; null when lifted
  function setTouchTarget(x, y) {
    input.touch = true;
    if (x == null) { input.touchTarget = null; return; }
    if (!input.touchTarget) input.shootBuf = 0.2;          // a quick tap still fires once
    input.touchTarget = { x, y }; input.lastTouch = { x, y };
  }

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
      if (slowOn) { focus -= dtReal * 0.23; if (focus <= 0) { focus = 0; slowOn = false; Sfx.slowOut(); } }
      else focus = Math.min(1, focus + dtReal * 0.045);
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
      updateGrenades(wdt);
      updateWorldBits(wdt);
      if (state === 'play') updateAmbushes();
      updateDoor(dtReal);
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
    player.body.pose({ x: player.x, y: player.y, facing: 1, aim: player.aim, vx: 0, vy: 0, grounded: true, gun: true, twoHand: TWO_HAND.has(w.id), dual: w.dual, kick: player.weapon.kick }, wdt);
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
    const tapAim = input.touchTarget || ((input.shootBuf || 0) > 0 ? input.lastTouch : null);
    if (input.touch && tapAim) {
      // aim at the tapped point; snap onto an enemy right next to it
      const m = screenToWorld(tapAim.x, tapAim.y);
      const sy = p.slideT > 0 || p.crawl ? p.y - 24 : p.y - 74;
      let tx = m.x, ty = m.y;
      if (Save.data.settings.aimAssist) {
        let bd = 90;
        for (const e of enemies) {
          if (!e.alive) continue;
          const c = e.body.center(), d = dist(c.x, c.y, m.x, m.y);
          if (d < bd) { bd = d; tx = c.x; ty = c.y - 6; }
        }
      }
      p.aim = Math.atan2(ty - sy, tx - p.x);
    } else if (input.touch) {
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
      const sy = p.slideT > 0 || p.crawl ? p.y - 24 : p.y - 74;
      p.aim = Math.atan2(m.y - sy, m.x - p.x);
    }
    const aimF = Math.cos(p.aim) >= 0 ? 1 : -1;
    if (!p.flipping) p.facing = aimF;

    // ---- movement intent
    let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (input.touch && Math.abs(input.axis) > 0.15) mx = input.axis;
    const sprint = input.sprint || (input.touch && Math.abs(input.axis) > 0.88);
    p.sprinting = sprint && Math.abs(mx) > 0.1;
    const spinning = (p.pickup || p.weapon).spin > 0.05 || ((p.pickup || p.weapon).chargeT || 0) > 0.05;
    if (spinning) p.sprinting = false;
    const swift = p.armorHp && p.armorHp.legs && ARMOR_BY[p.armorHp.legs.id].ability === 'swift' ? 1.07 : 1;
    const want = swift * mx * (p.sprinting ? SPRINT : WALK) * (spinning && w.heavy ? 0.45 : spinning ? 0.7 : 1);

    // timers
    p.coyote = p.grounded ? 0.1 : p.coyote - dt;
    p.jumpBuf -= dt;
    if (pressed.has('jump')) p.jumpBuf = 0.13;
    if (p.dropT > 0) { p.dropT -= dt; if (p.dropT <= 0) p.dropPlat = null; }

    // ---- slide (RMB/S/C, or Shift while moving). In the air it becomes a dive that lands into a slide.
    const wantSlide = pressed.has('slide') || (pressed.has('shiftSlide') && (Math.abs(p.vx) > 140 || !p.grounded));
    if (wantSlide) {
      if (p.grounded && p.plat && Math.abs(p.vx) < 60 && Math.abs(mx) < 0.1 && pressed.has('slide')) { p.dropPlat = p.plat; p.dropT = 0.3; p.grounded = false; p.y += 2; }
      else if (!p.grounded && p.airT > 0.06 && !p.airSlide && !p.crawl) {
        p.airSlide = true; p.flipping = false; p.flip = 0;
        p.slideDir = Math.abs(mx) > 0.1 ? Math.sign(mx) : Math.abs(p.vx) > 40 ? Math.sign(p.vx) : p.facing;
        p.vx = p.slideDir * Math.max(Math.abs(p.vx), 330);
        p.vy = Math.max(p.vy, 0) + 260;
        p.h = SLIDE_H;
        Sfx.slide();
      } else if ((p.grounded || p.airT <= 0.06) && p.slideT <= 0 && !p.crawl && !p.airSlide) startSlide(p, mx);
    }
    // a slide carries its speed and bleeds it off with floor friction, then you stand back up.
    // Under a low ceiling you keep shuffling forward until there's room to stand.
    if (p.slideT > 0) {
      p.slideT -= dt;
      p.vx = approach(p.vx, 0, (p.grounded ? 330 : 60) * dt);
      if (p.grounded && Math.random() < 0.5) Fx.dust(p.x - p.slideDir * 10, p.y, 1, room.theme.side, 0.4);
      if (p.slideT <= 0 || Math.abs(p.vx) < 120) {
        p.slideT = 0;
        if (!tryStand(p)) { p.crawl = true; p.vx = p.slideDir * Math.max(170, Math.abs(p.vx)); }
      }
    }
    if (p.crawl) {
      p.vx = p.slideDir * 170;
      if (tryStand(p, true)) p.crawl = false;
      else {
        // never stay wedged: if the crawl isn't getting anywhere, turn around
        p.crawlStuck = Math.abs(p.x - (p.crawlX || 0)) < 0.5 ? (p.crawlStuck || 0) + dt : 0;
        p.crawlX = p.x;
        if (p.crawlStuck > 0.25) { p.slideDir = -p.slideDir; p.crawlStuck = 0; }
      }
    }
    // safety net: if we're ever standing inside a low ceiling, drop back into a crawl
    if (p.h === STAND_H && p.grounded && !room.canStand(p, STAND_H, panes)) { p.h = SLIDE_H; p.crawl = true; p.flipping = false; if (!p.slideDir) p.slideDir = p.facing; }
    const sliding = p.slideT > 0 || p.crawl || p.airSlide;

    // ---- horizontal accel
    if (!sliding) {
      const acc = p.grounded ? ACC_G : ACC_A;
      p.vx = approach(p.vx, want, acc * dt);
    }

    // ---- jump
    const headroom = room.canStand(p, STAND_H, panes);
    if (p.jumpBuf > 0 && p.crawl && headroom) tryStand(p, true);
    if (p.jumpBuf > 0 && (p.grounded || p.coyote > 0) && !p.crawl && !p.airSlide && headroom) {
      p.jumpBuf = 0; p.coyote = 0;
      p.vy = -JUMP_V;
      if (p.slideT > 0) { p.vx *= 1.05; p.slideT = 0; }
      p.h = STAND_H;
      p.grounded = false;
      // jump while sprinting or sliding (moving fast) = front flip. Flips chain from one jump to the
      // next, up to FLIP_CHAIN in a row; a kill during a flip earns
      // another one, and half a second on the ground resets the chain.
      // the chain only resets after half a second on the ground (see the air timer below)
      p.flipChain = p.flipChain || 0;
      if (Math.abs(p.vx) > 320 && p.flipChain < FLIP_CHAIN) {
        p.flipping = true; p.flip = 0; p.flipDir = Math.sign(p.vx) * p.facing;
        p.flipChain++;
        if (p.flipChain > 1) Fx.text(p.x, p.y - 120, 'FLIP x' + p.flipChain, '#1d2130', 14);
        Sfx.flip();
      } else {
        if (Math.abs(p.vx) > 320) { p.vx *= 0.85; Fx.text(p.x, p.y - 120, 'OUT OF FLIPS', '#e2434b', 13); }
        Sfx.jump();
      }
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
    const fallV = p.vy, fallVx = p.vx;
    p.noStep = sliding;                         // a slide never climbs a step: it stops against it
    const out = room.moveBody(p, dt, panes);
    if (out.wall && p.slideT > 0) { p.slideT = 0; p.vx = 0; if (!tryStand(p)) p.crawl = true; }
    if (p.grounded && p.airSlide) {
      p.airSlide = false;
      startSlide(p, p.slideDir);
      p.vx = p.slideDir * Math.max(Math.abs(p.vx), Math.abs(fallVx) * 1.05, SLIDE_V);
    } else if (out.landed && wasAir) {
      Sfx.land(clamp(fallV / 900, 0.3, 1.2));
      if (fallV > 500) Fx.dust(p.x, p.y, 8);
      if (p.flipping) { p.flipping = false; p.flip = 0; }
    }
    if (!p.grounded) { p.airT += dt; p.groundT = 0; } else { p.airT = 0; p.groundT = (p.groundT || 0) + dt; if (p.groundT > 0.5) p.flipChain = 0; }
    unstick(p, dt);
    if (p.flipping) {
      p.flip += dt * 12.5;
      if (p.flip >= TAU) { p.flip = 0; p.flipping = false; }
    }
    // footsteps
    if (p.grounded && !sliding && Math.abs(p.vx) > 60) {
      p.stepPh += Math.abs(p.vx) * dt / 15;
      if (p.stepPh > Math.PI) { p.stepPh -= Math.PI; Sfx.step(); }
    }
    pushCrates(p);

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
    const holding = input.touch ? (input.touchTarget != null || input.aimStick != null) : input.shoot;
    const ready = pw.ammo > 0 && (p.pickup || p.weapon.reloadT <= 0);
    // minigun: spin up before it fires
    if (w.spinup) {
      const was = pw.spin || 0;
      pw.spin = clamp(was + (holding && ready ? dt / w.spinup : -dt / (w.spinup * 0.6)), 0, 1);
      if (holding && pw.spin < 1 && Math.floor(was * 6) !== Math.floor(pw.spin * 6)) Sfx.spin(pw.spin);
    } else pw.spin = 0;
    let wantShoot;
    if (w.charge) {
      // railgun: hold to charge, release to fire
      if (holding && ready && pw.cd <= 0) {
        const was = pw.chargeT || 0;
        pw.chargeT = was + dt;
        if (was < w.charge && pw.chargeT >= w.charge) Sfx.charged();
        else if (Math.floor(was * 8) !== Math.floor(pw.chargeT * 8) && pw.chargeT < w.charge) Sfx.spin(pw.chargeT / w.charge);
      }
      wantShoot = !holding && (pw.chargeT || 0) >= w.charge;
      if (!holding && (pw.chargeT || 0) < w.charge) pw.chargeT = 0;
    } else if (w.spinup) wantShoot = holding && pw.spin >= 1;
    else wantShoot = input.touch ? holding || input.shootBuf > 0 : (w.auto ? input.shoot : input.shootBuf > 0);
    // burst follow-up rounds
    if (pw.burstLeft > 0) {
      pw.burstT -= dt;
      if (pw.burstT <= 0) {
        if (pw.ammo > 0) { fire(p, w, pw, true); pw.burstT = w.burstGap; }
        pw.burstLeft = pw.ammo > 0 ? pw.burstLeft - 1 : 0;
      }
    }
    if (wantShoot && pw.cd <= 0 && !(pw.burstLeft > 0)) {
      input.shootBuf = 0;
      if (p.pickup) {
        if (p.pickup.ammo > 0) fire(p, w, p.pickup);
        if (p.pickup.ammo <= 0) dropPickupGun(true);
      } else if (p.weapon.reloadT <= 0) {
        if (p.weapon.ammo > 0) {
          fire(p, w, p.weapon);
          if (w.burst) { p.weapon.burstLeft = w.burst - 1; p.weapon.burstT = w.burstGap; }
        } else { Sfx.dry(); startReload(); pw.cd = 0.2; }
      }
      pw.chargeT = 0;
    }
    if (!p.pickup && p.weapon.ammo <= 0 && !(p.weapon.burstLeft > 0) && p.weapon.reloadT <= 0) startReload();

    // ---- pick up guns
    p.nearPickup = null;
    for (const g of pickups) if (g.t > 0.3 && dist(g.x, g.y, p.x, p.y - 20) < 60) p.nearPickup = g;
    if (pressed.has('pick') && p.nearPickup) takePickup(p.nearPickup);

    // ---- slow motion
    if (pressed.has('slow')) toggleSlow();

    // ---- pose
    let slideFront = null, slideBack = null, slope = 0;
    let poseX = p.x;
    if (sliding) {
      // measured in the air too: a mid-air slide lies flat, so it must fold up against walls
      const free = dir => { for (let k = 6; k <= 60; k += 3) if (room.solidAt(p.x + dir * k, p.y - 8, panes) || room.solidAt(p.x + dir * k, p.y - 26, panes)) return k; return 60; };
      slideFront = free(p.facing); slideBack = free(-p.facing);
    } else if (p.flipping) {
      // a tucked flip is wider than the hitbox: draw it nudged off any wall it would poke into
      const free = dir => { for (let k = 8; k <= 34; k += 2) if (room.solidAt(p.x + dir * k, p.y - 30, panes) || room.solidAt(p.x + dir * k, p.y - 52, panes) || room.solidAt(p.x + dir * k, p.y - 74, panes)) return k; return 34; };
      const fr = free(1), fl = free(-1);
      poseX = p.x + (34 - fl) - (34 - fr);
    }
    if (sliding && p.grounded) {
      const gF = groundBelow(p.x + p.facing * 22, p.y - 24), gB = groundBelow(p.x - p.facing * 22, p.y - 24);
      if (gF != null && gB != null) slope = clamp(Math.atan2(gF - gB, 44), -0.45, 0.45);
    }
    p.slopeS = lerp(p.slopeS || 0, slope, 1 - Math.exp(-14 * dt));
    const ww = curWeapon();
    p.body.gunId = ww.id;
    p.body.dual = !!ww.dual;
    p.body.pose({
      x: poseX, y: p.y, facing: p.facing, aim: p.aim, vx: p.vx, vy: p.vy, grounded: p.grounded || p.airSlide, slide: sliding, flip: p.flipping ? p.flip * p.flipDir : 0,
      sprint: p.sprinting, gun: true, twoHand: TWO_HAND.has(ww.id), dual: ww.dual, kick: p.weapon.kick, kick2: p.weapon.kick2,
      slideFront, slideBack, slope: p.slopeS,
      reload: !p.pickup && p.weapon.reloadT > 0 ? 1 - p.weapon.reloadT / WEAPON[p.weapon.id].reload : 0,
    }, dt);
    if (p.body.flash > 0) p.body.flash -= dt * 4;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.armorInv > 0) p.armorInv -= dt;
  }

  // Safety net for every slide state. A slide or crawl that hasn't ended by itself gets ended:
  // a crawl with room to stand stands up, and anything stuck low for too long (or not moving)
  // finds the nearest reachable spot with headroom and stands there.
  function unstick(p, dt) {
    if (p.airSlide && p.grounded) { p.airSlide = false; startSlide(p, p.slideDir); }
    if (p.slideT > 4) p.slideT = 1.3;
    const low = p.slideT > 0 || p.crawl || p.h !== STAND_H;
    if (!low || !p.grounded) { p.lowT = 0; p.lowStill = 0; return; }
    p.lowT = (p.lowT || 0) + dt;
    p.lowStill = Math.abs(p.x - (p.lowX ?? p.x)) < 1 ? (p.lowStill || 0) + dt : 0;
    p.lowX = p.x;
    if (!(p.slideT > 0) && !p.crawl && p.h !== STAND_H) { if (!tryStand(p)) p.crawl = true; }
    if (p.lowT > 2.5 || p.lowStill > 0.6) {
      for (let d = 0; d <= 160; d += 4) for (const sgn of [p.slideDir || 1, -(p.slideDir || 1)]) {
        const x = p.x + sgn * d;
        if (room.canStand({ x, y: p.y, w: p.w }, STAND_H, panes) && room.los(p.x, p.y - 12, x, p.y - 12)) {
          p.x = x; p.h = STAND_H; p.crawl = false; p.slideT = 0; p.airSlide = false; p.lowT = 0; p.lowStill = 0;
          return;
        }
      }
      p.lowT = 0; p.lowStill = 0;
      p.slideDir = -(p.slideDir || 1);
    }
  }

  // stand up if there's headroom here, or a few pixels to either side (so you can't get wedged)
  function tryStand(p, here) {
    for (const dx of here ? [0] : [0, -4, 4, -8, 8, -12, 12, -16, 16]) {
      const t = { x: p.x + dx, y: p.y, w: p.w };
      if (room.canStand(t, STAND_H, panes) && (dx === 0 || room.los(p.x, p.y - 14, t.x, p.y - 14))) {
        p.x = t.x; p.h = STAND_H; p.crawl = false; p.slideT = 0;
        return true;
      }
    }
    return false;
  }

  function startSlide(p, mx = 0) {
    p.slideDir = Math.abs(mx) > 0.1 ? Math.sign(mx) : Math.abs(p.vx) > 40 ? Math.sign(p.vx) : p.facing;
    p.vx = p.slideDir * clamp(Math.abs(p.vx) * 1.2, SLIDE_V, 720);
    p.slideT = 1.3; p.h = SLIDE_H;
    Sfx.slide(); Fx.dust(p.x, p.y, 6);
  }

  // walking bodies shove crates: the push lands at hip height, so a fast hit tips a crate over
  function pushCrates(ch) {
    for (const c of crates) {
      const ex = Rigid.extent(c);
      if (ch.y <= c.y - ex.hh + 4 || ch.y - ch.h >= c.y + ex.hh) continue;      // standing on it, or clear above/below
      const dx = c.x - ch.x, over = ex.hw + ch.w / 2 - Math.abs(dx);
      if (over <= 0) continue;
      const dir = Math.sign(dx) || 1;
      c.x += dir * over * 0.55; ch.x -= dir * over * 0.45;
      const into = ch.vx * dir;
      if (into > 0) {
        const hy = clamp(ch.y - (ch.slideT > 0 || ch.crawl ? 14 : 44), c.y - ex.hh + 3, c.y + ex.hh - 3);
        const dv = ch.vx - c.vx;
        if (dv * dir > 0) Rigid.impulse(c, c.x - dir * ex.hw, hy, dv * c.m * (into > 380 ? 0.9 : 0.45), into > 380 ? -c.m * 90 : 0);
        ch.vx *= ch.slideT > 0 ? 0.92 : 0.8;
        if (into > 330 && (c.kickT || 0) < clock - 0.3) { c.kickT = clock; Sfx.crate(); }
      }
    }
  }
  // a broken crate bursts into loose planks (rigid boxes too)
  function smashCrate(c, ux, uy) {
    if (c.gone) return;
    c.gone = true;
    const mat = crateMaterial(room.theme);
    const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
    for (let i = 0; i < 6; i++) {
      const horiz = i < 4;
      const off = (i % 4 - 1.5) * 8;
      const pl = Rigid.make({
        x: c.x + (horiz ? 0 : (i === 4 ? -12 : 12)), y: c.y + (horiz ? off : 0), a: c.a + (horiz ? 0 : Math.PI / 2),
        L: horiz ? 30 : 26, T: 6, density: 0.9, e: 0.15, mu: 0.75,
        vx: ux * rand(150, 380) + rand(-120, 120), vy: uy * rand(100, 250) - rand(200, 420), w: rand(-14, 14),
      });
      pieces.push(Object.assign(pl, { dz: 0.06, color: i % 2 ? mat.base : (mat.frame || mat.dark), target: i % 2 ? mat.base : (mat.frame || mat.dark), whiteT: 1, plank: true }));
    }
    Fx.chips(c.x, c.y, ux * 300, uy * 300 - 200, mat.base, 14); Fx.dust(c.x, c.y, 8, '#d8d0c0', 1);
    Sfx.smash();
    crates = crates.filter(o => o !== c);
  }

  // tops of upright crates act as platforms
  function cratePlats() {
    const out = [];
    for (const c of crates) {
      if (Math.abs(Math.sin(2 * c.a)) > 0.25) continue;
      const ex = Rigid.extent(c);
      out.push({ x1: c.x - ex.hw + 1, x2: c.x + ex.hw - 1, y: c.y - ex.hh, kind: 'crate', crate: c, th: 0 });
    }
    return out;
  }

  function startReload() {
    const p = player;
    if (p.pickup || p.weapon.reloadT > 0) return;
    p.weapon.reloadT = WEAPON[p.weapon.id].reload;
    Sfx.dry();
  }

  function fire(c, w, ws, followUp) {
    if (!followUp) ws.cd = w.rate;
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
      const sp = BULLET_SPEED * (w.speedK || 1);
      bullets.push({
        x: mz.x, y: mz.y, ox: mz.x, oy: mz.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, owner: 'p', pierce: 0, life: w.life || 2.4, t: 0, hits: [], shooter: c,
        big: !!w.big, kind: w.id, dmg: w.dmg || 1, bounce: w.bounce || 0, homing: w.homing || 0, g: w.gravity || 0, blast: w.blast || 0, split: w.split || null, wallPierce: !!w.wallPierce,
      });
    }
    if (second) c.weapon.kick2 = (w.kick || 1); else c.weapon.kick = (w.kick || 1);
    c.body.shove(-Math.cos(c.aim) * 60 * (w.kick || 1), -Math.sin(c.aim) * 60 * (w.kick || 1), J.FHAND);
    Fx.muzzle(mz.x, mz.y, c.aim, w.id === 'shotgun' ? 1.6 : w.id === 'revolver' ? 1.4 : 1);
    Fx.casing(mz.x - Math.cos(c.aim) * len * 0.6, mz.y, c.facing, w.id === 'shotgun' ? '#c94b3a' : '#d9b25c');
    Sfx.shot(w.id);
    if (w.id === 'railgun') { Fx.ring(mz.x, mz.y, 60, '#8fd0ff', 5, 0.35); flash = 0.25; flashCol = '#bfe4ff'; }
    shake(w.big ? 7 : 3);
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
  // Difficulty knobs, all driven by diff(): enemies react sooner, telegraph for less time, turn faster,
  // fire more often, more accurately and with faster rounds. The red sight line always comes first.
  const reactMul = () => lerp(1.0, 0.5, diff()) * (mode === 'campaign' && levelIdx === 0 ? 1.5 : 1);
  const aimMul = () => lerp(1.0, 0.62, diff());
  const cdMul = () => lerp(0.95, 0.55, diff());
  const turnMul = () => lerp(1.1, 1.9, diff());
  const shotSpeedMul = () => lerp(1.0, 1.4, diff());
  const spreadMul = () => lerp(1.0, 0.5, diff());

  function updateEnemy(e, dt) {
    if (!e.alive) return;
    const d = e.def, p = player;
    const head = { x: e.x, y: e.y - 80 * e.s };
    const pc = { x: p.x, y: p.y - (p.slideT > 0 || p.crawl ? 16 : 58) };
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
    if (e.body.alpha != null) { e.body.alpha += dt * 8; if (e.body.alpha >= 1) e.body.alpha = null; }
    if (e.surpriseT > 0) e.surpriseT -= dt;

    let want = 0;
    if (e.alert && p.alive) {
      // face and aim
      const tx = sees ? pc.x : e.lastX != null ? e.lastX : pc.x;
      if (Math.abs(tx - e.x) > 8) e.facing = Math.sign(tx - e.x);
      const sh = { x: e.x, y: e.y - 74 * e.s };
      const ta = Math.atan2((sees ? pc.y : (e.lastY || pc.y)) - sh.y, tx - sh.x);
      e.aim = turnTo(e.aim, ta, (d.turn || 3) * turnMul() * dt);
      if (e.reactT > 0) e.reactT -= dt;
      if (d.brute) want = bruteAI(e, dt, sees, pc);
      else if (d.grenadier) {
        const adx = pc.x - e.x;
        if (e.reactT <= 0) {
          if (e.throwT > 0) { e.throwT -= dt; if (e.throwT <= 0) throwGrenade(e); }
          else if (e.cd > 0) e.cd -= dt;
          else if (sees && Math.abs(adx) < 950) e.throwT = 0.5;
        }
        if (sees && Math.abs(adx) < 280 && !(e.throwT > 0)) want = -Math.sign(adx) * d.walk;
      } else if (d.melee) {
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
            if (e.burstT <= 0) { enemyFire(e); e.burst--; e.burstT = d.burstGap || 0.1; if (e.burst <= 0) e.cd = rand(d.cd[0], d.cd[1]) * cdMul(); }
          } else if (e.cd > 0) e.cd -= dt;
          else if (sees || (e.charge > 0 && e.lostT < 0.25)) {
            e.charge += dt;
            if (e.charge >= d.aim * aimMul()) { e.charge = 0; e.burst = d.burst || 1; e.burstT = 0; }
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
    e.vx = e.bstate === 'charge' ? want : approach(e.vx, want, 1400 * dt);
    e.vy = Math.min(e.vy + G * dt, 1500);
    const wasAir = !e.grounded;
    const out = room.moveBody(e, dt, panes);
    e.blocked = !!out.wall;
    pushCrates(e);
    if (out.pane && Math.abs(e.vx) > 100) breakPane(out.pane, e.vx);
    if (out.landed && wasAir) Fx.dust(e.x, e.y, 4);
    let melee = d.melee && e.meleeT >= 0 ? clamp(e.meleeT / 0.35, 0, 1) : null;
    if (d.grenadier && e.throwT > 0) melee = 0.25;
    if (d.brute) melee = e.bstate === 'wind' ? 0.25 : e.bstate === 'punch' ? 1 - e.bt / 0.42 : e.bstate === 'charge' ? 0.9 : null;
    e.body.pose({
      x: e.x + (d.brute && e.bstate === 'wind' ? rand(-1.5, 1.5) : 0), y: e.y, facing: e.facing, aim: e.aim, vx: e.vx, vy: e.vy, grounded: e.grounded, slide: false, flip: 0,
      sprint: (d.melee || d.brute) && Math.abs(e.vx) > 200, gun: !!d.gun, twoHand: d.gun === 'smg' || d.gun === 'shotgun' || d.gun === 'rifle', melee,
      kick: e.kick || 0,
    }, dt);
    if (e.kick) e.kick = Math.max(0, e.kick - dt * 8);
  }

  // Brute: walk in, wind up (shaking, glowing), then a straight charge. A charge that hits a
  // wall stuns it; you can jump clean over a charge. Up close it throws a slow punch.
  function bruteAI(e, dt, sees, pc) {
    const p = player, adx = pc.x - e.x, ady = p.y - e.y;
    e.bt = (e.bt || 0) - dt;
    e.chargeCd = (e.chargeCd || 0) - dt;
    switch (e.bstate || 'walk') {
      case 'walk':
        if (e.reactT > 0) return 0;
        if (Math.abs(adx) < 60 && Math.abs(ady) < 60) { e.bstate = 'punch'; e.bt = 0.42; e.punched = false; return 0; }
        if (sees && Math.abs(ady) < 70 && Math.abs(adx) < 560 && Math.abs(adx) > 110 && e.grounded && e.chargeCd <= 0) {
          e.bstate = 'wind'; e.bt = 0.7; e.chargeDir = Math.sign(adx) || e.facing; Sfx.growl();
          Fx.text(e.x, e.y - 140, '!!', '#e2434b', 30);
          return 0;
        }
        return Math.sign(adx) * e.def.walk;
      case 'wind':
        e.facing = e.chargeDir;
        if (e.bt <= 0) { e.bstate = 'charge'; e.bt = 1.0; Sfx.swing(); }
        return 0;
      case 'charge': {
        e.facing = e.chargeDir;
        if (Math.random() < 0.6) Fx.dust(e.x - e.chargeDir * 14, e.y, 1, room.theme.side, 0.5);
        if (p.alive && Math.abs(p.x - e.x) < 36 && p.y > e.y - 72 && p.y < e.y + 10) killPlayer(e.chargeDir * 1000, -450, e);
        if (e.blocked) { e.bstate = 'stun'; e.bt = 1.4; shake(9); Sfx.crate(); Fx.dust(e.x + e.chargeDir * 20, e.y - 50, 10, '#c9c9cf', 1); Fx.text(e.x, e.y - 140, 'STUNNED', '#1d2130', 16); return 0; }
        if (e.bt <= 0) { e.bstate = 'walk'; e.chargeCd = 1.2; return 0; }
        return e.chargeDir * 650;
      }
      case 'stun':
        if (e.bt <= 0) { e.bstate = 'walk'; e.chargeCd = 0.8; }
        return 0;
      case 'punch':
        if (e.bt < 0.14 && !e.punched) {
          e.punched = true; Sfx.swing();
          if (Math.abs(adx) < 72 && Math.abs(ady) < 70 && (Math.sign(adx) || e.facing) === e.facing) killPlayer(e.facing * 750, -320, e);
        }
        if (e.bt <= 0) e.bstate = 'walk';
        return 0;
      default: e.bstate = 'walk'; return 0;
    }
  }

  // grenades land where you were standing; the blast circle shows on the floor while the fuse burns
  function throwGrenade(e) {
    const p = player, hand = e.body.pts[J.FHAND];
    const tx = p.x + p.vx * 0.25 + rand(-30, 30), ty = p.y - 6;
    const dx = tx - hand.x, dy = ty - hand.y, g = 1500;
    const T = clamp(Math.abs(dx) / 480, 0.55, 1.1);
    grenades.push({ x: hand.x, y: hand.y, vx: dx / T, vy: (dy - 0.5 * g * T * T) / T, fuse: T + 0.65, fuse0: T + 0.65, t: 0, R: 105 });
    e.cd = rand(e.def.cd[0], e.def.cd[1]) * cdMul();
    Sfx.swing();
  }
  function updateGrenades(dt) {
    for (const gr of grenades) {
      gr.t += dt; gr.fuse -= dt;
      gr.vy += 1500 * dt;
      const nx = gr.x + gr.vx * dt, ny = gr.y + gr.vy * dt;
      const land = room.platforms.some(pl => nx > pl.x1 && nx < pl.x2 && gr.y <= pl.y && ny >= pl.y);
      if (room.solidAt(nx, ny, panes) || land) {
        if (room.solidAt(gr.x, ny, panes) || land) { gr.vy *= -0.32; gr.vx *= 0.65; if (Math.abs(gr.vy) < 60) gr.vy = 0; }
        else gr.vx *= -0.4;
        if (Math.abs(gr.vx) + Math.abs(gr.vy) > 120) Sfx.shell();
      } else { gr.x = nx; gr.y = ny; }
      gr.spin = (gr.spin || 0) + gr.vx * dt * 0.05;
      if (Math.random() < 0.5 && Math.abs(gr.vx) + Math.abs(gr.vy) > 80) Fx.trail(gr.x, gr.y - 6, '#9b9ba3');
      gr.beepT = (gr.beepT || 0) - dt;
      if (gr.beepT <= 0) { gr.beepT = clamp(gr.fuse * 0.25, 0.06, 0.3); Sfx.beep(1 - clamp(gr.fuse / 1.6, 0, 1)); gr.blink = 0.06; }
      gr.blink = Math.max(0, (gr.blink || 0) - dt);
      if (gr.fuse <= 0) { gr.dead = true; explode(gr.x, gr.y - 6, gr.R, false, false); }
    }
    grenades = grenades.filter(g => !g.dead);
  }

  function enemyFire(e) {
    const d = e.def;
    const len = WEAPON[d.gun] ? WEAPON[d.gun].len : 16;
    const mz = e.body.muzzle(len);
    const n = d.pellets || 1;
    for (let i = 0; i < n; i++) {
      const a = e.aim + (n > 1 ? (i / (n - 1) - 0.5) * d.spread * 2 : rand(-1, 1) * d.spread * spreadMul());
      const sp = d.speed * shotSpeedMul();
      bullets.push({ x: mz.x, y: mz.y, ox: mz.x, oy: mz.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, owner: 'e', pierce: 0, life: d.life || 3, t: 0, hits: [], shooter: e, near: false, rifle: d.gun === 'rifle' });
    }
    e.kick = 1;
    Fx.muzzle(mz.x, mz.y, e.aim, d.gun === 'shotgun' ? 1.5 : 1);
    Fx.casing(mz.x, mz.y, e.facing);
    Sfx.enemyShot(d.gun);
    shake(1.5);
  }

  /* ---------------------------------------------------------- bullets */
  // per-round gimmicks run before the round moves
  function steerBullet(b, dt) {
    if (b.g) b.vy += b.g * dt;
    if (b.homing) {
      const a = Math.atan2(b.vy, b.vx), sp = Math.hypot(b.vx, b.vy);
      let best = null, bd = 1e9;
      for (const e of enemies) {
        if (!e.alive || b.hits.includes(e)) continue;
        const c = e.body.center(), d = dist(c.x, c.y, b.x, b.y);
        const da = Math.abs(angDiff(a, Math.atan2(c.y - b.y, c.x - b.x)));
        if (d < 720 && da < 1.5 && d < bd) { bd = d; best = c; }
      }
      if (best) {
        const na = turnTo(a, Math.atan2(best.y - b.y, best.x - b.x), b.homing * dt);
        b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
        if (Math.random() < 0.5) Fx.trail(b.x, b.y, '#8fd0ff');
      }
    }
    if (b.split && !b.didSplit && b.t >= b.split.t) {
      b.didSplit = true;
      const a = Math.atan2(b.vy, b.vx), sp = Math.hypot(b.vx, b.vy);
      for (const k of [-1, 1]) {
        const na = a + k * b.split.a;
        spawned.push(Object.assign({}, b, { vx: Math.cos(na) * sp, vy: Math.sin(na) * sp, hits: b.hits.slice(), split: null, ox: b.x, oy: b.y }));
      }
      Fx.sparks(b.x, b.y, a, 6, '#ffd27a', 200); Sfx.split();
    }
  }
  let spawned = [];

  function updateBullets(dt) {
    const keep = [];
    spawned = [];
    for (const b of bullets) {
      b.t += dt;
      if (b.t > b.life) { if (b.blast) explode(b.x, b.y, b.blast, true); continue; }
      steerBullet(b, dt);
      const sp = Math.hypot(b.vx, b.vy);
      const steps = Math.max(1, Math.ceil(sp * dt / 6));
      const ux = b.vx / (sp || 1), uy = b.vy / (sp || 1);
      let alive = true;
      for (let s = 0; s < steps && alive; s++) {
        const nx = b.x + b.vx * dt / steps, ny = b.y + b.vy * dt / steps;
        // deflect: player rounds knock enemy rounds out of the air
        if (b.owner === 'p' && !b.blast) {
          for (const o of bullets) {
            if (o.owner !== 'e' || o.dead || o === b) continue;
            if (segPointDist(b.x, b.y, nx, ny, o.x, o.y).d < 10) {
              o.dead = true;
              if (!b.wallPierce) alive = false;
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
        if (b.owner === 'p') {
          for (const gr of grenades) if (!gr.dead && Math.hypot(gr.x - nx, gr.y - ny) < 10) {
            gr.dead = true; alive = false; explode(gr.x, gr.y - 6, gr.R, true, false); styleEvent(gr.x, gr.y, 'DEFUSED', 80);
            break;
          }
          if (!alive) break;
          for (const e of enemies) {
            if (!e.alive || !e.def.shield || b.wallPierce || b.vx * e.facing >= 0) continue;
            const sx = e.x + e.facing * 18;
            if (Math.abs(nx - sx) < 5 && ny > e.y - 80 * e.s && ny < e.y - 3) {
              if (b.blast) { explode(nx, ny, b.blast, true); alive = false; break; }
              Fx.sparks(nx, ny, Math.atan2(-b.vy, -b.vx), 8, '#ffffff', 380); Sfx.armor();
              if (b.bounce > 0) { b.bounce--; b.vx = -b.vx; b.ox = nx; b.oy = ny; b.shooter = null; break; }
              alive = false; break;
            }
          }
          if (!alive) break;
        }
        // bodies
        const targets = b.owner === 'p' ? enemies : [player, ...enemies];
        for (const c of targets) {
          if (!c.alive || (c === b.shooter && b.t < 0.4) || b.hits.includes(c)) continue;
          if (c === player && c.invuln > 0) continue;
          if (Math.abs(c.x - nx) > 60 || Math.abs(c.y - 50 - ny) > 90) continue;
          const h = c.body.hitTest(nx, ny, b.big ? 4 : 2.5);
          if (!h) continue;
          b.hits.push(c);
          if (b.blast) { explode(nx, ny, b.blast, b.owner === 'p'); alive = false; break; }
          if (c === player) { killPlayer(ux * 950, uy * 950 - 180, b.shooter, h.idx, 'shot'); alive = false; break; }
          hitEnemy(c, b, h, nx, ny);
          if (b.pierce > 0) b.pierce--; else { alive = false; break; }
        }
        if (!alive) break;
        // near misses
        if (b.owner === 'e' && player.alive && !b.near) {
          const dd = Math.hypot(player.x - nx, player.y - 50 - ny);
          if (dd < 46) {
            b.near = true;
            Sfx.whiz();
            if (closeCd <= 0 && state === 'play') { closeCd = 5; slowMo(0.55, 0.3); b.closeCall = true; }
          }
        }
        // corpses and loose blocks get shoved
        for (const cb of corpses) if (Math.abs(cb.pts[J.PELVIS].x - nx) < 60 && Math.abs(cb.pts[J.PELVIS].y - ny) < 70) cb.push(nx, ny, ux * 500, uy * 500, 22);
        for (const pc of pieces) {
          if ((pc.hitBy === b) || Math.abs(pc.x - nx) > 26 || Math.abs(pc.y - ny) > 26 || !Rigid.contains(pc, nx, ny, 3)) continue;
          pc.hitBy = b;
          Rigid.impulse(pc, nx, ny, ux * pc.m * 380, uy * pc.m * 380 - pc.m * 140);
        }
        // crates are cover: a round thumps into the wood and shoves it
        for (const c of crates) {
          if (Math.abs(c.x - nx) > 30 || Math.abs(c.y - ny) > 30 || !Rigid.contains(c, nx, ny, 1)) continue;
          Rigid.impulse(c, nx, ny, ux * c.m * (b.big ? 260 : 150), uy * c.m * 150 - c.m * 40);
          Fx.chips(nx, ny, -b.vx, -b.vy, crateMaterial(room.theme).base, 5); Sfx.crate();
          c.hp -= b.dmg || 1; c.flash = 1;
          if (c.hp <= 0) smashCrate(c, ux, uy);
          if (b.blast) { explode(nx, ny, b.blast, b.owner === 'p'); alive = false; break; }
          if (!b.wallPierce) { alive = false; break; }
        }
        if (!alive) break;
        for (const br of barrels) if (!br.gone && Math.abs(br.x - nx) < 16 && ny > br.y - br.h && ny < br.y) {
          if (b.blast) { explode(nx, ny, b.blast, b.owner === 'p'); alive = false; break; }
          lightBarrel(br, b.owner === 'p', ux);
          if (!b.wallPierce) { alive = false; break; }
        }
        if (!alive) break;
        // walls and glass
        const hit = room.solidAt(nx, ny, panes);
        if (hit) {
          if (hit !== true) { breakPane(hit, b.vx); b.x = nx; b.y = ny; continue; }
          if (b.wallPierce) {
            if (Math.random() < 0.3) Fx.dust(nx, ny, 1, room.theme.side, 0.4);
            if (nx < -40 || ny < -40 || nx > room.w + 40 || ny > room.h + 40) { alive = false; break; }
            b.x = nx; b.y = ny; continue;
          }
          const r = room.ray(b.x, b.y, nx, ny, null, 2) || { x: b.x, y: b.y, nx: -sign(b.vx), ny: 0 };
          if (b.blast) { explode(r.x, r.y, b.blast, b.owner === 'p'); alive = false; break; }
          Fx.sparks(r.x, r.y, Math.atan2(r.ny, r.nx) || Math.atan2(-b.vy, -b.vx), 5, b.owner === 'p' ? '#ffd27a' : '#ffffff', 300);
          Fx.dust(r.x, r.y, 3, room.theme.side, 0.5);
          if (room.decals.length < 220) room.decals.push({ x: r.x, y: r.y, kind: 'hole' });
          if (b.bounce > 0) {
            // ricochet: mirror off the face we hit and keep going
            b.bounce--;
            if (r.nx) b.vx = Math.abs(b.vx) * r.nx; else if (r.ny) b.vy = Math.abs(b.vy) * r.ny; else { b.vx = -b.vx; b.vy = -b.vy; }
            b.x = r.x; b.y = r.y; b.ox = r.x; b.oy = r.y; b.hits = []; b.shooter = null;
            Sfx.ricochet();
            break;
          }
          if (Math.random() < 0.25) Sfx.ricochet(); else Sfx.wallHit();
          alive = false; break;
        }
        b.x = nx; b.y = ny;
      }
      if (alive && !b.dead) keep.push(b);
    }
    bullets = keep.concat(spawned);
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
    const base = b.dmg || 1, dmg = head ? base * 2 : base;
    e.hp -= dmg;
    e.alert = true; if (e.reactT > 0.15) e.reactT = 0.15;
    Fx.chips(x, y, b.vx, b.vy, '#e2434b', head ? 10 : 6);
    if (e.hp > 0) {
      e.body.flash = 1; e.flinch = 0.2;
      e.body.shove(b.vx * 0.25, b.vy * 0.25, h.idx);
      e.vx += Math.sign(b.vx) * 60;
      Sfx.armor();
      Fx.sparks(x, y, Math.atan2(-b.vy, -b.vx), 6, '#ffffff', 300);
      return;
    }
    const info = { head, boom: false, crossfire: b.owner === 'e' };
    const sp = Math.hypot(b.vx, b.vy) || 1, k = b.kind === 'railgun' ? 1700 : b.big ? 1250 : 950;
    killEnemy(e, b.vx / sp * k, b.vy / sp * k - 170, h.idx, info);
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
      if (p.flipping) { tags.push(STYLE.flip.label); pts += STYLE.flip.pts; track('flipKills'); p.flipChain = Math.max(0, (p.flipChain || 0) - 1); }
      else if (!p.grounded) { tags.push(STYLE.air.label); pts += STYLE.air.pts; track('airKills'); }
      if (p.slideT > 0 || p.crawl) { tags.push(STYLE.slide.label); pts += STYLE.slide.pts; track('slideKills'); }
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
    if (mode !== 'menu' && enemies.every(o => !o.alive) && ambushes.every(a => a.state === 'done' || a.state === 'skip')) {
      clearT = 0;
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

  function killPlayer(vx, vy, killer, idx = J.NECK, kind = 'melee') {
    const p = player;
    if (!p.alive || state !== 'play') return;
    if (armorBlock(idx, kind, killer, vx, vy)) return;
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
    if (mode === 'endless') run.lives = Math.max(0, run.lives - 1);
    emit('death', { mode, lives: run.lives, canRevive: mode === 'endless' && run.lives === 0 && !endless.revived });
  }

  // a shot barrel hisses and glows for a moment, then goes up
  function lightBarrel(br, byPlayer, dir = 0) {
    if (br.gone || br.fuse >= 0) return;
    br.fuse = 0.34; br.byPlayer = byPlayer; br.kick = dir;
    Sfx.fuse();
    Fx.sparks(br.x, br.y - br.h * 0.6, -Math.PI / 2, 8, '#ffd27a', 260);
  }
  function detonate(br, byPlayer) {
    if (br.gone) return;
    br.gone = true;
    const x = br.x, y = br.y - 20;
    // the drum bursts into chunks
    Fx.chips(x, y, 0, -400, '#ff8a3d', 14); Fx.chips(x, y, 0, -500, '#3a3d48', 8);
    explode(x, y, 150, byPlayer, true);
  }
  function explode(x, y, R, byPlayer, big) {
    Sfx.boom();
    Fx.explosion(x, y, R * (big ? 0.7 : 0.62), groundBelow(x, y - 10));
    hitstop = Math.max(hitstop, 0.06);
    room.decals.push({ x, y: y + 10, kind: 'scorch', r: R * 0.47 });
    shake(big ? 22 : 16); flash = big ? 0.42 : 0.32; flashCol = '#ffe2a8';
    cam.kick = Math.max(cam.kick, 0.06);
    slowMo(0.6, 0.3);
    for (const e of enemies) {
      if (!e.alive) continue;
      const c = e.body.center(), d = dist(c.x, c.y, x, y);
      if (d < R) { const a = Math.atan2(c.y - y, c.x - x); killEnemy(e, Math.cos(a) * 1100, Math.sin(a) * 1100 - 500, J.PELVIS, { boom: true }); }
    }
    if (player.alive) { const d = dist(player.x, player.y - 46, x, y); if (d < R - 25) { const a = Math.atan2(player.y - 46 - y, player.x - x); killPlayer(Math.cos(a) * 1000, Math.sin(a) * 1000 - 500, null, J.PELVIS, 'blast'); } }
    for (const cb of corpses) pushRadial(cb.pts, x, y, R + 40, 1300);
    for (const pc of pieces) Rigid.blast(pc, x, y, R + 70, 1300);
    for (const c of crates) { Rigid.blast(c, x, y, R + 50, 950); if (dist(c.x, c.y, x, y) < R) smashCrate(c, c.x - x, c.y - y); }
    for (const g of panes) if (!g.broken && Math.abs(g.x - x) < R && y > g.y - 40 && y < g.y + g.h + 40) breakPane(g, g.x - x);
    for (const o of barrels) if (!o.gone && dist(o.x, o.y - 20, x, y) < R + 30) { if (o.fuse < 0) lightBarrel(o, byPlayer); o.fuse = Math.min(o.fuse, 0.12); }
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
    for (const br of barrels) {
      if (br.gone || br.fuse < 0) continue;
      br.fuse -= dt;
      if (Math.random() < 0.6) Fx.smoke(br.x + rand(-6, 6), br.y - br.h, 1, '#9b9ba3', 0.5);
      if (br.fuse <= 0) detonate(br, br.byPlayer);
    }
    for (const cb of corpses) {
      cb.simulate(dt, room, panes);
      if (!cb.broken && cb.deadT > cb.breakAt) { pieces.push(...cb.breakApart()); Sfx.crumble(); Fx.dust(cb.pts[J.PELVIS].x, cb.pts[J.PELVIS].y, 6, '#ffffff'); }
    }
    corpses = corpses.filter(cb => !cb.broken);
    room.dyn = cratePlats();
    const plats = room.platforms.concat(room.dyn);
    if (pieces.length > 260) pieces.splice(0, pieces.length - 260);
    Rigid.stepAll(crates.concat(pieces), dt, room, panes, plats);
    for (const pc of pieces) simPiece(pc, dt);
    for (const c of crates) {
      if (c.hit > 180 && (c.thudT || 0) < c.life - 0.15) { c.thudT = c.life; Sfx.crate(); if (c.hit > 400) Fx.dust(c.x, c.y + 14, 4, room.theme.side, 0.6); }
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
      const again = deathT > RETRY_DELAY && (pressed.has('reload') || pressed.has('jump') || pressed.has('shoot'));
      const retry = mode === 'campaign' || (mode === 'endless' && run.lives > 0);
      if (retry && (deathT > 2.6 || again)) restartRoom();
      return;
    }
    if (state !== 'play' || !player.alive || !room.door || fade) return;
    const d = room.door;
    // generous doorway: anywhere across the frame, standing or mid-jump in front of it
    if (doorOpen && Math.abs(player.x - d.x) < 42 && player.y > d.y - 80 && player.y < d.y + 10) {
      Sfx.door();
      const last = mode === 'campaign' && roomIdx >= level.rooms.length - 1;
      run.rooms++;
      if (mode === 'endless') { endless.n++; track('endlessRooms'); Save.data.endlessRooms++; }
      if (last) { completeLevel(); return; }
      fade = { phase: 'out', t: 0, cb: () => { loadRoom(roomIdx + 1); emit('room'); } };
    }
  }

  let doorAnim = 0;
  // the swing is purely visual: it eases open over ~1.4s as you approach, but walking into the
  // frame always takes you through immediately
  let doorNear = false;
  function updateDoor(dt) {
    const d = room.door;
    if (!d || !player) return;
    doorNear = Math.abs(player.x - d.x) < 260 && Math.abs(player.y - d.y) < 170;
    const target = doorNear || (fade && fade.phase === 'out') ? 1 : 0;
    doorAnim = approach(doorAnim, target, dt / (target ? 1.4 : 0.9));
  }
  function doorState() {
    if (!room.door) return null;
    return { open: true, anim: easeInOut(doorAnim), left: 0, near: doorNear };
  }
  // force: the pause menu's Restart Room skips the short post-death delay
  function restartRoom(force) {
    if (fade) return;
    if (!force && state === 'dead' && deathT < RETRY_DELAY) return;
    fade = {
      phase: 'out', t: 0.12, cb: () => {
        // armour keeps the damage it took before you died (repaired only when a new level starts)
        if (mode !== 'menu' && player && player.armorHp) roomArmor = { slots: JSON.parse(JSON.stringify(player.armorHp)), blastUsed: player.blastUsed };
        resetRoomEntities(); snapCamera(); state = 'play'; slowOn = false; focus = roomFocus;
        emit('respawn');
      },
    };
  }
  // endless: an ad buys one more life and a fresh go at the same room
  function revive() {
    endless.revived = true;
    run.lives = 1;
    restartRoom();
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
    room.drawBack(ctx, clock, doorState(), panes);
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
    for (const e of enemies) if (e.alive) {
      drawLaser(e);
      if (e.def.brute && e.bstate === 'wind') Glow.draw(ctx, '#ff3344', e.x, e.y - 55, 70, 0.35 + 0.25 * Math.sin(clock * 30));
      e.body.draw(ctx);
      if (e.def.shield) drawShield(e);
      if (e.surpriseT > 0) drawSurprise(e);
    }
    drawGrenades();
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
    const k = e.charge / (d.aim * aimMul());
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
      if (b.owner === 'p' && b.blast) {
        // grenade: a dark shell with a blinking light
        ctx.fillStyle = '#3f4a32'; ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5d6b4a'; ctx.beginPath(); ctx.arc(b.x - 1.5, b.y - 1.5, 3, 0, TAU); ctx.fill();
        if (Math.sin(clock * 30) > 0) Glow.draw(ctx, '#ff4f5e', b.x, b.y, 10, 0.9);
        if (Math.random() < 0.5) Fx.trail(b.x, b.y, '#9b9ba3');
        continue;
      }
      if (b.owner === 'p' && b.kind === 'railgun') {
        const tl = Math.min(dist(b.x, b.y, b.ox, b.oy), 260);
        const g = ctx.createLinearGradient(b.x - ux * tl, b.y - uy * tl, b.x, b.y);
        g.addColorStop(0, 'rgba(88,225,255,0)'); g.addColorStop(1, 'rgba(200,245,255,1)');
        ctx.strokeStyle = g; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(b.x - ux * tl, b.y - uy * tl); ctx.lineTo(b.x, b.y); ctx.stroke();
        Glow.draw(ctx, '#58e1ff', b.x, b.y, 22, 0.9);
        continue;
      }
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
  // a big, vibrant yellow "!" that pops above a surprise enemy for a moment
  function drawSurprise(e) {
    const k = 1 - e.surpriseT / 1.3;
    const pop = k < 0.15 ? easeOutBack(k / 0.15) : 1;
    const a = e.surpriseT < 0.3 ? e.surpriseT / 0.3 : 1;
    const h = e.body.pts[J.HEAD];
    const x = h.x, y = h.y - 34 - Math.sin(clock * 9) * 2;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.scale(pop, pop);
    Glow.draw(ctx, '#ffd400', 0, 0, 34, 0.75);
    ctx.font = '900 40px Rubik, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = '#1d2130'; ctx.strokeText('!', 0, 0);
    ctx.fillStyle = '#ffd400'; ctx.fillText('!', 0, 0);
    ctx.restore();
  }
  function drawShield(e) {
    const f = e.facing, x = e.x + f * 18, y0 = e.y - 80 * e.s, y1 = e.y - 3;
    ctx.globalAlpha = 0.9;
    prism(ctx, [[x - 4, y0], [x + 4, y0], [x + 4, y1], [x - 4, y1]], ZP - 0.11, ZP + 0.11, '#2b2f3b', '#454b5c', '#1d2029');
    ctx.globalAlpha = 1;
    prism(ctx, [[x - 4.5, y0 + 8], [x + 4.5, y0 + 8], [x + 4.5, y0 + 20], [x - 4.5, y0 + 20]], ZP - 0.115, ZP + 0.115, 'rgba(150,180,210,0.75)', 'rgba(190,215,240,0.8)', 'rgba(110,140,170,0.75)');
  }
  // blast warning on the floor: a red zone that fills in as the fuse burns, a rotating dashed edge
  // and a countdown arc, so you always know where not to stand and how long you have
  function drawBlastZone(x, gy, R, k) {
    ctx.save(); ctx.translate(x, gy); ctx.scale(1, 0.13);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, `rgba(255,51,68,${0.1 + 0.3 * k})`); g.addColorStop(1, `rgba(255,51,68,${0.05 + 0.12 * k})`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(255,51,68,${0.25 + 0.35 * k})`; ctx.beginPath(); ctx.arc(0, 0, R * k, 0, TAU); ctx.fill();
    ctx.setLineDash([14, 10]); ctx.lineDashOffset = -clock * 60;
    ctx.strokeStyle = `rgba(226,40,55,${0.6 + 0.4 * Math.sin(clock * 20) * k})`; ctx.lineWidth = 3 / 0.13 * 0.35;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  function drawGrenades() {
    for (const gr of grenades) {
      const k = 1 - clamp(gr.fuse / (gr.fuse0 || 1.5), 0, 1);
      const gy = groundBelow(gr.x, gr.y - 4);
      if (gy != null) drawBlastZone(gr.x, gy, gr.R * 0.9, k);
      // countdown arc around the grenade
      ctx.strokeStyle = 'rgba(255,51,68,0.85)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(gr.x, gr.y - 6, 12, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - k)); ctx.stroke();
      // the grenade: ribbed olive body, a spoon and a red light that blinks faster as it counts down
      ctx.save(); ctx.translate(gr.x, gr.y - 6); ctx.rotate(gr.spin || 0);
      ctx.fillStyle = '#4d5a3c'; ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 7.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a4430'; ctx.fillRect(-6.5, -1, 13, 2); ctx.fillRect(-1, -7.5, 2, 15);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(-2.5, -3, 2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8b8f99'; ctx.fillRect(-2.5, -11, 5, 4); ctx.fillRect(2, -10.5, 6, 1.6);
      ctx.restore();
      if (gr.blink > 0) { Glow.draw(ctx, '#ff3344', gr.x, gr.y - 17, 16, 1); ctx.fillStyle = '#ff3344'; ctx.fillRect(gr.x - 1.5, gr.y - 18.5, 3, 3); }
    }
  }
  function drawCrate(c) {
    const th = room.theme;
    const mat = crateMaterial(th);
    prism(ctx, Rigid.corners(c), ZP - 0.075, ZP + 0.075, mat.base, shade(mat.base, 0.14), shade(mat.base, -0.16), shade(mat.base, -0.26));
    // the art sits on the near face of the box
    const V = View.V, k = View.k(ZP - 0.075);
    ctx.save();
    ctx.translate(V.x, V.y); ctx.scale(k, k); ctx.translate(-V.x, -V.y);
    ctx.translate(c.x, c.y); ctx.rotate(c.a);
    drawCrateFace(ctx, c.L, mat);
    ctx.restore();
  }
  // A matte drum built as a real cylinder: 14 flat-shaded facets around a vertical axis in depth,
  // a lid seen from above, two ribs and a single white mark on the face toward you.
  function drawBarrel(br) {
    const lit = br.fuse >= 0 ? 1 - br.fuse / 0.34 : 0;
    const jx = lit ? rand(-1.6, 1.6) * lit : 0;
    const cx = br.x + jx, y0 = br.y - br.h, y1 = br.y, r = br.w / 2, rz = 0.1;
    const V = View.V;
    const P = (x, y, z) => { const k = View.k(z); return [V.x + (x - V.x) * k, V.y + (y - V.y) * k]; };
    const dark = room.theme.dark;
    const base = dark ? '#d8692e' : '#ec7738', N = 14;
    const ring = [];
    for (let i = 0; i <= N; i++) { const t = i / N * TAU; ring.push([cx + Math.cos(t) * r, ZP + Math.sin(t) * rz, t]); }
    const facets = [];
    for (let i = 0; i < N; i++) {
      const tm = (i + 0.5) / N * TAU, nx = Math.cos(tm), nz = Math.sin(tm);
      if (nz > 0.35) continue;                                   // far side, hidden
      facets.push({ a: ring[i], b: ring[i + 1], z: ZP + nz * rz, light: clamp(0.62 - nz * 0.25 - nx * 0.28, 0.25, 1) });
    }
    facets.sort((p1, p2) => p2.z - p1.z);
    const flash = lit ? (Math.sin(clock * 60) > 0 ? 0.55 : 0.12) * lit : 0;
    for (const f of facets) {
      const col = mixHex(shade(base, (f.light - 0.62) * 0.9), '#ffffff', flash);
      const a0 = P(f.a[0], y0, f.a[1]), a1 = P(f.b[0], y0, f.b[1]), b1 = P(f.b[0], y1, f.b[1]), b0 = P(f.a[0], y1, f.a[1]);
      ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.lineTo(b1[0], b1[1]); ctx.lineTo(b0[0], b0[1]); ctx.closePath(); ctx.fill(); ctx.stroke();
      // ribs
      ctx.fillStyle = shade(col, -0.16);
      for (const ry of [y0 + 10, y1 - 11]) {
        const c0 = P(f.a[0], ry, f.a[1]), c1 = P(f.b[0], ry, f.b[1]), d1 = P(f.b[0], ry + 2.5, f.b[1]), d0 = P(f.a[0], ry + 2.5, f.a[1]);
        ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]); ctx.lineTo(d1[0], d1[1]); ctx.lineTo(d0[0], d0[1]); ctx.closePath(); ctx.fill();
      }
    }
    // lid, when we look down on it
    if (V.y < y0) {
      ctx.fillStyle = mixHex(shade(base, 0.18), '#ffffff', flash);
      ctx.beginPath();
      ring.forEach(([x, z], i) => { const q = P(x, y0, z); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = shade(base, -0.05); ctx.lineWidth = 1;
      ctx.beginPath();
      ring.forEach(([x, z], i) => { const q = P(cx + (x - cx) * 0.72, y0, ZP + (z - ZP) * 0.72); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
      ctx.closePath(); ctx.stroke();
      const cap = P(cx + r * 0.45, y0, ZP - rz * 0.1);
      ctx.fillStyle = shade(base, -0.3); ctx.fillRect(cap[0] - 2, cap[1] - 1.5, 4, 3);
    }
    // one white flame mark on the front
    const k = View.k(ZP - rz), m = P(cx, (y0 + y1) / 2, ZP - rz);
    ctx.save(); ctx.translate(m[0], m[1]); ctx.scale(k, k);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath(); ctx.moveTo(-1, -7); ctx.quadraticCurveTo(6, -1, 3, 5); ctx.quadraticCurveTo(-1, 7.5, -5, 4); ctx.quadraticCurveTo(-6, -1, -1, -7); ctx.fill();
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.moveTo(-0.5, -0.5); ctx.quadraticCurveTo(2.5, 2.5, 0.5, 5); ctx.quadraticCurveTo(-2.5, 4.5, -2, 2); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (lit) {
      drawBlastZone(br.x, br.y, 150, lit);
      if (Math.random() < 0.7) Fx.sparks(cx + 6, y0 - 3, -Math.PI / 2 - 0.3, 1, '#ffd27a', 260);
      Glow.draw(ctx, '#ff6a3d', cx, y0 + br.h / 2, 36 + 26 * lit, 0.35 + 0.35 * lit);
      Glow.draw(ctx, '#fff2b0', cx + 7, y0 - 2, 9 + 5 * Math.random(), 0.9);
    }
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
    const label = (input.touch ? 'GRAB: ' : 'E: ') + WEAPON[g.id].name.toUpperCase();
    ctx.font = '800 11px Rubik, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 24;
    ctx.fillStyle = 'rgba(14,16,24,0.88)';
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - 12, w, 24, 5); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x, y + 0.5);
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
    init, resize, update, render, on, setKey, press, setMouse, setAxis, setAimStick, setTouchTarget,
    startMenu, startLevel, startEndless, restartRoom, revive, endEndless, toggleSlow,
    get state() { return state; }, get mode() { return mode; }, get paused() { return paused; },
    set paused(v) { paused = v; },
    get focus() { return focus; }, get slowOn() { return slowOn; }, get ts() { return ts; },
    get run() { return run; }, get level() { return level; }, get levelIdx() { return levelIdx; }, get roomIdx() { return roomIdx; },
    get roomCount() { return mode === 'endless' ? endless.n + 1 : level.rooms.length; },
    get armorState() { return player && player.armorHp ? ['head', 'body', 'legs'].map(s => player.armorHp[s] ? Object.assign({ slot: s }, player.armorHp[s]) : null) : []; },
    get endless() { return endless; }, get lives() { return run ? run.lives : 0; },
    get room() { return room; }, get player() { return player; }, get enemiesLeft() { return enemies.filter(e => e.alive).length; },
    get weaponInfo() {
      if (!player) return null;
      const w = curWeapon(), ws = player.pickup || player.weapon;
      return { name: w.name, ammo: ws.ammo, mag: player.pickup ? null : w.mag, reload: !player.pickup && player.weapon.reloadT > 0, pickup: !!player.pickup };
    },
    get nearPickup() { return player && player.nearPickup; },
    get input() { return input; },
    get doorOpen() { return doorOpen; },
    setMenuInset(px) { menuInset = px; },
    debugSpawn(type, x) { const e = makeEnemy(type, x, player.y, false); enemies.push(e); return e; },
    debugRoom(i) { loadRoom(i); state = 'play'; },
    debugClear() { for (const e of enemies) if (e.alive) killEnemy(e, 300, -200, J.NECK, { head: false }); },
    get enemies() { return enemies; }, get pieces() { return pieces; }, worldToScreen,
  };
})();
