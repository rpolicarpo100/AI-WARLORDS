# AI WARLORDS — TECH STACK (M001)

> Estado: `NONE` — nenhuma stack seleccionada ou instalada.
> Data: 2026-09-10

---

## 1. Stack actual

```text
Linguagem:   NONE
Runtime:     NONE
Frontend:    NONE
Backend:     NONE
Database:    NONE
Test runner: NONE
Linter:      NONE
Typechecker: NONE
CI/CD:       NONE
Deploy:      NONE
Package mgr: NONE (nenhum lockfile: sem package-lock.json, pnpm-lock, poetry.lock, Cargo.lock…)
```

Evidência: `find . -maxdepth 4 -type f` devolve apenas os 2 ficheiros `.txt` em `uploads/`.

---

## 2. Toolchain disponível no sandbox (factos, não decisões)

| Ferramenta | Versão | Verificado |
|---|---|---|
| Node.js | v20.20.2 | ✅ `node --version` |
| npm | 10.8.2 | ✅ `npm --version` |
| Python | 3.13.14 | ✅ `python3 --version` |
| pip | 26.1.2 | ✅ `pip --version` |
| git | 2.47.3 | ✅ `git --version` |
| Docker | — | ❌ ausente (`command not found`) |

A existência destas ferramentas **não constitui escolha de stack**.

---

## 3. Requisitos que a futura stack tem de satisfazer (extraídos do documento-mestre)

1. **Determinismo** (M005/M009): o engine tem de suportar matches determinísticos (`SEED`, `RULESET`, `TIMELINE`, replay). A stack/linguagem escolhida não pode inviabilizar isto.
2. **Testabilidade total** (§9–§10): unit + integration + failure + security + regression + adversarial. Runner e gates de coverage a definir em M002.
3. **Type safety** (M002 gate exige `TYPECHECK = PASS`) → linguagens sem type checking terão de justificar alternativa no gate M002.
4. **Lint + Build + Test + Dev server** todos `PASS` no gate M002.
5. **Simplicidade** (§19): menos dependências, menos serviços, menos pontos de falha. Não adicionar tecnologia por moda.
6. **Sem LLM obrigatório** (§20): a stack de AI tem de suportar fallback determinístico local.

---

## 4. Decisão pendente (M002)

A escolha de stack é um **input explícito requerido antes de M002**, não algo a assumir durante M002.

Opções candidatas (lista neutra, sem recomendação assumida — a recomendação técnica será feita em M002 `IN_ANALYSIS`):

- TypeScript (Node) — full-stack JS/TS
- Python — engine + backend
- Outra (a justificar contra os requisitos do §3)

Critério de decisão: satisfazer §3 com o menor custo de complexidade (§19), nesta ordem de prioridade (§34): `REAL > FUNCTIONAL > VERIFIABLE > SECURE > PERFORMANT > SCALABLE > FEATURE-RICH`.

---

## 5. Registo de alterações

| Data | Módulo | Alteração |
|---|---|---|
| 2026-09-10 | M001 | Criação inicial: stack NONE, requisitos extraídos |

---

*Fim de TECH_STACK.md*
