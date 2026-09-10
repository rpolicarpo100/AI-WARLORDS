# AI WARLORDS — ARCHITECTURE (M002)

> Arquitectura do JOGO: `NONE` (nada implementado — M003+)
> Layout do REPO: `EXISTS` (M002, ver §5)
> Arquitectura-alvo: `PLANNED` (transcrita do documento-mestre)
> Data: 2026-09-10

---

## 1. Arquitectura actual do jogo

```text
(NADA — sem frontend, backend, database ou serviços de jogo)
```

## 2. Arquitectura-alvo (PLANNED — fonte: documento-mestre §12)

```text
PLAYER → COMMAND INTERPRETER → COMMAND INTENT → COMMAND POLICY
 → AI PERCEPTION → AI MEMORY → STRATEGIC ENGINE → TACTICAL ENGINE
 → RISK ENGINE → COUNTERFACTUAL SIMULATION → AI REFUTATION
 → ACTION PROPOSAL → ACTION VALIDATOR → GAME ENGINE → WORLD STATE
 → EVENT SYSTEM → REPLAY → ANALYTICS
```

Invariantes (contrato, a impor desde M003): AI propõe / servidor valida /
engine executa (§12); cliente nunca é fonte de verdade (§23); ENGINE=FACTS,
AI=DECISIONS, LLM=LANGUAGE (§22); jogo funciona sem LLM (§20);
WORLD≠PERCEPÇÃO≠CLIENTE (M004/M015); chain nunca substitui o engine (M101);
dinheiro só após gate Fase 28.

## 3. Mapa de fases → camadas (PLANNED)

| Fase(s) | Camada                      | Módulos              |
| ------- | --------------------------- | -------------------- |
| 0       | Foundation                  | M001–M002 (VERIFIED) |
| 1       | Game Engine                 | M003–M009            |
| 2       | World                       | M010–M015            |
| 3–4     | Economy + Military          | M016–M026            |
| 5–8     | AI Foundation → Commands    | M027–M045            |
| 9–16    | Refutation → AI Arena       | M046–M068            |
| 17–20   | Multiplayer → Observability | M069–M093            |
| 21–22   | Economic sim → Free mode    | M094–M097            |
| 23–28   | Solana → Rewards            | M098–M124 (+gates)   |
| 29–36   | Advanced                    | M125–M165            |

## 4. Decisões pendentes (`UNKNOWN` até ao módulo próprio)

- [ ] Protocolo cliente↔servidor (M003/M069; não assumir WS/REST)
- [ ] Motor de persistência (antes de M004/M005 precisarem)
- [ ] Monorepo vs single-package (single até justificação — M002)
- [x] Linguagem/stack base (M002: TypeScript/Node — VERIFIED)

## 5. Repo layout (actual, M002) — físico, não é arquitectura de jogo

```text
ai-warlords/
  package.json / package-lock.json  scripts + deps pinned
  tsconfig.json / tsconfig.build.json
  vitest.config.ts / eslint.config.js / .prettierrc.json
  src/
    health.ts        scaffold M002 (sem contrato)
    dev-server.ts    scaffold M002 (sem contrato)
    dev.ts           bootstrap (validado por execução real)
    *.test.ts        28 testes colocados
  dist/              build (gitignored)
  docs/              audit, stack, riscos, status, política de testes
  docs/modules/      registos por módulo (M002.md …)
```

AVISO: `src/dev-server.ts` é um scaffold de validação do ambiente. NÃO é
o servidor do jogo, NÃO tem contrato de API, e pode ser substituído em
M003/M069+. Nenhum módulo futuro herda comportamento dele sem decisão explícita.

## 6. Registo de alterações

| Data       | Módulo | Alteração                                        |
| ---------- | ------ | ------------------------------------------------ |
| 2026-09-10 | M001   | Criação inicial: estado NONE + alvo PLANNED      |
| 2026-09-10 | M002   | Layout do repo + aviso anti-contrato do scaffold |
