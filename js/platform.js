'use strict';
/* =========================================================================
   Platform layer: the CrazyGames HTML5 SDK v3, fully wrapped.
   - init + environment + device info
   - loading / gameplay events, happytime
   - midgame ads (frequency handled by the SDK) and rewarded ads, ad-block detection
   - responsive banners on menu screens (cleared during gameplay)
   - user accounts: current user, auth prompt, auth listener
   - data module for cloud saves (localStorage when standalone)
   - game settings (muteAudio) with a change listener
   Every call is guarded so the game runs unchanged offline or elsewhere.
   ========================================================================= */

const Platform = (() => {
  let sdk = null;
  let env = 'standalone';
  let ready = false;
  let inGameplay = false;
  let adInFlight = false;
  let adWaitOverlay = null;
  let adBlock = false;
  let user = null;
  const bannersShown = new Set();
  let lastProgress = null;
  const authListeners = [];
  const PREFIX = 'slomo_';
  // Ads are for a Full Launch on CrazyGames (Basic Launch builds must not show any:
  // set this to false for a Basic Launch upload). Off CrazyGames no ad is ever requested.
  //  - midgame: at the end of a run, before its results: every 2nd campaign level cleared and
  //    the 1st/3rd/5th… Endless run of a session; never from a button; the SDK decides whether one plays
  //  - rewarded: always opt-in, for a clear bonus
  //  - banner: desktop home screen only, never during gameplay
  const ADS_ENABLED = true;
  // CrazyGames leaderboards are invite-only and need the encryption key from the
  // developer portal. Leave the key empty and no score is ever sent.
  // The score is AES-GCM encrypted (random 12-byte IV, sent as base64 of IV + ciphertext + tag)
  // and submitted as { encryptedScore, score }. Check it in the CrazyGames QA tool before launch.
  const LEADERBOARD_KEY = '';           // base64 AES key from the CrazyGames developer portal
  const LEADERBOARD_COOLDOWN = 12 * 1000;
  let lastScoreAt = 0, pendingScore = null, scoreTimer = null;

  const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };

  async function init() {
    try {
      if (window.CrazyGames && window.CrazyGames.SDK) {
        await window.CrazyGames.SDK.init();
        sdk = window.CrazyGames.SDK;
        env = sdk.environment || 'crazygames';
        if (env === 'disabled') sdk = null;
      }
    } catch (e) { sdk = null; }
    ready = true;
    if (!sdk) return;
    // platform audio setting wins over the in-game toggles
    safe(() => {
      applySettings(sdk.game.settings);
      sdk.game.addSettingsChangeListener(applySettings);
    });
    // accounts
    safe(() => sdk.user.addAuthListener(u => {
      user = u || null;
      lastProgress = null;
      authListeners.forEach(cb => safe(() => cb(user)));
    }));
    if (safe(() => sdk.user.isUserAccountAvailable, false)) {
      try { user = await sdk.user.getUser(); } catch (e) { user = null; }
    }
    if (ADS_ENABLED) { try { adBlock = !!(await sdk.ad.hasAdblock()); } catch (e) { adBlock = false; } }
  }

  function applySettings(s) {
    if (!s) return;
    if (typeof Sfx !== 'undefined' && Sfx.setPlatformMute) Sfx.setPlatformMute(!!s.muteAudio);
  }

  /* ----------------------------------------------------------- storage */
  function store() {
    if (sdk && sdk.data) return sdk.data;
    try { localStorage.setItem(PREFIX + 't', '1'); return localStorage; } catch (e) { return null; }
  }
  const memory = {};
  function getItem(k) {
    const s = store();
    try { return s ? s.getItem(PREFIX + k) : (memory[k] ?? null); } catch (e) { return memory[k] ?? null; }
  }
  function setItem(k, v) {
    const s = store();
    try { if (s) s.setItem(PREFIX + k, v); else memory[k] = v; } catch (e) { memory[k] = v; }
  }
  function removeItem(k) {
    const s = store();
    try { if (s) s.removeItem(PREFIX + k); } catch (e) { /* ignore */ }
    delete memory[k];
  }

  /* ------------------------------------------------------------ events */
  function loadingStart() { safe(() => sdk && sdk.game.loadingStart()); }
  function loadingStop() { safe(() => sdk && sdk.game.loadingStop()); }
  function gameplayStart() {
    if (inGameplay) return; inGameplay = true;
    safe(() => sdk && sdk.game.gameplayStart());
  }
  function gameplayStop() {
    if (!inGameplay) return; inGameplay = false;
    safe(() => sdk && sdk.game.gameplayStop());
  }
  function happytime() { safe(() => sdk && sdk.game.happytime()); }
  function reportProgress(percent) {
    const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (value === lastProgress) return;
    lastProgress = value;
    safe(() => sdk && sdk.game && typeof sdk.game.reportGameCompletedPercentage === 'function' && sdk.game.reportGameCompletedPercentage(value));
  }

  /* --------------------------------------------------------------- ads */
  function setAdWaitOverlay(visible) {
    if (!visible) {
      if (adWaitOverlay) adWaitOverlay.remove();
      adWaitOverlay = null;
      return;
    }
    if (adWaitOverlay || !document.body) return;
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.textContent = 'PREPARING AD…';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      display: 'grid', placeItems: 'center',
      background: 'rgba(6, 8, 12, 0.82)', color: '#ffffff',
      font: '800 14px Rubik, sans-serif', letterSpacing: '0.12em',
      pointerEvents: 'auto', touchAction: 'none', userSelect: 'none',
    });
    document.body.appendChild(overlay);
    adWaitOverlay = overlay;
  }

  // cb(success:boolean). Without the SDK (other hosts, local testing) no ad runs and no reward is given.
  function requestAd(kind, cb) {
    if (!ADS_ENABLED || !sdk) { cb && cb(false); return; }
    if (adInFlight) { cb && cb(false); return; }
    adInFlight = true;
    setAdWaitOverlay(true);
    let done = false;
    const wasPlaying = inGameplay;
    const finish = ok => {
      if (done) return; done = true; adInFlight = false;
      setAdWaitOverlay(false);
      Sfx.setAdMuted(false);
      if (wasPlaying) gameplayStart();
      cb && cb(ok);
    };
    gameplayStop();
    try {
      sdk.ad.requestAd(kind, {
        adStarted: () => { setAdWaitOverlay(false); Sfx.setAdMuted(true); },
        adFinished: () => finish(true),
        adError: () => finish(false),
      });
    } catch (e) { finish(false); }
  }
  // UI decides when (every 2nd level clear, odd Endless runs); the SDK
  // applies its own frequency limits on top.
  function maybeMidgame(cb) {
    if (!ADS_ENABLED || !sdk) { cb && cb(); return; }
    requestAd('midgame', () => cb && cb());
  }
  function rewarded(cb) { requestAd('rewarded', cb); }

  /* ----------------------------------------------------------- banners */
  // containerId must be a visible element sized to a supported banner format.
  // The banner is requested ONCE per container and size; leaving the screen only hides the
  // container (see UI), so returning to the menu does not fire another request. It is only
  // requested again if the slot has to change size.
  const bannerSize = {};
  function showBanner(containerId) {
    if (!ADS_ENABLED || !sdk || inGameplay) return;
    const el = document.getElementById(containerId);
    if (!el || !el.offsetWidth) return;
    const size = el.offsetWidth + 'x' + el.offsetHeight;
    if (bannerSize[containerId] === size) return;          // already showing at this size
    if (bannerSize[containerId]) safe(() => sdk.banner.clearBanner(containerId));
    bannerSize[containerId] = size;
    bannersShown.add(containerId);
    try {
      const p = sdk.banner.requestResponsiveBanner(containerId);
      if (p && p.catch) p.catch(() => { delete bannerSize[containerId]; });
    } catch (e) { delete bannerSize[containerId]; }
  }
  function clearBanners() {
    if (!ADS_ENABLED || !sdk || !bannersShown.size) return;
    safe(() => sdk.banner.clearAllBanners());
    bannersShown.clear();
    for (const k in bannerSize) delete bannerSize[k];
  }

  /* -------------------------------------------------------------- user */
  async function login() {
    if (!sdk || !safe(() => sdk.user.isUserAccountAvailable, false)) return null;
    try { user = await sdk.user.showAuthPrompt(); } catch (e) { /* cancelled */ }
    return user;
  }
  function onAuth(cb) { authListeners.push(cb); }

  /* ------------------------------------------------------ leaderboard */
  // Only a single number (best Endless score) is sent, and only on CrazyGames with a key.
  // The platform shows it under the player's own CrazyGames username; nothing else is shared.
  const leaderboardOn = () => !!(sdk && LEADERBOARD_KEY && sdk.user && typeof sdk.user.submitScore === 'function' && window.crypto && crypto.subtle);
  async function encryptScore(score) {
    const raw = Uint8Array.from(atob(LEADERBOARD_KEY), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(score))));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv); out.set(ct, iv.length);
    let bin = ''; out.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function submitScore(score) {
    if (!leaderboardOn() || !user) return false;   // logged-in players only
    pendingScore = Math.max(0, Math.floor(score));
    const wait = Math.max(0, lastScoreAt + LEADERBOARD_COOLDOWN - Date.now());
    clearTimeout(scoreTimer);
    scoreTimer = setTimeout(async () => {
      const v = pendingScore; pendingScore = null; lastScoreAt = Date.now();
      try {
        const p = sdk.user.submitScore({ encryptedScore: await encryptScore(v), score: v });
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* ignore */ }
    }, wait);
    return true;
  }

  // Endless leaderboard entries for the in-game top 10, CrazyGames only. Resolve to
  // [{ rank, name, score }] from a real source; null hides the leaderboard panel.
  // The CrazyGames SDK documents score submission but no way to read entries yet,
  // so this stays null until such an API (or your own backend) is available.
  async function fetchLeaderboard() {
    if (!sdk) return null;
    return null;
  }

  function device() {
    const t = safe(() => sdk && sdk.user.systemInfo && sdk.user.systemInfo.device && sdk.user.systemInfo.device.type, null);
    if (t) return t;
    return matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
  }

  return {
    init, getItem, setItem, removeItem, loadingStart, loadingStop, gameplayStart, gameplayStop,
    happytime, reportProgress, requestAd, maybeMidgame, rewarded, showBanner, clearBanners, login, onAuth, device, submitScore, fetchLeaderboard,
    get leaderboardEnabled() { return leaderboardOn(); },
    get hasSdk() { return !!sdk; }, get ready() { return ready; }, get env() { return env; },
    get inGameplay() { return inGameplay; },
    get adBlock() { return adBlock; }, get adsEnabled() { return ADS_ENABLED && !!sdk; },
    get rewardedAvailable() { return ADS_ENABLED && !!sdk && !adBlock; },
    get user() { return user; },
    get accountsAvailable() { return !!sdk && safe(() => sdk.user.isUserAccountAvailable, false); },
  };
})();
