# Etapa 1: Mapa caminable de Adrogué. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** una página web que permite recorrer en primera persona el centro de Adrogué en 3D, con estilo realista, por la calle y por los techos, con los 38 lugares reconocibles y sin trabas en una notebook común.

**Architecture:** un generador offline (Node 24 + TypeScript) toma los datos crudos ya versionados (OSM, contornos de Microsoft y los 38 lugares) y produce un único `public/map/adrogue.map.json` (`MapData`). El cliente (Vite + three.js) carga ese archivo y arma las mallas por chunks. Un mundo de colisiones 2.5D y el controlador del jugador viven en `src/shared/` como funciones puras sin three.js, para que el servidor de la etapa 3 los reutilice.

**Tech Stack:** Node 24 (TS nativo por type-stripping), TypeScript ≥ 5.8, Vite, three.js, Vitest, Playwright (con el Chrome instalado: `channel: 'chrome'`).

**Spec:** `docs/superpowers/specs/2026-11-03-adrogue-battle-royale-design.md` (secciones 4, 5, 6 y 7.1 para esta etapa).

## Global Constraints

- Área (verbatim): SO `-34.80137, -58.39887`, NE `-34.79351, -58.38246`. Origen local = centro del área `(-34.79744, -58.390665)`.
- Coordenadas del juego en metros: `x` hacia el este, `z` hacia el sur (norte = −z), `y` hacia arriba. `Vec2 = [x, z]`.
- Margen de silueta fuera del área: 150 m. Se ve, pero no tiene colisión.
- El borde del área no se puede cruzar.
- Todo gratis. Solo se usan fuentes CC0, CC BY, CC BY-SA u ODbL. Nada de Google Maps ni Street View como fuente de imágenes.
- Marcas: solo el nombre escrito en el cartel, sin logos.
- Toda la interfaz en español rioplatense.
- Rendimiento: **gana lo fluido**. Hay calidad Baja, Media y Alta. La meta es 60 fps en Media en una notebook de 2020 con gráficos integrados, y nunca menos de 30 en Baja. En este plan se controla con los presupuestos de la Tarea 15.
- Navegadores Chrome, Edge y Firefox de escritorio, con teclado y mouse.
- En tiempo de juego no se consulta ningún servicio externo de mapas. El mapa viene pre-generado.
- TypeScript con `erasableSyntaxOnly`: sin `enum`, sin `namespace` y sin parameter properties. Los imports locales llevan la extensión `.ts`.
- Los commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Todo dato o imagen de terceros se agrega a `data/sources.json`, que alimenta la pantalla de Créditos.

## Review Focus

1. **Aparecer o teletransportarse dentro de geometría.** Teletransportarse a cualquiera de los 38 lugares tiene que dejar al jugador parado en suelo libre. Lo cubren el test de spawns de la Tarea 8 y el e2e de teletransporte de la Tarea 12.
2. **Contornos de Microsoft que pisan calles o se superponen.** Ningún edificio puede tapar una calle. Lo cubren la Tarea 4 y el invariante sobre datos reales de la Tarea 8.
3. **Cambiar de pestaña con teclas apretadas.** Al volver, el jugador no puede seguir caminando solo. Lo cubre el test de `blur` de la Tarea 12.
4. **Frames muy largos (pestaña inactiva o notebook lenta).** El jugador no puede atravesar paredes ni caerse de los techos. Lo cubre el test de `dt` grande de la Tarea 9.
5. **Navegador sin WebGL2 o contexto perdido.** Tiene que aparecer un mensaje claro en español, no una pantalla negra. Lo cubre el e2e de la Tarea 12.

## Datos verificados durante el diseño (para no re-investigar)

- Para descargar OSM, la API `https://api.openstreetmap.org/api/0.6/map.json?bbox=W,S,E,N` funciona (unos 1 MB). Overpass estuvo saturado.
- Edificios de Microsoft Global ML Building Footprints (ODbL), release `2026-02-03`, quadkey `210321300`. URL: `https://minedbuildings.z5.web.core.windows.net/global-buildings/2026-02-03/global-buildings.geojsonl/RegionName=Argentina/quadkey=210321300/part-00102-4feead82-d499-422b-94cb-c036c212127a.c000.csv.gz`. Pesa 168 MB: una línea GeoJSON por edificio, `height` = −1.
  - Dentro del área hay 1233 edificios que coinciden con el satélite.
- En OSM no hay árboles cargados (0 `natural=tree`) ni hay tags `width` en las calles.
- Calles comerciales según los nombres de OSM: `Esteban Adrogué`, `Avenida Espora`, `Bartolomé Mitre`, `Francisco Seguí`, `Diagonal Almirante Brown`, `Samuel Miguel Spiro` (peatonal), `Avenida Amenedo` y `Plaza Esteban Adrogué`.
- Teselas de referencia sin API key: Esri `World_Imagery` y `World_Street_Map`. Solo para inspección humana, no para el juego.

---

### Task 1: Base del proyecto, geo y contrato `MapData`

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `.gitignore`, `index.html` (placeholder), `src/shared/geo.ts`, `src/shared/mapdata.ts`
- Test: `tests/shared/geo.test.ts`

**Interfaces:**
- Produces (`src/shared/geo.ts`):
  - `AREA = { south: -34.80137, west: -58.39887, north: -34.79351, east: -58.38246 }`, `MARGIN_M = 150`, `ORIGIN = { lat: -34.79744, lon: -58.390665 }`
  - `type Vec2 = [number, number]`, `type Vec3 = [number, number, number]`
  - `project(lat: number, lon: number): Vec2`, `unproject(p: Vec2): { lat: number; lon: number }`
  - `areaRect(): { minX: number; maxX: number; minZ: number; maxZ: number }`
  - `signedAreaFromAbove(poly: Vec2[]): number` (> 0 = antihorario visto desde arriba), `ensureCCW(poly: Vec2[]): Vec2[]`, `polygonArea(poly: Vec2[]): number`
  - `pointInPolygon(p: Vec2, poly: Vec2[]): boolean`, `distPointSegment(p: Vec2, a: Vec2, b: Vec2): number`, `hash01(s: string): number` (FNV-1a → [0,1))
- Produces (`src/shared/mapdata.ts`): las interfaces `MapData`, `Building`, `OutskirtBuilding`, `Road`, `RoadKind`, `Park`, `Place`, `PlaceType`, `Sign`, `Prop`, `Tree` y `Bounds`, exactamente así:

```ts
export type RoadKind = 'secondary'|'tertiary'|'residential'|'living_street'|'service'|'pedestrian'|'footway';
export type PlaceType = 'bank'|'bar'|'restaurant'|'fastfood'|'icecream'|'cinema'|'club'|'clinic'|'school'|'culture'|'station'|'monument'|'plaza';
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Building { id: string; footprint: Vec2[]; height: number; floors: number;
  kind: 'house'|'shop'|'apartments'|'station'; wall: 'plaster'|'brick'; tint: string; landmarkId?: string }
export interface OutskirtBuilding { footprint: Vec2[]; height: number }
export interface Road { id: string; kind: RoadKind; name?: string; width: number; sidewalk: number; points: Vec2[] }
export interface Park { id: string; name?: string; polygon: Vec2[] }
export interface Sign { text: string; anchor: Vec2; normal: Vec2; width: number; bottomY: number }
export interface Place { id: string; name: string; type: PlaceType; position: Vec2; enterable: boolean;
  buildingId?: string; parkId?: string; sign?: Sign; spawn: Vec3 }
export type Prop =
  | { kind: 'ladder'; base: Vec2; normal: Vec2; topY: number; buildingId: string }
  | { kind: 'dumpster'; position: Vec2; rotation: number }
  | { kind: 'bench'; position: Vec2; rotation: number }
  | { kind: 'fountain'; position: Vec2; radius: number }
  | { kind: 'monument'; placeId: string; position: Vec2; style: 'equestrian'|'statue'|'column' };
export interface Tree { position: Vec2; variant: 0|1|2; scale: number }
export interface MapData { version: 1; origin: { lat: number; lon: number }; bounds: Bounds;
  buildings: Building[]; outskirts: OutskirtBuilding[]; roads: Road[]; railways: Vec2[][];
  platforms: Vec2[][]; parks: Park[]; places: Place[]; props: Prop[]; trees: Tree[]; randomSpawns: Vec3[] }
```

