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
     e m s r h k i n y  enemies: gunman, sprayer, breacher, marksman, juggernaut, blade, riot, grenadier, brute
                  (lowercase faces the player's side, UPPERCASE faces away)

   Text on the back wall: [tileX, tileY, key] with keys from TUTORIAL_TEXT.
   Chapter 1 is handcrafted; the rest of the campaign and Endless are built by
   the seeded generator at the bottom, so every level always lays out the same.
   ========================================================================= */

const TUTORIAL_TEXT = {
  sprint: ['Hold CTRL\nto sprint', 'Push the stick\nall the way to sprint'],
  jump: ['SPACE to jump', 'Tap JUMP or flick\nthe left stick up'],
  flip: ['Jump while sprinting\nor sliding to flip', 'Push the stick all the way,\nthen JUMP to flip'],
  slide: ['SHIFT or RIGHT CLICK\nto slide', 'Tap SLIDE or flick\nthe left stick down'],
  shoot: ['CLICK to shoot', 'Tap anywhere\nto shoot that way'],
  slow: ['Press Q to\nslow time', 'Tap SLOW\nto slow time'],
  dodge: ['Slide or jump\nunder bullets', 'Slide or jump\nunder bullets'],
  glass: ['Glass breaks.\nSo do they.', 'Glass breaks.\nSo do they.'],
  barrel: ['Barrels go boom', 'Barrels go boom'],
  pickup: ['Press E to grab\na dropped gun', 'Walk over a dropped gun\nand tap GRAB'],
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
  { H: [5, 6], slide: 0.06, glass: 0.3, ledge: 0.14, barrel: 0.22, furn: ['T', 'B', 'C', 'L', 'C', 'X'], extra: 0 },                 // lab
  { H: [5, 6], slide: 0.05, glass: 0.75, ledge: 0.12, barrel: 0.16, furn: ['T', 'T', 'q', 'w', 'L', 'B', 'C'], extra: 0 },           // offices
  { H: [6, 8], slide: 0.04, glass: 0.15, ledge: 0.34, barrel: 0.4, furn: ['X', 'u', 'C', 'C', 'L', 'u', 'X'], extra: 1 },            // warehouse
  { H: [6, 7], slide: 0.06, glass: 0.9, ledge: 0.24, barrel: 0.16, furn: ['q', 'T', 'B', 'C', 'w'], extra: 1 },                     // highrise
  { H: [5, 7], slide: 0.14, glass: 0.4, ledge: 0.2, barrel: 0.28, furn: ['v', 'v', 'C', 'T', 'q', 'C'], extra: 2 },                // after hours
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
        ], text: [[7.5, 2.4, 'sprint'], [21, 2.4, 'jump']],
      },
      {
        map: [
          '########################################',
          '#.....l.........######......l..........#',
          '#...............######.................#',
          '#...............######.................#',
          '#...............######.............D...#',
          '#............................/##########',
          '#..P.........................#/#########',
          '########################################',
        ], text: [[8, 2.6, 'slide'], [27, 2.4, 'flip']],
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
// handcrafted ambushes: [tileX, standingRow, type, triggerTileX, kind]
HAND_LEVELS[1].rooms[2].ambush = [[39, 5, 'grunt', 27, 'door']];
HAND_LEVELS[2].rooms[2].ambush = [[21, 5, 'smg', 11, 'drop']];
HAND_LEVELS[4].rooms[1].ambush = [[30, 5, 'shotgun', 18, 'door']];
HAND_LEVELS[5].rooms[2].ambush = [[26, 5, 'knife', 14, 'door']];

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
      // vent: two tiles of headroom (slide under it), with flat floor on both sides
      const sl = ri(3, 5);
      for (let i = 0; i < sl && x < cols - 11; i++, x++) { f[x] = fl; c[x] = fl - 3; }
      for (let i = 0; i < 2 && x < cols - 9; i++, x++) { f[x] = fl; c[x] = Math.min(ce, fl - 5); }
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
    const sharp = c[i] >= f[i] - 3 || c[i - 1] >= f[i - 1] - 3;   // slide vents keep square edges
    if (!sharp && c[i] === c[i - 1] + 1 && c[i] > 0) set(i, c[i], 'b');
    if (!sharp && c[i] === c[i - 1] - 1 && c[i - 1] > 0) set(i - 1, c[i - 1], 'a');
  }
  const flatAt = i => i > 1 && i < cols - 2 && f[i - 1] === f[i] && f[i + 1] === f[i] && c[i] < f[i] - 3 && at(i, f[i]) === '#';
  // space to hop over a 1-tile crate, and never at the mouth of a vent (you can't jump while ducked under it)
  const vent = i => i > 0 && i < cols - 1 && c[i] >= f[i] - 3;
  // (the columns either side need the same headroom, since that's where you take off from)
  const roomy = i => [i - 1, i, i + 1].every(k => f[k] - c[k] >= 5 && (c[k] === 0 || f[k] - c[k] >= 6)) && !vent(i - 2) && !vent(i - 1) && !vent(i + 1) && !vent(i + 2);
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
  const role = opts.role || 'mid';            // open (first room) | mid | climax (last room)
  let n = clamp(Math.round(1.4 + d * 4.4 + R() * 1.6 + (opts.boss ? 1 : 0) + st.extra * d), 1, 9);
  if (role === 'open') n = Math.max(1, n - 1);
  if (role === 'climax') n = Math.min(10, n + 1);
  const pool = ['grunt'];
  if (d > 0.15) pool.push('smg');
  if (d > 0.25) pool.push('shotgun', 'grunt');
  if (d > 0.3) pool.push('knife');
  if (d > 0.4) pool.push('rifle');
  if (d > 0.3) pool.push('shield');
  if (d > 0.38) pool.push('grenadier');
  if (d > 0.5) pool.push('brute');
  if (d > 0.65) pool.push('heavy');
  const charOf = { grunt: 'e', smg: 'm', shotgun: 's', rifle: 'r', heavy: 'h', knife: 'k', shield: 'i', grenadier: 'n', brute: 'y' };
  let brutes = 0;
  const spots = [];
  for (let i = 10; i < cols - 3; i++) if (flatAt(i) && free(i, f[i] - 1)) spots.push([i, f[i] - 1]);
  for (const L of ledges) for (let k = 0; k < L.len; k++) spots.push([L.x + k, L.r - 1]);
  // keep foes spread out: 5 tiles apart on the same level, 3 apart across levels
  const taken = [];
  const spaced = (x, y) => taken.every(([tx, ty]) => Math.abs(tx - x) >= (Math.abs(ty - y) < 2 ? 5 : 3));
  let placed = 0;
  if (opts.boss) {
    const s = spots.filter(p => p[0] > cols * 0.55 && p[1] === f[p[0]] - 1);
    if (s.length) { const p = s[Math.floor(R() * s.length)]; mark(p[0], p[1], 'h'); placed++; taken.push(p); }
  }
  // ---- set pieces: small designed encounters, each built to be solved a particular way
  const runAt = len => {
    const out = [];
    for (let i = 10; i < cols - 4 - len; i++) {
      let ok = true;
      for (let k = 0; k < len && ok; k++) if (!flatAt(i + k) || f[i + k] !== f[i] || !free(i + k, f[i] - 1)) ok = false;
      if (ok) out.push(i);
    }
    return out.length ? out[Math.floor(R() * out.length)] : -1;
  };
  const clear = (x, y) => taken.every(([tx, ty]) => Math.abs(ty - y) >= 2 || Math.abs(tx - x) >= 4);
  const putE = (x, y, type) => { mark(x, y, charOf[type]); taken.push([x, y]); placed++; };
  const pick = list => list[Math.floor(R() * list.length)];
  const shooters = pool.filter(t => t !== 'brute' && t !== 'knife' && t !== 'heavy');
  const kinds = ['squad', 'kickline', 'fort'];
  if (d > 0.3 && ledges.length) kinds.push('sniper', 'sniper');
  if (d > 0.32) kinds.push('shield');
  if (d > 0.45) kinds.push('squad');
  const nPieces = role === 'open' ? 1 : role === 'climax' ? 2 + (d > 0.5 ? 1 : 0) : 1 + (ch(0.55) ? 1 : 0);
  for (let k = 0, guard = 0; k < nPieces && placed < n - 0 && guard < 12; guard++) {
    const kind = pick(kinds);
    let done = false;
    if (kind === 'squad') {
      // two gunmen flanking a barrel: one round into the drum takes both
      const i = runAt(5), y = i > 0 ? f[i] - 1 : 0;
      if (i > 0 && clear(i, y) && clear(i + 4, y)) { putE(i, y, pick(shooters)); mark(i + 2, y, 'O'); putE(i + 4, y, pick(shooters)); done = true; }
    } else if (kind === 'kickline') {
      // a crate, then two foes in a row: kick the crate or the first body into the second
      const i = runAt(7), y = i > 0 ? f[i] - 1 : 0;
      if (i > 0 && clear(i + 2, y) && clear(i + 5, y)) {
        if (roomy(i)) mark(i, y, 'C');
        putE(i + 2, y, 'grunt'); putE(i + 5, y, d > 0.3 ? pick(['shotgun', 'smg', 'grunt']) : 'grunt'); done = true;
      }
    } else if (kind === 'sniper') {
      // a marksman on the far end of a ledge, with a gunman underneath
      const L = pick(ledges), x = L.x + L.len - 1, y = L.r - 1;
      if (free(x, y) && clear(x, y)) {
        putE(x, y, d > 0.38 ? 'rifle' : 'grunt');
        const gx = L.x - 2, gy = f[gx] - 1;
        if (gx > 10 && flatAt(gx) && free(gx, gy) && clear(gx, gy) && placed < n) putE(gx, gy, 'grunt');
        done = true;
      }
    } else if (kind === 'shield') {
      // a riot shield screening a grenadier or a sprayer: get round it, over it, or kick it
      const i = runAt(6), y = i > 0 ? f[i] - 1 : 0;
      if (i > 0 && clear(i, y) && clear(i + 4, y)) { putE(i, y, 'shield'); putE(i + 4, y, d > 0.4 ? 'grenadier' : 'smg'); done = true; }
    } else if (kind === 'fort') {
      // a gunman dug in behind a cover block, a kickable crate in front of it
      const i = runAt(5), y = i > 0 ? f[i] - 1 : 0;
      if (i > 0 && roomy(i + 1) && clear(i + 2, y)) { mark(i, y, 'C'); mark(i + 1, y, 'X'); putE(i + 3, y, pick(shooters)); done = true; }
    }
    if (done) k++;
  }

  for (let tries = 0; tries < 90 && placed < n && spots.length; tries++) {
    const p = spots[Math.floor(R() * spots.length)];
    if (!free(p[0], p[1]) || !spaced(p[0], p[1])) continue;
    let type = pool[Math.floor(R() * pool.length)];
    if (type === 'rifle' && p[0] < cols * 0.5) type = 'grunt';
    if (type === 'brute' && (brutes++ > 0 || p[1] !== f[p[0]] - 1)) type = 'grunt';     // one brute a room, on the floor
    const away = ch(0.18 - d * 0.1);
    const cch = charOf[type];
    mark(p[0], p[1], away ? cch.toUpperCase() : cch);
    placed++; taken.push(p);
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
  // ambushes further into the room
  const ambush = [];
  const nAmb = d < 0.2 ? 0 : (role === 'climax' ? 1 : ch(0.35 + d * 0.5) ? 1 : 0) + (d > 0.55 && ch(0.4) ? 1 : 0);
  const ambPool = ['grunt', 'smg', 'shotgun', d > 0.35 ? 'knife' : 'grunt'];
  const ambSpaced = (x, y) => taken.every(([tx, ty]) => Math.abs(tx - x) >= (Math.abs(ty - y) < 2 ? 4 : 2));
  for (let tries = 0; tries < 120 && ambush.length < nAmb; tries++) {
    const i = ri(16, cols - 7), r = f[i] - 1;
    if (!flatAt(i) || !free(i, r) || !free(i - 1, r) || !free(i + 1, r) || !ambSpaced(i, r)) continue;
    const kind = ch(0.3) ? 'drop' : 'door';
    ambush.push([i, r, ambPool[Math.floor(R() * ambPool.length)], Math.max(4, i - ri(7, 10)), kind]);
    taken.push([i, r]); used.add(i + ',' + r); used.add((i - 1) + ',' + r); used.add((i + 1) + ',' + r);
  }
  return { map: g.map(r => r.join('')), gen: true, ambush };
}

