'use strict';
/* =========================================================================
   Levels. A room is an ASCII map (one char = one 40px tile):

     #  solid            .  interior air        (space) void outside the room
     /  stair rising →   \  stair rising ←      a b  ceiling slopes (rising →, falling →)
     =  thin ledge (jump through from below)    X  solid crate block (cover)
     T  table (3 wide)   B  bench (2 wide)      L  shelf (2 wide)
     q  potted plant     w  water cooler        u  pallet stack (2 wide)   v  server rack
     C  kickable crate   O  explosive barrel    G  glass pane (stack vertically)
     l  light panel      P  player spawn        D  exit door
     e m s r h k  enemies: gunman, sprayer, breacher, marksman, juggernaut, blade
                  (lowercase faces the player's side, UPPERCASE faces away)

   Text on the back wall: [tileX, tileY, key] with keys from TUTORIAL_TEXT.
   Chapter 1 is handcrafted; the rest of the campaign and Endless are built by
   the seeded generator at the bottom, so every level always lays out the same.
   ========================================================================= */

const TUTORIAL_TEXT = {
  sprint: ['Hold SHIFT\nto sprint', 'Push the stick\nall the way to sprint'],
  jump: ['SPACE to jump', 'Tap JUMP\nto jump'],
  slide: ['RIGHT CLICK\nto slide', 'Tap SLIDE\nto slide'],
  shoot: ['CLICK to shoot', 'Drag the right stick\nto aim and fire'],
  slow: ['Press Q to\nslow time', 'Tap SLOW\nto slow time'],
  dodge: ['Slide or jump\nunder bullets', 'Slide or jump\nunder bullets'],
  glass: ['Glass breaks.\nSo do they.', 'Glass breaks.\nSo do they.'],
  barrel: ['Barrels go boom', 'Barrels go boom'],
  pickup: ['Press E to grab\na dropped gun', 'Tap GRAB to take\na dropped gun'],
  deflect: ['Shoot bullets\nout of the air', 'Shoot bullets\nout of the air'],
};

const THEMES = [
  // back wall, wall top highlight, floor top, side, ceiling underside, front face, void, text, light, accent
  { name: 'white', decor: 'lab', back: '#eeeef0', top: '#e4e4e8', side: '#bdbdc3', under: '#9b9ba2', front: '#dadade', void: '#d4d4d8', voidHi: '#e6e6ea', text: '#9c9ca4', light: '#ffffff', door: '#5d6070', dark: false },
  { name: 'warm', decor: 'office', back: '#f2eee7', top: '#e9e3d8', side: '#c8beb0', under: '#a69c8f', front: '#e0d9cd', void: '#d9d3c9', voidHi: '#ebe6dd', text: '#a59a8a', light: '#fffaf0', door: '#6a5f55', dark: false },
  { name: 'concrete', decor: 'warehouse', back: '#e3e6ea', top: '#d6dade', side: '#aeb4bc', under: '#8d939c', front: '#cdd1d7', void: '#c9ced4', voidHi: '#dde1e6', text: '#8e959f', light: '#f4f8ff', door: '#4f5866', dark: false },
  { name: 'sky', decor: 'highrise', back: '#eaf1f7', top: '#dfe8f0', side: '#b3c3d2', under: '#8fa2b5', front: '#d4dfe9', void: '#cddbe8', voidHi: '#e4edf5', text: '#8ba0b4', light: '#ffffff', door: '#4c6178', dark: false },
  { name: 'night', decor: 'night', back: '#2a2f3d', top: '#363c4d', side: '#20242f', under: '#181b23', front: '#323848', void: '#151820', voidHi: '#1f2330', text: '#6b7387', light: '#e9f1ff', door: '#0f1117', dark: true },
];

const CHAPTERS = [
  { name: 'ORIENTATION', theme: 0 },
  { name: 'OFFICES', theme: 1 },
  { name: 'WAREHOUSE', theme: 2 },
  { name: 'HIGHRISE', theme: 3 },
  { name: 'AFTER HOURS', theme: 4 },
];
const LEVELS_PER_CHAPTER = 15;
const BOSS_EVERY = 5;               // every 5th level of a chapter ends in a Juggernaut room

