# AI WARLORDS — RISK REGISTER (M001)

> Data: 2026-09-10
> Convenção: `ACTIVE` = risco presente agora · `FUTURE` = risco de fases vindouras · `MITIGATED`/`CLOSED` = tratado/encerrado

Risco actual total: **praticamente zero** (nada construído, nada exposto). Todos os riscos materiais são `FUTURE`.

---

## 1. Riscos de programa (os mais perigosos)

| ID | Risco | Fase afectada | Severidade | Estado | Mitigação (planeada) |
|---|---|---|---|---|---|
| R-01 | Scope creep / exaustão: 165 módulos é um programa multi-mês; abandono a meio | Todas | **Alta** | FUTURE | Gates rígidos; um módulo de cada vez (§35); checkpoints `VERIFIED` (§30); âmbito faseado (jogo grátis primeiro, dinheiro muito depois) |
| R-02 | Complexidade prematura (introduzir infra/serviços antes da fundação) | 0–1 | Alta | FUTURE | §19 (simplicidade); §31 (não fazer); M002 minimalista |
| R-03 | Assumir capacidades de providers (Solana, LLM, KYC) sem verificar | 5+, 23+ | Alta | FUTURE | §1 (`UNKNOWN` até prova); verificação por módulo |
| R-04 | Simulação apresentada como real (mock leakage para "produção") | Todas | Alta | FUTURE | §11 (mocks só em testes, marcados `TEST MOCK`); Third Eye Q2 |
| R-05 | Testes desactivados/enfraquecidos para obter PASS | Todas | Alta | FUTURE | §16 (proibido; re-audit obrigatório) |

## 2. Riscos arquitecturais

| ID | Risco | Fase afectada | Severidade | Estado | Mitigação (planeada) |
|---|---|---|---|---|---|
| R-10 | Determinismo não alcançável na stack escolhida (quebra M005/M009) | 0–1 | Alta | FUTURE | Requisito de determinismo como critério de escolha de stack (TECH_STACK.md §3); M009 como gate duro |
| R-11 | Autoridade do cliente por acidente (validação só no frontend) | 1, 19 | Alta | FUTURE | M003/M006/M081; testes adversarial que tentam batota (§9F) |
| R-12 | AI com acesso a informação ilícita (fog-of-war leakage) | 2, 5 | Média–Alta | FUTURE | Separação WORLD_STATE/AI_PERCEPTION (M004/M015); gate M015 |
| R-13 | LLM como ponto único de falha | 5+ | Alta | FUTURE | §20 (fallback determinístico); jogo continua sem LLM; testes de falha de AI (§10) |
| R-14 | Acoplamento engine↔AI↔LLM (uma mudança parte tudo) | 1, 5–7 | Média | FUTURE | Fronteiras: ENGINE=FACTS, AI=DECISIONS, LLM=LANGUAGE (§22); regression suite crescente (§17) |

## 3. Riscos de segurança

| ID | Risco | Fase afectada | Severidade | Estado | Mitigação (planeada) |
|---|---|---|---|---|---|
| R-20 | Cheating (recursos/dano/movimento forjados) | 1, 17, 19 | Alta | FUTURE | Server authority (M003), validação central (M006/M081), detecção de acções impossíveis (M083), anti-cheat (M082) |
| R-21 | Replay attacks / duplicação de acções | 17, 19 | Alta | FUTURE | M084; nonces/ids idempotentes (a desenhar em M006/M071) |
| R-22 | Spam / DoS de endpoints de jogo | 17, 19 | Média | FUTURE | M085; rate limiting (a desenhar) |
| R-23 | Race conditions em acções simultâneas | 1, 17, 19 | Alta | FUTURE | Testes de race condition (M086); serialização autoritativa no servidor |
| R-24 | Manipulação de rating/leaderboards | 18 | Média | FUTURE | Ratings separados (M077–M079); integridade de match (M087: VALID/SUSPICIOUS/INVALID) |

## 4. Riscos financeiros / Web3 (fases tardias — NÃO actuar antes da Fase 23)

| ID | Risco | Fase afectada | Severidade | Estado | Mitigação (planeada) |
|---|---|---|---|---|---|
| R-30 | Dinheiro real antes de estabilidade | 23–28 | **Crítica** | FUTURE | Gate Fase 28 (SECURITY+ECONOMY+SETTLEMENT VERIFIED + LEGAL PASS); §31 proíbe blockchain cedo |
| R-31 | Double-spend / reconciliação ledger↔chain | 23–25 | Crítica | FUTURE | Ledger interno auditável (M100), reconciliação (M101/M110), incident handling M111 (nunca corrigir silenciosamente) |
| R-32 | Farming/abuse da economia de recompensas | 21, 28 | Alta | FUTURE | Simulador económico M094 (milhares de cenários, resultados medidos não inventados); free mode estável primeiro (Fase 22) |
| R-33 | Risco legal: skill-vs-gambling, jurisdições, KYC/AML, idade, geo-blocking | 26 | Crítica | FUTURE | Fase 26 completa antes de recompensas; sem contornos à legislação |

## 5. Riscos de performance / observabilidade

| ID | Risco | Fase afectada | Severidade | Estado | Mitigação (planeada) |
|---|---|---|---|---|---|
| R-40 | Optimização por adivinhação; latência de tick/IA desconhecida | 1, 5, 20 | Média | FUTURE | §27 (medir, não adivinhar); M088–M093 antes de escalar |
| R-41 | Custos de LLM descontrolados | 5+ | Média | FUTURE | §21 (AI cost control); sem chamadas LLM para decisões triviais; M092 |
| R-42 | Falta de audit trail para decisões da AI | 5+ | Média | FUTURE | §26 (OBSERVATION→…→RESULT); M062–M064 replay/chronicle |

## 6. Riscos técnicos imediatos (M002)

| ID | Risco | Severidade | Estado | Mitigação |
|---|---|---|---|---|
| R-50 | Escolha de stack errada obriga a reescrita em M005–M009 | Média | FUTURE | Decisão explícita e fundamentada em M002 IN_ANALYSIS (determinismo como critério nº 1) |
| R-51 | Docker ausente no sandbox limita testes de infra/DB containerizada | Baixa | ACTIVE | M002 deve validar o que for possível sem Docker; registar limitação; não fingir testes de containers |

---

## 7. Riscos encerrados / não aplicáveis

| ID | Nota |
|---|---|
| — | Sem vulnerabilidades activas (nada exposto). Sem dívida técnica (zero código). |

---

*Fim de RISK_REGISTER.md*
