'use strict';
/* =========================================================================
   UI: home, level select, armory, missions, daily reward, settings, pause,
   results, the HUD and touch controls. Gameplay lives in game.js.
   ========================================================================= */

const UI = (() => {
  const $ = id => document.getElementById(id);
  let screen = 'home';
  let modalOpen = false, modalKind = null;
  let chapter = 0, armoryTab = 'weapon', armorySel = null;
  let levelsThisSession = 0, endlessRuns = 0, lastAdRevive = -1e9;
  let previewBody = null, previewT = 0;
  const S = () => Save.data;

  /* -------------------------------------------------------------- init */
  function init() {
    Icons.hydrate();
    // home
    $('btnPlay').onclick = () => { click(); play(Save.nextLevel()); };
    $('btnLevels').onclick = () => { click(); chapter = Math.floor(Save.nextLevel() / LEVELS_PER_CHAPTER); show('levels'); };
    $('btnEndless').onclick = () => {
      click();
      if (!Save.endlessUnlocked()) { toast('Clear level 3 to unlock Endless', 'lock'); Sfx.denied(); return; }
      startEndless();
    };
    $('btnArmory').onclick = () => { click(); show('armory'); };
    $('btnMissions').onclick = () => { click(); openMissions(); };
    $('btnSettings').onclick = () => { click(); openSettings(); };
    $('streakChip').onclick = () => { click(); openStreak(); };
    document.querySelectorAll('[data-back]').forEach(b => { b.onclick = () => { click(); show('home'); }; });
    $('armoryTabs').querySelectorAll('button').forEach(b => { b.onclick = () => { click(); armoryTab = b.dataset.tab; armorySel = null; renderArmory(); }; });
    $('btnPause').onclick = () => openPause();
    $('btnRotateOk').onclick = () => { $('rotate').classList.add('hidden'); rotateDismissed = true; };
    $('modal').addEventListener('pointerdown', e => { if (e.target === $('modal') && modalKind && ['missions', 'settings', 'streak'].includes(modalKind)) closeModal(); });

    Game.on('complete', onComplete);
    Game.on('death', onDeath);
    Game.on('respawn', () => $('death').classList.add('hidden'));
    Game.on('room', () => { updateChip(); });
    Game.on('start', () => { updateChip(); $('death').classList.add('hidden'); });
    Game.on('mission', m => toast('Mission complete: ' + m.text, 'scroll'));
    Game.on('noFocus', () => { const f = $('focus'); f.classList.add('empty'); setTimeout(() => f.classList.remove('empty'), 400); });
    Game.on('kill', k => { if (k.combo > 1) { const b = $('comboNum'); b.textContent = 'x' + k.combo; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; } });

    setupTouch();
    applySettings();
    show('home');
    checkRotate();
    if (Save.streakState().claimable && Save.data.stats.levels > 0) setTimeout(openStreak, 600);
  }

  function click() { Sfx.click(); }

  function show(id) {
    screen = id;
    for (const s of ['home', 'levels', 'armory']) $(s).classList.toggle('hidden', s !== id);
    $('hud').classList.toggle('hidden', id !== null);
    document.body.classList.toggle('playing', id === null);
    if (id === 'home') renderHome();
    if (id === 'levels') renderLevels();
    if (id === 'armory') renderArmory();
    // the desktop banner lives on the home screen only, never in play
    const banner = $('cgBanner');
    const wantBanner = id === 'home' && Platform.adsEnabled && Platform.device() === 'desktop' && window.innerWidth >= 1100 && window.innerHeight >= 640;
    banner.classList.toggle('hidden', !wantBanner);
    if (wantBanner) setTimeout(() => Platform.showBanner('cgBanner'), 50);
    if (id !== null) { Sfx.setMusicPaused(id !== 'home' ? false : false); }
  }

  /* -------------------------------------------------------------- home */
  function renderHome() {
    if (Game.mode !== 'menu') Game.startMenu();
    requestAnimationFrame(() => { const r = $('home').querySelector('.home-panel').getBoundingClientRect(); Game.setMenuInset(r.right + Math.min(320, window.innerWidth * 0.2)); });
    const d = S();
    document.querySelectorAll('.coin-val').forEach(e => { e.textContent = fmt(d.coins); });
    $('homeStars').textContent = Save.totalStars();
    const nx = Save.nextLevel(), L = getLevel(nx);
    $('playSub').textContent = 'LEVEL ' + (nx + 1) + ' · ' + L.name.toUpperCase();
    $('levelsSub').textContent = Save.totalStars() + ' / ' + LEVEL_COUNT * 3 + ' STARS';
    $('endlessSub').textContent = Save.endlessUnlocked() ? 'BEST ' + fmt(d.endlessBest) : 'CLEAR LEVEL 3';
    $('btnEndless').classList.toggle('locked', !Save.endlessUnlocked());
    $('missionDot').classList.toggle('hidden', !Save.missionsReady());
    $('streakChip').classList.toggle('hidden', !Save.streakState().claimable);
    const touch = document.body.classList.contains('touch');
    $('homeHint').innerHTML = touch ? '' : [
      ['A D', 'MOVE'], ['SHIFT', 'SPRINT'], ['SPACE', 'JUMP'], ['RMB', 'SLIDE'], ['Q', 'SLOW TIME'], ['E', 'GRAB GUN'],
    ].map(([k, t]) => `<span><kbd>${k}</kbd>${t}</span>`).join('');
  }

  /* ------------------------------------------------------------ levels */
  function renderLevels() {
    $('levelsStars').textContent = Save.totalStars();
    $('chapterTabs').innerHTML = CHAPTERS.map((c, i) => {
      const open = Save.levelUnlocked(i * LEVELS_PER_CHAPTER);
      return `<button data-c="${i}" class="${i === chapter ? 'active' : ''} ${open ? '' : 'locked'}">${i + 1}. ${c.name}</button>`;
    }).join('');
    $('chapterTabs').querySelectorAll('button').forEach(b => { b.onclick = () => { click(); chapter = +b.dataset.c; renderLevels(); }; });
    const c = CHAPTERS[chapter];
    let got = 0;
    for (let i = 0; i < LEVELS_PER_CHAPTER; i++) got += S().stars[chapter * LEVELS_PER_CHAPTER + i] || 0;
    $('chapterHead').innerHTML = `<b>${c.name}</b><span>${got} / ${LEVELS_PER_CHAPTER * 3} STARS</span>`;
    const nx = Save.nextLevel();
    let html = '';
    for (let k = 0; k < LEVELS_PER_CHAPTER; k++) {
      const i = chapter * LEVELS_PER_CHAPTER + k;
      const L = getLevel(i), open = Save.levelUnlocked(i), st = S().stars[i] || 0, best = S().best[i];
      html += `<button class="lvl ${open ? '' : 'locked'} ${L.boss ? 'boss' : ''} ${i === nx && open ? 'next' : ''}" data-i="${i}" style="animation-delay:${k * 0.04}s">
        <span class="num">${open ? i + 1 : '<span class="ic" data-icon="lock"></span>'}</span>
        <span class="nm">${L.name}</span>
        ${best ? `<span class="best">${fmtTime(best.time)}</span>` : ''}
        <span class="st">${[0, 1, 2].map(j => `<span class="ic ${j < st ? 'on' : ''}" data-icon="star"></span>`).join('')}</span>
      </button>`;
    }
    $('levelGrid').innerHTML = html;
    Icons.hydrate($('levelGrid'));
    $('levelGrid').querySelectorAll('.lvl').forEach(b => {
      b.onclick = () => {
        const i = +b.dataset.i;
        if (!Save.levelUnlocked(i)) { Sfx.denied(); toast('Clear the level before it first', 'lock'); return; }
        click(); play(i);
      };
    });
  }

  /* ------------------------------------------------------------ armory */
  function itemsFor(tab) { return tab === 'weapon' ? WEAPONS : tab === 'skin' ? SKINS : HATS; }
  function equipped(tab) { return tab === 'weapon' ? S().weapon : tab === 'skin' ? S().skin : S().hat; }
  function renderArmory() {
    document.querySelectorAll('.coin-val').forEach(e => { e.textContent = fmt(S().coins); });
    $('armoryTabs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === armoryTab));
    const list = itemsFor(armoryTab);
    if (!armorySel) armorySel = equipped(armoryTab);
    $('armoryGrid').innerHTML = list.map(it => {
      const own = Save.owns(armoryTab, it.id), eq = equipped(armoryTab) === it.id;
      let tag;
      if (eq) tag = '<small class="eq">EQUIPPED</small>';
      else if (own) tag = '<small class="own">OWNED</small>';
      else if (it.stars) tag = `<small><span class="ic star" data-icon="star"></span>${it.stars} STARS</small>`;
      else tag = `<small><span class="ic coin" data-icon="coin"></span>${fmt(it.price)}</small>`;
      return `<button class="item ${armorySel === it.id ? 'sel' : ''}" data-id="${it.id}"><canvas width="192" height="128"></canvas><b>${it.name}</b>${tag}</button>`;
    }).join('');
    Icons.hydrate($('armoryGrid'));
    $('armoryGrid').querySelectorAll('.item').forEach(b => {
      const id = b.dataset.id;
      drawThumb(b.querySelector('canvas'), armoryTab, id);
      b.onclick = () => { click(); armorySel = id; renderArmory(); };
    });
    renderPreviewInfo();
  }
  function renderPreviewInfo() {
    const it = Save.itemOf(armoryTab, armorySel);
    if (!it) return;
    const own = Save.owns(armoryTab, it.id), eq = equipped(armoryTab) === it.id;
    let stats = '';
    if (armoryTab === 'weapon') {
      const dmg = (it.pellets || 1) * (it.dmg || 1) * (it.blast ? 3 : 1);
      stats = `<div class="stats">
        <span>POWER</span><i style="--v:${Math.min(100, dmg / 6 * 100)}%"></i>
        <span>FIRE RATE</span><i style="--v:${clamp((1.1 - it.rate / (it.burst ? it.burst : 1)) / 1.05 * 100, 4, 100)}%"></i>
        <span>MAGAZINE</span><i style="--v:${Math.min(100, it.mag / 30 * 100)}%"></i>
        <span>RELOAD</span><i style="--v:${clamp((2.6 - it.reload) / 1.6 * 100, 4, 100)}%"></i>
      </div>`;
    }
    let btn;
    if (eq) btn = '<button class="btn" disabled><b>EQUIPPED</b></button>';
    else if (own) btn = '<button class="btn primary" id="armBtn"><b>EQUIP</b></button>';
    else if (it.stars) btn = `<button class="btn ${Save.canUnlockFree(armoryTab, it.id) ? 'primary' : ''}" id="armBtn" ${Save.canUnlockFree(armoryTab, it.id) ? '' : 'disabled'}><b>${Save.canUnlockFree(armoryTab, it.id) ? 'UNLOCK' : 'NEEDS ' + it.stars + ' STARS'}</b></button>`;
    else btn = `<button class="btn primary" id="armBtn" ${S().coins < it.price ? 'disabled' : ''}><b>BUY · ${fmt(it.price)}</b></button>`;
    $('previewInfo').innerHTML = `<b>${it.name}</b>${it.desc ? `<p>${it.desc}</p>` : ''}${stats}${btn}`;
    const ab = $('armBtn');
    if (ab) ab.onclick = () => {
      if (own) { Save.equip(armoryTab, it.id); click(); }
      else if (Save.buy(armoryTab, it.id)) { Sfx.unlock(); toast(it.name + ' unlocked', 'check'); }
      else { Sfx.denied(); return; }
      renderArmory();
    };
  }

  // a tiny posed figure for thumbnails and the preview
  function drawFigure(ctx, cx, cy, scale, o, t = 0) {
    const savedV = { x: View.V.x, y: View.V.y };
    View.V.x = 0; View.V.y = -30; View.rel = false;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(scale, scale);
    const skin = SKIN[o.skin] || SKINS[0];
    const b = o.body || new Body({ x: 0, y: 0, color: skin.body, dark: skin.dark, shine: skin.shine, rainbow: skin.rainbow, hat: o.hat });
    b.color = skin.body; b.dark = skin.dark; b.shine = skin.shine; b.rainbow = skin.rainbow; b.hat = o.hat;
    b.gunId = o.weapon; b.dual = !!(WEAPON[o.weapon] || {}).dual;
    b.pose({ x: 0, y: 0, facing: 1, aim: o.aim != null ? o.aim : -0.05 + Math.sin(t * 1.3) * 0.06, vx: 0, vy: 0, grounded: true, gun: !!o.weapon, twoHand: TWO_HAND.has(o.weapon), dual: b.dual }, 1 / 60);
    ctx.fillStyle = 'rgba(40,40,60,0.12)';
    ctx.beginPath(); ctx.ellipse(0, 0, 26, 5, 0, 0, TAU); ctx.fill();
    b.draw(ctx);
    ctx.restore();
    View.V.x = savedV.x; View.V.y = savedV.y;
    return b;
  }
  function drawThumb(cv, tab, id) {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (tab === 'weapon') {
      const savedV = { x: View.V.x, y: View.V.y };
      View.V.x = 0; View.V.y = 0; View.rel = false;
      ctx.save(); ctx.translate(cv.width / 2 - 40, cv.height / 2 + 6); ctx.scale(3, 3);
      drawGun(ctx, { x: 0, y: 0 }, 0, id, false);
      ctx.restore();
      View.V.x = savedV.x; View.V.y = savedV.y;
    } else if (tab === 'skin') {
      drawFigure(ctx, cv.width / 2, cv.height - 10, 1.15, { skin: id, hat: S().hat, weapon: null, aim: 0 });
    } else {
      drawFigure(ctx, cv.width / 2 - 2, 76 + 91 * 3.2, 3.2, { skin: S().skin, hat: id, weapon: null, aim: 0 });
    }
  }
  function renderPreview(t) {
    if (screen !== 'armory') return;
    const cv = $('previewCanvas'), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const sel = armorySel || equipped(armoryTab);
    const o = { skin: S().skin, hat: S().hat, weapon: S().weapon };
    if (armoryTab === 'weapon') o.weapon = sel; else if (armoryTab === 'skin') o.skin = sel; else o.hat = sel;
    previewBody = drawFigure(ctx, cv.width / 2 - 10, cv.height - 70, 2.1, Object.assign(o, { body: previewBody }), t);
  }

  /* ------------------------------------------------------------- play */
  function play(i) {
    closeModal();
    show(null);
    Game.startLevel(i);
    applyTouchVisibility();
  }
  function startEndless() {
    closeModal();
    show(null);
    Game.startEndless();
  }
  function quitToHome() {
    Platform.gameplayStop();
    closeModal();
    Game.paused = false;
    show('home');
  }

  function updateChip() {
    const m = Game.mode;
    const n = Game.roomCount, cur = Game.roomIdx;
    if (m === 'endless') {
      $('chipNum').innerHTML = '<span class="ic" data-icon="infinity"></span>';
      Icons.hydrate($('chipNum'));
      $('chipTitle').textContent = 'ENDLESS';
      $('chipSub').textContent = 'ROOM ' + (cur + 1);
      $('roomDots').innerHTML = '';
    } else {
      $('chipNum').textContent = Game.levelIdx + 1;
      $('chipTitle').textContent = Game.level.name;
      $('chipSub').textContent = 'ROOM ' + (cur + 1) + '/' + n;
      $('roomDots').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < cur ? 'done' : i === cur ? 'cur' : ''}"></i>`).join('');
    }
    document.body.classList.toggle('dark-room', Game.mode !== 'menu' && THEMES[Game.mode === 'endless' ? Math.floor(Game.endless.n / 4) % THEMES.length : Game.level.theme].dark);
  }

  /* -------------------------------------------------------------- hud */
  let lastAmmoKey = '';
  function tick(dt) {
    previewT += dt;
    if (screen === 'armory') renderPreview(previewT);
    if (screen !== null) return;
    const run = Game.run;
    if (!run) return;
    $('hudScore').textContent = fmt(run.score);
    $('hudTime').textContent = fmtTime(run.time);
    const f = $('focus');
    $('focusFill').style.transform = `scaleX(${Game.focus.toFixed(3)})`;
    f.classList.toggle('on', Game.slowOn);
    const tsl = document.querySelector('.tb-slow');
    if (tsl) tsl.classList.toggle('on', Game.slowOn);
    // combo
    const c = $('combo');
    if (run.combo > 1 && run.comboT > 0) {
      c.classList.remove('hidden');
      $('comboBar').style.transform = `scaleX(${clamp(run.comboT / 3, 0, 1).toFixed(3)})`;
    } else c.classList.add('hidden');
    // ammo
    const w = Game.weaponInfo;
    if (w) {
      const key = w.name + w.ammo + w.mag + w.reload;
      if (key !== lastAmmoKey) {
        lastAmmoKey = key;
        $('ammoName').textContent = w.name.toUpperCase();
        $('ammoNum').textContent = w.reload ? '...' : w.ammo;
        const mag = w.mag || w.ammo;
        $('ammoPips').innerHTML = mag <= 30 ? Array.from({ length: mag }, (_, i) => `<i class="${i < w.ammo && !w.reload ? '' : 'off'}"></i>`).join('') : '';
        $('ammo').classList.toggle('pickup', w.pickup);
        $('ammo').classList.toggle('reloading', w.reload);
        $('ammoHint').innerHTML = w.pickup ? 'NO RELOAD · DROPS WHEN EMPTY' : '<kbd>R</kbd> RELOAD';
      }
    }
    $('tbGrab').classList.toggle('hidden', !Game.nearPickup);
  }

  /* ------------------------------------------------------------ death */
  function onDeath(d) {
    const box = $('death');
    box.classList.remove('hidden');
    const btns = $('deathBtns');
    const touch = document.body.classList.contains('touch');
    if (d.mode === 'campaign') {
      $('deathTitle').textContent = pick(['DOWN', 'YOU DIED', 'WASTED TIME', 'FLATLINED', 'TOO SLOW']);
      $('deathSub').textContent = touch ? 'TAP TO RETRY' : 'CLICK OR PRESS R TO RETRY';
      btns.classList.add('hidden');
      box.onclick = () => Game.restartRoom();
      return;
    }
    // endless: revive once with an ad, or end the run
    box.onclick = null;
    $('deathTitle').textContent = 'RUN OVER';
    $('deathSub').textContent = 'ROOM ' + (Game.endless.n + 1) + ' · ' + fmt(Game.run.score) + ' PTS';
    const canAd = d.canRevive && Platform.rewardedAvailable && Date.now() - lastAdRevive > 60000;
    btns.innerHTML = (canAd ? '<button class="btn offer small" id="dRevive"><span class="ic" data-icon="adv"></span><b>REVIVE</b></button>' : '') + '<button class="btn primary small" id="dEnd"><b>SEE RESULTS</b></button>';
    Icons.hydrate(btns);
    btns.classList.remove('hidden');
    if ($('dRevive')) $('dRevive').onclick = () => {
      Platform.rewarded(ok => {
        if (ok) { lastAdRevive = Date.now(); box.classList.add('hidden'); Game.revive(); }
        else toast(Platform.adBlock ? 'Ads are blocked, so revive is unavailable' : 'No ad available right now', 'adv');
      });
    };
    $('dEnd').onclick = () => { box.classList.add('hidden'); endEndlessRun(); };
  }

  function endEndlessRun() {
    const r = Game.endEndless();
    const coins = Math.floor(r.score / 100) + r.rooms * 10;
    Save.addCoins(coins);
    Platform.gameplayStop();
    endlessRuns++;
    const showIt = () => openEndlessResults(r, coins);
    if (endlessRuns % 2 === 1) Platform.maybeMidgame(showIt); else showIt();
  }
  function openEndlessResults(r, coins) {
    if (r.isBest) Platform.happytime();
    openModal('endless', `
      <h2 class="${r.isBest ? 'win' : ''}">${r.isBest ? 'NEW BEST!' : 'RUN OVER'}</h2>
      <p class="sub">ENDLESS</p>
      <div class="res-score"><span>SCORE</span><b class="${r.isBest ? 'new' : ''}">${fmt(r.score)}</b></div>
      <div class="res-grid">
        <div><b>${r.rooms}</b><small>ROOMS</small></div>
        <div><b>${r.kills}</b><small>KILLS</small></div>
        <div><b>${r.headshots}</b><small>HEADSHOTS</small></div>
        <div><b>${fmt(Math.max(r.best, r.score))}</b><small>BEST</small></div>
      </div>
      <div class="coins-gain"><span class="ic coin" data-icon="coin"></span><span>+${coins}</span></div>
      <div class="actions">
        <button class="btn primary wide" id="rAgain"><b>RUN AGAIN</b></button>
        <button class="btn" id="rHome"><b>HOME</b></button>
        <button class="btn" id="rArmory"><b>ARMORY</b></button>
      </div>`);
    $('rAgain').onclick = () => { click(); startEndless(); };
    $('rHome').onclick = () => { click(); quitToHome(); };
    $('rArmory').onclick = () => { click(); quitToHome(); show('armory'); };
  }

  /* ---------------------------------------------------------- results */
  function onComplete(r) {
    const first = !(S().stars[r.level] > 0);
    const rec = Save.recordLevel(r.level, r.stars, r.time, r.score);
    const coins = 40 + r.stars * 20 + Math.floor(r.score / 150) + (first ? 60 : 0);
    Save.addCoins(coins);
    Platform.gameplayStop();
    levelsThisSession++;
    if (r.stars === 3 || getLevel(r.level).boss) Platform.happytime();
    const showIt = () => openResults(r, coins, first, rec);
    if (levelsThisSession % 2 === 0) Platform.maybeMidgame(showIt); else setTimeout(showIt, 650);
  }
  function openResults(r, coins, first) {
    const hasNext = r.level + 1 < LEVEL_COUNT;
    const labels = ['CLEARED', 'UNDER ' + fmtTime(r.par).replace('.0', ''), 'NO DEATHS'];
    const got = [true, r.time <= r.par, r.deaths === 0];
    const best = S().best[r.level];
    const canDouble = Platform.rewardedAvailable;
    openModal('results', `
      <h2 class="win">${r.stars === 3 ? 'PERFECT!' : 'LEVEL CLEAR'}</h2>
      <p class="sub">LEVEL ${r.level + 1} · ${getLevel(r.level).name.toUpperCase()}</p>
      <div class="res-stars">${labels.map((l, i) => `<div class="res-star ${got[i] ? 'on' : ''}"><span class="ic" data-icon="star" style="animation-delay:${0.15 + i * 0.22}s"></span><small>${l}</small></div>`).join('')}</div>
      <div class="res-grid">
        <div><b>${fmtTime(r.time)}</b><small>TIME</small></div>
        <div><b>${r.kills}</b><small>KILLS</small></div>
        <div><b>${r.headshots}</b><small>HEADSHOTS</small></div>
        <div><b>x${r.bestCombo || 0}</b><small>BEST COMBO</small></div>
      </div>
      <div class="res-score"><span>STYLE SCORE${best && best.score === r.score && r.score > 0 ? ' · <span class="new">BEST</span>' : ''}</span><b>${fmt(r.score)}</b></div>
      <div class="coins-gain"><span class="ic coin" data-icon="coin"></span><span id="coinGain">+${coins}</span>${first ? '<small style="font-size:12px;color:var(--muted);margin-left:6px">FIRST CLEAR BONUS</small>' : ''}</div>
      <div class="actions">
        <button class="btn primary ${canDouble ? '' : 'wide'}" id="rNext"><b>${hasNext ? 'NEXT LEVEL' : 'HOME'}</b></button>
        ${canDouble ? '<button class="btn offer" id="rDouble"><span class="ic" data-icon="adv"></span><b>DOUBLE COINS</b></button>' : ''}
        <button class="btn" id="rRetry"><b>RETRY</b></button>
        <button class="btn" id="rLevels"><b>LEVELS</b></button>
      </div>`);
    Icons.hydrate($('sheet'));
    for (let i = 0; i < 3; i++) if (got[i]) setTimeout(() => Sfx.star(i), 150 + i * 220);
    $('rNext').onclick = () => { click(); if (hasNext) play(r.level + 1); else quitToHome(); };
    $('rRetry').onclick = () => { click(); play(r.level); };
    $('rLevels').onclick = () => { click(); quitToHome(); chapter = Math.floor(r.level / LEVELS_PER_CHAPTER); show('levels'); };
    if ($('rDouble')) $('rDouble').onclick = () => {
      const b = $('rDouble');
      b.disabled = true;
      Platform.rewarded(ok => {
        if (ok) { Save.addCoins(coins); $('coinGain').textContent = '+' + coins * 2; Sfx.unlock(); b.remove(); $('rNext').classList.add('wide'); }
        else { b.disabled = false; toast(Platform.adBlock ? 'Ads are blocked, so this bonus is unavailable' : 'No ad available right now', 'adv'); }
      });
    };
  }

  /* ----------------------------------------------------------- modals */
  function openModal(kind, html) {
    modalOpen = true; modalKind = kind;
    document.body.classList.toggle('result-open', kind === 'results' || kind === 'endless');
    $('sheet').innerHTML = html;
    Icons.hydrate($('sheet'));
    $('modal').classList.remove('hidden');
    document.body.classList.remove('playing');
  }
  function closeModal() {
    modalOpen = false; modalKind = null;
    document.body.classList.remove('result-open');
    $('modal').classList.add('hidden');
    if (screen === null) document.body.classList.add('playing');
  }

  function openPause() {
    if (screen !== null || modalOpen || Game.state === 'complete' || Game.state === 'over') return;
    Game.paused = true;
    Platform.gameplayStop();
    Sfx.setMusicPaused(true);
    const camp = Game.mode === 'campaign';
    openModal('pause', `
      <h2>PAUSED</h2>
      <p class="sub">${camp ? 'LEVEL ' + (Game.levelIdx + 1) + ' · ' + Game.level.name.toUpperCase() : 'ENDLESS · ROOM ' + (Game.endless.n + 1)}</p>
      <div class="actions">
        <button class="btn primary wide" id="pResume"><b>RESUME</b></button>
        ${camp ? '<button class="btn" id="pRoom"><b>RESTART ROOM</b></button><button class="btn" id="pLevel"><b>RESTART LEVEL</b></button>' : '<button class="btn wide" id="pEnd"><b>END RUN</b></button>'}
        <button class="btn" id="pSettings"><b>SETTINGS</b></button>
        <button class="btn" id="pQuit"><b>QUIT</b></button>
      </div>
`);
    $('pResume').onclick = () => { click(); resume(); };
    if ($('pRoom')) $('pRoom').onclick = () => { click(); resume(); Game.restartRoom(); };
    if ($('pLevel')) $('pLevel').onclick = () => { click(); play(Game.levelIdx); };
    if ($('pEnd')) $('pEnd').onclick = () => { click(); closeModal(); Game.paused = false; endEndlessRun(); };
    $('pSettings').onclick = () => { click(); openSettings(true); };
    $('pQuit').onclick = () => { click(); quitToHome(); };
  }
  function resume() {
    closeModal();
    Game.paused = false;
    Sfx.setMusicPaused(false);
    if (Game.state === 'play' || Game.state === 'dead') Platform.gameplayStart();
  }
  function openSettings(fromPause) {
    const st = S().settings;
    const row = (k, icon, label) => `<div class="row"><span><span class="ic" data-icon="${icon}"></span>${label}</span><button class="toggle ${st[k] ? 'on' : ''}" data-k="${k}"></button></div>`;
    openModal('settings', `
      <h2>SETTINGS</h2>
      ${row('sfx', 'sound', 'SOUND EFFECTS')}
      ${row('music', 'music', 'MUSIC')}
      ${row('shake', 'shake', 'SCREEN SHAKE')}
      ${row('aimAssist', 'target', 'TOUCH AIM ASSIST')}
      <button class="btn primary" id="sDone"><b>${fromPause ? 'BACK' : 'DONE'}</b></button>`);
    $('sheet').querySelectorAll('.toggle').forEach(t => {
      t.onclick = () => { st[t.dataset.k] = !st[t.dataset.k]; Save.save(); applySettings(); t.classList.toggle('on', st[t.dataset.k]); click(); };
    });
    $('sDone').onclick = () => { click(); if (fromPause) { closeModal(); openPause(); } else closeModal(); };
  }
  function applySettings() {
    const st = S().settings;
    Sfx.setSfx(st.sfx); Sfx.setMusic(st.music);
  }

  function openMissions() {
    Save.rollDaily();
    const d = S().daily;
    const hrs = Math.ceil((86400000 - (Date.now() % 86400000)) / 3600000);
    openModal('missions', `
      <h2>DAILY MISSIONS</h2>
      <p class="sub">NEW MISSIONS IN ${hrs}H</p>
      ${d.list.map((m, i) => `<div class="mission ${m.claimed ? 'done' : ''}">
        <p>${m.text}</p>
        <button class="btn ${m.prog >= m.n && !m.claimed ? 'primary' : ''} small" data-i="${i}" ${m.prog >= m.n && !m.claimed ? '' : 'disabled'}><b>${m.claimed ? 'DONE' : '+' + m.reward}</b></button>
        <div class="bar2"><i style="width:${m.prog / m.n * 100}%"></i></div>
        <span class="prog">${m.prog} / ${m.n}</span>
      </div>`).join('')}
      <div class="row"><span><span class="ic" data-icon="gift"></span>FINISH ALL THREE</span><button class="btn small ${Save.allClaimed() && !d.bonus ? 'primary' : ''}" id="mBonus" ${Save.allClaimed() && !d.bonus ? '' : 'disabled'}><b>${d.bonus ? 'CLAIMED' : '+250'}</b></button></div>
      <button class="btn" id="mDone"><b>CLOSE</b></button>`);
    $('sheet').querySelectorAll('.mission .btn').forEach(b => {
      b.onclick = () => { const n = Save.claimMission(+b.dataset.i); if (n) { Sfx.coin(); toast('+' + n + ' coins', 'coin'); } openMissions(); renderHome(); };
    });
    $('mBonus').onclick = () => { const n = Save.claimBonus(); if (n) { Sfx.unlock(); toast('+' + n + ' coins', 'gift'); } openMissions(); renderHome(); };
    $('mDone').onclick = () => { click(); closeModal(); };
  }

  function openStreak() {
    const st = Save.streakState();
    openModal('streak', `
      <h2 class="win">DAILY REWARD</h2>
      <p class="sub">COME BACK EVERY DAY. DAY 7 PAYS BIG.</p>
      <div class="streak-row">${Save.STREAK.map((r, i) => `<div class="${i < st.day ? 'got' : i === st.day ? 'today' : ''}"><small>DAY ${i + 1}</small><span class="ic" data-icon="coin"></span>${r}</div>`).join('')}</div>
      <button class="btn primary" id="stClaim" ${st.claimable ? '' : 'disabled'}><b>${st.claimable ? 'CLAIM +' + st.reward : 'COME BACK TOMORROW'}</b></button>`);
    $('stClaim').onclick = () => {
      const n = Save.claimStreak();
      if (n) { Sfx.unlock(); toast('+' + n + ' coins', 'gift'); }
      closeModal(); renderHome();
    };
  }

  /* ------------------------------------------------------------ toasts */
  function toast(msg, icon = 'star') {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span class="ic" data-icon="${icon}"></span>${msg}`;
    Icons.hydrate(t);
    $('toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2700);
  }

  /* ------------------------------------------------------------- touch */
  function setupTouch() {
    const joy = $('joy'), knob = $('joyKnob'), base = joy.querySelector('.joy-base');
    let jid = null, jx = 0, jy = 0, lastY = 0;
    const R = () => parseFloat(getComputedStyle(document.body).getPropertyValue('--joy')) / 2 || 60;
    joy.addEventListener('pointerdown', e => {
      document.body.classList.add('touch'); Sfx.ensure();
      jid = e.pointerId; jx = e.clientX; jy = e.clientY;
      joy.classList.add('on');
      for (const el of [base, knob]) { el.style.left = jx + 'px'; el.style.top = jy + 'px'; }
      joy.setPointerCapture(e.pointerId);
    });
    joy.addEventListener('pointermove', e => {
      if (e.pointerId !== jid) return;
      const r = R();
      let dx = e.clientX - jx, dy = e.clientY - jy;
      const d = Math.hypot(dx, dy);
      if (d > r) { dx = dx / d * r; dy = dy / d * r; }
      knob.style.left = jx + dx + 'px'; knob.style.top = jy + dy + 'px';
      const ax = dx / r, ay = dy / r;
      Game.setAxis(ax, ay);
      if (ay < -0.62 && lastY >= -0.62) Game.press('jump');
      if (ay > 0.62 && lastY <= 0.62) Game.press('slide');
      lastY = ay;
    });
    const jend = e => {
      if (e.pointerId !== jid) return;
      jid = null; joy.classList.remove('on'); lastY = 0;
      for (const el of [base, knob]) { el.style.left = ''; el.style.top = ''; }
      Game.setAxis(0, 0);
    };
    joy.addEventListener('pointerup', jend); joy.addEventListener('pointercancel', jend);

    const pad = $('aimpad'), ak = $('aimKnob'), ab = pad.querySelector('.aim-base');
    let aid = null, ax0 = 0, ay0 = 0;
    pad.addEventListener('pointerdown', e => {
      document.body.classList.add('touch'); Sfx.ensure();
      aid = e.pointerId; ax0 = e.clientX; ay0 = e.clientY;
      pad.classList.add('on');
      for (const el of [ab, ak]) { el.style.left = ax0 + 'px'; el.style.top = ay0 + 'px'; }
      pad.setPointerCapture(e.pointerId);
      Game.setAimStick('auto');
      if (Game.state === 'dead' && Game.mode === 'campaign') Game.restartRoom();
    });
    pad.addEventListener('pointermove', e => {
      if (e.pointerId !== aid) return;
      const r = R();
      let dx = e.clientX - ax0, dy = e.clientY - ay0;
      const d = Math.hypot(dx, dy);
      if (d > r) { dx = dx / d * r; dy = dy / d * r; }
      ak.style.left = ax0 + dx + 'px'; ak.style.top = ay0 + dy + 'px';
      Game.setAimStick(d > 14 ? Math.atan2(dy, dx) : 'auto');
    });
    const aend = e => {
      if (e.pointerId !== aid) return;
      aid = null; pad.classList.remove('on');
      for (const el of [ab, ak]) { el.style.left = ''; el.style.top = ''; }
      Game.setAimStick(null);
    };
    pad.addEventListener('pointerup', aend); pad.addEventListener('pointercancel', aend);

    $('tbtns').querySelectorAll('.tb').forEach(b => {
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        document.body.classList.add('touch'); Sfx.ensure();
        if (Game.state === 'dead' && Game.mode === 'campaign') { Game.restartRoom(); return; }
        Game.press(b.dataset.act);
      });
    });
  }
  function applyTouchVisibility() { /* touch class is set on first touch */ }

  let rotateDismissed = false;
  function checkRotate() {
    const portrait = window.innerHeight > window.innerWidth * 1.1;
    const mobile = Platform.device() !== 'desktop';
    $('rotate').classList.toggle('hidden', !(portrait && mobile && !rotateDismissed));
  }

  return {
    init, tick, show, openPause, resume, toast, checkRotate, closeModal,
    get screen() { return screen; }, modalOpen: () => modalOpen, get modalKind() { return modalKind; },
  };
})();
