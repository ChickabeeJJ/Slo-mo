'use strict';
/* =========================================================================
   Audio: every sound is synthesized with WebAudio (no files).
   Slow motion runs the whole mix through a low-pass filter, drops the pitch
   of new sounds and literally slows the music's tempo.
   ========================================================================= */

const Sfx = (() => {
  let ac = null, master = null, slowFilter = null, sfxBus = null, musicBus = null, noiseBuf = null;
  let sfxOn = true, musicOn = true, musicPaused = true, adMuted = false, platMuted = false;
  let pitch = 1, timeScale = 1, musicTimer = null, mstep = 0, nextAt = 0, intensity = 0, musicTarget = 0;

  function ensure() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.85;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    slowFilter = ac.createBiquadFilter(); slowFilter.type = 'lowpass'; slowFilter.frequency.value = 20000; slowFilter.Q.value = 0.9;
    master.connect(slowFilter); slowFilter.connect(comp); comp.connect(ac.destination);
    sfxBus = ac.createGain(); sfxBus.connect(master);
    musicBus = ac.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    applyGains();
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startMusic();
    return true;
  }

  function env(g, t, a, peak, dcy) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }

  function tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, delay = 0, bus = null) {
    if (!ac || (!bus && !sfxOn)) return;
    const p = bus ? 1 : pitch;
    dur /= bus ? 1 : Math.sqrt(p);
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq * p, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * p * slide), t + dur);
    env(g, t, 0.004, vol, dur);
    o.connect(g); g.connect(bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur, vol = 0.3, filt = 1200, type = 'lowpass', q = 1, delay = 0, sweep = 0, bus = null) {
    if (!ac || (!bus && !sfxOn)) return;
    const p = bus ? 1 : pitch;
    dur /= bus ? 1 : Math.sqrt(p);
    const t = ac.currentTime + delay;
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    s.playbackRate.value = rand(0.85, 1.15) * p;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(filt * p, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(30, filt * p * sweep), t + dur);
    const g = ac.createGain();
    env(g, t, 0.003, vol, dur);
    s.connect(f); f.connect(g); g.connect(bus || sfxBus);
    s.start(t, Math.random() * 1.2); s.stop(t + dur + 0.05);
  }

  /* ------------------------------------------------------------- guns */
  function shot(id) {
    if (!ensure()) return;
    switch (id) {
      case 'shotgun':
        noise(0.42, 0.75, 1800, 'lowpass', 0.7, 0, 0.18); tone(70, 0.3, 'sine', 0.6, 0.45); noise(0.08, 0.4, 5000, 'highpass');
        tone(260, 0.06, 'square', 0.04, 0.5, 0.33); noise(0.05, 0.2, 2500, 'bandpass', 4, 0.36);   // pump
        break;
      case 'revolver':
        noise(0.36, 0.7, 2600, 'lowpass', 0.8, 0, 0.15); tone(60, 0.34, 'sine', 0.6, 0.4); noise(0.06, 0.5, 6000, 'highpass');
        break;
      case 'rifle':
        noise(0.2, 0.55, 3600, 'lowpass', 1, 0, 0.2); tone(90, 0.16, 'sine', 0.42, 0.5); noise(0.04, 0.35, 7000, 'highpass');
        break;
      case 'smg':
        noise(0.12, 0.42, 3200, 'lowpass', 1, 0, 0.3); tone(120, 0.08, 'sine', 0.3, 0.5); noise(0.03, 0.25, 7000, 'highpass');
        break;
      default:
        noise(0.17, 0.55, 3000, 'lowpass', 0.9, 0, 0.2); tone(105, 0.13, 'sine', 0.42, 0.45); noise(0.04, 0.3, 6500, 'highpass');
    }
  }
  function enemyShot(id) {
    if (!ensure()) return;
    if (id === 'shotgun') { noise(0.36, 0.5, 1300, 'lowpass', 0.7, 0, 0.2); tone(65, 0.26, 'sine', 0.4, 0.5); return; }
    if (id === 'rifle') { noise(0.3, 0.55, 4200, 'lowpass', 1, 0, 0.12); tone(80, 0.25, 'sine', 0.4, 0.4); noise(0.05, 0.35, 8000, 'highpass'); return; }
    noise(0.15, 0.38, 2100, 'lowpass', 0.9, 0, 0.25); tone(95, 0.12, 'sine', 0.3, 0.5);
  }
  function dry() { if (!ensure()) return; tone(1500, 0.03, 'square', 0.04, 0.6); }
  function reload() { if (!ensure()) return; noise(0.05, 0.2, 2400, 'bandpass', 5); tone(700, 0.04, 'square', 0.03, 0.7, 0.0); noise(0.06, 0.24, 1800, 'bandpass', 6, 0.22); tone(420, 0.05, 'square', 0.04, 1.3, 0.24); }
  function shell() { if (!ensure()) return; const f = rand(3800, 5200); tone(f, 0.07, 'sine', 0.035, 0.98); tone(f * 1.5, 0.05, 'sine', 0.02, 1, 0.05); }
  function whiz() { if (!ensure()) return; noise(0.22, 0.22, 2600, 'bandpass', 3, 0, 0.35); }
  function ricochet() { if (!ensure()) return; tone(rand(1800, 2600), 0.22, 'sine', 0.05, 0.55); noise(0.05, 0.16, 3000, 'bandpass', 2); }
  function wallHit() { if (!ensure()) return; noise(0.07, 0.2, 1400, 'bandpass', 1.5); tone(rand(160, 220), 0.05, 'triangle', 0.08, 0.6); }
  function deflect() { if (!ensure()) return; tone(2400, 0.32, 'triangle', 0.12, 0.92); tone(3600, 0.2, 'sine', 0.06, 0.9, 0.02); noise(0.06, 0.25, 6000, 'highpass'); }
  function laser() { if (!ensure()) return; tone(880, 0.25, 'sine', 0.03, 1.6); }

  /* ------------------------------------------------------------ bodies */
  function hit(head) {
    if (!ensure()) return;
    noise(0.12, 0.5, 700, 'lowpass', 1.5); tone(head ? 180 : 120, 0.12, 'sine', 0.38, 0.5);
    if (head) { tone(900, 0.08, 'square', 0.05, 0.5); noise(0.05, 0.3, 4000, 'highpass', 1, 0.01); }
  }
  function armor() { if (!ensure()) return; tone(1300, 0.15, 'triangle', 0.1, 0.7); noise(0.06, 0.3, 3500, 'bandpass', 3); }
  function crumble() { if (!ensure()) return; for (let i = 0; i < 5; i++) { noise(0.05, 0.12, rand(600, 1400), 'bandpass', 2, i * 0.045); tone(rand(180, 320), 0.04, 'triangle', 0.05, 0.7, i * 0.045); } }
  function thud(v = 1) { if (!ensure()) return; noise(0.08, 0.16 * v, 500, 'lowpass', 1); tone(rand(90, 130), 0.07, 'sine', 0.14 * v, 0.6); }
  function hurtPlayer() { if (!ensure()) return; tone(160, 0.5, 'sawtooth', 0.12, 0.4); noise(0.4, 0.4, 600, 'lowpass', 1, 0, 0.3); }
  function swing() { if (!ensure()) return; noise(0.16, 0.28, 2200, 'bandpass', 1.5, 0, 0.45); }
  function glass() { if (!ensure()) return; for (let i = 0; i < 9; i++) tone(rand(2500, 6200), rand(0.08, 0.3), 'sine', 0.05, rand(0.8, 1.1), i * 0.022); noise(0.35, 0.35, 5000, 'highpass', 0.8); }
  function boom() { if (!ensure()) return; noise(1.1, 0.9, 900, 'lowpass', 0.8, 0, 0.12); tone(55, 0.9, 'sine', 0.75, 0.35); noise(0.2, 0.5, 3000, 'bandpass', 0.6); }
  function crate() { if (!ensure()) return; noise(0.1, 0.25, 900, 'bandpass', 2); tone(rand(140, 200), 0.08, 'triangle', 0.12, 0.7); }

  /* ------------------------------------------------------------ player */
  function step() { if (!ensure()) return; noise(0.04, 0.07, rand(700, 1100), 'lowpass', 1); }
  function jump() { if (!ensure()) return; noise(0.1, 0.12, 1600, 'bandpass', 1, 0, 1.6); }
  function land(v = 1) { if (!ensure()) return; noise(0.08, 0.16 * v, 600, 'lowpass', 1); tone(90, 0.06, 'sine', 0.1 * v, 0.6); }
  function slide() { if (!ensure()) return; noise(0.45, 0.22, 1100, 'bandpass', 0.7, 0, 0.5); }
  function flip() { if (!ensure()) return; noise(0.3, 0.16, 900, 'bandpass', 1.2, 0, 2.5); }
  function slowIn() { if (!ac) return; noise(0.7, 0.35, 2400, 'bandpass', 0.8, 0, 0.12, sfxBus); tone(420, 0.8, 'sine', 0.16, 0.35, 0, sfxBus); tone(80, 0.9, 'sine', 0.3, 0.6, 0, sfxBus); }
  function slowOut() { if (!ac) return; noise(0.4, 0.22, 300, 'bandpass', 0.8, 0, 6, sfxBus); tone(150, 0.4, 'sine', 0.12, 2.6, 0, sfxBus); }
  function heartbeat() { if (!ac || !sfxOn) return; tone(52, 0.16, 'sine', 0.35, 0.7, 0, sfxBus); tone(48, 0.18, 'sine', 0.26, 0.7, 0.19, sfxBus); }

  /* ---------------------------------------------------------------- ui */
  function door() { if (!ensure()) return; tone(520, 0.12, 'triangle', 0.08, 1); tone(780, 0.2, 'triangle', 0.08, 1, 0.09); }
  function clear() { if (!ensure()) return; [523, 784, 1047].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, 1, i * 0.07)); }
  function click() { if (!ensure()) return; tone(900, 0.05, 'triangle', 0.08, 0.8); }
  function coin(i = 0) { if (!ensure()) return; tone(1320 + i * 40, 0.12, 'square', 0.03, 1); tone(1980 + i * 60, 0.15, 'sine', 0.05, 1, 0.04); }
  function star(i) { if (!ensure()) return; [659, 784, 988][i % 3] && tone([659, 830, 1046][i % 3], 0.5, 'triangle', 0.14, 1); tone([1318, 1660, 2092][i % 3], 0.35, 'sine', 0.05, 1, 0.03); }
  function combo(n) { if (!ensure()) return; tone(440 * Math.pow(2, Math.min(n, 12) / 12), 0.12, 'triangle', 0.08, 1.2); }
  function win() { if (!ensure()) return; [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.38, 'triangle', 0.14, 1, i * 0.09)); }
  function lose() { if (!ensure()) return; [392, 311, 262].forEach((f, i) => tone(f, 0.4, 'triangle', 0.12, 0.98, i * 0.13)); }
  function unlock() { if (!ensure()) return; [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.5, 'sine', 0.12, 1, i * 0.07)); }
  function denied() { if (!ensure()) return; tone(160, 0.12, 'square', 0.05, 0.8); }

  /* -------------------------------------------------------------- music */
  // A driving minimal loop. Its clock runs on game time, so slow motion drags the beat.
  const BASS = [0, 0, 12, 0, 10, 0, 7, 0, 0, 0, 12, 0, 15, 12, 10, 7];
  const PROG = [0, -4, 3, -2];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  function kick(t, v) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.35);
  }
  function hat(t, v, open) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = ac.createGain(); env(g, t, 0.002, 0.12 * v, open ? 0.14 : 0.04);
    s.connect(f); f.connect(g); g.connect(musicBus); s.start(t, Math.random()); s.stop(t + 0.2);
  }
  function bass(freq, t, len, v) {
    const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = freq;
    f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(220 + 900 * v, t); f.frequency.exponentialRampToValueAtTime(140, t + len);
    env(g, t, 0.005, 0.2, len);
    o.connect(f); f.connect(g); g.connect(musicBus); o.start(t); o.stop(t + len + 0.05);
  }
  function pad(freq, t, len) {
    for (const det of [-7, 7]) {
      const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
      f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.035, t + len * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + len);
      o.connect(f); f.connect(g); g.connect(musicBus); o.start(t); o.stop(t + len + 0.1);
    }
  }
  function blip(freq, t) { tone(freq, 0.18, 'triangle', 0.05, 1, t - ac.currentTime, musicBus); }

  function startMusic() {
    if (musicTimer || !ac) return;
    nextAt = ac.currentTime + 0.1;
    musicTimer = setInterval(() => {
      if (!ac || ac.state !== 'running') return;
      intensity = approach(intensity, musicTarget, 0.02);
      while (nextAt < ac.currentTime + 0.25) {
        const sixteenth = 60 / 122 / 4 / Math.max(0.3, timeScale);
        const s = mstep % 16, bar = Math.floor(mstep / 16), root = 45 + PROG[bar % 4];
        if (s % 4 === 0) kick(nextAt, 1);
        if (intensity > 0.3 && s === 14 && bar % 2) kick(nextAt, 0.6);
        if (s % 4 === 2) hat(nextAt, 1, true);
        else if (intensity > 0.5) hat(nextAt, 0.45, false);
        bass(mtof(root + BASS[s] - 12), nextAt, sixteenth * 1.6, intensity);
        if (s === 0) pad(mtof(root + 12), nextAt, sixteenth * 16), pad(mtof(root + 19), nextAt, sixteenth * 16);
        if (intensity > 0.15 && (s === 3 || s === 6 || s === 11)) blip(mtof(root + 24 + [0, 7, 10, 12, 15][(bar + s) % 5]), nextAt);
        nextAt += sixteenth; mstep++;
      }
    }, 60);
  }

  function applyGains() {
    if (!ac) return;
    const t = ac.currentTime;
    const music = musicOn && !musicPaused && !adMuted && !platMuted;
    sfxBus.gain.setTargetAtTime(sfxOn && !adMuted && !platMuted ? 0.6 : 0, t, 0.05);
    musicBus.gain.setTargetAtTime(music ? 0.32 : 0, t, 0.3);
  }
  // world time scale: 1 normal, ~0.25 in slow motion
  function setTime(ts) {
    timeScale = ts;
    pitch = lerp(0.62, 1, clamp((ts - 0.2) / 0.8, 0, 1));
    if (slowFilter) slowFilter.frequency.setTargetAtTime(ts > 0.95 ? 20000 : lerp(700, 9000, clamp((ts - 0.2) / 0.8, 0, 1)), ac.currentTime, 0.05);
  }
  function setIntensity(v) { musicTarget = clamp(v, 0, 1); }
  function setSfx(on) { sfxOn = on; applyGains(); }
  function setMusic(on) { musicOn = on; applyGains(); }
  function setMusicPaused(p) { musicPaused = !!p; applyGains(); }
  function setAdMuted(m) { adMuted = m; applyGains(); }
  function setPlatformMute(m) { platMuted = m; applyGains(); }
  function suspend(s) { if (ac) s ? ac.suspend() : ac.resume(); }

  return {
    ensure, shot, enemyShot, dry, reload, shell, whiz, ricochet, wallHit, deflect, laser, hit, armor, crumble, thud, hurtPlayer, swing,
    glass, boom, crate, step, jump, land, slide, flip, slowIn, slowOut, heartbeat, door, clear, click, coin, star, combo, win, lose,
    unlock, denied, setTime, setIntensity, setSfx, setMusic, setMusicPaused, setAdMuted, setPlatformMute, suspend,
  };
})();