// Each chapter builds its rooms differently: height, furniture, glass, catwalks, vents, extra foes.
const STYLES = [
  { H: [5, 6], slide: 0.06, glass: 0.3, ledge: 0.08, barrel: 0.18, furn: ['T', 'B', 'C', 'L', 'C', 'X'], extra: 0 },                 // lab
  { H: [5, 6], slide: 0.05, glass: 0.75, ledge: 0.06, barrel: 0.12, furn: ['T', 'T', 'q', 'w', 'L', 'B', 'q'], extra: 0 },           // offices
  { H: [6, 8], slide: 0.04, glass: 0.15, ledge: 0.3, barrel: 0.4, furn: ['X', 'u', 'C', 'C', 'L', 'u', 'X'], extra: 1 },            // warehouse
  { H: [6, 7], slide: 0.06, glass: 0.9, ledge: 0.18, barrel: 0.12, furn: ['q', 'T', 'B', 'q', 'w'], extra: 1 },                     // highrise
  { H: [5, 7], slide: 0.14, glass: 0.4, ledge: 0.14, barrel: 0.25, furn: ['v', 'v', 'C', 'T', 'q', 'v'], extra: 2 },                // after hours
];

const HAND_LEVELS = [
  {
    name: 'Orientation', par: 40, rooms: [
      {
        map: [
          '##################################',
          '#.......l.................l......#',
          '#................................#',
          '#................................#',
          '#................................#',
          '#.P........B..........T.......D..#',
          '##################################',
        ], text: [[6.5, 2.4, 'sprint'], [17.5, 2.4, 'jump']],
      },
      {
        map: [
          '########################################',
          '#.....l.........######......l..........#',
          '#...............######.................#',
          '#...............######.................#',
          '#...............######.............D...#',
          '#...............######......./##########',
          '#..P.........................#/#########',
          '########################################',
        ], text: [[8, 2.6, 'slide']],
      },
      {
        map: [
          '####################################',
          '#.....l..............l.............#',
          '#..................................#',
          '#..................................#',
          '#..................................#',
          '#.P.......T...........E.......D....#',
          '####################################',
        ], text: [[6, 2.4, 'shoot']],
      },
      {
        map: [
          '##########################################',
          '#.....l.............l.............l......#',
          '#........................................#',
          '#.............................e..........#',
          '#...........................====.........#',
          '#.P.........T..........e..............D..#',
          '##########################################',
        ], text: [[6, 2.4, 'slow'], [16, 2.4, 'dodge']],
      },
    ],
  },
  {
    name: 'First Contact', par: 45, rooms: [
      {
        map: [
          '######################################',
          '#.......l..............l.............#',
          '#....................................#',
          '#....................................#',
          '#....................................#',
          '#.P.........X..........e....B.....D..#',
          '######################################',
        ],
      },
      {
        map: [
          '############################################',
          '#......l...............l..............l....#',
          '#..........................................#',
          '#..........................................#',
          '#........................e.................#',
          '#.P.........T......./######\\........m...D..#',
          '############################################',
        ],
      },
      {
        map: [
          '##################################################',
          '#.....l.............l.............l.........l....#',
          '#................................................#',
          '#................................................#',
          '#................................................#',
          '#.P......B.....e.....X.........e.....C.....e..D..#',
          '##################################################',
        ],
      },
    ],
  },
  {
    name: 'Cover Fire', par: 50, rooms: [
      {
        map: [
          '##########################################',
          '#....l..............l..............l.....#',
          '#........................................#',
          '#........................................#',
          '#........................................#',
          '#.P......X.......X.m..........X.e....D...#',
          '##########################################',
        ], text: [[3.5, 2.4, 'deflect']],
      },
      {
        map: [
          '##############################################',
          '#.....l.................l.................l..#',
          '#............................................#',
          '#.....................e..........e...........#',
          '#..............=========.....=======.........#',
          '#.P.......T..............m...............D...#',
          '##############################################',
        ],
      },
      {
        map: [
          '########################################',
          '#.....l..............l.............l...#',
          '#......................................#',
          '#......................................#',
          '#......................................#',
          '#.P.....T.......s.........X...e....D...#',
          '########################################',
        ], text: [[5, 2.4, 'pickup']],
      },
    ],
  },
  {
    name: 'Glass & Fire', par: 50, rooms: [
      {
        map: [
          '############################################',
          '#....l.....G.........l.............l.......#',
          '#..........G...............................#',
          '#..........G...............................#',
          '#..........G...............................#',
          '#.P........G.......e....O....e.........D...#',
          '############################################',
        ], text: [[4.5, 2.4, 'glass'], [19, 2.4, 'barrel']],
      },
      {
        map: [
          '##############################################',
          '#....l................G.........l............#',
          '#.....................G......................#',
          '#.....................G.....e................#',
          '#.....................G....=====.............#',
          '#.P......T....e.......G...O..........m...D...#',
          '##############################################',
        ],
      },
      {
        map: [
          '##########################################',
          '#....l.............l...............l.....#',
          '#........................................#',
          '#........................................#',
          '#........................................#',
          '#.P......X....OeO.......s..O.e......D....#',
          '##########################################',
        ],
      },
    ],
  },
  {
    name: 'Up and Over', par: 60, rooms: [
      {
        map: [
          '############################################',
          '#.....l..............l..............l......#',
          '#..........................................#',
          '#....................................r...D.#',
          '#........................../################',
          '#.P............e........../#################',
          '############################################',
        ],
      },
      {
        map: [
          '################################################',
          '#....l.............l.................l.........#',
          '#..............................................#',
          '#.................................e............#',
          '#......====...............=========............#',
          '#.P.........e.......T.................e..r..D..#',
          '################################################',
        ],
      },
      {
        map: [
          '######################################',
          '#.....l.............l...........l....#',
          '#....................................#',
          '#...................r................#',
          '#...........===========..............#',
          '#....................................#',
          '#......e.......................e.....#',
          '#....=======..............========...#',
          '#....................................#',
          '#.P..........T............m.....D....#',
          '######################################',
        ],
      },
    ],
  },
  {
    name: 'Blades', par: 60, rooms: [
      {
        map: [
          '##########################################',
          '#....l...............l.............l.....#',
          '#........................................#',
          '#........................................#',
          '#........................................#',
          '#.P......B..........k.......k.......D....#',
          '##########################################',
        ],
      },
      {
        map: [
          '##############################################',
          '#....l.............l...............l.........#',
          '#............................................#',
          '#............................................#',
          '#........................e...................#',
          '#.P......X.........../##########\\....k...D...#',
          '##############################################',
        ],
      },
      {
        map: [
          '################################################',
          '#....l..............l..............l...........#',
          '#..............................................#',
          '#..............................................#',
          '#.......................====...................#',
          '#.P.......X......O.....e......h.....X...k...D..#',
          '################################################',
        ],
      },
    ],
  },
];