- [ ] **Step 1: Inicializar el repo y el proyecto**
  - `git init`. El `.gitignore` incluye `node_modules/`, `dist/`, `test-results/`, `playwright-report/` y `.superpowers/`.
  - Dependencias: `three`. Dependencias de desarrollo: `typescript@^5.8`, `@types/three`, `vite`, `vitest`, `@playwright/test`.
  - Scripts: `dev`, `build`, `test` (`vitest run`), `e2e` (`playwright test`), `typecheck` (`tsc --noEmit`), `fetch:osm`, `fetch:buildings`, `fetch:textures`, `fetch:photos` (cada uno `node tools/<x>.ts`) y `build:map` (`node tools/build-map.ts`).
  - `tsconfig`: `strict`, `module: ESNext`, `moduleResolution: bundler`, `allowImportingTsExtensions`, `noEmit`, `erasableSyntaxOnly`.
  - `playwright.config.ts`: `use.channel = 'chrome'`, `webServer` corriendo `npm run dev` en el puerto 5173.
  - `tests/setup.ts` (registrado en `vite.config.ts` → `test.setupFiles`): el matcher `toBeCloseTo2D(expected: Vec2, digits = 2)`, que usan las Tareas 13 y 14.

- [ ] **Step 2: Escribir los tests de geo, que tienen que fallar**

```ts
test('el área mide ~1502 m × ~872 m', () => {
  const r = areaRect();
  expect(Math.abs(r.maxX - r.minX - 1502)).toBeLessThan(4);
  expect(Math.abs(r.maxZ - r.minZ - 872)).toBeLessThan(4);
});
test('origen en 0,0 y norte es −z', () => {
  expect(project(ORIGIN.lat, ORIGIN.lon)).toEqual([0, 0]);
  expect(project(AREA.north, ORIGIN.lon)[1]).toBeLessThan(0);
});
test('la estación queda en ≈(−327, 41)', () => {
  const [x, z] = project(-34.797811, -58.394237);
  expect(Math.abs(x + 327)).toBeLessThan(3); expect(Math.abs(z - 41)).toBeLessThan(3);
});
test('ida y vuelta', () => { const p = unproject(project(-34.8, -58.39)); expect(p.lat).toBeCloseTo(-34.8, 9); expect(p.lon).toBeCloseTo(-58.39, 9); });
test('orientación vista desde arriba', () => {
  const sq: Vec2[] = [[0,0],[10,0],[10,-10],[0,-10]]; // E y luego N: antihorario visto desde arriba
  expect(signedAreaFromAbove(sq)).toBeCloseTo(100);
  expect(signedAreaFromAbove(ensureCCW([...sq].reverse()))).toBeGreaterThan(0);
});
test('hash01 es determinista y está en [0,1)', () => { expect(hash01('b0001')).toBe(hash01('b0001')); expect(hash01('x')).toBeLessThan(1); });
```

- [ ] **Step 3:** `npx vitest run tests/shared/geo.test.ts`. Resultado esperado: FAIL (módulo inexistente).
- [ ] **Step 4: Implementar `geo.ts`.**
  - Proyección equirectangular local con metros por grado calculados en `ORIGIN.lat`:
    - `mLat = 111132.92 − 559.82·cos2φ + 1.175·cos4φ`
    - `mLon = 111412.84·cosφ − 93.5·cos3φ + 0.118·cos5φ`
  - `z = −(lat − lat0)·mLat`.
  - `mapdata.ts` tal como está arriba.
- [ ] **Step 5:** `npx vitest run && npx tsc --noEmit`. Resultado esperado: PASS.
- [ ] **Step 6:** Commit: `chore: base del proyecto, geo y contrato MapData`.

---

### Task 2: Datos crudos versionados y los 38 lugares

**Files:**
- Create: `tools/fetch-osm.ts`, `tools/fetch-buildings.ts`, `data/raw/osm.json`, `data/raw/ms-buildings.geojson`, `data/places.json`, `data/sources.json`, `src/mapgen/places-input.ts`
- Test: `tests/mapgen/places-input.test.ts`

**Interfaces:**
- Consumes: `AREA`, `MARGIN_M`, `project` (Task 1).
- Produces: `interface PlaceInput { id: string; name: string; type: PlaceType; lat: number; lon: number; enterable: boolean; signText?: string; floors?: number; tint?: string; wall?: 'plaster'|'brick' }`. `floors`, `tint` y `wall` son opcionales: sirven para corregir la fachada de un lugar sin tocar código., `loadPlaces(path?: string): PlaceInput[]` (valida y lanza `Error` en español si algo no cumple), `ENTERABLE_IDS: readonly string[]`.
- Produces: `data/raw/osm.json` (respuesta cruda de la API OSM) y `data/raw/ms-buildings.geojson` (FeatureCollection de los edificios cuyo centroide cae en el área ampliada por `MARGIN_M`).

- [ ] **Step 1: Escribir los tests, que tienen que fallar**

```ts
const places = loadPlaces();
test('son 38 lugares con id único', () => { expect(places).toHaveLength(38); expect(new Set(places.map(p => p.id)).size).toBe(38); });
test('todos dentro del área', () => places.forEach(p => {
  expect(p.lat).toBeGreaterThanOrEqual(AREA.south); expect(p.lat).toBeLessThanOrEqual(AREA.north);
  expect(p.lon).toBeGreaterThanOrEqual(AREA.west); expect(p.lon).toBeLessThanOrEqual(AREA.east); }));
test('exactamente los 9 enterables del spec', () => {
  expect(places.filter(p => p.enterable).map(p => p.id).sort()).toEqual([...ENTERABLE_IDS].sort());
  expect(ENTERABLE_IDS).toEqual(['banco-nacion','galicia','bbva','mcdonalds','cine-pixel','la-veneciana','guernica-bar','casa-de-la-cultura','estacion-adrogue']);
});
test('cartel obligatorio salvo plaza/monumento', () => places.filter(p => !['plaza','monument'].includes(p.type))
  .forEach(p => expect(p.signText?.trim().length).toBeGreaterThan(0)));
test('loadPlaces rechaza un lugar fuera del área', () => { expect(() => loadPlaces('tests/fixtures/places-bad.json')).toThrow(/fuera del área/); });
```

- [ ] **Step 2:** `npx vitest run tests/mapgen/places-input.test.ts`. Resultado esperado: FAIL.
- [ ] **Step 3: Escribir `data/places.json`** con las 38 filas del Apéndice A del spec, copiando nombre, lat y lon tal cual.
  - **id:** el nombre en slug, sin acentos y en minúsculas. Hay cuatro casos fijos:
    - fila 3 → `banco-nacion`
    - fila 4 → `banco-nacion-2`
    - fila 13 → `casa-de-la-cultura`
    - fila 22 → `estacion-adrogue`
  - **type:** según la columna Tipo. Banco→`bank`, Bar→`bar`, Centro cultural→`culture`, Cine→`cinema`, Club y Cancha→`club`, Clínica→`clinic`, Comida rápida→`fastfood`, Escuela→`school`, Estación→`station`, Heladería→`icecream`, Monumento→`monument`, Plaza→`plaza`, Restaurante→`restaurant`.
  - **signText:** el nombre en mayúsculas sin el detalle entre paréntesis, por ejemplo `BANCO NACIÓN`. En la estación va `ADROGUÉ`.
  - Crear también la fixture `tests/fixtures/places-bad.json`.
- [ ] **Step 4: Implementar `loadPlaces`** con las mismas validaciones que los tests. Correr los tests. Resultado esperado: PASS.
- [ ] **Step 5: Implementar y correr los dos scripts de descarga.**
  - `fetch-osm.ts`: `fetch` a la API OSM con el bbox ampliado `MARGIN_M` y el header `User-Agent: adrogue-cs/0.1`.
  - `fetch-buildings.ts`: descarga la URL de Microsoft fijada arriba, la lee en streaming con `zlib.createGunzip` + `readline` y filtra por centroide dentro del área ampliada.
  - `npm run fetch:osm && npm run fetch:buildings`
  - Resultado esperado: `osm.json` con más de 200 ways `highway`. El GeoJSON tiene más de 1200 features con centroide dentro del área estricta y más de 1200 en el anillo de margen.
