# AI WARLORDS — ARCHITECTURE (M003)

> Authority kernel: `EXISTS` (M003 — VERIFIED)
> Domínio do jogo (world, units, economy, AI): `NONE` (M004+)
> Arquitectura-alvo: `PLANNED` (transcrita do documento-mestre)
> Data: 2026-09-10

---

## 1. Arquitectura actual

```text
src/engine/authority.ts  — AuthorityKernel<S> (sole writer, VERIFIED)
src/engine/harness.ts    — domínio harness noop/harvest (prova, não é o jogo)
```

Sem frontend, backend de jogo, database ou serviços. O kernel é o único
escritor de estado canónico; todo o domínio futuro pluga handlers nele
(constraint M003 §12).

## 2. Arquitectura-alvo (PLANNED — fonte: documento-mestre §12)

```text
PLAYER → COMMAND INTERPRETER → COMMAND INTENT → COMMAND POLICY
 → AI PERCEPTION → AI MEMORY → STRATEGIC ENGINE → TACTICAL ENGINE
 → RISK ENGINE → COUNTERFACTUAL SIMULATION → AI REFUTATION
 → ACTION PROPOSAL → ACTION VALIDATOR → GAME ENGINE → WORLD STATE
 → EVENT SYSTEM → REPLAY → ANALYTICS
```

Invariantes (contrato, em vigor desde M003 para o mecanismo): AI propõe /
servidor valida / engine executa (§12); cliente nunca é fonte de verdade
(§23, provado no harness); ENGINE=FACTS, AI=DECISIONS, LLM=LANGUAGE (§22);
jogo funciona sem LLM (§20); WORLD≠PERCEPÇÃO≠CLIENTE (M004/M015); chain
nunca substitui o engine (M101); dinheiro só após gate Fase 28.

## 3. Mapa de fases → camadas (PLANNED)

| Fase(s) | Camada                      | Módulos                     |
| ------- | --------------------------- | --------------------------- |
| 0       | Foundation                  | M001–M002 (VERIFIED)        |
| 1       | Game Engine                 | M003 (VERIFIED) → M004–M009 |
| 2       | World                       | M010–M015                   |
| 3–4     | Economy + Military          | M016–M026                   |
| 5–8     | AI Foundation → Commands    | M027–M045                   |
| 9–16    | Refutation → AI Arena       | M046–M068                   |
| 17–20   | Multiplayer → Observability | M069–M093                   |
| 21–22   | Economic sim → Free mode    | M094–M097                   |
| 23–28   | Solana → Rewards            | M098–M124 (+gates)          |
| 29–36   | Advanced                    | M125–M165                   |

## 4. Decisões pendentes (`UNKNOWN` até ao módulo próprio)

- [ ] Protocolo cliente↔servidor (M003/M069; não assumir WS/REST)
- [ ] Motor de persistência (antes de M004/M005 precisarem)
- [ ] Monorepo vs single-package (single até justificação — M002)
- [ ] Match lifecycle (M071) tem de preservar dispatch SERIAL (constraint M003)
- [x] Linguagem/stack base (M002: TypeScript/Node — VERIFIED)
- [x] Mecanismo de autoridade (M003: kernel — VERIFIED)

## 5. Repo layout (actual, M003)

```text
ai-warlords/
  package.json / package-lock.json  scripts + deps pinned (intocados em M003)
  tsconfig.json / tsconfig.build.json
  vitest.config.ts / eslint.config.js / .prettierrc.json
  src/
    health.ts / dev-server.ts / dev.ts   scaffold M002 (sem contrato)
    engine/
      authority.ts      kernel de autoridade (VERIFIED, load-bearing)
      harness.ts        domínio harness (prova; substituível, sem contrato)
      *.test.ts         54 testes colocados
    *.test.ts           28 testes M002 (regressão)
  dist/              build (gitignored)
  docs/              audit, stack, riscos, status, política de testes
  docs/modules/      registos por módulo (M002.md, M003.md, …)
```

AVISO (mantido): `src/dev-server.ts` é scaffold M002 sem contrato.
`src/engine/harness.ts` é prova M003 sem contrato de domínio. Só
`src/engine/authority.ts` é load-bearing para o futuro.

## 6. Registo de alterações

| Data       | Módulo | Alteração                                                   |
| ---------- | ------ | ----------------------------------------------------------- |
| 2026-09-10 | M001   | Criação inicial: estado NONE + alvo PLANNED                 |
| 2026-09-10 | M002   | Layout do repo + aviso anti-contrato do scaffold            |
| 2026-09-10 | M003   | Kernel de autoridade EXISTS; layout engine; constraint M071 |
