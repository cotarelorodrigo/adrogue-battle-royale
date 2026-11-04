# Etapa 2b: interiores de los 9 lugares — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Se entra caminando por la puerta real de los 9 lugares. Adentro, cada uno se reconoce, se pelea (paredes y muebles frenan, el vidrio no) y está su botín. Los presupuestos de rendimiento no se suben.

**Architecture:**
- **El mapa guarda datos de entrada; la geometría sale de código.**
  - mapgen guarda por lugar lo que hace falta: el marco local, las aberturas y los patios.
  - `src/shared/interiors/` arma con eso, de forma determinista, el interior completo: bloques que frenan y se dibujan, muebles, carteles, luces, pisos y escaleras.
  - Lo usan la colisión, el botín, los tests y el cliente: lo que se ve es lo que frena.
- **Los 5 lugares sin lote** son "lotes sueltos" en `data/plantas.json`: una planta relevada en un marco local. Siguen el camino de los lotes de `data/frentes.json`: recorte de Microsoft, cartel, frente con el atlas y ayudas de ascenso.
- **Cliente.** Cada interior es un grupo aparte:
  - se junta por material (≤ 20 draw calls);
  - no lo ilumina el sol: MeshBasic con la luz horneada en colores por vértice;
  - se dibuja solo de cerca. De lejos, cada abertura se tapa con el pedazo de fachada que se le recortó.

**Tech Stack:** TypeScript (erasableSyntaxOnly), three.js 0.187, Vite 8, Vitest 5 (jsdom), Playwright (Chrome + SwiftShader), polygon-clipping 0.15.

**Spec:**
- `docs/superpowers/specs/2026-11-04-etapa2b-interiores-design.md`: manda.
- `docs/superpowers/specs/2026-11-03-adrogue-battle-royale-design.md`: el diseño general.

## Global Constraints

- **Rendimiento.** Nunca se suben los presupuestos de `e2e/perf.spec.ts`:

  | Calidad | Draw calls | Triángulos |
  |---|---|---|
  | baja | 130 | 130.000 |
  | media | 245 | 230.000 |
  | alta | 385 | 305.000 |

  Si algo no entra, se recorta en el interior (detalle, distancia de dibujo), nunca en la tabla.
- **Mapa.** `public/map/adrogue.map.json` pesa menos de 3 MB y `npm run build:map` termina con 0 warnings.
  - Única excepción, declarada: después de las Tareas 1 y 2, y hasta la 3, build:map sale con código 1.
  - Los avisos son exactamente los de relevamiento pendiente que lista la Tarea 1.
- **Determinismo.** Todo `src/shared/` es determinista:
  - nada de `Math.random`, `Date.now`, `performance.now` ni otros relojes;
  - no importa nada del DOM ni de three.js.
- **Assets.** No se baja nada: ni texturas nuevas, ni modelos, ni sonidos. Se usan solo texturas generadas en canvas y el juego CC0 que ya está en `public/textures`.
- **Marcas.** Sin logos: los nombres van como texto, con sus colores y una letra parecida.
- **Google.** Street View y la vista satelital son solo referencia. Ninguna imagen entra al repo.
- **Idioma.** Textos de la interfaz, comentarios y mensajes de error en castellano rioplatense.
- **Commits.** Terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No se hace push ni merge.

## Review Focus

1. **Entrar en diagonal, corriendo o agachado.** El jugador entra por una puerta a 35° de la normal con Shift, o agachado, y sube una escalera corriendo. Tiene que pasar sin trabarse en el marco ni en los escalones. Test: Tarea 4.
2. **Saltar y trepar bajo techo.** Debajo de una losa, saltar vuelve al piso sin quedar pegado al cielorraso. Trepar a un mostrador de 1,1 m funciona; frente a un estante de 2,2 m bajo la losa, el mantle ni arranca. Test: Tareas 2 y 4.
3. **Cambiar de calidad estando adentro.** Las mallas del interior pasan a los materiales nuevos: ninguna queda con uno liberado (negro) y no hay errores de consola. Test: Tarea 5 y e2e de la Tarea 11.
4. **Juntar botín a través de una pared o un vidrio.** Un objeto a 1,2 m del otro lado de un tabique o de una vidriera no se junta. Test: Tarea 11.
5. **Interiores pegados (Nación | Galicia).**
   - Desde adentro de uno, el de al lado no se dibuja.
   - Desde la vereda, en baja se dibuja uno solo, el más cercano.

   Así el frente de Esteban Adrogué no se pasa de 130 draw calls. Test: Tarea 5.

---

## Decisiones sobre huecos del spec

Las tareas las citan por número.

- **D1. El techo no se sube por adentro.** §5 pide llegar "a cada piso público y al techo, por las escaleras". §2.1 cierra los pisos no públicos con una losa sin escalera. Se decide:
  - el techo se sigue subiendo por afuera, con las ayudas de la 2a (`tests/mapgen/roof-access.test.ts`, sin cambios);
  - por adentro se llega a los pisos públicos y a la terraza de La Veneciana, que es el único techo público.
- **D2. Trepar adentro.** El mantle (`tryMantle`, `player.ts:229`) usa `supportHeight(…, Infinity)`: adentro siempre ve el techo y nunca arrancaría. Se decide que mida hasta `base + mantleReach`. Fuera de un edificio no cambia nada: lo prueba roof-access.
- **D3. Molinetes.** Son sólidos (§2.3), pero en una línea cerrada dejarían el andén afuera. Se decide que la línea deje un paso abierto de ≥ 1,0 m (el molinete ancho, abierto).
- **D4. Barandas de metal.** El spec no dice si frenan balas. Se decide que todas las barandas (vidrio, reja o caño) sean de clase `glass`: frenan a los jugadores y no a las balas.
- **D5. Fotos de fachada.** Las fotos CC BY-SA de la Casa de la Cultura y de la estación tapan sus puertas. Además, la de la estación está atada a `edgeIndex: 5` de b0714, que el relevamiento reemplaza. Se decide:
  - la foto se recorta en cada abertura; de lejos, el pedazo recortado va como tapa (D6);
  - en la Tarea 3, el controlador mueve el `edgeIndex` de la estación a la arista nueva.
- **D6. Aberturas de lejos.** §2.6 no dice qué se ve por un hueco cuando el interior no se dibuja: hoy se vería a través del edificio. Se decide:
  - el pedazo de fachada que se recorta en cada abertura se guarda como tapa;
  - la tapa se dibuja mientras el interior no se dibuja, con el mismo material y UV. De lejos, la fachada queda igual que hoy;
  - las tapas son una malla por interior y material (de 1 a 3: frente, pared y foto), nombrada con su clave de `WorldMaterials`;
  - van en el grupo de la malla de la que salen (el chunk o la foto), así se ocultan con ella; cuentan en los presupuestos.
- **D7. Cuántos interiores a la vez.** El spec dice "solo cuando": es condición necesaria, no suficiente. Se decide:
  - con la cámara adentro de un interior, se dibuja ese solo;
  - afuera, se dibujan los que están a < 60 m y en pantalla, hasta `max` por calidad (los más cercanos). Al empezar, `max` es 1 en baja, 2 en media y 3 en alta.
  - Si una parada no entra, se baja `max`, el `radius` o el detalle de esa calidad, nunca el presupuesto (§2.6).
- **D8. La estación sobre el andén.** El recorte de Microsoft solo saca lo que tapa la planta nueva: el resto de b0714 quedaría sobre el andén. Se decide:
  - la planta puede listar en `reemplaza` bloques de Microsoft que se borran enteros;
  - un chequeo nuevo rompe el build si un edificio pisa un andén más de 1 m². b0769 pisa 0,3 m², así que no salta.
- **D9. Alto del cine.** Una sala con gradas no entra en 1 piso de 3,8 m. La planta acepta `alto` (≥ pisos · 3,2 + 0,6).
- **D10. Puertas.**
  - Miden ≥ 1,0 m de ancho y ≥ 2,2 m de alto.
  - La hoja de vidrio "dibujada abierta" es solo dibujo, sin sólido.
  - La primera puerta de cada lugar es la principal: a ella va el teletransporte.
- **D11. Piso público para el botín.**
  - Cuenta el piso techado de los pisos públicos más la terraza de La Veneciana. Los patios no cuentan.
  - La cantidad es `clamp(round(área / 40), 4, 12)`.
- **D12. Patios.**
  - El patio del fondo del McDonald's y el de adelante del Guernica quedan fuera de la planta del edificio (sin losa ni techo).
  - Están adentro del recorte de Microsoft y los amuebla el interior.
- **D13. Atrio y lucernario.**
  - El atrio de la Casa de la Cultura atraviesa también el piso 4 cerrado: el bloque cerrado tiene el hueco.
  - El lucernario frena como vidrio en franjas de a lo sumo 0,2 m que siguen el dos aguas. Se camina encima como por una escalera y se ve hacia abajo.
- **D14. Guernica, "una parte techada".** Un edificio es un solo prisma con techo entero. Se decide:
  - la planta alta es techada;
  - la parte abierta es el balcón al frente, afuera de la planta, sobre el patio.
- **D15. Juntar sin línea de vista.** Con interiores aparece un caso que el spec no trata: hoy se junta a 2,5 m sin mirar si hay una pared en el medio. Se decide que juntar pida línea de vista (el vidrio también la corta).

## Orden de las tareas

- Se respeta el orden pedido. La primera parte (datos) se parte en dos tareas, porque son dos entregas que un revisor puede aprobar o rechazar por separado:
  - Tarea 1: plantas relevadas;
  - Tarea 2: entradas de los interiores en el mapa.
- Las dos van antes del relevamiento. Por eso build:map queda en rojo, con avisos conocidos, hasta la Tarea 3 (ver Global Constraints).
- Los tests que recorren el mapa real iteran sobre `map.interiors`. Antes del relevamiento ven los 4 lotes; después, los 9. La Tarea 3 agrega la aserción de que son 9.

## Estructura de archivos

- **Datos:**
  - `data/plantas.json` (nuevo): relevamiento de los 5 lugares sin lote.
  - `data/photo-facades.json`: el `edgeIndex` de la estación (Tarea 3).
- **mapgen:**
  - `src/mapgen/plantas-input.ts` (nuevo): carga y valida `data/plantas.json`.
  - `src/mapgen/plantas.ts` (nuevo): ubica cada planta en el mundo como un lote suelto.
  - `src/mapgen/interior-inputs.ts` (nuevo): aberturas, marco y puertas de los 9 lugares, para `MapData.interiors`.
  - Cambian `frentes-input.ts`, `frentes.ts`, `lots.ts`, `assemble.ts`, `spawns.ts`, `loot-spots.ts` y `tools/build-map.ts`.
