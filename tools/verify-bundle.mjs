// Verifies the browser engine bundle (tools/engine.bundle.js) runs the REAL engine:
//  1. Replays the state.json scenario script inside a vm sandbox (browser-like realm)
//     and requires byte-identical snapshots/outcomes/events.
//  2. Fork test: hydrates from a MIDDLE snapshot (like Take-Command mode),
//     dispatches applied + rejected commands, recomputes fog.
// Run: npm run verify:bundle. Node-only, no deps.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortKeys(v[k])]),
    );
  }
  return v;
};
const canon = (v) => JSON.stringify(sortKeys(v));

const root = new URL('../', import.meta.url);
const bundle = readFileSync(new URL('tools/engine.bundle.js', root), 'utf8');
const state = JSON.parse(readFileSync(new URL('mockups/state.json', root), 'utf8'));

const sandbox = {
  console,
  initText: JSON.stringify(state.snapshots[0]),
  midText: JSON.stringify(state.snapshots[8]),
  economyText: JSON.stringify(state.configs.economy),
  buildingsText: JSON.stringify(state.configs.buildings),
};
vm.createContext(sandbox);
// Realm-local test globals (real browsers provide these natively).
vm.runInContext(
  `
structuredClone = (o) => JSON.parse(JSON.stringify(o));
TextEncoder = function () {};
TextEncoder.prototype.encode = (s) => {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
};
crypto = { randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
  const r = Math.floor(Math.random() * 16);
  return ((ch === 'x' ? r : (r & 0x3) | 0x8)).toString(16);
}) };
`,
  sandbox,
);
vm.runInContext(bundle, sandbox);

const SCRIPT = JSON.stringify([
  ['r1', 'p1', 'economy.gather', { col: 3, row: 2 }],
  ['r2', 'p1', 'unit.move', { id: 'u0', col: 3, row: 2 }],
  ['r3', 'p1', 'unit.move', { id: 'u0', col: 4, row: 2 }],
  ['r4', 'p1', 'economy.gather', { col: 4, row: 2 }],
  ['r5', 'p1', 'city.build', { type: 'house' }],
  ['r6', 'p1', 'match.advance', {}],
  ['r7', 'p1', 'unit.move', { id: 'u1', col: 4, row: 3 }],
  ['r8', 'p1', 'city.build', { type: 'tower' }],
  ['r9', 'p1', 'match.advance', {}],
  ['r10', 'p2', 'unit.move', { id: 'u3', col: 7, row: 3 }],
  ['r11', 'p1', 'unit.move', { id: 'u2', col: 2, row: 1 }],
  ['r12', 'p1', 'match.advance', {}],
  ['r13', 'p1', 'city.upgrade', {}],
  ['r14', 'p1', 'match.advance', {}],
  ['r15', 'p1', 'economy.gather', { col: 3, row: 2 }],
]);

const resultText = vm.runInContext(
  `
(() => {
  const E = AIWLEngine;
  const mk = (text) => {
    const init = JSON.parse(text);
    const match = new E.Match({ seed: 7, ruleset: E.STANDARD_RULESET, players: ['p1', 'p2'],
      initialState: E.createWorldState({ players: ['p1', 'p2'], tick: init.tick, map: init.map,
        stockpiles: init.stockpiles, buildings: init.buildings, cities: init.cities, units: init.units }),
      economyConfig: JSON.parse(economyText), buildingsConfig: JSON.parse(buildingsText) });
    return { match, s1: match.join('p1'), s2: match.join('p2') };
  };
  // Stage 1: full replay from snapshot 0.
  const { match, s1, s2 } = mk(initText);
  const script = ${SCRIPT};
  const snaps = [match.getSnapshot()], outcomes = [];
  for (const [rid, who, type, payload] of script) {
    outcomes.push(match.dispatch(who === 'p1' ? s1 : s2,
      E.markUntrusted({ requestId: rid, playerId: who, type, payload })));
    snaps.push(match.getSnapshot());
  }
  const badMove = match.dispatch(s1, E.markUntrusted({ requestId: 'bad', playerId: 'p1', type: 'unit.move', payload: { id: 'u0', col: 0, row: 0 } }));
  // Stage 2: fork from a middle snapshot (Take-Command hydration recipe).
  const fork = mk(midText);
  const adv = fork.match.dispatch(fork.s1, E.markUntrusted({ requestId: 'f1', playerId: 'p1', type: 'match.advance', payload: {} }));
  const frej = fork.match.dispatch(fork.s1, E.markUntrusted({ requestId: 'f2', playerId: 'p1', type: 'unit.move', payload: { id: 'u0', col: 0, row: 0 } }));
  const fsnap = fork.match.getSnapshot();
  const seen = E.computeVisibility(fsnap.map, (fsnap.units.units || []).filter((u) => u.owner === 'p1')
    .map((u) => ({ viewer: 'p1', col: u.col, row: u.row, range: 2 })));
  return JSON.stringify({ exports: Object.keys(E), snaps, outcomes, events: match.getEvents(), badMove,
    fork: { advStatus: adv.status, frejStatus: frej.status, frejReason: frej.reason, seenN: (seen.p1 || []).length } });
})()`,
  sandbox,
);

const r = JSON.parse(resultText);
const fails = [];
if (!r.exports.includes('Match') || !r.exports.includes('computeVisibility'))
  fails.push('missing exports: ' + r.exports.join(','));
for (let k = 1; k < r.snaps.length; k += 1) {
  if (canon(r.snaps[k]) !== canon(state.snapshots[k])) fails.push(`snapshot ${k} differs`);
}
if (r.outcomes.length !== state.outcomes.length)
  fails.push(`outcomes: ${r.outcomes.length} vs ${state.outcomes.length}`);
r.outcomes.forEach((o, k) => {
  if (canon(o) !== canon(state.outcomes[k])) fails.push(`outcome ${k + 1} differs`);
});
if (r.events.length !== state.events.length)
  fails.push(`events: ${r.events.length} vs ${state.events.length}`);
r.events.forEach((e, k) => {
  if (canon(e) !== canon(state.events[k])) fails.push(`event ${k} differs`);
});
if (r.badMove.status !== 'rejected' || !r.badMove.reason)
  fails.push('illegal move not rejected: ' + JSON.stringify(r.badMove));
if (r.fork.advStatus !== 'applied') fails.push('fork advance not applied: ' + r.fork.advStatus);
if (r.fork.frejStatus !== 'rejected' || !r.fork.frejReason)
  fails.push('fork illegal move not rejected: ' + JSON.stringify(r.fork));
if (!(r.fork.seenN > 0)) fails.push('fork fog empty');

if (fails.length > 0) {
  console.error('BUNDLE VERIFY FAILED:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log(
  `bundle replay identical: ${r.snaps.length} snapshots, ${r.outcomes.length} outcomes, ${r.events.length} events`,
);
console.log(
  `fork test: advance=${r.fork.advStatus}, illegal=${r.fork.frejStatus} ("${r.fork.frejReason}"), fog cells=${r.fork.seenN}`,
);
console.log('BUNDLE VERIFY PASS');
