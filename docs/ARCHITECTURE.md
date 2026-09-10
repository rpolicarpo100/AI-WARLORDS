# AI WARLORDS — ARCHITECTURE (M001)

> Estado actual: `NONE` (nada implementado)
> Arquitectura-alvo: `PLANNED` (transcrita do documento-mestre, sem alterações)
> Data: 2026-09-10

---

## 1. Arquitectura actual

```text
(NADA)
```

Sem frontend, sem backend, sem database, sem serviços. Ver `PROJECT_AUDIT.md` §2 para evidência.

---

## 2. Arquitectura-alvo (PLANNED — fonte: documento-mestre §12)

Pipeline autoritativo planeado (ainda NÃO existe):

```text
PLAYER
 ↓
COMMAND INTERPRETER
 ↓
COMMAND INTENT
 ↓
COMMAND POLICY
 ↓
AI PERCEPTION
 ↓
AI MEMORY
 ↓
STRATEGIC ENGINE
 ↓
TACTICAL ENGINE
 ↓
RISK ENGINE
 ↓
COUNTERFACTUAL SIMULATION
 ↓
AI REFUTATION
 ↓
ACTION PROPOSAL
 ↓
ACTION VALIDATOR
 ↓
GAME ENGINE
 ↓
WORLD STATE
 ↓
EVENT SYSTEM
 ↓
REPLAY
 ↓
ANALYTICS
```

### Invariantes arquitecturais (contrato, a impor desde M003)

1. **A AI nunca tem autoridade directa sobre o estado do jogo.** A AI propõe; o servidor valida; o Game Engine executa. (§12)
2. **O cliente nunca é fonte de verdade** para recursos, dano, posição oficial, cooldowns, vitória/derrota, score, recompensas, pagamentos. O cliente apenas solicita. (§23)
3. **Separação absoluta:** `GAME ENGINE = FACTS` · `AI = DECISIONS` · `LLM = LANGUAGE/REASONING SUPPORT`. O LLM nunca é fonte oficial da verdade. (§22)
4. **O jogo funciona sem LLM.** Fallback obrigatório: `PRIMARY AI → SECONDARY AI → CACHED PLAN → STRATEGIC ENGINE → DETERMINISTIC FALLBACK`. (§20)
5. **Separação de estado:** `WORLD_STATE` ≠ `AI_PERCEPTION` ≠ `CLIENT_STATE`. A AI nunca recebe o que não poderia conhecer. (§13/M015 gate, §4/M004)
6. **Blockchain nunca substitui o Game Engine** como fonte de verdade do resultado do jogo. (§13/M101)
7. **Dinheiro real só depois de estabilidade:** `SECURITY = VERIFIED ∧ ECONOMY = VERIFIED ∧ SETTLEMENT = VERIFIED ∧ LEGAL_REVIEW = PASS`. (§13/Fase 28)

---

## 3. Mapa de fases → camadas (PLANNED)

| Fase(s) | Camada | Módulos |
|---|---|---|
| 0 | Foundation (repo, env, tooling) | M001–M002 |
| 1 | Game Engine (autoridade, estado, match, validação, eventos, vitória) | M003–M009 |
| 2 | World (mapa, terreno, recursos, fog of war, percepção) | M010–M015 |
| 3–4 | Economy + Military | M016–M026 |
| 5–8 | AI Foundation → Commands | M027–M045 |
| 9–16 | Refutation → AI Arena | M046–M068 |
| 17–20 | Multiplayer → Observability | M069–M093 |
| 21–22 | Economic sim → Free mode | M094–M097 |
| 23–28 | Solana → Rewards | M098–M124 (+gates) |
| 29–36 | Advanced (warfare → social) | M125–M165 |

---

## 4. Decisões arquitecturais pendentes (todas `UNKNOWN` até M002+)

- [ ] Linguagem/stack do Game Engine (determinismo é requisito — M005/M009)
- [ ] Protocolo cliente↔servidor (a definir antes/depois de M003; não assumir WebSocket/REST)
- [ ] Motor de persistência (a definir antes de M004/M005 precisarem de storage)
- [ ] Estratégia de testes por stack (runner, coverage gates — M002)
- [ ] Monorepo vs multi-repo (decisão M002)

Nenhuma destas foi assumida. Valor actual de cada uma: `UNKNOWN`.

---

## 5. Registo de alterações

| Data | Módulo | Alteração |
|---|---|---|
| 2026-09-10 | M001 | Criação inicial: estado NONE + alvo PLANNED transcrito |

---

*Fim de ARCHITECTURE.md*