- [ ] **Step 6: Escribir `data/sources.json`** con las entradas OSM (ODbL, "© colaboradores de OpenStreetMap") y Microsoft Building Footprints (ODbL). Cada entrada es `{ id, title, author, license, url }`.
- [ ] **Step 7:** Commit (incluye `data/raw/*`): `feat(datos): datos crudos de OSM/Microsoft y los 38 lugares`.

---

### Task 3: Parseo de OSM (calles, vías, andenes y plazas)

**Files:**
- Create: `src/mapgen/osm.ts`, `tests/fixtures/osm-mini.json`
- Test: `tests/mapgen/osm.test.ts`

**Interfaces:**
- Consumes: `project`, `ensureCCW`, `Road`, `Park`, `Vec2`.
- Produces: `parseOsm(raw: unknown): { roads: Road[]; railways: Vec2[][]; platforms: Vec2[][]; parks: Park[]; fountains: Vec2[] }`, `ROAD_SPECS: Record<RoadKind, { width: number; sidewalk: number }>`.

Valores de `ROAD_SPECS` (decisión de este plan):

| kind | width | sidewalk |
|---|---|---|
| `secondary` | 12 | 3 |
| `tertiary` | 10 | 3 |
| `residential` | 8 | 3 |
| `living_street` | 6 | 2 |
| `service` | 4 | 0 |
| `pedestrian` | 6 | 0 |
| `footway` | 2.5 | 0 |

- Se ignoran `steps`, `path` y `platform`. Los highways `primary` se tratan como `secondary`.
- Andenes (`railway=platform`): si el way es cerrado se usa como polígono. Si es una línea, se ensancha 2 m a cada lado.
- Plazas: `leisure=park`, ways cerrados.
- Fuentes: nodos `amenity=fountain`.

- [ ] **Step 1: Escribir los tests (fallan)** contra `osm-mini.json`, una fixture armada a mano con 1 `secondary` llamada "Avenida Espora", 1 `footway`, 1 `steps`, una plaza cerrada "Plaza Almirante Brown" con el anillo en sentido horario, 1 `rail`, 1 `platform` como línea y 1 fuente.

```ts
const f = parseOsm(mini);
test('calles con ancho y vereda por tipo', () => {
  const espora = f.roads.find(r => r.name === 'Avenida Espora')!;
  expect([espora.width, espora.sidewalk]).toEqual([12, 3]);
  expect(f.roads.some(r => r.kind === 'footway')).toBe(true);
  expect(f.roads).toHaveLength(2); // steps ignorado
});
test('plaza en CCW sin vértice de cierre duplicado', () => {
  const p = f.parks[0]; expect(p.name).toBe('Plaza Almirante Brown');
  expect(signedAreaFromAbove(p.polygon)).toBeGreaterThan(0);
  expect(p.polygon[0]).not.toEqual(p.polygon.at(-1));
});
test('andén lineal ensanchado a polígono de 4 m', () => expect(polygonArea(f.platforms[0])).toBeCloseTo(lengthOfMiniPlatform * 4, 0));
test('vías y fuentes', () => { expect(f.railways).toHaveLength(1); expect(f.fountains).toHaveLength(1); });
```

- [ ] **Step 2:** correr y verificar que falla. **Step 3:** implementar. **Step 4:** `npx vitest run tests/mapgen/osm.test.ts`. Resultado esperado: PASS.
- [ ] **Step 5:** Commit: `feat(mapgen): parseo de calles, vías, andenes y plazas de OSM`.

---

### Task 4: Edificios (limpieza, clasificación y alturas)

**Files:**
- Create: `src/mapgen/buildings.ts`, `tests/fixtures/buildings-mini.geojson`
- Test: `tests/mapgen/buildings.test.ts`

**Interfaces:**
- Consumes: `Road`, `project`, `ensureCCW`, `polygonArea`, `hash01`, `areaRect`.
- Produces: `buildBuildings(fc: GeoJSONFeatureCollection, roads: Road[]): { buildings: Building[]; outskirts: OutskirtBuilding[] }`, `COMMERCIAL_STREETS: readonly string[]` (los 8 nombres de la sección "Datos verificados"), `FLOOR_H = 3.2`, `PARAPET = 0.6`, `heightFor(floors: number): number` (= `floors·3.2 + 0.6`).

Reglas, en este orden:
1. Proyectar a metros, aplicar `ensureCCW` y simplificar con Douglas-Peucker a 0,3 m.
2. Descartar edificios con área menor a 12 m².
3. Descartar un footprint si contiene algún punto de la línea central de una calle que no sea `footway` o `pedestrian`, muestreando cada 2 m.
4. Si dos footprints se superponen en más del 50 % del área del más chico, descartar el más chico. El solapamiento se aproxima muestreando una grilla de 1 m.
5. Lo que tiene centroide fuera del área estricta va a `outskirts`, con altura `heightFor(1 o 2)` según el hash, y no se procesa más.
6. Asignar ids `b0001…` ordenando por `round(centroide z)` y después por `x`.
7. Clasificar. Es "corredor" si el centroide está a 25 m o menos de la línea central de alguna `COMMERCIAL_STREETS`.
   - Corredor con área ≥ 400 m² → `apartments`, de 4 a 8 pisos.
   - Corredor con área menor → `shop`, con 1 piso (50 %), 2 (30 %) o 3 (20 %).
   - Fuera del corredor → `house`, con 1 piso (65 %) o 2 (35 %).
   - Los porcentajes se resuelven con `hash01(id)`.
8. `wall`: `brick` si `hash01(id + 'w') < 0.18`, si no `plaster`. `tint`: uno de 8 tonos de revoque claro de una paleta fija en el archivo, elegido por hash.

- [ ] **Step 1: Escribir los tests (fallan)** sobre la fixture: un cuadrado de 8 m², uno atravesado por una `residential`, dos superpuestos al 80 %, uno grande y uno chico junto a "Esteban Adrogué", uno lejos de todo y uno fuera del área.

```ts
const { buildings, outskirts } = buildBuildings(fc, roads);
test('descarta chicos, sobre calles y superpuestos', () => expect(buildings.map(b => b.id)).toEqual(['b0001','b0002','b0003','b0004']));
test('fuera del área va a outskirts', () => expect(outskirts).toHaveLength(1));
test('clasificación por corredor', () => {
  expect(byFixtureName('grande-esteban').kind).toBe('apartments');
  expect(byFixtureName('chico-esteban').kind).toBe('shop');
  expect(byFixtureName('lejos').kind).toBe('house');
});
test('altura = pisos·3,2 + 0,6 y CCW', () => buildings.forEach(b => {
  expect(b.height).toBeCloseTo(heightFor(b.floors)); expect(signedAreaFromAbove(b.footprint)).toBeGreaterThan(0); }));
test('determinista', () => expect(buildBuildings(fc, roads)).toEqual(buildBuildings(fc, roads)));
```

- [ ] **Step 2–4:** verificar que falla, implementar y verificar que pasa (`npx vitest run tests/mapgen/buildings.test.ts`).
- [ ] **Step 5:** Commit: `feat(mapgen): limpieza, clasificación y alturas de edificios`.

---

### Task 5: Ubicar los 38 lugares y sus carteles

**Files:**
- Create: `src/mapgen/places.ts`
- Test: `tests/mapgen/places.test.ts`

**Interfaces:**
- Consumes: `PlaceInput`, `Building`, `Park`, `Road`.
- Produces: `matchPlaces(input: PlaceInput[], buildings: Building[], parks: Park[], roads: Road[]): { places: Omit<Place,'spawn'>[]; buildings: Building[]; warnings: string[] }`, `normalizeName(s: string): string` (sin acentos, en minúsculas y sin espacios repetidos).