- **shared:**
  - `src/shared/mapdata.ts`: `Frame`, `Opening`, `InteriorInput`, `MapData.interiors`, `Place.door`.
  - `src/shared/interiors/openings.ts` (nuevo): aberturas de las celdas del atlas y `doorsOf`.
  - `src/shared/interiors/types.ts` (nuevo): la descripción de un interior.
  - `src/shared/interiors/kit.ts` (nuevo): paredes, aberturas, losas, escaleras, barandas y muebles.
  - `src/shared/interiors/index.ts` (nuevo): el registro de planes, `buildInterior` y `validateInterior`.
  - Un módulo por lugar (nuevos): `bancos.ts`, `cultura.ts`, `mcdonalds.ts`, `veneciana.ts`, `cine.ts`, `guernica.ts` y `estacion.ts`.
  - Cambian `collision.ts`, `combat.ts`, `player.ts` y `match.ts`.
- **Cliente:**
  - `src/client/world/interiors/` (nuevo):
    - `textures.ts`: texturas de canvas;
    - `bake.ts`: luz horneada;
    - `models.ts`: muebles;
    - `build.ts`: mallas de un interior;
    - `exterior.ts`: partes de afuera y carteles;
    - `view.ts`: qué interior se dibuja y las tapas.
  - Cambian:
    - en `world/`: `types.ts`, `materials.ts`, `geometry.ts`, `fronts.ts`, `front-atlas.ts`, `chunks.ts`, `photo-facades.ts` y `landmarks.ts`;
    - en `render/`: `scene.ts` y `quality.ts`;
    - `main.ts`, `debug.ts` y `ui/hud.ts`.
- **Tests:**
  - `tests/mapgen/plantas.test.ts` y `tests/mapgen/interior-inputs.test.ts`;
  - `tests/shared/interiors/`:
    - `fixture.ts` y `walk.ts`;
    - `kit.test.ts` y `all.test.ts`;
    - uno por lugar;
  - `tests/client/interiors.test.ts` y `tests/client/interiors-map.test.ts`;
  - `e2e/interiors.spec.ts`;
  - cambian `e2e/helpers.ts` y `e2e/perf.spec.ts`.

---

### Task 1: Plantas relevadas: formato, validación y armado

**Files:**
- Create:
  - `data/plantas.json`, con `{ "plantas": [] }`;
  - `src/mapgen/plantas-input.ts`;
  - `src/mapgen/plantas.ts`;
  - `tests/fixtures/plantas-prueba.json`.
- Modify:
  - `src/shared/mapdata.ts`: `Frame`;
  - `src/mapgen/frentes-input.ts`: exportar `num`, `str`, `color`, `oneOf`, `unknownField` y `validateLote`; agregar `LoteInput.alto?: number`;
  - `src/mapgen/lots.ts`: `lotBuilding` usa `alto ?? heightFor(pisos)`, y `lotSign` recibe esa altura, como hoy;
  - `src/mapgen/frentes.ts`, `src/mapgen/assemble.ts` y `tools/build-map.ts`.
- Test: `tests/mapgen/plantas.test.ts`

**Interfaces:**
- Produces, en `mapdata.ts`: `export interface Frame { origin: Vec2; u: Vec2; v: Vec2 }`.
  - Un punto local (u, v) va al mundo como `origin + u·U + v·V`.
  - U y V son unitarios y perpendiculares.
  - U corre a lo largo del frente y V entra al edificio.
- Produces, en `plantas-input.ts`:
  - `export const SIN_LOTE: readonly string[] = ['guernica-bar', 'cine-pixel', 'mcdonalds', 'estacion-adrogue', 'la-veneciana']`
  - `export type Marco = { calle: string; vereda: 'norte' | 'sur' | 'este' | 'oeste'; desde: string; hasta: string; s: number } | { lat: number; lon: number; rumbo: number }`
  - `export interface PuertaInput { arista: number; centro: number; ancho: number; alto: number; piso: number }`
  - `export interface VidrioInput { arista: number; desde: number; hasta: number; abajo: number; arriba: number; piso: number }`
  - `export interface PlantaInput { lugar: string; fecha: string; marco: Marco; planta: Vec2[]; patios: Vec2[][]; frente: number[]; reemplaza: string[]; puertas: PuertaInput[]; vidrios: VidrioInput[]; lote: LoteInput }`
  - `export function loadPlantas(frentes: FrentesInput, path = 'data/plantas.json'): PlantaInput[]`
  - `export function validatePlantas(data: unknown, source: string, frentes: FrentesInput): PlantaInput[]`
- **Formato de una entrada.** Los campos de aspecto van sueltos, como en un lote: `color`, `colorPB`, `material`, `pb`, `arriba`, `puerta` (la bahía donde el atlas pinta la puerta), `toldo`, `cartel`, `pisos` y `alto`. Se validan con `validateLote`, que completa `ancho` con el largo del frente, `fondo` con la profundidad de la planta y `lugar`.

  ```json
  { "lugar": "guernica-bar", "fecha": "2026-11",
    "marco": { "calle": "Pellerano", "vereda": "norte", "desde": "Esteban Adrogué", "hasta": "Samuel Miguel Spiro", "s": 31.5 },
    "planta": [[0, 4], [9.6, 4], [9.6, 21], [0, 21]],
    "patios": [[[0, 0], [9.6, 0], [9.6, 4], [0, 4]]],
    "frente": [0], "pisos": 2, "reemplaza": [],
    "puertas": [{ "arista": 0, "centro": 4.8, "ancho": 1.6, "alto": 2.4, "piso": 0 }],
    "vidrios": [{ "arista": 0, "desde": 0.4, "hasta": 3.8, "abajo": 0.3, "arriba": 2.6, "piso": 0 }],
    "color": "#3a3a3a", "pb": "vidriera", "arriba": "ventanas", "puerta": "medio",
    "cartel": { "texto": "GUERNICA", "fondo": "#2b2b2b", "letra": "#f2c14e" } }
  ```

  - **Marco de frente.** Es `resolveFrontage(roads, { id: 'pl-<lugar>', calle, vereda, desde, hasta })`.
    - El origen es el punto de la línea de edificación a `s` m de `desde`.
    - U es la tangente de la línea en ese punto y V, la normal hacia la manzana (`inward`).
  - **Marco geográfico.** El origen es `project(lat, lon)`, U = (sin r, −cos r) y V = (cos r, sin r), con r = `rumbo` en grados desde el norte, en sentido horario. V queda a la derecha de U.
  - **Índices.** `arista` cuenta sobre `planta` tal como está escrita. `centro`, `desde` y `hasta` son metros desde el vértice `arista`.
- Produces, en `plantas.ts`:
  - `export interface PlantaShape extends LotShape { planta: PlantaInput; frame: Frame; patios: Vec2[][] }`, en coordenadas de mundo:
    - `id` es `pl-<lugar>`;
    - `footprint` es la planta, antihoraria;
    - `front` es la corrida de las aristas `frente`, de punta a punta;
    - `claim` son la planta, los patios y, con marco de frente, la franja de la calle delante (como `rawClaim` de `lots.ts`).
  - `export function placePlantas(plantas: PlantaInput[], roads: Road[]): PlantaShape[]`.
- Produces, en `frentes.ts`:
  - `applyFrentes(input, roads, buildings, places, pois, plantas: PlantaShape[] = [])`.
    - Antes de recortar, borra los ids de `reemplaza`.
    - Las plantas entran a `lots`. Así reciben, sin código nuevo, el recorte, el enlace por `lote.lugar`, el cartel con `lotSign`, el frente con el atlas y las puntas para `climb.ts`.
  - `FrentesResult.plantas: Map<string /* placeId */, PlantaShape>`.
- Produces, en `assemble.ts`: `raw.plantas?: PlantaInput[]`.
  - **Avisos fatales** (formato exacto del comienzo):
    - `planta de <lugar>: pisa la calle <nombre> (x,x m²); corré el marco hacia adentro`. Salta con más de 0,5 m² sobre calzada + vereda de una calle vehicular.
    - `planta de <lugar> se pisa con <frente f, lote k | planta de <otro>> (x,x m²)`. Salta con más de 0,05 m².
    - `planta de <lugar>: "reemplaza" nombra <id>, que no es un edificio de Microsoft`
    - `planta de <lugar>: la puerta k da a <id>`. Salta si 1 m afuera del centro de la puerta cae adentro de otro edificio.
    - `<id>: pisa un andén (x,x m²)`, para cualquier edificio con más de 1 m² (D8).
    - `<lugar>: falta relevar la planta (data/plantas.json)`, por cada lugar de `SIN_LOTE` sin entrada.

- [ ] **Step 1: Tests** en `tests/mapgen/plantas.test.ts`.
  - **`validatePlantas` tira** con un mensaje que nombra el lugar y el campo:
    - campo desconocido;
    - `lugar` fuera de `SIN_LOTE`;
    - `lugar` que ya tiene lote en `frentes.json`: el mensaje nombra el frente y el lote;
    - planta que se cruza: nombra las dos aristas;
    - puerta que no entra en su arista, contando 0,2 m libres en cada punta;
    - ninguna puerta con `piso` 0;
    - `ancho` < 1,0 o `alto` < 2,2 (D10);
    - vidrio que se pisa con una puerta del mismo piso y arista;
    - `alto` < pisos · 3,2 + 0,6;
    - `puerta` (dibujo) que no es la bahía de 3 m donde cae `puertas[0]`: el mensaje dice "la puerta está en la bahía k de n".
  - **`placePlantas`**, sobre `tests/fixtures/osm-mini.json` y `plantas-prueba.json`:
    - con marco de frente, el vértice local [0, 0] queda sobre la línea a `s` (< 0,01 m);
    - [0, 1] queda a 1 m hacia la manzana;
    - el área en el mundo es igual a la local (±0,01 m²);
    - con marco geográfico y `rumbo: 90`, U ≈ (1, 0) y V ≈ (0, 1).
  - **`assembleMap`** con fixtures:
    - el bloque de Microsoft debajo pierde lo que tapa la planta;
    - con `reemplaza`, desaparece entero;
    - el edificio `pl-<lugar>` tiene los `pisos`, el `alto` y el `color` del archivo y aristas de frente;
    - el lugar queda con ese `buildingId` y el cartel del archivo;
    - cada aviso fatal de la lista aparece en su caso.
- [ ] **Step 2: Correr y ver que fallan.** `npx vitest run tests/mapgen/plantas.test.ts`.
- [ ] **Step 3: Implementar.**
  - La validación usa los helpers exportados de `frentes-input.ts`: mismos mensajes y mismo estilo.
  - `build-map.ts` carga las plantas con `loadPlantas(frentes)`.
  - Línea de resumen: `plantas: N (de 5)`.
