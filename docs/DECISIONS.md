# AI WARLORDS — ARCHITECTURAL DECISIONS (mestre #81)

> Formato por decisão: DECISION · MOTIVE · ALTERNATIVES · ADVANTAGES ·
> DISADVANTAGES · RISKS · IMPLEMENTATION. Estado: `ACCEPTED` ou `SUPERSEDED`.

---

## D-001 — Rio intransponível por defeito (F-04, FIX-AUDIT 2026-09-11)

- DECISION: manter `river.move = +Infinity` no `DEFAULT_TERRAIN_CONFIG`.
- MOTIVE: #17 diz `-movement` (direcção, sem magnitude); #13 inclui `bridge`
  como elemento próprio — pontes só têm propósito se rios bloquearem.
  Bloqueio-por-defeito + configurável (#83) é o desenho RTS clássico.
- ALTERNATIVES: penalidade finita alta (ex. 4); bloqueio hardcoded no motor.
- ADVANTAGES: semântica clara; pontes significativas; tunável por config.
- DISADVANTAGES: mapas sem pontes podem isolar regiões (responsabilidade do
  conteúdo, M011+).
- RISKS: baixo — default, não regra; M022 consome `isPassable`, não o valor.
- IMPLEMENTATION: `terrain.ts` (M011); sem mudança de código neste fix.
- ESTADO: `ACCEPTED`.

## D-002 — Vocabulário de recursos fechado; valores diferidos (FIX-AUDIT)

- DECISION: conjunto fixo {food, wood, stone, gold} (#14 "máximo 4", #99);
  "configuráveis pelo servidor" (#14) aplica-se a valores/rates (M016),
  não à identidade do conjunto.
- MOTIVE: impedir proliferação de recursos (#100 proíbe dezenas); engine
  precisa de conjunto fechado para coerência guard/loader.
- ALTERNATIVES: conjunto configurável por ruleset (rejeitado: coerência
  dinâmica sem dono até M016+).
- RISKS: baixo — reavaliar se M016 exigir conjunto variável.
- IMPLEMENTATION: `map.ts` RESOURCE_TYPES (M012); rates em M016.
- ESTADO: `ACCEPTED`.

## D-003 — Grid hexagonal (retroactivo, M010)

- DECISION: hex axial/offset (odd-r/even-r) como topologia canónica.
- MOTIVE: mestre omisso; 6-adjacência uniforme elimina ambiguidade diagonal
  (movimento/range/AI); Tiled (único shortlist com hex) confirma.
- ALTERNATIVES: quadrado 4/8-adjacência (rejeitado: diagonais ambíguas).
- IMPLEMENTATION: `map.ts` (M010). ESTADO: `ACCEPTED`.

## D-004 — Extensões compatíveis sem bump; breaking exige bump (retroactivo)

- DECISION: campos opcionais validados pelo guard (`map?`) não fazem bump;
  mudanças breaking fazem bump + migração explícita + testes.
- MOTIVE: `map?` manteve goldens M005/M009 intactos (churn zero); M004 §12.3
  visava breaking changes.
- SUPERSEDE: M004.md §12.3 passa a ler-se "bump se breaking" (texto
  histórico preservado; esta decisão é a emenda).
- IMPLEMENTATION: `world-state.ts` + guard único (M010). ESTADO: `ACCEPTED`.

## D-005 — `freezeState` estrito; configs de regras opt-out (FIX-AUDIT)

- DECISION: `freezeState` rejeita não-finitos, ciclos e input pré-congelado
  não-validado; configs de regras (ex. terreno com `Infinity`) usam
  `allowNonFinite` explícito com motivo.
- MOTIVE: estado canónico tem de ser exactamente serializável e hashable
  (F-03: `NaN`→`null` colidia hashes; F-05: ciclos via stack-overflow).
- ALTERNATIVES: validação só nos guards (rejeitado: campos extra escapam).
- RISKS: baixo — choke point único; suite total verde.
- IMPLEMENTATION: `authority.ts` + `hash.ts` (FIX-AUDIT). ESTADO: `ACCEPTED`.

## D-006 — Fog = computação pura; bloqueio forest/mountain (M013 pré-análise)

- DECISION: M013 entrega computação pura de visibilidade
  `(mapa + fontes + config) → conjuntos por viewer`, sem estado, sem vistas,
  sem memória. Bloqueio por defeito: forest + mountain; resto passa.
- MOTIVE: mestre exige fog (#4 servidor controla; #10 info compatível com
  fog; #99 MVP) mas não especifica regras de visão. BFS-por-range com
  bloqueio binário é o mecanismo mínimo testável; denso/bosque e montanha
  (sem elevation, L-22) ocluem; célula bloqueadora é visível, não expande.
  Viewers = `PlayerId` (M015 liga ao roster; M013 não verifica membership —
  camada pura). Fontes OOB saltadas (soft: posições stale não crasham).
- ALTERNATIVES: range sem bloqueio (rejeitado: terreno irrelevante);
  raycast-LOS (rejeitado: complexidade sem consumidor); visibilidade em
  estado WorldState (rejeitado: memória é M014, enforcement é M015).
- ADVANTAGES: puro/determinístico/golden-testável; config 9/9 validada
  (padrão TerrainConfig); enchimento futuro por M021 sem redesign.
- DISADVANTAGES: sem elevation, montanha é muro (rever se elevation existir).
- RISKS: baixo — sem consumidores ainda; M014/M015 validam o desenho.
- IMPLEMENTATION: `fog.ts` L2 (M013). ESTADO: `ACCEPTED`.