/* ----------------------------------------------------- big multi-level maps */
// A wide, tall hall like the original's warehouse: a ground floor, stairs up to a long deck,
// a high catwalk for snipers, a drop back down and the exit far across the floor.
function genBigRoom(seed, d, opts = {}) {
  const R = mulberry32(seed * 104729 + 3);
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const ch = p => R() < p;
  const st = STYLES[opts.style || 0];
  const cols = ri(66, 80), rows = 15;
  const g = [];
  for (let r = 0; r < rows; r++) { const row = []; for (let i = 0; i < cols; i++) row.push(r === 0 || r === rows - 1 || i === 0 || i === cols - 1 ? '#' : '.'); g.push(row); }
  const set = (i, r, v) => { if (r > 0 && r < rows - 1 && i > 0 && i < cols - 1) g[r][i] = v; };
  const at = (i, r) => (r >= 0 && r < rows && i >= 0 && i < cols ? g[r][i] : '#');
  // stairs from the ground (row 13) up five rows to the deck (row 9)
  const s1 = ri(15, 19);
  for (let k = 0; k < 5; k++) { set(s1 + k, 13 - k, '/'); for (let r = 14 - k; r <= 13; r++) set(s1 + k, r, '#'); }
  const deckEnd = s1 + 5 + ri(22, 30);
  for (let i = s1 + 5; i <= deckEnd; i++) set(i, 9, '#');
  // a high catwalk over the deck, reached with two hops
  const cw = s1 + 5 + ri(6, 10), cwLen = ri(7, 10);
  for (let k = 0; k < 3; k++) set(cw - 4 + k, 7, '=');
  for (let k = 0; k < cwLen; k++) set(cw + k, 5, '=');
  // a lower ledge on the far ground floor
  const gl = deckEnd + ri(5, 9);
  if (gl + 5 < cols - 8) for (let k = 0; k < 4; k++) set(gl + k, 10, '=');
  // lights: under the roof, and under the deck
  for (let i = 4; i < cols - 4; i += ri(9, 13)) if (at(i, 1) === '.' && at(i + 1, 1) === '.') set(i, 1, 'l');
  for (let i = s1 + 8; i < deckEnd - 2; i += 10) if (at(i, 10) === '.' && at(i + 1, 10) === '.') set(i, 10, 'l');
  set(2, 13, 'P'); set(cols - 4, 13, 'D');
  // standing spots per area
  const area = (x0, x1, row) => { const out = []; for (let i = x0; i <= x1; i++) if (at(i, row) === '.' && at(i, row + 1) !== '.' && at(i, row + 1) !== 'l') out.push([i, row]); return out; };
  const deck = area(s1 + 7, deckEnd - 1, 8), cat = area(cw, cw + cwLen - 1, 4), under = area(s1 + 8, deckEnd - 2, 13), far = area(deckEnd + 3, cols - 7, 13), near = area(9, s1 - 2, 13);
  const pool = ['grunt', 'grunt', 'smg'];
  if (d > 0.25) pool.push('shotgun');
  if (d > 0.35) pool.push('knife');
  if (d > 0.3) pool.push('shield');
  if (d > 0.38) pool.push('grenadier');
  if (d > 0.6) pool.push('heavy');
  const charOf = { grunt: 'e', smg: 'm', shotgun: 's', rifle: 'r', heavy: 'h', knife: 'k', shield: 'i', grenadier: 'n', brute: 'y' };
  const taken = [];
  const spaced = (x, y) => taken.every(([tx, ty]) => Math.abs(tx - x) >= (Math.abs(ty - y) < 2 ? 5 : 3));
  const put = (list, type) => {
    for (let t = 0; t < 30 && list.length; t++) {
      const p = list[Math.floor(R() * list.length)];
      if (at(p[0], p[1]) !== '.' || !spaced(p[0], p[1])) continue;
      set(p[0], p[1], charOf[type]); taken.push(p); return true;
    }
    return false;
  };
  put(near, 'grunt');
  for (let k = 0; k < 2 + Math.round(d * 1.5); k++) put(deck, pool[Math.floor(R() * pool.length)]);
  put(cat, d > 0.3 ? 'rifle' : 'grunt');
  for (let k = 0; k < 1 + Math.round(d); k++) put(under, pool[Math.floor(R() * pool.length)]);
  for (let k = 0; k < 2 + Math.round(d * 2); k++) put(far, pool[Math.floor(R() * pool.length)]);
  if (opts.boss) put(far, 'heavy');
  if (d > 0.5) put(far, 'brute');
  // cover and dressing
  const furn = st.furn;
  for (let t = 0; t < 40; t++) {
    const lists = [near, deck, far, under];
    const L = lists[Math.floor(R() * lists.length)];
    if (!L.length) continue;
    const p = L[Math.floor(R() * L.length)];
    const kind = furn[Math.floor(R() * furn.length)];
    const w = kind === 'T' ? 3 : kind === 'B' || kind === 'L' || kind === 'u' ? 2 : 1;
    let ok = true;
    for (let k = -1; k <= w; k++) if (at(p[0] + k, p[1]) !== '.' || at(p[0] + k, p[1] + 1) === '.' || at(p[0] + k, p[1] - 1) !== '.') ok = false;
    if ((kind === 'X' || kind === 'L' || kind === 'v') && at(p[0], p[1] - 2) !== '.') ok = false;
    if (!ok) continue;
    set(p[0], p[1], kind);
    for (let k = 1; k < w; k++) set(p[0] + k, p[1], kind === 'T' || kind === 'B' || kind === 'L' || kind === 'u' ? '.' : kind);
    if (ch(0.5)) t += 5;
  }
  // a barrel between two deck guards, so the high ground can be cleared with one shot
  for (let t = 0; t < 12; t++) {
    const p = deck[Math.floor(R() * deck.length)];
    if (!p) break;
    const [x, y] = p;
    if ([0, 1, 2, 3, 4].every(k => at(x + k, y) === '.' && at(x + k, y + 1) !== '.') && spaced(x, y) && spaced(x + 4, y)) {
      set(x, y, charOf[pool[0]]); set(x + 2, y, 'O'); set(x + 4, y, charOf[d > 0.35 ? 'smg' : 'grunt']); taken.push([x, y], [x + 4, y]);
      break;
    }
  }
  for (const L of [deck, far]) if (ch(st.barrel + 0.2) && L.length) { const p = L[Math.floor(R() * L.length)]; if (at(p[0], p[1]) === '.' && at(p[0] + 1, p[1]) === '.') set(p[0], p[1], 'O'); }
  // ambushes: one on the deck, one on the far floor
  const ambush = [];
  for (const [L, trigOff] of [[deck, 9], [far, 10]]) {
    if (!ch(0.45 + d * 0.4)) continue;
    for (let t = 0; t < 20; t++) {
      const p = L[Math.floor(R() * L.length)];
      if (!p || at(p[0], p[1]) !== '.' || at(p[0] - 1, p[1]) !== '.' || at(p[0] + 1, p[1]) !== '.' || !spaced(p[0], p[1])) continue;
      ambush.push([p[0], p[1], pool[Math.floor(R() * pool.length)] === 'heavy' ? 'smg' : pool[Math.floor(R() * pool.length)], Math.max(4, p[0] - trigOff), L === far && ch(0.4) ? 'drop' : 'door']);
      taken.push(p);
      break;
    }
  }
  return { map: g.map(r => r.join('')), gen: true, big: true, ambush };
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
    const big = inCh % 4 === 2 || inCh === 12;            // two-floor halls show up in every chapter
    const nRooms = boss ? 4 : big ? 2 : 3;
    const rooms = [];
    for (let r = 0; r < nRooms; r++) {
      const role = r === 0 ? 'open' : r === nRooms - 1 ? 'climax' : 'mid';
      const seed = 1000 + i * 31 + r * 7;
      // boss fights from chapter 2 on take place in a big hall
      if ((big && r === 1) || (boss && chapter > 0 && r === nRooms - 1)) rooms.push(genBigRoom(seed, clamp(d + 0.04, 0, 1), { style: chapter, boss: boss && r === nRooms - 1 }));
      else rooms.push(genRoom(seed, clamp(d + r * 0.03, 0, 1), { boss: boss && r === nRooms - 1, style: chapter, role }));
    }
    let par = 0;
    for (const rm of rooms) par += rm.map[0].length * (rm.big ? 0.6 : 0.45) + (countEnemies(rm.map) + (rm.ambush ? rm.ambush.length : 0)) * 3 + 2;
    const names = GEN_NAMES[chapter];
    const k = chapter === 0 ? inCh - HAND_LEVELS.length : inCh;
    L = { name: names[k % names.length], rooms, par: Math.round(par / 5) * 5, big };
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
  const room = n > 0 && n % 7 === 3 ? genBigRoom(runSeed + n * 101, d, { style: t }) : genRoom(runSeed + n * 101, d, { boss: n > 0 && n % 6 === 5, style: t, role: n === 0 ? 'open' : n % 5 === 4 ? 'climax' : 'mid' });
  room.theme = t;
  return room;
}
