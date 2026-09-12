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
    get firstChild() {
      return this.children[0] || null;
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
// Frozen clock for page toasts (IIFE parameter only — the REAL global
// setTimeout stays: node fetch (API_TEST) needs unref-able timeouts).
const timeoutStub = () => 0;
let nowMs = 1000;
// Manual clock for the page loop (IIFE parameter only — the REAL global
// performance stays: node fetch (API_TEST) needs markResourceTiming).
const perfStub = { now: () => nowMs };

const html = readFileSync(new URL('../mockups/match.html', import.meta.url), 'utf8');
const m = html.match(/<script>const SCENARIO = (\{.*?\});<\/script>/s);
if (!m) throw new Error('state blob not found');
const blocks = [...html.matchAll(/<script>(.*?)<\/script>/gs)].map((x) => x[1]);
const iife = blocks[blocks.length - 1];
const SCENARIO = JSON.parse(m[1].replace(/<\\\//g, '</'));
console.log('snapshots:', SCENARIO.snapshots.length, 'events:', SCENARIO.events.length);
// Regression guard: duplicate element IDs once hid the whole page behind a
// dead SVG (its CSS turned it into a viewport-covering opaque layer).
const markupOnly = html.replace(/<script>.*?<\/script>/gs, '');
const ids = [...markupOnly.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length > 0) throw new Error('duplicate IDs in markup: ' + [...new Set(dupes)].join(','));
console.log('markup IDs unique:', ids.length);
const heraldSeen = [];
if (process.env.ATTACK_TEST) {
  // ATTACK_TEST=1: loads the REAL engine bundle (like a browser would — no TEST MOCK)
  // and injects synthetic unit.attacked events (crash-path only, authored for the harness).
  const bundleText = readFileSync(new URL('./engine.bundle.js', import.meta.url), 'utf8');
  globalThis.AIWLEngine = new Function(`${bundleText};return AIWLEngine;`)();
  const h = mkEl('#herald');
  let cur = '';
  Object.defineProperty(h, 'textContent', {
    set(v) {
      cur = String(v);
      heraldSeen.push(cur);
    },
    get() {
      return cur;
    },
  });
  byId['herald'] = h;
  SCENARIO.events.push(
    {
      revision: 5,
      type: 'unit.attacked',
      payload: { player: 'p1', unit: 'u1', target: 'u3', damage: 4 },
    },
    {
      revision: 6,
      type: 'unit.attacked',
      payload: { player: 'p1', unit: 'u2', target: 'u4', damage: 3 },
    },
  );
  SCENARIO.snapshots.forEach((s, k) => {
    const u = (s.units.units || []).find((x) => x.id === 'u4');
    if (u && k === 5) u.hp = 3;
    if (u && k > 5) u.hp = 0;
  });
  console.log('attack injection armed (revs 5/6, u4 DOWN from rev 6)');
}
if (process.env.ARENA_TEST && !globalThis.AIWLEngine) {
  // ARENA_TEST=1: loads the REAL engine bundle (like a browser would — no TEST MOCK)
  // so the Arena panel runs genuine self-play.
  const bundleText = readFileSync(new URL('./engine.bundle.js', import.meta.url), 'utf8');
  globalThis.AIWLEngine = new Function(`${bundleText};return AIWLEngine;`)();
  console.log('arena engine armed (real bundle, like a browser)');
}

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
  timeoutStub,
  perfStub,
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
fire('vHeat', 'click');
fire('tCmd', 'click');
for (const id of [
  'cmdGather',
  'cmdAttack',
  'cmdHouse',
  'cmdTower',
  'cmdStorage',
  'cmdWait',
  'cmdUpgrade',
])
  fire(id, 'click');
fire('tArena', 'click');
fire('arenaRun', 'click');
globalThis.document.getElementById('apiUrl').value = 'http://127.0.0.1:1/';
fire('tOnline', 'click');
for (const id of ['netLobby', 'netForge', 'netJoin', 'netNoop', 'netAttack', 'netMove', 'netStop'])
  fire(id, 'click');
fire('tMute', 'click');
fire('tMute', 'click');
fire('tRain', 'click');
for (let i = 0; i < 10; i++) {
  nowMs += 100;
  rafCb(nowMs);
}
fire('tRain', 'click');
fire('mini', 'click', { clientX: 100, clientY: 50 });
fire('prog', 'click', { clientX: 600 });
fire('iso', 'click', { clientX: 600, clientY: 350 });
fire('iso', 'mousemove', { clientX: 100, clientY: 100 });
fire('iso', 'mousemove', { clientX: 400, clientY: 300 });
fire('iso', 'mouseleave', {});
for (let i = 0; i < 30; i++) {
  nowMs += 100;
  rafCb(nowMs);
}
console.log('controls OK');
if (process.env.ATTACK_TEST) {
  const saw = (s) => heraldSeen.some((t) => t.includes(s));
  if (!saw('u1 struck u3 for 4'))
    throw new Error('attack feedback missing: ' + JSON.stringify(heraldSeen.slice(-4)));
  if (!saw('u2 struck u4 for 3! DOWN!')) throw new Error('killing-blow feedback missing');
  console.log('attack feedback OK (clash + twang + horn + DOWN heralded)');
  // FASE B E2E: real Command fork at rev 5 (u4 is DOWN from rev 6 by the
  // attack injection), real selection, armed attack via
  // the Attack button, real unit.attack dispatch, real transition feedback,
  // local-order highlight. Pair + damage derived from SCENARIO (no hardcode).
  {
    const E = globalThis.AIWLEngine;
    if (byId['cmdbar'].hidden === false) fire('tCmd', 'click'); // release controls-phase fork (restores 16 snapshots)
    if (byId['cmdbar'].hidden !== true) throw new Error('FASEB E2E: release failed');
    const st15 = SCENARIO.snapshots[5];
    const us = (st15.units && st15.units.units) || [];
    let atk = null,
      foe = null;
    for (const a of us) {
      if (a.owner !== 'p1' || a.hp <= 0) continue;
      const nbs = new Set(E.neighborsOf(st15.map, a.col, a.row).map((c) => c.col + ',' + c.row));
      const f = us.find((b) => b.owner !== a.owner && b.hp > 0 && nbs.has(b.col + ',' + b.row));
      if (f) {
        atk = a;
        foe = f;
        break;
      }
    }
    if (!atk) throw new Error('FASEB E2E: no adjacent p1/enemy pair at rev 5');
    const expDmg = ((SCENARIO.configs.unitsScenario || {})[atk.type] || {}).damage;
    if (!(expDmg > 0)) throw new Error('FASEB E2E: attacker damage unknown');
    if (foe.hp <= expDmg * 2) throw new Error('FASEB E2E: target too frail for 2 hits');
    // Mirror of layout()/center() projection for the 1200x700 stub canvas.
    // Constants (sqrt3, squash, margins) match the page; drift fails loudly.
    const cells0 = SCENARIO.snapshots[0].map.cells;
    const W = Math.max(...cells0.map((c) => c.col)) + 1;
    const H = Math.max(...cells0.map((c) => c.row)) + 1;
    const SQ3 = Math.sqrt(3),
      SQUASH = 0.56,
      cw = 1200,
      ch = 700;
    const s = Math.min(cw / (SQ3 * (W - 0.5) + 1.9), ch / (1.5 * (H - 1) * SQUASH + 4.9));
    const ox = cw / 2 - (s * SQ3 * (W - 0.5)) / 2;
    const oy = ch / 2 - (s * (-3.4 + 1.5 * (H - 1) * SQUASH + 1.5)) / 2;
    const px = (c, r) => [ox + s * SQ3 * (c + 0.5 * (r & 1)), oy + s * 1.5 * r * SQUASH];
    const pump = (n) => {
      for (let i = 0; i < n; i++) {
        nowMs += 100;
        rafCb(nowMs);
      }
    };
    const orderBtns = () => created.filter((e) => e.dataset.k && e.__listeners.click);
    const seekers = orderBtns().filter((e) => e.dataset.k === '5');
    for (const fn of seekers[seekers.length - 1].__listeners.click) fn(); // seek rev 15
    fire('tCmd', 'click');
    if (byId['cmdbar'].hidden !== false) throw new Error('FASEB E2E: command mode did not engage');
    const toastEl = byId['toast'];
    const [ax, ay] = px(atk.col, atk.row);
    fire('iso', 'click', { clientX: ax, clientY: ay });
    if (!toastEl.textContent.includes(atk.id) || !/selected/.test(toastEl.textContent))
      throw new Error('FASEB E2E: attacker not selected: ' + toastEl.textContent);
    fire('cmdAttack', 'click');
    if (!/ready \u2014 click an adjacent enemy/.test(toastEl.textContent))
      throw new Error('FASEB E2E: arming toast missing: ' + toastEl.textContent);
    if (byId['iso'].style.cursor !== 'crosshair')
      throw new Error('FASEB E2E: cursor not crosshair when armed');
    const [ex, ey] = px(foe.col, foe.row);
    let hn = heraldSeen.length;
    fire('iso', 'click', { clientX: ex, clientY: ey });
    if (!toastEl.textContent.startsWith('✓'))
      throw new Error('FASEB E2E: attack not applied: ' + toastEl.textContent);
    pump(60);
    const struck1 = heraldSeen.slice(hn).find((t) => t.includes('struck') && t.includes(atk.id));
    if (
      !struck1 ||
      !struck1.includes(atk.id) ||
      !struck1.includes(foe.id) ||
      !struck1.includes(`for ${expDmg}`)
    )
      throw new Error('FASEB E2E: struck feedback wrong: ' + JSON.stringify(heraldSeen.slice(hn)));
    if (byId['iso'].style.cursor !== 'default')
      throw new Error('FASEB E2E: still armed after applied attack');
    const obs = orderBtns();
    const last = obs[obs.length - 1];
    if (!String(last.className).includes('local'))
      throw new Error('FASEB E2E: local order not highlighted');
    if (String(obs[0].className).includes('local'))
      throw new Error('FASEB E2E: chronicle order wrongly marked local');
    hn = heraldSeen.length; // unarmed click-attack (pre-existing path, first coverage)
    fire('iso', 'click', { clientX: ex, clientY: ey });
    pump(60);
    if (!heraldSeen.slice(hn).some((t) => t.includes('struck') && t.includes(atk.id)))
      throw new Error('FASEB E2E: unarmed click-attack produced no struck feedback');
    fire('tCmd', 'click');
    if (byId['cmdbar'].hidden !== true) throw new Error('FASEB E2E: final release failed');
    console.log(
      `FASEB E2E OK (${atk.id} x ${foe.id}, dmg ${expDmg}, armed + unarmed + local orders)`,
    );
  }
}
if (process.env.ARENA_TEST) {
  const out = (byId['arenaOut'] && byId['arenaOut'].textContent) || '';
  if (!out.includes('lances=') || !out.includes('scores:') || !out.includes('rank:'))
    throw new Error('arena output missing: ' + JSON.stringify(out));
  fire('arenaRun', 'click');
  const first = byId['arenaOut'].textContent;
  fire('arenaRun', 'click');
  if (byId['arenaOut'].textContent !== first) throw new Error('arena nondeterministic');
  console.log('arena E2E OK (' + out.split('\n').slice(0, 3).join(' | ') + ')');
}
if (process.env.API_TEST) {
  // API_TEST=1: boots the REAL transport (tsx child, like serve.test.ts — no
  // TEST MOCK) and drives the full online flow through the page client.
  const { spawn } = await import('node:child_process');
  const { setTimeout: sleep } = await import('node:timers/promises');
  const { setTimeout: realTimeout, clearTimeout: realClear } = await import('node:timers');
  const child = spawn('npx', ['--no-install', 'tsx', 'src/server/serve.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group: SIGTERM reaps npx AND the server
  });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    const timer = realTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill();
      }
      reject(new Error('api test: no listen URL: ' + out));
    }, 30000);
    child.stdout.on('data', (c) => {
      out += c;
      const m = /listening on (http:\/\/\S+)/.exec(out);
      if (m) {
        realClear(timer);
        resolve(m[1]);
      }
    });
    child.on('error', reject);
  });
  try {
    globalThis.document.getElementById('apiUrl').value = url;
    globalThis.document.getElementById('netSide').value = 'p1';
    globalThis.document.getElementById('netUnit').value = 'u1';
    globalThis.document.getElementById('netTarget').value = 'u2';
    const out = () => byId['netOut'].textContent;
    const waitOut = async (needle, label) => {
      for (let i = 0; i < 200; i += 1) {
        if (out().includes(needle)) return;
        await sleep(25);
      }
      throw new Error(`api test: ${label} missing in: ${JSON.stringify(out())}`);
    };
    fire('netLobby', 'click');
    await waitOut('lobby: 0 table(s)', 'empty lobby');
    fire('netForge', 'click');
    await waitOut('forged ', 'forge line');
    const mid = /forged (\S+)/.exec(out())[1];
    fire('netJoin', 'click');
    await waitOut('joined p1', 'join line');
    await waitOut('event: ', 'backlog event over SSE');
    fire('netNoop', 'click');
    await waitOut('dispatch: applied rev 1', 'noop outcome');
    fire('netAttack', 'click');
    await waitOut('event: unit.attacked', 'live attack event');
    globalThis.document.getElementById('netTo').value = 'bogus';
    fire('netMove', 'click');
    await waitOut('dest must be col,row', 'bad dest hint');
    globalThis.document.getElementById('netUnit').value = 'u1';
    globalThis.document.getElementById('netTo').value = '1,1';
    fire('netMove', 'click');
    await waitOut('dispatch: applied rev 3', 'move outcome');
    await waitOut('event: unit.moved', 'live move event');
    fire('netStop', 'click');
    await waitOut('watch stopped', 'stop line');
    const closed = await globalThis.fetch(`${url}/match/${mid}/close`, { method: 'POST' });
    if (!closed.ok) throw new Error('api test: close failed');
    console.log('online E2E OK (lobby → forge → join → noop → attack → sse → stop)');
  } finally {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    child.stdout.destroy();
    child.stderr.destroy();
  }
}
console.log('HARNESS PASS');
