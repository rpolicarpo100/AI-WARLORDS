# AI WARLORDS — MODULE STATUS (M012)

> Data: 2026-09-11 · Actualizado por: M012 (Resources)
> Estados oficiais: `PLANNED · IN_ANALYSIS · IN_DEVELOPMENT · IMPLEMENTED · TESTING · FAILED · BLOCKED · VERIFIED · DEPRECATED`

---

## Resumo

| Estado     | Contagem        |
| ---------- | --------------- |
| `VERIFIED` | 34 (M001–M034)  |
| `PLANNED`  | 131 (M035–M165) |
| Outros     | 0               |

Checkpoints `VERIFIED`:

- **M001 @ 2026-09-10** — audit greenfield; zero código; gate PASS.
- **M002 @ 2026-09-10** — env TS/Node; INSTALL/BUILD/TEST/LINT/TYPECHECK PASS;
  28 testes, coverage 100×4, audit 0 vuln, 2 live checks OK.
- **M003 @ 2026-09-10** — authority kernel + harness; 82/82 testes, 100×4,
  zero mocks, 6 garantias provadas. Registo em `docs/modules/M003.md`.
- **M004 @ 2026-09-10** — world state versionado + 3 vistas separadas;
  122/122 testes, 100×4; TOOLS.md (7 ferramentas verificadas).
  Registo em `docs/modules/M004.md`.
- **M005 @ 2026-09-10** — match determinístico (proveniência + tick + timeline
  com hashes + RNG com seed); 214/214 testes, 100×4, goldens lockados.
  Registo em `docs/modules/M005.md`.
- **M006 @ 2026-09-10** — validador de acções (pré-regras + pós-invariantes +
  streams rng por dispatch); 255/255 testes, 100×4, kernel intocado.
  Registo em `docs/modules/M006.md`.
- **M007 @ 2026-09-10** — sistema de eventos (geneses + factos por dispatch +
  surrogates); 284/284 testes, 100×4, restrição provada.
  Registo em `docs/modules/M007.md`.
- **M008 @ 2026-09-10** — condições de vitória (veredicto lazy + time-draw +
  terminalidade); 313/313 testes, 100×4, fail-stop provado.
  Registo em `docs/modules/M008.md`.
- **M009 @ 2026-09-11** — suite transversal do motor (gémeos + selo + scans +
  escala); 327/327 testes, 100×4, zero código de produção.
  Registo em `docs/modules/M009.md`. **Fase 1 completa.**
- **M010 @ 2026-09-11** — sistema de mapas (hex + `MapData` + loader Tiled +
  `map-preserved`); 459/459 testes, 100×4, v1 compatível.
  Registo em `docs/modules/M010.md`.
- **M011 @ 2026-09-11** — terreno (config 9/9 + default + consultas);
  486/486 testes, 100×4, zero emendas de produção.
  Registo em `docs/modules/M011.md`.
- **M012 @ 2026-09-11** — recursos (nós + coerência + loader + consultas);
  525/525 testes, 100×4, RISK reparado.
  Registo em `docs/modules/M012.md`.
- **M013 @ 2026-09-11** — fog of war (fontes + config + flood + consultas);
  586/586 testes, 100×4, zero emendas de produção.
  Registo em `docs/modules/M013.md`.
- **M014 @ 2026-09-11** — memória explored (leaf + mark + tri-state +
  monotonic); 649/649 testes, 100×4, emendas declaradas.
  Registo em `docs/modules/M014.md`.
- **M015 @ 2026-09-11** — percepção (perceive + membership + mapa
  filtrado; secrets removido); 651/651 testes, 100×4, selo re-locked.
  Registo em `docs/modules/M015.md`. **Fase 2 completa.**
- **M016 @ 2026-09-11** — motor de recursos (stockpiles + config + ops
  exactas); 717/717 testes, 100×4, sem invariante (M020 owns).
  Registo em `docs/modules/M016.md`.
- **M017 @ 2026-09-11** — gathering (primeiro produtor; depleção muda
  amounts); 765/765 testes, 100×4, map-preserved cede só depleção.
  Registo em `docs/modules/M017.md`. L-23 CLOSED.
