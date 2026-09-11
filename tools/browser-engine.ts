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
