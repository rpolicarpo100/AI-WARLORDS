# AUDITORIA VISUAL — evolução foto 1 → foto 2 (FASE A)

> Data: 2026-09-11 · Estado: **VALIDADO** (pixels vistos @ 2026-09-11; §8 —
> ver §0). Auditoria feita sobre (a) código real do repo e (b) descrições
> embutidas nas páginas partilhadas (fiéis, mas não são os pixels).

---

## §0. Recuperação das imagens (log honesto)

| Tentativa | Resultado |
| --------- | --------- |
| `fetch_page` link 1 (`Le5TZzdeTaLK`) | Página abre; imagem `blob:` inacessível; **alt-text detalhado extraído** |
| `fetch_page` link 2 (`To0xC6ruSvlx`) | Idem; **alt-text detalhado extraído** |
| `og:image` (curl) | Genérico Gemini (thumbnail aurora) — inútil |
| `googleusercontent` no HTML estático | Só `ogw/default-user` — imagens exigem sessão JS/autenticada |

**Conclusão:** NÃO VI os pixels. O §1 condensa fielmente os alt-texts (que têm
o detalhe de prompts de geração). A validação visual desta auditoria está
**BLOQUEADA** até o utilizador anexar os 2 ficheiros. Nada da FASE B arranca
sem essa validação, salvo autorização explícita (ficará marcado NÃO VALIDADO).

Confirmado por grep: ambas derivam dos nossos mockups — `match.html` contém
`Vale of Echoes`, `Feudal Age`, `MOCKUP`, `Chronicle`, `Selected`, `Minimap`,
`Gather` (ver §2).

---

## §1. O que as descrições dizem (condensação fiel)

### Foto 1 → `Le5TZzdeTaLK` (visão low-poly 3D + ferramentas de gameplay)

- Vista 3D low-poly do mapa hexagonal, mesma perspectiva, mais profundidade;
  texturas limpas (árvores, montanhas, edifícios); grelha definida; água com
  fluxo mais claro; encostas de montanha definidas.
- Edifícios originais mantidos (keep, recursos, ponte mais detalhada);
  grupos de unidades azuis/vermelhos mantidos e reposicionados com lógica;
  health bars melhoradas; soldados low-poly detalhados; números
  (`u2:8, u5:5, u1:12, u0:5, u4:12, u3:5`, campo 40) mantidos e legíveis;
  bandeira azul no keep.
- **Overlays novos:** (1) vectores de decisão IA (setas translúcidas
  vermelho=agressivo / verde=defensivo, caminhos previstos); (2) heatmap de
  recursos (gradientes verde/madeira, amarelo/ouro, halo de ameaça); (3) painel
  lateral da unidade seleccionada (tipo, acção actual, "confiança IA 82%",
  ataque/defesa); (4) barra de plano IA (T+1/T+2 acções planeadas); (5) linhas
  de targeting + anel de alcance; (6) tooltip de terreno (impassável,
  "bónus defesa +2", "prioridade IA: evitar"); (7) UI de recursos + fase +
  objectivo IA; (8) ícones de estado (escudo=fortificado, espada=ofensiva,
  alvo=ameaça).
- Luz mais clara e direccional; cena complexa mas legível.

### Foto 2 → `To0xC6ruSvlx` (visão AoE-IV isométrica detalhada)

- Cada hex vira paisagem isométrica 3D detalhada estilo Age of Empires IV:
  carvalhos/pinheiros, campos/pastagens texturados, picos rochosos, caminhos
  de terra/pedra com fogueiras.
- Estruturas 3D: torre de vigia em pedra, mina de ouro, pedreira, casas
  medievais; campos de trigo detalhados.
- Unidades 3D: piqueiros/arqueiros/homens-de-armas em grupos, health bars
  refinadas + contagens + identificadores `u`; UI de topo mantida
  (`Vale of Echoes`, recursos 60/40/29/31, 4/200, Feudal Age); texto `MOCKUP`
  preservado; UI inferior preservada e tematizada (minimapa como miniatura 3D,
  painéis Selected/Build/City/Chronicle, Commands com Gather/Build/Move +
  atalhos, worker 3D no painel).
- Moldura escura; **luz quente de ângulo baixo**; profundidade e textura;
  ar de sessão RTS real e imersiva.

### Leitura crítica (ÂMBITO)

Ambas são **visões geradas**, não screenshots do nosso jogo actual. O nosso
estado real (§2) é o ponto de partida verdadeiro; as fotos dão (foto 1)
**ferramentas/feedback de gameplay** e (foto 2) **qualidade/apresentação**.
Nada será copiado (assets/paleta/UI próprios); extraem-se princípios.

---

## §2. Estado actual real (do código, VERIFICADO)

Render (Canvas 2D, `match.html`, ~48 células, leve):

- Hexes isométricos extrudidos com bevel solar; 29 sprites Kenney 2D
  embutidos (castelos, pinheiros, quintas, minas); espuma nas margens;
  partículas (`burst`, cap 260); fauna (ovelhas/vacas); nuvens + sombras;
  pássaros; chuva (toggle); minimapa 2D; fog (visto/conhecido/desconhecido).
