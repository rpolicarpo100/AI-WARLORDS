// Bundles the real engine for the browser (Take-Command demo mode).
// Run: npm run engine  ->  tools/engine.bundle.js (committed, like state.json).
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

const shim = new URL('./shims/node-crypto.mjs', import.meta.url).pathname;
const result = await build({
  entryPoints: [new URL('./browser-engine.ts', import.meta.url).pathname],
  bundle: true,
  format: 'iife',
  target: 'es2019',
  globalName: 'AIWLEngine',
  minify: true,
  alias: { 'node:crypto': shim },
  write: false,
});
const out = result.outputFiles[0].text;
writeFileSync(new URL('./engine.bundle.js', import.meta.url), out);
console.log(`engine.bundle.js built (${out.length} chars)`);
