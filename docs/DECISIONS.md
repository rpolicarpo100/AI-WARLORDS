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

## D-011 — Edifícios: dados+config+mecânica; caps derivados; L-31 decide (M018 pré-análise)

- DECISION: `buildings.ts` L0 (6 ids fechados #16 + BuildingsData
  counts-por-holder + guard + `countsOf` fail-soft) + `economy.ts` L2
  (BuildingsConfig por-tipo `{cost, buildTime}` + `caps` + `costOf`/
  `buildTimeOf`/`payCost`/`addBuilding`/`capOf`) + `WorldState.
buildings?` + percepção own-only. L-31 DECIDIDA: caps DERIVADOS
  (base + storages×per; default uncap base=MAX/per=0; enforcement
  →M020). Sem transições/Match/eventos (BUILD_* → M019); sem regra
  (M020 owns, composição 5).
- MOTIVE: mestre #16 (6 nomes, modular) + #20 (BUILD_* futuros) + #83
  (BUILD TIME configurável) + L-31 decide-by + M016 custos-mecânica.
  Defaults NEUTROS (custos {}, time 0, uncap — preservam status quo;
  tuning → playtesting). M009 força split L0 + dup holder-mirror
  (L0↛L0). Data-lenient/config-strict (padrão M016).
- ALTERNATIVES: instâncias {id,owner,type} (rejeitado: id/posição/hp
  ungrounded — counts chegam p/ caps+custos); caps guardados por
  holder (rejeitado: derivado single-source, sem sync-bugs);
  defaults afinados ≠0 (rejeitado: tuning inventado — doutrina
  M011/M016); caps 4-set por-recurso (rejeitado: flat chega, split
  ungrounded); transição build já (rejeitado: TIME+STARTED/COMPLETED
  implicam queue async — M019 c/ cidade); House pop-cap (rejeitado:
  ungrounded — população é HUD); percepção full-table (rejeitado:
  inimigo fail-closed → M028+).
- ADVANTAGES: simétrico M016 (leaf+ops; config-sem-consumidores
  D-006); L-31 fechada com mecânica+testes (não punt); payCost
  atómico (sem estados parciais); 4.º espelho id-shape.
- DISADVANTAGES: 2 ficheiros + espelhos (forçado M009); Storage
  default bonifica 0 (mecânica provada via customs); gather ignora
  caps até M020 (gap declarado).
- RISKS: baixo-médio — primeira semântica cap-derivado (mitigado:
  goldens custom + overflow loud + M020 enforcement). Sem
  transições (M019), sem validação (M020).
- IMPLEMENTATION: `buildings.ts` L0 (novo) + `economy.ts` L2
  (extensão) + world-state/views (M018).
- ESTADO: `ACCEPTED`.

## D-012 — Cidade: lazy-cities + queue + conclusão-no-advance; L-30 fecha sem grants (M019 pré-análise)

- DECISION: `city.ts` L0 (CityLevel 1|2|3 + QueueItem + CitiesData
  holder-map + guards + `cityOf` fail-soft) + economy L2
  (`completeConstructions` + build/upgrade handlers + `buildParamsRule`
  - 2 produtores) + seam `buildingsConfig?` + advance emendado
    (tick+conclusão, preserva-ausência) + `WorldState.cities?` + `city`
    own-only. L-30 FECHADA sem auto-grants (init stockpiles SÃO grants;
    gather bootstrap). Upgrade FREE →3 (custos/efeitos ungrounded).
    Sem found (materializa-no-uso + init); sem capture (→combate);
    sem cap de queue (state-cap auto-limita); sem regra (M020, 5).
- MOTIVE: #16 (uma cidade, 1→2→3, modular) + #20 (BUILD_STARTED/
  COMPLETED) + #83 (BUILD TIME) + #99 (1 CITY) + L-30 + M018
  (consumers D-006 aterram). Lazy-cities (precedente stockpileOf);
  conclusão-no-advance (tempo é dono do progresso; precedente
  gather multi-domínio); preserva-ausência (selo+M005 intactos);
  factos por counts-diff (exactos, ordenados, determinísticos).
- ALTERNATIVES: found + grants-config (rejeitado: founding
  ungrounded; init cobre cenários; grants sem consumidores);
  conclusão via transição separada (rejeitado: polling); lazy
  on-read (rejeitado: muta — M008 só serve veredictos puros);
  factos por queue-diff (rejeitado: itens sem id, ambíguo);
  gates por nível (rejeitado: thresholds ungrounded); buildings
  por-cidade (rejeitado: sem churn em VERIFIED); custos upgrade
  (rejeitado: neutral free); cap queue (rejeitado: state-cap chega).
- ADVANTAGES: consumers M018 aterram (costOf/buildTimeOf/payCost/
  addBuilding em dispatch); tempo+construção unidos; selo+M005
  verdes por preserva-ausência; factos reconstruíveis.
- DISADVANTAGES: 1.ª emenda de comportamento VERIFIED (fenced);
  upgrades free + níveis sem efeitos = progressão fina (theater
  até efeitos); builds free+sem-cap spamáveis até tuning.
- RISKS: médio — 1.ª emenda VERIFIED + 1.º domínio acoplado ao
  tempo (mitigado: ident E2E sem-cidade, selo, goldens conclusão
  c/ ordem, []-proofs nas suites existentes).
- IMPLEMENTATION: `city.ts` L0 (novo) + `economy.ts` L2 + `match.ts`
  - world-state/views (M019).
- ESTADO: `ACCEPTED`.

## D-013 — Validação económica: caps + conservação; gather rejeita cheio (M020 pré-análise)

- DECISION: `createEconomyRule(buildings)` em `economy.ts` L2 (tipos
  ESTRUTURAIS — L2↛L2; assignability no seam `match.ts`, precedente
  gatherParamsRule): pós-regra única `economy-cap` (após: cada
  amount ≤ `capOf(after.buildings, holder)`; holders ordenados,
  ordem RESOURCE_TYPES) + `economy-conservation` (totais por tipo
  piles+nós não-crescentes; detalhe `tipo before -> after`,
  precedente tickRule). Assume-shape (postShape-first, precedente
  rosterRule). `createWorldValidator` segue base-5; Match anexa a
  6.ª (pin economy.test reescrito 5+1 — o rewrite declarado D-010).
  `createGatherHandler(economy, buildings=DEFAULT)` (default
  uncap-neutro: zero churn): `taken > room` → applied:false
  `gather: storage full.` (tudo-ou-nada; over-cap-lençol rejeita).
  FAULT fecha o resto (writer custom/bug → HANDLER_FAULT; noop
  desde over-cap FAULTa — estados inválidos não abençoados).
- MOTIVE: D-011 (L-31 enforcement→M020; gap gather-sem-caps
  declarado) + D-010 (M020 audita conservação) + mestre #47
  (Validar resources) + #48 (resource manipulation) + R-20
  (resource exploits). Cap-check no HANDLER (D-010: camada única
  p/ lógica, Pre=wire-shape). CapOf overflow→FAULT (escala-de-bug).
- ALTERNATIVES: clamp parcial (rejeitado: takes variáveis
  complicam facto taken; atomicidade precede payCost); pré-regra
  p/ caps (rejeitado: D-010 manda lógica p/ handler); regra em
  validation.ts (rejeitado: duplicaria capOf L2 — dois sources);
  bounds de queue `remaining ≤ buildTime` (rejeitado: incompatível
  — teste M019 init-placed remaining 5 > time 2 — + ungrounded);
  counts monótonos (rejeitado: capture/destruição futuros);
  validação em createWorldState (rejeitado: data-lenient M016).
- ADVANTAGES: fecha o gap declarado M018; conservação prova
  gather-move/build-spend puros; uncap-default preserva status
  quo; sem ficheiro novo (census/LAYERS intactos).
- DISADVANTAGES: over-cap inicial só FAULTa no 1.º dispatch
  (lenient-by-design); detalhe do FAULT invisível no dispatch
  (código só — goldens directos cobrem nomes).
- RISKS: baixo-médio — 1.ª pós-regra com config + 1.º reject
  económico novo (mitigado: bateria 932 intacta prev.; goldens
  directos+dispatch; writers TEST MOCK provam FAULT).
- IMPLEMENTATION: `economy.ts` L2 + `match.ts` (M020).
- ESTADO: `ACCEPTED`.

## D-014 — Unidades: dados+config+mecânica; sem transições; L-32→M022 (M021 pré-análise)

- DECISION: `units.ts` L0 (3 tipos fechados #15 worker/warrior/
  archer + UnitInstance `{id, owner, type, hp, col, row}` + UnitsData
  `{nextId, units[]}` + guards + `unitsOf`/`unitById` fail-soft com
  cópia) + `warfare.ts` L2 (UnitsConfig por-tipo `{cost, maxHp,
damage}` #83 + strict-guard + DEFAULT neutro + `unitCostOf`/
  `maxHpOf`/`unitDamageOf` + `spawnUnit` puro full-hp, id `u${nextId}`,
  colisão→throw) + `WorldState.units?` + percepção own-only `units`
  (F-09 10/9). L-32 REPOINT→M022 (gate worker-at-node precisa
  movimento; M021 dá unidades+posições). Sem transições/Match/
  factos (UNIT_CREATED c/ criação→M025 presumível; reavalia);
  sem regra (shape cobre; composição 5+1); sem bounds no spawn
  (uints; M022 owns on-map); sem cura/dano (M024 owns).
- MOTIVE: mestre #15 (3 MVP + papéis; resto "Não implementar
  ainda") + #83 (UNIT COST/HP/DAMAGE) + #5 (HP/criação =
  engine-owned) + percepção-units (#~332) + L-32 + M018 (shape
  dados+config-sem-transições). nextId-determinístico (replay-safe;
  randomUUID proibido). Custo ESTRUTURAL (L2↛L2; payCost no seam
  M025). Copy-out (precedente cityOf). maxHp≥1 strict (0=stillborn).
- ALTERNATIVES: counts-por-holder (rejeitado: unidades são
  indivíduos posicionados); id random (rejeitado: banned +
  nondeterminismo); id derivado owner-type-n (rejeitado: instável
  sob remoção M024); config em economy.ts (rejeitado: domínio
  errado); gate worker já (rejeitado: sem movimento, quebra
  gather E2E — churn + emenda fora de âmbito); percepção
  inimiga (rejeitado: fail-closed →M028+, precedente D-011);
  cura/dano (rejeitado: M024 owns); defaults afinados
  (rejeitado: tuning inventado — 1/0/{} neutros).
- ADVANTAGES: simétrico M016/M018 (leaf+domain); spawn puro
  testável; init-placed alimenta M022 (precedente cities);
  percepção pronta p/ #332.
- DISADVANTAGES: 2 ficheiros + 3.ª cópia isUint32 (forçado M009);
  config-sem-consumidores (D-006, aceite); nextId sem cross-check
  c/ ids init-placed (colisão→loud).
- RISKS: baixo — dados puros, sem dispatch, sem regra; residual:
  posições off-map lenient até M022.
- IMPLEMENTATION: `units.ts` L0 (novo) + `warfare.ts` L2 (novo)
  - world-state/views (M021).
- ESTADO: `ACCEPTED`.

## D-015 — Movimento 1-step + passabilidade; gather exige worker (M022 pré-análise)