- [ ] **Step 4: Verificar.**
  - `npx vitest run && npm run typecheck`. **Expected:** PASS.
  - `npm run build:map`. **Expected:** sale con código 1 y estos 6 avisos exactos:
    - `falta relevar la planta`, una vez por cada lugar de `SIN_LOTE` (5);
    - `b0714: pisa un andén`.
- [ ] **Step 5: Commit** `feat(mapa): plantas relevadas como lotes sueltos, con validación`.

### Task 2: Entradas de los interiores en el mapa: aberturas, marco, puerta, aparición y puntos libres

**Files:**
- Create:
  - `src/shared/interiors/openings.ts`;
  - `src/mapgen/interior-inputs.ts`;
  - `tests/mapgen/interior-inputs.test.ts`.
- Modify:
  - `src/shared/mapdata.ts`;
  - `src/client/world/front-atlas.ts`: `drawGround` dibuja vidrio y puerta desde `LOT_OPENINGS`;
  - `src/mapgen/assemble.ts`;
  - `src/mapgen/spawns.ts`;
  - `src/shared/player.ts` (D2);
  - `src/mapgen/lots.ts`: `aidEnds` deja libres las puertas de una planta;
  - `src/client/main.ts`: `teleport` mira a `place.door`;
  - los tests que arman un `MapData` a mano: `interiors: []`.
- Test:
  - `tests/mapgen/interior-inputs.test.ts`;
  - `tests/mapgen/assemble.test.ts`, para `isFreeSpot`;
  - `tests/shared/player.test.ts`;
  - `tests/client/front-atlas.test.ts` y `tests/client/canvas-stub.ts`: el stub suma `onCall(method, args)`, para registrar los `fillRect`.

**Interfaces:**
- Consumes: Tarea 1 (`Frame`, `PlantaShape`, `FrentesResult.plantas`).
- Produces, en `mapdata.ts`:
  - `export interface Opening { kind: 'puerta' | 'vidrio'; edge: number; s0: number; s1: number; y0: number; y1: number }`
    - Va sobre la arista `edge` de la planta guardada (ya redondeada).
    - Ocupa de `s0` a `s1` m desde `footprint[edge]` y de `y0` a `y1` de alto.
    - Una puerta arranca en el piso de su nivel (`y0 = nivel · 3,2`).
  - `export interface InteriorInput { placeId: string; buildingId: string; frame: Frame; openings: Opening[]; patios: Vec2[][] }`
  - `MapData.interiors: InteriorInput[]`
  - `Place.door?: Vec2`: el centro de la puerta principal (D10), al ras de la cara exterior.
- Produces, en `openings.ts`:
  - `export const DOOR_MIN_W = 1.0, LINTEL_MIN = 2.2;`
  - `export type LotCell = 'vidriera' | 'vidriera-puerta' | 'banco' | 'banco-puerta' | 'acceso'`
  - `export const LOT_OPENINGS: Record<LotCell, readonly { kind: Opening['kind']; x0: number; x1: number; y0: number; y1: number }[]>`
    - Metros dentro de una bahía de `BAY_W` (3 m); x escala con `bw / BAY_W`, como la textura.
    - Las puertas van del piso a ≥ 2,2 m y miden ≥ 1,0 m de ancho.
    - El atlas pinta exactamente estos rectángulos: lo pintado coincide con el hueco.
  - `export interface Door { at: Vec2; normal: Vec2; width: number; level: number }`: `normal` apunta hacia afuera.
  - `export function doorsOf(b: Building, input: InteriorInput): Door[]`: en el orden de `openings`.
- Produces, en `interior-inputs.ts`:
  - `export function lotOpenings(b: Building): Opening[]`
    - Recorre la corrida principal de `front.edges` en n bahías de `bw = L / n`, como `fronts.ts`.
    - La bahía de la puerta lleva `LOT_OPENINGS[groundCells(pb).door]` y las demás, `LOT_OPENINGS[rest]`.
    - Una bahía que cruza dos aristas se parte.
    - Para lugares con lote: los tres bancos (`banco`) y la Casa de la Cultura (`acceso`).
  - `export function interiorInputs(buildings: Building[], places: Omit<Place, 'spawn'>[], plantas: Map<string, PlantaShape>, lotFronts: Map<string, Vec2[]>): { inputs: InteriorInput[]; warnings: string[] }`
    - **Marco de un lote:**
      - el origen es la primera punta de su corrida de frente;
      - U va hacia la última punta;
      - V es la perpendicular hacia adentro: `origin + 0,5·V` cae en la planta.
    - **Plantas:** el marco y los patios salen de `PlantaShape`.
    - **Aberturas de una planta:** se ubican por posición sobre la planta ya redondeada (la arista más cercana al punto medio), no por índice.
- Produces, en `spawns.ts`:
  - `export function isFreeSpot(world: CollisionWorld, x: number, z: number, y = 0): boolean`. Es libre si se cumple todo esto:
    - queda dentro de los bounds − 1 m;
    - `!world.overlaps(x, z, 0,35, y + 0,05, y + 1,8)`;
    - `|world.supportHeight(x, z, 0,35, y + 0,05) − y| < 1e-6`.

    Una losa por encima ya no lo hace fallar (§2.5).
  - `export function randomSpawns(world, count = 64, spacings = [25, 15, 8], tries = 4000, keep: (x: number, z: number) => boolean = () => true): Vec3[]`. assemble le pasa `keep`, que da false adentro de una planta o un patio de un interior: las apariciones quedan afuera.
  - `export function walksIn(world: CollisionWorld, from: Vec3, door: Door): boolean`. Mira el segmento recto desde `from` hasta 0,4 m antes de `door.at`, cada 0,25 m: tiene que estar libre para el disco del jugador entre 0,5 y 1,8 m.
- **Aparición** (`Place.spawn`) en assemble:
  - el punto de partida es `door.at + 5·door.normal`;
  - `accept` pide que quede fuera de toda planta o patio y que `walksIn` dé true;
  - las relajaciones, con `SPAWN_RELAXED`, como hoy.
- **Mantle** (`player.ts`, D2): `const top = world.supportHeight(px, pz, 0, base + PLAYER.mantleReach + REACH_EPS)`, con `base` calculado antes.
- **Ayudas de ascenso** (`lots.ts`):
  - si `l` es una `PlantaShape`, `aidEnds(l)` descarta la punta cuya bahía tiene cualquier puerta de `planta.puertas`, no solo la de `puerta`;
  - en los lotes, la puerta es una sola y ya la evita.
- **Parada `estacion`.** La parada `estacion` del TOUR usa `place`, así que ahora queda frente a la puerta de la boletería, mirándola. Es lo esperado: desde la Tarea 5, ahí se dibuja el interior.

- [ ] **Step 1: Tests.**
  - **`lotOpenings` del Banco Nación:**
    - exactamente una puerta, en la bahía `medio`, con `y0 === 0`, `y1 >= 2.2` y `s1 − s0 >= 1.0`;
    - vidrios en las otras bahías;
    - toda abertura cumple `0 <= s0 < s1 <=` el largo de su arista.
  - **`map.interiors` sobre el mapa real:**
    - uno por lugar entrable presente;
    - en cada marco, `|U| = |V| = 1` (±1e-9), `U·V = 0` y `origin + 0,5·V` adentro de la planta;
    - toda abertura cae sobre su arista.
  - **`Place.door` de cada lugar con interior:**
    - es igual a `doorsOf(…)[0].at` (±0,01) y queda sobre el borde de la planta (< 0,01 m);
    - su `spawn` cumple `isFreeSpot`, queda afuera de la planta, a entre 3 y 8 m de la puerta, y `walksIn` da true.
  - **`randomSpawns`:** ninguno adentro de una planta o un patio de un interior.
  - **`isFreeSpot`** con prismas sueltos:
    - con una losa de 3,0 a 3,2 encima de (0, 0) da true (antes daba false);
    - con un banco de 0 a 0,5, false;
    - `isFreeSpot(w, 0, 0, 3.2)` sobre la losa, true;
    - adentro de un sólido de 0 a 3, false.
  - **Mantle bajo losa** (Review Focus 2), con una losa de 3,0 a 3,2 sobre todo:
    - con un mostrador de 1,1 m adelante, salto + W pasa por `mode === 'mantle'` y termina `onGround` a y = 1,1 (±0,01);
    - con un estante de 2,2 m, en 2 s nunca hay `mode === 'mantle'`.
  - **Ayudas de ascenso:** en el mapa real, ningún pie de escalera ni contenedor queda a menos de 1,0 m de `door.at + 0,5·door.normal`.
  - **`front-atlas`:** con el stub que registra llamadas, cada celda de `LotCell` pinta el vidrio y la hoja de la puerta exactamente en los rectángulos de `LOT_OPENINGS[cell]` (en px de la celda, ±0,5 px).
    - El stub no dibuja: el test mira los `fillRect`, no los píxeles.
- [ ] **Step 2: Correr y ver que fallan.**
- [ ] **Step 3: Implementar.**
  - `build-map.ts` imprime `interiores: N, puertas: M`.
  - El cliente mira a `place.door ?? place.sign?.anchor ?? place.position` al teletransportar.
- [ ] **Step 4: Verificar.**
  - `npx vitest run` (incluye `roof-access.test.ts`, sin cambios) y `npm run typecheck`. **Expected:** PASS.
  - `npm run build:map`. **Expected:** los mismos 6 avisos de la Tarea 1.
- [ ] **Step 5: Commit** `feat(mapa): aberturas, puertas y marco de los interiores; aparición frente a la puerta y puntos libres bajo losa`.

### Task 3: Tarea del controlador (relevamiento)

**La hace el controlador, no un subagente.** Releva con Street View y la vista satelital en el navegador, con las referencias que ya tiene. Ninguna imagen entra al repo.

- [ ] **Step 1: Cargar `data/plantas.json`**, una entrada por cada lugar de `SIN_LOTE`.
  - **Forma.** La planta con su forma real:
    - la esquina redonda de La Veneciana, en tramos de ≤ 1 m;
    - el patio de adelante del Guernica y el del fondo del McDonald's, en `patios` (D12).
  - **Pisos.** Guernica 2, La Veneciana 1 y el cine con su `alto` real (D9).
  - **Aberturas.**
    - Todas las puertas reales, con la principal primero (D10).
    - Todos los vidrios: en La Veneciana, el perímetro entero.
    - En el Guernica, una puerta con `piso: 1` hacia el balcón (D14).
  - **Aspecto.** Frente, colores, material, `pb`, `arriba`, `puerta` (dibujo), toldo y cartel.
  - **Estación:**
    - la boletería al costado del andén, con `"reemplaza": ["b0714"]` (D8);
    - en `data/photo-facades.json`, el `edgeIndex` de la foto pasa a la arista que muestra la foto (D5).
