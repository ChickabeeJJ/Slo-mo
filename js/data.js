'use strict';
/* =========================================================================
   Static game data: weapons, enemy archetypes, skins, hats, daily missions.
   ========================================================================= */

// Player weapons. mag: rounds per magazine, rate: seconds between shots (player time),
// speed: bullet px/s, pierce: extra bodies a bullet passes through, pellets/spread for shotguns.
const WEAPONS = [
  { id: 'pistol', name: 'Pistol', price: 0, mag: 9, rate: 0.17, reload: 0.85, speed: 2100, spread: 0.012, pierce: 0, auto: false, len: 16, desc: 'Reliable. Fast reload.' },
  { id: 'revolver', name: 'Hand Cannon', price: 350, mag: 6, rate: 0.36, reload: 1.05, speed: 2900, spread: 0, pierce: 2, auto: false, len: 20, kick: 1.8, desc: 'Every round passes through 3 bodies.' },
  { id: 'smg', name: 'SMG', price: 700, mag: 26, rate: 0.072, reload: 1.1, speed: 2000, spread: 0.06, pierce: 0, auto: true, len: 20, desc: 'Hold to spray.' },
  { id: 'shotgun', name: 'Shotgun', price: 1000, mag: 5, rate: 0.55, reload: 1.15, speed: 1750, spread: 0.2, pellets: 6, life: 0.32, pierce: 0, auto: false, len: 26, kick: 2.4, desc: 'Six pellets. Point blank is lethal.' },
  { id: 'dual', name: 'Twin Pistols', price: 1400, mag: 18, rate: 0.1, reload: 1.0, speed: 2100, spread: 0.02, pierce: 0, auto: false, dual: true, len: 16, desc: 'One in each hand. Click fast.' },
  { id: 'rifle', name: 'Battle Rifle', price: 1900, mag: 20, rate: 0.12, reload: 1.2, speed: 2800, spread: 0.018, pierce: 1, auto: true, len: 30, desc: 'Full auto, rounds pierce once.' },
];
const WEAPON = Object.fromEntries(WEAPONS.map(w => [w.id, w]));

// Enemy archetypes. react: seconds before the first shot once they spot you,
// aim: telegraph time, cd: cooldown between attacks, turn: aim speed (rad/s)
const ENEMIES = {
  grunt: { name: 'Gunman', hp: 1, gun: 'pistol', react: 0.62, aim: 0.42, cd: [1.1, 1.6], speed: 900, burst: 1, burstGap: 0, spread: 0.03, turn: 3.2, walk: 90, scale: 1 },
  smg: { name: 'Sprayer', hp: 1, gun: 'smg', react: 0.66, aim: 0.38, cd: [1.4, 1.9], speed: 850, burst: 4, burstGap: 0.09, spread: 0.07, turn: 2.8, walk: 95, scale: 1 },
  shotgun: { name: 'Breacher', hp: 1, gun: 'shotgun', react: 0.55, aim: 0.45, cd: [1.4, 1.8], speed: 800, burst: 1, pellets: 5, spread: 0.22, life: 0.55, turn: 3, walk: 150, advance: true, scale: 1.04 },
  rifle: { name: 'Marksman', hp: 1, gun: 'rifle', react: 0.75, aim: 1.05, cd: [2.0, 2.6], speed: 1750, burst: 1, spread: 0, turn: 2.0, walk: 0, laser: true, scale: 1 },
  heavy: { name: 'Juggernaut', hp: 4, gun: 'smg', react: 0.7, aim: 0.5, cd: [1.6, 2.1], speed: 820, burst: 6, burstGap: 0.08, spread: 0.08, turn: 2.2, walk: 60, scale: 1.28, armor: true },
  knife: { name: 'Blade', hp: 1, gun: null, react: 0.4, walk: 330, scale: 0.97, melee: true },
};
const ENEMY_CHARS = { e: 'grunt', m: 'smg', s: 'shotgun', r: 'rifle', h: 'heavy', k: 'knife' };

