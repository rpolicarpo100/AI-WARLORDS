/**
 * Browser entry point for the REAL engine (Take-Command demo mode).
 * Bundled by tools/build-engine.mjs (esbuild, node:crypto shimmed) into
 * tools/engine.bundle.js and embedded in mockups/match.html.
 * Same code, same determinism as the server engine — running locally
 * for the mockup demo only (the real game stays server-validated).
 */
export { Match, STANDARD_RULESET, createMatchId } from '../src/engine/match.js';
export { createWorldState, WORLD_SCHEMA_VERSION } from '../src/engine/world-state.js';
export { markUntrusted } from '../src/engine/authority.js';
export { computeVisibility } from '../src/engine/fog.js';
export { markExplored } from '../src/engine/exploration.js';
// Genuine rules reuse for page overlays (FASE B): adjacency, passability.
// The page never re-implements engine rules — it calls them (guarded).
export { neighborsOf } from '../src/engine/map.js';
export { DEFAULT_TERRAIN_CONFIG, modifiersFor } from '../src/engine/terrain.js';
// M068 — Arena panel: the page runs real self-play (first UI reader).
export { simplePolicy } from '../src/engine/selfplay.js';