- [ ] **Step 2: Aserciones nuevas** en `tests/mapgen/plantas.test.ts`, sobre el mapa real:
  - `map.interiors` tiene los 9 de `ENTERABLE_IDS`;
  - Guernica tiene `floors === 2` y `height === 7.0`;
  - La Veneciana, `floors === 1`;
  - ningún edificio pisa un andén más de 1 m²;
  - 1 m afuera de cada puerta, `isFreeSpot` da true.
- [ ] **Step 3: Verificar.**
  - `npm run build:map`. **Expected:** 0 warnings y < 3 MB.
  - `npx vitest run && npm run typecheck`. **Expected:** PASS.
  - `npx playwright test e2e/tour.spec.ts`: el controlador compara las capturas de los 5 lugares con las referencias.
- [ ] **Step 4: Commit** `feat(mapa): relevamiento de las plantas de McDonald's, Cine Pixel, Guernica, La Veneciana y la estación`.

### Task 4: Edificios huecos en `src/shared/`: kit, colisión, vidrio y recorrido real

**Files:**
- Create:
  - `src/shared/interiors/types.ts`, `kit.ts` e `index.ts`;
  - `tests/shared/interiors/fixture.ts`, `walk.ts`, `kit.test.ts` y `all.test.ts`.
- Modify:
  - `src/shared/collision.ts`;
  - `src/shared/combat.ts`;
  - `src/mapgen/assemble.ts`: avisos de `validateInterior`;
  - `tests/shared/collision.test.ts`.

**Interfaces:**
- Consumes: Tarea 2 (`InteriorInput`, `Opening`, `Door`, `doorsOf`, `LINTEL_MIN`, `DOOR_MIN_W`, `isFreeSpot`).
- Produces, en `types.ts`:

  ```ts
  /** Material de una cara; el cliente lo traduce a `in_<mat>` de WorldMaterials. `color` multiplica la textura. */
  export type Mat = 'liso' | 'porcelanato' | 'madera' | 'machimbre' | 'baldosa' | 'ceramico' | 'tela' | 'metal' | 'ladrillo' | 'vidrio' | 'luz';
  export interface Look { mat: Mat; color: string }
  /** solid: frena jugadores y balas; glass: solo jugadores; none: solo se ve. */
  export type Collide = 'solid' | 'glass' | 'none';
  export type Role = 'pared' | 'tabique' | 'losa' | 'escalon' | 'baranda' | 'dintel' | 'mueble' | 'vidrio' | 'otro';
  /** Prisma de planta antihoraria (mundo) entre y0 e y1. Una cara sin Look no se dibuja; `hide`: aristas de `polygon`
   *  sin cara lateral (la cara de afuera de las paredes exteriores la dibuja el chunk). `out`: se dibuja siempre, con el
   *  edificio (tarea 5), no solo de cerca. */
  export interface Block { polygon: Vec2[]; y0: number; y1: number; collide: Collide; role: Role; top?: Look; bottom?: Look; side?: Look; hide?: number[]; out?: true }
  /** Base; cada tarea de interior suma los suyos. */
  export type ItemModel = 'silla' | 'banqueta' | 'lampara' | 'mesa' | 'sillon' | 'hoja-vidrio';
  /** yaw: rotación three.js sobre +Y, como Prop.rotation. detail 2: no se dibuja en baja. */
  export interface Item { model: ItemModel; at: Vec3; yaw: number; color?: string; detail?: 2 }
  /** Cartel: `normal` apunta hacia quien lo lee. Uno `out` se vuelve un Sign del mapa (alto SIGN_H). */
  export interface Label { text: string; at: Vec3; normal: Vec2; width: number; height: number; look: SignLook; glow?: true; out?: true }
  export interface Lamp { at: Vec3; radius: number; power: number }
  export interface FloorArea { level: number; y: number; polygon: Vec2[]; holes: Vec2[][]; area: number }
  /** foot: 0,6 m antes del primer escalón; top: 0,6 m pasado el último; yaw: subiendo (convención de player.ts). */
  export interface StairRun { from: number; to: number; foot: Vec3; top: Vec3; yaw: number }
  /** yaw con la convención de la cámara y del TOUR: 0 mira a −z, π/2 a −x. */
  export interface Viewpoint { id: string; pos: Vec3; yaw: number }
  /** marks: puntos con nombre que fija cada plan (centro del salón, pasos, balcón…) para que los tests caminen hasta ahí. */
  export interface Interior { placeId: string; buildingId: string; publicFloors: number; terrace: boolean; ambient: number;
    blocks: Block[]; items: Item[]; labels: Label[]; lamps: Lamp[]; floors: FloorArea[]; stairs: StairRun[]; doors: Door[];
    views: Viewpoint[]; marks: Record<string, Vec3> }
  ```

- Produces, en `kit.ts`:
  - Constantes: `WALL_OUT = 0.2`, `WALL_IN = 0.1`, `SLAB_T = 0.2`, `ROOF_T = 0.8`, `RISER_MAX = 0.2`, `TREAD = 0.3`, `STAIR_MIN_W = 1.2`, `RAIL_H = 1.0`, `SOLID_MIN_H = 0.7` y `GROUND_Y = 0.02`.
  - `MODEL_BOX: Partial<Record<ItemModel, { w: number; d: number; h: number }>>`: solo los modelos sólidos de §2.3 (todo mueble de ≥ 0,7 m con cuerpo, y las mesas).
  - **Alturas:**
    - el nivel k ≥ 1 se pisa a `k · 3,2`, sobre una losa de `k · 3,2 − 0,2` a `k · 3,2`;
    - la planta baja se dibuja a `GROUND_Y`, sin sólido;
    - el techo va de `height − 0,8` a `height`;
    - lo que está arriba del último piso público es un solo sólido, de `publicFloors · 3,2 − 0,2` a `height`, con los huecos de `holes` (D13);
    - con `terrace`, el techo es un piso público más: el nivel `publicFloors`, que se pisa a `height`, con su hueco de escalera.
    - Las paredes exteriores van de 0 a `height`. Las losas, el bloque cerrado y el techo cubren la planta corrida 0,2 m hacia adentro.
  - **Ángulos** en el marco local: `0` mira a +V (hacia adentro) y `π/2`, a +U. El kit los pasa a la convención del mundo.

  ```ts
  export interface ShellOpts { publicFloors: number; terrace?: true; holes?: { level: number; polygon: Vec2[] }[]; wall: Look; floor: Look | Look[]; ceiling: Look | Look[] }
  export interface WallOpts { t?: number; y0?: number; y1?: number; gaps?: { at: number; width: number; height: number; glassLeaf?: true }[]; look: Look; collide?: Collide }
  export interface StairOpts { from: number; to: number; foot: Vec2; dir: Vec2; width: number; look: Look; rail?: Look; out?: true }
  export class Kit {
    constructor(b: Building, input: InteriorInput);
    readonly box: { u0: number; u1: number; v0: number; v1: number };   // la planta en el marco local
    readonly openings: (Opening & { a: Vec2; c: Vec2 })[];             // extremos en el marco local
    at(p: Vec2): Vec2;                                                 // local → mundo
    shell(o: ShellOpts): void;          // paredes exteriores cortadas en las aberturas (antepecho, dintel, vidrio de 0,04 m clase glass), losas, techo y bloque cerrado
    wall(from: Vec2, to: Vec2, o: WallOpts): void;   // tabique (WALL_IN salvo `t`), huecos con dintel ≥ LINTEL_MIN
    stair(o: StairOpts): void;          // escalones sólidos hasta el piso de abajo, hueco en la losa sobre toda su planta, barandas y StairRun
    railing(path: Vec2[], level: number, look: Look): void;           // RAIL_H, collide 'glass' (D4)
    block(poly: Vec2[], y0: number, y1: number, collide: Collide, role: Role, looks: Pick<Block, 'top' | 'bottom' | 'side'>, out?: true): void;
    furniture(model: ItemModel, p: Vec2, y: number, yaw: number, color?: string, detail?: 2): void;   // Item + su caja de MODEL_BOX
    label(text: string, p: Vec2, y: number, normal: Vec2, width: number, height: number, look: SignLook, o?: { glow?: true; out?: true }): void;
    lamp(p: Vec2, y: number, radius: number, power: number): void;
    view(id: string, p: Vec2, y: number, yaw: number): void;
    mark(id: string, p: Vec2, y: number): void;
    done(ambient: number): Interior;
  }
  ```

- Produces, en `index.ts`:
  - `export type InteriorPlan = (k: Kit) => Interior;`
  - `export const INTERIOR_PLANS: Partial<Record<string, InteriorPlan>>`: un objeto literal donde cada tarea de interior agrega su línea.
  - `export function buildInterior(b: Building, input: InteriorInput): Interior`. Sin plan, arma la caja de §2.1: `shell({ publicFloors: 1, … })` con looks neutros y `done(0.8)`.
  - `export function buildInteriors(map: Pick<MapData, 'buildings' | 'interiors'>): Interior[]`
  - `export function interiorOf(map: Pick<MapData, 'buildings' | 'interiors'>, placeId: string): Interior`
  - `export function validateInterior(i: Interior): string[]`. Cada mensaje nombra el lugar, qué está mal y dónde. Revisa:
    - escalones: contrahuella ≤ 0,2 (+1e-6), huella 0,3 ± 0,01, ancho ≥ 1,2;
    - dinteles ≥ 2,2 sobre su piso;
    - barandas de 1,0 ± 0,01;
    - paredes de 0,2 ± 0,01 y tabiques de 0,1 ± 0,01;
    - cada ítem de `MODEL_BOX` con su caja `mueble`;
    - todo bloque que no es `out` adentro de la planta o de un patio.
  - `export function publicFloorArea(i: Interior): number`: Σ `floors.area` (D11).
  - `src/shared/interiors/` no importa `collision.ts`: el que importa es `collision.ts`.
- Produces, en `collision.ts`:
  - `CollisionMap` suma `interiors?: InteriorInput[]`.
  - `export function interiorPrisms(i: Interior): Prism[]`: los bloques con `collide !== 'none'`, con tag `<buildingId>` o `glass:<buildingId>`.
  - `collisionPrisms` usa `interiorPrisms(buildInterior(…))` en vez del prisma lleno de un edificio con interior. El pretil sigue igual.
  - `toSolid` marca el vidrio.
  - `overlaps(x, z, r, minY, maxY, throughGlass = false)` y `raycast(origin, dir, maxDist, throughGlass = false)`.
  - `supportHeight` y `pushOut` cuentan el vidrio.
