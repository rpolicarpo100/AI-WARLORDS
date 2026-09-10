# AI WARLORDS — DEPENDENCIES (M002)

> Data: 2026-09-10 · Versões exactas OBSERVADAS em `node_modules/` pós-`npm ci`

---

## 1. Dependências de código

### Produção: ZERO

`package.json` não declara `dependencies` (o npm removeu o bloco vazio;
`src/env-contract.test.ts` vigia esta invariante). Runtime usa apenas
`node:` builtins (`http`, `net`, `fs`, `path`, `url`, `child_process`, `events`,
`crypto` — M005: ids + sha256).

### Desenvolvimento (10 directas, 161 pacotes no total com transitivas)

| Pacote                 | Declarado | Instalado | Função                              |
| ---------------------- | --------- | --------- | ----------------------------------- |
| typescript             | ^6.0.3    | 6.0.3     | compilador + typecheck strict       |
| @types/node            | ^22.20.2  | 22.20.2   | tipos `node:`                       |
| tsx                    | ^4.23.13  | 4.23.13   | dev loop TS (`npm run dev`)         |
| vitest                 | ^4.1.11   | 4.1.11    | test runner                         |
| @vitest/coverage-v8    | ^4.1.11   | 4.1.11    | coverage real (thresholds 100×4)    |
| eslint                 | ^10.10.0  | 10.10.0   | lint (`--max-warnings=0`)           |
| @eslint/js             | ^10.0.1   | 10.0.1    | config base ESLint                  |
| typescript-eslint      | ^8.70.0   | 8.70.0    | parser+regras TS (flat config)      |
| prettier               | ^3.9.6    | 3.9.6     | formato canónico                    |
| eslint-config-prettier | ^10.1.8   | 10.1.8    | desliga regras ESLint conflituantes |

Evidência supply-chain (M002): `package-lock.json` committed;
`rm -rf node_modules && npm ci` → exit 0 (reprodutível); `npm audit` →
**0 vulnerabilities**; upgrades futuros são decisões explícitas (nunca
automáticos).

## 2. Serviços externos / Providers

```text
(nenhum integrado)
```

Nota (M004): ferramentas de autoria avaliadas em `docs/TOOLS.md` (Tiled,
LDtk, …) são design-time — zero integração runtime, zero dependências.
Nenhum mapa/asset foi adicionado ao repo (gate: M010 escolhe o formato).

## 3. Capacidades de providers futuros — TODAS `UNKNOWN` (§1)

Nada abaixo foi verificado; nada pode ser assumido até verificação explícita
no módulo que precisar dele:

| Provider / Área          | Capacidade                            | Estado    |
| ------------------------ | ------------------------------------- | --------- |
| Solana (RPC/cluster)     | transacções, subscrições, finality    | `UNKNOWN` |
| Solana (wallet adapters) | signing, UX de ligação                | `UNKNOWN` |
| USDC (SPL token)         | programa, decimais, fees              | `UNKNOWN` |
| Qualquer LLM provider    | modelos, latência, custo, rate limits | `UNKNOWN` |
| Qualquer hosting         | regiões, scaling, preços              | `UNKNOWN` |
| Qualquer DB gerida       | planos, limites, backups              | `UNKNOWN` |
| KYC/AML vendors          | requisitos por jurisdição             | `UNKNOWN` |

## 4. Política de dependências (em vigor desde M002)

1. Nova dependência só com justificação vs §19 (simplicidade).
2. Este ficheiro actualizado em cada módulo que mexa em deps.
3. Lockfiles versionados; builds reproduzíveis (`npm ci`).
4. Sem dependências de rede em runtime crítico sem fallback.
5. `npm audit` revisto por módulo; vulnerabilidades registadas (nunca escondidas).
