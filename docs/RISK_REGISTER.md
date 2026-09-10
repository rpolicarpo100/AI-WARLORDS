# AI WARLORDS — RISK REGISTER (M003)

> Data: 2026-09-10 · Actualizado por: M003
> Convenção: `ACTIVE` = presente agora · `FUTURE` = fases vindouras ·
> `MITIGATED` = tratado com residual declarado · `CLOSED` = encerrado

---

## 1. Riscos de programa

| ID   | Risco                                | Fase    | Sev. | Estado | Mitigação                                              |
| ---- | ------------------------------------ | ------- | ---- | ------ | ------------------------------------------------------ |
| R-01 | Scope creep / exaustão (165 módulos) | Todas   | Alta | FUTURE | gates rígidos; 1 módulo de cada vez (§35); checkpoints |
| R-02 | Complexidade prematura               | 0–1     | Alta | FUTURE | §19; M002/M003 minimalistas provam o padrão            |
| R-03 | Assumir providers sem verificar      | 5+, 23+ | Alta | FUTURE | §1 (`UNKNOWN` até prova); verificação por módulo       |
| R-04 | Simulação apresentada como real      | Todas   | Alta | FUTURE | §11 (`TEST MOCK`); M003: zero mocks; harness rotulado  |
| R-05 | Testes desactivados para obter PASS  | Todas   | Alta | FUTURE | §16; thresholds enforced; exclusão só com compensação  |

## 2. Riscos arquitecturais

| ID   | Risco                              | Fase   | Sev.       | Estado    | Mitigação                                                                                                                                                                                   |
| ---- | ---------------------------------- | ------ | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-10 | Determinismo inalcançável na stack | 0–1    | Alta       | FUTURE    | critério nº 1 da escolha; kernel-level provado; prova diferida a M005/M009                                                                                                                  |
| R-11 | Autoridade do cliente por acidente | 1, 19  | Alta       | MITIGATED | M003 VERIFIED: sole-writer, anti-spoof, outcomes servidor, freeze, dedupe. RESIDUAL: cada domínio tem de mutar SÓ via kernel (rever/módulo); outputs trusted até M006; transporte até M069+ |
| R-12 | AI com info ilícita (fog leakage)  | 2, 5   | Média–Alta | FUTURE    | WORLD≠PERCEPÇÃO (M004/M015); gate M015                                                                                                                                                      |
| R-13 | LLM como SPOF                      | 5+     | Alta       | FUTURE    | §20 fallback determinístico; testes de falha                                                                                                                                                |
| R-14 | Acoplamento engine↔AI↔LLM          | 1, 5–7 | Média      | FUTURE    | fronteiras §22; regression crescente §17                                                                                                                                                    |

## 3. Riscos de segurança

| ID   | Risco                             | Fase      | Sev.  | Estado | Mitigação                                |
| ---- | --------------------------------- | --------- | ----- | ------ | ---------------------------------------- |
| R-20 | Cheating (recursos/dano forjados) | 1, 17, 19 | Alta  | FUTURE | M003 mecanismo; M006/M081/M083 domínio   |
| R-21 | Replay / duplicação               | 17, 19    | Alta  | FUTURE | M003 dedupe in-process; M084 rede/crypto |
| R-22 | Spam / DoS                        | 17, 19    | Média | FUTURE | M085; rate limiting; ver R-53            |
| R-23 | Race conditions                   | 1, 17, 19 | Alta  | FUTURE | M003 serial sync; M071 preservar; M086   |
| R-24 | Manipulação de ratings            | 18        | Média | FUTURE | ratings separados; M087                  |

## 4. Riscos financeiros / Web3 (NÃO actuar antes da Fase 23)

| ID   | Risco                               | Fase   | Sev.    | Estado | Mitigação                          |
| ---- | ----------------------------------- | ------ | ------- | ------ | ---------------------------------- |
| R-30 | Dinheiro real antes de estabilidade | 23–28  | Crítica | FUTURE | gate Fase 28; §31                  |
| R-31 | Double-spend / reconciliação        | 23–25  | Crítica | FUTURE | ledger M100; M101/M110/M111        |
| R-32 | Farming/abuse de recompensas        | 21, 28 | Alta    | FUTURE | simulador M094; free mode primeiro |
| R-33 | Legal: gambling/skill, KYC, geo     | 26     | Crítica | FUTURE | Fase 26 antes de recompensas       |

## 5. Riscos de performance / observabilidade

| ID   | Risco                     | Fase     | Sev.  | Estado | Mitigação                                            |
| ---- | ------------------------- | -------- | ----- | ------ | ---------------------------------------------------- |
| R-40 | Optimizar por adivinhação | 1, 5, 20 | Média | FUTURE | §27 medir; M088–M093; freeze O(state) anotado (L-02) |
| R-41 | Custos LLM descontrolados | 5+       | Média | FUTURE | §21; sem LLM p/ triviais; M092                       |
| R-42 | Sem audit trail da AI     | 5+       | Média | FUTURE | §26; M062–M064; kernel log é precedente              |

## 6. Riscos de ambiente / imediatos

| ID   | Risco                                         | Sev.  | Estado    | Nota                                                             |
| ---- | --------------------------------------------- | ----- | --------- | ---------------------------------------------------------------- |
| R-50 | Stack errada → reescrita em M005–M009         | Média | MITIGATED | TS/Node; residual: prova M005/M009                               |
| R-51 | Docker ausente no sandbox                     | Baixa | ACTIVE    | M003 não precisou; revisitar se preciso                          |
| R-52 | TypeScript 6 = major recente                  | Baixa | ACTIVE    | pinned; gates verdes                                             |
| R-53 | Stores `seen`/sessions unbounded (DoS futuro) | Baixa | FUTURE    | in-process hoje (sem superfície); M071/M085: bound/expire (L-07) |

## 7. Alterações

| Data       | Módulo | Alteração                                                           |
| ---------- | ------ | ------------------------------------------------------------------- |
| 2026-09-10 | M002   | R-50 MITIGATED (residual declarado); R-51 sem impacto; R-52 criado  |
| 2026-09-10 | M003   | R-11 MITIGATED (residual declarado); R-53 criado (L-07 → M071/M085) |