- Produces, en `combat.ts`: `hitscan` llama a `overlaps` y a `raycast` con `throughGlass = true`.
- Produces, en `tests/shared/interiors/walk.ts` (lo usan las tareas 6 a 11):
  - `export function enterDoor(world: CollisionWorld, d: Door, o?: { angleDeg?: number; sprint?: boolean; crouch?: boolean; from?: number }): PlayerState`
    - Arranca a `from` m afuera (2 por defecto), a la altura `level · 3,2`, mirando hacia adentro.
    - Aprieta W hasta llegar a 2 m adentro o hasta 6 s.
    - Para una puerta de nivel > 0, `all.test.ts` usa `from: 1` (el balcón del Guernica).
  - `export function walkTo(world: CollisionWorld, from: Vec3, to: Vec2 | readonly Vec2[], seconds = 10): PlayerState`: camina derecho a cada punto, en orden; los puntos son `marks` del plan.
  - `export function climbStair(world: CollisionWorld, s: StairRun, down = false): PlayerState`
  - `export function insideOf(b: Building, p: Vec3): boolean`
- Produces, en `fixture.ts`: `export function testInterior(o?: { publicFloors?: number; stair?: boolean }): { b: Building; input: InteriorInput; interior: Interior; world: CollisionWorld }`.
  - Es un edificio de 10 m de frente × 15 m de fondo y 2 pisos (`height` 7,0), con una puerta de 1,6 m y dos vidrios al frente.
  - Por defecto `publicFloors: 1` y sin escalera.
  - Con `stair`, una escalera de 1,2 m de ancho del nivel 0 al 1.

- [ ] **Step 1: Tests** en `kit.test.ts`, sobre `testInterior`:
  - **Entrar:**
    - `enterDoor` derecho termina adentro, `onGround`, con y = 0 (±0,05), en ≤ 3 s;
    - (Review Focus 1) también a 35° con Shift y agachado.
  - **Vidrio:**
    - caminar contra un vidrio no lo cruza (el jugador sigue afuera a los 3 s);
    - `hitscan` a y = 1,5 tirado desde 2 m afuera, perpendicular al vidrio, pega en la cara de adentro de la pared del fondo, a 16,8 m (2 + 15 − 0,2, ±0,05);
    - con un blanco adentro detrás del vidrio da `target`.
  - **Pared:** desde adentro, con un blanco afuera detrás de una pared, da `world` en la pared; por el hueco de la puerta da `target`.
  - **Losa y pisos cerrados:**
    - adentro, `isFreeSpot` da true;
    - sin escalera, `world.overlaps(centro, 0.35, 3.25, 5.0)` da true: el bloque cerrado.
  - **Escalera** (`publicFloors: 2, stair: true`):
    - `climbStair` termina a y = 3,2 (±0,05), `onGround` y `mode === 'walk'`;
    - bajando, a y = 0 (±0,05);
    - (Review Focus 1) también con Shift.
  - **`validateInterior`:**
    - el de prueba da `[]`;
    - con una contrahuella de 0,25, el mensaje dice "contrahuella";
    - con un dintel de 2,0, "dintel";
    - con una baranda de 0,9, "baranda";
    - con una escalera de 1,0 de ancho, "ancho".
  - **Muebles:**
    - una `mesa` frena a un jugador que camina contra ella; una `silla` se cruza;
    - un blanco agachado detrás de una mesa, con un tiro a 10 m desde 1,65 m al centro del cuerpo, da `world`.
  - **Bajo techo** (Review Focus 2):
    - saltar bajo la losa termina `onGround` a y = 0 en ≤ 1,5 s;
    - trepar a un mostrador de 1,1 m funciona;
    - frente a un estante de 2,2 m, nunca hay `mode === 'mantle'`.
  - **Colisión:**
    - `exitPockets` sobre un `MapData` mínimo con este interior da `stats.pockets === 0`: el piso de adentro se une con la calle por la puerta;
    - `raycast` contra un prisma de vidrio pega por defecto y pasa con `throughGlass`.
- [ ] **Step 2: Tests** en `all.test.ts`, sobre el mapa real, para cada interior de `buildInteriors(map)`:
  - `validateInterior` da `[]`;
  - cada puerta: `enterDoor` termina adentro y `onGround`, a la altura de su nivel (±0,05);
  - cada escalera: `climbStair` sube a `top[1]` (±0,05) y baja;
  - en `collisionPrisms(map)` no queda ningún prisma con la planta del edificio de 0 a `height`;
  - ningún relleno (`fill`) pisa una planta de interior más de 0,05 m², y ninguna escalera de hueco cae adentro;
  - ningún prop (contenedor, escalera, banco) se pisa con un bloque sólido de un interior, ni siquiera uno `out`;
  - todo `marks` cumple `isFreeSpot(…, y)`.
- [ ] **Step 3: Correr y ver que fallan.**
- [ ] **Step 4: Implementar.**
  - Las losas con huecos se parten en polígonos simples (los prismas no tienen agujeros): franjas en el marco local cortadas contra la planta corrida, con `polygon-clipping` (`intersection`).
  - `assemble.ts` suma los mensajes de `validateInterior` a los avisos fatales.
- [ ] **Step 5: Verificar.**
  - `npx vitest run` (incluye roof-access) y `npm run typecheck`. **Expected:** PASS.
  - `npm run build:map`. **Expected:** 0 warnings.
  - `npx playwright test e2e/app.spec.ts e2e/tour.spec.ts`. **Expected:** PASS.
- [ ] **Step 6: Commit** `feat(interiores): edificios huecos con aberturas, losas, escaleras y vidrio que no frena balas`.

### Task 5: Dibujo de los interiores: texturas, luz, vidrio, instancias, visibilidad y calidad

**Files:**
- Create:
  - `src/client/world/interiors/textures.ts`, `bake.ts`, `models.ts`, `build.ts`, `exterior.ts` y `view.ts`;
  - `tests/client/interiors.test.ts` y `tests/client/interiors-map.test.ts`.
- Modify:
  - en `src/client/world/`: `types.ts`, `materials.ts`, `geometry.ts`, `fronts.ts`, `chunks.ts` y `photo-facades.ts`;
  - `src/client/render/scene.ts` y `src/client/render/quality.ts`;
  - `src/client/main.ts` y `src/client/debug.ts`.

**Interfaces:**
- Consumes: Tarea 4 (`Interior`, `Block`, `Item`, `Label`, `Mat`, `buildInteriors`) y Tarea 2 (`Opening`).
- Produces:
  - **Materiales.** ``export type InteriorKey = `in_${Mat}` | 'in_mueble'``, en `types.ts` del cliente. `WorldMaterials` suma esas claves, que crea `createMaterials`:
    - `MeshBasicMaterial` con `vertexColors` y la textura de su Mat;
    - `in_vidrio` es transparente, con `depthWrite: false`, de los dos lados;
    - `in_luz` (lo que brilla: no se le hornea sombra) e `in_mueble` (todos los muebles) no tienen textura.

    Las mallas de un interior se llaman con su clave, así `scene.setMaterials` las cambia al cambiar la calidad.
  - **Texturas.** `textures.ts`: `export function interiorTextures(size: 512 | 1024, cc0: { revoque: CanvasImageSource; metal: CanvasImageSource; ladrillo: CanvasImageSource }): Record<Exclude<Mat, 'vidrio' | 'luz'>, THREE.Texture>`.
    - En canvas: porcelanato con juntas, tablas de madera, machimbre, baldosa (roja o terracota según `color`), cerámico y tela.
    - De las CC0: liso (revoque), metal y ladrillo.
  - **Luz.** `bake.ts`: `export function lightAt(i: Interior, p: Vec3, n: Vec3): number`, en [0, 1].
    - Es `ambient` + lámparas (con caída hasta `radius`) + cercanía a un vidrio o una puerta − oclusión de rincón.
    - Va a los colores por vértice de los bloques y al color de cada instancia.
  - **Muebles.** `models.ts`:
    - `export const ITEM_MODELS: Record<ItemModel, () => THREE.BufferGeometry>`: cajas y cilindros con colores por vértice y un solo material;
    - `export const ITEM_GLOW: Partial<Record<ItemModel, true>>`: los que brillan (pantallas, cajeros, baldes de helado). Van con color pleno, sin horneado.
  - **Mallas.** `build.ts`: `export function buildInterior3D(i: Interior, m: Pick<WorldMaterials, InteriorKey>, q: Quality): { group: THREE.Group; box: THREE.Box3 }`.
    - Una malla por Mat usada.
    - Muebles:
      - una `InstancedMesh` (`in_mueble`) por modelo con 4 copias o más;
      - los demás muebles, juntos en una sola malla `in_mueble`;
      - los de `ITEM_GLOW` van igual, con color pleno.
    - Los carteles, en una malla por página de su atlas (`labels:<i>`), hecha con `signTexture`.
    - Nada proyecta ni recibe sombra.
    - En baja no van los ítems con `detail: 2`.
  - **Afuera.** `exterior.ts`: `export function exteriorParts(i: Interior): { geometry: THREE.BufferGeometry; signs: Sign[] }`.
    - Los bloques `out` se dibujan con el material `parapet` (revoque teñido por vértice, con sol) en el chunk de su edificio: sin draw calls nuevos.
    - Los `Label` `out` se vuelven `Sign` para `buildSigns`.
    - Los muebles de afuera se dibujan con el interior (≤ 60 m).
  - **Fachada con huecos.**
    - `extrudeBuilding(bd, openings: readonly Opening[] = [])` y `frontGeometry(bd, fp, edgeOf, openings)` no dibujan nada adentro de una abertura.
    - `extrudeBuilding` devuelve además `tapas: Partial<Record<keyof WorldMaterials, THREE.BufferGeometry>>` (D6).
    - `buildPhotoFacades(map, facades, baseUrl, size, anisotropy, openings: Map<string, Opening[]> = new Map())` devuelve `Promise<{ group: THREE.Group; tapas: Map<string, THREE.Mesh[]> }>`:
      - recorta de la foto las aberturas de su arista;
      - el pedazo recortado es la tapa, con el mismo material (D5);
      - las tapas llegan con las fotos y entran con `views.addTapas`.
    - `export function buildChunks(map: MapData, materials: WorldMaterials, interiors: Interior[] = []): { groups: THREE.Group[]; tapas: Map<string /* placeId */, THREE.Mesh[]> }`:
      - le pasa a cada edificio con interior sus `openings`;
      - suma `exteriorParts(i).geometry` a la malla `parapet` de su chunk;
      - las tapas quedan en el grupo del chunk.
    - `main.ts` le pasa a `buildSigns` también los `signs` de `exteriorParts`.
    - `buildInterior3D` no dibuja los bloques ni los carteles `out`: esos van con el chunk.
  - **Calidad.** `QualityPreset.interiors: { radius: number; max: number; detail: 1 | 2 }`:

    | Calidad | radius | max | detail |
    |---|---|---|---|
    | baja | 60 | 1 | 1 |
    | media | 60 | 2 | 2 |
    | alta | 60 | 3 | 2 |

  - **Escena.** `GameScene.camera: THREE.PerspectiveCamera`, de solo lectura.
  - **Visibilidad.** `view.ts`:

    ```ts
    export interface InteriorViews {
      readonly group: THREE.Group;
      /** Adentro de un interior (la cámara sobre su planta o un patio, por debajo del techo): ese solo. Si no: los que están
       *  a < radius de la cámara (a su caja) y con la caja en el frustum, hasta `max`, los más cercanos (D7). Las tapas
       *  de los que no se dibujan quedan visibles; las de los que se dibujan, no. */
      update(camera: THREE.PerspectiveCamera): void;
      /** Las tapas que llegan después (las de las fotos). */
      addTapas(placeId: string, meshes: THREE.Mesh[]): void;
      setQuality(q: Quality): void;
      drawn(): string[];      // placeIds del último update
      dispose(): void;
    }
    export function createInteriorViews(interiors: Interior[], m: WorldMaterials, q: Quality, tapas: Map<string, THREE.Mesh[]>): InteriorViews
    ```

  - **Debug.** `AdrogueDebug.interiorsDrawn(): string[]`.
  - **`main.ts`:**
    - arma las vistas después de los chunks y suma su grupo con `scene.addStatic(views.group)`: así `setMaterials` lo recorre;
    - en cada cuadro corre `views.update(scene.camera)` entre `scene.update` y `scene.render`;
    - `setQuality` llama a `views.setQuality`.

