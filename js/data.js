'use strict';
/* =========================================================================
   Static game data: weapons, enemy archetypes, skins, hats, daily missions.
   ========================================================================= */

// Player weapons. mag: rounds per magazine, rate: seconds between shots (player time),
// dmg: damage per hit (armour soaks 1 per point), pellets/spread for shotguns. Gimmicks: burst, bounce,
// split, homing, gravity + blast (grenades), spinup (minigun), rail + wallPierce (railgun: instant beam through everything).
// Every player round flies at the same slow, readable speed (like the original demo), so
// shots have to be led. rate: seconds between shots in player time.
const BULLET_SPEED = 900;
const WEAPONS = [
  { id: 'pistol', name: 'Pistol', price: 0, mag: 9, rate: 0.34, reload: 1.1, spread: 0.012, len: 16, desc: 'Reliable. Fast reload.' },
  { id: 'revolver', name: 'Hand Cannon', price: 350, mag: 6, rate: 0.7, reload: 1.4, spread: 0, dmg: 2, len: 20, kick: 1.8, big: true, desc: 'Double damage: drops a Juggernaut or Brute in one hit.' },
  { id: 'smg', name: 'SMG', price: 700, mag: 26, rate: 0.13, reload: 1.4, spread: 0.06, auto: true, len: 20, desc: 'Hold to spray.' },
  { id: 'burst', name: 'Burst Rifle', price: 850, mag: 21, rate: 0.75, reload: 1.5, spread: 0.02, burst: 3, burstGap: 0.08, len: 26, desc: 'Three-round burst on every click.' },
  { id: 'shotgun', name: 'Shotgun', price: 1000, mag: 5, rate: 1.0, reload: 1.5, spread: 0.2, pellets: 6, life: 0.7, len: 26, kick: 2.4, big: true, desc: 'Six pellets. Point blank is lethal.' },
  { id: 'bouncer', name: 'Ricochet', price: 1150, mag: 6, rate: 0.5, reload: 1.3, spread: 0.01, bounce: 3, life: 3.5, len: 18, desc: 'Rounds bounce off walls 3 times. Bank your shots.' },
  { id: 'splitter', name: 'Splitter', price: 1300, mag: 7, rate: 0.6, reload: 1.4, spread: 0.01, split: { t: 0.24, n: 2, a: 0.22 }, len: 20, desc: 'Each round splits into three mid-flight.' },
  { id: 'dual', name: 'Twin Pistols', price: 1400, mag: 18, rate: 0.2, reload: 1.3, spread: 0.02, dual: true, len: 16, desc: 'One in each hand. Click fast.' },
  { id: 'smart', name: 'Seeker', price: 1650, mag: 10, rate: 0.45, reload: 1.3, spread: 0.02, homing: 3.2, life: 3, len: 18, desc: 'Rounds curve toward the nearest enemy.' },
  { id: 'rifle', name: 'Battle Rifle', price: 1900, mag: 20, rate: 0.22, reload: 1.6, spread: 0.018, auto: true, len: 30, desc: 'Steady full auto with a tight spread.' },
  { id: 'launcher', name: 'Launcher', price: 2200, mag: 4, rate: 1.0, reload: 2.0, spread: 0, gravity: 900, speedK: 0.85, blast: 115, len: 28, kick: 2.2, big: true, desc: 'Arcing grenades that blow on impact. Mind the splash.' },
  { id: 'minigun', name: 'Minigun', price: 2600, mag: 15, rate: 0.08, reload: 2.6, spread: 0.1, auto: true, spinup: 0.9, heavy: true, len: 30, desc: 'Spins up, then shreds. You move slowly while firing.' },
  { id: 'railgun', name: 'Railgun', price: 5000, mag: 3, rate: 0.6, reload: 2.0, spread: 0, rail: true, charge: 0.55, dmg: 4, wallPierce: true, len: 34, kick: 3, big: true, desc: 'A short charge, then an instant beam through every enemy, shield, crate and wall in its path.' },
];
const WEAPON = Object.fromEntries(WEAPONS.map(w => [w.id, w]));

