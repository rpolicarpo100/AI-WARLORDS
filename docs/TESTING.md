# AI WARLORDS — TESTING POLICY (M002, living doc)

> Comandos: `npm test` (suite + coverage gates) · `npm run test:watch` (dev loop)

---

## 1. Categorias por módulo (§9)

Cada módulo implementa as 6, proporcionais ao seu âmbito:

| Categoria      | O que prova                       | Exemplo M002                                               |
| -------------- | --------------------------------- | ---------------------------------------------------------- |
| A. Unit        | funções isoladas, determinismo    | `parseDevConfig`, `formatDevUrl`, `getHealth` + clock fixo |
| B. Integration | componentes reais a falar         | HTTP real sobre sockets reais; contrato package.json       |
| C. Failure     | inválidos, erros, limites         | 400/404, EADDRINUSE, double-close, env inválido, exit 1    |
| D. Security    | manipulação, abuso, leaks         | não-reflexão, headers, bodies estáticos                    |
| E. Regression  | nada anterior partiu              | `env-contract.test.ts` + re-correr a suite total (§17)     |
| F. Adversarial | tentativas deliberadas de quebrar | 50 concorrentes, bytes de lixo, spawn/kill reais           |

## 2. Negativos obrigatórios (§10)

Para cada módulo, aplicar os itens desta lista que façam sentido ao âmbito
e declarar os N/A com motivo (nunca ignorar em silêncio):

```text
INPUT INVALIDO · INCOMPLETO · DUPLICADO · MALICIOSO · EXTREMO · FORA DE ORDEM
REQUEST REPETIDO · SIMULTÂNEO · TIMEOUT · RECONNECT · DISCONNECT
FALHA DE DATABASE/API/AI/REDE · RACE CONDITION
```

## 3. Coverage (instrumentação M002)

Thresholds enforced (`vitest run --coverage` falha se não cumprir):

```text
lines: 100 · functions: 100 · statements: 100 · branches: 100
```

Regra de exclusão (estrita): um ficheiro só pode ser excluído da métrica se
(1) a exclusão estiver documentada no config com o MOTIVO, e (2) existir um
CONTROLO COMPENSATÓRIO que valide o comportamento por execução real
(ex.: `src/dev.ts` → spawn tests + live gate). Exclusão sem controlo
compensatório = violação (equivale a desactivar teste, §16).

Código defensivo NUNCA é removido para atingir 100% de branches: branches
praticamente inalcançáveis via I/O real cobrem-se com TEST MOCK marcado,
ou documentam-se com motivo.

## 4. Mocks (§11)

- Mocks SOMENTE dentro de testes, marcados `TEST MOCK` com o motivo.
- Preferência: I/O real (sockets, processos, ficheiros) sobre mocks.
- Proibido apresentar mocks como sistemas reais (pagamentos, chain, AI…).

## 5. Correcção (§16) e regressão (§17)

Falha → `IDENTIFY → REPRODUCE → ROOT CAUSE → FIX → RETEST → REGRESSION →
RE-AUDIT`. Proibido: esconder falhas, desactivar testes, amolecer critérios.
Cada módulo novo re-corre a suite total antes do seu gate.

## 6. Registo por módulo

Resultados e evidência vivem em `docs/modules/Mxxx.md` (§5–§7 desse registo).
Este ficheiro define a POLÍTICA; os registos guardam as PROVAS.

---

## 7. Alterações

| Data       | Módulo | Alteração                                              |
| ---------- | ------ | ------------------------------------------------------ |
| 2026-09-10 | M002   | Criação: política + coverage 100×4 + regra de exclusão |