- [ ] **Step 1: Tests** en `interiors.test.ts`, sobre `testInterior` de la Tarea 4 con 30 sillas y 10 mesas:
  - `interiorTextures(512, cc0)`, con `stubCanvas` e imágenes de prueba:
    - da las 9 texturas, de 512 px de lado y con `RepeatWrapping`;
    - `Math.random` no se llama (espía): las vetas y juntas salen de un PRNG con semilla.
  - `buildInterior3D`:
    - ≤ 20 mallas;
    - las 30 sillas son una sola `InstancedMesh` con `count === 30`;
    - ninguna malla con `castShadow`;
    - cada nombre es una `InteriorKey` o `labels:<i>`.
  - `lightAt`:
    - un punto a 0,5 m de un vidrio da más que el rincón del fondo;
    - con `ambient` 0,05 y sin lámparas, en el fondo da ≤ 0,15.
  - **Vistas:**
    - con la cámara adentro, `drawn()` es `[id]`;
    - (Review Focus 5) con otro interior a 20 m y en pantalla, igual no se dibuja;
    - a 59 m mirándolo se dibuja; a 59 m de espaldas, no; a 61 m, no;
    - con 3 en pantalla a < 60 m y `max` 2, se dibujan los 2 más cercanos;
    - las tapas de uno dibujado están ocultas y las de uno no dibujado, visibles.
  - **Fachada:**
    - con aberturas, ningún triángulo de las paredes cubre el centro de una abertura (rayo contra los triángulos);
    - el área de las tapas es la suma del área de las aberturas (±1e-6).
  - **Calidad** (Review Focus 3): después de cambiar los materiales como lo hace `scene.setMaterials` y liberar los viejos, toda malla del interior usa un material de los nuevos.
  - `dispose()` llama a `dispose` de cada geometría y de cada textura de carteles propia (espías), y no toca los materiales compartidos de `WorldMaterials`.
- [ ] **Step 2: Tests** en `interiors-map.test.ts`: para cada interior del mapa real y cada calidad, `buildInterior3D` da ≤ 20 mallas (draw calls). Imprime los triángulos de cada uno.
- [ ] **Step 3: Correr y ver que fallan.** Después implementar.
- [ ] **Step 4: Verificar.**
  - `npx vitest run && npm run typecheck && npm run build:map`. **Expected:** PASS, con 0 warnings.
  - `npx playwright test`. **Expected:** PASS.
    - Los presupuestos se cumplen en las paradas `estacion`, `esteban-adrogue` y `frente-ea-mitre-pellerano-s`, donde ya se dibujan las cajas de la Tarea 4.
    - Si no entra, se baja `max` o el detalle (D7).
- [ ] **Step 5: Commit** `feat(cliente): interiores con luz propia, vidrio, instancias y tapas de lejos`.

### Task 6: Bancos: Nación, Galicia y BBVA

**Files:**
- Create: `src/shared/interiors/bancos.ts` y `tests/shared/interiors/bancos.test.ts`.
- Modify:
  - `src/shared/interiors/index.ts` (3 entradas) y `types.ts` (`ItemModel`);
  - `src/client/world/interiors/models.ts`.

**Interfaces:**
- Consumes: el `Kit` (Tarea 4), `ITEM_MODELS` (Tarea 5) y `walk.ts`.
- Produces:
  - `export function bancoPlan(marca: 'nacion' | 'galicia' | 'bbva'): InteriorPlan`
  - `INTERIOR_PLANS['banco-nacion' | 'galicia' | 'bbva']`
  - `ItemModel` suma `'cajero' | 'escritorio' | 'turnero' | 'puesto-caja'`. En `MODEL_BOX` van `cajero`, `escritorio` y `puesto-caja`; en `ITEM_GLOW`, `cajero` y `turnero`.
  - `marks`:
    - `vestibulo`;
    - `puerta-salon`, en el hueco de la pared de vidrio;
    - `salon`, en el centro;
    - `cajas`, detrás del mostrador;
    - `tesoro`, a 1 m de la pared del fondo.

**Qué fija el spec (§4.1–4.3):**
- **Planta.** Solo la planta baja es pública: `publicFloors: 1`.
- **Vestíbulo de cajeros** detrás de la vidriera, de ~3,5 m de fondo:
  - Nación y BBVA lo tienen al frente; Galicia, a un costado.
  - Cajeros de pie con la pantalla que brilla: 2 o 3 en el Nación.
  - Paredes blancas y luz blanca fría.
- **Puerta interior.** Una pared de vidrio separa el vestíbulo del salón, con una puerta y la hoja dibujada abierta (D10).
- **Salón:**
  - cajas al fondo: mostrador de 1,1 m (sólido) y mampara de vidrio (clase `glass`) de 1,1 a 2,4 m;
  - Galicia tiene 4 cajas; Nación y BBVA, 3;
  - 2 escritorios con sillas, una fila de ≥ 4 sillas de espera y un turnero con pantalla.
- **Tesoro.** La puerta redonda en la pared del fondo es un cartel en relieve, sin abertura.
- **Materiales.** Porcelanato gris claro y cielorraso blanco con paneles de luz.
- **Cartelería:**
  - Nación: "BANCO NACIÓN", azul y celeste;
  - Galicia: "Galicia", naranja `#e1561f`;
  - BBVA: "BBVA", azul `#1e44a8`.

- [ ] **Step 1: Tests** en `bancos.test.ts`, sobre el mapa real:
  - **Vestíbulo:** en Nación y BBVA queda a 3,5 ± 0,5 m de fondo desde la vidriera; en Galicia, contra una medianera.
  - **Recorrido:** desde la puerta de la calle, `walkTo([vestibulo, puerta-salon, salon])` termina a < 0,5 m de `salon`.
  - **Mampara:**
    - un tiro a 1,6 m desde `salon` a un blanco en `cajas` da `target`;
    - a 0,8 m da `world`, porque el mostrador frena;
    - `walkTo` de `salon` a `cajas` no llega: queda a > 0,4 m.
  - **Cantidades:**
    - `puesto-caja`: 4 en Galicia, 3 en Nación y BBVA;
    - `cajero`: 2 o 3 en Nación, ≥ 2 en los otros;
    - `escritorio`: 2;
    - `turnero`: 1.
  - **Pisos:** `floors` tiene solo el nivel 0.
  - **Carteles:** los textos de cada marca, con sus colores.
  - **Tesoro:** no hay abertura en la pared del fondo, y `walkTo` de `tesoro` 3 m hacia el fondo frena a ≤ 0,4 m de la cara de la pared.
- [ ] **Step 2: Correr y ver que fallan.** Después implementar. Los tests genéricos de `all.test.ts` e `interiors-map.test.ts` ya cubren a los tres.
- [ ] **Step 3: Verificar.**
  - `npx vitest run && npm run typecheck && npm run build:map`. **Expected:** PASS, con 0 warnings.
  - `npx playwright test e2e/perf.spec.ts`. **Expected:** PASS en las paradas `esteban-adrogue` y `frente-ea-mitre-pellerano-s`.
- [ ] **Step 4: Commit** `feat(interiores): Banco Nación, Galicia y BBVA`.

### Task 7: Casa de la Cultura

**Files:**
- Create: `src/shared/interiors/cultura.ts` y `tests/shared/interiors/cultura.test.ts`.
- Modify: `index.ts`, `types.ts` y `models.ts`.

**Interfaces:**
- Produces:
  - `export const culturaPlan: InteriorPlan`
  - `INTERIOR_PLANS['casa-de-la-cultura']`
  - `views` con `'atrio'`: en el hall, a nivel 0, mirando a lo largo del atrio. Es la parada de rendimiento de la Tarea 11.
  - `ItemModel` suma `'plafon' | 'silla-auditorio' | 'panel-muestra'`. En `MODEL_BOX` va `panel-muestra`; el `plafon` no tiene caja.
  - `marks`:
    - `atrio`, en el centro, a nivel 0;
    - `balcon-1`, en el nivel 1, a 1 m de la baranda;
    - `balcon-2-enfrente`, en el nivel 2, del otro lado del atrio;
    - `auditorio`, delante de las sillas;
    - `escenario`, arriba del escenario;
    - `techo-lucernario`, en el techo, a 1 m del lucernario.

**Qué fija el spec (§4.4):**
- **Pisos.** Públicos el 0, el 1 y el 2 (`publicFloors: 3`); el piso 4 está cerrado.
- **Entrada y atrio.** Un hall da al atrio, de ~10 × 20 m, abierto hasta el techo (D13).
- **Lucernario** de vidrio a dos aguas con estructura blanca (D13). Debajo cuelga el plafón de colores: un disco propio, que no copia la obra.
- **Balcones** en los niveles 1 y 2:
  - columnas blancas con capitel (sólidas);
  - baranda de vidrio con pasamanos negro y tramos de reja negra (D4);
  - esquinas curvas, en tramos de ≤ 0,5 m.