// Enemy archetypes. react: seconds before the first shot once they spot you,
// aim: telegraph time, cd: cooldown between attacks, turn: aim speed (rad/s)
const ENEMIES = {
  grunt: { name: 'Gunman', hp: 1, gun: 'pistol', react: 0.62, aim: 0.42, cd: [1.1, 1.6], speed: 900, burst: 1, burstGap: 0, spread: 0.03, turn: 3.2, walk: 90, scale: 1 },
  smg: { name: 'Sprayer', hp: 1, gun: 'smg', react: 0.66, aim: 0.38, cd: [1.4, 1.9], speed: 850, burst: 4, burstGap: 0.09, spread: 0.07, turn: 2.8, walk: 95, scale: 1 },
  shotgun: { name: 'Breacher', hp: 1, gun: 'shotgun', react: 0.55, aim: 0.45, cd: [1.4, 1.8], speed: 800, burst: 1, pellets: 5, spread: 0.22, life: 0.55, turn: 3, walk: 150, advance: true, scale: 1.04 },
  rifle: { name: 'Marksman', hp: 1, gun: 'rifle', react: 0.75, aim: 1.05, cd: [2.0, 2.6], speed: 1750, burst: 1, spread: 0, turn: 2.0, walk: 0, laser: true, scale: 1 },
  // big but fair: two body hits (a headshot or a Hand Cannon round drops it in one), short slow bursts
  heavy: { name: 'Juggernaut', hp: 2, gun: 'smg', react: 0.8, aim: 0.6, cd: [2.0, 2.6], speed: 760, burst: 3, burstGap: 0.12, spread: 0.1, turn: 1.9, walk: 60, scale: 1.28, armor: true },
  knife: { name: 'Blade', hp: 1, gun: null, react: 0.4, walk: 330, scale: 0.97, melee: true },
  // riot shield: blocks rounds from the front; head is exposed, the back is open, explosions and the railgun go through
  shield: { name: 'Riot', hp: 1, gun: 'pistol', react: 0.7, aim: 0.5, cd: [1.4, 1.9], speed: 850, burst: 1, spread: 0.04, turn: 2.4, walk: 75, scale: 1.05, advance: true, shield: true, hat: 'riot' },
  // lobs grenades at where you stand; the blast zone is marked on the floor and you can shoot them out of the air
  grenadier: { name: 'Grenadier', hp: 1, gun: null, react: 0.8, cd: [2.4, 3.1], walk: 70, scale: 1, grenadier: true, hat: 'olive' },
  // big and tough: winds up, then charges in a straight line; jump over it, or make it hit a wall and stun itself
  brute: { name: 'Brute', hp: 2, gun: null, react: 0.5, walk: 105, scale: 1.32, brute: true, color: '#c4343d', dark: '#8f2229' },
};
const ENEMY_CHARS = { e: 'grunt', m: 'smg', s: 'shotgun', r: 'rifle', h: 'heavy', k: 'knife', i: 'shield', n: 'grenadier', y: 'brute' };

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
  { id: 'prism', name: 'Prism', price: 0, body: '#e6f6ff', dark: '#b9d8f0', prism: true, stars: 120 },
];
const SKIN = Object.fromEntries(SKINS.map(s => [s.id, s]));

