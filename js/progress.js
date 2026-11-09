'use strict';
/* =========================================================================
   Progress: save data, unlocks, the armory, daily missions and login streak.
   Saved through Platform (CrazyGames data module, else localStorage).
   ========================================================================= */

const Save = (() => {
  const KEY = 'save_v1';
  const fresh = () => ({
    coins: 0,
    stars: {},                 // level index -> 0..3
    best: {},                  // level index -> { time, score }
    weapons: ['pistol'], weapon: 'pistol',
    skins: ['sky'], skin: 'sky',
    hats: ['none'], hat: 'none',
    armors: [], armor: { head: null, body: null, legs: null },
    settings: { sfx: true, music: true, shake: true, aimAssist: true },
    endlessBest: 0, endlessRooms: 0,
    stats: { kills: 0, headshots: 0, deaths: 0, levels: 0, slowKills: 0, deflects: 0 },
    daily: { day: -1, list: [], bonus: false },
    streak: { day: -1, count: 0, claimedDay: -1 },
    seenIntro: false,
  });
  let data = fresh();

  function load() {
    try {
      const raw = Platform.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const f = fresh();
        data = Object.assign(f, d);
        data.settings = Object.assign(fresh().settings, d.settings || {});
        data.stats = Object.assign(fresh().stats, d.stats || {});
        data.daily = Object.assign(fresh().daily, d.daily || {});
        data.streak = Object.assign(fresh().streak, d.streak || {});
        for (const k of ['weapons', 'skins', 'hats', 'armors']) if (!Array.isArray(data[k])) data[k] = fresh()[k];
        data.armor = Object.assign(fresh().armor, d.armor || {});
      }
    } catch (e) { data = fresh(); }
    rollDaily();
    reportProgress();
  }
  function save() { try { Platform.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ } }
  function reportProgress() {
    const cleared = Object.values(data.stars).filter(s => s > 0).length;
    Platform.reportProgress(cleared / LEVEL_COUNT * 100);
  }

  const totalStars = () => Object.values(data.stars).reduce((a, b) => a + b, 0);
  const levelUnlocked = i => i === 0 || (data.stars[i - 1] || 0) > 0;
  const nextLevel = () => { for (let i = 0; i < LEVEL_COUNT; i++) if (!(data.stars[i] > 0)) return i; return LEVEL_COUNT - 1; };
  const endlessUnlocked = () => (data.stars[2] || 0) > 0;

  function addCoins(n) { data.coins = Math.max(0, data.coins + Math.round(n)); save(); }

  // returns { newStars, firstClear }
  function recordLevel(i, stars, time, score) {
    const prev = data.stars[i] || 0;
    const firstClear = prev === 0;
    if (stars > prev) data.stars[i] = stars;
    const b = data.best[i] || { time: 1e9, score: 0 };
    data.best[i] = { time: Math.min(b.time, time), score: Math.max(b.score, score) };
    track('levels', 1);
    if (stars > prev) track('stars', stars - prev);
    save(); reportProgress();
    return { newStars: Math.max(0, stars - prev), firstClear };
  }

  /* -------------------------------------------------------------- armory */
  const listOf = kind => (kind === 'weapon' ? data.weapons : kind === 'skin' ? data.skins : kind === 'armor' ? data.armors : data.hats);
  function owns(kind, id) { return listOf(kind).includes(id); }
  function itemOf(kind, id) { return (kind === 'weapon' ? WEAPON : kind === 'skin' ? SKIN : kind === 'armor' ? ARMOR_BY : HAT)[id]; }
  // star-locked cosmetics unlock for free once you have enough stars
  function canUnlockFree(kind, id) { const it = itemOf(kind, id); return it && it.stars && totalStars() >= it.stars; }
  function buy(kind, id) {
    const it = itemOf(kind, id);
    if (!it || owns(kind, id)) return false;
    if (it.stars) { if (!canUnlockFree(kind, id)) return false; }
    else if (data.coins < it.price) return false;
    else data.coins -= it.price;
    // star-locked items (Prism, Halo) never spend stars: reaching the total is enough
    listOf(kind).push(id);
    equip(kind, id);
    return true;
  }
  function equip(kind, id) {
    if (!owns(kind, id)) return false;
    if (kind === 'weapon') data.weapon = id; else if (kind === 'skin') data.skin = id;
    else if (kind === 'armor') data.armor[ARMOR_BY[id].slot] = id; else data.hat = id;
    save(); return true;
  }
  function unequipArmor(slot) { data.armor[slot] = null; save(); }

  /* ------------------------------------------------------------- missions */
  function rollDaily() {
    const day = dayIndex();
    if (data.daily.day === day && data.daily.list.length) return;
    const R = mulberry32(day * 2654435761 >>> 0);
    const pool = MISSION_POOL.slice();
    const list = [];
    while (list.length < 3 && pool.length) {
      const m = pool.splice(Math.floor(R() * pool.length), 1)[0];
      if (m.stat === 'endlessRooms' && !endlessUnlocked()) continue;
      const n = m.n[0] + Math.floor(R() * (m.n[1] - m.n[0] + 1));
      list.push({ id: m.id, stat: m.stat, n, prog: 0, reward: m.reward, claimed: false, text: m.text.replace('{n}', n) });
    }
    data.daily = { day, list, bonus: false };
    save();
  }
  function track(stat, n = 1) {
    if (data.stats[stat] != null) data.stats[stat] += n;
    rollDaily();
    let done = null;
    for (const m of data.daily.list) {
      if (m.stat !== stat || m.prog >= m.n) continue;
      m.prog = Math.min(m.n, m.prog + n);
      if (m.prog >= m.n) done = m;
    }
    return done;
  }
  function claimMission(i) {
    const m = data.daily.list[i];
    if (!m || m.claimed || m.prog < m.n) return 0;
    m.claimed = true; data.coins += m.reward; save();
    return m.reward;
  }
  const allClaimed = () => data.daily.list.length > 0 && data.daily.list.every(m => m.claimed);
  function claimBonus() {
    if (!allClaimed() || data.daily.bonus) return 0;
    data.daily.bonus = true; data.coins += 250; save(); return 250;
  }
  const missionsReady = () => data.daily.list.some(m => !m.claimed && m.prog >= m.n) || (allClaimed() && !data.daily.bonus);

  /* --------------------------------------------------------- login streak */
  const STREAK = [50, 75, 100, 125, 150, 200, 400];
  function streakState() {
    const day = dayIndex(), s = data.streak;
    const claimable = s.claimedDay !== day;
    let count = s.count;
    if (claimable && s.claimedDay !== day - 1) count = 0;   // missed a day: back to day 1
    return { claimable, day: count % 7, reward: STREAK[count % 7], count };
  }
  function claimStreak() {
    const st = streakState();
    if (!st.claimable) return 0;
    data.streak = { day: dayIndex(), count: st.count + 1, claimedDay: dayIndex() };
    data.coins += st.reward; save();
    return st.reward;
  }

  return {
    load, save, get data() { return data; }, totalStars, levelUnlocked, nextLevel, endlessUnlocked, addCoins, recordLevel,
    owns, buy, equip, unequipArmor, canUnlockFree, itemOf, rollDaily, track, claimMission, claimBonus, allClaimed, missionsReady,
    streakState, claimStreak, STREAK,
  };
})();