// Player colours. The enemies are always red, so no skin is red.
const SKINS = [
  { id: 'sky', name: 'Sky', price: 0, body: '#7fb0e2', dark: '#5a8cc2' },
  { id: 'mint', name: 'Mint', price: 250, body: '#7ed9b8', dark: '#55b493' },
  { id: 'citrus', name: 'Citrus', price: 400, body: '#f2c45a', dark: '#cf9f35' },
  { id: 'violet', name: 'Violet', price: 600, body: '#a18df0', dark: '#7a66cc' },
  { id: 'onyx', name: 'Onyx', price: 900, body: '#3d4252', dark: '#262a36' },
  { id: 'coral', name: 'Coral', price: 900, body: '#ff9a76', dark: '#de7553' },
  { id: 'chrome', name: 'Chrome', price: 1500, body: '#d7dde6', dark: '#9aa4b4', shine: true },
  { id: 'gold', name: 'Gold', price: 2500, body: '#ffd34d', dark: '#d9a520', shine: true },
  { id: 'prism', name: 'Prism', price: 0, body: '#8fd0ff', dark: '#6aa0e0', rainbow: true, stars: 75 },
];
const SKIN = Object.fromEntries(SKINS.map(s => [s.id, s]));

const HATS = [
  { id: 'none', name: 'None', price: 0 },
  { id: 'band', name: 'Headband', price: 200 },
  { id: 'cap', name: 'Cap', price: 350 },
  { id: 'shades', name: 'Shades', price: 500 },
  { id: 'visor', name: 'Visor', price: 800 },
  { id: 'tophat', name: 'Top Hat', price: 1100 },
  { id: 'crown', name: 'Crown', price: 2000 },
  { id: 'halo', name: 'Halo', price: 0, stars: 45 },
];
const HAT = Object.fromEntries(HATS.map(h => [h.id, h]));

// Daily missions: three are drawn each day (UTC) from this pool.
const MISSION_POOL = [
  { id: 'kills', text: 'Take down {n} enemies', stat: 'kills', n: [25, 40], reward: 80 },
  { id: 'head', text: 'Land {n} headshots', stat: 'headshots', n: [8, 14], reward: 100 },
  { id: 'air', text: 'Get {n} kills in mid-air', stat: 'airKills', n: [4, 8], reward: 110 },
  { id: 'slide', text: 'Get {n} kills while sliding', stat: 'slideKills', n: [3, 6], reward: 110 },
  { id: 'slow', text: 'Get {n} kills in slow motion', stat: 'slowKills', n: [12, 20], reward: 90 },
  { id: 'deflect', text: 'Shoot {n} bullets out of the air', stat: 'deflects', n: [2, 5], reward: 130 },
  { id: 'levels', text: 'Clear {n} levels', stat: 'levels', n: [3, 5], reward: 90 },
  { id: 'stars', text: 'Earn {n} stars', stat: 'stars', n: [4, 8], reward: 100 },
  { id: 'boom', text: 'Take out {n} enemies with explosions', stat: 'boomKills', n: [3, 6], reward: 120 },
  { id: 'endless', text: 'Clear {n} rooms in Endless', stat: 'endlessRooms', n: [5, 9], reward: 120 },
  { id: 'multi', text: 'Get {n} multi-kills', stat: 'multis', n: [2, 4], reward: 130 },
  { id: 'flip', text: 'Get {n} kills during a flip', stat: 'flipKills', n: [2, 4], reward: 130 },
];

// Kill style table: label shown in the popup and score bonus on top of the base 100.
const STYLE = {
  headshot: { label: 'HEADSHOT', pts: 60 },
  air: { label: 'AIRBORNE', pts: 50 },
  slide: { label: 'SLIDE KILL', pts: 60 },
  flip: { label: 'FLIP KILL', pts: 90 },
  pierce: { label: 'PIERCE', pts: 70 },
  boom: { label: 'BOOM', pts: 60 },
  melee: { label: 'BEATDOWN', pts: 80 },
  last: { label: 'CLEAN', pts: 0 },
  close: { label: 'CLOSE CALL', pts: 40 },
};
