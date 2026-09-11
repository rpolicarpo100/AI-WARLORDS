# AI WARLORDS — TOOL REGISTRY (design-time tools)

> Verificado em 2026-09-10 (pesquisa + páginas oficiais). Critérios: necessidades
> do projecto · custo ≈ 0 · fiabilidade. Nada aqui é dependência de código:
> são ferramentas de AUTORIA/REFERÊNCIA (design-time), zero integração runtime.

---

## 1. Decisão

| Ferramenta     | Papel pedido                | Veredito                                           |
| -------------- | --------------------------- | -------------------------------------------------- |
| Tiled          | melhor escolha geral        | ✅ CONFIRMADO — **AUTORITATIVO (decisão M010)**    |
| LDtk           | desenvolvimento estruturado | ✅ CONFIRMADO c/ nuance — **alternativa não-hex**  |
| Ogmo           | alternativa leve            | ✅ CONFIRMADO c/ aviso — **FALLBACK (stale)**      |
| Dungeon Scrawl | dungeons rápidas            | ✅ CONFIRMADO — **REFERENCE-ONLY**                 |
| Watabou        | geração automática          | ✅ CONFIRMADO c/ condição — **FUTURO-condicional** |
| Azgaar         | mundo completo              | ✅ CONFIRMADO — **FUTURO (M158)**                  |
| Donjon         | procgen rápida              | ✅ CONFIRMADO — **IDEIAS-ONLY**                    |

Gate M010 CUMPRIDO (2026-09-11): formato autoritativo = Tiled hexagonal JSON
(strict subset — ver `docs/modules/M010.md` §2); loader `loadMapData` em
`src/engine/map.ts`, ancorado nas docs oficiais Tiled 1.12.2. Ficheiros de
mapa de CONTEÚDO chegam com M011+ (semântica primeiro; L-21).

## 2. Evidência por ferramenta

### Tiled — AUTORITATIVO (decisão M010)

- Free e open source; export JSON (+TMX/Lua/etc.) [1](https://dinogame.gg/blog/how-to-use-tiled-level-design/) · [oficial](https://www.mapeditor.org/)
- Mapas ortogonais + isométricos + **hexagonais**, infinitos, worlds, object
  layers, custom properties, scripting JS (formatos custom)
- Activo: v1.12.2 (Mai 2026), 200+ sponsors
- Precedente RTS com mapas Tiled (Rusted Warfare, sponsor oficial)
- Decisão M010 (2026-09-11): grid HEX (6-adjacência uniforme, sem ambiguidade
  diagonal) ⇒ Tiled confirma-se como ferramenta autoritativa (único shortlist
  com hex). Subset: orientation hexagonal, stagger y/odd|even, layers
  `terrain` (densa) + `spawns` (opcional), 1 tileset embedded, gid-array;
  semântica stagger/GIDs/tilesets verificada nas docs 1.12.2.
- Licença exacta (SPDX) por confirmar — irrelevante p/ output (ficheiros são
  nossos); verificar só se algum dia embarcarmos código Tiled.

### LDtk — alternativa não-hex

- "Fast. Free. Open source", JSON nativo + Super Simple Export, entidades com
  propriedades tipadas, worlds, cross-export TMX [4](https://www.reddit.com/r/gamedev/comments/jokim8/ldtk_level_designer_toolkit/) · [oficial](https://ldtk.io/)
- Nuance: foco platformers/top-down square-grid; **sem isométrico**
  ("Sorry, no isometric 3D here!!" — página oficial); hex não oferecido
- Mantém-se alternativa se algum futuro não-hex precisar (fora de âmbito).

### Ogmo Editor 3 (CE) — FALLBACK

- Leve, export JSON (compact/pretty), entidades/tiles/decals [2](https://github.com/Ogmo-Editor-3/OgmoEditor3-CE/releases)
- AVISO: última release 3.4.0 = **31 Dez 2020** (~5.7 anos parado) → risco de
  fiabilidade. Só se Tiled+LDtk falharem.

### Dungeon Scrawl — REFERENCE-ONLY

- Desenho rápido de dungeons no browser, grátis; export **só PNG/PDF**
  (imagem) [1](https://80.lv/articles/dungeon-scrawl-a-free-online-tool-for-creating-maps-for-ttrpgs)
- Sem dados estruturados → não alimenta o engine. Serve para concept/visual.

### Watabou — FUTURO-condicional

- Geradores procedurais activos (aldeias, cidades, dungeons…), browser grátis;
  Village Generator tem export JSON (parcial) [2](https://watabou.itch.io/village-generator)
- CONDIÇÃO: licença dos outputs = `UNKNOWN` → verificar antes de qualquer uso.

### Azgaar Fantasy Map Generator — FUTURO (M158)

- Mundo completo: SVG/PNG + **JSON/GeoJSON/CSV estruturados** [2](https://github.com/Azgaar/Fantasy-Map-Generator/wiki/Knowledge-Base); hiper-activo (6k stars, commits diários)
- Escala continente (vector), não tile-grid → não serve o loader M010; forte
  candidato a fonte de worldgen em M158 (conteúdo avançado).
- Licença do código: ficheiro LICENSE existe, conteúdo `UNVERIFIED`.

### Donjon — IDEIAS-ONLY

- Geradores TTRPG grátis (nomes, dungeons, loot…) [1](https://donjon.bin.sh/);
  output texto/HTML, sem export estruturado → ideias de conteúdo, não dados.

## 3. Custo

€0 em todos os papéis adoptados (tiers pagas — ex.: Dungeon Scrawl Pro,
desktop Watabou — não são precisas). Reavaliar se algum papel mudar.

## 4. Alterações

| Data       | Módulo    | Alteração                                                           |
| ---------- | --------- | ------------------------------------------------------------------- |
| 2026-09-10 | M004-turn | Criação: 7 ferramentas verificadas, shortlist Tiled/LDtk, gate M010 |
| 2026-09-11 | M010      | Gate cumprido: Tiled AUTORITATIVO (hex strict-subset + loader)      |