- **M018 @ 2026-09-11** — edifícios (6 tipos #16; counts+config+custos
  +caps derivados); 845/845 testes, 100×4, sem transições (M019 owns).
  Registo em `docs/modules/M018.md`. L-31 CLOSED.
- **M019 @ 2026-09-11** — cidade (lazy-cities+queue+conclusão; factos
  build.started/completed; upgrade 1→2→3 gratuito, sem grants);
  932/932 testes, 100×4, sem invariante nova (M020 owns).
  Registo em `docs/modules/M019.md`. L-30 CLOSED.
- **M020 @ 2026-09-11** — validação económica (6.ª pós-regra:
  caps+conservação; gather rejeita cheio); 955/955 testes, 100×4,
  Fase 3 CLOSED (M016–M020 VERIFIED).
  Registo em `docs/modules/M020.md`. L-31 enforcement LANDED.
- **M021 @ 2026-09-11** — unidades (3 tipos #15 + instâncias
  posicionadas + config #83 + spawn puro; sem transições);
  1035/1035 testes, 100×4, Fase 4 aberta.
  Registo em `docs/modules/M021.md`. L-32 REPOINT→M022.
- **M022 @ 2026-09-11** — movimento (1-step+passabilidade;
  `unit.moved` LOW; gather exige worker); 1065/1065 testes, 100×4,
  loop worker completo.
  Registo em `docs/modules/M022.md`. L-32 CLOSED.
- **M023 @ 2026-09-11** — combate (ataque adjacente+dano #83, chão 0;
  `unit.attacked` NORMAL); 1096/1096 testes, 100×4, remoção→M024.
  Registo em `docs/modules/M023.md`.
- **M024 @ 2026-09-11** — resolução de dano (`max(0, dano−defesa)`;
  morte=remoção; `unit.slain` NORMAL; cura adiada); 1102/1102 testes,
  100×4, tooltip de defesa passa a verdade.
  Registo em `docs/modules/M024.md`.
- **M025 @ 2026-09-11** — treino de unidades (`unit.train`;
  paga+gera atómico; `unit.trained` NORMAL; treasury injectada);
  1123/1123 testes, 100×4, custo #83 consumido.
  Registo em `docs/modules/M025.md`.
- **M026 @ 2026-09-11** — testes militares (drills attack/train
  no sim + invariantes; journey do arco + determinismo);
  1125/1125 testes, 100×4, zero produção.
  Fase 4 CLOSED (M021–M026 VERIFIED).
  Registo em `docs/modules/M026.md`.
- **M027 @ 2026-09-11** — entidade Commander data-first
  (roster id/owner/active + guards + queries + slot +
  own-only); 1166/1166 testes, 100×4, sem comportamento.
  Fase 5 aberta (AI Foundation).
  Registo em `docs/modules/M027.md`.
- **M028 @ 2026-09-11** — percepção INFERRED (terrain-memory
  p/ explored sem visão; OOB soft; UNKNOWN provável);
  1169/1169 testes, 100×4, L-29 CLOSED.
  Registo em `docs/modules/M028.md`.
- **M029 @ 2026-09-11** — lifecycle Commander (commission
  + activate/deactivate + eventos + wiring Match; `active`
  marcador, roster N, owner-only); 1264/1264 testes, 100
  global, 3 votos de âmbito.
  Registo em `docs/modules/M029.md`.
- **M030 @ 2026-09-11** — pipeline descoberta (sourcesOf +
  postStep-explored + cell.discovered LOW + unit.spotted
  NORMAL #33; 3 votos); 1281/1281 testes, 100 global,
  L-28 CLOSED.
  Registo em `docs/modules/M030.md`.
- **M031 @ 2026-09-11** — AI DNA data-first (vocabulário
  10 traços 0–100 + guard + embed record + mirror;
  3 votos); 1330/1330 testes, 100 global, bloco
  Personalidade aberto.
  Registo em `docs/modules/M031.md`.
- **M032 @ 2026-09-11** — AI Personalities data-first
  (fixo-5 + presets DNA votados + rótulo record;
  5 votos); 1346/1346 testes, 100 global.
  Registo em `docs/modules/M032.md`.
- **M033 @ 2026-09-11** — Unit Doctrines data-first
  (fixo-6 + deltas DNA votados + rótulo record;
  5 votos); 1364/1364 testes, 100 global.
  Registo em `docs/modules/M033.md`.
- **M034 @ 2026-09-11** — Personalidade Testing
  (harness votado: drill sim + suite transversal;
  zero prod); 1366/1366 testes, 100 global.
  Registo em `docs/modules/M034.md`.
  Bloco Personalidade M031–M034 CLOSED.

---

## Fase 0 — Foundation

| Módulo | Nome                    | Estado     | Notas                                                             |
| ------ | ----------------------- | ---------- | ----------------------------------------------------------------- |
| M001   | Repository Audit        | `VERIFIED` | GREENFIELD confirmado; 6 docs produzidos; gate PASS               |
| M002   | Development Environment | `VERIFIED` | Repo + lockfile + gates verdes; registo em `docs/modules/M002.md` |

## Fase 1 — Game Engine

| Módulo | Nome                   | Estado     |
| ------ | ---------------------- | ---------- |
| M003   | Server Authority       | `VERIFIED` |
| M004   | World State            | `VERIFIED` |
| M005   | Deterministic Match    | `VERIFIED` |
| M006   | Action Validation      | `VERIFIED` |
| M007   | Event System           | `VERIFIED` |
| M008   | Victory Conditions     | `VERIFIED` |
| M009   | Core Engine Test Suite | `VERIFIED` |

## Fase 2 — World

| Módulo | Nome              | Estado     |
| ------ | ----------------- | ---------- |
| M010   | Map System        | `VERIFIED` |
| M011   | Terrain           | `VERIFIED` |
| M012   | Resources         | `VERIFIED` |
| M013   | Fog of War        | `VERIFIED` |
| M014   | Exploration       | `VERIFIED` |
| M015   | Perception System | `VERIFIED` |

## Fase 3 — Economy

| Módulo | Nome               | Estado     |
| ------ | ------------------ | ---------- |
| M016   | Resource Engine    | `VERIFIED` |
| M017   | Gathering          | `VERIFIED` |
| M018   | Buildings          | `VERIFIED` |
| M019   | City System        | `VERIFIED` |
| M020   | Economy Validation | `VERIFIED` |

## Fase 4 — Military

| Módulo | Nome              | Estado     |
| ------ | ----------------- | ---------- |
| M021   | Unit System       | `VERIFIED` |
| M022   | Movement          | `VERIFIED` |
| M023   | Combat            | `VERIFIED` |
| M024   | Damage Resolution | `VERIFIED` |
| M025   | Army Management   | `VERIFIED` |
| M026   | Military Tests    | `VERIFIED` |

## Fases 5–16 — AI (Foundation → Arena)

| Módulo(s) | Âmbito                                                              | Estado    |
| --------- | ------------------------------------------------------------------- | --------- |
| M027 | AI Foundation — Commander Core | `VERIFIED` |
| M028 | AI Foundation — Perception | `VERIFIED` |
| M029 | AI Foundation — Commander State | `VERIFIED` |
| M030 | AI Foundation — Discovery Engine | `VERIFIED` |
| M031 | Personalidade — AI DNA | `VERIFIED` |
| M032 | Personalidade — AI Personalities | `VERIFIED` |
| M033 | Personalidade — Unit Doctrines | `VERIFIED` |
| M034 | Personalidade — Testing | `VERIFIED` |
| M035–M042 | Strategic AI                                                        | `PLANNED` |
| M043–M045 | Player → AI Command                                                 | `PLANNED` |
| M046–M047 | AI Refutation + Override                                            | `PLANNED` |
| M048      | Confidence Engine                                                   | `PLANNED` |
| M049–M050 | Counterfactual AI                                                   | `PLANNED` |
| M051–M054 | Memory                                                              | `PLANNED` |
| M055–M058 | Player ↔ Commander                                                  | `PLANNED` |
| M059–M061 | AI Evolution                                                        | `PLANNED` |
| M062–M064 | Replay                                                              | `PLANNED` |
| M065–M068 | AI Arena                                                            | `PLANNED` |

## Fases 17–20 — Multiplayer, Competitive, Security, Observability

| Módulo(s) | Âmbito        | Estado    |
| --------- | ------------- | --------- |
| M069–M076 | Multiplayer   | `PLANNED` |
| M077–M080 | Competitive   | `PLANNED` |
| M081–M087 | Security      | `PLANNED` |
| M088–M093 | Observability | `PLANNED` |

## Fases 21–28 — Economy sim, Free mode, Solana, Compliance, Seasons

| Módulo(s) | Âmbito             | Estado                                                      |
| --------- | ------------------ | ----------------------------------------------------------- |
| M094      | Economy Simulator  | `PLANNED`                                                   |
| M095–M097 | Free Mode          | `PLANNED`                                                   |
| M098–M101 | Solana Foundation  | `PLANNED`                                                   |
| M102–M107 | USDC               | `PLANNED`                                                   |
| M108–M111 | Financial Security | `PLANNED`                                                   |
| M112–M118 | Legal / Compliance | `PLANNED`                                                   |
| M119–M124 | Seasons            | `PLANNED`                                                   |
| Fase 28   | Rewards gate       | `PLANNED` (bloqueado até SECURITY+ECONOMY+SETTLEMENT+LEGAL) |

## Fases 29–36 — Advanced

| Módulo(s) | Âmbito                  | Estado    |
| --------- | ----------------------- | --------- |
| M125–M131 | Advanced Warfare        | `PLANNED` |
| M132–M136 | Diplomacy               | `PLANNED` |
| M137–M140 | Intelligence            | `PLANNED` |
| M141–M145 | World Events            | `PLANNED` |
| M146–M150 | AI Commander SDK        | `PLANNED` |
| M151–M155 | AI Competition Platform | `PLANNED` |
| M156–M160 | Advanced Content        | `PLANNED` |
| M161–M165 | Social                  | `PLANNED` |

---

## Mapa fases-mestre ↔ fases-repo (FIX-AUDIT 2026-09-11)

O mestre (`uploads/`, #76) numera fases 0–38; o plano-repo numera 0–36.
Regra: em docs, fases-repo escrevem-se `Fase N`; fases-mestre `#N`.

Alinhadas por número: 0, 1, 3, 4, 28. Divergentes:

| Mestre (#76)        | Repo                | Nota                                     |
| ------------------- | ------------------- | ---------------------------------------- |
| 2 Map & World       | Fase 2 (M010–M015)  | repo-2 absorve a mestre-5                |
| 5 Fog & Perception  | Fase 2 (M013–M015)  | fog vive na repo-2, não numa fase 5      |
| 6–9 (AI→Commands)   | Fases 5–8           | faixas correspondentes                   |
| 10–17 (Ref→Arena)   | Fases 9–16          | faixas correspondentes                   |
| 18–21 (Mult→Obs)    | Fases 17–20         | desvio −1                                |
| 22–23 (Sim→Free)    | Fases 21–22         | desvio −1                                |
| 24–27 (Sol→Seasons) | Fases 23–27         | desvio −1                                |
| 29 Supply Lines     | —                   | SEM módulo no plano; colmatar até F-29   |
| 30–36 (Adv→Content) | Fases 29–36 (parc.) | nomes diferem; Social≈M161–M165          |
| 37 Social/Content   | Fase 36 (M161–M165) | aproximado                               |
| 38 Long-Term        | —                   | fora do plano 165; decidir se necessário |

## Ordem recomendada (estrita, sem saltos)

```text
M001 → M002 → … → M020 → M021 → M022 → M023 (VERIFIED) → M024 → … → M165
```

Próximo permitido: **M019 — City System**, apenas após autorização
explícita. Saltos, paralelização ou batch = violação do §35 (recusar).

---

_Fim de MODULE_STATUS.md_