- **Escaleras:**
  - una central de 0 a 1, ancha (≥ 3,0 m). Un comentario en el módulo anota que en la realidad baja (§1);
  - otra a un costado, de 1 a 2 (≥ 1,2 m).
- **Planta baja:**
  - porcelanato blanco y crema;
  - salas de exposición alrededor del atrio, con tarimas (≤ 0,45 m: se suben caminando) y paneles;
  - auditorio al fondo, con escenario y filas de sillas (no sólidas).

- [ ] **Step 1: Tests** en `cultura.test.ts`:
  - **Pisos:** `floors` tiene los niveles 0, 1 y 2 y no el 3.
  - **Atrio:**
    - el hueco mide 10 ± 2 × 20 ± 3 m;
    - un `hitscan` hacia arriba desde `atrio`, a 1,6 m, da `null` en 30 m: atraviesa el lucernario (el plafón es un ítem sin caja en `MODEL_BOX`: no frena);
    - `world.raycast` sin `throughGlass` pega a la altura del techo (±0,3).
  - **Sobre el lucernario:** desde `techo-lucernario`, un jugador cruza el lucernario con W 6 s sin bajar nunca de `height − 0,05`.
  - **Escaleras:** la central mide ≥ 3,0 m de ancho y la del costado, ≥ 1,2.
  - **Balcones:**
    - desde `balcon-1`, caminar 4 s hacia el atrio frena en la baranda: sigue a y = 3,2 (±0,05);
    - un tiro de `balcon-1` a un blanco en `balcon-2-enfrente` da `target`.
  - **Auditorio:** `walkTo` de `auditorio` a `escenario` cruza la fila de sillas y termina a la altura del escenario (±0,05).
  - **Vista:** `views` tiene `'atrio'`, adentro de la planta y a nivel 0.
- [ ] **Step 2: Correr y ver que fallan.** Después implementar.
- [ ] **Step 3: Verificar.** `npx vitest run && npm run typecheck && npm run build:map`. **Expected:** PASS, con 0 warnings.
- [ ] **Step 4: Commit** `feat(interiores): Casa de la Cultura con atrio, balcones y lucernario`.

### Task 8: McDonald's y La Veneciana

**Files:**
- Create:
  - `src/shared/interiors/mcdonalds.ts` y `veneciana.ts`;
  - `tests/shared/interiors/mcdonalds.test.ts` y `veneciana.test.ts`.
- Modify: `index.ts`, `types.ts` y `models.ts`.

**Interfaces:**
- Produces:
  - `export const mcdonaldsPlan: InteriorPlan` y `export const venecianaPlan: InteriorPlan`, con sus entradas en `INTERIOR_PLANS`.
  - Vistas para la Tarea 11:
    - McDonald's `'salon'`: adentro, mirando el salón;
    - La Veneciana `'vidrieras'`: en la vereda de Espora, a ~6 m del frente, mirando las vidrieras.
  - `ItemModel` suma `'mesa-redonda' | 'freidora' | 'heladera' | 'pantalla' | 'mesa-picnic' | 'sombrilla' | 'silla-director' | 'metegol' | 'balde-helado'`.
    - En `MODEL_BOX`: `mesa-redonda`, `freidora`, `heladera`, `mesa-picnic` y `metegol`.
    - En `ITEM_GLOW`: `pantalla` y `balde-helado`.
  - `marks`:
    - McDonald's: `salon`, `paso-cocina` (en el paso del mostrador), `cocina` y `patio`;
    - La Veneciana: `salon` y `terraza`.

**McDonald's (§4.5):**
- **Planta.** 1 piso.
- **Salón** detrás del frente vidriado:
  - una zona de tablas de madera clara y otra de porcelanato gris claro;
  - cielorraso de placas oscuras con spots;
  - tabiques de listones (sólidos) y columnas revestidas en madera.
- **Muebles:**
  - mesas redondas blancas con pie negro (sólidas);
  - sillas negras con asiento de madera (no sólidas);
  - sillones en zigzag blanco y negro (sólidos);
  - banquetas y sillas amarillas (no sólidas);
  - lámparas campana blancas.
- **Mostrador** de 1,1 m (sólido), frente negro y mesada blanca:
  - "CAJA KIOSCO" con un "1";
  - pantallas de menú que brillan.
- **Cocina** detrás del mostrador: se entra por un paso de ≥ 1,0 m en una punta. Tiene mesadas, freidoras y heladeras de acero (sólidas).
- **Patio del fondo** (D12): pared de ladrillo, mesas de picnic y sombrillas rojas.
- **Afuera** (bloques y carteles `out`):
  - revestimiento gris oscuro con la franja roja vertical;
  - "McDonald's" en blanco;
  - la "M" amarilla en la torre, como letra.

**La Veneciana (§4.7):**
- **Planta.** 1 piso + terraza (`terrace: true`).
- **Afuera:**
  - edificio blanco con la esquina redonda vidriada;
  - toldos rojos con "La Veneciana";
  - cartel rojo con letra script blanca;
  - en la vereda, sillas director rojas y sombrillas.
- **Salón:**
  - machimbre barnizado con spots y vigas blancas;
  - columnas blancas y cerámico beige;
  - mesas y sillas de madera oscura;
  - metegol (sólido) sobre una alfombra redonda gris;
  - mostrador de madera con la vitrina de helados: baldes de colores que brillan bajo el vidrio.
- **Esquina redonda:** un aro blanco en el cielorraso.
- **Escalera a la terraza:**
  - baranda blanca de caño;
  - baldosa terracota;
  - sombrillas rojas, sillas director rojas y mesas de madera.

- [ ] **Step 1: Tests.**
  - **McDonald's:**
    - desde la puerta, `walkTo([salon, paso-cocina, cocina])` termina a < 0,5 m de `cocina`;
    - un rayo desde el ojo, parado en la puerta, hacia `cocina` pega en un sólido: es escondite;
    - `walkTo` llega a `patio`, y ahí `world.overlaps(x, z, 0.35, 2.0, 50)` da false (cielo abierto);
    - hay carteles con "CAJA KIOSCO" y "1";
    - hay carteles `out` con "McDonald's" y "M";
    - `views` tiene `'salon'`.
  - **La Veneciana:**
    - `climbStair` llega a la terraza, a y = `height` (±0,05);
    - `floors` tiene la terraza;
    - el hueco de la escalera tiene baranda en la terraza;
    - hay ≥ 2 carteles `out` con "La Veneciana";
    - el metegol es sólido;
    - la vista `'vidrieras'` queda afuera de la planta y cumple `isFreeSpot`;
    - desde ahí, un `hitscan` hacia `salon` cruza el vidrio y pega más allá del frente.
- [ ] **Step 2: Correr y ver que fallan.** Después implementar.
- [ ] **Step 3: Verificar.** `npx vitest run && npm run typecheck && npm run build:map`. **Expected:** PASS, con 0 warnings.
- [ ] **Step 4: Commit** `feat(interiores): McDonald's y La Veneciana`.

### Task 9: Cine Pixel y Guernica

**Files:**
- Create:
  - `src/shared/interiors/cine.ts` y `guernica.ts`;
  - `tests/shared/interiors/cine.test.ts` y `guernica.test.ts`.
- Modify:
  - `index.ts`, `types.ts` y `models.ts`;
  - `tests/client/interiors.test.ts` (oscuridad de la sala).

**Interfaces:**
- Produces:
  - `export const cinePlan: InteriorPlan` y `export const guernicaPlan: InteriorPlan`, con sus entradas en `INTERIOR_PLANS`.
  - `ItemModel` suma `'butaca' | 'pochoclera' | 'afiche' | 'botella' | 'canillas' | 'guirnalda' | 'arbol' | 'mesa-alta'`.
    - En `MODEL_BOX`: `butaca`, `pochoclera` y `mesa-alta`. El tronco del `arbol` es un `block` sólido aparte.
    - En `ITEM_GLOW`: `guirnalda` y `botella`, iluminadas desde el estante.
  - `marks`:
    - Cine: `hall`, `sala-grande`, `sala-chica` (delante de cada pantalla) y `ultima-fila` (en el pasillo de la sala grande);
    - Guernica: `planta-alta`, `balcon` y `patio`.

**Cine Pixel (§4.6):**
- **Marquesina** gris carbón (`out`) con "CINES PIXEL" en blanco, la P en magenta, y spots. Debajo, el frente vidriado de piso a techo.
- **Hall:**
  - porcelanato beige con bandas gris oscuro;
  - paredes blancas y una gris oscura;
  - afiches genéricos enmarcados;
  - cielorraso blanco con un cajón de LED azul.
- **Candy bar:** mostrador blanco y negro, pochoclera, pantallas que brillan y heladera.
- **Salas.** Dos, una grande y una chica, en la planta relevada:
  - butacas oscuras en gradas (sólidas), con escalones de pasillo según §2.1;
  - pantalla con marco negro;
  - paredes negras con tiras ámbar y escalones con luz;
  - `ambient` ≤ 0,05.

**Guernica (§4.8):**
- **Planta.** 2 pisos públicos.
- **Patio de adelante** (D12):
  - mesas bajo árboles propios, con el tronco sólido;
  - guirnaldas de lamparitas.
- **Frente:** chapa acanalada (`out`) con "GUERNICA" en letras que brillan y una estrella a cada lado.
- **Planta baja:**
  - barra larga de madera oscura (sólida);
  - estantes iluminados con botellas (las botellas, `detail: 2`);
  - torre de canillas cromada en arco;
  - mesas altas y bajas.
- **Planta alta:** escalera, la parte techada, el balcón al frente con baranda negra (D14), el rincón de escenario y mesas.
- **Estilo industrial:** metal negro, madera y lamparitas a la vista.

- [ ] **Step 1: Tests.**
  - **Cine:**
    - hay 2 salas: dos zonas de butacas y dos pantallas;
    - las butacas son sólidas y van en una `InstancedMesh` con ≥ 40 instancias;
    - `walkTo([sala-grande, ultima-fila])` sube por los escalones del pasillo (≤ 0,2 m cada uno) y termina a la altura de la última grada (±0,05);
    - en `interiors.test.ts`, el promedio de `lightAt` sobre las butacas es ≤ 0,15, y en `hall` da ≥ 0,6;
    - hay un cartel `out` con "CINES" y "PIXEL", con la P en magenta.
  - **Guernica:**
    - `floors` tiene los niveles 0 y 1;
    - `walkTo` de `planta-alta` a `balcon` pasa por la puerta del piso 1 y queda a y = 3,2 (±0,05);
    - un tiro de `balcon` a un blanco en `patio` da `target`;
    - la barra es sólida;
    - las botellas no se dibujan en baja.