Reglas:
- **Tipos con edificio** (todos salvo `plaza` y `monument`):
  - Se usa el footprint que contiene el punto. Si no hay ninguno, el más cercano a 15 m o menos. Si tampoco hay, se emite un warning y el lugar queda sin `buildingId`.
  - El edificio elegido recibe `landmarkId = place.id`.
  - Si el lugar trae `floors`, pisa los pisos y la altura del edificio (`heightFor`). Si trae `tint` o `wall`, pisa esos valores del edificio.
  - En `station` se usa radio 30 m y el edificio pasa a `kind = 'station'`.
- **Cartel:**
  - Se coloca en la arista del footprint cuya normal exterior apunta a una calle no `footway` a 15 m o menos, medidos desde el punto medio de la arista sobre la normal. Entre las candidatas se elige la más cercana al punto del lugar.
  - `anchor` = punto medio de la arista + 0,08 m hacia afuera. `width = min(0,8 × largo de la arista, 6)`. `bottomY = 3.0`.
  - Si dos lugares comparten edificio, sus carteles van en la misma arista uno al lado del otro y no se superponen. Si no entran, el segundo va en la siguiente arista candidata.
- **Plaza:** el parque cuyo `normalizeName` coincide. Si no hay coincidencia, el parque que contiene el punto.
- **Monumento:** solo la posición. El prop se crea en la Tarea 6.

- [ ] **Step 1: Escribir los tests (fallan)** con una fixture en memoria de 2 edificios contiguos frente a una calle, 1 parque "Plazoleta Las Delicias" y lugares de prueba.

```ts
test('punto dentro → ese edificio y queda marcado', () => { expect(r.places[0].buildingId).toBe('b0001'); expect(bld('b0001').landmarkId).toBe('lugar-a'); });
test('punto a 10 m → el más cercano; a 40 m → warning', () => { expect(r.places[1].buildingId).toBe('b0002'); expect(r.warnings).toHaveLength(1); });
test('plaza por nombre sin acentos ni mayúsculas', () => expect(r.places.find(p => p.type==='plaza')!.parkId).toBe(parkId('Plazoleta Las Delicias')));
test('el cartel mira a la calle', () => { const s = r.places[0].sign!; expect(dot(s.normal, towardRoad)).toBeGreaterThan(0.9); expect(s.bottomY).toBe(3.0); });
test('dos lugares en un edificio → carteles sin solaparse', () => expect(spansOverlap(signA, signB)).toBe(false));
```

- [ ] **Step 2–4:** verificar que falla, implementar y verificar que pasa.
- [ ] **Step 5:** Commit: `feat(mapgen): ubicación de los 38 lugares y carteles`.

---

### Task 6: Accesos a techos, árboles y props

**Files:**
- Create: `src/mapgen/climb.ts`, `src/mapgen/trees.ts`, `src/mapgen/props.ts`
- Test: `tests/mapgen/climb.test.ts`, `tests/mapgen/trees.test.ts`, `tests/mapgen/props.test.ts`

**Interfaces:**
- Consumes: `Building`, `Road`, `Park`, `Place`, `Bounds`, `PLAYER.mantleReach` (= 2.4, Task 9; repetir la constante como `MANTLE_REACH = 2.4` en `climb.ts` y exportarla).
- Produces:
  - `roofClusters(buildings: Building[]): string[][]`. Une dos edificios si sus footprints están a 1,0 m o menos y `|Δh| ≤ 2.4`.
  - `placeClimbAids(buildings: Building[], roads: Road[]): Prop[]`.
  - `placeTrees(roads: Road[], buildings: Building[], parks: Park[], bounds: Bounds): Tree[]`.
  - `placeProps(parks: Park[], fountains: Vec2[], places: Omit<Place,'spawn'>[]): Prop[]`.

Reglas:
- **Accesos a techos.** Cada cluster necesita al menos 1 acceso, más 1 por cada 1500 m² de techo del cluster.
  - El acceso va en una "arista a calle" del edificio más bajo del cluster. Es arista a calle si mide 3 m o más y si un rayo desde su punto medio hacia afuera no toca otro edificio en 5 m.
  - Si la altura de ese edificio es ≤ 3.8 + 0.05, se pone un `dumpster` de 1,8 × 1,1 × 1,4 m pegado a 0,2 m de la pared. Si es más alto, una `ladder` con `topY = altura`.
- **Árboles.**
  - En veredas: en cada calle con `sidewalk > 0`, a cada lado, a `width/2 + sidewalk·0,7` del eje, cada 9 m ± 2 m. El jitter se calcula por hash de `roadId + índice`.
  - Se saltean los que quedan a menos de 8 m de un extremo de calle o de un nodo compartido (esquina), a 1,5 m o menos de un footprint, o fuera de `bounds`.
  - En plazas: muestreo de Poisson-disc con distancia mínima de 7 m.
  - `variant` y `scale` (0,85 a 1,2) salen del hash.
- **Props.**
  - Bancos en plazas: 1 cada 400 m², ubicados a 1,5 m de un sendero `footway` interno cuando existe.
  - Fuentes: las de OSM.
  - Monumentos: uno por cada lugar `monument`. `style`:
    - `escultura-general-san-martin` → `statue`
    - `monumento-a-san-martin` → `equestrian`
    - `monumento-al-almirante-guillermo-brown` → `column`
    - `monumento-a-esteban-adrogue` → `statue`

- [ ] **Step 1: Escribir los tests (fallan)**

```ts
test('cluster de 1 piso → contenedor; de 2 pisos → escalera', () => {
  expect(aidsFor(oneStory)).toEqual([expect.objectContaining({ kind: 'dumpster' })]);
  expect(aidsFor(twoStory)[0]).toMatchObject({ kind: 'ladder', topY: heightFor(2) });
});
test('edificios pegados con Δh ≤ 2,4 forman un cluster', () => expect(roofClusters([h1, h2adj])).toHaveLength(1));
test('Δh 3,2 → clusters separados, ambos con acceso', () => { expect(roofClusters([h1, h3adj])).toHaveLength(2); expect(placeClimbAids([h1,h3adj], roads)).toHaveLength(2); });
test('árboles: ninguno dentro de edificios ni a menos de 8 m de una esquina', () => trees.forEach(t => {
  expect(minDistToFootprints(t.position)).toBeGreaterThan(1.5); expect(minDistToCorners(t.position)).toBeGreaterThanOrEqual(8); }));
test('árboles en plaza con distancia mínima 7 m', () => expect(minPairwise(parkTrees)).toBeGreaterThanOrEqual(7));
test('4 monumentos con su estilo', () => expect(monuments.map(m => m.style).sort()).toEqual(['column','equestrian','statue','statue']));
```

(Que todo cluster del mapa real tenga acceso se prueba sobre los datos reales en la Tarea 8.)

- [ ] **Step 2–4:** verificar que falla, implementar y verificar que pasa.
- [ ] **Step 5:** Commit: `feat(mapgen): accesos a techos, árboles y props`.

---

### Task 7: Mundo de colisiones 2.5D (compartido)

**Files:**
- Create: `src/shared/collision.ts`
- Test: `tests/shared/collision.test.ts`

**Interfaces:**
- Consumes: `MapData`, `Vec2`, `Vec3`, `pointInPolygon`, `distPointSegment`.
- Produces:

```ts
export interface Prism { polygon: Vec2[]; minY: number; maxY: number; tag?: string }
export interface LadderVolume { base: Vec2; normal: Vec2; topY: number }   // ancho 0,8 m, profundidad 0,6 m frente a la pared
export interface RayHit { dist: number; point: Vec3; normal: Vec3; tag?: string }
export class CollisionWorld {
  constructor(prisms: Prism[], ladders: LadderVolume[], bounds: Bounds, cellSize?: number /* 16 */);
  overlaps(x: number, z: number, r: number, minY: number, maxY: number): boolean;
  supportHeight(x: number, z: number, r: number, maxY: number): number;          // techo más alto ≤ maxY bajo el círculo; 0 = suelo
  pushOut(x: number, z: number, r: number, minY: number, maxY: number): Vec2;    // posición corregida fuera de paredes
  ladderAt(x: number, z: number, r: number, y: number): LadderVolume | null;
  raycast(origin: Vec3, dir: Vec3, maxDist: number): RayHit | null;
  readonly bounds: Bounds;
}
export function buildCollisionWorld(map: MapData): CollisionWorld;
```

