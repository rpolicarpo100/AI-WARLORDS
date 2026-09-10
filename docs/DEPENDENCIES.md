# AI WARLORDS — DEPENDENCIES (M001)

> Estado: `NONE` — zero dependências.
> Data: 2026-09-10

---

## 1. Dependências de código

```text
(nenhuma — sem package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, etc.)
```

## 2. Serviços externos / Providers

```text
(nenhum integrado)
```

## 3. Capacidades de providers futuros — TODAS `UNKNOWN` (§1)

Nenhuma das seguintes capacidades foi verificada. Nada abaixo pode ser assumido em nenhum módulo até verificação explícita:

| Provider / Área | Capacidade | Estado |
|---|---|---|
| Solana (RPC/cluster) | Enviar/confirmar transacções, subscrições, finality | `UNKNOWN` |
| Solana (wallet adapters) | Signing, UX de ligação | `UNKNOWN` |
| USDC (SPL token) | Mint/programa, decimais, fees | `UNKNOWN` |
| Qualquer LLM provider | Modelos, latência, custo, rate limits, SLA | `UNKNOWN` |
| Qualquer hosting | Regiões, scaling, preços | `UNKNOWN` |
| Qualquer DB gerida | Planos, limites, backups | `UNKNOWN` |
| KYC/AML vendors | Requisitos por jurisdição | `UNKNOWN` |
| Lojas de app / pagamentos fiat | Se aplicável no futuro | `UNKNOWN` |

Regra: qualquer módulo que precise de um provider tem de verificar a capacidade **nesse módulo** e registar a evidência. Verificação antiga não transitiva sem re-validação quando houver mudança de versão/plano.

## 4. Política de dependências (a aplicar desde M002)

1. Cada nova dependência tem de ser justificada contra §19 (simplicidade).
2. `DEPENDENCIES.md` actualizado em cada módulo que adicione/remova/actualize algo.
3. Lockfiles versionados; builds reproduzíveis.
4. Sem dependências de rede em runtime crítico sem fallback (cf. §20 para AI).
5. Auditoria de vulnerabilidades quando houver gestor de pacotes (M002 define o mecanismo).

---

*Fim de DEPENDENCIES.md*
