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

## D-007 — Explored em WorldState; monotónico; guard em leaf (M014 pré-análise)

- DECISION: memória explored vive em `WorldState.explored?` (extensão
  compatível D-004, sem bump); acumulador puro `markExplored`; invariante
  `explored-monotonic` (viewers persistem, conjuntos só crescem);
  guard `isExploredData` em leaf L0 (`explored.ts`) + operações em
  `exploration.ts` L2; `explored` exige `map` (coerência 1 direcção).
- MOTIVE: memória tem de persistir entre ticks ⇒ estado canónico.
  Monotonicidade é o máximo enforceable agora (anti-forge de "add só o
  genuíno" exige sources stateful — M021+; L-28). Viewers persistem mesmo
  após eliminação futura (simplicidade; M023 pode revisitar com rationale).
  Sem output `fog.ts`→leaf (aresta L2→L2 proibida): `VisibilitySets` é
  gémeo estrutural, compatibilidade provada por teste de integração.
  WorldState (L1) só importa L0 ⇒ guard OBRIGATORIAMENTE em leaf.
- ALTERNATIVES: explored fora do estado (rejeitado: memória sem persistência
  é contraditória); guard em `map.ts` (rejeitado: memória≠geografia);
  viewers removíveis (rejeitado: complexidade sem dono).
- ADVANTAGES: forma canónica (ordenado+único ⇒ hash-estável); regra O(1)
  no caso comum (ref-equal); tri-state `explorationStatus` pronto p/ M015.
- DISADVANTAGES: 2 ficheiros p/ 1 módulo (forçado pela lei de camadas M009).
- RISKS: baixo — sem consumidores; M015 valida o desenho.
- IMPLEMENTATION: `explored.ts` L0 + `exploration.ts` L2 (M014).
- ESTADO: `ACCEPTED`.

## D-008 — Percepção em views.ts; morte do campo secrets; selo cirúrgico (M015 pré-análise)

- DECISION: percepção vive em `views.ts` (sem ficheiro novo — aresta
  L2→L2 proibiria `views→perception`; census 16 inalterado, consistente).
  `PerceivedState`: tick + roster (público) + viewer + visibleCells +
  exploredCells (memória integral) + map? (dims + terrain esparso só do
  visível + explored-exclusivo). `toAiPerception`/`toClientView` passam a
  `(state, viewer, visibility = {})`; kinds preservados; `toWorldView`
  intocado (estado integral server-only). CAMPO `secrets` REMOVIDO
  (mecanismo+morte, não só mecanismo); sem bump de versão (pré-M062,
  nada a migrar); selo M009 regenerado com DIFF CIRÚRGICO (só
  `stateHash` pode mudar — timelineHash/eventsHash/veredicto/contagens
  idênticos ou STOP; selo antigo preservado no registo M015 §6).
- MOTIVE: mestre #10 (KNOWN≠REAL, compatível com fog) + M004 (secrets
  morre até M015) + L-27/L-04 fecham no consumo. Membership loud
  (viewer∉roster ⇒ throw — erro de programador server-side). D-006
  dois-níveis: estrutural loud (visibilidade malformada), contexto soft
  (OOB skipado, viewer ausente vê nada, mapless ignora visão).
  Explored revela posição-sem-terreno (M014 guarda só índices; L-29 →
  M028 inferência). Spawns OMITIDOS fail-closed (sem modelo de memória;
  revisitar com gameplay de spawns). Roster público (sem fog de roster
  até dono). Sem guard de PerceivedState (derivado server-side; wire M069).
- ALTERNATIVES: campo secrets inerte (rejeitado: podridão canónica —
  cada snapshot/hash/teste pagaria `secrets: {}` para sempre, sem dono
  de remoção); `perception.ts` novo (rejeitado: views→perception é
  L2→L2); terrain-memória agora (rejeitado: M014 não guarda terreno;
  forjar seria invenção); spawns visíveis (rejeitado: memória
  inconsistente — visível-sim/explored-não).
- ADVANTAGES: morte honesta (docs exigem); primeiro refactor prodativo
  saneado com prova de difusão-zero (selo); fecha L-27+L-04; lida com
  map-blind (ARCH) selectivamente — visível integral, explored parcial,
  resto zero-sinal.
- DISADVANTAGES: blast 9 ficheiros (2 prod + selo + 6 testes); vector
  do size-test migra secrets→roster-flood (map 64² insuficiente só).
- RISKS: médio — selo regenerado (precedente perigoso; mitigado: diff
  cirúrgico + selo antigo no registo + gémeos independentes do valor).
  Sem produtores, sem inferência (M028), sem wire (M069).
- IMPLEMENTATION: `views.ts` + `world-state.ts` + testes + selo (M015).
- ESTADO: `ACCEPTED`.

## D-009 — Stockpiles em estado; config fora; sem invariante (M016 pré-análise)

