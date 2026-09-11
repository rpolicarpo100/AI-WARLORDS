// Headless smoke test for mockups/match.html: stubs DOM + Canvas2D,
// runs the page IIFE, sweeps all 16 keyframes, clicks every control.
// Run: npm run smoke. Node-only, no deps. (Procedural-fallback path:
// no Image/AudioContext/AIWLEngine here, like a minimal browser.)
import { readFileSync } from 'node:fs';

const mkCtx = () =>
  new Proxy(
    {},
    {
      get: (t, p) => {
        if (p === 'measureText') return () => ({ width: 50 });
        if (p === 'createRadialGradient' || p === 'createLinearGradient' || p === 'createPattern')
          return () => ({ addColorStop() {} });
        if (typeof p === 'symbol' || p in t) return t[p];
        return () => undefined;
      },
      set: (t, p, v) => {
        t[p] = v;
        return true;
      },
      has: () => true,
    },
  );
const created = [];
function mkEl(tag) {
  const el = {
    tag,
    children: [],
    style: {},
    dataset: {},
    __listeners: {},
    width: 0,
    height: 0,
    hidden: false,
    value: '',
    title: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(ev, fn) {
      (this.__listeners[ev] = this.__listeners[ev] || []).push(fn);
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
    },
    remove() {},
    getBoundingClientRect: () => ({ width: 1200, height: 700, left: 0, top: 0 }),
    getContext: () => mkCtx(),
    querySelector: () => null,
    querySelectorAll: () => [],
    set innerHTML(v) {
      this._html = v;
    },
    get innerHTML() {
      return this._html || '';
    },
    set textContent(v) {
      this._text = v;
    },
    get textContent() {
      return this._text || '';
    },
  };
  created.push(el);
  return el;
}
const byId = {};
let rafCb = null;
globalThis.document = {
  getElementById: (id) => (byId[id] = byId[id] || mkEl('#' + id)),
  createElement: (tag) => mkEl(tag),
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
globalThis.requestAnimationFrame = (cb) => {
  rafCb = cb;
};
globalThis.setTimeout = () => 0;
let nowMs = 1000;
globalThis.performance = { now: () => nowMs };

const html = readFileSync(new URL('../mockups/match.html', import.meta.url), 'utf8');
const m = html.match(/<script>const SCENARIO = (\{.*?\});<\/script>/s);
if (!m) throw new Error('state blob not found');
const blocks = [...html.matchAll(/<script>(.*?)<\/script>/gs)].map((x) => x[1]);
const iife = blocks[blocks.length - 1];
const SCENARIO = JSON.parse(m[1].replace(/<\\\//g, '</'));
console.log('snapshots:', SCENARIO.snapshots.length, 'events:', SCENARIO.events.length);

const run = new Function(
  'SCENARIO',
  'window',
  'document',
  'requestAnimationFrame',
  'setTimeout',
  'performance',
  iife,
);
run(
  SCENARIO,
  globalThis.window,
  globalThis.document,
  globalThis.requestAnimationFrame,
  globalThis.setTimeout,
  globalThis.performance,
);
console.log('IIFE top-level OK; raf captured:', typeof rafCb);

for (let i = 0; i < 400; i++) {
  nowMs += 100;
  rafCb(nowMs);
}
console.log('sweep 0->15 OK (400 frames, all transitions fired)');

const orders = created.filter((e) => e.dataset.k && e.__listeners.click);
console.log('order buttons:', orders.length);
for (const o of orders) {
  for (const fn of o.__listeners.click) fn();
  nowMs += 50;
  rafCb(nowMs);
}
console.log('orders seek OK');

const fire = (id, ev, arg) => {
  const el = byId[id];
  if (el && el.__listeners[ev]) for (const fn of el.__listeners[ev]) fn(arg || {});
};
fire('tPlay', 'click');
fire('tPlay', 'click');
fire('tStart', 'click');
fire('tBack', 'click');
fire('tFwd', 'click');
fire('speed', 'change', { target: { value: '2' } });
fire('vFog', 'click');
fire('vFull', 'click');
fire('vFog', 'click');
fire('tCmd', 'click');
for (const id of ['cmdGather', 'cmdHouse', 'cmdTower', 'cmdStorage', 'cmdAdvance', 'cmdUpgrade'])
  fire(id, 'click');
fire('tMute', 'click');
fire('tMute', 'click');
fire('prog', 'click', { clientX: 600 });
fire('iso', 'click', { clientX: 600, clientY: 350 });
fire('iso', 'mousemove', { clientX: 100, clientY: 100 });
fire('iso', 'mouseleave', {});
for (let i = 0; i < 30; i++) {
  nowMs += 100;
  rafCb(nowMs);
}
console.log('controls OK');
console.log('HARNESS PASS');
