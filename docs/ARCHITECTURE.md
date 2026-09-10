# AI WARLORDS — ARCHITECTURE (M007)

> Authority kernel: `EXISTS` (M003 — VERIFIED)
> World state + views: `EXISTS` (M004 — VERIFIED)
> Deterministic match: `EXISTS` (M005 — VERIFIED)
> Action validation: `EXISTS` (M006 — VERIFIED)
> Event system: `EXISTS` (M007 — VERIFIED)
> Domínio do jogo (mapa, economia, militar, AI): `NONE` (M008+)
> Arquitectura-alvo: `PLANNED` (transcrita do documento-mestre)
> Data: 2026-09-10

---

## 1. Arquitectura actual

```text
src/engine/authority.ts    — AuthorityKernel<S> (sole writer, VERIFIED)
src/engine/harness.ts      — domínio harness noop/harvest (prova, não é o jogo)
src/engine/world-state.ts  — WorldState v1 + guard + world.noop (VERIFIED)
src/engine/views.ts        — WORLD/AI/CLIENT views (VERIFIED)
src/engine/match.ts        — Match: proveniência + tick + timeline (VERIFIED)
src/engine/rng.ts          — SeededRng + streams deriveSeed (VERIFIED)
src/engine/hash.ts         — stableStringify + sha256 (VERIFIED)
src/engine/validation.ts   — pré-regras + pós-invariantes + wrap (VERIFIED)
src/engine/events.ts       — factos de domínio + surrogates (VERIFIED)
```

Sem frontend, backend de jogo, database ou serviços. Todo o domínio futuro
pluga handlers no kernel via `Match(extraHandlers)` — validados no registo e
embrulhados (pré-regras, RNG por dispatch, pós-invariantes) — estende
WorldState via bumps versionados e observa via `Match(extraProducers)`.
Seed explícita e activa; roster == mundo; eventos reconstruíveis.

## 2. Arquitectura-alvo (PLANNED — fonte: documento-mestre §12)

```text
PLAYER → COMMAND INTERPRETER → COMMAND INTENT → COMMAND POLICY
 → AI PERCEPTION → AI MEMORY → STRATEGIC ENGINE → TACTICAL ENGINE
 → RISK ENGINE → COUNTERFACTUAL SIMULATION → AI REFUTATION
 → ACTION PROPOSAL → ACTION VALIDATOR → GAME ENGINE → WORLD STATE
 → EVENT SYSTEM → REPLAY → ANALYTICS
```

Invariantes em vigor: AI propõe / servidor valida / engine executa (§12);
cliente nunca é fonte de verdade (§23); ENGINE=FACTS, AI=DECISIONS,
LLM=LANGUAGE (§22); jogo funciona sem LLM (§20); separação
WORLD≠AI≠CLIENT imposta por construção — kinds nominais (M004);
determinismo end-to-end provado — timeline+hash+goldens (M005);
output de handlers re-guardado — shape/roster/tick/size (M006);
factos de domínio emitidos — observação nunca parte execução (M007);
chain nunca substitui o engine (M101); dinheiro só após gate Fase 28.

## 3. Mapa de fases → camadas (PLANNED)

| Fase(s) | Camada                      | Módulos                          |
| ------- | --------------------------- | -------------------------------- |
| 0       | Foundation                  | M001–M002 (VERIFIED)             |
| 1       | Game Engine                 | M003–M007 (VERIFIED) → M008–M009 |
| 2       | World                       | M010–M015                        |
| 3–4     | Economy + Military          | M016–M026                        |
| 5–8     | AI Foundation → Commands    | M027–M045                        |
| 9–16    | Refutation → AI Arena       | M046–M068                        |
| 17–20   | Multiplayer → Observability | M069–M093                        |
| 21–22   | Economic sim → Free mode    | M094–M097                        |
| 23–28   | Solana → Rewards            | M098–M124 (+gates)               |
| 29–36   | Advanced                    | M125–M165                        |

## 4. Decisões pendentes (`UNKNOWN` até ao módulo próprio)

- [ ] Protocolo cliente↔servidor (M003/M069; não assumir WS/REST)
- [ ] Motor de persistência (M007 in-memory; M062 bounds log/timeline/events — L-09)
- [ ] Monorepo vs single-package (single até justificação — M002)
- [ ] Formato de mapa autoritativo (M010 gate; shortlist Tiled/LDtk em TOOLS.md)
- [ ] Match lifecycle (M071) tem de preservar dispatch SERIAL (constraint M003)
- [ ] Lifecycle (M071) estende o invariante roster (membership) sem o contornar
- [x] Linguagem/stack base (M002: TypeScript/Node — VERIFIED)
- [x] Mecanismo de autoridade (M003: kernel — VERIFIED)
- [x] Estado oficial + separação de vistas (M004: WorldState v1 — VERIFIED)
- [x] Determinismo end-to-end (M005: timeline+hash+goldens — VERIFIED)
- [x] Validador de acções (M006: pré+pós+streams — VERIFIED)
- [x] Sistema de eventos (M007: factos+surrogates — VERIFIED)

## 5. Repo layout (actual, M007)

```text
ai-warlords/
  package.json / package-lock.json  scripts + deps pinned (intocados M003–M007)
  tsconfig.json / tsconfig.build.json
  vitest.config.ts / eslint.config.js / .prettierrc.json
  src/
    health.ts / dev-server.ts / dev.ts   scaffold M002 (sem contrato)
    engine/
      authority.ts      kernel de autoridade (VERIFIED, load-bearing)
      harness.ts        domínio harness (prova; substituível, sem contrato)
      world-state.ts    WorldState v1 + guard (VERIFIED, load-bearing)
      views.ts          WORLD/AI/CLIENT (VERIFIED, load-bearing)
      match.ts          match determinístico (VERIFIED, load-bearing)
      rng.ts            RNG + streams por dispatch (VERIFIED, load-bearing)
      hash.ts           serialização estável + sha256 (VERIFIED, load-bearing)
      validation.ts     validador de acções (VERIFIED, load-bearing)
      events.ts         sistema de eventos (VERIFIED, load-bearing)
      *.test.ts         256 testes colocados
    *.test.ts           28 testes M002 (regressão)
  dist/              build (gitignored)
  docs/              audit, stack, riscos, status, tools, política de testes
  docs/modules/      registos por módulo (M002.md … M007.md)
```

AVISOS: `src/dev-server.ts` (M002) e `src/engine/harness.ts` (M003) são
provas sem contrato. `WorldState.secrets` é placeholder de mecanismo M004
(morre até M015). Streams RNG wired mas sem consumidor de domínio.
Load-bearing: authority, world-state, views, match, rng, hash, validation,
events.

## 6. Registo de alterações

| Data       | Módulo | Alteração                                                   |
| ---------- | ------ | ----------------------------------------------------------- |
| 2026-09-10 | M001   | Criação inicial: estado NONE + alvo PLANNED                 |
| 2026-09-10 | M002   | Layout do repo + aviso anti-contrato do scaffold            |
| 2026-09-10 | M003   | Kernel de autoridade EXISTS; layout engine; constraint M071 |
| 2026-09-10 | M004   | WorldState v1 + vistas EXISTS; gate formato→M010; TOOLS.md  |
| 2026-09-10 | M005   | Match determinístico EXISTS; goldens; seed explícita        |
| 2026-09-10 | M006   | Validador EXISTS; pós-invariantes; streams; registo detido  |
| 2026-09-10 | M007   | Eventos EXISTS; geneses+factos+surrogates; restrição prova  |