// level names per chapter (chapter 1 starts with the six handcrafted ones)
const GEN_NAMES = [
  ['Clean Room', 'Test Fire', 'Drill Hall', 'Calibration', 'White Noise', 'Control Group', 'Sim Run', 'Lab Rat', 'Graduation'],
  ['Paper Trail', 'Open Plan', 'Cubicle Storm', 'Coffee Break', 'Overtime', 'Board Meeting', 'Water Cooler', 'Reply All', 'Copy Room', 'HR Visit', 'Quarterly', 'Middle Management', 'Hostile Takeover', 'Corner Office', 'Golden Parachute'],
  ['Loading Dock', 'Cold Storage', 'Freight', 'Shipping Lanes', 'Forklift Alley', 'Pallet Jack', 'Catwalks', 'Bonded', 'Stockroom', 'Inventory', 'Night Delivery', 'Container Yard', 'Overstock', 'Clearance', 'Last Crate'],
  ['Atrium', 'Elevator Pitch', 'Glass Ceiling', 'Skywalk', 'Mezzanine', 'Sky Lobby', 'Window Washer', 'Stairwell', 'Observation Deck', 'Thin Air', 'Wind Shear', 'Helipad Access', 'Cloud Line', 'Top Floor', 'Vertigo'],
  ['Lights Out', 'Night Shift', 'Server Farm', 'Neon Hall', 'Graveyard Shift', 'Static', 'Blackout', 'Afterglow', 'Midnight Oil', 'Low Battery', 'Signal Lost', 'Last Call', 'Dead Air', 'Zero Hour', 'Last Stand'],
];

