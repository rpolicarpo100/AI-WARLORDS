# PROMPTS — Ticks morrem, prompts mandam (VERIFIED @ 2026-09-11)

Out-of-band redesign (user-mandatado, pré-M029, sem renumeração): o relógio
global morre; cada applied dispatch gasta 1 prompt do caller. D-022 ACCEPTED.
Nenhum módulo novo (contagens 28/137 intactas); 1169 → 1224 testes (+55).

## 1. Âmbito (contrato)

- `promptsPerPlayer` (Match option, defeito 10, uint32 ≥1); Match semeia
  slot ausente, respeita presente; sem unlimited (M09X owns free-mode).
- Spend universal: TODO applied dispatch (incl. extras) gasta 1 do caller;
  rejeitados/duplicados/erros gastam 0; caller a 0 recebe REJECTED com
  reason pinned (`validation: [prompts-exhausted] no prompts left`).
- Filas city descem 1/applied SÓ do dono (owner-only); completion corre
  universal pós-handler pré-post-rules; sem cities = identidade (M005).
- Todos-locked + indeciso = draw `prompts-exhausted` (#46 reformado).
- Tick removido TOTAL: WorldState, envelope, veredicto, percepção,
  timeline, sim, páginas (revision fica a coordenada).
- PerceivedState −tick +prompts own-only (foe hidden, fail-closed).
- Kernel M003 intocado; HarnessState.tick intocado (máquina separada).
- Página: −Advance −tick, header mostra p1/p2; Take-Command ganha
  Wait (world.noop) no lugar do Advance morto.
- buildTime N conta o dispatch de enqueue (N prompts do dono, total).

## 2. Grounding → decisão

- 4 votos explícitos (2026-09-11): cada-dispatch / remover / jogador-bloqueia
  / X=10≈15min + owner-only + sem-unlimited + header-minimal.
- Precedentes: M015 (remoção total + selo cirúrgico), M020 (pin rewrite +
  conservação), M022 (injecção), M016/M021/M027 (molde L0).
- Rejeitado: spend/completion no kernel; completion por-handler; unlimited
  já; relógio global filas; tick congelado (podridão M015).

## 3. Churn (declarado)

- NOVO `prompts.ts` L0 (fail-soft 0, seed, spend puro) + suite 32.
- `world-state` (−tick +slot), `city` (rename isTicks→isPrompts),
  `validation` (ledger pós-regra + pré-regra + hook postStep),
  `events` (−tick, −tickProducer, mapa vazio), `victory` (exaustão),
  `economy` (owner + strings + same-dispatch), `match` (advance
  removido, seeding, pré universal, postStep injectado, completion
  universal, conditions), `views` (−tick +prompts).
- Testes: ledger 5 casos ×2 runners, spend/bloqueio/seeding E2E,
  exaustão/draw E2E, owner-only, completion universal, selo re-lock.
- Sim (fixture 200, invariante spend-only, csv step), tools
  (verify/vim/smoke/cmdWait), state.json + bundle + páginas + godot.

## 4. Testes (+55 → 1224/1224, 100×4)

- `prompts.test.ts`: 32 (guard, fail-closed, seed, spend, mirrors).
- `validation.test.ts`: ledger refill/mint/double-spend/add/drop-holder
  ×2 runners + pré-regra + postStep (13 net).
- `match.test.ts`: budget E2E (seeding/respeito/custom/spend/bloqueio/
  advance-morto) + golden timeline re-lock.
- `victory.test.ts`: exaustão unit + draw/event/MATCH_FINISHED/born-finished.
- `economy.test.ts`: owner p2 + unknown-owner + same-dispatch E2E.
- `events.test.ts`: completion-antes-extras + leniência ghost.
- `views.test.ts`: own-only; `phase1-gate`: selo re-lock (§6).
- Cobertura 100×4 (All + views + prompts + ficheiros tocados).

## 5. Gate e fecho

- Suite 1224/1224 (29 ficheiros), tsc 0, eslint 0.
- Bundle 46124 chars (idempotente ×2); verify PASS (16/15/14);
  smoke + smoke:attack PASS; sim 1200/500/0 (avgPromptsLeft 340.0).
- Commit + push + live 200 (ver rodapé do histórico).

## 6. Selo: prova old-vs-new (M015 → PROMPTS)

Fingerprint 4 dispatches alternados (P1,P2,P1,P2):

| campo        | M015 (maxTicks 4, advance)              | PROMPTS (budget 2, noop)                  |
|--------------|-----------------------------------------|-------------------------------------------|
| stateHash    | 2e1d8cc4…dcda49                         | 9476c605…34c0ca9                         |
| timelineHash | bf3b98d3…c530b5                         | 10ce3a14…67c757fd42                       |
| eventsHash   | 3cc8a911…60fc8631                       | 1ada3922…0fe5441e2c3                      |
| verdict      | finished/draw/time-limit/tick 4/rev 4   | finished/draw/prompts-exhausted/rev 4     |
| clock field  | tick: 4                                 | prompts: {p1: 0, p2: 0}                   |
| revision     | 4                                       | 4                                         |
| log/timeline | 4 / 4                                   | 4 / 4                                     |
| eventsLength | 6 (started+4×advanced+finished)         | 2 (started+finished; noops silent)        |

Porquê cada hash mudou: stateHash (tick removido, prompts semeados);
timelineHash (tick removido das entries, details world-noop);
eventsHash (match.advanced retirado, 4 eventos a menos).
Golden timeline M005: e53bd403…c0884c18 → fdf3325c…b39d2e93
(mesma causa: entry sem tick + snapshot com prompts).