`buildCollisionWorld` convierte cada elemento del mapa en un prisma con estas medidas:

| Elemento | Prisma |
|---|---|
| Edificios | `[0, height]` |
| Andenes | `[0, 1.0]` |
| Contenedores | caja de 1,8 × 1,1 m con `[0, 1.4]` |
| Troncos | octógono de r = 0,3 con `[0, 3]` |
| Bancos | caja de 1,8 × 0,6 m con `[0, 0.5]` |
| Monumentos | pedestal de 3 × 3 m con `[0, 2.5]` (`equestrian` y `statue`) o de 2 × 2 m con `[0, 6]` (`column`) |
| Fuentes | octógono de r = radio con `[0, 0.6]` |

Las escaleras de mano se convierten en `LadderVolume`. `outskirts` no genera prismas.

- [ ] **Step 1: Escribir los tests (fallan)** con un mundo chico: cuadrado de 10 × 10 m y h = 3,8, un polígono en L cóncavo con h = 7, una escalera en la cara sur del de 7 m y bounds de ±50.

```ts
test('overlaps adentro del edificio pero no arriba del techo', () => { expect(w.overlaps(5,-5,0.35,0,1.8)).toBe(true); expect(w.overlaps(5,-5,0.35,3.9,5.7)).toBe(false); });
test('supportHeight respeta maxY', () => { expect(w.supportHeight(5,-5,0.35,4.0)).toBeCloseTo(3.8); expect(w.supportHeight(5,-5,0.35,3.0)).toBe(0); });
test('pushOut deja el círculo a ≥ r de la pared', () => { const [x] = w.pushOut(0.2, -5, 0.35, 0, 1.8); expect(x).toBeLessThanOrEqual(-0.35 + 1e-6); });
test('pushOut en la esquina interior de la L', () => expect(w.overlaps(...w.pushOut(...insideInnerCorner), 0.35, 0, 1.8)).toBe(false));
test('raycast contra la pared y contra el techo desde arriba', () => {
  expect(w.raycast([-10,1,-5],[1,0,0],100)!.dist).toBeCloseTo(10);
  expect(w.raycast([5,20,-5],[0,-1,0],100)!.point[1]).toBeCloseTo(3.8);
  expect(w.raycast([-10,5,-5],[1,0,0],100)).toBeNull(); });
test('ladderAt frente a la escalera y no lejos de ella', () => { expect(w.ladderAt(...frontOfLadder, 0.35, 1)).not.toBeNull(); expect(w.ladderAt(...farFromLadder, 0.35, 1)).toBeNull(); });
test('2000 prismas y 10 000 consultas en < 200 ms', () => { /* grilla espacial */ });
```

- [ ] **Step 2–4:** verificar que falla, implementar con grilla espacial de `cellSize` m y verificar que pasa.
- [ ] **Step 5:** Commit: `feat(shared): mundo de colisiones 2.5D con grilla espacial`.

---

### Task 8: `build-map` (armar el `MapData` y validarlo sobre datos reales)

**Files:**
- Create: `tools/build-map.ts`, `src/mapgen/assemble.ts`, `src/mapgen/spawns.ts`, `public/map/adrogue.map.json` (generado y versionado)
- Test: `tests/mapgen/assemble.test.ts`

**Interfaces:**
- Consumes: todo lo de las Tareas 2–7.
- Produces:
  - `assembleMap(raw: { osm: unknown; buildings: GeoJSONFeatureCollection; places: PlaceInput[] }): { map: MapData; warnings: string[] }`.
  - `findFreeSpot(world: CollisionWorld, near: Vec2, maxRadius = 12): Vec3 | null`. Busca en espiral, cada 0,5 m, un punto con `!overlaps(x,z,0.35,0.05,1.8)`, `supportHeight = 0` y dentro de los bounds menos 1 m.
  - `place.spawn`:
    - Si el lugar tiene cartel, el punto libre más cercano a `anchor + normal·3`.
    - Si es plaza, el más cercano al centroide del parque.
    - Si es monumento, el más cercano a `posición + [0, 4]`.
  - `randomSpawns`: 64 puntos libres distribuidos con hash.
- `build-map.ts` escribe `public/map/adrogue.map.json` con coordenadas redondeadas a 2 decimales e imprime los warnings y un resumen.

- [ ] **Step 1: Escribir los tests sobre los datos reales de `data/` (fallan)**

```ts
const { map, warnings } = assembleMap(loadRaw());
const world = buildCollisionWorld(map);
test('cantidades razonables', () => {
  expect(map.buildings.length).toBeGreaterThan(1000); expect(map.buildings.length).toBeLessThan(1300);
  expect(map.places).toHaveLength(38); expect(map.parks.length).toBeGreaterThanOrEqual(12);
  expect(map.trees.length).toBeGreaterThan(1000);
});
test('todo lugar no-plaza/no-monumento tiene edificio y cartel', () => map.places.filter(p => !['plaza','monument'].includes(p.type))
  .forEach(p => { expect(p.buildingId, p.id).toBeDefined(); expect(p.sign, p.id).toBeDefined(); }));
test('todos los spawns libres y dentro del área', () => [...map.places.map(p => p.spawn), ...map.randomSpawns].forEach(s => {
  expect(world.overlaps(s[0], s[2], 0.35, s[1] + 0.05, s[1] + 1.8)).toBe(false);
  expect(s[0]).toBeGreaterThan(map.bounds.minX); expect(s[0]).toBeLessThan(map.bounds.maxX); }));
test('ninguna calle vehicular pasa por adentro de un edificio', () => /* muestreo cada 2 m */ expect(roadPointsInsideBuildings(map)).toEqual([]));
test('todo cluster de techos tiene acceso', () => roofClusters(map.buildings).forEach(c => expect(hasAccess(c, map.props), c[0]).toBe(true)));
test('Estación y Plaza Brown presentes', () => { expect(map.buildings.some(b => b.kind === 'station')).toBe(true);
  expect(map.places.find(p => p.id === 'plaza-almirante-brown')!.parkId).toBeDefined(); });
```

- [ ] **Step 2:** `npx vitest run tests/mapgen/assemble.test.ts`. Resultado esperado: FAIL.
- [ ] **Step 3: Implementar `assemble.ts`, `spawns.ts` y `tools/build-map.ts`.**
  - Si algún lugar queda con warning, corregirlo en `data/places.json` y no en el código. Por ejemplo, ajustar `lat`/`lon` mirando las teselas Esri.
  - Cada corrección se anota en el mensaje del commit.
- [ ] **Step 4:** `npx vitest run && npm run build:map`. Resultado esperado: PASS. El resumen impreso muestra 0 warnings y el JSON pesa menos de 3 MB.
- [ ] **Step 5:** Commit: `feat(mapgen): build-map genera adrogue.map.json validado`.

---

### Task 9: Controlador del jugador (puro, compartido)

**Files:**
- Create: `src/shared/player.ts`
- Test: `tests/shared/player.test.ts`

**Interfaces:**
- Consumes: `CollisionWorld`.
- Produces:

```ts
export const PLAYER = { radius: 0.35, height: 1.8, crouchHeight: 1.2, eye: 1.65, crouchEye: 1.05, runSpeed: 6.0, crouchSpeed: 2.5,
  airControl: 0.3, gravity: 20, jumpVelocity: 7.07, stepUp: 0.45, mantleReach: 2.4, mantleTime: 0.45, ladderSpeed: 3.0, maxDt: 0.1, subStep: 1/120 } as const;
export interface PlayerInput { forward: -1|0|1; right: -1|0|1; jump: boolean; crouch: boolean; yaw: number; pitch: number }
export interface PlayerState { pos: Vec3; vel: Vec3; onGround: boolean; crouching: boolean;
  mode: 'walk'|'ladder'|'mantle'; mantleFrom?: Vec3; mantleTo?: Vec3; mantleT?: number }
export function initialState(spawn: Vec3): PlayerState;
export function stepPlayer(s: PlayerState, input: PlayerInput, world: CollisionWorld, dt: number): PlayerState;
export function eyeHeight(s: PlayerState): number;
```