- DECISION: M016 = estado + config + ops puras, zero produtores.
  `stockpiles.ts` L0 (StockpilesData + guard + `stockpileOf`; 4 chaves
  fixas espelhando RESOURCE_TYPES com cross-check em teste) +
  `economy.ts` L2 (EconomyConfig 4/4 + default neutro + `credit`/
  `debit`/`canAfford`; imports authority/map/rng/stockpiles).
  `WorldState.stockpiles?` (sem exigir mapa; holders só-shape, sem
  membership — doutrina M014). `PerceivedState.stockpile` own-only
  (views importa stockpiles L0; tripwire F-09 +1 chave). SEM
  pós-invariante (M020 é Economy Validation; ops safe-by-construction
  até lá). SEM handlers/eventos (M017 primeiro produtor).
- MOTIVE: mestre #14 (4 tipos fechados M012; valores/rates
  configuráveis) + #84 (regras fora do estado canónico) + M012
  (stockpiles/valores M016; gathering M017 muta nodes). `value` alimenta
  score futuro (L-17); `gatherYield` alimenta M017 directamente.
  Defaults NEUTROS (1/1/1/1, analogia M011: só desvios ditados pelo
  mestre; tuning em #92/playtesting). Non-roster holders invisíveis
  fail-closed (membership no consumo, L-27).
- ALTERNATIVES: guard em `resources.ts` L2 (rejeitado: world-state L1
  só importa L0 — forçamento M009/M014); caps no estado/config
  (rejeitado: storehouses sem dono — L-31 decide-by M018); valores no
  estado (rejeitado: #84); percepção full-table (rejeitado: intel
  inimiga fail-closed até M028); invariante M016 (rejeitado: M020 owns).
- ADVANTAGES: par leaf+ops simétrico a M014; config validada+golden
  sem consumidores (padrão D-006); ops exactas (overflow loud, nunca
  saturação silenciosa — exploits escondidos); zeros fail-soft.
- DISADVANTAGES: 2 ficheiros p/ 1 módulo (forçado pela lei M009);
  3.º espelho de id-shape (teste cross-check cada vez).
- RISKS: baixo — sem produtores/consumidores; M017/M018/M020 validam.
  Sem gathering (M017), sem custos (M018), sem score (L-17), sem trade.
- IMPLEMENTATION: `stockpiles.ts` L0 + `economy.ts` L2 (M016).
- ESTADO: `ACCEPTED`.

## D-010 — Gather primeiro produtor; map-preserved cede só depleção (M017 pré-análise)

- DECISION: `economy.gather` (params `{col,row}`) é o primeiro produtor:
  factory `createGatherHandler(config)` + `gatherParamsRule` (só-shape)
  - `gatherProducer` (diff via params+cellAt, facto `resource.gathered`)
    em `economy.ts` (tipos ESTRUTURAIS — L2→L2 proibido até p/ types).
    Match fecha sobre `economyConfig?` validado (seam M011; default neutro;
    ruleset-versioning diferido à 1.ª variante); `builtins`→renomeado
    `noParamHandlers` + mapa preRules (gather com params, resto intacto).
    `map-preserved` RELAXA: `mapsDepletionOnly` exportado (header igual +
    pareamento por posição via Map + terrain igual + type igual +
    amount não-crescente); mutantes inválidos (gate-unreachable) testados
    por chamada DIRECTA (execução real, §3 TESTING.md). SEM worker
    (L-32 → M021/M022: qualquer jogador, qualquer célula).
- MOTIVE: mestre #12 (GATHER no loop) + #15 (WORKER recolhe — desvio
  declarado L-32) + evento RESOURCE_GATHERED (#factos) + M012 ("M017
  muta amounts") + M016 (gatherYield). Pre=wire-shape/handler=regras
  (camada única p/ lógica; cast documenta seam, precedente match.ts).
  Guard exige length exacto + terrain⟺detail ⇒ parear por índice
  seria unprovable p/ TS (`!`); Map.get + checks explícitos cobre tudo
  sem assertion. Overflow→FAULT (tecto uint32 é escala-de-bug, L-31);
  taken-0→applied:false (yield-0 nunca no-op applied); tick intacto.
- ALTERNATIVES: amounts fora do MapData (rejeitado: contradiz M012
  "nós são geografia" + coerência cross-field pior); excepção por nome
  de handler (rejeitado: post-rules não recebem nome); totals-apenas
  (rejeitado: teleport same-type invisível — pairing fecha o buraco);
  gather via extraHandlers p/ caller (rejeitado: seam M011 manda Match
  fechar sobre config); fog-gating (rejeitado: sem grounding no mestre).
- ADVANTAGES: pairing fecha teleport (totals sós não chegavam);
  writer único com goldens exactos; facto grounded (#factos) com
  prioridade normal; composição presa em 5 (relax é rewrite, não regra).
- DISADVANTAGES: `map-preserved` admite decrease (qualquer handler pode
  depletar — handlers são código servidor trusted; M020 audita
  conservação; forja de terreno/type/aumento continua apanhada).
- RISKS: médio-baixo — primeiro invariante relaxado (mitigado: goldens
  do writer + mutantes válidos-via-dispatch + directos inválidos +
  selo intacto previsto). Sem workers (L-32), sem validação (M020).
- IMPLEMENTATION: `economy.ts` + `match.ts` + `validation.ts` (M017).
- ESTADO: `ACCEPTED`.
