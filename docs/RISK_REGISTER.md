# AI WARLORDS — RISK REGISTER (M023)

> Data: 2026-09-11 · Actualizado por: M023
> Convenção: `ACTIVE` = presente agora · `FUTURE` = fases vindouras ·
> `MITIGATED` = tratado com residual declarado · `CLOSED` = encerrado

---

## 1. Riscos de programa

| ID   | Risco                                | Fase    | Sev. | Estado | Mitigação                                              |
| ---- | ------------------------------------ | ------- | ---- | ------ | ------------------------------------------------------ |
| R-01 | Scope creep / exaustão (165 módulos) | Todas   | Alta | FUTURE | gates rígidos; 1 módulo de cada vez (§35); checkpoints |
| R-02 | Complexidade prematura               | 0–2     | Alta | FUTURE | §19; M002–M012 minimalistas provam o padrão            |
| R-03 | Assumir providers sem verificar      | 5+, 23+ | Alta | FUTURE | §1 (`UNKNOWN` até prova); TOOLS.md c/ fontes+UNKNOWNs  |
| R-04 | Simulação apresentada como real      | Todas   | Alta | FUTURE | política zero-sim + reviews por módulo + selo M009     |
| R-05 | Testes desactivados para obter PASS  | Todas   | Alta | FUTURE | §16; thresholds enforced; exclusão só com compensação  |

## 2. Riscos arquitecturais

