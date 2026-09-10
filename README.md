# AI WARLORDS

Deterministic strategy game with AI commanders. Built one verified module at a time —
see `docs/MODULE_STATUS.md` for the current phase.

> Methodology: `REAL > FUNCTIONAL > VERIFIABLE > SECURE > PERFORMANT > SCALABLE > FEATURE-RICH`.
> One module. One goal. Tests. Attack. Fix. Audit. Gate. Only then the next.

## Prerequisites

- Node.js 20+ (`nvm use`, see `.nvmrc`; `engines` field enforced by contract test)
- npm (ships with Node)

No Docker, no database, no external services required (as of Fase 0).

## Setup

```bash
npm ci        # reproducible install from package-lock.json
npm test      # full suite + coverage gates
npm run lint  # ESLint, zero warnings allowed
npm run typecheck
npm run build # emits dist/
```

## Run

```bash
npm run dev   # dev server with watch (default http://127.0.0.1:3000/health)
npm start     # run the compiled build from dist/
```

Environment (`HOST`, `PORT`) is read from ambient variables — see `.env.example`.
M002 deliberately does not auto-load `.env` (zero-dependency policy):

```bash
HOST=0.0.0.0 PORT=3000 npm run dev
```

## Project layout

```text
src/            TypeScript sources (+ colocated *.test.ts)
src/dev-server.ts  M002 dev scaffold (NOT the game server — no API contract)
dist/           compiled output (gitignored, rebuilt by `npm run build`)
docs/           audit, architecture, stack, risks, module status, test policy
docs/modules/   per-module contract + analysis + execution record
```

## Docs

- `docs/PROJECT_AUDIT.md` — M001 repository audit (GREENFIELD)
- `docs/ARCHITECTURE.md` — current (none yet) + target architecture (planned)
- `docs/TECH_STACK.md` — stack decision and requirements
- `docs/DEPENDENCIES.md` — dependency inventory (all capabilities UNKNOWN until verified)
- `docs/RISK_REGISTER.md` — risk register
- `docs/MODULE_STATUS.md` — official status of all M001–M165
- `docs/TESTING.md` — test policy (categories, negative tests, coverage, mocks)
- `docs/modules/Mxxx.md` — per-module execution records
