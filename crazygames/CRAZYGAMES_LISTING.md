# Still Point: CrazyGames listing

**Title:** Still Point

**Short description:** Bend time and drop every gunman in this slow-motion ragdoll shootout.

**Description:**
Still Point is a stylish 2D action shooter where every bullet is visible and time is yours to bend. Sprint, slide under gunfire, front-flip over cover and hit Q to slow the world to a crawl. Line up a headshot, shoot an enemy's bullet out of the air, or blow up a barrel. Enemies go limp, drain to white and shatter into blocks.

Fight through 75 levels across five chapters (a white training lab, offices, a warehouse, a glass highrise and a neon-lit after-hours floor), with the difficulty ramping all the way. Earn three stars on every level, chain kills into huge style combos, then take on Endless mode, where the rooms never stop and the score is all that matters. Spend coins in the Armory on 13 guns with their own tricks (ricochet rounds, homing rounds, grenades, a minigun, a wall-piercing railgun) plus colours and hats. Come back daily for new missions and a growing login reward.

**Controls:**
- A / D: move · Ctrl: sprint · Shift: slide
- Space: jump (jump while sprinting to flip)
- Right click / S: slide
- Mouse: aim · Left click: shoot
- Q: slow time · R: reload · E: grab a dropped gun · P: pause
- Mobile: move stick, aim stick (tap to auto-aim), jump / slide / slow buttons

**Tags:** shooter, slow motion, ragdoll, action, 2D, stickman, physics, bullet time

**Orientation:** landscape (mobile shows a rotate prompt in portrait)

## SDK features used

- `init`, `loadingStart` / `loadingStop`, `gameplayStart` / `gameplayStop` (paused in menus and pause)
- `happytime` only when a boss level is beaten
- `reportGameCompletedPercentage` from the share of levels cleared
- No ads of any kind (Basic Launch): no midgames, rewarded ads or banners
- Game settings (`muteAudio`) listener
- Data module for cloud saves (localStorage when standalone)
- Leaderboard: best Endless score, once `LEADERBOARD_KEY` is set

## Assets

- `cover-landscape-1920x1080.png`, `cover-portrait-800x1200.png`, `cover-square-800x800.png`: captured in-engine
