// Embeds mockups/state.json into each page (offline-safe). Idempotent:
// replaces the /*__STATE__*/null slot or the previously embedded blob.
// Run: node mockups/build.mjs (after generate-state.ts). Node-only, no deps.
import { readFileSync, writeFileSync } from 'node:fs';

// Real engine bundle (Take-Command demo), inlined into match.html.
let engBlob = null;
try {
  engBlob = readFileSync(new URL('../tools/engine.bundle.js', import.meta.url), 'utf8');
  if (engBlob.includes('</script')) throw new Error('engine bundle contains a closing script tag');
} catch (err) {
  console.warn('engine bundle missing/invalid — Take-Command disabled:', err.message);
}
// Kenney sprite pack (CC0 PNGs, base64), inlined into match.html.
const sprDir = new URL('../assets/kenney/PNG/Objects/', import.meta.url);
const SPRITES = [
  'treePine_large',
  'treePine_small',
  'treeRound_large',
  'treeRound_small',
  'rockGrey_large',
  'rockGrey_medium1',
  'rockGrey_small1',
  'rockBrown_small',
  'house',
  'house_small',
  'tower',
  'mine',
  'farm',
  'farmland',
  'campingTent',
  'well',
  'windmill_complete',
  'fence',
  'banner',
  'box1',
  'box2',
  'pallet_full',
  'logPile',
  'log',
  'crystals1',
  'castle_small',
  'castle_open',
  'castle_large',
  'church',
];
const sprBlob = JSON.stringify(
  Object.fromEntries(
    SPRITES.map((name) => [
      name,
      readFileSync(new URL(`./${name}.png`, sprDir)).toString('base64'),
    ]),
  ),
);
const state = readFileSync(new URL('./state.json', import.meta.url), 'utf8');
// Escape closing tags so the JSON blob can never break out of <script>.
const blob = state.replace(/<\//g, '<\\/');
// SFX pack: base64 WAVs (synthesized by assets/sfx.py), inlined into match.html.
const sfxDir = new URL('../assets/sfx/', import.meta.url);
const sfxBlob = JSON.stringify(
  Object.fromEntries(
    ['click', 'coin', 'step', 'hammer', 'whoosh', 'fanfare', 'wind'].map((name) => [
      name,
      readFileSync(new URL(`./${name}.wav`, sfxDir)).toString('base64'),
    ]),
  ),
);
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
  if (page === 'match.html' && engBlob) {
    const startM = '//__ENGINE_START__',
      endM = '//__ENGINE_END__';
    const si = next.indexOf(startM),
      ei = next.indexOf(endM);
    if (si === -1 || ei === -1 || ei < si) throw new Error(`${page}: engine markers missing`);
    next = next.slice(0, next.indexOf('\n', si) + 1) + engBlob + '\n' + next.slice(ei);
  }
  if (page === 'match.html') {
    const sprSlot = 'const SPRITESB64 = /*__SPRITES__*/null;';
    if (next.includes(sprSlot)) {
      next = next.replace(sprSlot, () => `const SPRITESB64 = ${sprBlob};`);
    } else {
      const marker = 'const SPRITESB64 = ';
      const start = next.indexOf(marker);
      const end = next.indexOf('};', start);
      if (start === -1 || end === -1 || next.indexOf(marker, start + 1) !== -1) {
        throw new Error(`${page}: sprites block not found exactly once`);
      }
      next = next.slice(0, start + marker.length) + sprBlob + next.slice(end + 1);
    }
  }
  if (page === 'match.html') {
    const sfxSlot = 'const SFXB64 = /*__SFX__*/null;';
    if (next.includes(sfxSlot)) {
      next = next.replace(sfxSlot, () => `const SFXB64 = ${sfxBlob};`);
    } else {
      // Flat JSON blob (base64 holds no '}'): it ends at the first '};'.
      const marker = 'const SFXB64 = ';
      const start = next.indexOf(marker);
      const end = next.indexOf('};', start);
      if (start === -1 || end === -1 || next.indexOf(marker, start + 1) !== -1) {
        throw new Error(`${page}: sfx block not found exactly once`);
      }
      next = next.slice(0, start + marker.length) + sfxBlob + next.slice(end + 1);
    }
  }
  writeFileSync(url, next);
  let msg = `${page}: state embedded (${blob.length} chars)`;
  if (page === 'match.html') {
    msg += `, sfx embedded (${sfxBlob.length} chars), sprites embedded (${sprBlob.length} chars)`;
    msg += engBlob ? `, engine embedded (${engBlob.length} chars)` : ', engine MISSING';
  }
  console.log(msg);
}
