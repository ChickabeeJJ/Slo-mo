# Slo-Mo

A 2D slow-motion ragdoll shootout, built as the web version of the Roblox demo. You are the blue figure: sprint, slide and flip through white cut-away rooms, bend time with **Q** and drop the red gunmen. Everything is one hit, for you and for them (except the armoured Juggernaut). Bodies go limp, drain to white and break into blocks.

It's pure HTML5 and vanilla JS, with no build step and no dependencies. It has the same structure as Element Rag: all art is drawn procedurally, every sound is synthesized, and the CrazyGames SDK v3 is wrapped in `js/platform.js`.

To play, serve the folder (for example `python3 -m http.server`) and open `index.html`.

## The game

- **Rooms and doors.** A level is a chain of 3–4 rooms. Each exit door has a lamp: red while anyone in the room is alive, green once it's clear. Walk into an open door to go to the next room. Dying restarts the room, not the level.
- **Slow motion.** **Q** toggles bullet time. It drains a meter, and every kill refills some of it. The world drops to about a quarter speed while you keep about two thirds, so you can out-run bullets. The mix goes muffled, the music's tempo drags and a heartbeat plays. Slow motion also kicks in on its own for close calls, glass breaking, explosions and the **kill cam** on the last enemy in a room.
- **Movement.** Sprint (**Shift**), jump (**Space**), slide (**right click**/**S**). Sliding lowers your hitbox under chest-high bullets and gets you through low vents. Jumping while sprinting does a **front flip**. Sprinting, sliding or jumping into glass shatters it. Walking into crates kicks them. To drop through a ledge or table, stand still on it and press slide.
- **Gunplay.** Every bullet is a visible projectile. Enemy shots are dark slugs with a white wake, and every gunman shows a red sight line before firing, so you can always read a shot. You can **shoot bullets out of the air**. Enemies drop their guns: press **E** to grab one. A grabbed gun has a fixed magazine and gets tossed when it's empty. Enemy bullets can hit other enemies.
- **Style.** Each kill is worth 100, plus bonuses for HEADSHOT, AIRBORNE, FLIP KILL, SLIDE KILL, PIERCE, BOOM, CROSSFIRE and MULTI KILL. DEFLECT also scores. Chained kills build a combo multiplier, up to x4.

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

- **Campaign:** 30 levels across 5 chapters (Orientation, Offices, Warehouse, Highrise, After Hours). Each chapter has its own palette, and After Hours is a dark, lamp-lit theme. Every 6th level is a boss level with a Juggernaut. Stars: **cleared**, **under par time**, **no deaths**.
- **Endless:** unlocks after level 3. It generates rooms forever, gets harder every room, rotates themes every 4 rooms and adds a Juggernaut every 6th room. It tracks your best score. You can revive once per run with a rewarded ad.
- **Armory:** 6 weapons (Pistol, Hand Cannon, SMG, Shotgun, Twin Pistols, Battle Rifle), 9 colours and 8 hats bought with coins. Prism and Halo unlock with stars.
- **Daily missions:** three a day from a pool of 12, with a 250-coin bonus for finishing all three.
- **Daily login reward:** a 7-day streak that pays 50 → 400 coins and resets if you miss a day.
- **Coins:** from clears (stars, style and a first-clear bonus), Endless runs and missions.

## Levels

Chapter 1 is handcrafted. The first level recreates the demo's tutorial rooms, with the instructions painted on the back wall: sprint, slide under a low vent and up the stairs, a gunman facing away, then slowing time against two gunmen. The rest of the campaign and Endless come from a seeded generator (`genRoom` in `js/levels.js`). It builds stairs, raised sections, sloped ceilings, slide tunnels, ledges, glass, cover crates, barrels and furniture, so every level always lays out the same. The map legend is at the top of `js/levels.js`.

## Ads (CrazyGames)

`ADS_ENABLED` in `js/platform.js` (set to `false` for a Basic Launch upload). Midgames only play at the end of a run, before its results: every 2nd level clear and the 1st, 3rd, 5th… Endless run of a session. They never play from a button. Rewarded ads are opt-in: **double coins** on the results screen and **revive** in Endless (at most once a minute). There is one desktop banner on the home screen, and none during play. Happytime fires on 3-star clears, boss levels and new Endless bests. Campaign progress is reported with `reportGameCompletedPercentage`. For the leaderboard, put the key in `LEADERBOARD_KEY` and the best Endless score gets submitted.

## Controls

| Desktop | Action |
| --- | --- |
| `A` / `D` (or arrows) | Move |
| `Shift` | Sprint (jump while sprinting to flip) |
| `W` / `Space` | Jump |
| Right click / `S` / `C` | Slide (stand still on a ledge to drop through) |
| Mouse + left click | Aim and shoot (hold for automatic weapons) |
| `Q` | Slow time |
| `R` | Reload (and retry after dying) |
| `E` | Grab a dropped gun |
| `P` / `Esc` | Pause |

On touch screens: a floating move stick on the left (push all the way to sprint, flick up to jump, down to slide) and an aim stick on the right. Tap the aim stick to auto-aim and fire at the nearest visible enemy, or drag to aim yourself (with a soft snap you can turn off in Settings). There are JUMP, SLIDE, SLOW and reload buttons, and a GRAB button appears next to dropped guns.

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
js/world.js       room parsing, 20px collision grid, one-point perspective renderer
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
