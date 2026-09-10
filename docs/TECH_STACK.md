# AI WARLORDS — TECH STACK (M002)

> Estado: `DECIDED + VERIFIED` (M002 @ 2026-09-10)
> Decisão delegada ao agente pelos critérios: necessidades · custo≈0 · fiabilidade

---

## 1. Stack actual (verificada pelo gate M002)

```text
Linguagem:   TypeScript 6.0.3 (strict + noUncheckedIndexedAccess)
Runtime:     Node.js >=20.10 (observado: 20.20.2)
Módulos:     ESM ("type": "module", module/moduleResolution NodeNext, target ES2022)
Frontend:    NONE (sem cliente)
Backend:     NONE (scaffold dev sem contrato — não é o servidor do jogo)
Database:    NONE
Test runner: Vitest 4.1.11 + @vitest/coverage-v8 4.1.11 (thresholds 100×4)
Linter:      ESLint 10.10.0 + typescript-eslint 8.70.0 (--max-warnings=0)
Formatter:   Prettier 3.9.6 (+ eslint-config-prettier 10.1.8)
Typechecker: tsc (project refs: tsconfig.json check / tsconfig.build.json emit)
Dev runner:  tsx 4.23.13 (watch) · Types: @types/node 22.20.2
CI/CD:       NONE · Deploy: NONE
Package mgr: npm 10.8.2 + package-lock.json (reprodutível via `npm ci` — provado)
Prod deps:   ZERO (apenas `node:` builtins)
```

## 2. Toolchain do sandbox (factos)

| Ferramenta | Versão   | Verificado                             |
| ---------- | -------- | -------------------------------------- |
| Node.js    | v20.20.2 | ✅ `node --version`                    |
| npm        | 10.8.2   | ✅ `npm --version`                     |
| Python     | 3.13.14  | ✅ (não usado)                         |
| git        | 2.47.3   | ✅ repo inicializado, branch `main`    |
| Docker     | —        | ❌ ausente (R-51; sem impacto em M002) |

## 3. Requisitos que a stack satisfaz (verificação M002)

1. **Determinismo (M005/M009):** TS não o inviabiliza; PROVA diferida para
   M005/M009 (declarado, não assumido).
2. **Testabilidade (§9–§10):** 6 categorias implementadas; política em
   `docs/TESTING.md`.
3. **Type safety:** tsc strict nativo; gate TYPECHECK=PASS.
4. **Gates M002:** INSTALL/BUILD/TEST/LINT/TYPECHECK = PASS + 2 live checks.
5. **Simplicidade (§19):** 10 devDeps, 0 prod deps, single package.
6. **Sem LLM obrigatório (§20):** zero dependências de AI/LLM.

## 4. Decisão registada (M002 IN_ANALYSIS → VERIFIED)

Escolha: **TypeScript/Node 20 LTS, single-package ESM.**
Motivos: typecheck nativo; determinismo viável; partilha client/server
futura (multiplayer); SDKs Solana/LLM first-class; €0 (OSS); LTS + lockfile.
Rejeitado: Python (typecheck 3ª parte, sem partilha); monorepo já (YAGNI);
dotenv/hooks/CI (só quando um módulo exigir).

## 5. Registo de alterações

| Data       | Módulo | Alteração                                                  |
| ---------- | ------ | ---------------------------------------------------------- |
| 2026-09-10 | M001   | Criação inicial: stack NONE, requisitos extraídos          |
| 2026-09-10 | M002   | Stack DECIDED+VERIFIED: TS/Node, gates verdes, 0 prod deps |