/* ------------------------------------------------------------ generator */
// Builds one room map. d: difficulty 0..1. opts: { boss, noSlide, wide }
function genRoom(seed, d, opts = {}) {
  const R = mulberry32(seed * 7919 + 17);
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const ch = p => R() < p;
  const st = STYLES[opts.style || 0];
  const cols = opts.boss ? ri(44, 52) : ri(32, 46);
  const H = ri(st.H[0], st.H[1]);     // interior rows at base level
  const base = H + 1;                 // floor row (first solid row) at base level
  const rows = base + 1;
  const f = new Array(cols).fill(base);
  const c = new Array(cols).fill(0);

  // floor and ceiling profile, left to right; spawn and exit zones stay flat
  let x = 7, fl = base, ce = 0;
  const slideOk = !opts.noSlide;
  while (x < cols - 9) {
    const r = R();
    let len = ri(3, 7);
    if (r < 0.22 && fl > base - 2 && fl - 1 - ce >= 4) { fl--; f[x] = fl; c[x] = ce; x++; len = ri(3, 6); }
    else if (r < 0.4 && fl < base) { fl++; f[x] = fl; c[x] = ce; x++; len = ri(3, 6); }
    else if (r < 0.5 && fl - (ce + 1) >= 5) { ce++; }
    else if (r < 0.58 && ce > 0) { ce--; }
    else if (r < 0.58 + st.slide && slideOk && d > 0.12) {
      const sl = ri(3, 5);
      for (let i = 0; i < sl && x < cols - 9; i++, x++) { f[x] = fl; c[x] = fl - 2; }
      continue;
    }
    for (let i = 0; i < len && x < cols - 9; i++, x++) { f[x] = fl; c[x] = ce; }
  }
  // walk back down to base before the exit zone
  while (x < cols - 1) {
    if (fl < base && x < cols - 5) fl++;
    f[x] = fl; c[x] = Math.min(ce, fl - 4); x++;
  }
  for (let i = 0; i < 7; i++) { f[i] = base; c[i] = 0; }

  const g = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let i = 0; i < cols; i++) row.push(i === 0 || i === cols - 1 || r <= c[i] || r >= f[i] ? '#' : '.');
    g.push(row);
  }
  const set = (i, r, v) => { if (r >= 0 && r < rows && i > 0 && i < cols - 1) g[r][i] = v; };
  const at = (i, r) => (r >= 0 && r < rows && i >= 0 && i < cols ? g[r][i] : '#');
  // stairs and ceiling slopes where the profile steps by one
  for (let i = 1; i < cols - 1; i++) {
    if (f[i] === f[i - 1] - 1) set(i, f[i], '/');
    if (f[i] === f[i - 1] + 1) set(i - 1, f[i - 1], '\\');
    const sharp = c[i] >= f[i] - 2 || c[i - 1] >= f[i - 1] - 2;   // slide tunnels keep square edges
    if (!sharp && c[i] === c[i - 1] + 1 && c[i] > 0) set(i, c[i], 'b');
    if (!sharp && c[i] === c[i - 1] - 1 && c[i - 1] > 0) set(i - 1, c[i - 1], 'a');
  }
  const flatAt = i => i > 1 && i < cols - 2 && f[i - 1] === f[i] && f[i + 1] === f[i] && c[i] < f[i] - 3 && at(i, f[i]) === '#';
  const roomy = i => f[i] - c[i] >= 5;            // space to hop over a 1-tile crate
  const used = new Set();
  const free = (i, r) => at(i, r) === '.' && !used.has(i + ',' + r);
  const mark = (i, r, v) => { set(i, r, v); used.add(i + ',' + r); };

  // spawn, door, lights
  mark(2, base - 1, 'P');
  mark(cols - 4, base - 1, 'D');
  for (let i = 4 + ri(0, 4); i < cols - 3; i += ri(9, 14)) if (f[i] - c[i] >= 5 && f[i + 1] - c[i + 1] >= 5 && at(i, c[i] + 1) === '.' && at(i + 1, c[i] + 1) === '.') mark(i, c[i] + 1, 'l');

  // ledges over tall flat runs
  const ledges = [];
  for (let i = 9; i < cols - 10; i++) {
    if (f[i] - c[i] < 7 || !ch(st.ledge)) continue;
    const len = ri(3, 6), r = f[i] - 3;
    let ok = true;
    for (let k = 0; k < len; k++) if (f[i + k] !== f[i] || c[i + k] >= r - 3 || at(i + k, r) !== '.') ok = false;
    if (!ok) continue;
    for (let k = 0; k < len; k++) mark(i + k, r, '=');
    ledges.push({ x: i, len, r });
    i += len + 4;
  }

  // enemies
  const n = clamp(Math.round(1.4 + d * 4.4 + R() * 1.6 + (opts.boss ? 1 : 0) + st.extra * d), 1, 9);
  const pool = ['grunt'];
  if (d > 0.15) pool.push('smg');
  if (d > 0.25) pool.push('shotgun', 'grunt');
  if (d > 0.3) pool.push('knife');
  if (d > 0.4) pool.push('rifle');
  if (d > 0.65) pool.push('heavy');
  const charOf = { grunt: 'e', smg: 'm', shotgun: 's', rifle: 'r', heavy: 'h', knife: 'k' };
  const spots = [];
  for (let i = 10; i < cols - 3; i++) if (flatAt(i) && free(i, f[i] - 1)) spots.push([i, f[i] - 1]);
  for (const L of ledges) for (let k = 0; k < L.len; k++) spots.push([L.x + k, L.r - 1]);
  let placed = 0, lastX = -99;
  if (opts.boss) {
    const s = spots.filter(p => p[0] > cols * 0.55 && p[1] === f[p[0]] - 1);
    if (s.length) { const p = s[Math.floor(R() * s.length)]; mark(p[0], p[1], 'h'); placed++; lastX = p[0]; }
  }
  for (let tries = 0; tries < 60 && placed < n && spots.length; tries++) {
    const p = spots[Math.floor(R() * spots.length)];
    if (!free(p[0], p[1]) || Math.abs(p[0] - lastX) < 3) continue;
    let type = pool[Math.floor(R() * pool.length)];
    if (type === 'rifle' && p[0] < cols * 0.5) type = 'grunt';
    const away = ch(0.18 - d * 0.1);
    const cch = charOf[type];
    mark(p[0], p[1], away ? cch.toUpperCase() : cch);
    placed++; lastX = p[0];
    // cover or a barrel beside some of them
    if (p[1] === f[p[0]] - 1) {
      if (ch(0.32) && free(p[0] - 2, p[1]) && flatAt(p[0] - 2) && roomy(p[0] - 2)) mark(p[0] - 2, p[1], 'X');
      else if (ch(st.barrel) && free(p[0] + 1, p[1]) && flatAt(p[0] + 1)) mark(p[0] + 1, p[1], 'O');
    }
  }

  // glass panes in low sections (offices and towers are full of them)
  for (let pane = 0; pane < (st.glass > 0.7 ? 2 : 1); pane++) if (ch(st.glass)) {
    for (let tries = 0; tries < 20; tries++) {
      const i = ri(8, cols - 8);
      if (!flatAt(i) || f[i] - c[i] > 7) continue;
      let ok = true;
      for (let r = c[i] + 1; r < f[i]; r++) if (!free(i, r)) ok = false;
      if (!ok) continue;
      for (let r = c[i] + 1; r < f[i]; r++) mark(i, r, 'G');
      break;
    }
  }
  // furniture
  const furn = st.furn;
  for (let tries = 0; tries < 30; tries++) {
    const i = ri(5, cols - 6), r = f[i] - 1;
    const kind = furn[Math.floor(R() * furn.length)];
    const w = kind === 'T' ? 3 : kind === 'B' || kind === 'L' || kind === 'u' ? 2 : 1;
    let ok = true;
    for (let k = -1; k <= w; k++) if (!flatAt(i + k) || f[i + k] !== f[i] || !free(i + k, r)) ok = false;
    if ((kind === 'L' || kind === 'v') && !free(i, r - 1)) ok = false;
    if (kind === 'v' && f[i] - c[i] < 5) ok = false;
    if (kind === 'X' && !roomy(i)) ok = false;
    if (!ok) continue;
    mark(i, r, kind);
    for (let k = 1; k < w; k++) used.add((i + k) + ',' + r);
    if (ch(0.5)) tries += 6;
  }
  return { map: g.map(r => r.join('')), gen: true };
}