- DECISION: `MOVE_TRANSITION` (`unit.move`) em `warfare.ts` L2:
  `createMoveHandler(passable)` (predicado estrutural — Match L4
  injecta closure sobre terrain config validada; L2↛L2 intacto) +
  `moveParamsRule` ({id string, col/row uints}) + `moveProducer`
  (`unit.moved`, priority LOW #priorities, `{player, unit, col,
row}`) + `warfareHandlers(passable)`. Regras: sem units→
  `move: no units.`; id→`unknown unit.`; dono→`not your unit.`;
  sem mapa→`no map.`; destino→`out of bounds.`; não-adjacente
  (neighborsOf; same-cell incluído)→`not adjacent.`; bloqueado→
  `impassable.`. 1-step (sem speed stat #83; viagem = N dispatches).
  Passável = move finito (Infinity/NaN bloqueiam, fail-closed).
  Match: seam `terrainConfig?` (default neutro M011) + merge +
  paramRule + producer. Gather: worker exact-cell (unitsOf L0 em
  economy — L2→L0 ✓) senão `gather: no worker here.` (L-32 CLOSED).
- MOTIVE: #47 (Validar movement) + #48 (impossible movement,
  speed manipulation — 1-step torna multi-step impossível) +
  #factos (UNIT_MOVED) + #priorities (LOW) + M011 (move/Infinity)
  - L-32 + #15 (WORKER recolha). Hex-adjacência stagger-aware
    (neighborsOf M010). Predicado > espelho (sem dup 9 ids).
- ALTERNATIVES: multi-step/range (rejeitado: sem speed stat —
  tuning inventado); multipliers como custo (rejeitado: sem
  movement points — só finito/bloqueado); stacking-gate
  (rejeitado: ungrounded); fog-gating (rejeitado: D-010);
  config terrain em warfare (rejeitado: L2↛L2); gate adjacente
  (rejeitado: exact-cell mais simples+estrito); worker qualquer
  (rejeitado: trivialmente satisfeito — simulação fina).
- ADVANTAGES: loop worker completo (anda→colhe); impossíveis
  rejeitados loud; default M011 dá river-blocked free; zero
  churn Match-config (seam opcional neutro).
- DISADVANTAGES: fixtures gather ganham workers (churn contido
  mapful/gatherMatch/cappedMatch); viagem longa = N dispatches.
- RISKS: baixo-médio — 1.º movimento + emenda gather (mitigado:
  E2E worker/no-worker ambos os lados; goldens move+facto).
- IMPLEMENTATION: `warfare.ts` L2 + `economy.ts` (gate) + `match.ts` (M022).
- ESTADO: `ACCEPTED`.

## D-016 — Combate adjacente com dano; morte/remoção em M024 (M023 pré-análise)

- DECISION: `ATTACK_TRANSITION` (`unit.attack`) em `warfare.ts` L2:
  `createAttackHandler(unitsConfig)` + `attackParamsRule` ({id string,
  target string}) + `attackProducer` (`unit.attacked`, priority NORMAL,
  `{player, unit, target, damage}` — dano = diff hp before/after,
  genuíno) + `warfareHandlers(passable, unitsConfig)` (assinatura
  estendida — emenda declarada M022). Regras: sem units→
  `attack: no units.`; id→`unknown unit.`; dono→`not your unit.`;
  atacante a 0→`unit down.`; alvo→`unknown target.`; amigo (incl.
  self)→`not an enemy.`; alvo a 0→`target down.`; sem mapa→`no map.`;
  não-adjacente (neighborsOf; same-cell excluído, precedente
  M022)→`out of range.`. Dano = `damage` #83 do atacante, HP com
  chão 0 (forçado por isWord; unidade a 0 persiste — remoção M024).
  Dano 0 aplica (facto honesto). Match: seam `unitsConfig?` (default
  neutro M021) + merge + paramRule + producer.
- MOTIVE: M021 (damage #83 sem consumidor) + D-014 (`dano`→M024;
  `remoção` M024) + M022 (molde handler/rule/producer; neighborsOf) +
  aprovação explícita do utilizador 2026-09-11 (chão 0, só-adjacente,
  facto NORMAL). Nome/parâmetros/facto por analogia a
  `unit.move`/`unit.moved` (sem vocabulário de combate no repo —
  cunhagem aprovada).
- ALTERNATIVES: sem HP em M023 (rejeitado: facto afirmaria o
  inexistente); chão 1 (rejeitado pelo utilizador; regra inventada);
  arqueiro alcance 2 (rejeitado: sem âncora — #83 fecha config;
  papéis #15 fora do repo); range em UnitsConfig (rejeitado:
  contradiz #83); dano no produtor via config (rejeitado: diff
  before/after é genuíno e robusto); rejeitar dano 0 (rejeitado:
  targeting legal + config verdadeira = aplica).
- ADVANTAGES: #83 ganha consumidor; 0hp é estado honesto (isWord);
  diferenciação futura de alcance fica isolada em `out of range.`.
- DISADVANTAGES: assinatura warfareHandlers muda (churn contido:
  match.ts + 1 teste); produtor assume alvo presente no after (seam
  conhecido — M024 emenda se remover).
- RISKS: baixo — combate puro + validação estrita; residual: 0hp
  persiste até M024 (não ataca, não é atacado — `unit/target down.`).
- IMPLEMENTATION: `warfare.ts` L2 + `match.ts` (M023).
- ESTADO: `ACCEPTED`.

## D-017 — Resolução de dano: defesa do terreno, remoção, `unit.slain`; cura adiada (M024 pré-análise)

- DECISION: `createAttackHandler(unitsConfig, defenseOf)` com
  `DefenseOfTerrain = (terrain: string) => number` (predicado injectado
  pelo Match a partir do terrainConfig — precedente M022 `passable`;
  L2↛L2 impede warfare importar terrain). Fórmula aprovada pelo
  utilizador 2026-09-11: `net = max(0, damage − defense)` (defesa do
  terreno da célula do alvo; `max(0,…)` força — dano negativo seria
  cura, sem fonte); `hp = max(0, foe.hp − net)` (isWord, precedente
  M023); dano 0 aplica (facto honesto). Morte = remoção do alvo no
  próprio dispatch (só o alvo — sem âncora para sweep); `nextId`
  intacto. Produtor emendado (seam M023): alvo ausente no after →
  `[unit.attacked (damage = was.hp, diff genuíno), unit.slain NORMAL
{player, unit, target}]` (cunhagem + NORMAL aprovadas pelo
  utilizador 2026-09-11, analogia `unit.moved/moved`, `attacked`).
  Summary: `attacked T for NET (hp A→B)[, slain]`. `unit/target