- [ ] **Step 2: Correr y ver que fallan.** Después implementar.
- [ ] **Step 3: Verificar.** `npx vitest run && npm run typecheck && npm run build:map`. **Expected:** PASS, con 0 warnings.
- [ ] **Step 4: Commit** `feat(interiores): Cine Pixel y Guernica`.

### Task 10: Estación: boletería, molinetes y alero verde

**Files:**
- Create: `src/shared/interiors/estacion.ts` y `tests/shared/interiors/estacion.test.ts`.
- Modify:
  - `index.ts`, `types.ts` y `models.ts`;
  - `src/client/world/landmarks.ts` (alero, carteles y franja táctil);
  - `src/client/world/signs.ts` (`TYPE_LOOK.station`);
  - `tests/client/landmarks.test.ts`.

**Interfaces:**
- Produces:
  - `export const estacionPlan: InteriorPlan`, con su entrada en `INTERIOR_PLANS`.
  - `ItemModel` suma `'molinete' | 'sube' | 'banco-respaldo' | 'ventanilla'`. En `MODEL_BOX` van `molinete`, `sube` y `banco-respaldo` (0,8 m); en `ITEM_GLOW`, `sube`.
  - `marks`: `hall`, `paso-molinetes` (en el paso abierto) y `anden` (sobre el andén). La escalera de acceso queda entre el paso y `anden`, alineada: así el camino de puntos es recto por tramos.

**Qué fija el spec (§4.9):**
- **Paredes:** blancas o crema, con zócalo celeste de ~1,2 m por afuera y por adentro (afuera, bloques `out`). Ventanas con rejas.
- **Hall:**
  - ventanillas de la boletería, con vidrio y reja, y el cartel "BOLETERÍA";
  - terminal SUBE (sólida);
  - bancos con respaldo de 0,8 m (sólidos);
  - mural de azulejos de patrón propio, en `ceramico` con color por azulejo;
  - la puerta del baño, cerrada: un cartel en relieve.
- **Del lado del andén:**
  - una línea de molinetes sólidos, con un paso abierto de ≥ 1,0 m (D3);
  - la escalera de acceso desde la calle hasta `PLATFORM_H`, con narices amarillas y baldosas rojas (`out`).
- **Alero:**
  - chapa, postes y vigas verdes (G > R y G > B);
  - carteles "Adrogué" azules, con marco azul y letras blancas;
  - franja amarilla táctil en el andén.

- [ ] **Step 1: Tests.**
  - **Al andén:** desde la puerta de la calle, `walkTo([hall, paso-molinetes, anden])` termina sobre el andén, a y = `PLATFORM_H` (±0,05).
  - **Molinetes:** caminar contra uno frena, y un tiro a 0,8 m da `world`.
  - **Carteles:** hay uno con "BOLETERÍA".
  - **Ubicación:** la planta no pisa ningún andén (≤ 1 m²).
  - **Cliente:**
    - en las mallas `canopy` y `steel`, el color tiene G > R y G > B;
    - el marco de los carteles ADROGUÉ es azul.
- [ ] **Step 2: Correr y ver que fallan.** Después implementar.
- [ ] **Step 3: Verificar.**
  - `npx vitest run && npm run typecheck && npm run build:map`. **Expected:** PASS, con 0 warnings.
  - `npx playwright test e2e/perf.spec.ts`. **Expected:** PASS en la parada `estacion`.
- [ ] **Step 4: Commit** `feat(interiores): estación con boletería, molinetes y alero verde`.

### Task 11: Integración: botín adentro, e2e, paradas de rendimiento y README

**Files:**
- Create: `e2e/interiors.spec.ts`.
- Modify:
  - `src/mapgen/loot-spots.ts` y `tests/mapgen/loot-spots.test.ts`;
  - `src/shared/match.ts` y `tests/shared/match.test.ts`;
  - `src/client/ui/hud.ts`, y `src/client/main.ts` para pasarle `world`;
  - `e2e/helpers.ts` y `e2e/perf.spec.ts`;
  - `tools/build-map.ts` y `README.md`.

**Interfaces:**
- Consumes: `buildInteriors`, `publicFloorArea`, `Interior.floors` y `Interior.views` (Tareas 4 a 10) e `isFreeSpot(world, x, z, y)` (Tarea 2).
- Produces:
  - **Botín de nivel `lugar`.** Por interior van `n = clamp(round(publicFloorArea / 40), 4, 12)` puntos (D11):
    - repartidos entre los pisos públicos según su área;
    - cada uno cumple `isFreeSpot(world, x, z, y)`, con el margen `CLEAR` de hoy y a ≥ 1,5 m de los otros;
    - se eligen por punto más lejano, de forma determinista, desde la puerta principal;
    - `pos[1]` es el `y` de su piso;
    - aviso fatal: `<id>: entran k de n puntos de botín adentro`.
  - **Juntar** (D15):
    - `export function nearestDrop(s: MatchState, world: CollisionWorld, opts: { all?: boolean } = {}): MatchDrop | null`;
    - `dropInReach(drops, p, look, take, world)` lo usan `nearestDrop` y `stepMatch`;
    - pide línea de vista: `world.raycast(ojo, hacia d.pos + dropLift, dist)`, sin `throughGlass`, tiene que dar null;
    - el HUD (`hud.ts:304`) recibe `world` para su cartel "E: juntar".
  - **Paradas.** En `e2e/helpers.ts`, `export function interiorView(placeId: string, viewId: string): { pos: Vec3; yaw: number }`. `TOUR` suma estas paradas:
    - `{ id: 'cultura-atrio', ...interiorView('casa-de-la-cultura', 'atrio') }`
    - `{ id: 'mcdonalds-salon', ...interiorView('mcdonalds', 'salon') }`
    - `{ id: 'veneciana-vidrieras', ...interiorView('la-veneciana', 'vidrieras') }`

- [ ] **Step 1: Tests unitarios.**
  - **`loot-spots.test.ts`:**
    - la aserción `4 * 9` se reemplaza: cada lugar tiene exactamente `clamp(round(publicFloorArea / 40), 4, 12)` puntos `lugar`;
    - cada uno queda adentro de la planta (o sobre la terraza) y sobre un `FloorArea` público, con `pos[1]` igual a su `y`;
    - cada uno cumple `isFreeSpot(…, pos[1])`;
    - ninguno queda sobre la vereda;
    - dos corridas dan lo mismo.
  - **`match.test.ts`** (Review Focus 4), con el jugador a 1,2 m de un drop:
    - con un tabique de 0,1 m en el medio, `nearestDrop` da null;
    - con un vidrio, también null;
    - sin nada en el medio, da el drop.
- [ ] **Step 2: e2e** en `e2e/interiors.spec.ts`, con `?debug=1`:
  - **Entrar a cada lugar.** Para cada uno de los 9:
    1. `teleport(id)` y W apretada hasta que `state().pos` quede adentro de la planta (≤ 30 s).
    2. `interiorsDrawn()` incluye al lugar.
    3. `canvasLuma(page).variance > 100`.
    4. Captura en `test-results/interiores/<id>.png`.
  - **Calidad adentro** (Review Focus 3): en la Casa de la Cultura, `setQuality('baja')`, 8 cuadros, `setQuality('media')`; `interiorsDrawn()` sigue incluyéndola.
  - **Sin errores de consola** en todo el recorrido.
- [ ] **Step 3: Correr y ver que fallan.** Después implementar.
  - **README:**
    - una sección "Lugares con interior" que cuenta qué se encuentra en cada uno y que el botín de los lugares está adentro;
    - el formato de `data/plantas.json`, para relevar más lugares.
  - **`build-map.ts`:** imprime `interiores: 9 (bloques=…, ítems=…), botín lugar=…`.
- [ ] **Step 4: Verificación completa.** `npx vitest run && npm run typecheck && npm run build:map && npx playwright test`. **Expected:** todo PASS:
  - 0 warnings y mapa < 3 MB;
  - las 3 paradas nuevas dentro de los presupuestos, sin cambiarlos.
- [ ] **Step 5: Commit** `feat: interiores de los 9 lugares con su botín, e2e y paradas de rendimiento`.

---

## Revisión propia

**Cobertura del spec:**

| Spec | Tarea |
|---|---|
| §1 objetivos: puerta real, reconocible, pelea, presupuestos | 2, 4 a 10, 5 y 11 |
| §2.1 edificios huecos, medidas y pisos cerrados | 4 (D1 y D13) |
| §2.1 determinista en `src/shared` y JSON chico | 2 y 4 |
| §2.2 vidrio | 4, 5, 6 y 7 |
| §2.3 muebles | 4 y cada interior |
| §2.4 materiales, luz, cine oscuro y carteles | 5 y 9 |
| §2.5 botín | 11 |
| §2.5 aparición y menú M | 2 |
| §2.5 punto libre bajo losa | 2 (y D2) |
| §2.6 cuándo se dibuja | 5 (D6 y D7) |
| §2.6 ≤ 20 draw calls e instancias | 5 (test por interior) |
| §2.6 3 paradas | 11 |
| §3 relevamiento: mecanismo y validación | 1 |
| §3 relevamiento: datos | 3 |
| §3 pisos corregidos y estación al costado | 3 (D8) |
| §4.1 a 4.3 bancos | 6 |
| §4.4 Casa de la Cultura | 7 |
| §4.5 McDonald's y §4.7 La Veneciana | 8 |
| §4.6 Cine Pixel y §4.8 Guernica | 9 |
| §4.9 estación | 10 |
| §5 cómo se prueba | 4 (`all.test.ts`), cada interior y 11 |

**Nombres que cruzan tareas:** se revisaron.
- `Frame`, `Opening`, `InteriorInput`, `Door`, `doorsOf`, `LINTEL_MIN` y `isFreeSpot(…, y)` se definen en las Tareas 1 y 2 y se usan igual en la 4, la 5 y la 11.
- `Kit`, `InteriorPlan`, `INTERIOR_PLANS`, `buildInteriors`, `validateInterior`, `publicFloorArea`, `Interior.views`, `Interior.marks` y `walk.ts` se definen en la 4 y se usan en las tareas 6 a 11. Cada tarea de interior fija los nombres de sus `marks` y de sus `ItemModel`.
- `InteriorKey`, `buildInterior3D`, `buildChunks(…, interiors)`, `InteriorViews` (con `addTapas`) e `interiorsDrawn` se definen en la 5 y se usan en la 11.

**Escaneo de pasos:** cada tarea tiene tests con valores, el comando que tiene que fallar, la verificación con su resultado esperado y el commit. No quedan pasos del tipo "si hace falta" ni listas abiertas.