Comportamiento:
- **Paso de tiempo:** `dt` se recorta a `maxDt` y se integra en subpasos de `subStep`.
- **Escalones:** subir un escalón de hasta `stepUp` es automático.
- **Trepar (mantle):** se activa si hay `jump` + `forward = 1` frente a una pared cuyo techo, a 0,6 m adelante, está entre `stepUp` y `mantleReach` por encima de los pies, y hay espacio libre arriba. Interpola en `mantleTime` hasta el techo.
- **Escalera:** con `ladderAt` y `forward = 1` sube a `ladderSpeed`. Al llegar a `topY` pasa al techo con el mismo empuje que el mantle.
- **Bordes:** la posición se recorta a los bounds ± `radius`.
- **Agacharse:** con `crouch` se agacha. Para pararse de nuevo hace falta espacio libre arriba.

- [ ] **Step 1: Escribir los tests (fallan)** en un mundo de prueba: suelo, pared de 0,3 m de espesor, cordón de 0,3 m, bloque de 0,6 m, paredes de 2,4 m y 2,6 m, dos techos de 3,8 m separados por 3,5 m, edificio de 7 m con escalera y bounds de ±50.

```ts
const run = (s, input, secs) => { for (let t = 0; t < secs; t += 1/60) s = stepPlayer(s, input, world, 1/60); return s; };
test('corre a 6 m/s', () => expect(dist2D(run(at(0,0), fwd, 1).pos, [0,0,0])).toBeCloseTo(6, 0));
test('la pared lo frena a radio de distancia', () => expect(run(at(0,0), fwdToWall, 2).pos[0]).toBeCloseTo(wallX - 0.35, 2));
test('sube cordón de 0,3 pero no bloque de 0,6', () => { expect(run(beforeCurb, fwd, 1).pos[1]).toBeCloseTo(0.3); expect(run(beforeBlock, fwd, 1).pos[1]).toBe(0); });
test('salto llega a 1,25 m', () => expect(maxY(jumpFromFlat)).toBeCloseTo(1.25, 1));
test('salto corriendo cruza 3,5 m entre techos', () => expect(run(roofEdgeRunning, fwdJump, 1.5).pos[1]).toBeCloseTo(3.8));
test('trepa pared de 2,4 m pero no de 2,6 m', () => { expect(run(atWall24, fwdJump, 1).pos[1]).toBeCloseTo(2.4); expect(run(atWall26, fwdJump, 1).pos[1]).toBeLessThan(0.1); });
test('escalera de 7 m en ~2,3 s y termina en el techo', () => { const s = run(atLadder, fwd, 3); expect(s.pos[1]).toBeCloseTo(7); expect(s.mode).toBe('walk'); });
test('no sale del área ni saltando desde un techo', () => expect(Math.abs(run(roofAtEdge, fwdJump, 3).pos[0])).toBeLessThanOrEqual(50 - 0.35));
test('dt = 1,0 no atraviesa la pared de 0,3 m', () => expect(stepPlayer(beforeThinWall, fwd, world, 1.0).pos[0]).toBeLessThan(thinWallX));
test('agachado: ojos a 1,05', () => expect(eyeHeight(run(at(0,0), crouchIn, 0.2))).toBeCloseTo(1.05));
```

- [ ] **Step 2–4:** verificar que falla, implementar y verificar que pasa.
- [ ] **Step 5:** Commit: `feat(shared): controlador de jugador con salto, mantle y escaleras`.

---

### Task 10: Geometría del mundo (edificios, cintas y chunks)

**Files:**
- Create: `src/client/world/geometry.ts`, `src/client/world/chunks.ts`
- Test: `tests/client/geometry.test.ts`

**Interfaces:**
- Consumes: `MapData`, `Building`, `Road`, `FLOOR_H`.
- Produces:
  - `BAY_W = 3.0`.
  - `extrudeBuilding(b: Building): { walls: { ground: THREE.BufferGeometry; upper: THREE.BufferGeometry }; roof: THREE.BufferGeometry; parapet: THREE.BufferGeometry }`. Las paredes tienen UV en módulos: `u = metros a lo largo del perímetro / BAY_W`, `v = y / FLOOR_H`. La banda `ground` va de 0 a `FLOOR_H` y la `upper` de `FLOOR_H` al techo. Cada vértice lleva color = `b.tint`. El techo se triangula con `THREE.ShapeUtils.triangulateShape`, y el pretil es un anillo de 0,6 m de alto y 0,2 m de espesor.
  - `ribbon(points: Vec2[], width: number, y: number): THREE.BufferGeometry`. Unión en inglete con límite 2× y extremos extendidos `width/2`.
  - `polygonGeometry(poly: Vec2[], y: number, uvScale: number): THREE.BufferGeometry`.
  - `CHUNK = 250`.
  - `buildChunks(map: MapData, materials: WorldMaterials): THREE.Group[]`. Agrupa por chunk y por material con `mergeGeometries`. Cada chunk es un `THREE.Group` con `userData.chunk = [i, j]`.

- [ ] **Step 1: Escribir los tests (fallan)**

```ts
const g = extrudeBuilding({ ...square10, height: heightFor(2), floors: 2 });
test('normales de pared hacia afuera', () => everyWallFace(g.walls.upper, (n, mid) => expect(dot(n, sub(mid, centroid))).toBeGreaterThan(0)));
test('UV en módulos de 3 m × 3,2 m', () => { expect(maxU(g.walls.ground)).toBeCloseTo(40 / 3); expect(maxV(g.walls.upper)).toBeCloseTo(heightFor(2) / 3.2); });
test('techo de un cuadrado = 2 triángulos a la altura', () => { expect(g.roof.index!.count).toBe(6); expect(allY(g.roof)).toEqual(heightFor(2)); });
test('techo de un polígono cóncavo en L', () => expect(areaOf(extrudeBuilding(lShape).roof)).toBeCloseTo(polygonArea(lShape.footprint), 1));
test('cinta: área ≈ largo × ancho y sin NaN en giros cerrados', () => {
  expect(areaOf(ribbon([[0,0],[100,0]], 8, 0))).toBeCloseTo((100 + 8) * 8, 0);
  expect(hasNaN(ribbon([[0,0],[10,0],[0,0.5]], 8, 0))).toBe(false); });
test('cantidad de mallas = pares (chunk, material) no vacíos', () => expect(countMeshes(buildChunks(mapFixture, fakeMaterials))).toBe(expectedPairs));
```

- [ ] **Step 2–4:** verificar que falla, implementar y verificar que pasa.
- [ ] **Step 5:** Commit: `feat(client): geometría de edificios, cintas y chunks`.

---

### Task 11: Texturas, materiales y calidad

**Files:**
- Create: `tools/fetch-textures.ts`, `data/textures.json`, `public/textures/*` (descargadas y versionadas), `src/client/render/quality.ts`, `src/client/world/materials.ts`, `src/client/world/facades.ts`
- Test: `tests/client/quality.test.ts`

**Interfaces:**
- Produces:
  - `type Quality = 'baja'|'media'|'alta'`.
  - `QUALITY: Record<Quality, { pixelRatioMax: number; shadows: false | { mapSize: number; range: number }; drawDistance: number; treeDensity: number; anisotropy: number; textureSize: 512|1024 }>`.
  - `loadQuality(): Quality`. Lee `localStorage['adrogue.calidad']` y por defecto devuelve `'media'`. `saveQuality(q: Quality): void`.
  - `interface WorldMaterials { wallGroundHouse; wallGroundShop; wallUpper; brickGround; brickUpper; roof; parapet; asphalt; sidewalk; grass; path; platform; rail }`. Todos son `THREE.Material`, con `vertexColors` en los de paredes.
  - `createMaterials(q: Quality): Promise<WorldMaterials>`.
  - `composeFacadeTile(base: HTMLImageElement, style: 'house'|'shop'|'upper', size: number): HTMLCanvasElement`. Dibuja sobre la textura base de revoque o ladrillo un módulo de 3 m × 3,2 m:
    - `upper`: ventana con marco y persiana de madera.
    - `house`: puerta o ventana con reja.
    - `shop`: vidriera con persiana metálica a medio subir.

