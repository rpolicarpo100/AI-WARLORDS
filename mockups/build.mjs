// Embeds mockups/state.json into each page's /*__STATE__*/null slot.
// Run: node mockups/build.mjs (after generate-state.ts). Node-only, no deps.
import { readFileSync, writeFileSync } from 'node:fs';

const state = readFileSync(new URL('./state.json', import.meta.url), 'utf8');
// Escape closing tags so the JSON blob can never break out of <script>.
const blob = state.replace(/<\//g, '<\\/');
for (const page of ['index.html', 'menu.html', 'match.html', 'city.html']) {
  const url = new URL(`./${page}`, import.meta.url);
  const html = readFileSync(url, 'utf8');
  const count = html.split('/*__STATE__*/null').length - 1;
  if (count !== 1) {
    throw new Error(`${page}: expected 1 state slot, found ${count} (already built? restore first)`);
  }
  writeFileSync(url, html.replace('/*__STATE__*/null', () => blob));
  console.log(`${page}: state embedded (${blob.length} chars)`);
}
