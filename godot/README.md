# AI Warlords — Vale Replay (Godot 4)

Replays the **genuine 15-dispatch engine chronicle** (`data/state.json`,
synced from `mockups/state.json` via `npm run godot:sync`) on a pointy-top
hex map with Kenney sprites + synthesized SFX.

## Run

1. Install **Godot 4.3+** (free, https://godotengine.org).
2. Open this `godot/` folder as a project.
3. Press **F5**. Transport: `|<` restart, `<`/`>` step, Pause/Play,
   speed cycle, fog toggle, sound toggle, scrub slider, click selects.

## What is genuine vs illustrative

- Genuine: all 16 keyframes, 15 outcomes, 18 events, per-keyframe fog
  (`visibilityBySnap`), city level/building counts, piles, unit HP/pos.
- Illustrative: Kenney sprite choice/placement, soldier tokens, herald
  lines, motion between stops (every stop is a true snapshot).

## Provenance

- Hex art: Kenney Hexagon Pack (CC0, https://kenney.nl) — see
  `../assets/kenney/License.txt`. Credit: Kenney (www.kenney.nl).
- SFX: `../assets/sfx.py` synthesis (WAV, 22050 Hz mono).
- Status: GDScript authored against the Godot 4 API; logic mirrors the
  verified web player. NOT executed in the dev sandbox (no Godot binary
  there) — please report any runtime error and it will be fixed.