const HATS = [
  { id: 'none', name: 'None', price: 0 },
  { id: 'band', name: 'Headband', price: 200 },
  { id: 'beanie', name: 'Beanie', price: 300 },
  { id: 'cap', name: 'Cap', price: 350 },
  { id: 'party', name: 'Party Hat', price: 450 },
  { id: 'shades', name: 'Shades', price: 500 },
  { id: 'phones', name: 'Headphones', price: 650 },
  { id: 'visor', name: 'Visor', price: 800 },
  { id: 'cowboy', name: 'Cowboy', price: 950 },
  { id: 'tophat', name: 'Top Hat', price: 1100 },
  { id: 'horns', name: 'Horns', price: 1300 },
  { id: 'crown', name: 'Crown', price: 2000 },
  { id: 'halo', name: 'Halo', price: 0, stars: 60 },
];
// Armour: one piece per slot. hits = how many hits it soaks per room (it's restored when a room
// starts or restarts). Abilities: deflect (blocked rounds fly back at the shooter), focus (a block
// refills slow motion), blast (soaks an explosion), swift (+move speed), thorns (a blocked melee
// hit knocks the attacker flat). col/trim colour the piece on the figure.
const ARMOR = [
  { id: 'hood', slot: 'head', name: 'Padded Hood', price: 300, hits: 1, col: '#4a5062', trim: '#2b2f3b', desc: 'Soaks one shot to the head.' },
  { id: 'helmet', slot: 'head', name: 'Steel Helmet', price: 750, hits: 2, col: '#6b7280', trim: '#3d434f', desc: 'Two head hits before it gives.' },
  { id: 'tachelm', slot: 'head', name: 'Tactical Helmet', price: 1200, hits: 2, ability: 'focus', col: '#3f4a32', trim: '#58e1ff', desc: 'Two hits. Every block refills 30% slow motion.' },
  { id: 'mirrorvisor', slot: 'head', name: 'Mirror Visor', price: 1700, hits: 1, ability: 'deflect', col: '#c9d6e4', trim: '#8fd0ff', desc: 'One hit, and the round flies straight back at the shooter.' },
  { id: 'titanhelm', slot: 'head', name: 'Titan Helm', price: 2600, hits: 3, col: '#2a2d36', trim: '#ffc933', desc: 'Three head hits. Heavy, proud, gold-trimmed.' },
  { id: 'kevlar', slot: 'body', name: 'Kevlar Vest', price: 400, hits: 1, col: '#3b4253', trim: '#262a36', desc: 'Soaks one shot to the body.' },
  { id: 'carrier', slot: 'body', name: 'Plate Carrier', price: 950, hits: 2, col: '#5d6b4a', trim: '#3f4a32', desc: 'Two body hits, pouches included.' },
  { id: 'blastvest', slot: 'body', name: 'Blast Vest', price: 1500, hits: 2, ability: 'blast', col: '#ff8a3d', trim: '#2a2c33', desc: 'Two hits, and it soaks one explosion as well.' },
  { id: 'mirrorplate', slot: 'body', name: 'Mirror Plate', price: 2300, hits: 2, ability: 'deflect', col: '#d7dde6', trim: '#8fd0ff', desc: 'Two hits; blocked rounds ricochet back at the shooter.' },
  { id: 'bastion', slot: 'body', name: 'Bastion Suit', price: 3400, hits: 4, ability: 'thorns', col: '#20232c', trim: '#e2434b', desc: 'Four hits. Blades and Brutes that hit it get knocked flat.' },
  { id: 'kneepads', slot: 'legs', name: 'Knee Pads', price: 250, hits: 1, col: '#3b4253', trim: '#262a36', desc: 'Soaks one shot to the legs.' },
  { id: 'runners', slot: 'legs', name: 'Runner Guards', price: 650, hits: 1, ability: 'swift', col: '#7ed9b8', trim: '#2f3646', desc: 'One hit, and you move 7% faster.' },
  { id: 'greaves', slot: 'legs', name: 'Steel Greaves', price: 1050, hits: 2, col: '#6b7280', trim: '#3d434f', desc: 'Two hits to the legs.' },
  { id: 'kinetic', slot: 'legs', name: 'Kinetic Greaves', price: 1600, hits: 2, ability: 'deflect', col: '#c9d6e4', trim: '#8fd0ff', desc: 'Two hits; blocked rounds bounce back at the shooter.' },
  { id: 'sentinel', slot: 'legs', name: 'Sentinel Legs', price: 2300, hits: 3, col: '#2a2d36', trim: '#ffc933', desc: 'Three leg hits. Built like a doorframe.' },
];
const ARMOR_BY = Object.fromEntries(ARMOR.map(a => [a.id, a]));
const ARMOR_ABILITY = { deflect: 'DEFLECT', focus: 'REFOCUS', blast: 'BLAST PROOF', swift: 'SWIFT', thorns: 'THORNS' };
const ARMOR_ABILITY_TIP = {
  deflect: 'A shot this piece blocks flies straight back at whoever fired it.',
  focus: 'Every hit this piece blocks refills 30% of your slow-motion meter.',
  blast: 'Survives one explosion per level without losing a hit (other armour can\'t stop explosions).',
  swift: 'You move 7% faster while wearing it.',
  thorns: 'A Blade that hits it is knocked down dead, and a Brute is stunned.',
};

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
  { id: 'breach', text: 'Get {n} breach kills', stat: 'breachKills', n: [4, 8], reward: 110 },
];

// Kill style table: label shown in the popup and score bonus on top of the base 100.
const STYLE = {
  headshot: { label: 'HEADSHOT', pts: 60 },
  air: { label: 'AIRBORNE', pts: 50 },
  slide: { label: 'SLIDE KILL', pts: 60 },
  flip: { label: 'FLIP KILL', pts: 90 },
  boom: { label: 'BOOM', pts: 60 },
  melee: { label: 'BEATDOWN', pts: 80 },
  last: { label: 'CLEAN', pts: 0 },
  close: { label: 'CLOSE CALL', pts: 40 },
};
// Endless upgrades: after every 3rd room you pick one of three. They stack and last the run.
const PERKS = [
  { id: 'life', name: 'Second Wind', icon: 'heart', desc: '+1 life (up to 5).', max: 2 },
  { id: 'focus', name: 'Deep Focus', icon: 'clock', desc: 'Slow motion drains 25% slower.', max: 3 },
  { id: 'adren', name: 'Adrenaline', icon: 'fire', desc: 'Kills refill 10% more slow motion.', max: 3 },
  { id: 'hands', name: 'Quick Hands', icon: 'reload', desc: 'Reload 30% faster.', max: 2 },
  { id: 'feet', name: 'Light Feet', icon: 'up', desc: 'Move 8% faster.', max: 3 },
  { id: 'acro', name: 'Acrobat', icon: 'flip', desc: '+1 flip in a chain.', max: 2 },
  { id: 'breach', name: 'Long Breach', icon: 'target', desc: 'Breach bullet time lasts 50% longer.', max: 2 },
  { id: 'show', name: 'Showboat', icon: 'star', desc: '+20% score from every kill.', max: 3 },
  { id: 'patch', name: 'Patch Up', icon: 'shield', desc: 'Repair all your armour now.', max: 99, armour: true },
];
const PERK = Object.fromEntries(PERKS.map(p => [p.id, p]));
const TWO_HAND = new Set(['smg', 'burst', 'shotgun', 'rifle', 'launcher', 'minigun', 'railgun']);