- Esquadrões procedurais (5 figuras, marcha, escudos, direcção); barras HP +
  pills `id:hp`; trabalho (ferramenta+faíscas+fardo); poeira de marcha;
  andaimes de construção da queue genuína; relvado/juncos/peixes/fumo/
  borboletas/pirilampos (passo Deluxe).
- Luz: plana + bevels + sombras de nuvens. Sem layers fg/mg/bg, sem luz
  direccional quente, sem ciclo.

Gameplay (motor real no browser — bundle inclui M023 `unit.attack`):

- Take-Command: fork em qualquer ordem; seleccionar unidade; clicar tile =
  dispatch genuíno (mover/recolher/construir/avançar/melhorar/**atacar ainda
  NÃO exposto na UI**); toasts applied/rejected com razões verdadeiras;
  extensão local da timeline; fog recalculada; Release restaura.
- Feedback: floaters de texto, shake (conclusão de edifício), SFX
  (fanfarra/moeda/passo/martelo/whoosh/clique + vento ambiente); Arauto;
  Chronicle; Orders; painel Selected; HUD de recursos com tween; tick.
- Câmara fixa (mapa todo); sem pan/zoom; sem anéis de alcance; sem preview
  de caminho; sem tooltips de terreno; sem ícones de estado; sem heatmaps.

## §3. Gaps foto 1 (ferramentas) → veredicto honesto por item

| Visão foto 1 | Estado | Veredicto |
| ------------ | ------ | --------- |
| Linhas de targeting + anel de alcance | Ausente | **REAL** — alcance = adjacência (motor `neighborsOf`); desenhar anel + linhas p/ inimigos atacáveis |
| Preview de caminho de movimento | Ausente | **REAL (hint)** — BFS em células passáveis (M011/M022) até ao hover; motor continua a validar |
| Tooltip de terreno (passável?) | Ausente | **REAL** — `move` finito/bloqueado é regra do motor |
| Tooltip de terreno (defesa +2) | Config existe, sem efeito | **BLOQUEADO até M024** — mostrar valor sem efeito seria enganar |
| Painel unidade (tipo/hp/dano) | Parcial (Selected) | **REAL** — `maxHp/damage` da config + hp genuíno |
| Painel unidade ("acção actual") | Ausente | **REAL c/ rótulo** — última acção reportada nos eventos genuínos |
| Ícones de estado (fortificado/ofensivo) | Ausente | **CUT** — sem mecânicas de fortificar/posturas no motor |
| Ícone de ameaça prioritária | Ausente | **REAL** — inimigo adjacente = ameaça genuína (definição nossa, declarada) |
| Ícone caveira 0hp | Ausente | **REAL** — estado 0hp existe (M023) |
| Heatmap de recursos | Ausente | **REAL** — nós + yields genuínos; toggle |
| Halo de ameaça | Ausente | **REAL** — derivado de posições inimigas (declarado) |
| Vectores de decisão IA | Ausente | **CUT/REFRAME** — sem IA (M027+); reframe: vectores de ataque reais + preview de caminho |
| Barra de plano IA T+1/T+2 | Ausente | **CUT/REFRAME** — reframe honesto: ordens locais do fork (a crónica estendida JÁ é o plano; destacar ordens locais) |
| "Confiança IA 82%", "objectivo IA", "prioridade IA" | Ausente | **CUT** — fingir IA viola a regra principal |
| Luz direccional clara | Parcial | **REAL** — pass de luz (barato, canvas) |

## §4. Gaps foto 2 (apresentação AoE) → veredicto honesto por item

| Visão foto 2 | Estado | Veredicto |
| ------------ | ------ | --------- |
| Terreno rico por hex (bosques, pastos, picos, caminhos, fogueiras) | Bom, pode + | **REAL** — mais sprites Kenney + detalhe procedural ancorado ao terreno genuíno |
| Estruturas detalhadas (torre/mine/pedreira/casas) | Parcial (sprites) | **REAL** — pack Kenney tem; mapear por tipo de terreno/recurso |
| Grupos de unidades detalhados + barras refinadas + ids | Bom (5 figs + pills) | **REAL** — refinar barras/legibilidade; manter abstracção |
| UI tematizada coesa (topo/recursos/painéis/atalhos) | Parcial | **REAL** — CSS/temas, sem mudar factos |
| Minimapa como miniatura | Plano | **REAL** — sombrear/ícones modestos |
| Luz quente de ângulo baixo + profundidade | Ausente | **REAL** — overlay quente + fundo (montanhas distantes) + vinheta fg; tudo barato |
| Layers fg/mg/bg, transições de zona | Ausente | **REAL (modesto)** — vinheta + fundo + sombras; sem scroll (câmara fixa) |
| Morte/inimigos a sério | Ataque sem morte | **BLOQUEADO até M024** (remoção+`slain`); ataque animado é REAL já (M023) |
| Loot/recompensas de morte | Ausente | **NECESSITA DE DECISÃO** — sem drops no motor (módulo futuro ou CUT) |
| Portas/baús/NPCs/checkpoints/plataformas | N/A | **CUT c/ razão** — RTS hexagonal por turnos-livres: equivalentes são fog/exploração, Command mode, Chronicle |

## §5. Backlog priorizado (FASE B → C → D)

- **P0 — BLOQUEADO:** anexar foto 1 + foto 2 → validar este audit visualmente.
- **P1 — gameplay real (motor pronto):** botão Attack + cadeia de feedback
  (investida, choque/aço, floater de dano, shake, som); caveira 0hp; anéis
  de alcance; preview de caminho; tooltip de terreno (passável); heatmap de
  recursos (toggle); halo de ameaça; destaque de ordens locais; sons de
  batalha (sintetizados).
- **P2 — depende M024** (3 perguntas saltadas; re-perguntar): morte/remoção
  animada; tooltip de defesa com efeito; fim de cadáveres-lógicos.
- **P3 — ambiente:** luz quente direccional; fundo (montanhas) + vinheta;
  fogueiras/caminhos/pedreira; barras refinadas; minimapa sombreado;
  painéis tematizados.
- **P4 — polimento:** transições, sons em falta, auditoria de perf
  (propõe-se: manter <16ms/frame em hardware modesto; partículas com cap;
  sem `shadowBlur` em massa; gradientes pré-computados).

## §6. Riscos e notas de performance

- Canvas 2D, 48 células, partículas com cap: base leve e adequada.
  Adições P1/P3 são O(células) por frame, sem GPU pesada, sem assets
  externos (tudo embutido, offline-first).
- Risco: prometer "3D" — NÃO é 3D; é isométrico 2D rico (dizer sempre).
- Risco: overlays IA da foto 1 criarem expectativa de IA — cortar cedo
  e explicar (esta auditoria fá-lo).

---

## §7. Estado (formato pedido)

- **IMPLEMENTADO:** FASE A (esta auditoria, draft).
- **TESTADO:** tentativas de recuperação (3 vias, resultados negativos
  registados); grep confirma origem das imagens nos nossos mockups.
- **MELHORADO:** nada ainda (auditoria apenas).
- **PROBLEMAS ENCONTRADOS:** pixels inacessíveis (auth Google); M024
  pendente (morte/loot); overlays "IA" da foto 1 não implementáveis
  antes de M027+ (corte proposto); "cura" D-014 sem fonte no motor.
- **O QUE FALTA:** validação visual (anexos) → FASE B → C → D.
- **PRÓXIMO PASSO:** utilizador anexa foto 1 + foto 2 (ou autoriza avançar
  só com descrições) → validar §3/§4 → FASE B (P1) → M024 (P2) → FASE C/D.

---
## §8. Validação visual (pixels vistos @ 2026-09-11) — AUDIT VALIDADO

**Método:** leitura directa dos 2 ficheiros anexados (ordem de transmissão
ambígua — tratado por conteúdo, conforme instrução do utilizador:
rica AoE = alvo, flat = antes).

**Confirmado (§1 fiel):** alvo = hexes extrudidos com laterais de terra,
florestas densas, 3 picos nevados, torre de vigia em pedra, casas medievais,
2 fogueiras com brilho, trigo em fileiras, pedreira "20", mina "40",
grupos de 4–6 soldados com barras HP + `uX N`, selecção dourada, UI
dourada-sobre-preto (recursos 60/40/29/31, 4/200*, Feudal Age, TICK 4,
Commander/Strategist, Minimap/Selected/Build/City/Chronicle/Commands).
Antes = `match.html` antigo flat (badges `M017/M019/M022 ✓ engine`).

**Correcções de âmbito:**
1. Visão de overlays IA (link 1: vectores de decisão, plano T+1/T+2,
   "confiança IA") NÃO consta do alvo anexado → **PARKED** (itens IA: CUT).
   O alvo define apresentação; as secções 2/5/6 do brief definem gameplay.
2. Posição real: o estado actual já cobre ~metade do caminho antes→alvo.
3. Gaps novos ancorados nos pixels: laterais de terra profundas por hex;
   blob shadows sob objectos; densidade de bosque (10+/hex, camadas);
   montanhas multi-parte com neve; fogueiras (ancoradas a hexes village);
   caminhos ligando zonas; pilhas 3D pedreira/mina; armas por tipo
   (ferramenta/lança/arco — procedural); luz quente + vinheta + fundo
   (montanhas distantes); barras HP refinadas.
4. M024 mantém-se bloqueador de morte/defesa (P2).

**Veredictos §3/§4 após validação:** mantêm-se; itens REAL do P1 (anel de
alcance, preview de caminho, tooltip de terreno, heatmap, halo de ameaça,
cadeia de ataque) servem o brief mesmo sem estarem pixel-visíveis no alvo
— são feedback de gameplay, não decoração.

_Filed under `docs/` per repo audit precedent (`AUDIT_2026-09-11_M001-M012.md`).
Labels used: VERIFICADO (code), DRAFT NÃO VALIDADO (visual), REAL / CUT /
REFRAME / BLOQUEADO / NECESSITA DE DECISÃO (items)._
