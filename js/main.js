'use strict';
/* =========================================================================
   Boot, main loop and keyboard/mouse input. Touch controls live in ui.js.
   ========================================================================= */

(async function boot() {
  const canvas = document.getElementById('stage');
  // SDK order: init, loadingStart, load everything, loadingStop, then the UI
  await Platform.init();
  Platform.loadingStart();
  Save.load();
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) document.body.classList.add('touch');
  try { await Promise.all([document.fonts.load('900 20px Rubik'), document.fonts.load('500 20px Rubik'), document.fonts.load('300 20px Exo2')]); } catch (e) { /* fonts are optional */ }
  Game.init(canvas);
  Platform.loadingStop();
  UI.init();

  const inPlay = () => UI.screen === null && !UI.modalOpen() && !Game.paused;

  /* ------------------------------------------------------------ mouse */
  canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') Game.setMouse(e.clientX, e.clientY); });
  canvas.addEventListener('pointerdown', e => {
    Sfx.ensure();
    if (e.pointerType !== 'mouse') { document.body.classList.add('touch'); return; }
    document.body.classList.remove('touch');
    Game.setMouse(e.clientX, e.clientY);
    if (!inPlay()) return;
    if (e.button === 0) { Game.setKey('shoot', true); Game.press('shoot'); }
    else if (e.button === 2) Game.press('slide');
  });
  window.addEventListener('pointerup', e => { if (e.pointerType === 'mouse' && e.button === 0) Game.setKey('shoot', false); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  /* --------------------------------------------------------- keyboard */
  const MOVE = { KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
  window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    Sfx.ensure();
    // P pauses (Escape is left to the browser for leaving fullscreen)
    if (e.code === 'KeyP') {
      if (UI.screen !== null) return;
      if (UI.modalOpen() && UI.modalKind === 'pause') UI.resume();
      else if (!UI.modalOpen()) UI.openPause();
      return;
    }
    // Ctrl is the hold-to-sprint key; Shift only slides
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') { Game.setKey('sprint', true); if (inPlay()) e.preventDefault(); }
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat && inPlay()) Game.press('shiftSlide');
    // while sprinting, stop the browser treating Ctrl+D / Ctrl+S / Ctrl+A etc. as shortcuts
    if (e.ctrlKey && inPlay() && !MOVE[e.code]) e.preventDefault();
    if (MOVE[e.code]) { Game.setKey(MOVE[e.code], true); if (inPlay() || e.ctrlKey) e.preventDefault(); }
    if (!inPlay() || e.repeat) return;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': case 'Space': e.preventDefault(); Game.press('jump'); break;
      case 'KeyS': case 'ArrowDown': case 'KeyC': e.preventDefault(); Game.press('slide'); break;
      case 'KeyQ': Game.press('slow'); break;
      case 'KeyR': Game.press('reload'); break;
      case 'KeyE': case 'KeyF': Game.press('pick'); break;
      case 'KeyJ': Game.setKey('shoot', true); Game.press('shoot'); break;
      default: break;
    }
  });
  window.addEventListener('keyup', e => {
    if (MOVE[e.code]) Game.setKey(MOVE[e.code], false);
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') Game.setKey('sprint', false);
    if (e.code === 'KeyJ') Game.setKey('shoot', false);
  });
  window.addEventListener('blur', () => { for (const k of ['left', 'right', 'sprint', 'shoot']) Game.setKey(k, false); });

  window.addEventListener('resize', () => {
    Game.resize(); UI.checkRotate();
    const panel = document.querySelector('.home-panel');
    if (panel && UI.screen === 'home') Game.setMenuInset(panel.getBoundingClientRect().right + Math.min(320, window.innerWidth * 0.2));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (UI.screen === null && !UI.modalOpen() && (Game.state === 'play' || Game.state === 'dead')) UI.openPause();
      Sfx.suspend(true);
    } else Sfx.suspend(false);
  });

  /* ------------------------------------------------------------- loop */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    Game.update(dt);
    Game.render();
    UI.tick(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