down.` mantêm-se (0hp inicial/crafted continua rejeitado).
  `warfareHandlers(passable, unitsConfig, defenseOf)` (append,
  precedente M023).
- MOTIVE: D-014 (`dano`→M024; cura sem fonte — audit §7) + D-016
  (remoção M024; seam produtor) + M011 (defense existe: mountain 2,
  forest 1 — sem consumidor; tooltip mente) + M022 (molde
  predicado-injectado) + aprovação explícita do utilizador 2026-09-11
  (fórmula, cunhagem `unit.slain` NORMAL, cura adiada).
- ALTERNATIVES: defesa ignorada (rejeitado pelo utilizador; config
  sem consumidor persistia); sweep de 0hp (rejeitado: sem âncora —
  handler resolve o alvo do dispatch); retaliação/armadura (adiado
  M025+: sem config #83 / sem âncora); cura mecânica (adiado: sem
  fonte; user aprovou adiamento); facto `unit.died` (pretermitted —
  user escolheu `slain`); sem facto (rejeitado pelo utilizador;
  morte de 1ª classe no log); `maxHp`-heal em defesa alta
  (rejeitado: `max(0,…)` força, cura sem fonte).
- ADVANTAGES: defense ganha consumidor (tooltip passa a verdade);
  morte é remoção honesta (sem cadáveres-lógicos); facto de morte
  permite animação P2; fórmula mínima sem stats novas.
- DISADVANTAGES: assinatura warfareHandlers muda 2.ª vez (churn
  contido: match.ts + testes); testes M023 de killing-blow reescritos
  (0hp→remoção — emenda declarada); comentário terrain "M023"
  corrigido para M024.
- RISKS: baixo — combate puro + gate estrito; residual: unidades
  0hp iniciais movem (M022 não checa hp — M022 owns, fora de âmbito);
  remoção muda `unknown target.` para ids mortos (honesto: já não
  existem).
- IMPLEMENTATION: `warfare.ts` L2 + `match.ts` (M024).
- ESTADO: `ACCEPTED`.

## D-018 — Treino de unidades: `unit.train`, custo #83, treasury injectada (M025 pré-análise)

- DECISION: `TRAIN_TRANSITION` (`unit.train`) em `warfare.ts` L2:
  `createTrainHandler(unitsConfig, treasury)` + `trainParamsRule`
  ({type string, col/row uint32}) + `trainProducer` (`unit.trained`,
  NORMAL, `{player, unit, type, col, row}` — id/unidade lidos do
  after; id = `u${before.nextId ?? 0}`, contrato spawnUnit) +
  `warfareHandlers(passable, unitsConfig, defenseOf, treasury)`
  (append, precedente M023/M024). Regras: `unknown unit type.` /
  `no map.` / `out of bounds.` (precedente M022) / `cannot afford.`
  (precedente build); paga via treasury e faz spawnUnit (full-hp,
  id `u${nextId}`); summary `trained T ID at C,R`. `UnitTreasury =
{canAfford, pay}` injectada pelo Match (closures economy —
  L2↛L2 impede warfare importar payCost; precedente M022).
  NORMAL = precedente build.started (produção). Cunhagem
  `unit.train/trained` aprovada pelo utilizador 2026-09-11
  (D-014 `UNIT_CREATED` presumível REAVALIADO para dotted-minus
  convenção repo). Sem regra nova (composição 5+1); sem ficheiro
  novo; sem bump ruleset; cenário intocado.
- MOTIVE: #5 (criação engine-owned) + #83 (custo sem consumidor) +
  D-014 (criação→M025) + M021 (spawnUnit puro; UnitCost//Cost) +
  M016/M017 (payCost/canAfford; padrão createBuildHandler:
  canAfford→pay→efeito) + M020 (conservação: débitos passam) +
  aprovação explícita do utilizador 2026-09-11 (verbo `train`).
- ALTERNATIVES: `unit.create/created` (pretermitted — user escolheu
  `train`); `unit.recruit/spawn` (idem); handler em economy.ts
  (rejeitado: UnitsConfig é L2 — espelho duplicava; coesão
  unit.* em warfare); importar payCost (rejeitado: L2↛L2);
  exigir edifício/passabilidade/adjacência (rejeitado: sem âncora);
  stacking-gate (rejeitado: M022 CUT precedente); cap/upkeep
  (CUT: sem âncora — 200 da página fica CONCEPT); cura/regem
  (fora de âmbito — M024 adiou).
- ADVANTAGES: #83 totalmente consumido (custo+hp+dano); treino
  atómico paga+gera; facto de 1ª classe p/ UI futura; zero churn
  de assinaturas existentes (só append).
- DISADVANTAGES: warfareHandlers com 4 params (precedente
  positional mantido); spawn em rio/montanha permitido (sem
  âncora p/ gate — residual declarado).
- RISKS: baixo — criação pura + gate estrito; residual: colisão
  de id (HANDLER_FAULT fail-stop, precedente spawnUnit); sem
  botão na página (visual futuro, fora do módulo).
- IMPLEMENTATION: `warfare.ts` L2 + `match.ts` (M025).
- ESTADO: `ACCEPTED`.

## D-019 — Testes militares: drills no sim + suite transversal, zero mecânica (M026 pré-análise)

- DECISION: M026 fecha a Fase 4 (gémeo de M020) como módulo
  PURO DE TESTES: (A) `sim/playtest.ts` ganha candidatos
  `unit.attack` (foe adjacente via neighbours bot-side, oráculo
  = engine) + `unit.train` (3 tipos × célula aleatória) +
  `DRILL_UNITS` (maxHp 5/12/8 == cenário vale.tmj; custos/dano =
  reuse dos números test-proven customUnits, fixture de drill
  etiquetada — tuning real é #92) + invariantes militares
  (hp≤maxHp, ids únicos+sufixo<nextId, nextId monótono) +
  evidência (applied por-tipo, kills/dano/treinos — medição,
  sem thresholds); (B) `src/engine/military.test.ts` novo
  (precedente phase1-gate/harness): journey train→attack→slain→
  train (continuidade nextId) + determinismo de batalha (twin
  Matches, snapshot+eventos idênticos). Sem mudanças em
  produção (nenhuma mecânica ancorada pendente); sem thresholds
  inventados; outputs sim regenerados e commitados como prova.
- MOTIVE: lacunas OBSERVÁVEIS — sim nunca despacha attack/train
  (grep); nenhuma journey compõe 3+ transições unit.* (máx
  actual = 2, montanha M024); config neutra (dmg 0) impede kills
  no sim; cenário Tiled já ancora maxHp 5/12/8; comentário
  DEFAULT ("tuning belongs to #92/playtesting"); M020 (molde de
  fecho de fase); TESTING.md §1 (B. Integration transversal).
- ALTERNATIVES: nova pós-regra militar (rejeitado: sem âncora —
  conservação de unidades não faz sentido; seria invenção);
  drills com config default (rejeitado: dmg 0, zero kills —
  drills nominais); números novos de tuning (rejeitado: #92
  owns); journey em warfare.test.ts (preterido: suite
  transversal própria, precedente harness).
- ADVANTAGES: arco militar provado como TODO (composição +
  escala + determinismo); sim vira gate militar real (exit 1
  em violações); 100×4 preservado por construção (zero prod).
- DISADVANTAGES: outputs sim mudam (re-medição honesta);
  DRILL_UNITS duplica números de teste (etiquetado, #92 owns).
- RISKS: baixo — só testes; residual: bots maus estrategas
  (irrelevante — oráculo é o engine, invariantes é que contam).
- IMPLEMENTATION: `sim/playtest.ts` + `src/engine/military.test.ts` (M026).
- ESTADO: `ACCEPTED`.

## D-020 — Commander Core: entidade data-first, sem comportamento (M027 pré-análise + voto)

- DECISION: `commanders.ts` NOVO (LEAF L0, zero imports —
  molde units.ts): `CommanderRecord {id, owner, active}`
  (strings holder-id, NÃO PlayerId — L0↛L0; `active`
  armazenado, semântica→M029+ — precedente M014→M015) +
  `CommandersData {schemaVersion, nextId, commanders[]}`
  (array+nextId, precedente units) + guards strictos (id
  único, version exacta, nextId word) + `commandersOf`/
  `commanderById` fail-soft com cópia (precedente cityOf).
  `WorldState.commanders?` + init + guarda (molde units;
  "Init-placed until M029+ lifecycle"). Percepção own-only
  `commanders` em views.ts (molde units; inimigo fail-closed
  →M028+; tripwire F-09 11/10). Suite `commanders.test.ts`
  nova. Sem commission/transições/config/Match (data-first
  votado; criação→dono do lifecycle — precedente M018→M019);
  sem regra (shape cobre — shapeRule→isWorldState); sem sim/
  página/cenário (init-placed; state.json intocado).
- MOTIVE: voto explícito do utilizador 2026-09-11 (data-first
  id/owner/active) + M021 (molde L0 zero-imports + WorldState
  slot + own-only) + M016 (bounds espelhados, teste
  cross-check) + M018 (data-sem-criação até M019) + M015
  (tripwire F-09) + constraints (sem LLM, zero deps AI).
- ALTERNATIVES: holder-keyed map (preterido — array+nextId
  honra id/voto + precedente units); campo `name` (rejeitado:
  conteúdo ungrounded; identidade profunda é M031+);
  commissionCommander puro (rejeitado: "sem comportamento"
  votado; mecânica vive L2 — precedente spawnUnit); orders/
  queue (M043+ own); transições (rejeitado: data-first);
  wiring Match (rejeitado: nada consome ainda).
- ADVANTAGES: identidade strict+testada p/ M028+ se
  agarrarem (sem player-ids soltos no stack AI); fail-closed
  inimigo por construção; 100×4 por construção.
- DISADVANTAGES: sem path de criação (init-only — honesto,
  declarado); `active` sem leitor (forward-storage).
- RISKS: baixo — dados puros + guards; residual: `active` sem
  semântica até M029+ (declarado); init-only até lifecycle owner.
- IMPLEMENTATION: `commanders.ts` + `world-state.ts` +
  `views.ts` + `commanders.test.ts` + tripwire (M027).
- ESTADO: `ACCEPTED`.

## D-021 — Percepção INFERRED: terrain-memory em PerceivedMap (M028 pré-análise)

- DECISION: `PerceivedMap.inferred {index→terrain}` (explored E
  não-visível → terreno lembrado; memória==actual — terreno
  imutável, grep-prova zero writes; OOB skip-soft D-006;
  disjunto de visible por construção). Só `views.ts` (fence
  M015: sem ficheiro novo; census intacto); builders herdam;
  L-29 CLOSED. Golden + 3 testes novos; map-keys resource ×2.
- MOTIVE: M015 (INFERRED/UNKNOWN→M028; L-29→M028) + D-008
  (posição-sem-terreno até inferência) + #10 (KNOWN≠REAL) +
  D-006 (contexto soft) + M014 (memória de índices).
- ALTERNATIVES: mudar `explored` p/ mapa (rejeitado: shape é
  M014); chave top-level (rejeitado: churn F-09 + mapless —
  scoped-in-map auto-ausente); intel inimiga em M028
  (rejeitado: "M028+" é intervalo, inferência é a atribuição
  explícita; regras de visão sem âncora); memória de amounts
  (rejeitado: mutáveis, staleness sem âncora); memória de
  spawns (rejeitado: D-008 sem modelo); guard PerceivedState
  (rejeitado: M015 wire M069).
- ADVANTAGES: commanders planeiam sobre terreno lembrado;
  zero churn estado/transições (vista derivada); UNKNOWN
  provável (ausente em todo o lado).
- DISADVANTAGES: página/sim ignoram a chave até consumidores
  (aditivo inofensivo).
- RISKS: baixo — dados derivados, edges soft; residual: nenhum
  novo (D-006 preservado).
- IMPLEMENTATION: `views.ts` + `views.test.ts` + `resources.test.ts` (M028).
- ESTADO: `ACCEPTED`.

## D-022 — Ticks morrem, prompts mandam (redesign user-mandatado, pré-M029)

- DECISION: cada applied dispatch gasta 1 prompt do caller
  (rejeitados grátis); `match.advance`+tick removidos TOTAL
  (WorldState, envelope, veredicto, percepção, sim, página —
  precedente remoção M015); budget `promptsPerPlayer` (defeito
  10, uint32 ≥1; sem unlimited — free-mode M09X owns);
  Match semeia slot ausente; sem prompts = dispatch rejeitado
  `validation: [prompts-exhausted]` (só observa); todos
  bloqueados + indeciso = draw `prompts-exhausted` (#46
  reformado); filas city descem 1/applied SÓ do dono
  (owner-only votado); completion+spend em postStep injectado
  no wrapper (precedente treasury; kernel M003 intocado);
  `prompts-ledger` substitui tickRule no base-5 (pin rewrite
  declarado); PerceivedState -tick +prompts own-only; página
  -Advance -tick +header budget; sim sem advance (passes,
  budget fixture 200, csv step); selo cirúrgico estilo M015.
  Out-of-band (sem renumeração); pacing "15min" = nota, não
  mecânica (motor sem relógios).
- MOTIVE: 4 votos explícitos do utilizador 2026-09-11
  (cada-dispatch; remover; jogador-bloqueia; X=10≈15min;
  owner-only; sem unlimited; header) + M015 (remoção total
  - selo cirúrgico) + M020 (pin rewrite + conservação) +
    M022 (injecção) + M016/M021/M027 (molde L0).
- ALTERNATIVES: ticks convivem (rejeitado pelo user);
  relógio global filas (preterido — user votou owner-only);
  unlimited já (rejeitado — M09X); completion por-handler
  (rejeitado: 8+ handlers); completion no kernel (rejeitado:
  M003 intocado); spend trusted sem regra (rejeitado: ledger
  poroso); tick congelado a 0 (rejeitado: podridão M015).
- ADVANTAGES: tempo==acção (design legível); budget
  configurável salva testes/escala; exaustão drillável.
- DISADVANTAGES: churn gigante (testes+selo+página);
  X=10 + filas owner-only = forbidding (tuning é #92).
- RISKS: médio — núcleo tocado (mitiga: suite+selo+sim);
  residual: tuning 10 por validar em jogo real (#92).
- IMPLEMENTATION: PROMPTS out-of-band (P1–P8).
- ESTADO: `ACCEPTED`.

## D-023 — Commander State: lifecycle completo, `active` marcador, roster N (M029 pré-análise + voto)

- DECISION: ficheiro NOVO `commander-state.ts` (L2: importa
  commanders/authority L0 + world-state L1 type-only, edges
  downward); 3 transições despacháveis (custo 1 prompt cada —
  custo do dispatch, não efeito): `commander.commission` (sem
  params — precedente upgrade/noParamHandlers; mint `c${nextId}`
  owner=caller active=true; bootstrap sobre dados ausentes;
  nextId no tecto word→applied:false); `commander.activate` /
  `commander.deactivate` (params {id} — commanderIdParamsRule
  wire-shape; id desconhecido→applied:false; owner≠caller→
  applied:false fail-closed; já-no-estado→applied:false).
  Produtores diff-estrutural (molde completionProducer):
  `commissionedProducer` (ids novos→`commander.commissioned`) +
  `stateFlipProducer` (flips→`commander.activated/deactivated`).
  Wiring Match: merge commanderHandlers + COMMISSION em
  noParamHandlers + paramRules + producers.set ×3
  (completionProducer boleia grátis, sem factos). `active` é
  MARCADOR sem efeito motor (votado; dentes→M043+/M035+);
  roster N por holder sem cap (votado; MAX_STATE_BYTES
  auto-limita, precedente filas city). Sem seeding no Match
  (commission é acção do holder); sem post-rule (shape cobre,
  sem fluxo cross-section); views/world-state/validation/
  sim/página/cenário intocados.
- MOTIVE: 3 votos explícitos do utilizador 2026-09-11 (lifecycle
  completo; marcador sem efeito; N por holder) + M019 (molde
  lifecycle: criação+transições+Match+eventos) + M027 (contrato
  dados: guard global-único, bootstrap fail-soft) + M028
  ("M029+" é intervalo; sem cross-imports) + #21 (Commander
  possui… — resto→M031+) + #29 (hierarquia→FUTURE).
- ALTERNATIVES: lifecycle dentro de commanders.ts (rejeitado:
  L0 leaf zero-imports; handlers precisam WorldState — molde
  economy L2); `active` gate de dispatches (rejeitado pelo
  user); 1-per-holder (rejeitado pelo user — master singular
  preterido a favor de roster); auto-seed no Match
  (rejeitado: churn selo + commission é acção do holder);
  funções directas sem dispatch (rejeitado: sem eventos/
  ledger — molde M019 é dispatch); cap de roster (rejeitado:
  sem âncora no master).
- ADVANTAGES: ciclo de vida fechado (commission⇄flips);
  eventos auditáveis; owner-only fail-closed; zero churn
  leitores existentes (selo intacto).
- DISADVANTAGES: transições custam prompts sem efeito
  mecânico até M043+ (marcador honesto); roster sem cap
  (spam limitado só por bytes).
- RISKS: baixo — transições novas, leitores zero; residual:
  `active` sem leitor até ordens/IA (M043+/M035+).
- IMPLEMENTATION: `commander-state.ts` + `commander-state.test.ts`
  - `match.ts` (wiring) + `phase1-gate.test.ts` (2 pins) (M029).
- ESTADO: `ACCEPTED`.

## D-024 — Discovery Engine: pipeline canónico visibilidade→explored→factos (M030 pré-análise + voto)

- DECISION: `VISION_RANGE = 2` fixo em `fog.ts` (votado;
  canoniza o 2 ad-hoc das tools) + `sourcesOf(units)`
  (L2, edge novo fog→units L0; vivos hp>0 + owner
  isPlayerId, resto assume-shape — guard units dá
  coords word, OOB skip-soft no flood). Acumulação no
  postStep do Match (injecção L4; L2↛L2 proíbe
  warfare→exploration/fog): mapless→skip (precedente
  M015); senão visibility=computeVisibility(stepped.map,
  sourcesOf(stepped.units)) + markExplored(stepped.explored
  ?? fresh, visibility). Produtores em `exploration.ts`
  (edge novo exploration→map L0): `discoveredProducer`
  (diff explored por viewer ordenado + índices
  ascendentes; payload {player, col, row, terrain} via
  map.cells[index] guarda-undefined, molde M028; LOW) +
  `spottedFacts` puro (before/after units + before/after
  VisibilitySets + width; spotted⟺inimigo∧after-vê-pos_
  after∧¬before-vê-pos_before; payload {player, unit,
  owner, col, row}; NORMAL — #33 ENEMY SCOUT) + closure
  em match.ts que computa as 2 visibilidades (L4 pode
  importar fog+exploration; recompute aceite, medido).
  Ride universal: discovery+sightings após
  completionProducer p/ TODA a transição (ordem: domain,
  completions, discoveries, sightings, extras —
  declarado); noop TAMBÉM descobre (observar revela;
  PROMPTS-consistente: noop é acção; postStep é
  name-blind por desenho). Sem seam de config
  (DEFAULT_FOG_CONFIG; range-via-config rejeitado).
  Eventos globais (factos; redacção é das views).
- MOTIVE: 3 votos explícitos do utilizador 2026-09-11
  (motor completo; células+inimigos; fixo 2) + #10
  (eventos observados; KNOWN≠REAL) + #33 (ENEMY
  SCOUT→NORMAL; LOW≈movimento p/ células) + #11
  (eventos SÃO os factos; tags confidence→depois) +
  M013/M014/M015/M028 (peças do pipeline) + M022
  (injecção L4; predicado>espelho) + PROMPTS (postStep
  universal + ride-all) + M019 (molde wiring).
- ALTERNATIVES: acumular-sem-factos / só-puros
  (rejeitados pelo user); acumulação no handler move
  (rejeitado: L2→L2); spotted-por-proxy-explored
  (rejeitado: falha manobras em terra conhecida —
  inexacto); mirror de fog em exploration (rejeitado:
  divergência); range-via-config / range-1 / só-células
  (rejeitados pelo user); resource.discovered (rejeitado:
  #71 FUTURO); seeding explored na génese (rejeitado:
  descoberta ganha-se por dispatch + churn selo);
  perceive default canónico (rejeitado: views↛fog L2→L2;
  caller usa sourcesOf); skip-noop (rejeitado: postStep
  name-blind; observar revela).
- ADVANTAGES: gap fechado (explored com writers);
  IA recebe observados (#10); tools podem migrar p/
  sourcesOf; sightings exactos (diff visibilidade).
- DISADVANTAGES: churn PROMPTS-scale (goldens ganham
  explored+eventos, re-lock declarado); 3 fog-computes
  por dispatch (medido no sim).
- RISKS: médio — postStep universal tocado (mitiga:
  suite+selo+sim+timing); residual: tuning visão 2
  (#92); sem lost-contact; corpses—n/a (slain removidos).
- IMPLEMENTATION: `fog.ts` (RANGE+sourcesOf) +
  `exploration.ts` (discovered+spottedFacts) + `match.ts`
  (postStep+closure+ride) + testes + re-lock goldens (M030).
- ESTADO: `ACCEPTED`.

## D-025 — DNA data-first embutido no record (M031 pré-análise + voto)

- DECISION: `dna.ts` NOVO (LEAF L0, zero imports — molde
  commanders): `DnaTraits` {10 traços lowercase, ordem do
  master, 0–100 int} + DNA_MIN/MAX + TRAIT_IDS +
  isDnaTraitId + isDnaTraits (10 presentes + int-range;
  extras ignorados — leniência M015; sem soma-fixa — sem
  âncora); forward-placed p/ M032+ (precedente M014→M015;
  zero importadores prod — só testes + mirror).
  `CommanderRecord.dna?` (embed votado; guard-mirror
  TOTAL em commanders.ts — L0↛L0 proíbe importar dna.ts;
  battery cross-check 40+ em commanders.test.ts,
  divergência falha loud — M016). Sem slot novo (dna
  boleia commanders; shape cobre); views zero churn
  (records integrais fluem; F-09 é top-level-keys);
  commission sem dna (M029 owns, sem params); sem writer
  (init-placed — M027; writer→FUTURO unsettled); sem
  consumers (influência→M032+/M035+; #25 ≠SKILL noted).
- MOTIVE: 3 votos explícitos do utilizador 2026-09-11
  (data-first; extend record; 0–100) + #22 (10 params;
  influencia-nunca-determina) + #21 (cada Commander
  possui DNA) + #25 (PERSONALITY≠SKILL) + M027 (molde
  data-first) + M016 (espelhos) + M015 (leniência) +
  M028 ("M031+" é intervalo) + constraints.
- ALTERNATIVES: secção standalone (rejeitada pelo user);
  tudo-em-commanders.ts sem dna.ts (rejeitado: voto
  menciona dna.ts; canónico forward-placed); floats 0–1
  / 0–255 (rejeitados); soma-fixa (rejeitada: sem
  âncora); exact-keys estrito (rejeitado: M015);
  writer em M031 (rejeitado pelo user); `name` junto
  (rejeitado: ainda-cut, sem dono); import
  commanders→dna (rejeitado: L0↛L0).
- ADVANTAGES: vocabulário canónico fechado; record
  retro-compat (dna opcional — suite M027 intacta);
  zero churn validadores/views/Match.
- DISADVANTAGES: mirror duplica 10+guard (drift só
  por teste); folha sem importadores prod até M032+;
  sem writer (dna só via init).
- RISKS: baixo — dados puros + guards; residual:
  mirror-drift (mitiga: battery); influência por
  definir (M032+).
- IMPLEMENTATION: `dna.ts` + `dna.test.ts` +
  `commanders.ts` (embed+mirror) + `commanders.test.ts`
  (battery) + `views.test.ts` (1 pin) + phase1-gate
  (2 pins) (M031).
- ESTADO: `ACCEPTED`.

## D-026 — Personalities data-first: rótulo + presets DNA votados (M032 pré-análise + voto)

- DECISION: `personalities.ts` NOVO (LEAF L0, zero imports):
  PERSONALITY_IDS (5, ordem #23, lowercase), PersonalityId,
  isPersonalityId, PersonalityDna (shape estrutural 10
  números — mirror de DnaTraits, L0↛L0),
  PERSONALITY_DNA_PRESETS (matriz 5×10 VOTADA 2026-09-11;
  base 50, primário ±30–35, múltiplos de 5) +
  dnaPresetOf (cópia fresca; id desconhecido→undefined
  fail-soft, molde commanderById). Teste-pino: presets
  satisfazem isDnaTraits ∀5 (import dna em teste ✓).
  `CommanderRecord.personality?` (embed votado; union
  mirror + isMirroredPersonalityId; battery cross-check —
  M016). Precedência VOTADA p/ futuros consumidores:
  record-DNA ganha ao preset (especificidade; #22).
  Sem slot novo; views/Match/validation zero churn
  (F-09 top-level); commission sem personality (M029);
  sem writer (init-placed); sem behavior (M033+/M035+).
- MOTIVE: 5 votos explícitos do utilizador 2026-09-11
  (data-first; presets; extend; matriz; record-wins) +
  #23 (5 nomes+epítetos; "Inicialmente"→extensível c/
  rationale), #25 (≠SKILL), #22 (influencia≠determina),
  M031 (molde data-first + mirror + forward-placed),
  M016 (espelhos), M027 (init-placed), constraints.
- ALTERNATIVES: só-rótulo (preterido pelo user —
  presets votados); presets inventados sem voto
  (rejeitado: metodologia — matriz proposta e
  APROVADA); secção standalone (rejeitada); preset-wins
  (rejeitado); writer/behavior em M032 (rejeitado);
  DNA-imposto (rejeitado: #22 + record-wins);
  desconhecido→throw (rejeitado: lookup fail-soft).
- ADVANTAGES: vocabulário fechado + defaults
  canónicos votados; record retro-compat; zero churn
  motor; consumers futuros com lookup pronto.
- DISADVANTAGES: 2.º mirror em commanders.ts; folha
  sem importadores prod até M033+; matriz tuning
  humano (#92).
- RISKS: baixo — dados puros; residual: drift matriz
  vs tuning real (#92); "Inicialmente" = extensão
  futura quebra goldens (declarado).
- IMPLEMENTATION: `personalities.ts` +
  `personalities.test.ts` + `commanders.ts`
  (embed+mirror) + `commanders.test.ts` (battery) +
  phase1-gate (2 pins) (M032).
- ESTADO: `ACCEPTED`.

## D-027 — Doctrines data-first: rótulo + deltas DNA votados (M033 pré-análise + voto)

- DECISION: `doctrines.ts` NOVO (LEAF L0, zero imports):
  DOCTRINE_IDS (6, ordem #24, lowercase-hífen — molde
  town-center) + DoctrineId + isDoctrineId + DoctrineDeltas
  (shape estrutural 10 int — mirror de DnaTraits, L0↛L0),
  DELTA_MIN/MAX (−30/+30), DOCTRINE_DNA_DELTAS (matriz
  6×10 VOTADA 2026-09-11; neutro 0, primário ±25–30,
  múltiplos de 5, frozen) + dnaDeltasOf (cópia fresca;
  desconhecido→undefined fail-soft, molde dnaPresetOf).
  `CommanderRecord.doctrine?` (embed votado; union mirror,
  isMirroredDoctrine, battery — M016). Composição VOTADA
  p/ futuros consumidores (só REGISTADA — composer seria
  L2+, fora do âmbito; L0↛L0 impede-o na leaf): efetivo =
  clamp(base + deltas, 0–100), base = record-DNA ??
  preset-personalidade ?? neutro-50 (emperor votado).
  Sem slot novo; views/Match/validation zero churn
  (F-09 top-level); commission sem doctrine (M029);
  sem writer (init-placed); sem behavior (M034+/M035+).
- MOTIVE: 5 votos explícitos do utilizador 2026-09-11
  (data-first; perfis; extend; matriz; aditivo) +
  #24 (6 nomes+epítetos) + #21 (cada Commander possui
  DOCTRINE) + #22 (influencia≠determina) + M032 (molde
  presets-votados + mirror + forward-placed) + M016/M027,
  constraints (layering dita record-only).
- ALTERNATIVES: só-rótulo (preterido — perfis votados);
  perfis inventados sem voto (rejeitado — matriz proposta
  e APROVADA); pesos táticos/verbos (rejeitado: verbos
  = mais superfície inventada; DNA-deltas reutiliza os
  10 eixos votados); standalone (rejeitada); override/
  ignore (rejeitados); composer em M033 (rejeitado:
  L2+ = scope-creep; consumidores executam); writer (off).
- ADVANTAGES: vocabulário fechado + modulação canónica;
  cadeia especificidade completa (record→preset→neutro
  →deltas); zero churn motor; consumers com tudo pronto.
- DISADVANTAGES: 3.º mirror em commanders.ts; folha sem
  importadores até M034+; tuning 60 deltas (#92).
- RISKS: baixo — dados puros; residual: tuning matriz;
  composição por executar (M035+).
- IMPLEMENTATION: `doctrines.ts` + `doctrines.test.ts` +
  `commanders.ts` (embed+mirror) + `commanders.test.ts`
  (battery) + phase1-gate (2 pins) (M033).
- ESTADO: `ACCEPTED`.

## D-028 — Personality harness: drill sim + suite transversal (M034 voto)

- DECISION: `sim/personality-drill.ts` NOVO (toolchain,
  fora do coverage — M026): Matches reais × seed;
  init c0/c1 triples distintos; bots commission+flips+
  noop (oráculo=engine); 7 invariantes pós-applied
  (guard live, canonical agreement, triple-estável,
  minted-sem-triple, ids/nextId, JSON round-trip,
  perceção sem-leak/sem-loss); report próprio
  (determinístico exceto ms; exit 1 se violations);
  script `sim:personality`. Suite nova
  `src/engine/personality.test.ts` (2, molde
  military.test.ts): journey 6 applied + gémeos.
  Zero prod; bundle byte-idêntico; selo intacto.
- MOTIVE: voto harness 2026-09-11 + fecho bloco
  M031–M034 + M026 (molde módulo-testes) + TESTING
  §1B + D-023 (commission-sem-params) + D-027
  (composição→M035+).
- ALTERNATIVES: estender playtest.ts (rejeitado:
  golden 1200/500/0 intacto); executar composição
  no drill (rejeitado: D-027 reserva M035+); 3.º
  teste rejects (rejeitado: commander-state.test
  cobre; M026 cortou); thresholds (rejeitado: sem
  âncora — M026).
- ADVANTAGES: bloco provado end-to-end; dados vivos
  sob dispatch real; regressão futura fail-loud.
- DISADVANTAGES: report com `ms` honesto (diff
  exclui ms); drill não typecheckado (tsc só src —
  rede: eslint + execução, M026).
- RISKS: baixo — só testes; residual: bots maus
  estrategas (irrelevante — invariantes contam);
  ms instável (mitiga: prova sans-ms).

## D-029 — Effective-DNA composer L1 (M035 executa D-027)

- DECISION: `src/engine/effective-dna.ts` NOVO (L1 —
  importa 4 leaves L0, strictly-downward): NEUTRAL_DNA
  (10×50 frozen + conformance = dnaPresetOf emperor
  votado) + effectiveDnaOf(record): DnaTraits (total,
  pura): base = record-dna ?? preset ?? NEUTRAL;
  deltas = doctrine ?? zero; clamp(base+delta,0–100)
  por traço. Labels desconhecidos fail-soft (leaf
  undefined = ausente). Output fresco; input nunca
  mutado. Zero wiring (consumers M036+).
- MOTIVE: regra + schedule AMBOS votados (M033 5.º
  voto: aditivo executado por M035+; D-027) + L0↛L0
  (composer fora das leaves) + phase1-gate
  (downward; L1 sobre L0) + M029 (bare records).
- ALTERNATIVES: composer nas leaves (rejeitado:
  L0↛L0); `dnaPresetOf(emperor)!` inline (rejeitado:
  `|undefined` força cast ou branch imensurável —
  NEUTRAL local + conformance cobre 100%); wiring
  já (rejeitado: sem consumer — invenção); tactic
  weights (rejeitado: D-027).
- ADVANTAGES: primeira semântica executável do
  bloco; 84-combo battery prova DNA-válido-∀;
  goldens travam matrizes votadas.
- DISADVANTAGES: NEUTRAL duplica 50s (mitiga:
  conformance test vs emperor); folha L1 sem
  importadores até M036+.
- RISKS: baixo — pura+total; residual: tuning (#92).

## D-030 — Player assessment pura L2 (M036 voto assessment)

- DECISION: `src/engine/assessment.ts` NOVO (L2 —
  L0s + effective-dna/world-state-type, downward):
  assessPlayer(state, holder, statsOf) pura:
  military {units, totalHp, totalDamage} (statsOf
  INJECTADO — molde M022; unknown-type dano 0
  fail-soft); economy {stockpile, buildings,
  cityLevel} (getters fail-soft reuse: stockpileOf,
  countsOf, cityOf); commanders {count, active,
  avgEffective} (commandersOf + média EXATA por
  traço sobre effectiveDnaOf; zero commanders →
  undefined honesto). AverageDna estrutural floats
  (NÃO é DnaTraits — bounds-battery, molde M033).
  Zero wiring (consumers M037+).
- MOTIVE: voto assessment 2026-09-11 + #7
  (ENGINE=FACTS, AI=DECISIONS) + M022 (injecção) +
  M015 (leniência) + getters L0 + M035 (substrato).
- ALTERNATIVES: importar warfare p/ damage
  (rejeitado: L2↛L2 — injecção resolve); scalar
  strength (rejeitado: pesos sem âncora → FUTURO);
  rounding da média (rejeitado: floats exatos,
  consumers decidem); threat/foe-modeling
  (rejeitado: perception-side, FUTURO); wiring já
  (rejeitado: sem consumer).
- ADVANTAGES: 1.º tijolo STRATEGIC ENGINE; só
  contagens/somas/médias (zero invenção); reuse
  total getters.
- DISADVANTAGES: AverageDna duplica shape
  (molde mirrors); statsOf closure por chamada.
- RISKS: baixo — pura; residual: tuning (#92).

## D-031 — Commander stance L2 (M037 votos stance+margem)

- DECISION: `src/engine/stance.ts` NOVO (L2 —
  commanders/dna L0 + effective-dna L1, downward):
  STANCE_IDS (fixo-5: aggressive/defensive/
  expansionist/diplomatic/balanced) + isStanceId +
  STANCE_MARGIN = 15 (VOTADO) + stanceOf(record):
  effective via effectiveDnaOf (1.º CONSUMER M035);
  dominante entre aggression/defense/expansion/
  diplomacy vence se max−2.º ≥ 15, senão balanced
  (empates → balanced determinístico). Pura, total.
  Zero wiring (consumers M038+).
- MOTIVE: 2 votos 2026-09-11 (stance; convenção
  margem-15) + #7 (AI=DECISIONS) + M035 (substrato),
  phase1-gate (downward).
- ALTERNATIVES: thresholds por traço (rejeitado:
  mais constantes); input DnaTraits (rejeitado:
  não consome M035); blends multi-stance
  (rejeitado: 1 label, FUTURO); wiring já
  (rejeitado: sem consumer).
- ADVANTAGES: 1.ª DECISION sobre o substrato;
  1 constante inventada (margem votada); empates
  determinísticos por construção.
- DISADVANTAGES: set-4 fixo (molde vocab fixo);
  folha L2 sem importadores até M038+.
- RISKS: baixo — pura+total; residual: tuning (#92).

## D-032 — Match query wiring assessment+stance (M038 voto)

- DECISION: match.ts (L4) ganha `unitsConfig`
  field (privado, pós-validação) + 2 queries
  READ-ONLY: assessmentOf(holder) (statsOf adapter
  sobre unitsConfig; `as UnitType` seguro por
  invariante estado-validado — precedente M029;
  lookups re-guardam, fail-loud) + stancesOf
  (commandersOf + stanceOf, ordem roster).
  stance.ts ganha CommanderStance {id, stance}.
  Zero estado/eventos/schema; selo sem pins
  (sem ficheiro novo; edges downward).
- MOTIVE: voto wiring 2026-09-11 + #5/#6 (AI
  propõe via servidor; Match é o agregado) +
  M006 (estados validados) + M029 (cast em seam
  validado) + M036/M037 (substrato pronto).
- ALTERNATIVES: producers por-dispatch (rejeitado:
  ruído + semântica inventada); snapshot enrich
  (rejeitado: churn F-09/schema); adapter c/
  isUnitType branch (rejeitado: lado-unknown
  imensurável via Match — cast documentado).
- ADVANTAGES: 1.º wiring real; bundle embarca
  IA pela 1.ª vez; queries puras delegadas.
- DISADVANTAGES: match.ts +2 métodos; cast
  (mitiga: invariante + re-guard).
- RISKS: médio-baixo — read-only; residual:
  superfície API (documentada).

## D-033 — Army posture L3 + query (M039 voto posture)

- DECISION: `src/engine/posture.ts` NOVO (L3 —
  agrega stance L2; L2↛L2 proíbe L2): postureOf
  (records): ArmyPosture {distribution, majority}:
  contagens por stanceOf; maioria = argmax c/
  desempate ordem STANCE_IDS (votado no âmbito);
  exército vazio → zeros + balanced (paralelo
  stanceOf-bare). Cast `as Stance` documentado
  (IDS autoritativo fixo-5). Match ganha
  postureOf(holder) (query read-only, molde M038).
- MOTIVE: voto posture 2026-09-11 (desempate
  votado no texto) + #7 + M037 + gate
  (strictly-downward dita L3) + M038 (molde query).
- ALTERNATIVES: L2 c/ mirror Stance (rejeitado:
  drift perverso); maioria undefined-vazio
  (rejeitado: balanced honesto, paralelo bare);
  lib sem query (rejeitado: órfã — M038 dita uso
  imediato); pesos por rank (rejeitado: FUTURO).
- ADVANTAGES: 1.º consumer M037; zero constantes;
  determinístico total.
- DISADVANTAGES: 1.º L3 não-events; cast (mitiga:
  IDS votado).
- RISKS: baixo — pura+query read-only.

## D-034 — AI assessment events on upgrade (M040 voto)

- DECISION: `src/engine/ai-events.ts` NOVO (L3 —
  assessment/stance/warfare L2 + units/world-state
  L0/L1, downward; tipos estruturais inline, molde
  commander-state — events L3↛L3):
  createAiAssessmentProducer(unitsConfig) (factory —
  producers não recebem config): por holder em
  after.players emite 'ai.assessment' priority low
  (molde unit.moved; #33) {player, military,
  economy, commanders: {count, active, avgEffective,
  stances}}. statsOf `as UnitType` (seam validada —
  outputs re-guardados M006). match.ts regista
  factory em UPGRADE_TRANSITION (1.º domain
  producer do upgrade; riders atrás, molde).
  Mockups REGEN (M022 precedente): r13 upgrade
  +2 factos; snapshots/outcomes idênticos.
- MOTIVE: voto ai-events 2026-09-11 + #6 (EVENT
  SYSTEM→REPLAY→ANALYTICS) + M007 (factos) + M030
  (precedente producer L4-ish) + norma exposição
  (posições/amounts já públicos — sem leak novo),
  página tolerante (cópia genérica), raridade
  upgrade (49/1200; drill 0).
- ALTERNATIVES: stance-em-commission (rejeitado:
  FACTO — mints bare → sempre balanced, ruído);
  flips (rejeitado: 28/jogo drill, ruído);
  advance (rejeitado: NÃO EXISTE transição);
  noop (rejeitado: 16/jogo drill); build/move
  (rejeitado: 380+/1200); assessment-sem-dano
  (rejeitado: 2 verdades); M034-journey intacta
  (upgrade não quebra chains commander.*).
- ADVANTAGES: canal IA→stream aberto; bounded
  (2×upgrade); goldens revistos (+2).
- DISADVANTAGES: factory (molde+1); regen
  mockups (revista); avg undefined→JSON drop.
- RISKS: médio — 1.º evento IA; residual: página
  copia factos (tolerante); tuning (#92).

## D-035 — Strategy drill sim (M041 voto drill)

- DECISION: `sim/strategy-drill.ts` NOVO (toolchain,
  fora coverage — M026/M034): Matches reais × seed
  (triples + units + cities L1 + funds); bots
  commission/flips/build/upgrade/noop (oráculo);
  7 invariantes pós-applied (query-coerência:
  counts, military recomputado independente,
  stances válidas, maioria∈argmax ordem-livre,
  economy deep-equal, ai-facts shape + clichê
  +2-por-upgrade/+0-outros, zero event-fault +
  JSON); report próprio (sans-ms; exit 1);
  script `sim:strategy`. Zero prod; 0 testes
  unitários (drill é a prova executável).
- MOTIVE: voto drill 2026-09-11 + M034 (molde) +
  TESTING §1B + M038/M040 (wiring vivo).
- ALTERNATIVES: estender drills (rejeitado:
  goldens M026/M034 intactos); 8.ª invariante
  prompts (rejeitado: playtest cobre); suite
  transversal (rejeitado: M042, padrão fecho).
- ADVANTAGES: wiring provado sob dispatch real;
  event-fault fail-loud apanharia bug M040.
- DISADVANTAGES: drill fora tsc (rede eslint +
  execução); 80 facts/jogo-típico (bounded).
- RISKS: baixo — só testes.

## D-036 — Transversal suite M042 (voto transversal-suite)

- DECISION: `src/engine/strategy-transversal.test.ts`
  NOVO (2 testes, in-coverage, fecha bloco): journey
  commission→flip→upgrade (cadeia M035–M040 viva:
  counts; avg recomputado via composer real; flip
  não mexe avg; upgrade emite EXACTAMENTE
  2×ai.assessment que espelham queries; p2 vazio
  honesto) + determinismo twin (snapshot+events+
  queries deep-iguais). Zero prod; bundle
  byte-idêntico; sem pins (census exclui teste).
- MOTIVE: voto transversal-suite 2026-09-11 + M026
  (molde fecho) + TESTING §1B + D-035 (pointer).
- ALTERNATIVES: estender playtest c/ commander.*
  (rejeitado: drill M041 já cobre; regen =
  churn sem lacuna); 3.º teste (rejeitado:
  redundante c/ journey, precedente M026); pins
  (rejeitado: sem superfície prod).
- ADVANTAGES: cadeia ponta-a-ponta pinada;
  no-structural-fact do upgrade provado.
- DISADVANTAGES: teste imóvel a goldens M038
  (counts, não duplica golden).
- RISKS: baixo — só testes.

## D-037 — Orders data-first M043 (votos orders-data + engine-verbs)

- DECISION: `src/engine/orders.ts` NOVO (L0 leaf, zero
  imports): ORDER_IDS c/ 5 orderables (city.build,
  economy.gather, unit.attack/move/train — nomes de
  transição existentes, alfabetico); CommanderOrder
  {kind, params?} (params plano: string≤64, número
  finito, boolean; ≤8 chaves; extras ignorados);
  guards totais. `commanders.ts` espelha (molde
  M031–M033): campo `order?`, guard, copyRecord
  deep; schema 1 (aditivo). Zero transições.
- MOTIVE: votos 2026-09-11 + M027 (data-first) +
  M031–M033 (espelho L0↛L0) + pre-rules (5 shapes
  planos grounded) + tripwire (L0↛L0).
- ALTERNATIVES: whitelist do user (rejeitado:
  voto engine-verbs); kinds opacos (rejeitado:
  voto); importar orders (rejeitado: tripwire);
  transições já (rejeitado: M044 own); nested
  params (rejeitado: 5 shapes planos).
- ADVANTAGES: fundação sem invenção; cobre os 5
  shapes; mirror fail-loud; schema intacto.
- DISADVANTAGES: kinds presos aos verbos (novo
  verbo→amend); não-uint passam (M044 aperta).
- RISKS: baixo — data só; sem leitores→M044+.
- CUTS: commander.* (lifecycle meta);
  city.upgrade (progressão player); world.noop
  (=ausência de ordem).

## D-038 — Order queue transitions M044 (voto fifo-queue)

- DECISION: amend M043 (`order?`→`orders?`,
  absent≡vazia; `order` stale ignorado —
  back-compat; cap 8 MAX_ORDERS_PER_COMMANDER,
  orders.ts canonical + espelho). NOVO
  `order-state.ts` (L2): `order.issue`
  (owner-only; envelope L0 + cap; append FIFO,
  duplicados aplicam) + `order.cancel`
  (owner-only; limpa tudo; vazia→applied:false);
  pre-rules wire-shape (issue {id,kind,params?};
  cancel REUSA commander-id); factos
  order.issued (tail-diff) + order.canceled
  (cleared n); wiring Match. Semântica por
  kind→M045 (L2↛L2 barra reuse das rules).
- MOTIVE: voto fifo-queue + M029 (molde
  lifecycle/producers) + city-queue (fila) +
  behavior (locale americano: canceled).
- ALTERNATIVES: slot-replace (rejeitado: voto);
  validar por kind (rejeitado: L2↛L2; M045);
  cancel-head/index (rejeitado: voto=limpa);
  re-issue applied:false (rejeitado: posição
  importa); orders required (rejeitado: churn
  fixtures; absent≡vazia).
- ADVANTAGES: fila sem invenção; factos exactos;
  guard ignora stale; cancel reutiliza regra.
- DISADVANTAGES: envelope admite inexequível
  (M045); cap 8 ungrounded (own bound).
- RISKS: baixo — mecânica; sem leitor→M045.
- CUTS: execução (M045); cancel parcial.

## D-039 — Order execution M045 (voto execute-close)

- DECISION: NOVO `order-execution.ts` (L2):
  `order.execute` {id} (owner-only; REUSA
  commander-id): head? (vazia→applied:false) →
  rule REAL injectada (bad→'execute: bad head.')
  → handler VIVO injectado sobre estado c/ fila
  já popped (falha→reason verbatim, rejected
  descarta tudo); summary `executed`. Factos:
  factory c/ mapa estático dos 5 domain
  producers (kind+params do head-before) —
  order.executed PRIMEIRO (mold riders-behind),
  sub-factos depois. Match injecta handlers RAW
  (ctx.rng zero nos verbos) + paramRules. Pins
  census+LAYERS 2. Drill `orders-drill.ts`
  (M041): bots issue/cancel/execute/commission;
  7 invariantes (cap, kinds, envelope, issue→1,
  cancel→1, execute→1+kind==pre-head, faults).
- MOTIVE: voto execute-close + treasury
  (injecção) + M040 (riders-behind) + M041/M042
  (drill + journeys 5 verbos, fecho bloco).
- ALTERNATIVES: re-dispatch (rejeitado: prompts
  duplos); mapa vivo producers (rejeitado:
  duplo-run riders); executed depois (rejeitado:
  mold); drop head inválido (rejeitado:
  fail-closed + cancel); extras (rejeitado: seam
  teste).
- ADVANTAGES: verbos vivos, facts compostos;
  fail-closed; fila nunca perde em falha.
- DISADVANTAGES: 1 prompt/head; extras não
  viajam no execute.
- RISKS: baixo-médio — composição; tuning
  (#92); sem auto-exec (manual/AI).
- CUTS: auto-exec (M046+); cancel parcial.

## D-040 — Refutation data M046 (voto refute-data)

- DECISION: NOVO `refutations.ts` (L0, zero
  imports): `REFUTATION_REASONS` fechado
  (alfabético, locked) — blocked, out-of-range,
  redundant, suicidal, unaffordable — +
  `Refutation` {orderIndex uint32, kind
  (espelho OrderKind, L0↛L0), reason, by
  (holder-id 64)} + guards totais (extras
  ignorados). Espelho em commanders.ts:
  `refutation?` (ausente=nenhuma) + mirror
  guard + copyRecord. Referência
  auto-validável: kind confirma index
  (mismatch=stale → M047 fail-closed). Pins
  census+LAYERS 0. Zero transições/eventos/
  readers até M047+.
- MOTIVE: voto refute-data + M043 (data-first)
  - M044 (espelho) — fundação do bloco
    M046–M050 (refute→override→confidence→
    counterfactual).
- ALTERNATIVES: transição order.refute já
  (rejeitado: voto; behavior sem vocabulário);
  fila de refutações (rejeitado: M047 decide/
  amenda); reason aberta (rejeitado:
  fail-closed exige enum); importar orders.ts
  (rejeitado: lei L0↛L0).
- ADVANTAGES: desafio com reason auditável;
  staleness detectável em dados; fail-closed.
- DISADVANTAGES: 1 refutação/record (M047
  pode amendar); reasons ainda não avaliadas.
- RISKS: baixo — dados puros; avaliação →
  M047/M048.
- CUTS: transições/eventos/readers (M047+);
  avaliação de reasons (M047/M048); queue.

## D-041 — Order override M047 (voto override-head)

- DECISION: NOVO `order-override.ts` (L2):
  `order.override` {id,kind,params?}
  (owner-only; rule PRÓPRIA — L2↛L2 barra
  reusar issueParamsRule, mold CancelOrderParams):
  refutation? (ausente→applied:false) → head?
  (orderIndex 0 + fila não-vazia) → fresh?
  (queue[0].kind==ref.kind, senão stale) →
  kind orderable + envelope L0 → SUBSTITUI
  queue[0] (spread+delete limpa refutation) +
  summary `overrode`. Facto estrutural único
  `order.overridden` {player,commander,kind
  (novo),over (antigo),reason} (diff
  before/after; override é o único clearer —
  exacto; by audit-only). Match: handler+rule+
  producer. Pins census+LAYERS 2. Refutações
  init-placed (precedente M027; raise→M048+).
- MOTIVE: voto override-head + M044 (mecânica
  fila, factos diff) + M046 (ref auto-validável).
- ALTERNATIVES: tail-override (rejeitado: voto
  diz head; editar planos≠override);
  caller==by (rejeitado: by audit-only; holder
  detém fila); reusar issue rule (rejeitado:
  L2↛L2 + mensagens); raise junto (rejeitado:
  voto; init-placed precede).
- ADVANTAGES: substituição atómica + limpeza;
  stale fail-closed; facto auditável.
- DISADVANTAGES: só head; sem raise (M048+).
- RISKS: baixo — mecânica L2 sobre dados M046.
- CUTS: refutation.raise/withdraw (M048+);
  tail-override; scoring (M048).

## D-042 — Confidence engine M048 (voto reason-eval)

- DECISION: NOVO `confidence.ts` (L2,
  read-only): `confidenceOfOrder(record,
index, state, rules)` avalia os 5 reasons
  M046 contra estado live + score = max(0,
  100−20×failed). Evaluators: blocked (move→
  célula impassível, mold M022), out-of-range
  (move/attack não-adjacente, neighborsOf),
  redundant (move p/ mesma célula; gather em
  nó vazio/ausente), suicidal (HEURÍSTICA
  documentada, precedente stance M037: net 0
  OU hp<=dano-do-alvo — precifica o próximo
  turno do alvo), unaffordable (train/build
  vs stockpile, mold treasury). Malformado→
  evaluators abstêm-se (validade é do engine).
  Rules injectadas (mold warfareHandlers):
  unitStatsOf/buildCostOf/passable/defenseOf/
  canAfford (espelhos estruturais — L2↛L2
  barra economy/warfare/terrain). Match:
  `confidenceOf(id,index)` (mold assessmentOf;
  guarda isUnitType/isBuildingId, undefined
  fail-soft) + guarda buildings/terrainConfig
  privados. Pins census+LAYERS 2.
- MOTIVE: voto reason-eval + M046 (reasons
  pediam avaliação) + M047 CUTS (scoring) +
  M037/M038 (heurística documentada, queries).
- ALTERNATIVES: scores em estado (rejeitado:
  voto; read-only chega); validity no score
  (rejeitado: engine já fail-closed);
  retaliação no engine p/ suicidal (rejeitado:
  mecânica nova — heurística documentada).
- ADVANTAGES: reasons executáveis; score
  determinístico; consumers M049+ prontos.
- DISADVANTAGES: suicidal heurístico;
  tuning do −20 futuro.
- RISKS: baixo-médio — interface gorda mas
  injectada; semântica por evaluator pinnada.
- CUTS: tuning pesos (futuro); raise (M049+);
  whole-queue query.

## D-043 — Counterfactual query M049 (voto sim-query)

- DECISION: NOVO `counterfactual.ts` (L3,
  read-only): `whatIfConfidence(record, index,
state, hypothetical, deps)` — target? (fail-
  soft) → hypothetical orderable? (isOrderKind,
  senão 'not orderable') → rule+handler? (senão
  'unknown kind') → rule passa? (senão detail)
  → handler sobre FORK structuredClone (caller
  = record.owner as PlayerId, seam M029; verb
  rules shape-only ignoram caller) → falha?
  (reason verbatim) → `confidenceOfOrder` do
  TARGET sobre outcome. SEM fork exposto, SEM
  prompts/eventos, SEM advance (buildings/
  cities não entram nos evaluators — cut
  declarado). Deps injectadas (mold M045):
  handlers+rules+confidenceFor (factory por
  estado — o sim pontua o OUTCOME, closures
  de snapshot rebondem; bug apanhado no gate:
  treasury fixa pontuava fundos originais).
  Match: `whatIf` (mold confidenceOf) +
  fields domainHandlers/domainRules +
  refactor privado confidenceRules(snapshot).
  Pins census+LAYERS 3.
- MOTIVE: voto sim-query + M045 (injecção,
  fork-clone) + M048 (confidence pronta) —
  primeiro consumer transversal.
- ALTERNATIVES: fork exposto (rejeitado:
  voto); multi-order scripts (rejeitado:
  M050 estende); advance no sim (rejeitado:
  irrelevante p/ scores M049); mirror
  PreRule (rejeitado: L3 importa L2).
- ADVANTAGES: "e se?" honesto via handlers
  vivos; read-only; M050 consome.
- DISADVANTAGES: 1 hipotético/query; sem
  advance (M050).
- RISKS: baixo-médio — semântica sim-vs-
  dispatch pinnada por teste.
- CUTS: scripts multi-order (M050); advance
  (M050); ranking (M050).

## D-044 — Counterfactual scripts+ranking M050 (voto rank-scripts)

- DECISION: ESTENDE `counterfactual.ts` (L3,
  sem churn camadas): núcleo interno
  simulateScript (fork único, steps em
  sequência, failedAt; sem guards) +
  `whatIfScript` (guards + núcleo) +
  `whatIfConfidence` DELEGA (1 step; testes
  M049 intactos guardam) + `rankCandidates`
  (cada candidato via núcleo; ordena score
  desc, estáveis empates; unapplied afundam;
  recommended = índice do melhor, undefined
  se nenhum). Sem advance (provado
  irrelevante p/ scores M049). Match:
  `whatIfScript` + `rankCandidates` + refactor
  privado counterfactualDeps(snapshot)
  (whatIf reusa). Sem pins novos (ficheiro
  existe).
- MOTIVE: voto rank-scripts + M049 (núcleo
  pronto) + M048 (scores) — fecho do bloco.
- ALTERNATIVES: ficheiro novo L4 (rejeitado:
  churn camadas); duplicar lógica (rejeitado:
  delegação + testes M049); advance no sim
  (rejeitado: irrelevante p/ scores).
- ADVANTAGES: scripts honestos; ranking
  determinístico; zero duplicação.
- DISADVANTAGES: refactor M049 (guardado).
- RISKS: baixo — delegação pinnada.
- CUTS: advance (futuro, se scores lerem
  cities); pesos tuning; raise (M051+).

## D-045 — Memory data M051 (voto memory-data)

- DECISION: NOVO `memories.ts` (LEAF L0, zero
  imports — molde M046): MEMORABLE_KINDS (6
  tipos EMITIDOS reais: order.executed,
  order.overridden, order.canceled,
  unit.attacked, unit.slain, unit.spotted) +
  CommanderMemory {seq, revision, kind,
  subject} (auto-validável: seq localiza no
  stream, revision+kind confirmam) +
  MAX_MEMORIES_PER_COMMANDER 8 (simétrico
  orders) + MAX_MEMORY_SUBJECT_CHARS 64 +
  guards totais + isMemoryLog capped.
  commanders.ts: `memories?` mirror (L0↛L0,
  absent=vazio) + validação capped +
  copyRecord. Pins: census + LAYERS
  `memories: 0`.
- MOTIVE: voto memory-data + M046 (data-first
  abre-bloco) + 18 tipos emitidos grounded
  (6 AI-relevantes).
- ALTERNATIVES: vocab largo (rejeitado: ruído
  — assessment/cell/economy são estado
  alheio); snapshots payload (rejeitado:
  unbounded, refs bastam); record path já
  (rejeitado: data-first).
- ADVANTAGES: refs bounded; stream é verdade;
  stale detetável (kind/seq mismatch).
- DISADVANTAGES: sem readers até M052+.
- RISKS: baixo — data pura, molde provado.
- CUTS: record/append (M052); recall (M052+);
  staleness resolution (M052+); crescimento
  vocab; pesos/decay.

## D-046 — Memory record M052 (votos record-verb + attribute-named)

- DECISION: NOVO `memory-record.ts` (L2):
  `memory.record` + recordParamsRule ({events:
  1..32} fail-closed) + handler (por evento:
  memorable? commander nomeado? existe?
  owner===caller ANTI-SPAM? válido? seq
  dedup? → append FIFO 8; subject = o
  próprio commander — detalhes no seq;
  zero sobreviventes REJEITA 'record:
  nothing memorable.' — rejected are free
  D-022). Match: registo + auto-record após
  applied via kernel.dispatch DIRETO (bypass
  wrapper: sem finished-guard/producers/
  victory; bookkeeping nunca acaba jogos);
  outcome error = THROW fail-stop, rejected
  = tolerado (nada memorável é normal);
  pré-filtro kind (skip dispatch se vazio —
  zero revision-bloat em lances banais).
  RECORD é budget-free (1.ª transição
  system: sem promptsAvailableRule/spend/
  promptsRule — bookkeeping não é ação).
  Battle/sighting SKIPPED (sem commander
  no payload → M053).
- MOTIVE: votos + owner-only provado
  (override/execute/cancel) + prompt-ledger
  (spent==1) força isenção explícita +
  referência auto-validável absorve forgery
  (recall M053+ falha fechado).
- ALTERNATIVES: self-dispatch via wrapper
  (rejeitado: regress + finished-guard
  comeria o lance final + victory recheck);
  spend duplo (rejeitado: muda economia +
  throw sem prompts); sem owner-check
  (rejeitado: log-spam); subject=kind
  (rejeitado: canceled sem kind).
- ADVANTAGES: memórias honestas stamped;
  spam impossível; lance final recorda.
- DISADVANTAGES: 3 touch points no loop
  registo; revision+1 por lance memorável.
- RISKS: baixo — sizeRule margem 1MB.
- CUTS: battle/sighting attribution (M053);
  recall + staleness (M053+).

## D-047 — Memory attribution+recall M053 (votos attribute-recall + sides-caller)

- DECISION: ambient NO handler (named M052
  intacto): attacked/slain/spotted com
  payload.player===caller (CALLER-BOUND) +
  payload.unit (subject=about) → fan-out
  p/ commanders ATIVOS do player (named:
  qualquer active — aconteceu-LHES; ambient:
  só ativos — só ativos observam). Recall
  NOVO `memory-recall.ts` (L2):
  recallMemories(record, lookup, subject?)
  → {fresh, stale} (seq ausente ou
  revision/kind mismatch = stale;
  consumidores tomam .fresh) + Match.recall
  (lookup sobre o stream, fail-soft).
  Subject-about: orders self, battle/unit.
- MOTIVE: votos + attacker==caller sempre +
  cross-write seria memory-wipe gratuito
  (budget-free!) + {fresh,stale} é fechado
  E auditável.
- ALTERNATIVES: ambient sem caller-bind
  (rejeitado: wipe inimigo free);
  entrypoint system no kernel (rejeitado:
  invasivo no load-bearing); recall omite
  stale (rejeitado: esconde forgery);
  recall-time stream-scan s/ writes
  (rejeitado: viola o voto).
- ADVANTAGES: batalhas completas;
  sightings próprios completos; forgery
  flaggada no recall.
- DISADVANTAGES: sightings de moves
  inimigos perdidos (CUT); fan-out
  ruidoso (todos os ativos).
- RISKS: baixo — handler aditivo.
- CUTS: cross-dispatch sightings (M054+);
  recall consumers (M054); pesos/decay.

## D-048 — Recall-stance M054 (voto recall-stance)

- DECISION: `stanceWithRecall(record,
recollection)` em stance.ts (MESMO
  ficheiro, sem pins — precedente M050):
  fresh attacked/slain contam battles
  (só as NOSSAS, sides-caller → momentum),
  fresh overridden/canceled contam failures
  (self-correction → humility);
  aggression += min(battles,2)*5, defense
  += min(failures,2)*5; re-corre margin
  logic (extraída stanceFromTraits;
  stanceOf DELEGA — M037 intacto). Sem
  battles/failures → stanceOf EXATO.
  Recollection é SHAPE MIRROR
  (memory-recall canónico, L2↛L2). Match:
  stancesOf via recall+stanceWithRecall
  (streamLookup privado partilhado;
  record-defined ⟹ recollection-defined
  via cast). ai-events MANTÉM stanceOf
  (ProducerInput sem stream — DIVERGÊNCIA
  documentada: assessment=DNA stance).
- MOTIVE: voto + sides-caller polariza
  batalhas honestamente (nossos kills) +
  failures sem outcome-lookup.
- ALTERNATIVES: outcomes via stream
  (rejeitado: pesado p/ M054); override
  stance (rejeitado: crude; nudge
  respeita DNA); sucesso embolden
  (rejeitado: executed=rotina); wiring
  ai-events (rejeitado: sem stream).
- ADVANTAGES: fecha o loop Memory;
  M037/M038 intactos sem memórias.
- DISADVANTAGES: divergência assessment
  (pinned); tuning 5/2 arbitrário.
- RISKS: baixo — aditivo + delegação.
- CUTS: battle outcomes (M055+);
  assessment alignment; tuning 5/2.

## D-049 — Directive data M055 (voto directive-data)

- DECISION: NOVO `directives.ts` (LEAF L0,
  zero imports — molde M046/M051):
  DIRECTIVE_KINDS (autonomy, stance) +
  AUTONOMY_LEVELS (manual, assisted,
  autonomous) + stance values mirror
  STANCE_IDS (L0↛L0 — stance.ts é L2) +
  CommanderDirectives {autonomy?, stance?}
  (SET por kind: set sobrescreve; absent
  = unset = status quo) + guards totais
  per-kind (extras ignored M015).
  commanders.ts: `directives?` mirror +
  guard + copyRecord. Pins: census +
  LAYERS `directives: 0`. Semântica
  (mecânica M056+): autonomy quem decide
  (manual=status quo); stance override
  ordenado (precedência M056+).
- MOTIVE: voto + data-first abre-bloco
  (M046/M051) + stance vocab real grounded.
- ALTERNATIVES: array-log (rejeitado:
  diretivas são ESTADO, não história);
  kind+value genérico (rejeitado: validação
  per-kind mais forte); engagement/focus
  kinds (rejeitado: especulativo — 2 kinds
  grounded bastam).
- ADVANTAGES: set atómico; unset=quo;
  zero leitores = zero risco.
- DISADVANTAGES: decorativo até M056+
  (data-first assumido).
- RISKS: baixo — data pura.
- CUTS: set/clear verb (M056); precedência
  stance (M056+); AI actor p/ assisted/auto
  (M056+/M059+); kinds novos.

## D-050 — Directive set+precedence M056 (voto directive-set-stance)

- DECISION: NOVO `directive-state.ts` (L2,
  molde order-state): `directive.set`
  {id,kind,value} + `directive.clear`
  {id,kind} (owner-only; unknown/not-owner
  reject; clear unset reject 'not set'
  — molde cancel; set sobrescreve;
  replaceRecord LOCAL L2↛L2) + producers
  estruturais (directive.set/cleared,
  diffs before/after; NÃO memoráveis —
  memória de diretivas é futuro). Match:
  merge no mapa commanders + paramRules +
  producers. Precedência: stanceWithRecall
  retorna directives.stance primeiro
  (player > recall > DNA); stanceOf intacto.
  Export aditivo isDirectiveStance (M055).
  Pins: census + LAYERS `directive-state: 2`.
- MOTIVE: voto + molde M044 verbatim +
  factos p/ audit (kernel log não basta
  no stream).
- ALTERNATIVES: clear idempotente-applied
  (rejeitado: molde cancel rejecta vazio);
  set mesma-value reject (rejeitado:
  overwrite harmless); sem producers
  (rejeitado: verbos order todos emitem);
  memoráveis (rejeitado: fora do voto).
- ADVANTAGES: metade stance COMPLETA
  (data→verb→consumer); autonomy stored.
- DISADVANTAGES: autonomy sem leitor
  (actor M059+?); precedência só stancesOf.
- RISKS: baixo — molde provado.
- CUTS: autonomy actor; proposal half
  (M057+); kinds novos.

## D-051 — Proposal data M057 (voto proposal-data)

- DECISION: NOVO `proposals.ts` (LEAF L0,
  zero imports — molde M055): PROPOSAL_KINDS
  (autonomy, order, stance — simétrico
  c/ diretivas+ordens) + CommanderProposal
  {kind, order?, stance?, autonomy?}
  (payload per-kind OBRIGATÓRIO; outros
  ignorados M015) + mirrors L0↛L0 (order
  kind+params bounds 8/32/64; autonomy +
  stance values) + guards totais.
  commanders.ts: `proposal?` single-slot
  (molde refutation) + guard + copyRecord.
  Pins: census + LAYERS `proposals: 0`.
  Sem note/reason (payload-only; M058 só
  lê payloads).
- MOTIVE: voto + simetria M055 + vocabs
  reais grounded (ORDER_IDS, STANCE_IDS,
  AUTONOMY_LEVELS).
- ALTERNATIVES: multi-slot log (rejeitado:
  single-slot basta; newest wins M058);
  note livre (rejeitado: sem LLM; futuro
  templated); support/report kinds
  (rejeitado: especulativo).
- ADVANTAGES: C→P half data-pronta;
  approve/decline M058 lê payloads.
- DISADVANTAGES: decorativo até M058.
- RISKS: baixo — data pura.
- CUTS: propose/approve/decline verbs
  (M058); notes; kinds novos.

## D-052 — Proposal verbs M058 (sem voto: D-051 + moldes)

- DECISION: NOVO `proposal-state.ts` (L2,
  molde directive-state): `proposal.propose`
  {id,proposal} (owner-only; REJECT quando
  ocupado 'pending.' — attention slot não
  perde veredictos) + `proposal.approve` {id}
  (order→append queue, cap 8 fail-closed
  'queue full.'; stance/autonomy→directive
  set/overwrite; limpa slot) +
  `proposal.decline` {id} (limpa slot;
  reject se vazio 'no proposal.').
  Producers estruturais (proposed/approved/
  declined; NÃO memoráveis). Propose é
  owner-dispatched (training wheels — AI
  writers M059+; sem auto-propose).
  Sem active check (order/directive verbs
  também não verificam — molde); slots
  vazios dropam a key (M047 law).
  Match: merge + paramRules + producers.
  Pins: census + LAYERS `proposal-state: 2`.
- MOTIVE: D-051 declarou + moldes M044/M056
  verbatim + approve-com-efeitos fecha o
  loop C→P.
- ALTERNATIVES: overwrite pending
  (rejeitado: perde veredictos);
  approve sem efeitos (rejeitado: teatro);
  auto-propose (rejeitado: sem brain);
  memoráveis (rejeitado: futuro).
- ADVANTAGES: bloco P↔C FECHADO ponta a
  ponta; AI writers têm verbos prontos.
- DISADVANTAGES: propose owner-driven
  (teatro até M059+).
- RISKS: baixo — molde provado.
- CUTS: AI writers (M059+); notes; kinds.

## D-053 — Assisted proposer M059 (voto assisted-proposer)

- DECISION: AUTO-STEP Match (molde M052
  recordMemories): após recordMemories,
  `autofileProposals(session, outerRev)`
  corre por lance aplicado. Elegível:
  active + autonomy assisted|autonomous +
  slot vazio + stance unset + NOVA lição
  (fresh battle/failure memory c/ revision
  == outerRev — sem re-nag após decline)
  - divergência (stanceWithRecall ≠
    stanceOf). Elegíveis → inner
    kernel.dispatch `proposal.autofile`
    {id,proposal} (NOVA transição SYSTEM em
    proposal-state.ts: sem owner check,
    budget-free, wire rule = proposeParamsRule
    reutilizada) + runProducers manual
    (proposalProposedProducer — o jogador TEM
    de notar; M052-silêncio aqui derrota o
    propósito). Fire-and-forget SEM outcome
    check (desvio M052 documentado:
    pre-checked single-threaded, slots
    distintos; ramos unreachable são
    proibidos pelo 100×4; rejects defensivos
    provados por dispatches diretos).
    Brain no Match (lookup+recall L4-only),
    write dumb em L2. stance.ts exporta
    STANCE_BATTLE/FAILURE_KINDS (refactor
    behavior-identical). Sem pins (zero
    ficheiros novos).
- MOTIVE: voto + fecha training-wheels
  D-052 + ladder manual→assisted real
  (manual = status quo HONRADO).
- ALTERNATIVES: order templates (rejeitado:
  units são do player, params arbitrários —
  M061 c/ unit-link); re-nag (rejeitado:
  new-lesson gate); batch dispatch
  (rejeitado: N revisions honestas);
  silêncio (rejeitado: attention slot).
- ADVANTAGES: loop P↔C completo visível
  (batalha→memória→proposta→veredicto);
  M060 self-approve encaixa direto.
- DISADVANTAGES: só stance (honesto).
- RISKS: baixo — molde M052 verbatim.
- CUTS: order/autonomy templates (M061?);
  self-approve (M060).

## D-054 — Self-approve M060 (sem voto: D-053 + moldes)

- DECISION: AUTO-STEP Match após
  autofile: `autoapproveProposals(session)`
  — active + autonomy === 'autonomous'
  APENAS (assisted espera pelo jogador:
  THE ladder distinction) + slot ocupado
  → inner `proposal.autoapprove` {id}
  (NOVA SYSTEM em proposal-state.ts:
  core approve extraído e partilhado c/
  approve — behavior-identical — sem
  owner check, budget-free, wire rule =
  commanderIdParamsRule reutilizada) +
  hand-run approved producer. File→approve
  no MESMO lance p/ autonomous (batalha→
  directive set numa jogada). Fire-and-
  forget (molde M059); queue-full/corrupt
  tolerados (retry silencioso).
- MOTIVE: D-053 declarou + fecha o loop
  autonomous + assisted↔autonomous ganha
  significado real.
- ALTERNATIVES: largar owner check no
  approve (rejeitado: quebra segurança);
  delay 1 lance (rejeitado: teatro —
  autonomous = confiança total);
  auto-execute junto (rejeitado: eixo
  separado, M061?).
- ADVANTAGES: ladder completo e visível.
- DISADVANTAGES: nenhum novo conceito.
- RISKS: baixo — molde M059 verbatim.
- CUTS: auto-execute; order templates.

## D-055 — Auto-execute M061 (voto auto-execute)

- DECISION: AUTO-STEP Match PRIMEIRO na
  cadeia (act-then-think):
  `autoexecuteHeads(session)` — active +
  owner === acting player (prompt economics
  corretos) + autonomy === 'autonomous' +
  orders non-empty → inner kernel.dispatch
  `order.execute` {id} (PLAYER verb
  reutilizado: spend real, exhausted→
  rejected tolerado) + gate `applied`
  OBRIGATÓRIO (executed producer THROWs
  em no-change — grounded) + hand-run da
  FULL producer list + INNER recordMemories
  (sem isto a AI nunca aprende o que faz).
  Gate new-lesson `>=` outerRev (inners
  stampam revs later). Victory movida p/
  DEPOIS dos auto-steps, snapshot fresco
  (spends autónomos podem decidir; stamp
  outerRev). Um head por lance.
- MOTIVE: voto + último passo manual —
  loop autónomo completo.
- ALTERNATIVES: system execute free
  (rejeitado: quebra economia prompts);
  cross-player (rejeitado: spend alheio);
  single-producer (rejeitado: riders
  importam aqui); drain total (rejeitado:
  paced 1/lance).
- ADVANTAGES: ladder manual→assisted→
  autonomous 100% mecânico; zero rasgos.
- DISADVANTAGES: nenhum.
- RISKS: baixo — molde + gate grounded.
- CUTS: order templates (futuro?); bloco
  AI Evolution FECHA aqui.

## D-056 — Replay-verify M062 (voto replay-verify)

- DECISION: JOURNAL + REDRIVE em match.ts
  (zero ficheiros, zero pins): kernel log
  NÃO tem payloads (grounded — replay dele
  é IMPOSSÍVEL) → Match.dispatch regista
  `JournalEntry` {requestId, playerId,
  type, payload, outcome-verbatim} no
  finally (applied+rejected+error; early
  MATCH_FINISHED fora — no-op, timeline
  intacta) + `getJournal()` +
  `Match.replay(init, journal)` static
  (fresh Match, join por entry — zero
  branches — redispatch, retorna
  {match, outcomes}). Outcome verbatim =
  zero branches novas. M063 persiste o
  blob; M064 faz stepping por slice.
  Determinismo grounded: matchId morto
  (never read), sessionIds validation-
  only, started sem UUID.
- MOTIVE: voto + fundação Replay + twins
  provam scripts, journal prova história.
- ALTERNATIVES: replay do kernel log
  (rejeitado: sem payloads, impossível);
  journal só-applied (rejeitado: rejects
  entram na timeline); outcomes extraídos
  (rejeitado: verbatim sem branches).
- ADVANTAGES: redrive real, M063/M064
  encaixam direto.
- DISADVANTAGES: journal em memória
  (M063 persiste).
- RISKS: baixo — straight-line code.
- CUTS: export blob (M063); stepping UX
  (M064); matchId revive (morto).

## D-057 — Export blob M063 (sem voto: D-056 + moldes)

- DECISION: `exportReplayBlob(init,
journal): string` + `importReplayBlob(
json): {init, journal}` em match.ts
  (zero ficheiros, zero pins):
  JSON {version: 1, init, journal}.
  Export STRIPS extras (test seams não
  persistem — destructure, sem branches).
  Import guard ESTRITO (blob-shape:
  version, journal array, 4 strings por
  entry, outcome shapes incl duplicate
  recursivo + 6 error codes; init passa
  THROUGH — Match detém game-validity,
  sem duplicar lógica). Throws
  'replay blob: ...' (createWorldState
  mold). Payload sem constraint
  (strings apanham garbage).
- MOTIVE: D-056 declarou + persistência
  é o passo natural + strict fecha blobs
  manhoso.
- ALTERNATIVES: validar init fundo
  (rejeitado: duplica Match); cap size
  (rejeitado: artefacto local, CUT);
  versionar outcomes (rejeitado: verbatim).
- ADVANTAGES: M064 stepping lê blobs;
  blobs são auditáveis (JSON).
- DISADVANTAGES: extras perdidos
  (documentado).
- RISKS: baixo — JSON + guards.
- CUTS: size cap; stepping (M064).

## D-058 — Replay stepping M064 (sem voto: D-056+D-057)

- DECISION: `createReplayStepper(init,
journal)` em match.ts (zero ficheiros,
  zero pins): stepper stateful
  {match, lance, total, step()} — dispatch
  incremental O(n) total (fat-slice
  O(n²) rejeitado), step() → outcome |
  null no fim, frames observáveis via
  match live (snapshot/events/timeline).
  Trusts journal válido (M063 guard é o
  dono — seam documentado). Fecha Replay.
- MOTIVE: D-056+D-057 declararam +
  stepper > wrapper (frames reais).
- ALTERNATIVES: replayToLance slice
  (rejeitado: O(n²), sem frames);
  step-back (rejeitado: re-step do zero
  chega — stepper barato).
- ADVANTAGES: playback pronto p/ UI.
- DISADVANTAGES: shaken até UI (M063).
- RISKS: baixo — replay mold.
- CUTS: step-back; UI (futuro); bloco
  Replay FECHA aqui.

## D-059 — Self-play M065 (voto self-play)

- DECISION: NOVO `selfplay.ts` (L3:
  policy brain pura) + `Match.selfplay`
  static (match.ts): `simplePolicy(
snapshot, player, passable)` determinística
  (attack adjacente > gather on-node >
  aproximação axial greedy > patrulha;
  workers atacam; empates por id/col/row)
  - runner até vitória (alterna roster,
    sessions frescas, requestIds `selfplay
