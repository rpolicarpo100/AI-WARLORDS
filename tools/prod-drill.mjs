/**
 * M092 — post-deploy drill: exercises the LIVE transport end to end
 * (health → forge → join ×2 → noop → attack → move → state → board →
 * close → healthz) and asserts every shape. Cleans up after itself
 * (the drilled table closes; trace: one void history entry).
 * Hits production by design (AW_API overrides the base URL).
 * Verified by running (tools/ mold — no vitest).
 */
const API = process.env['AW_API'] ?? 'https://ai-warlords-api.onrender.com';

function fail(label, detail) {
  console.error(`DRILL FAIL: ${label}${detail === undefined ? '' : ` (${detail})`}`);
  process.exit(1);
}

function shape(value, label) {
  if (value === undefined || value === null) {
    fail('missing', label);
  }
  return value;
}

async function get(path) {
  const res = await globalThis.fetch(`${API}${path}`);
  return { code: res.status, json: await res.json() };
}

async function post(path, body) {
  const res = await globalThis.fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { code: res.status, json: await res.json() };
}

const health = await get('/');
if (health.code !== 200 || health.json.ok !== true) fail('health', health.code);

const forged = await post('/match', { seed: 92 });
if (forged.code !== 200) fail('forge', forged.code);
const matchId = shape(forged.json.matchId, 'matchId');

const p1 = await post(`/match/${matchId}/join`, { playerId: 'p1' });
const p2 = await post(`/match/${matchId}/join`, { playerId: 'p2' });
if (p1.code !== 200 || p2.code !== 200) fail('join', `${p1.code}/${p2.code}`);
const s1 = shape(p1.json.sessionId, 's1');

const noop = await post(`/match/${matchId}/dispatch`, {
  sessionId: s1,
  requestId: 'drill-noop',
  type: 'world.noop',
  payload: {},
});
if (noop.code !== 200 || noop.json.status !== 'applied') fail('noop', noop.json.status);

const attack = await post(`/match/${matchId}/dispatch`, {
  sessionId: s1,
  requestId: 'drill-attack',
  type: 'unit.attack',
  payload: { id: 'u1', target: 'u2' },
});
if (attack.code !== 200 || attack.json.status !== 'applied') fail('attack', attack.json.status);

const move = await post(`/match/${matchId}/dispatch`, {
  sessionId: s1,
  requestId: 'drill-move',
  type: 'unit.move',
  payload: { id: 'u1', col: 1, row: 1 },
});
if (move.code !== 200 || move.json.status !== 'applied') fail('move', move.json.status);

const snap = await get(`/match/${matchId}/state`);
const left = snap.json.prompts.remaining;
if (snap.code !== 200 || left.p1 !== 7 || left.p2 !== 10) fail('state', JSON.stringify(left));

const ratings = await get('/ratings');
if (ratings.code !== 200 || typeof ratings.json !== 'object') fail('ratings', ratings.code);
const history = await get('/results');
if (history.code !== 200 || !Array.isArray(history.json)) fail('results', history.code);

const closed = await post(`/match/${matchId}/close`, {});
if (closed.code !== 200 || closed.json.closed !== true) fail('close', closed.code);

const healthz = await get('/healthz');
if (healthz.code !== 200 || healthz.json.ok !== true) fail('healthz', healthz.code);

console.log('DRILL PASS (health → forge → join → noop → attack → move → state → board → close)');
