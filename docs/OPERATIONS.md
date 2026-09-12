# OPERATIONS — AI-WARLORDS runbook (M093, D-088; auditado pós-M097)

Live services (Render, free tier):

- Static: <https://ai-warlords.onrender.com/match.html>
  (page + embedded engine; size pinned per deploy,
  e.g. 576520 B @ M097).
- API: <https://ai-warlords-api.onrender.com>
  (transport; `srv-daigtf95efls73dfpang`).
- `render.yaml` declares both, but a standalone
  static site is NEVER auto-provisioned from yaml
  alone — create it in the dashboard once.

API endpoints (all JSON; CORS `*`):

- `GET /` → `{service:'ai-warlords',
  ok:true}`.
- `GET /matches` → lobby listing
  ([{matchId, players, …}] —
  transport.ts:311).
- `GET /healthz` → inventory (uptime, matches,
  streams, results, ratings, window).
- `GET /metrics` → {requests, byStatus,
  startedAt, uptimeMs} (quirk M088: a
  própria leitura conta em requests,
  nunca em byStatus).
- `POST /match {seed?, mode?}` → forge
  (blind reseat; mode standard/free,
  400 'bad mode').
- `POST /match/:id/join {playerId}` → session.
- `POST /match/:id/dispatch {sessionId,
  requestId, type, payload}` → applied/rejected.
- `GET /match/:id/state` → snapshot (prompts,
  units, rev).
- `POST /match/:id/close {}` → standard:
  results+ratings; free: void total
  (sem rasto — M096, R-32).
- `GET /match/:id/events?from=N` → SSE
  (cap 32, else 503).
- `GET /results` → history (FIFO cap 50).
- `GET /ratings` → Elo map (finished-only).

Limits (all live-proven):

- Rate: 300 req / 60 s GLOBAL window → 429
  (per-IP keying DEAD: Cloudflare+Render fan out
  XFF; shared bucket includes Render health
  checks — D-076).
- Bodies: 64 KB cap → 413 (D-077).
- Watchers: 32 streams → 503 on 33rd (D-080).
- Errors: generic 500 (`transport fault`),
  27 call-sites / 16 strings distintas
  (M087 contou 26 sites; +1 'bad mode'
  M096; públicas by design — D-082).
- Headers (API): nosniff + DENY on all
  responses. STATIC headers BLOQUEADO
  (dashboard-only): Dashboard → ai-warlords
  (static) → Headers → Add `/*`:
  X-Frame-Options=DENY,
  Referrer-Policy=same-origin (30 s, D-078;
  nosniff já live, audit pós-M097 —
  DENY+Referrer pendentes).

Env vars:

- `PORT` (default 3000; Render injects).
- `AW_LOG=1` (set in serve.ts; JSONL access
  lines on stdout, no IP — dashboard-only).
- `AW_API` (drill base URL override;
  default = prod API).

Deploy:

- Push to `main` → Render auto-builds both
  services. Builds take 30 s–14 min: poll
  `GET /deploys` (Render REST; key at
  `~/.config/render/api_key`, never commit)
  — never assume.
- Node: `.nvmrc` 20, engines `>=20.10.0
  <21.0.0`, engine-strict (D-081).

Post-deploy gate (every module):

1. Static: exact byte size + markers
   (`ai.assessment`×3, `cmdWait`×2,
   `netPulse`×3, `netMode`×2).
2. API: `npm run drill:prod` → DRILL PASS.

Local dev:

- `npm ci` (sandbox wipes node_modules often;
  also restores git identity/remote as needed).
- `npm test` (vitest + coverage 100; gate is
  4 seeds 74–77 — script is `test`, NOT
  `test:run`; use `set -o pipefail`, M092;
  suite/spawns largam tsx órfãos — se OOM,
  `pkill -f tsx/dist/loader` e re-correr).
- `npm run sim` (4× goldens), `npm run
  smoke:api` (page E2E), `npm run engine`
  (rebuild bundle; entry is
  tools/browser-engine.ts, builder is
  tools/build-engine.mjs).
- Secrets: deploy key
  `~/.ssh/ai_warlords_deploy` (chmod 600);
  never commit keys.

Review this file once per block (it rots).
