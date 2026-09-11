# Assets — sources of truth for art, maps & sound

## Tiled map (single source of truth for the scenario)

- `vale.tmj` — the Vale of Echoes scenario as a genuine **Tiled 1.10**
  hexagonal map (8×6, stagger axis Y + odd index = the engine's odd-q
  layout). Open and edit in https://www.mapeditor.org/.
  - `Terrain` tilelayer: 48 GIDs into the embedded `vale` tileset;
    per-tile `terrain` custom property.
  - `Resources` / `Spawns` / `Units` objectgroups: typed point objects
    (`resource+amount`, `playerIndex`, `owner+unitType+hp`).
- `vale-tiles.svg` — the tileset image, hand-authored SVG. Opens in
  **Inkscape** (labelled groups per tile) and loads in Tiled as-is.
- `../tools/tiled-map.ts` — strict loader + validator (orientation,
  stagger, GID flag bits, GID 0, layer sizes, property types). Throws
  on any defect. Used by `mockups/generate-state.ts` and `sim/`.
- Parity proof: switching the generator from hardcoded glyphs to this
  TMJ reproduced `mockups/state.json` **byte-identical**.

## SFX (synthesized, Audacity-style output)

- `sfx.py` — zero-dependency synthesizer. Run: `python3 assets/sfx.py`.
- `sfx/*.wav` — 22050 Hz 8-bit mono: `click coin step hammer whoosh
  fanfare`. Inlined (base64) into `mockups/match.html` by `build.mjs`;
  also copied to `godot/sfx/`.

## Kenney (CC0, third-party)

- `kenney/` — Kenney Hexagon Pack, verbatim download. License:
  `kenney/License.txt` (CC0 — credit appreciated, not required).
  Credit: Kenney (www.kenney.nl).
- A curated subset is copied to `godot/assets/kenney/` (see
  `godot/README.md`). The pack's tiles are flat-top; the engine renders
  pointy-top, so the Godot replay uses Kenney **objects** (trees, rocks,
  buildings, props) over procedural hexes.

## Deliberately NOT used (yet)

- **LDtk**: grid/room-oriented; our maps are hex + live in Tiled. LDtk
  fits a future campaign level-select, not this slice.
- **Blender**: no 3D pipeline in this 2D project; isometric look is
  achieved with 2D canvas/Godot rendering.