N`; pára em finished OU 2 lances
    seguidos sem applied — terminação por
    spend-down + stall-stop, sem cap; trust
    na policy como M064). terrainPassable
    extraído (refactor identical). Pins:
    census + LAYERS `selfplay: 3`.
- MOTIVE: voto + fecha o loop hands-free
  (M059-61 agem, replay regista).
- ALTERNATIVES: policy c/ RNG (rejeitado:
  pura); cap lances (rejeitado: prova
  spend-down chega); orders via commanders
  (rejeitado: verbos diretos M065);
  runner em tools/ (rejeitado: engine+100).
- ADVANTAGES: Arena tem matches reais;
  M066+ melhora brains s/ tocar runner.
- DISADVANTAGES: simple-minded (jitter,
  patrulha — documentado).
- RISKS: baixo — moldes replay+policy.
- CUTS: brains espertos; commander-orders
  (M066?); UI Arena.

## D-060 — Smarter brains M066 (voto smarter-brains)

- DECISION: `simplePolicy` v2 (mesma
  assinatura; runner intocado): FLEE hp ≤
  2 c/ foe adjacente (foge p/ vizinho que
  aumenta strictly a distância; encurralado
  luta); ATTACK focus-fire (menor hp,
  empate id); worker SEEK (fora do node →
  passo greedy p/ live node mais próximo;
  sem nodes → approach); military/patrol
  M065 intactos. Empates col/row.
- MOTIVE: voto + Arena precisa de jogo
  menos suicida antes de scoring/UI.
- ALTERNATIVES: thresholds por damage
  (rejeitado: snapshot s/ config —
  CRITICAL=2 documentado); worker foge
  sempre (rejeitado: brawl vence seek,
  flee vence brawl); seek c/ pathfinding
  (rejeitado: greedy chega).
- ADVANTAGES: 11 testes M065 intactos
  (comportamento velho = caso especial);
  terminação inalterada (spend-down).
- DISADVANTAGES: CRITICAL=2 arbitrário
  mas explícito; greedy ainda jitter.
- RISKS: baixo — mesma assinatura, pins
  intactos.
- CUTS: scoring (M067?); UI Arena.

## D-061 — Arena scoring M067 (sem voto: sequência natural)

- DECISION: NOVO `score.ts` (L2, puro,
  só type-imports): `scorePlayer(state,
player)` = hp vivo + stock + city level
  - buildings (pesos v1 todos-um, sem
    falsa precisão); `rankPlayers` (score
    desc, empate id) + `scoreTable`.
    `Match.selfplay` devolve `scores` finais.
    Victory/draws INTOCADOS (upgrade
    draw→win = ripple M060/gate — futuro).
- MOTIVE: Arena precisa de ranking antes
  de UI; victory.ts documenta o upgrade.
- ALTERNATIVES: pesos tuned (rejeitado:
  túning s/ dados); victory c/ wins
  (rejeitado: ripple 5 ficheiros);
  kills/damage (rejeitado: estado não
  tem contadores).
- ADVANTAGES: zero ripple (só adições);
  scores sobrevivem replay (derivados).
- DISADVANTAGES: pesos-um crus.
- RISKS: baixo — puro + pins.
- CUTS: buildings? INCLUÍDOS (+1);
  UI Arena (M068?); score-wins.

## D-062 — Arena UI M068 (voto arena-ui; FECHA bloco)

- DECISION: `simplePolicy` exportado em
  `tools/browser-engine.ts` (primeiro
  reader UI — deixa de ser shaken) +
  painel Arena em `match.html` (botão
  tArena, arenaRun, arenaOut): fork do
  snapshot corrente (molde Take-Command)
  → `Match.selfplay` → lances, verdict,
  scores, rank, journal. Sem engine →
  toast gracioso (molde engineOK).
  Teste: `ARENA_TEST=1` no smoke
  (bundle real via Function, molde
  ATTACK_TEST): asserts output +
  determinismo (2 runs idênticas).
- MOTIVE: voto + bloco Arena fecha com
  UI jogável; bloco CLOSED aqui.
- ALTERNATIVES: harness separado
  (rejeitado: duplica 100 linhas);
  policy em JS na página (rejeitado:
  regras vivem no engine); arena.html
  novo (rejeitado: match.html tem o
  bundle + fork mold).
- ADVANTAGES: zero engine churn (0
  testes engine novos — UI testada no
  smoke); self-play visível.
- DISADVANTAGES: E2E corre selfplay
  real (~22 lances — ms).
- RISKS: baixo — moldes cmd+ATTACK.
- CUTS: configurador de prompts;
  animações lance-a-lance (futuro).

## D-063 — SSE+POST transport M069 (voto sse-post)

- DECISION: NOVO `src/server/transport.ts`
  (node:http, sem deps): POST /match
  {seed?} (skirmish fixo 2p server-side);
  POST /:id/join {playerId} → session;
  POST /:id/dispatch {sessionId,
  requestId, type, payload} (playerId
  DERIVADO da sessão — anti-spoof por
  construção); GET /:id/events?from=N
  (SSE backlog+live); GET /:id/state.
  HTTP 200 p/ bem-formado (outcome
  carrega erros domínio); 400 corpo/
  sessão/from; 404 rota/match.
  Zero `??`/`?.`/`||` não-cobertos
  (100% honestos via HTTP real).
- MOTIVE: voto + "não assumir WS/REST"
  decidio: SSE+POST (zero deps, qualquer
  host); sem auth (fase Security).
- ALTERNATIVES: WS (rejeitado: voto);
  roster flexível (rejeitado: clash c/
  cenário fixo — skirmish [p1,p2]);
  broadcast só-applied (rejeitado: slice
  incondicional = zero branches).
- ADVANTAGES: black-box 100% (precisa
  de nada interno); censor/layers não
  cobrem server (dir engine-only).
- DISADVANTAGES: 1 ficheiro ~200 linhas.
- RISKS: baixo — kernel valida resto.
- CUTS: prod listener; roster N;
  body-limit; auth; match.html client.

## D-064 — Presence M070 (voto presence)

- DECISION: `createTransport(now =
Date.now)` (relógio injetável):
  POST /:id/heartbeat {sessionId} →
  {online} (sorted, dedup); POST
  /:id/leave → apaga + {online};
  sweep lazy no topo dos handlers
  (timeout 30s = morte, rejoin;
  dispatch conta actividade);
  presença via SSE `event: presence`
  (live-only, sem cursor —
  backlog é só engine); join/leave/
  timeout emitem; roster tardio =
  heartbeat.
- MOTIVE: voto + sessões precisam de
  vida antes de lobby/deploy.
- ALTERNATIVES: presença no cursor
  engine (rejeitado: quebra seq);
  timeout revive (rejeitado: morte
  estrita, rejoin); sweep só no
  heartbeat (rejeitado: uniformidade
  — state excluído de propósito,
  GET puro).
- ADVANTAGES: zero churn M069
  (black-box intacto); 100% c/
  relógio manual (determinístico).
- DISADVANTAGES: TIMEOUT fixo 30s.
- RISKS: baixo — loops, poucos ifs.
- CUTS: lobby; deploy; roster no join.
