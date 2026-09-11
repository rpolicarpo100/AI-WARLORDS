# UI Mockups (design artifact, pre-M022)

Self-contained HTML screens — open `index.html`. No engine code here;
the engine is untouched (M021 sealed).

- `generate-state.ts` — boots a real `Match` (seed 7), plays 5 scripted
  dispatches (gather → build → advance → build → advance), and exports
  genuine snapshots/events/timeline/visibility/explored/perception to
  `state.json`. Run: `npx tsx mockups/generate-state.ts`.
- `build.mjs` — embeds `state.json` into each page (offline-safe).
- Pages: `index.html` (hub), `menu.html`, `match.html`, `city.html`.
- `match.html` is a LIVE animated chronicle: 16 genuine keyframes
  (15 dispatches) rendered as an isometric Canvas battlefield —
  extruded hex blocks, procedural forests/mountains/farms/water,
  a keep that grows with the real city level, soldier squads that
  glide between keyframes with HP bars + nameplates, real
  per-keyframe fog/memory, streaming chronicle, transport controls
  (play/pause/speed/scrub) and a clickable orders list.
  Motion illustrates; every stop is a true engine snapshot.

What's real: map/state/events/fog/costs/stats. What's placeholder: art,
layout, names, AI personas/advisor, all buttons (inert).
