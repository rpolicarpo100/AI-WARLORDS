// Copies the genuine engine chronicle into the Godot project.
// Run: npm run godot:sync (after regenerating mockups/state.json). Node-only, no deps.
import { copyFileSync } from 'node:fs';

copyFileSync(
  new URL('../mockups/state.json', import.meta.url),
  new URL('../godot/data/state.json', import.meta.url),
);
console.log('godot/data/state.json synced from mockups/state.json');
