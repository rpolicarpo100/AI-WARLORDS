// Embeds mockups/state.json into each page (offline-safe). Idempotent:
// replaces the /*__STATE__*/null slot or the previously embedded blob.
// Run: node mockups/build.mjs (after generate-state.ts). Node-only, no deps.
import { readFileSync, writeFileSync } from 'node:fs';

const state = readFileSync(new URL('./state.json', import.meta.url), 'utf8');
// Escape closing tags so the JSON blob can never break out of <script>.
const blob = state.replace(/<\//g, '<\\/');
for (const page of ['index.html', 'menu.html', 'match.html', 'city.html']) {
  const url = new URL(`./${page}`, import.meta.url);
  const html = readFileSync(url, 'utf8');
  const slot = 'const SCENARIO = /*__STATE__*/null;';
  let next;
  if (html.includes(slot)) {
    next = html.replace(slot, () => `const SCENARIO = ${blob};`);
  } else {
    // The old blob ends at the next `</script>` (JSON holds no tags).
    const marker = 'const SCENARIO = ';
    const start = html.indexOf(marker);
    const end = html.indexOf('</script>', start);
    if (start === -1 || end === -1 || html.indexOf(marker, start + 1) !== -1) {
      throw new Error(`${page}: state block not found exactly once`);
    }
    next = html.slice(0, start + marker.length) + blob + ';' + html.slice(end);
  }
  writeFileSync(url, next);
  console.log(`${page}: state embedded (${blob.length} chars)`);
}
