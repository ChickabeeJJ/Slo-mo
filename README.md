# Slo-Mo

A 2D slow-motion ragdoll shootout, built as the web version of the Roblox demo. You are the blue figure: sprint, slide and flip through white cut-away rooms, bend time with **Q** and drop the red gunmen. Everything is one hit, for you and for them (except the big Juggernaut and Brute, which take two). Bodies go limp, drain to white and break into blocks.

It's pure HTML5 and vanilla JS, with no build step and no dependencies. It has the same structure as Element Rag: all art is drawn procedurally, every sound is synthesized, and the CrazyGames SDK v3 is wrapped in `js/platform.js`.

To play, serve the folder (for example `python3 -m http.server`) and open `index.html`.

## The game

- **Rooms and doors.** A level is a chain of rooms. The exit door is always open, so clearing the room is optional and only worth points. The door slowly swings open as you approach (that's only the animation: walking into the frame always takes you through straight away). Dying restarts the room, not the level, after a short beat (0.9 s) so a panicked click doesn't skip straight back in.
- **Surprise enemies.** Cross a trigger line and someone appears where you aren't looking, marked by a big yellow "!" for a moment. They only ever carry a pistol or a knife. They appear most often **behind you**, sometimes **up on a ledge or deck above**, sometimes ahead. To keep it fair, they never appear closer than about 280px, there's a faint sound and the off-screen arrow points to them, and they wait a beat before their first shot (longest when they're behind you).
- **Slow motion.** **Q** toggles bullet time. It drains a meter, and every kill refills some of it. The meter (about 4.3 s of slow motion when full, refilling at 4.5% a second plus 20% per kill) carries over between rooms, and retrying a room gives you back what you walked in with (a full meter at the start of a level). The world drops to about a quarter speed while you keep about two thirds, so you can out-run bullets. The mix goes muffled, the music's tempo drags and a heartbeat plays. Slow motion also kicks in on its own for close calls, glass breaking, explosions and the **kill cam** on the last enemy in a room.
- **Movement.** Hold **Shift** to sprint. Pressing **Shift** while moving also starts a slide, and you keep sprinting when the slide ends. **Right click**, **S** or **C** also slide. Sliding lowers your hitbox under chest-high bullets and gets you through low vents (two tiles tall). A slide keeps its speed and bleeds it off with floor friction, then you stand back up on your own. Slides go down stairs (the body tilts with the steps) but never up them: hitting a step or a wall ends the slide. You can't jump or stand up under a low ceiling. Slide in mid-air to dive: you drop low and land straight into a slide, keeping your speed. **Front flip:** jump while sprinting or sliding (any jump at high speed). Sprinting, sliding or jumping into glass shatters it. To drop through a ledge or table, stand still on it and press right click or S.
- **Physics.** Dead bodies go limp, then break into separate limb blocks. Limb blocks and crates are rigid bodies with mass, spin, friction and bounce: they tip over edges, roll, stack and settle. Crates are cover: bullets thump into them and shove them, and four hits smash a crate into loose planks (explosions break them too). You can push them, tip them over by sprinting or sliding into them, and stand on them.
- **Gunplay.** Every bullet is a visible projectile. Player rounds from every gun fly at the same slow speed (900 px/s), so you have to lead your shots, and fire rates are deliberately slow. Enemy shots are dark slugs with a white wake, and every gunman shows a red sight line before firing, so you can always read a shot. You can **shoot bullets out of the air**. Enemies drop their guns: press **E** to grab one. A grabbed gun has a fixed magazine and gets tossed when it's empty. It stays with you into the next room (and through a retry of that room), but not into the next level. Enemy bullets can hit other enemies.
- **Style.** Each kill is worth 100, plus bonuses for HEADSHOT, AIRBORNE, FLIP KILL, SLIDE KILL, BOOM, CROSSFIRE and MULTI KILL. DEFLECT also scores. Chained kills build a combo multiplier, up to x4.

## Weapons

| Weapon | Gimmick |
| --- | --- |
| Pistol | Reliable, fast reload |
| Hand Cannon | Double damage: drops a Juggernaut or Brute in one hit |
| SMG | Hold to spray |
| Burst Rifle | Three-round burst per click |
| Shotgun | Six-pellet spread |
| Ricochet | Rounds bounce off walls 3 times |
| Splitter | Each round splits into three mid-flight |
| Twin Pistols | Alternating hands, fast clicks |
| Seeker | Rounds curve toward the nearest enemy |
| Battle Rifle | Steady full auto with a tight spread |
| Launcher | Arcing grenades that explode on impact (the splash can get you too) |
| Minigun | Spins up before firing, slows you while it fires |
| Railgun | Hold to charge, release to fire straight through walls; one-shots anything |

Shot barrels fizz and flash for a moment before exploding, and explosions chain into nearby barrels. Explosions are built from procedurally generated billow textures: a white-hot flash, a fireball that cools from white through orange to soot, rolling dark smoke, burning debris on smoke trails, motion-blurred sparks, a dust wave along the floor, embers and a pressure ring.

## Enemies

| Enemy | Map char | Behaviour |
| --- | --- | --- |
| Gunman | `e` | Pistol, steady single shots, backs off if you rush him |
| Sprayer | `m` | SMG bursts |
| Breacher | `s` | Shotgun spread, advances on you |
| Marksman | `r` | Long laser telegraph, very fast round |
| Juggernaut | `h` | Big: 2 body hits or 1 headshot, short slow SMG bursts |
| Riot | `i` | Front shield stops rounds; head is exposed, back is open, explosions and the Railgun go through |
| Grenadier | `n` | Lobs grenades at where you stand; the blast zone is marked on the floor and you can shoot grenades out of the air |
| Brute | `y` | Big, two hits (one headshot). Winds up, then charges in a straight line: jump over it, or make it hit a wall and stun itself |
| Blade | `k` | No gun. Sprints and jumps after you, slashes up close |

Lowercase map chars face the player's side. UPPERCASE ones face away until they hear a shot.

## Progression and retention

- **Campaign:** 75 levels, 15 in each of 5 chapters. Every 5th level is a boss level with a Juggernaut. Levels 8 and 13 of each chapter end in a **big map**: a wide, two-storey hall with stairs up to a long deck, a sniper catwalk, a drop back down and the exit across the far floor. Endless throws in a big map every 7th room. Stars: **cleared**, **under par time**, **no deaths**. Each chapter builds its rooms differently:
  - **Orientation:** white lab rooms, wall vents, the tutorial.
  - **Offices:** warm walls, desks with monitors, plants, water coolers, windows with blinds, posters, clocks and lots of glass partitions.
  - **Warehouse:** tall concrete halls, catwalks, pallet stacks, crates, barrels, roller shutters, stencilled bay numbers, hazard stripes and pipes.
  - **Highrise:** pale blue rooms with big windows onto a city skyline, glass everywhere, sloped ceilings.
  - **After Hours:** dark rooms lit by lamp cones, neon signs, blinking server racks, more vents to slide through, more enemies.
- **Difficulty:** climbs steadily across all 75 levels and through every Endless run. Enemies react sooner, telegraph for less time, turn faster, fire more often, aim tighter and shoot faster rounds, and rooms hold more of them (up to 9). Every enemy still shows its red sight line before firing.
- **Endless:** unlocks after level 3. You get three lives: losing one restarts the room you're in. It generates rooms forever, gets harder every room, rotates themes every 4 rooms and adds a Juggernaut every 6th room. It tracks your best score. When your last life is gone, a rewarded ad can buy one more (once per run).
- **Armory:** 13 weapons, 9 colours and 13 hats (Headband, Beanie, Cap, Party Hat, Shades, Headphones, Visor, Cowboy, Top Hat, Horns, Crown, Halo), bought with coins. Prism (120 stars) and Halo (60 stars) unlock for free once you've earned that many stars; stars are never spent. Prism is a translucent, iridescent crystal finish with twinkling glints.
- **Armour:** an Armor tab in the shop with 5 pieces for each slot (head, body, legs). Each piece absorbs a set number of hits per level: damage carries from room to room and through deaths and retries, and it's only fully repaired when a level (or Endless run) starts. A hit lands on the slot it struck. A shotgun blast or one punch only costs one hit, and a piece that runs out breaks off. Helmets replace your hat while worn. A small HUD shows the hits left.

| Head | Body | Legs |
| --- | --- | --- |
| Padded Hood (1) | Kevlar Vest (1) | Knee Pads (1) |
| Steel Helmet (2) | Plate Carrier (2) | Runner Guards (1, +7% speed) |
| Tactical Helmet (2, each block refills 30% slow-mo) | Blast Vest (2, also soaks one explosion) | Steel Greaves (2) |
| Mirror Visor (1, deflects) | Mirror Plate (2, deflects) | Kinetic Greaves (2, deflects) |
| Titan Helm (3) | Bastion Suit (4, thorns: Blades that hit it die, Brutes are stunned) | Sentinel Legs (3) |

Deflect sends the blocked round straight back at whoever fired it.
- **Daily missions:** three a day from a pool of 12, with a 250-coin bonus for finishing all three.
- **Daily login reward:** a 7-day streak that pays 50 → 400 coins and resets if you miss a day.
- **Coins:** from clears (stars, style and a first-clear bonus), Endless runs and missions.

## Levels

Chapter 1 is handcrafted. The first level recreates the demo's tutorial rooms, with the instructions painted on the back wall: sprint, slide under a low vent and up the stairs, a gunman facing away, then slowing time against two gunmen. The rest of the campaign and Endless come from a seeded generator (`genRoom` in `js/levels.js`). It builds stairs, raised sections, sloped ceilings, slide tunnels, ledges, glass, cover crates, barrels and furniture, so every level always lays out the same. The map legend is at the top of `js/levels.js`. The generator keeps crate blocks clear of vent openings, and every campaign room plus a few hundred Endless rooms have been checked with a search that uses the real movement physics (sprint, jump, slide) to confirm the exit door can be reached from the spawn.

## Ads (CrazyGames)

`ADS_ENABLED` in `js/platform.js` (set to `false` for a Basic Launch upload). Midgames only play at the end of a run, before its results: every 2nd level clear and the 1st, 3rd, 5th… Endless run of a session. They never play from a button. Rewarded ads are opt-in: **double coins** on the results screen and **revive** in Endless (at most once a minute). There is one desktop banner on the home screen, and none during play. Happytime fires on 3-star clears, boss levels and new Endless bests. Campaign progress is reported with `reportGameCompletedPercentage`. For the leaderboard, put the key in `LEADERBOARD_KEY` and the best Endless score gets submitted.

## Controls

| Desktop | Action |
| --- | --- |
| `A` / `D` (or arrows) | Move |
| `Shift` | Sprint; pressing it while moving also slides (jump while sprinting or sliding to flip) |
| `W` / `Space` | Jump |
| Right click / `S` / `C` | Slide, or dive if you're in the air (stand still on a ledge to drop through) |
| Mouse + left click | Aim and shoot (hold for automatic weapons) |
| `Q` | Slow time |
| `R` | Reload (and retry after dying) |
| `E` | Grab a dropped gun |
| `P` | Pause (Esc is left for leaving fullscreen) |

On touch screens the HUD switches to touch controls, and the painted tutorial text describes them instead of keys. A floating move stick sits on the left: push it all the way to sprint, flick up to jump, flick down to slide. Tap or hold anywhere else on the screen to shoot toward that spot, with a gentle snap onto an enemy right next to your finger (you can turn this off in Settings). Each finger is tracked separately, so you can move and shoot at the same time. Matte JUMP, SLIDE, SLOW and reload buttons sit in the bottom-right corner, the SLOW button's ring doubles as the slow-motion meter, and a GRAB button appears next to dropped guns.

## Project layout

```
index.html
css/style.css     UI: ink panels with cut corners, keycaps, HUD, touch controls
js/util.js        math, seeded RNG, colour helpers, glow sprite cache
js/platform.js    CrazyGames SDK v3 wrapper: events, ads, banners, accounts, data
js/audio.js       synthesized guns, impacts, glass, explosions + a tempo-scaled music loop
js/data.js        weapons, enemy archetypes, skins, hats, missions, style table
js/levels.js      map legend, themes, chapters, handcrafted levels, room generator
js/progress.js    save data, armory, daily missions, login streak
js/world.js       room parsing, 20px collision grid, one-point perspective renderer, crate art
js/physics.js     rigid boxes for limb blocks and crates: contacts, friction, stacking, sleeping
js/ragdoll.js     blocky active-ragdoll bodies, death ragdolls, loose limb blocks, guns, hats
js/fx.js          sparks, dust, glass, shell casings, muzzle flashes, style popups
js/game.js        player, enemy AI, bullets, slow motion, scoring, camera, rendering
js/icons.js       UI icons
js/ui.js          home, levels, armory, missions, settings, pause, results, HUD, touch
js/main.js        boot, loop, keyboard/mouse
assets/fonts/     Rubik (SIL Open Font License)
crazygames/       listing text and 3 covers
```

## Credits

Fonts: [Rubik](https://fonts.google.com/specimen/Rubik) by Hubert and Fischer, and [Exo 2](https://github.com/NDISCOVER/Exo-2.0) by The Exo 2 Project Authors (painted wall text), both under the SIL Open Font License 1.1.
