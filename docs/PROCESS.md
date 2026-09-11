# AI WARLORDS — PROCESS (FIX-AUDIT 2026-09-11, living doc)

> Regras de processo nascidas da auditoria M001–M012 (R7). Vinculativas
> até emenda explícita autorizada.

---

## 1. Living-docs: edição cirúrgica

- Docs vivos (`MODULE_STATUS`, `ARCHITECTURE`, `RISK_REGISTER`, `README`)
  actualizam-se por **edição cirúrgica** (bloco-a-bloco), nunca por
  reescrita total — as 2 corrupções (M011 RISK, M012 STATUS) vieram de
  `write_file` integral.
- Reescrita total só como **reparo** declarado, seguida de verificação
  de conteúdo por diff secção-a-secção (não basta contar linhas).

## 2. Checklist pré-commit para docs

1. Diff de conteúdo revisto (reescritas) — zero duplicações/omissões.
2. Números **medidos, nunca derivados** (ver F-10: contagens `dist/`).
3. Citações resolvem: `#N` → mestre em `uploads/`; `§N` → metodologia
   importada (R2b); `Mxxx` → plano-repo.
4. Datas/contagens verificadas contra `git log` e saídas reais.
5. Anomalias **corrigem-se, nunca se racionalizam** em notas (ver F-01:
   a nota "intentionally folded" foi confabulação sobre um erro).

## 3. Emendas a registos VERIFIED

- Registos `Mxxx.md` corrigem-se só por **erro factual**, com rasto em
  relatório de auditoria + `git` (o histórico preserva o original).
- Prosa histórica/aspiracional (`Próximo`, análises) não se reescreve;
  superação regista-se no módulo seguinte ou em `DECISIONS.md`.

## 4. Referências estáveis

- Preferir **símbolos** (`describe`, nomes de função) a números de linha,
  que apodrecem a cada emenda.

## 5. Veículo FIX

- Achados de auditoria corrigem-se em commit(s) `FIX:` standalone com
  autorização do utilizador (um fix-batch = uma decisão), fora da ordem
  M001→M165 — sem precedência sobre módulos, sem os substituir.

## 6. Alterações

| Data       | Autor     | Alteração                                          |
| ---------- | --------- | -------------------------------------------------- |
| 2026-09-11 | FIX-AUDIT | Criação: edição cirúrgica, checklist, emendas, FIX |