`QUALITY` (decisión de este plan):

| | pixelRatioMax | shadows | drawDistance | treeDensity | anisotropy | textureSize |
|---|---|---|---|---|---|---|
| baja | 0.75 | false | 250 | 0.5 | 1 | 512 |
| media | 1 | `{ mapSize: 1024, range: 80 }` | 450 | 1 | 4 | 1024 |
| alta | 2 | `{ mapSize: 2048, range: 150 }` | 900 | 1 | 8 | 1024 |

- [ ] **Step 1: Test de los presets (falla)**

```ts
test('presets exactos', () => { expect(QUALITY.baja).toMatchObject({ pixelRatioMax: 0.75, shadows: false, drawDistance: 250, treeDensity: 0.5 });
  expect(QUALITY.media.shadows).toEqual({ mapSize: 1024, range: 80 }); expect(QUALITY.alta.drawDistance).toBe(900); });
test('calidad por defecto media y persistida', () => { localStorage.clear(); expect(loadQuality()).toBe('media'); saveQuality('baja'); expect(loadQuality()).toBe('baja'); });
```

(Vitest con `environment: 'jsdom'` solo para `tests/client/**`. Agregar `jsdom` a devDependencies.)

- [ ] **Step 2–4:** verificar que falla, implementar `quality.ts` y verificar que pasa.
- [ ] **Step 5: `data/textures.json` y `fetch-textures.ts`.**
  - Hay un slot por cada material: revoque, ladrillo, asfalto, baldosa (base de hormigón claro), pasto, sendero, techo (membrana o hormigón), metal (persiana), madera (persiana y puertas) y corteza.
  - Para cada slot, elegir un asset CC0 de Poly Haven buscándolo en `https://api.polyhaven.com/assets?t=textures` y registrar `{ slot, assetId, license: 'CC0', url }`.
  - Descargar `diff`, `nor_gl` y `rough` en 1k JPG desde `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/<id>/<id>_<map>_1k.jpg` a `public/textures/<slot>_<map>.jpg`.
  - La baldosa vainilla se compone sobre la base de hormigón con el patrón de 9 puntos, en canvas dentro de `materials.ts`.
  - Agregar Poly Haven a `data/sources.json`.
  - Verificación: `npm run fetch:textures` termina con todos los archivos presentes y en total pesan menos de 25 MB.
- [ ] **Step 6:** Commit: `feat(client): texturas CC0, fachadas compuestas y presets de calidad`.

---

### Task 12: App cliente (escena, jugador, menús y errores)

**Files:**
- Create: `index.html`, `src/client/main.ts`, `src/client/render/scene.ts`, `src/client/input.ts`, `src/client/ui/overlay.ts`, `src/client/ui/places-menu.ts`, `src/client/ui/credits.ts`, `src/client/ui/hud.ts`, `src/client/debug.ts`
- Test: `tests/client/input.test.ts`, `e2e/app.spec.ts`

**Interfaces:**
- Consumes: `MapData` (fetch a `/map/adrogue.map.json`), `buildCollisionWorld`, `stepPlayer`, `initialState`, `eyeHeight`, `buildChunks`, `createMaterials`, `QUALITY`, `loadQuality`.
- Produces:
  - `createInput(target: Window): { read(): PlayerInput; reset(): void; dispose(): void }`. Reacciona a `blur` y `visibilitychange` con `reset()`.
  - `window.__adrogue` solo con `?debug=1`: `{ teleport(placeId: string): void; state(): PlayerState; stats(): { drawCalls: number; triangles: number; fps: number }; setQuality(q: Quality): void; ready: Promise<void> }`.

Comportamiento y textos exactos:
- **Escena:**
  - Cielo diurno con `Sky` de three/examples, una luz direccional como sol y una `HemisphereLight`.
  - Niebla con `near = drawDistance·0,5` y `far = drawDistance`. `camera.far = drawDistance + 50`.
  - Las siluetas de `outskirts` son una sola malla sin textura, del color de la niebla.
- **Overlay inicial:**
  - Título: `Adrogué`. Botón: `Hacé click para jugar`.
  - Ayuda: `WASD moverse · Espacio saltar · C agacharse · Mouse mirar · M lugares · Esc menú`.
- **Menú Esc:** `Seguir`, `Calidad: Baja / Media / Alta`, `Lugares` y `Créditos`.
- **Menú de lugares (M):**
  - Lista los 38 lugares por nombre, más la opción `Aparecer en un lugar al azar`.
  - Al hacer click se teletransporta a `place.spawn` mirando hacia el lugar.
- **Créditos:** se arman a partir de `data/sources.json`, que se copia a `public/` en `build:map`.
- **HUD:** mira en el centro. Con F3 se muestran los fps y la cantidad de draw calls.
- **Sin WebGL2:** se muestra `Tu navegador no soporta WebGL2. Probá con Chrome, Edge o Firefox actualizados.`
- **Contexto WebGL perdido:** se muestra `Se perdió el contexto gráfico. Recargá la página.`
- **Spawn inicial:** `estacion-adrogue`.

- [ ] **Step 1: Test unitario de input (falla)**

```ts
test('blur suelta todas las teclas', () => { press('KeyW'); window.dispatchEvent(new Event('blur')); expect(input.read().forward).toBe(0); });
test('W/S/A/D → forward/right', () => { press('KeyW'); press('KeyD'); expect(input.read()).toMatchObject({ forward: 1, right: 1 }); });
```

- [ ] **Step 2: Tests e2e (fallan)** en `e2e/app.spec.ts`, contra `/?debug=1`.

```ts
test('carga sin errores de consola y el canvas no está vacío', async ({ page }) => { /* recolectar console.error; await __adrogue.ready; varianza de píxeles del canvas > umbral */ });
test('teletransporte a los 38 lugares deja al jugador en suelo libre', async ({ page }) => {
  for (const id of placeIds) { await page.evaluate(i => window.__adrogue.teleport(i), id); await page.waitForTimeout(100);
    const s = await page.evaluate(() => window.__adrogue.state()); expect(s.onGround, id).toBe(true); } });
test('menú M lista 38 lugares + al azar', async ({ page }) => { await page.keyboard.press('KeyM'); await expect(page.getByTestId('menu-lugares').getByRole('button')).toHaveCount(39); });
test('sin WebGL muestra el mensaje en español', async ({ browser }) => { /* contexto nuevo con args --disable-webgl --disable-webgl2 */
  await expect(page.getByText('Tu navegador no soporta WebGL2.')).toBeVisible(); });
```

- [ ] **Step 3:** `npx vitest run tests/client/input.test.ts && npx playwright test e2e/app.spec.ts`. Resultado esperado: FAIL.
- [ ] **Step 4:** implementar.
- [ ] **Step 5:** volver a correr. Resultado esperado: PASS. Agregar una captura manual con `npm run dev` y recorrer el mapa un rato.
- [ ] **Step 6:** Commit: `feat(client): app jugable con menús, créditos y manejo de errores`.

---

### Task 13: Lo que hace reconocible a Adrogué (carteles, estación, plazas, árboles y props)

**Files:**
- Create: `src/client/world/signs.ts`, `src/client/world/landmarks.ts`, `src/client/world/vegetation.ts`, `src/client/world/props.ts`
- Test: `tests/client/signs.test.ts`, `e2e/tour.spec.ts`

**Interfaces:**
- Consumes: `Place.sign`, `MapData.platforms/railways/parks/trees/props`, `QUALITY.treeDensity`.
- Produces:
  - `signTexture(text: string, style: PlaceType): HTMLCanvasElement`. Fondo y tipografía por tipo, sin logos.
  - `buildSigns(places: Place[]): THREE.Group`. Cada cartel es una caja de `width × 0,9 × 0,12` m.
  - `buildStation(map: MapData): THREE.Group`. Andenes de 1 m de alto con borde amarillo, alero o cubierta de chapa sobre el andén, vías con durmientes instanciados y cartel `ADROGUÉ` en los andenes.
  - `buildParks(map: MapData): THREE.Group`. Pasto, senderos `footway`, bancos y fuentes.
  - `buildMonuments(props): THREE.Group`. Pedestal más figura simplificada según el `style`.
  - `buildTrees(trees: Tree[], density: number): THREE.InstancedMesh[]`. Tres variantes. Tronco de 8 lados y copa de 6 planos con alpha-test. Las sombras usan `customDepthMaterial` con alpha-test.
  - `buildClimbProps(props): THREE.InstancedMesh[]` para escaleras y contenedores.

