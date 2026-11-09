# Slo-Mo

A 2D slow-motion ragdoll shootout, built as the web version of the Roblox demo. You are the blue figure: sprint, slide and flip through white cut-away rooms, bend time with **Q** and drop the red gunmen. Everything is one hit, for you and for them (except the armoured Juggernaut). Bodies go limp, drain to white and break into blocks.

It's pure HTML5 and vanilla JS, with no build step and no dependencies. It has the same structure as Element Rag: all art is drawn procedurally, every sound is synthesized, and the CrazyGames SDK v3 is wrapped in `js/platform.js`.

To play, serve the folder (for example `python3 -m http.server`) and open `index.html`.

## The game

- **Rooms and doors.** A level is a chain of rooms. The exit door is always open, so clearing the room is optional and only worth points. The door slowly swings open as you approach (that's only the animation: walking into the frame always takes you through straight away). Dying restarts the room, not the level.
- **Ambushes.** Pass a certain point and an enemy bursts out of a side door or drops from a ceiling hatch. It's kept fair: an alarm sounds and the door flashes red for ¾ s first, the enemy always appears well ahead of you (never behind or right on top of you), and it takes extra time before its first shot.
- **Slow motion.** **Q** toggles bullet time. It drains a meter, and every kill refills some of it. The world drops to about a quarter speed while you keep about two thirds, so you can out-run bullets. The mix goes muffled, the music's tempo drags and a heartbeat plays. Slow motion also kicks in on its own for close calls, glass breaking, explosions and the **kill cam** on the last enemy in a room.
- **Movement.** Hold **Shift** to sprint. Pressing **Shift** while moving also starts a slide, and you keep sprinting when the slide ends. **Right click**, **S** or **C** also slide. Sliding lowers your hitbox under chest-high bullets and gets you through low vents (two tiles tall). Slide in mid-air to dive: you drop low and land straight into a slide, keeping your speed. **Front flip:** jump while sprinting or sliding (any jump at high speed). Sprinting, sliding or jumping into glass shatters it. To drop through a ledge or table, stand still on it and press right click or S.
- **Physics.** Dead bodies go limp, then break into separate limb blocks. Limb blocks and crates are rigid bodies with mass, spin, friction and bounce: they tip over edges, roll, stack and settle. Crates are cover: bullets thump into them and shove them, and four hits smash a crate into loose planks (explosions break them too). You can push them, tip them over by sprinting or sliding into them, and stand on them.
- **Gunplay.** Every bullet is a visible projectile. Player rounds from every gun fly at the same slow speed (900 px/s), so you have to lead your shots, and fire rates are deliberately slow. Enemy shots are dark slugs with a white wake, and every gunman shows a red sight line before firing, so you can always read a shot. You can **shoot bullets out of the air**. Enemies drop their guns: press **E** to grab one. A grabbed gun has a fixed magazine and gets tossed when it's empty. Enemy bullets can hit other enemies.
- **Style.** Each kill is worth 100, plus bonuses for HEADSHOT, AIRBORNE, FLIP KILL, SLIDE KILL, BOOM, CROSSFIRE and MULTI KILL. DEFLECT also scores. Chained kills build a combo multiplier, up to x4.

## Weapons

| Weapon | Gimmick |
| --- | --- |
| Pistol | Reliable, fast reload |
| Hand Cannon | Double damage: cracks Juggernaut armour in two hits |
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

Shot barrels fizz and flash for a moment before exploding, and explosions chain into nearby barrels.

## Enemies

| Enemy | Map char | Behaviour |
| --- | --- | --- |
| Gunman | `e` | Pistol, steady single shots, backs off if you rush him |
| Sprayer | `m` | SMG bursts |
| Breacher | `s` | Shotgun spread, advances on you |
| Marksman | `r` | Long laser telegraph, very fast round |
| Juggernaut | `h` | Armour: 4 body hits or 2 headshots, long bursts |
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
- **Endless:** unlocks after level 3. It generates rooms forever, gets harder every room, rotates themes every 4 rooms and adds a Juggernaut every 6th room. It tracks your best score. You can revive once per run with a rewarded ad.
- **Armory:** 13 weapons, 9 colours and 13 hats (Headband, Beanie, Cap, Party Hat, Shades, Headphones, Visor, Cowboy, Top Hat, Horns, Crown, Halo), bought with coins. Prism (120 stars) and Halo (60 stars) unlock with stars.
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

On touch screens the HUD switches to touch controls, and the painted tutorial text describes them instead of keys. Controls: a floating move stick on the left (push all the way to sprint, flick up to jump, down to slide) and an aim stick on the right. Tap the aim stick to auto-aim and fire at the nearest visible enemy, or drag to aim yourself (with a soft snap you can turn off in Settings). There are JUMP, SLIDE, SLOW and reload buttons around the fire stick, and a GRAB button appears next to dropped guns. The SLOW button's ring doubles as the slow-motion meter.

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

Font: [Rubik](https://fonts.google.com/specimen/Rubik) by Hubert and Fischer, under the SIL Open Font License 1.1.