| ID   | Risco                              | Fase   | Sev.       | Estado    | Mitigação                                                                                                                                                                                                       |
| ---- | ---------------------------------- | ------ | ---------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-10 | Determinismo inalcançável na stack | 0–1    | Alta       | MITIGATED | M005+M009: E2E + selo transversal. RESIDUAL: cross-machine/async até M069+                                                                                                                                      |
| R-11 | Autoridade do cliente por acidente | 1, 19  | Alta       | MITIGATED | M003–M006. RESIDUAL: outputs re-guardados M006; transporte até M069+; rever mutações/módulo                                                                                                                     |
| R-12 | AI com info ilícita (fog leakage)  | 2, 5–8 | Média–Alta | FUTURE    | M004+M010: redacção + AI/CLIENT map-blind (construção); fog REAL em M015; inferência M028; M013 computação VERIFIED (D-006); M014 memória VERIFIED, non-leak em vistas (D-007); M015 fog REAL em vistas (D-008) |
| R-13 | LLM como SPOF                      | 5+     | Alta       | FUTURE    | fallback determinístico (mestre #8); testes de falha                                                                                                                                                            |
| R-14 | Acoplamento engine↔AI↔LLM          | 1, 5–7 | Média      | FUTURE    | fronteiras §22 (kinds M004); regression crescente §17                                                                                                                                                           |

## 3. Riscos de segurança

| ID   | Risco                             | Fase      | Sev.  | Estado | Mitigação                                         |
| ---- | --------------------------------- | --------- | ----- | ------ | ------------------------------------------------- |
| R-20 | Cheating (recursos/dano forjados) | 1, 17, 19 | Alta  | FUTURE | M006+M008+M010+M012 invariants; M081/M083 domínio |
| R-21 | Replay / duplicação               | 17, 19    | Alta  | FUTURE | M003 dedupe in-process; M084 rede/crypto          |
| R-22 | Spam / DoS                        | 17, 19    | Média | FUTURE | M085; rate limiting; ver R-53/R-54                |
| R-23 | Race conditions                   | 1, 17, 19 | Alta  | FUTURE | M003 serial sync; M071 preservar; M086            |
| R-24 | Manipulação de ratings            | 18        | Média | FUTURE | ratings separados; M087                           |

## 4. Riscos financeiros / Web3 (NÃO actuar antes da Fase 23)

| ID   | Risco                               | Fase   | Sev.    | Estado | Mitigação                          |
| ---- | ----------------------------------- | ------ | ------- | ------ | ---------------------------------- |
| R-30 | Dinheiro real antes de estabilidade | 23–28  | Crítica | FUTURE | gate Fase 28; §31                  |
| R-31 | Double-spend / reconciliação        | 23–25  | Crítica | FUTURE | Fase 26 antes de recompensas       |
| R-32 | Farming/abuse de recompensas        | 21, 28 | Alta    | FUTURE | simulador M094; free mode primeiro |
| R-33 | Legal: gambling/skill, KYC, geo     | 26     | Crítica | FUTURE | Fase 26 antes de recompensas       |

## 5. Riscos de performance / observabilidade

| ID   | Risco                     | Fase     | Sev.  | Estado | Mitigação                                   |
| ---- | ------------------------- | -------- | ----- | ------ | ------------------------------------------- |
| R-40 | Optimizar por adivinhação | 1, 5, 20 | Média | FUTURE | §27 medir; M088–M093; freeze/hash/emit      |
| R-41 | Custos LLM descontrolados | 5+       | Média | FUTURE | §21; sem LLM p/ triviais; M092              |
| R-42 | Sem audit trail da AI     | 5+       | Média | FUTURE | §26; M062–M064; log+timeline+events preced. |

## 6. Riscos de ambiente / imediatos

| ID   | Risco                                            | Sev.  | Estado    | Nota                                                                                                                                                                      |
| ---- | ------------------------------------------------ | ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-50 | Stack errada → reescrita em M005–M009            | Média | CLOSED    | TS/Node provado pela Fase 1 (M009 fecha o âmbito M005–M009)                                                                                                               |
| R-51 | Docker ausente no sandbox                        | Baixa | ACTIVE    | M012 não precisou; revisitar se preciso                                                                                                                                   |
| R-52 | TypeScript 6 = major recente                     | Baixa | ACTIVE    | pinned; gates verdes                                                                                                                                                      |
| R-53 | Stores `seen`/sessions/timeline/events unb.      | Baixa | FUTURE    | in-process; M062: bound/persist log+timeline+events (L-09); M071/M085 resto                                                                                               |
| R-54 | Estado canónico unbounded (handlers futuros)     | Baixa | MITIGATED | cap 1MB/escrita (M006; L-08 CLOSED). RESIDUAL: valor provisório (L-12 → M088)                                                                                             |
| R-55 | Corrupção de registos por writes não-verificados | Baixa | MITIGATED | 2 incidentes (M011 RISK, M012 STATUS), ambos reparados; regra: edição cirúrgica + checklist pré-commit (PROCESS.md). RESIDUAL: disciplina por provar nos próximos módulos |

## 7. Alterações

| Data       | Módulo    | Alteração                                                                                |
| ---------- | --------- | ---------------------------------------------------------------------------------------- |
| 2026-09-10 | M002      | R-50 MITIGATED (residual declarado); R-51 sem impacto; R-52 criado                       |
| 2026-09-10 | M003      | R-11 MITIGATED (residual declarado); R-53 criado (L-07 → M071/M085)                      |
| 2026-09-10 | M004      | R-12 nota (mecanismo VERIFIED, fog real M015); R-54 criado (L-08 → M006)                 |
| 2026-09-10 | M005      | R-10 MITIGATED (E2E provado, residual M009/M069+); R-53 += timeline (L-09 → M062)        |
| 2026-09-10 | M006      | R-54 MITIGATED (cap, L-08 CLOSED, residual L-12 → M088); L-10 CLOSED; R-11/R-20 notas    |
| 2026-09-10 | M007      | R-53 += events (L-09 estendido → M062); L-15/L-16 criados (delivery/payloads futuros)    |
| 2026-09-10 | M008      | L-17/L-18 criados (score/eliminação futuros); R-20 nota (verdict-integrity)              |
| 2026-09-11 | M009      | R-50 CLOSED (Fase 1 prova stack); R-10 residual M009 cumprido; L-19 criado (scan)        |
| 2026-09-11 | M010      | R-12/R-20 notas (blindness/map-preserved); L-20/L-21 criados (stagger/conteúdo)          |
| 2026-09-11 | M011      | L-22 criado (high-ground⟺mountain, sem elevation); R-02/R-51 notas                       |
| 2026-09-11 | M012      | R-20 nota (nós sob map-preserved); L-23 (amounts por tile); REPARO: dup §2–§4 removida   |
| 2026-09-11 | FIX-AUDIT | R-55 criado (integridade de registos); L-24/L-25 (tick-clock, spawn-roster)              |
| 2026-09-11 | M013      | R-12 nota (computação fog); L-26/L-27 (on-demand, viewer-membership)                     |
| 2026-09-11 | M014      | R-12 nota (memória explored); L-28 (anti-forge residual → M021+)                         |
| 2026-09-11 | M015      | R-12 nota (fog real); L-04/L-27 CLOSED; L-29 (→ M028); selo re-locked                    |
| 2026-09-11 | M016      | L-30/L-31 (grants→M019, caps→M018); sem invariante (M020 owns)                           |
| 2026-09-11 | M017      | R-20 nota (map-preserved cede depleção); L-23 CLOSED; L-32 (gather sem worker→M021/M022) |
| 2026-09-11 | M018      | L-31 CLOSED (caps derivados, default uncap); enforcement→M020; BUILD_*→M019              |
| 2026-09-11 | M019      | L-30 CLOSED (sem grants); advance emendado cercado; invariante→M020; fila/cap→FUTURE     |
| 2026-09-11 | M020      | L-31 enforcement LANDED (caps+conservação live); Fase 3 CLOSED; L-32→M021/M022           |
| 2026-09-11 | M021      | L-32 REPOINT→M022 (gate precisa movimento); Fase 4 aberta; criação→M025 presumível       |
| 2026-09-11 | M022      | L-32 CLOSED (worker exact-cell); 1-step live; mockups rebuild; cri→M025 mantém           |
| 2026-09-11 | M023      | Combate live (dano+chão 0); 0hp não age; remoção→M024; produtor assume alvo              |
| 2026-09-11 | M028      | L-29 CLOSED (terrain-memory live, OOB soft); intel inimiga mantém fail-closed             |
| 2026-09-11 | PROMPTS   | Ticks mortos (budget live, exaustão=draw); tuning X=10→#92; sem unlimited (M09X)         |
| 2026-09-11 | M029      | Lifecycle live (commission+flips+eventos owner-only); `active` sem leitor→M043+/M035+; roster sem cap |
| 2026-09-11 | M030      | L-28 CLOSED (visão stateful; writer canónico só-genuíno); tuning visão 2→#92; sem lost-contact |
| 2026-09-11 | M031      | DNA live (vocabulário+guard+mirror, zero consumers); writer→FUTURO; mirror-drift coberto por battery |
| 2026-09-11 | M032      | Personalities live (fixo-5+presets votados, zero behavior); tuning matriz→#92; extensão futura declarada |
| 2026-09-11 | M033      | Doctrines live (fixo-6+deltas votados, zero behavior/composer); tuning matriz→#92; composição só-registada |
| 2026-09-11 | M034      | Harness live (drill 0 violations + suite transversal, zero prod); bloco M031–M034 CLOSED; composição→M035+ |