- [ ] **Step 1: Test de carteles (falla)**

```ts
test('cartel con medidas y orientación del MapData', () => { const m = buildSigns([placeWithSign]).children[0] as THREE.Mesh;
  expect(sizeOf(m)).toEqual([placeWithSign.sign!.width, 0.9, 0.12]); expect(facing(m)).toBeCloseTo2D(placeWithSign.sign!.normal); });
```

- [ ] **Step 2: Tour e2e (falla primero porque falta el módulo).**
  - `e2e/tour.spec.ts` se teletransporta a 10 puntos y guarda capturas en `test-results/tour/NN-<id>.png`: `estacion-adrogue`, `plaza-almirante-brown`, `banco-nacion`, `mcdonalds`, `la-veneciana`, `cine-pixel`, `casa-de-la-cultura`, `guernica-bar`, un techo (después de subir por una escalera) y el borde este del mapa.
  - Solo valida que no haya errores y que las capturas existan.
- [ ] **Step 3:** implementar. **Step 4:** volver a correr. Resultado esperado: PASS.
- [ ] **Step 5: Revisión visual.**
  - Abrir las 10 capturas y comparar cada una contra la vista satelital de Esri en el mismo punto.
  - Corregir lo evidente: cartel en la cara equivocada, una plaza sin árboles, o andenes del lado equivocado de las vías.
- [ ] **Step 6:** Commit: `feat(client): carteles, estación, plazas, árboles y props`.

---

### Task 14: Fachadas con foto (Estación, Casa de la Cultura y La Zorra)

**Files:**
- Create: `tools/fetch-photos.ts`, `data/photo-facades.json`, `public/photos/*`, `src/shared/homography.ts`, `src/client/world/photo-facades.ts`
- Test: `tests/shared/homography.test.ts`

**Interfaces:**
- Produces:
  - `computeHomography(src: [Vec2,Vec2,Vec2,Vec2], dst: [Vec2,Vec2,Vec2,Vec2]): number[]` (3×3 aplanada) y `applyHomography(h: number[], p: Vec2): Vec2`.
  - `rectify(img: HTMLImageElement, corners: [Vec2,Vec2,Vec2,Vec2], outW: number, outH: number): HTMLCanvasElement` en el cliente. Las esquinas van en orden SI, SD, ID, II.
  - `data/photo-facades.json`: entradas `{ placeId, commonsFile, corners, widthM, heightM }`.

Archivos de Commons por lugar (el implementador elige la toma más frontal entre los de la estación):
- Estación: `File:Estación de Adrogué - Octubre 2022 (1).jpg` hasta `(4)` y `File:Estación de Adrogué - Julio 2025 (1).jpg`.
- Casa de la Cultura: `File:Casa de la Cultura.jpg`.
- La Zorra: `File:La Zorra - panoramio.jpg`.
- Como referencia de proporciones para los monumentos de la Tarea 13 (no son fachadas):
  - `File:Monumento al Almirante Guillermo Brown, en la plaza homónima (Adrogué).jpg`
  - `File:Esteban Adrogué monumento.jpg`

- [ ] **Step 1: Tests de la homografía (fallan)**

```ts
test('mapea las 4 esquinas exactamente', () => { const h = computeHomography(src, dst); src.forEach((p, i) => expect(applyHomography(h, p)).toBeCloseTo2D(dst[i], 6)); });
test('identidad', () => expect(applyHomography(computeHomography(unit, unit), [0.3, 0.7])).toBeCloseTo2D([0.3, 0.7], 9));
```

- [ ] **Step 2–4:** verificar que falla, implementar y verificar que pasa.
- [ ] **Step 5: Descargar las fotos con licencia.**
  - `fetch-photos.ts` consulta la API de Commons con `action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=2048`.
  - Guarda la imagen en `public/photos/` y suma a `data/sources.json` el autor (`Artist`), la licencia (`LicenseShortName`) y la URL de la página.
  - Si alguna foto no tiene una licencia CC0, CC BY o CC BY-SA, el script falla.
  - Las esquinas de cada fachada se eligen mirando cada foto y se anotan en `data/photo-facades.json`.
- [ ] **Step 6: Aplicar las fotos en el cliente.**
  - La foto rectificada reemplaza las bandas `ground` y `upper` de la arista del cartel en el edificio del lugar. Ese edificio queda fuera del merge del chunk.
  - Verificación: volver a correr `e2e/tour.spec.ts` y mirar las capturas de la estación y de la Casa de la Cultura.
- [ ] **Step 7:** Commit: `feat: fachadas con fotos libres de Commons`.

---

### Task 15: Presupuesto de rendimiento y benchmark

**Files:**
- Create: `src/client/bench.ts`, `e2e/perf.spec.ts`
- Modify: `src/client/main.ts` (modo `?bench=1`), `README.md` (cómo correr el juego y cómo medir en otra notebook)

**Interfaces:**
- Consumes: `window.__adrogue.stats()`, `setQuality`.
- Produces:
  - `?bench=1` recorre automáticamente 60 s de un camino fijo: estación → Esteban Adrogué → Espora → Plaza Brown → techos.
  - Al final muestra `Promedio: N fps · Peor 5 %: M fps · Calidad: X`.
  - Así el usuario lo puede correr en la notebook de un amigo.

Presupuestos por calidad, medidos con `renderer.info` en los 6 puntos del tour (estación, Plaza Brown, Esteban Adrogué, Espora, un techo alto y el borde):

| | draw calls ≤ | triángulos ≤ |
|---|---|---|
| baja | 150 | 800 000 |
| media | 300 | 1 500 000 |
| alta | 450 | 3 000 000 |

Además: `adrogue.map.json` < 3 MB y `public/textures` < 25 MB.

- [ ] **Step 1: Escribir `e2e/perf.spec.ts` (falla mientras se superen los presupuestos)**

```ts
for (const q of ['baja','media','alta'] as const) test(`presupuesto ${q}`, async ({ page }) => {
  await page.evaluate(q => window.__adrogue.setQuality(q), q);
  for (const id of TOUR6) { await teleportAndSettle(page, id); const s = await stats(page);
    expect(s.drawCalls, `${q}/${id}`).toBeLessThanOrEqual(BUDGET[q].drawCalls); expect(s.triangles).toBeLessThanOrEqual(BUDGET[q].triangles); } });
test('tamaños en disco', () => { expect(statSync('public/map/adrogue.map.json').size).toBeLessThan(3e6); expect(dirSize('public/textures')).toBeLessThan(25e6); });
```

- [ ] **Step 2:** `npx playwright test e2e/perf.spec.ts`. Anotar los valores medidos.
- [ ] **Step 3: Ajustar hasta cumplir.** El orden es frustum culling por chunk, niebla y `camera.far` por calidad, densidad de árboles y sombras solo en `range`. Si hay que recortar, se recorta realismo y no fluidez.
- [ ] **Step 4:** volver a correr la suite completa con `npm test && npx playwright test`. Resultado esperado: PASS.
- [ ] **Step 5:** `README.md` con `npm install`, `npm run dev`, cómo regenerar el mapa (`fetch:*` + `build:map`) y cómo medir con `?bench=1`.
- [ ] **Step 6:** Commit: `perf: presupuestos por calidad y modo benchmark`.

---

## Cierre de la etapa 1

Al terminar la Tarea 15:
- Mostrarle al usuario las capturas del tour.
- Pedirle que recorra el mapa con `npm run dev`, que pruebe `?bench=1` en la notebook de un amigo y que diga qué fachadas no se parecen. Las correcciones de fachada se hacen editando `data/places.json` o `data/photo-facades.json`, sin tocar el código.
- La etapa 2 (interiores, armas, botín y zona) se planifica aparte.