/* --------------------------------------------------------------- levels */
const LEVEL_COUNT = CHAPTERS.length * LEVELS_PER_CHAPTER;
const levelCache = new Map();

function countEnemies(map) {
  let n = 0;
  for (const row of map) for (const ch of row) if (ENEMY_CHARS[ch.toLowerCase()] && ch !== 'L' && ch !== 'l') n++;
  return n;
}

// Campaign difficulty: climbs steadily across all 75 levels, with a small bump at each boss level.
const levelDiff = i => clamp(0.16 + i / 64 + ((i + 1) % BOSS_EVERY === 0 ? 0.05 : 0), 0, 1);

function getLevel(i) {
  if (levelCache.has(i)) return levelCache.get(i);
  const chapter = Math.floor(i / LEVELS_PER_CHAPTER);
  const inCh = i % LEVELS_PER_CHAPTER;
  const boss = (inCh + 1) % BOSS_EVERY === 0;
  let L;
  if (i < HAND_LEVELS.length) {
    const h = HAND_LEVELS[i];
    L = { name: h.name, rooms: h.rooms, par: h.par, hand: true };
  } else {
    const d = levelDiff(i);
    const nRooms = boss ? 4 : 3;
    const rooms = [];
    for (let r = 0; r < nRooms; r++) rooms.push(genRoom(1000 + i * 31 + r * 7, clamp(d + r * 0.03, 0, 1), { boss: boss && r === nRooms - 1, style: chapter }));
    let par = 0;
    for (const rm of rooms) par += rm.map[0].length * 0.45 + countEnemies(rm.map) * 3 + 2;
    const names = GEN_NAMES[chapter];
    const k = chapter === 0 ? inCh - HAND_LEVELS.length : inCh;
    L = { name: names[k % names.length], rooms, par: Math.round(par / 5) * 5 };
  }
  L.index = i;
  L.chapter = chapter;
  L.theme = CHAPTERS[chapter].theme;
  L.boss = L.hand ? L.rooms.some(r => r.map.some(row => row.includes('h'))) : boss;
  levelCache.set(i, L);
  return L;
}

// Endless: room n of a run. Difficulty climbs every room; themes rotate every 4 rooms.
function endlessRoom(runSeed, n) {
  const d = clamp(0.25 + n * 0.06, 0, 1);
  const t = Math.floor(n / 4) % THEMES.length;
  const room = genRoom(runSeed + n * 101, d, { boss: n > 0 && n % 6 === 5, style: t });
  room.theme = t;
  return room;
}
