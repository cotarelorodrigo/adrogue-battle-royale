# Fachadas reales (piloto Esteban Adrogué): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que cada local o edificio de las dos veredas de Esteban Adrogué tenga su propio color, cartel, planta baja y altura, como en la calle real, y que la calle se vea de empedrado, sin perder fluidez.

**Architecture:**
- **Datos.** Un archivo editable a mano, `data/frentes.json`, guarda cada frente de manzana como una lista de lotes en orden desde una esquina.
- **Mapgen.** Calcula la línea de edificación del frente con las calles de OSM y reparte los lotes sobre esa línea. Cada lote se convierte en un `Building` con un `front`, y se le recorta su lugar a los bloques fusionados de Microsoft. Los lugares y los locales de OSM se enlazan con su lote, para que haya un solo cartel por local.
- **Cliente.**
  - Los frentes salen de un atlas de módulos de 3 m × 1 piso: un solo material, coloreado por vértice solo donde la máscara dice "pared pintada".
  - Todos los carteles van a un atlas de páginas: unas pocas llamadas de dibujo en total, no una por lote.
  - El empedrado es un material nuevo para las calles con `surface: 'sett'`.

**Decisiones del constructor (sección 5 del spec):**
- Los bloques de Microsoft se parten solo en la franja del frente: cada lote tiene `fondo` (15 m por defecto) y lo de atrás queda como estaba.
- La foto de la Casa de la Cultura **se conserva**. Si su lugar queda enlazado a un lote, la foto va a la arista del cartel del lote, que es lo que ya hace `buildPhotoFacades` sin `edgeIndex`. Mapgen avisa si la foto no entra en el frente o en la altura del lote.
- Se mira una vista de Street View cada 8 m.

**Tech Stack:** Node 24 (TS nativo), TypeScript con `erasableSyntaxOnly`, three.js 0.187, `polygon-clipping`, Vite, Vitest (jsdom + `tests/client/canvas-stub.ts`) y Playwright (Chrome + SwiftShader).

**Spec:** `docs/superpowers/specs/2026-11-03-fachadas-reales-design.md`. Además valen las secciones 4, 5 y 8 del diseño general (`docs/superpowers/specs/2026-11-03-adrogue-battle-royale-design.md`).

## Global Constraints

- **Coordenadas.**
  - Metros: `x` hacia el este, `z` hacia el sur (norte = −z), `y` hacia arriba. `Vec2 = [x, z]`. Los polígonos van antihorarios vistos desde arriba (`ensureCCW`).
  - `offsetLine(pts, d)` corre la línea hacia `(−dz, dx)·d`. Por ejemplo, si la línea va hacia el este, `d > 0` la lleva al sur.
- **TypeScript.** Con `erasableSyntaxOnly`: sin `enum`, sin `namespace` y sin parameter properties. Los imports locales llevan `.ts`.
- **Git.** Se trabaja en la rama `fachadas-reales`. Cada commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No se hace push ni merge sin que lo pida el usuario.
- **Street View es solo referencia visual.**
  - Las capturas quedan solo en el scratchpad de la sesión. Nunca se commitean, nunca se publican y nunca se usan como textura.
  - Ningún píxel de Google puede terminar en el repo ni en el juego.
  - No se usa `gif_creator` sobre Street View.
- **Marcas.** Se permiten los colores de la marca en el cartel y en la fachada, y el nombre escrito con una letra parecida a la real. **Logos, no**: ni copiados ni redibujados.
- **Texturas.** Solo CC0 o CC BY. Cada textura va en `data/textures.json` y su fuente en `data/sources.json`. La entrada `polyhaven` ya cubre todo lo que venga de Poly Haven.
- **Mapas en tiempo de juego.** No se consulta ningún servicio externo. Todo sale de `public/map/adrogue.map.json`, que pesa menos de 3 MB.
- **Idioma.** Los mensajes de error y la interfaz van en español rioplatense. Las claves de `data/frentes.json` también van en español, porque el archivo lo edita el usuario.
- **Gana lo fluido.** Los presupuestos de `e2e/perf.spec.ts` **no se suben**:

  | Calidad | Draw calls | Triángulos |
  |---|---|---|
  | Baja | 130 | 130.000 |
  | Media | 245 | 230.000 |
  | Alta | 385 | 305.000 |

  Las llamadas de dibujo no crecen con la cantidad de lotes:
  - todos los frentes de un chunk van en un solo merge con el material `front`;
  - todos los carteles van en las páginas de un atlas.
- **No se rompe lo que ya anda.** Caminar, subir a los techos, colisiones, huecos con salida, y los carteles, ids, puntos de aparición y teletransporte de los 38 lugares.
- **Warnings fatales.** `npm run build:map` falla con cualquier warning para el que `isFatalWarning` dé `true` (`src/mapgen/spawns.ts`). Los errores de datos se lanzan como `Error` con un mensaje que nombra el frente y el lote.
- **El mapa va commiteado.** Cada tarea que cambia lo que genera mapgen corre `npm run build:map` y commitea `public/map/adrogue.map.json`.

## Review Focus

1. **Errores de tipeo en `data/frentes.json`.** Por ejemplo: un campo mal escrito, un color sin `#`, una esquina que no cruza la calle, o un `usa` o `lugar` que no existe.
   - Esperado: `npm run build:map` falla con un mensaje en español que nombra el frente y el número de lote.
   - Tests: Tareas 1 y 2.
2. **Anchos que no cierran contra el largo del frente.** Pasa cuando se salteó un local o se contó dos veces.
   - Esperado: si la suma se desvía más de 10 %, error que dice cuánto suman y cuánto mide el frente. Si se desvía menos, se escala en proporción.
   - Test: Tarea 3.
3. **Lugar o local de OSM sobre un frente relevado que no quedó en ningún lote.** Daría un cartel doble o un local perdido.
   - Esperado: warning fatal que dice cómo arreglarlo (`"lugar"`, `"osm"` u `"osmAusentes"`).
   - Test: Tarea 4.
4. **Esquinas oblicuas y curvas de la calle.**
   - Esperado: ningún lote pisa la calzada ni la vereda de ninguna calle vehicular, y los lotes vecinos no se superponen.
   - Test: Tarea 3.
5. **Cambiar la calidad desde el menú con Esteban Adrogué a la vista.**
   - Esperado: el atlas de frentes y el empedrado se vuelven a crear, los viejos se liberan una sola vez y no aparece ningún error en la consola.
   - Tests: Tarea 6 (liberación) y Tarea 9 (e2e).

## Datos verificados durante la planificación (para no re-investigar)

- **Esteban Adrogué (EA) en OSM.**
  - Son dos vías: `w28314572` (tertiary, de (−250,39; 95,92) a (170,04; 24,49), pasando por (−68; 131), (−58; 133), (−52; 132), (−45; 130), (12; 102) y (163; 28)) y `w1293531198`, de (170; 24) a (180; 19).
  - OSM la marca `surface=asphalt`; el usuario dice que es empedrado.
  - Las vías `Plaza Esteban Adrogué` son el anillo de la plaza: es otra calle y no entra en el piloto.
- **Esquinas sobre EA.**
  - En (−250; 96) se cruzan `Bartolomé Mitre` (tertiary) y `Somellera` (residential).
  - `Pellerano` (residential) cruza en (−58; 133) y `Benigno Macías` (residential) en (12; 102).
  - `Avenida Espora` (secondary) cruza en (170; 24) y otra vez en (180; 19).
  - Son 3 cuadras: Mitre–Pellerano (unos 190 m), Pellerano–Macías (unos 78 m) y Macías–Espora (unos 176 m). En total, **6 frentes**. La estimación de "12 frentes" del spec contaba el anillo de la plaza.
- **`ROAD_SPECS` (ancho de calzada / vereda, en m).** secondary 12/3, tertiary 10/3, residential 8/3, living_street 6/2, service 4/0, pedestrian 6/0, footway 2,5/0. Por eso la línea de edificación de EA queda a 8 m del eje.
- **Locales de OSM a 20 m o menos del eje de EA.** Entre paréntesis, la distancia y la vereda:
  - Galicia (10; sur), Banco Nación (10; sur), Supervielle (10; sur), Bonafide (11; sur), "Farrnacia Central" (11; sur; así, mal escrito, figura en OSM) y Lucciano's (16; sur).
  - BBVA (8; norte), Subway (6; norte) y prato (8; norte).
  - Trote Bar (1; esquina Pellerano), El Faro (8; norte), Riviera Café (9; sur), Filomena (18; sur), Santander (10) y Macro (9).
  - Quedan fuera de los frentes: Nuevo Tempo (al oeste de Mitre), La Alcancía (al este de Espora), Guernica Bar (sobre Pellerano) y Banco Provincia (sobre Mitre, a 30 m de EA).
- **Lugares sobre EA:** bbva, banco-nacion, galicia, macro, santander, luccianos, el-faro y filomena.
  - casa-de-la-cultura queda a 55 m del eje: está retirada o el punto cae atrás. Lo resuelve el relevamiento con `retiro` y `fondo`.
  - banco-provincia está sobre Mitre y queda fuera del piloto. Se le avisa al usuario en la parada de la Tarea 9.
- **Textura del empedrado:** Poly Haven `cobblestone_floor_08` (CC0). Se miraron las miniaturas: adoquín gris redondeado, en hileras. Los mapas son `diff`, `nor_gl` y `rough`, como los demás slots, y bajan con `npm run fetch:textures`. Las texturas de `public/textures/` van commiteadas.
- **Cambio de calidad.** `scene.setMaterials` cambia el material de cada malla por su nombre (`mesh.name` = clave de `WorldMaterials`). Las claves nuevas `front` y `cobble` entran en ese cambio solas.

---

### Task 1: Contrato de datos y `data/frentes.json`

**Files:**
- Modify: `src/shared/mapdata.ts`, `src/mapgen/assemble.ts` (agregar `signs: []`), `src/client/world/signs.ts` (re-exporta `SIGN_H` y `SIGN_D`)
- Create: `src/mapgen/frentes-input.ts`, `data/frentes.json`, `tests/fixtures/frentes-prueba.json`
- Test: `tests/mapgen/frentes-input.test.ts`

**Interfaces:**
- Produces, en `src/shared/mapdata.ts`:
  ```ts
  export type PlantaBaja = 'vidriera' | 'persiana' | 'porton' | 'puerta' | 'banco' | 'acceso' | 'pared';
  export type Arriba = 'ventanas' | 'balcones' | 'vidriado' | 'ciego';
  export type Fuente = 'sans' | 'serif' | 'condensada' | 'redondeada';
  export type Puerta = 'inicio' | 'medio' | 'fin';
  /** Frente relevado de un lote. `edges`: aristas de `footprint` sobre la línea de edificación, de `desde` a `hasta`;
   *  `corner`: aristas sobre la línea de la calle transversal (lotes de esquina). */
  export interface Front { edges: number[]; corner: number[]; pb: PlantaBaja; arriba: Arriba; puerta: Puerta;
    ladrillo?: true; colorPB?: string; toldo?: { color: string; rayas?: true } }
  export interface SignLook { fondo: string; letra: string; marco: string; fuente: Fuente; cursiva?: true }
  // Sign suma: look?: SignLook; blade?: true    (blade = cartel de bandera, perpendicular y de dos caras)
  // Building suma: front?: Front
  // Road suma: surface?: 'sett'
  // MapData suma: signs: Sign[]                  (carteles de lotes que no son de un lugar)
  export const SIGN_H = 0.9;
  export const SIGN_D = 0.12;   // se mudan desde client/world/signs.ts, que los re-exporta
  ```
- Produces, en `src/mapgen/frentes-input.ts`:
  ```ts
  export interface CartelInput { texto: string; fondo: string; letra: string; marco?: string; fuente: Fuente;
    cursiva: boolean; posicion: 'frente' | 'alto' | 'bandera'; ancho?: number }
  export interface LoteInput { ancho: number; pisos: number; fondo: number; retiro: number; color: string; colorPB?: string;
    pb: PlantaBaja; arriba: Arriba; material: 'revoque' | 'ladrillo'; puerta: Puerta;
    toldo?: { color: string; rayas: boolean }; cartel?: CartelInput; lugar?: string; osm?: string; nota?: string }
  export interface FrenteInput { id: string; calle: string; desde: string; hasta: string;
    vereda: 'norte' | 'sur' | 'este' | 'oeste'; fecha: string; osmAusentes: string[]; lotes: LoteInput[] }
  export interface FrentesInput { frentes: FrenteInput[]; calzadas: Record<string, 'empedrado' | 'asfalto'> }
  export function validateFrentes(data: unknown, source: string, placeIds: readonly string[]): FrentesInput;
  export function loadFrentes(path?: string /* 'data/frentes.json' */, placeIds?: readonly string[] /* ids de loadPlaces() */): FrentesInput;
  ```

**Formato del archivo** (el que edita el usuario):

```json
{
  "estilos": {
    "casa-baja": { "pisos": 1, "pb": "puerta", "arriba": "ciego", "color": "#e9e2d0" }
  },
  "calles": [
    {
      "calle": "Esteban Adrogué",
      "calzada": "empedrado",
      "frentes": [
        {
          "id": "ea-mitre-pellerano-s", "desde": "Bartolomé Mitre", "hasta": "Pellerano", "vereda": "sur",
          "fecha": "2024-03", "osmAusentes": [],
          "lotes": [
            { "ancho": 8.7, "pisos": 2, "color": "#d9d2c3", "colorPB": "#2b2b2b", "pb": "banco", "arriba": "vidriado",
              "cartel": { "texto": "BANCO NACIÓN", "fondo": "#1b4f8a", "letra": "#ffffff", "posicion": "alto" },
              "lugar": "banco-nacion" },
            { "usa": "casa-baja", "ancho": 10, "toldo": { "color": "#2e6b3a", "rayas": true } },
            { "ancho": 4, "pisos": 0, "nota": "garaje abierto" }
          ]
        }
      ]
    }
  ]
}
```

**Valores por defecto:**
- en el lote: `fondo` 15, `retiro` 0, `pb` `"vidriera"`, `arriba` `"ventanas"`, `material` `"revoque"`, `puerta` `"inicio"`;
- en el cartel: `fuente` `"sans"`, `cursiva` false, `posicion` `"frente"`;
- en el toldo: `rayas` false.

`usa` mezcla el estilo nombrado y después aplica los campos del lote, que mandan.

**Reglas de validación.** Primero se revisan los campos desconocidos y después lo demás. Cada mensaje empieza con `${source}: frente ${id}, lote ${k}` (k desde 1), o con `${source}: frente ${id}` si el error es del frente.
- Un campo desconocido en cualquier nivel es un error que lo nombra. Así salta un typo como `"colour"`.
- Los colores tienen la forma `#rrggbb`.
- `ancho` va de 0 a 60, sin incluir el 0.
- `pisos` es un entero de 0 a 20.
- `fondo` va de 3 a 60, `retiro` de 0 a 60, y `retiro + fondo` no pasa de 80.
- Los enums tienen que tener uno de sus valores, y el mensaje los lista.
- Si `pisos` es mayor que 0, `color` es obligatorio.
- Un lote con `pisos` 0 no lleva `cartel` ni `toldo`.
- `cartel.texto` no puede estar vacío y tiene como máximo 40 caracteres.
- Un lote con `lugar` tiene que llevar `cartel`, porque el punto de aparición necesita el cartel.
- `lugar` tiene que estar en `placeIds` y aparecer en un solo lote de todo el archivo.
- `usa` tiene que nombrar un estilo que exista. Un estilo no puede tener `ancho` ni `usa`.
- Los `id` de los frentes son únicos y `desde` es distinto de `hasta`.
- `lotes` no puede estar vacío y `fecha` tiene la forma `AAAA-MM`.
- `calzada` puede ser `"empedrado"` o `"asfalto"`, y se carga en `calzadas[calle]`.

- [ ] **Step 1: Write the failing tests** en `tests/mapgen/frentes-input.test.ts`.

```ts
const IDS = ['banco-nacion', 'galicia'];
const base = (lotes: unknown[], extra: object = {}) => ({ calles: [{ calle: 'Esteban Adrogué', frentes: [
  { id: 'f1', desde: 'A', hasta: 'B', vereda: 'sur', fecha: '2024-03', lotes, ...extra }] }] });

test('completa los valores por defecto', () => {
  const l = validateFrentes(base([{ ancho: 8, pisos: 1, color: '#ffffff' }]), 'x', IDS).frentes[0].lotes[0];
  expect(l).toMatchObject({ fondo: 15, retiro: 0, pb: 'vidriera', arriba: 'ventanas', material: 'revoque', puerta: 'inicio' });
});
test('usa: el estilo se mezcla y el lote manda', () => {
  const d = { estilos: { c: { pisos: 1, pb: 'puerta', color: '#eeeeee' } }, ...base([{ usa: 'c', ancho: 9, color: '#111111' }]) };
  expect(validateFrentes(d, 'x', IDS).frentes[0].lotes[0]).toMatchObject({ pisos: 1, pb: 'puerta', color: '#111111', ancho: 9 });
});
test.each([
  [[{ ancho: 8, pisos: 1, colour: '#fff' }], /frente f1, lote 1: campo desconocido "colour"/],
  [[{ ancho: 8, pisos: 1, color: 'rojo' }], /frente f1, lote 1: color tiene que ser #rrggbb/],
  [[{ ancho: 8, pisos: 1, color: '#ffffff', pb: 'local' }], /lote 1: pb tiene que ser uno de vidriera, persiana, porton, puerta, banco, acceso, pared/],
  [[{ ancho: 8, pisos: 0, cartel: { texto: 'X', fondo: '#000000', letra: '#ffffff' } }], /lote 1: un lote sin edificio \(pisos 0\) no lleva cartel/],
  [[{ ancho: 8, pisos: 1, color: '#ffffff', lugar: 'galicia' }], /lote 1: un lote con lugar necesita cartel/],
  [[{ ancho: 8, pisos: 1, color: '#ffffff', usa: 'nada' }], /lote 1: no existe el estilo "nada"/],
  [[{ ancho: 8, pisos: 1, color: '#ffffff', cartel: { texto: 'X', fondo: '#000000', letra: '#ffffff' }, lugar: 'mcdonalds' }], /lote 1: no existe el lugar "mcdonalds"/],
])('error claro %#', (lotes, re) => expect(() => validateFrentes(base(lotes), 'x', IDS)).toThrow(re));
test('un lugar en dos lotes', () => { /* dos lotes con lugar 'galicia' → /lote 2: el lugar "galicia" ya está en el frente f1, lote 1/ */ });
test('fecha AAAA-MM y frentes con id repetido', () => { /* fecha '03/2024' → /frente f1: fecha tiene que ser AAAA-MM/; ids repetidos → /frente f1: id repetido/ */ });
test('data/frentes.json y el fixture de prueba son válidos', () => {
  expect(() => loadFrentes()).not.toThrow();
  expect(() => loadFrentes('tests/fixtures/frentes-prueba.json')).not.toThrow();
});
```

- [ ] **Step 2: Run** `npx vitest run tests/mapgen/frentes-input.test.ts`. **Expected:** FAIL, porque no existe `frentes-input.ts`.

- [ ] **Step 3: Implement.**
  - Agregar los tipos de mapdata.
  - Mover `SIGN_H` y `SIGN_D` a `shared/mapdata.ts` y dejar el re-export en `signs.ts`.
  - Agregar `signs: []` en el `MapData` de `assembleMap`.
  - Agregar `signs: []` en los `MapData` literales de los tests hasta que `npm run typecheck` pase.
  - Escribir `validateFrentes` y `loadFrentes`.
  - Crear `data/frentes.json` como `{ "estilos": {}, "calles": [ { "calle": "Esteban Adrogué", "calzada": "empedrado", "frentes": [] } ] }`.
  - Crear `tests/fixtures/frentes-prueba.json`:
    - **Frente.** Uno solo, `ea-prueba`: Esteban Adrogué, desde `Bartolomé Mitre`, hasta `Pellerano`, vereda `sur`.
    - **Nota.** Cada lote lleva `"nota": "inventado para tests"`.
    - **Lotes enlazados por `lugar`:** `banco-nacion` y `galicia`.
    - **Lote con cartel "LUCCIANO'S" y sin `lugar`.** Prueba el enlace automático.
    - **Lote con `"osm": "Farrnacia Central"` y cartel "FARMACIA CENTRAL".**
    - **Lotes con cartel `SUPERVIELLE` y `BONAFIDE`.**
    - **Relleno.** Lotes sin cartel con distintos `pb`, `arriba` y `pisos` (1 a 5), uno con `pisos` 0 y uno con `toldo`.
    - **Anchos.** Los ajusta la Tarea 2: en este paso, que sumen alrededor de 175 m.

- [ ] **Step 4: Run** `npx vitest run tests/mapgen/frentes-input.test.ts && npm run typecheck`. **Expected:** PASS.

- [ ] **Step 5:** Correr `npm run build:map`. Tiene que salir sin warnings fatales y el JSON tiene que traer `"signs":[]`. Commitear: `feat(mapgen): contrato y archivo de frentes reales`.

---

### Task 2: Línea de edificación de un frente

**Files:**
- Modify: `src/mapgen/osm.ts` (exportar `offsetLine` y `bufferLine`)
- Create: `src/mapgen/frontage.ts`
- Test: `tests/mapgen/frontage.test.ts`

**Interfaces:**
- Consumes: `FrenteInput` (Tarea 1), `Road` y `offsetLine` / `bufferLine` (`osm.ts`).
- Produces, en `src/mapgen/frontage.ts`:
  ```ts
  export interface Frontage {
    id: string;
    line: Vec2[];          // línea de edificación de `desde` a `hasta`, recortada en las esquinas
    length: number;
    inward: 1 | -1;        // offsetLine(line, inward * d), con d > 0, entra en la manzana
    setback: number;       // del eje de la calle a la línea: width/2 + sidewalk
    ext: Vec2[];           // `line` estirada 20 m por cada punta (para los lotes de esquina)
    corners: [Vec2[][], Vec2[][]]; // corredores (calzada + veredas) que recortan la punta de `desde` y la de `hasta`
  }
  export function streetChain(roads: Road[], name: string): Vec2[];
  export function resolveFrontage(roads: Road[], f: Pick<FrenteInput, 'id' | 'calle' | 'desde' | 'hasta' | 'vereda'>): Frontage;
  export const vehicular: (r: Road) => boolean; // kind distinto de footway, pedestrian y service
  ```

**Algoritmo de `resolveFrontage`.** Cada error es un `Error` que empieza con `frente ${id}: `.
1. **Cadena de la calle.** `streetChain` une las vías vehiculares de nombre `calle` que comparten un extremo (las da vuelta si hace falta) en una sola polilínea. Errores posibles:
   - no hay ninguna vía: `no hay ninguna calle "X"`;
   - quedan pedazos sin unir: `la calle "X" tiene tramos que no se tocan`.
2. **Cruces.** Se buscan todos los cruces entre la cadena y los segmentos de las calles de nombre `desde` y de nombre `hasta`, cada uno con su posición `s` a lo largo de la cadena.
   - Si una de las dos no cruza: `"Pellerano" no cruza "Esteban Adrogué"`.
   - Se elige el par `(sA, sB)` con `|sA − sB|` mínimo y mayor que 0.
3. **Tramo.** Se toma la sub-cadena entre `sA` y `sB`, orientada de `desde` a `hasta`, y se la estira 20 m por cada punta siguiendo la cadena, o la tangente si la cadena se termina.
4. **Vereda.**
   - `setback` = `width/2 + sidewalk` de la vía de la calle.
   - Se calculan los dos candidatos `offsetLine(tramo, ±setback)` y se elige el que tenga mayor `promedio(punto)·brújula`, donde la brújula es: norte (0, −1), sur (0, 1), este (1, 0), oeste (−1, 0). `inward` es el signo del desplazamiento elegido.
   - Error si la diferencia entre los dos candidatos, proyectada en la brújula, mide menos de 0,3 × 2·setback: `la vereda "este" no es clara para esta calle; usá norte o sur`.
5. **Esquinas.**
   - `corners[0]` son los `bufferLine(r.points, r.width/2 + r.sidewalk)` de cada vía vehicular de **cualquier** nombre, menos la calle propia, que corte la línea estirada en sus primeros 40 m. `corners[1]` es lo mismo para los últimos 40 m.
   - Se usa cualquier nombre porque en una esquina pueden cruzarse dos calles, como Mitre y Somellera.
   - Se muestrea la línea estirada cada 0,05 m. El frente empieza después de la última muestra que cae dentro de `corners[0]` y termina antes de la primera muestra que cae dentro de `corners[1]`.
   - Error si no queda nada entre las dos: `el frente queda entero dentro de la esquina`.
6. **Resultado.**
   - `line` es el tramo entre esos dos puntos, con los vértices intermedios de la cadena. `length` es su largo.
   - Cada punto de corte se refina por bisección entre la última muestra de adentro y la primera de afuera, hasta 1 mm.
   - `ext` es `line` estirada exactamente 20 m por cada punta sobre la misma línea desplazada del paso 4. Así, la posición `s` de `line` es la `s + 20` de `ext`.

- [ ] **Step 1: Write the failing tests.** Las calles sintéticas se arman con `ROAD_SPECS`.
  - **Calles de prueba:**
    - "A" es tertiary, de (−100, 0) a (100, 0);
    - "B" es residential, de (−50, −60) a (−50, 60);
    - "C" es residential, de (50, −60) a (50, 60).

```ts
test('frente recto, vereda norte: línea en z = −8 entre las líneas de edificación de B y C', () => {
  const f = resolveFrontage(roads, { id: 't', calle: 'A', desde: 'B', hasta: 'C', vereda: 'norte' });
  expect(f.inward).toBe(-1);
  expect(f.setback).toBe(8);
  expect(f.line[0][0]).toBeCloseTo(-43, 1);              // −50 + 4 + 3
  expect(f.line.at(-1)![0]).toBeCloseTo(43, 1);
  f.line.forEach(([, z]) => expect(z).toBeCloseTo(-8, 6));
  expect(f.length).toBeCloseTo(86, 1);
});
test('vereda sur e invertido (desde C hasta B): va de este a oeste por z = +8', () => { /* inward = 1; line[0][0] ≈ 43 */ });
test('esquina oblicua a 60°: la punta queda sobre la línea de edificación de la transversal', () => {
  /* C pasa a ir de (50 − 60·cos60°, −60·sin60°) a (50 + 60·cos60°, 60·sin60°); la distancia del extremo de line al eje
     de C es 7 ± 0,06 */
});
test('errores claros', () => {
  expect(() => resolveFrontage(roads, { id: 't', calle: 'Z', desde: 'B', hasta: 'C', vereda: 'sur' })).toThrow('frente t: no hay ninguna calle "Z"');
  expect(() => resolveFrontage(roads, { id: 't', calle: 'A', desde: 'B', hasta: 'D', vereda: 'sur' })).toThrow('frente t: "D" no cruza "A"');
  expect(() => resolveFrontage(roads, { id: 't', calle: 'A', desde: 'B', hasta: 'C', vereda: 'este' })).toThrow(/la vereda "este" no es clara/);
});
test('datos reales: EA de Pellerano a Benigno Macías, vereda norte, mide entre 55 y 80 m', () => { /* parseOsm(data/raw/osm.json).roads */ });
test('datos reales: EA de Bartolomé Mitre a Pellerano resuelve igual que de Somellera a Pellerano', () => { /* misma línea ± 0,1 m */ });
```

- [ ] **Step 2: Run** `npx vitest run tests/mapgen/frontage.test.ts`. **Expected:** FAIL.
- [ ] **Step 3: Implement** `frontage.ts` y exportar `offsetLine` y `bufferLine` de `osm.ts` (sin cambiar lo que hacen).
- [ ] **Step 4: Run** `npx vitest run tests/mapgen/frontage.test.ts tests/mapgen/osm.test.ts`. **Expected:** PASS.
- [ ] **Step 5:** Con `resolveFrontage` sobre los datos reales, ajustar los anchos de `tests/fixtures/frentes-prueba.json` para que sumen el largo de `ea-prueba` ± 2 %. Commitear: `feat(mapgen): línea de edificación de un frente`.

---

### Task 3: Lotes sobre el frente

**Files:**
- Create: `src/mapgen/lots.ts`
- Modify: `src/mapgen/buildings.ts` (exportar `MIN_AREA`)
- Test: `tests/mapgen/lots.test.ts`

**Interfaces:**
- Consumes: `Frontage`, `vehicular` (Tarea 2), `LoteInput` y `FrenteInput` (Tarea 1), `heightFor` y `MIN_AREA` (`buildings.ts`), `SIGN_H` (mapdata).
- Produces:
  ```ts
  export const MAX_DESVIO = 0.10;
  export const LOT_SIGN = { frenteY: 2.35, banderaY: 2.6, banderaAncho: 1.2, margen: 0.4, offset: 0.08 } as const;
  export interface LotShape {
    id: string;              // `${frente.id}-${k}`, con k desde 1
    lote: LoteInput;
    front: Vec2[];           // la fachada: el tramo del lote sobre la línea de edificación, corrido `retiro`; de desde a hasta
    cornerRings: Vec2[][];   // corredores contra los que se recortó (solo en el primer y el último lote)
    footprint: Vec2[] | null;  // antihorario; null si pisos = 0
    claim: Vec2[][];         // lo que se le saca a los edificios de Microsoft: del eje de la calle al fondo del lote
  }
  export function layoutLots(f: FrenteInput, fr: Frontage, roads: Road[]): LotShape[];
  export function carveLots(buildings: Building[], claims: Vec2[][]): Building[];
  export function lotBuilding(l: LotShape): Building | null;  // front con edges y corner vacíos (los llena la Tarea 4)
  export function lotSign(l: LotShape, height: number): Sign | null;
  export function frontEdgesOf(footprint: Vec2[], line: Vec2[], tol?: number /* 0.15 */): number[];
  ```

**`layoutLots`:**
1. **Calibración.**
   - `suma` = Σ `ancho`.
   - Si `|suma − L| > MAX_DESVIO·L`, error: `frente ${id}: los anchos suman ${suma} m pero el frente mide ${L} m (${±p} %). ¿Falta o sobra un lote?`. Los números van con coma decimal y un decimal.
   - Si no, cada ancho se escala por `L/suma`.
   - El lote k ocupa `[S_k, S_{k+1}]` sobre `fr.line`, donde `S` es el acumulado escalado.
2. **Tramo de cada lote.**
   - Se toma la sub-polilínea `F` de `[S_k, S_{k+1}]`.
   - El primer lote toma `F` desde `fr.ext`, empezando 20 m antes. El último la toma hasta 20 m después. Así el recorte del paso 4 los deja siguiendo la línea de la transversal.
3. **Polígonos.**
   - Fachada: `front = offsetLine(F, inward·retiro)`.
   - Edificio: `[...front, ...offsetLine(F, inward·(retiro+fondo)).reverse()]`.
   - Claim: `[...offsetLine(F, −inward·setback), ...offsetLine(F, inward·(retiro+fondo)).reverse()]`.
4. **Recorte.**
   - Al edificio y al claim se les resta, con `polygon-clipping`:
     - los polígonos de `fr.corners[0]` y `fr.corners[1]`, más los corredores de **todas** las calles vehiculares cercanas de `roads` (`bufferLine`, media anchura `width/2 + sidewalk`);
     - y, solo al edificio, la unión de los edificios de los lotes anteriores del mismo frente.
   - Del edificio queda la pieza más grande. Si mide menos de 4 m², error: `frente ${id}, lote ${k}: el lote quedó demasiado chico (${a} m²)`.
   - `front` y `cornerRings` se recalculan sobre lo que quedó:
     - `front` es la parte de `offsetLine(F, inward·retiro)` que sigue tocando el polígono;
     - `cornerRings` son los corredores cuyo borde toca el polígono.
5. **`pisos` 0.** El lote no tiene `footprint`, pero sí tiene `claim`.

**`lotBuilding`:**
- `{ id, footprint, height: heightFor(pisos), floors: pisos, tint: color, front: {...} }`.
- `kind`: `apartments` si `pisos` ≥ 3, `house` si `pb` es `puerta`, `shop` en los demás casos.
- `wall`: `brick` si `material` es `ladrillo`, `plaster` si no.
- `front.ladrillo`: true si `material` es `ladrillo`.

**`lotSign`.** La normal es la exterior de `front` en el punto medio por largo. El ancho por defecto es `largo(front) − margen`, con tope en `largo − 0,2` y piso en 1 m. Según `posicion`:

| Posición | Ancla | `bottomY` | Otros |
|---|---|---|---|
| `frente` | punto medio de `front` + normal·`offset` | `frenteY` | — |
| `alto` | igual que `frente` | `max(frenteY, height − SIGN_H − 0,1)` | — |
| `bandera` | el punto a 0,5 m del inicio de `front`, más normal·(`ancho`/2 + 0,1) | `banderaY` | `normal` = tangente de `front` hacia `hasta`; ancho por defecto `banderaAncho`; `blade: true` |

`look` = `{ fondo, letra, marco: marco ?? fondo, fuente, cursiva? }`.

**`carveLots`:**
- A cada edificio que toca algún claim se le resta la unión de los claims.
- Se descartan las piezas de menos de `MIN_AREA` (12 m²).
- Las piezas se ordenan por área de mayor a menor: la más grande conserva el `id` y el resto recibe `${id}-2`, `${id}-3` y así.
- Las piezas heredan `floors`, `height`, `kind`, `wall` y `tint`.

**`frontEdgesOf`:**
- Devuelve las aristas cuyos dos extremos quedan a `tol` o menos de la polilínea `line`.
- Las ordena por la posición de su punto medio a lo largo de `line`.

- [ ] **Step 1: Write the failing tests.** Usan un `Frontage` sintético: una recta de (0, 0) a (100, 0), `inward` 1, `setback` 8, `corners` vacíos y `roads` vacío, salvo donde se indica otra cosa.

```ts
test('reparte el frente en proporción a los anchos', () => { /* 30/30/40 → largos de front 30/30/40 ± 0,01 */ });
test('escala si la suma difiere hasta 10 %', () => { /* 95 m de anchos → cada uno × 100/95 */ });
test('error si difiere más de 10 %', () =>
  expect(() => layoutLots(frente([{ ancho: 80 }]), recta, [])).toThrow('frente t: los anchos suman 80,0 m pero el frente mide 100,0 m (−20,0 %). ¿Falta o sobra un lote?'));
test('fondo y retiro', () => { /* retiro 3, fondo 12: footprint entre z = 3 y z = 15; claim entre z = −8 y z = 15 */ });
test('pisos 0: sin edificio, con claim', () => { /* footprint null; claim no vacío y cubre de z = −8 a z = 15 */ });
test('esquina oblicua: el primer lote sigue la transversal y no la pisa', () => {
  /* corners[0] = corredor de una calle a 60°; área(intersección(footprint, corredor)) < 0,01 y alguna arista del
     footprint sobre el borde del corredor (frontEdgesOf con el anillo cerrado) */
});
test('curva de 20°: los lotes vecinos no se superponen', () => { /* área(intersección) < 0,01 m² para cada par */ });
test('ningún lote pisa la calzada ni la vereda de una calle vehicular que cruza la manzana', () => {
  /* roads = [residential de (50, −20) a (50, 60)]: área(intersección(footprint, bufferLine(·, 7))) < 0,01 para todo lote */
});
test('lotSign: frente, alto y bandera', () => {
  /* frente: bottomY 2.35, width = largo − 0.4; alto con pisos 3: bottomY ≈ 10.2 − 0.9 − 0.1 = 9.2;
     bandera: blade true, normal = [1, 0], width 1.2, ancla a 0.7 de la línea, bottomY 2.6 */
});
test('carveLots: recorta, conserva el id de la pieza mayor, numera el resto y tira las de menos de 12 m²', () => {
  /* b0001 de 40 × 20; un claim de 10 m de ancho en el medio → b0001 (área 300 ± 0,5) y b0001-2 (área 300 ± 0,5, empate:
     la de menor x primero); un claim que deja una franja de 2 × 5 → esa franja no aparece */
});
test('frontEdgesOf: encuentra la arista del frente con 4 mm de error y no las de los costados', () => {
  /* rectángulo [[0,0.004],[10,0],[10,15],[0,15]] con line [[0,0],[10,0]] → [0]; con tol 0.001 → [] */
});
```

- [ ] **Step 2: Run** `npx vitest run tests/mapgen/lots.test.ts`. **Expected:** FAIL.
- [ ] **Step 3: Implement** `lots.ts`.
- [ ] **Step 4: Run** el mismo comando. **Expected:** PASS.
- [ ] **Step 5: Commit** `feat(mapgen): lotes de un frente, recorte y carteles`.

---

### Task 4: Armado del mapa con los frentes

**Files:**
- Create: `src/mapgen/frentes.ts`
- Modify: `src/mapgen/osm.ts` (`pois`), `src/mapgen/places.ts` (`fixed`), `src/mapgen/place-facades.ts`, `src/mapgen/assemble.ts`, `tools/build-map.ts`, `tests/mapgen/assemble.test.ts`
- Test: `tests/mapgen/frentes.test.ts`, `tests/mapgen/assemble.test.ts`

**Interfaces:**
- Consumes: las Tareas 1 a 3, y `normalizeName` (`places.ts`).
- Produces:
  ```ts
  // osm.ts — OsmFeatures suma pois: nodos y vías con name y alguna de shop | amenity | office | craft
  export interface OsmPoi { id: string; name: string; position: Vec2 } // id `n123` / `w456`; vía → promedio de sus nodos
  // places.ts
  export function matchPlaces(input, buildings, parks, roads,
    fixed?: Map<string, { buildingId: string; sign: Sign }>): { places; buildings; warnings }; // fixed: no busca edificio ni cartel, y no aplica floors/tint/wall de places.json
  // frentes.ts
  export interface FrentesResult {
    buildings: Building[];   // Microsoft recortados + lotes
    fixed: Map<string, { buildingId: string; sign: Sign }>;
    signs: Sign[];           // carteles de los lotes que no son de un lugar
    fronts: Map<string, { front: Vec2[]; cornerRings: Vec2[][] }>; // por id de lote, para las aristas después del redondeo
    warnings: string[];
    report: string[];        // informativo: distancia de cada lote enlazado a su punto de OSM o del lugar
  }
  export function applyFrentes(input: FrentesInput, roads: Road[], buildings: Building[], places: PlaceInput[], pois: OsmPoi[]): FrentesResult;
  export function onFace(p: Vec2, fr: Frontage, roads: Road[]): boolean;
  // assemble.ts — raw suma frentes?: FrentesInput; PhotoEdge (place-facades.ts) suma widthM?: number; heightM?: number
  ```

**`onFace`.** Un punto cae sobre un frente si se cumplen las tres condiciones:
- su proyección sobre `fr.line` queda dentro de `[0, length]`;
- su distancia hacia adentro desde la línea (positiva hacia `inward`) queda en `[−6, 25]`;
- la calle con nombre cuyo eje le queda más cerca es la del frente.

**Enlace de lugares.** `fixed` lleva `buildingId` = id del lote y `sign` = `lotSign`.
- **Enlace explícito.** Si el lote tiene `lugar`, ese lugar se enlaza con el lote.
- **Enlace automático.** Aplica a los lugares que no son plaza ni monumento, no tienen enlace explícito y caen sobre un frente (`onFace`). Se buscan los lotes de ese frente cuyo `cartel.texto` se parece al `name` o al `signText` del lugar, con `nameMatch`:
  - `nameMatch(a, b)`: un nombre normalizado contiene al otro, y el más corto tiene al menos 3 caracteres;
  - si hay uno solo, se enlaza;
  - si no hay ninguno: `${place.id}: cae sobre el frente ${f} y ningún lote lo nombra; agregá "lugar": "${place.id}" al lote que corresponde`;
  - si hay varios: `${place.id}: en el frente ${f} lo nombran los lotes ${ids}; dejá "lugar" en uno solo`.
- **Locales de OSM.** Cada POI que cae sobre un frente tiene que quedar cubierto de alguna de estas formas:
  - un lote con `osm` igual a su nombre;
  - un lote cuyo cartel tenga `nameMatch` con su nombre;
  - su nombre en `osmAusentes`.

  Si no: `${f}: el local de OSM "${name}" no está en ningún lote; si ya no existe, agregalo a "osmAusentes"`. Un nombre de `osmAusentes` que no corresponde a ningún POI del frente también es un warning: `${f}: "${name}" de osmAusentes no es un local de OSM sobre este frente`.
- **Edificios.** `buildings` es `carveLots(edificios, todos los claims)` más los `lotBuilding`. Los carteles de los lotes sin lugar van a `signs`.

**Orden en `assembleMap`.**
- `parseOsm` → `buildBuildings` → `applyFrentes` → `matchPlaces(…, fr.buildings, …, fr.fixed)`. Desde ahí sigue todo como estaba.
- Después del redondeo de las plantas, a cada lote se le llena `front.edges = frontEdgesOf(footprint, ring(front))`, y `front.corner` con los anillos de `cornerRings`. Si `edges` queda vacío, warning: `${id}: el frente no coincide con ninguna arista`.
- `map.signs` es `fr.signs` redondeado como los carteles de los lugares.
- `placeFacades` saltea los edificios con `front`.
- **Fotos de lugares enlazados a un lote.**
  - Si tienen `edgeIndex`: `${placeId}: la foto de un lugar con lote va a la arista del cartel (sacale edgeIndex)`.
  - Si `heightM` > altura del lote + 0,5: `${placeId}: la foto mide ${heightM} m y el lote ${h} m`.
  - Si `widthM` > largo del frente + 1: `${placeId}: la foto mide ${widthM} m de ancho y el frente del lote ${l} m`.
- **`tools/build-map.ts`.**
  - Pasa `frentes: loadFrentes()` y las fotos completas.
  - Imprime `frentes: N, lotes: M, carteles de lotes: K` y las líneas de `report`.
- **`loadRaw()` de `assemble.test.ts`.** Suma `frentes: loadFrentes()`.

- [ ] **Step 1: Write the failing tests.**
  - **Unitarios** en `tests/mapgen/frentes.test.ts`. El mundo es sintético: las calles A, B y C de la Tarea 2, un bloque de Microsoft de 80 × 40 detrás de la vereda norte de A, lugares y POIs.

```ts
test('lugar con "lugar": usa el lote y su cartel', () => { /* fixed.get('p1') = { buildingId: 't-2', sign.look.fondo = cartel.fondo } */ });
test('enlace automático por nombre y cercanía', () => { /* lugar "Lucciano's" a 10 m de la línea, lote con cartel "LUCCIANO'S" → fixed lo tiene */ });
test('lugar sobre el frente sin lote que lo nombre: aviso con la instrucción', () =>
  expect(r.warnings).toContain('p9: cae sobre el frente t y ningún lote lo nombra; agregá "lugar": "p9" al lote que corresponde'));
test('un lugar más cerca de la transversal no cuenta como del frente', () => { /* lugar a 2 m del eje de C y a 20 m del de A → sin aviso */ });
test('OSM: cubierto por osm, por nombre o por osmAusentes; si no, aviso', () => {
  /* POIs "Farrnacia Central" (lote con osm), "Bonafide" (cartel BONAFIDE), "Subway" (osmAusentes) → sin aviso;
     "Prato" sin nada → 't: el local de OSM "Prato" no está en ningún lote; si ya no existe, agregalo a "osmAusentes"' */
});
test('osmAusentes que no está en OSM: aviso', () => { /* osmAusentes ["Kiosco X"] → 't: "Kiosco X" de osmAusentes no es un local de OSM sobre este frente' */ });
test('los edificios de Microsoft pierden lo que quedó bajo los lotes', () => { /* área(intersección) < 0,01 para todo par lote × resto */ });
test('carteles de lotes sin lugar van a signs', () => { /* 3 lotes con cartel, 1 con lugar → signs.length 2, con look */ });
```

  - **Sobre datos reales** en `assemble.test.ts`: un `describe('assembleMap con el frente de prueba')` que corre `assembleMap({ ...loadRaw(), frentes: loadFrentes('tests/fixtures/frentes-prueba.json') })` y verifica:
    - no hay warnings fatales;
    - `banco-nacion`, `galicia` y `luccianos` tienen un `buildingId` que empieza con `ea-prueba-` y un `sign.look`;
    - cada lote tiene `front.edges` no vacío;
    - ningún lote se superpone con otro edificio en más de 0,05 m²;
    - pasan `roadPointsInsideBuildings`, el acceso de cada cluster de techos (`hasAccess`), los huecos con salida y que los spawns vean el cartel, con los helpers que ya tiene el archivo;
    - `map.signs.length` = cantidad de lotes con cartel y sin lugar.

- [ ] **Step 2: Run** `npx vitest run tests/mapgen/frentes.test.ts tests/mapgen/assemble.test.ts`. **Expected:** FAIL.
- [ ] **Step 3: Implement.** Hacer los cambios de `osm.ts`, `places.ts`, `place-facades.ts`, `frentes.ts`, `assemble.ts` y `build-map.ts`.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck`. **Expected:** PASS. Con `data/frentes.json` sin frentes, el mapa real no cambia salvo por `signs` y el orden de las claves.
- [ ] **Step 5:** Correr `npm run build:map` y commitear: `feat(mapgen): lotes relevados en el mapa, enlazados a lugares y a OSM`.

---

### Task 5: Empedrado

**Files:**
- Modify: `src/mapgen/osm.ts`, `src/mapgen/assemble.ts`, `src/client/world/types.ts`, `src/client/world/materials.ts`, `src/client/world/chunks.ts`, `data/textures.json`
- Create: `public/textures/empedrado_{diff,nor_gl,rough}.jpg` (con `npm run fetch:textures`)
- Test: `tests/mapgen/osm.test.ts`, `tests/mapgen/assemble.test.ts`, `tests/client/materials.test.ts`, `tests/client/geometry.test.ts` (ahí están los tests de `buildChunks`)

**Interfaces:**
- Produces:
  - `Road.surface = 'sett'`: lo pone `parseOsm` cuando `surface` es `sett`, `cobblestone` o `unhewn_cobblestone`. `assembleMap` lo pone o lo saca para las calles de `frentes.calzadas` (`empedrado` → `'sett'`, `asfalto` → sin `surface`).
  - `WorldMaterials` suma `cobble`. Es `material('empedrado', offset(−2))` con `repeat` (2, 2) en sus tres mapas, o sea una baldosa cada 2 m.
  - `SLOTS` suma `'empedrado'`.
  - `data/textures.json` suma `{ "slot": "empedrado", "assetId": "cobblestone_floor_08", "license": "CC0", "url": "https://polyhaven.com/a/cobblestone_floor_08" }`.
  - `chunks.ts`: las vías vehiculares con `surface === 'sett'` van a `cobble`, a la misma altura `Y_ASPHALT`. Las footway y pedestrian siguen como están.

- [ ] **Step 1: Write the failing tests.**
  - `parseOsm` marca `sett` en una vía `surface=sett` y no en una `paving_stones`.
  - Sobre datos reales: la vía `w28314572` sale con `surface: 'sett'` porque así lo dice `data/frentes.json`. Aparte de EA, se cuentan las vías con `sett` que no son footway ni pedestrian. El test fija como piso la cantidad medida y el informe la anota.
  - `createMaterials` devuelve `cobble` y `disposeMaterials` libera sus texturas.
  - En chunks, una calle con `sett` genera una malla `cobble` y ninguna `asphalt`.
- [ ] **Step 2: Run** `npx vitest run tests/mapgen/osm.test.ts tests/client/materials.test.ts tests/client/geometry.test.ts`. **Expected:** FAIL.
- [ ] **Step 3: Implement.**
  - Bajar la textura con `npm run fetch:textures`.
  - Verificar el aspecto con `npx playwright test e2e/tour.spec.ts`: mirar `test-results/tour`, donde el empedrado debería verse gris, en hileras y sin costuras.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck`. **Expected:** PASS. Después correr `npm run build:map`.
- [ ] **Step 5: Commit** `feat: calles de empedrado (OSM sett/cobblestone y Esteban Adrogué)` con las tres jpg.

---

### Task 6: Atlas de módulos de fachada

**Files:**
- Create: `src/client/world/front-atlas.ts`
- Modify: `src/client/world/types.ts` (`front`), `src/client/world/materials.ts`
- Test: `tests/client/front-atlas.test.ts`, `tests/client/materials.test.ts`

**Interfaces:**
- Consumes: `PlantaBaja` y `Arriba` (mapdata), `BAY_W` y `FLOOR_H` (`geometry.ts`), los ayudantes de dibujo de `facades.ts` (exportar `glass`, `frame`, `bars` y `shutter`).
- Produces:
  ```ts
  export const FRONT_CELLS = ['vidriera', 'vidriera-puerta', 'persiana', 'porton', 'puerta', 'ventana-pb', 'banco', 'banco-puerta',
    'acceso', 'pared-pb', 'ventana', 'balcon', 'vidriado', 'pared', 'porton-l', 'puerta-l', 'ventana-pb-l', 'pared-pb-l',
    'ventana-l', 'balcon-l', 'pared-l', 'toldo', 'toldo-rayas'] as const;
  export type FrontCell = (typeof FRONT_CELLS)[number];
  export const ATLAS_COLS = 5;   // 5 × 5 celdas cuadradas; cada una representa 3 m × 3,2 m
  export const GUTTER = 4;       // px de margen por lado, rellenados estirando el borde (contra el sangrado de los mipmaps)
  export function cellRect(c: FrontCell): { u0: number; v0: number; u1: number; v1: number }; // UV sin el margen; v = 0 abajo
  export function groundCells(pb: PlantaBaja, ladrillo: boolean): { door: FrontCell; rest: FrontCell };
  export function upperCell(arriba: Arriba, ladrillo: boolean): FrontCell;
  export function composeFrontAtlas(img: { revoque: CanvasImageSource; ladrillo: CanvasImageSource; metal: CanvasImageSource;
    madera: CanvasImageSource }, size: number): { color: HTMLCanvasElement; mask: HTMLCanvasElement };
  export function packAtlas(color: Uint8ClampedArray, mask: Uint8ClampedArray, size: number): Uint8Array; // RGBA, filas de abajo arriba, A = R de mask
  export function frontMaterial(map: THREE.Texture, lambert: boolean): THREE.Material;
  ```

**Planta baja por `pb`.** Primero va la celda de la bahía de la puerta y después la del resto:

| `pb` | puerta | resto |
|---|---|---|
| vidriera | vidriera-puerta | vidriera |
| persiana | persiana | persiana |
| porton | porton | ventana-pb |
| puerta | puerta | ventana-pb |
| banco | banco-puerta | banco |
| acceso | acceso | vidriera |
| pared | pared-pb | pared-pb |

**Pisos de arriba:** ventanas → `ventana`, balcones → `balcon`, vidriado → `vidriado`, ciego → `pared`.

**Ladrillo.** Con `ladrillo` se usa la variante `-l` cuando existe.

**Máscara.**
- 255 = pared pintada: se multiplica por el color del vértice. 0 = se queda con su color: vidrio, metal, madera, marcos y ladrillo.
- Lo pintado se aclara a una luminancia media de 0,9 sobre `revoque`, para que el color del vértice se lea casi tal cual.
- Las celdas de planta baja dejan una banda de dintel entre 2,4 y 3,2 m, donde va el cartel `frente`.
- Las celdas `toldo` y `toldo-rayas` son tela. La máscara es 255 en la tela lisa y en las rayas de color, y 0 en las rayas blancas, que miden 0,25 m.

**Material.**
- `frontMaterial` es `MeshLambertMaterial` en baja y `MeshStandardMaterial` en el resto, con roughness 0,85, metalness 0, `vertexColors: true` y sin mapa de normales.
- `onBeforeCompile` reemplaza `#include <color_fragment>` por:

  ```glsl
  diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, sampledDiffuseColor.a );
  diffuseColor.a = opacity;
  ```

- `customProgramCacheKey` devuelve `'front-mask'`.

**En `createMaterials`.**
- El atlas mide `2 × textureSize` de lado.
- Se arma con `THREE.DataTexture(packAtlas(...), size, size, THREE.RGBAFormat)`, con `colorSpace` sRGB, mipmaps, `LinearMipmapLinearFilter` y `anisotropy` según la calidad.
- `disposeMaterials` libera el material y la textura una sola vez.

- [ ] **Step 1: Write the failing tests.**
  - `cellRect`:
    - las 23 celdas no se pisan y quedan dentro de [0, 1];
    - el margen mide `GUTTER/size` de cada lado;
    - la celda 0 (arriba a la izquierda en el canvas) tiene `v1 ≈ 1`.
  - `groundCells` cumple la tabla, incluido el ladrillo.
  - `packAtlas`: con un color de 2 × 2 y una máscara conocida, el píxel de arriba a la izquierda del canvas sale en la última fila y A es la R de la máscara.
  - `frontMaterial`: aplicado a `{ fragmentShader: '…#include <color_fragment>…', vertexShader: '' }`, el shader resultante contiene `sampledDiffuseColor.a` y no contiene `#include <color_fragment>`.
  - `createMaterials('media')` devuelve `front` con un mapa de 2048 × 2048, y `disposeMaterials` lo libera (espiar `dispose`).
- [ ] **Step 2: Run** `npx vitest run tests/client/front-atlas.test.ts tests/client/materials.test.ts`. **Expected:** FAIL.
- [ ] **Step 3: Implement.** Agregar `front-atlas.ts`, la clave `front` y los exports de `facades.ts`.
- [ ] **Step 4: Run** el mismo comando y `npm run typecheck`. **Expected:** PASS.
- [ ] **Step 5: Commit** `feat(client): atlas de módulos de fachada con máscara de pintura`.

---

### Task 7: Geometría de los frentes

**Files:**
- Create: `src/client/world/fronts.ts`
- Modify: `src/client/world/geometry.ts`, `src/client/world/chunks.ts`
- Test: `tests/client/fronts.test.ts`, `tests/client/geometry.test.ts` (incluye `buildChunks`)

**Interfaces:**
- Consumes: `Front` (mapdata), `cellRect`, `groundCells` y `upperCell` (Tarea 6), `FLOOR_H` y `BAY_W` (`geometry.ts`).
- Produces:
  ```ts
  // fronts.ts
  export const AWNING = { topY: 2.3, bottomY: 2.0, depth: 1.0, inset: 0.2 } as const;
  export function frontGeometry(bd: Building, fp: Vec2[], edgeOf: (e: number) => number): THREE.BufferGeometry;
  // fp: la planta antihoraria que usa extrudeBuilding; edgeOf: índice guardado → índice en fp (vuelta CW de extrudeBuilding)
  // geometry.ts: extrudeBuilding devuelve también walls.front (vacía si no hay bd.front); las aristas de front.edges y
  // front.corner no van en ground ni en upper
  ```
- `chunks.ts`:
  - `walls.front` va a `front`.
  - En los edificios con `front`, `walls.ground` y `walls.upper` (medianeras y fondos) van a `parapet`, que es revoque liso teñido y sin ventanas.
  - `front` entra en `SHADOW_CASTERS`.

**`frontGeometry`.** Los atributos son `position`, `normal`, `uv` y `color`, los mismos que los demás muros, para poder hacer el merge.
- **Corrida principal.**
  - Son las aristas `edges` en orden. `L` es la suma de sus largos.
  - Hay `n = max(1, round(L / BAY_W))` bahías de ancho `L/n`.
  - La bahía de la puerta es la 0 si `puerta` es `inicio`, la `floor((n − 1)/2)` si es `medio` y la `n − 1` si es `fin`.
  - Cada bahía se parte en las aristas que cruza, con una cara por pedazo, y `u` se interpola sin saltos dentro de la celda.
- **Corridas de esquina.** Cada grupo de aristas contiguas de `corner` es una corrida. En planta baja, todas sus bahías llevan la celda `rest`.
- **Filas.**
  - La fila 0 es la planta baja, de 0 a `FLOOR_H`.
  - Las filas 1 a `floors − 1` usan `upperCell`.
  - La banda de arriba va de `floors·FLOOR_H` hasta `height`. Usa `pared` (o `pared-l`) recortada en `v` a `(height − floors·FLOOR_H)/FLOOR_H` de la celda.
- **Color.** La fila 0 lleva `colorPB ?? tint`. El resto lleva `tint`.
- **Toldo.**
  - Solo va sobre la corrida principal, entre `inset` y `L − inset`.
  - Es una cara inclinada que sale de la pared en `topY` y llega a `depth` m afuera en `bottomY`. Se emite dos veces, con las dos orientaciones, para que se vea desde arriba y desde abajo.
  - Usa la celda `toldo` o `toldo-rayas` y el color del toldo.

- [ ] **Step 1: Write the failing tests.**
  - **Lote de 9 m de frente, 2 pisos y `pb` vidriera:**
    - planta baja: 3 caras, y solo la primera tiene `u` dentro de `cellRect('vidriera-puerta')`;
    - piso 1: 3 caras en `ventana`;
    - banda de arriba: 3 caras con alto 0,6.
  - **Puerta `fin`:** la celda de la puerta queda en la última bahía.
  - **Dos lotes vecinos con colores distintos** dan atributos `color` distintos. Es el anti-objetivo del spec.
  - **`colorPB`** pinta solo las caras con y < 3,2.
  - **Dos aristas casi colineales:** la bahía que cruza la unión tiene `u` continuo y suma el ancho de una bahía.
  - **Toldo:** 2 caras por pedazo, con y entre 2,0 y 2,3 y una salida de 1,0 m.
  - **`extrudeBuilding` de un lote:** ningún triángulo de `walls.ground` ni de `walls.upper` cae sobre una arista del frente, y `walls.front` no está vacío. Un edificio sin `front` da `walls.front` vacío.
  - **Chunks:** con 10 lotes en un chunk sale **una sola** malla `front`, y sus medianeras van a `parapet`.
- [ ] **Step 2: Run** `npx vitest run tests/client/fronts.test.ts tests/client/geometry.test.ts`. **Expected:** FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck`. **Expected:** PASS.
- [ ] **Step 5:** Mirar el frente de prueba en el juego:
  - generar el mapa con el fixture usando un script del scratchpad que llame a `assembleMap` con `frentes-prueba.json` y escriba `public/map/adrogue.map.json`;
  - abrir `http://localhost:5173/?debug=1`, teletransportarse a `banco-nacion` y verificar que la vidriera, el vidrio, los colores y el toldo se lean;
  - volver a correr `npm run build:map`, para que el mapa commiteado no tenga datos inventados.

  Commitear: `feat(client): frentes de lotes con módulos del atlas y toldos`.

---

### Task 8: Atlas de carteles

**Files:**
- Modify: `src/client/world/signs.ts`, `src/client/main.ts`
- Test: `tests/client/signs.test.ts`

**Interfaces:**
- Consumes: `Sign`, `SignLook`, `Fuente`, `SIGN_H` y `SIGN_D` (mapdata).
- Produces:
  ```ts
  export const PX_PER_M = 128;
  export const PAGE = 2048;
  export const TYPE_LOOK: Record<PlaceType, SignLook & { weight: 'normal' | 'bold' | '900' }>; // los STYLES de hoy, en forma de SignLook
  export function signTexture(text: string, look: SignLook & { weight?: string }, width: number): HTMLCanvasElement; // weight por defecto 'bold'
  export interface AtlasRect { page: number; x: number; y: number; w: number; h: number }
  export function packSigns(sizes: { w: number; h: number }[], page?: number, gutter?: number /* 4 */): { rects: AtlasRect[]; pages: { w: number; h: number }[] };
  export function buildSigns(places: Place[], signs: Sign[]): THREE.Group; // una malla por página: `signs:${i}`
  ```

**Detalles:**
- **Fuentes.** `sans` → SANS, `serif` → SERIF, `condensada` → CONDENSED y `redondeada` → ROUNDED.
- **`packSigns`.** Usa estantes, en el orden de entrada y sin rotar. Abre página nueva cuando la actual se llena. La última página se recorta al alto que usó.
- **Margen.** El margen se rellena con el color `marco`.
- **Mallas.**
  - Cada cartel usa la caja de `signGeometry(width, twoSided)` con sus UV llevadas al rectángulo del atlas.
  - En los de bandera, la cara de atrás va espejada para que el texto se lea bien.
  - Se transforma con la misma posición y rotación que hoy y se hace el merge por página.
  - Material: `signMaterial(canvas de la página)`.
- **`main.ts`.** Llama `buildSigns(map.places, map.signs)`.

- [ ] **Step 1: Write the failing tests.** Reemplazan los tests de `signTexture` por tipo, sin perder lo que verificaban.
  - **`packSigns`:**
    - los rectángulos no se pisan, ni siquiera contando el margen;
    - todos caen dentro de su página;
    - el resultado es determinista;
    - cuando no entra más, abre una página nueva.
  - **`buildSigns` con 28 lugares y 50 carteles:**
    - salen 3 mallas como mucho;
    - las UV de cada malla quedan dentro de [0, 1];
    - los carteles `blade` tienen dos caras con textura.
  - **`signTexture` con un `look`:** usando `stubCanvas(onSet)`, se asignan `look.fondo`, `look.letra` y `look.marco` como `fillStyle` o `strokeStyle`, y la fuente `serif` aparece en `font`.
  - **Texto largo:** con 40 caracteres en 2 m sale en dos líneas, con px > 0 y sin pasarse del ancho.
- [ ] **Step 2: Run** `npx vitest run tests/client/signs.test.ts`. **Expected:** FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck && npx playwright test e2e/app.spec.ts e2e/perf.spec.ts`. **Expected:** PASS. En perf, la cantidad de draw calls de cada parada no sube; debería bajar unas 20.
- [ ] **Step 5: Commit** `feat(client): carteles en un atlas de páginas, con colores de marca`.

---

### Task 9: Relevamiento de la primera cuadra y revisión del usuario

**La hace el controlador en la sesión principal, con el Chrome del usuario.** No la hace un subagente.

**Files:**
- Modify: `data/frentes.json`, `e2e/helpers.ts`, `e2e/tour.spec.ts`, `public/map/adrogue.map.json`

**Interfaces:**
- Produces, en `e2e/helpers.ts`:
  - `faceStops(): TourStop[]`: una parada por cada frente de `data/frentes.json`.
  - La posición queda a 9 m de la fachada, frente al punto medio del frente. Se calcula con los edificios cuyo `id` empieza con `${faceId}-`, usando la normal exterior de sus aristas `front.edges`.
  - El yaw mira hacia la fachada, y el id de la parada es `frente-${faceId}`.

**Primera cuadra: `ea-mitre-pellerano-s`** (Mitre–Pellerano, vereda sur). Es la de los bancos: Nación, Galicia, Supervielle, y además Bonafide, la farmacia y Lucciano's.

- [ ] **Step 1: Preparar el navegador.**
  - Cargar las herramientas `mcp__claude-in-chrome__*` y llamar a `tabs_context_mcp`.
  - Si la extensión no está conectada, **pedirle al usuario que la conecte y esperar**.
  - Abrir una pestaña nueva. En los avisos de cookies, elegir rechazar lo no esencial.
- [ ] **Step 2: Puntos de vista.** Un script del scratchpad toma `resolveFrontage` sobre los datos reales y escribe una URL cada 8 m del frente:
  - formato: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=LAT,LON&heading=H&pitch=5&fov=90`;
  - el punto es el de la línea de edificación corrido 8 m hacia la calle, en `unproject` para pasarlo a lat y lon;
  - `H = (atan2(nx, −nz)·180/π + 360) % 360`, donde `n` apunta hacia la fachada;
  - imprime además los locales de OSM y los lugares que caen sobre ese frente.
- [ ] **Step 3: Recorrer el frente desde Mitre.**
  - Para cada URL: navegar, sacar una captura con la acción `screenshot` y anotar los lotes en orden: ancho estimado, pisos, colores en hex a ojo, `pb`, `arriba`, `material`, toldo y cartel (texto, colores, fuente parecida y posición).
  - Anotar en `fecha` la fecha de la imagen ("Captura de imagen").
  - Si un local de OSM ya no está, va a `osmAusentes`. Si el nombre de OSM difiere del cartel, va en `osm`.
  - Las capturas no se guardan fuera del scratchpad.
- [ ] **Step 4: Cargar y verificar.**
  - Escribir el frente en `data/frentes.json`, con `lugar` para banco-nacion y galicia, y correr `npm run build:map`.
  - Corregir hasta que no haya warnings fatales.
  - Revisar las líneas de `report`: un lote enlazado a más de 15 m de su punto de OSM indica un orden o un ancho equivocado, y hay que releerlo.
- [ ] **Step 5: Tour e2e.**
  - Agregar `faceStops()` al recorrido de `e2e/tour.spec.ts`.
  - Agregar, después de la captura de cada frente, `setQuality('baja')`, 8 cuadros, `setQuality('media')` y verificar que `collectErrors` siga vacío. Es el Review Focus 5.
  - Correr `npx playwright test e2e/tour.spec.ts`. **Expected:** PASS. Queda la captura `frente-ea-mitre-pellerano-s`.
- [ ] **Step 6: Commit** `data: frente Mitre–Pellerano sur de Esteban Adrogué (relevado con Street View como referencia)`.
- [ ] **Step 7: PARADA. Revisión del usuario (la pide el spec).**
  - Mostrarle la captura del tour y explicarle cómo verlo en `http://localhost:5173/` teletransportándose a Banco Nación.
  - Preguntarle qué no coincide: colores, carteles, alturas o anchos.
  - Avisarle que el Banco Provincia está sobre Mitre y no entra en el piloto, y preguntarle si quiere sumar esa cuadra.
  - Aplicar las correcciones de criterio, en los datos o en los módulos, antes de seguir con la Tarea 10.

---

### Task 10: Relevamiento del resto de Esteban Adrogué y cierre

**La hace el controlador**, igual que la Tarea 9.

**Files:**
- Modify: `data/frentes.json`, `public/map/adrogue.map.json`, `e2e/perf.spec.ts`, `e2e/helpers.ts`, `README.md`, `docs/superpowers/specs/2026-11-03-adrogue-battle-royale-design.md`

- [ ] **Step 1: Relevar los 5 frentes que faltan** con el método de la Tarea 9, Steps 2 a 4:
  - `ea-mitre-pellerano-n` (con `lugar` bbva);
  - `ea-pellerano-macias-n` y `ea-pellerano-macias-s`;
  - `ea-macias-espora-n` y `ea-macias-espora-s`.

  Cada lugar sobre EA queda enlazado: bbva, macro, santander, el-faro y filomena, además de los de la Tarea 9. Si el relevamiento muestra que casa-de-la-cultura está sobre EA, se enlaza con `retiro` y `fondo`, y se ajusta `widthM` y `heightM` de su foto si los warnings de la Tarea 4 lo piden.

  Después de cada frente: correr `npm run build:map`, que no tenga warnings fatales, y commitear `data: frente <id>`.
- [ ] **Step 2: Rendimiento.**
  - Agregar a `TOUR6` una parada `esteban-adrogue`: el `faceStops()` de `ea-mitre-pellerano-s`. Renombrar la constante a `TOUR` en `helpers.ts` y `perf.spec.ts`.
  - Correr `npx playwright test e2e/perf.spec.ts`. **Expected:** PASS, con los presupuestos sin cambios.
  - Si alguna parada se pasa, se reduce el costo (por ejemplo, sacar `front` de `SHADOW_CASTERS` en baja o juntar celdas). **No se sube el presupuesto.**
- [ ] **Step 3: Documentación.**
  - En `README.md`, agregar la sección "Corregir un frente de Esteban Adrogué". Explica:
    - qué es cada campo de `data/frentes.json`;
    - que después de editar hay que correr `npm run build:map`;
    - qué significan los avisos de `osmAusentes`, `lugar` y anchos;
    - que Street View se usa solo para mirar.
  - En la sección 8 del diseño general, reemplazar "Las marcas se muestran con su nombre en el cartel, sin logos." por: "Las marcas se muestran con su nombre escrito con una letra parecida y con sus colores en el cartel y en la fachada; logos, no (ni copiados ni redibujados), porque el repo es público".
- [ ] **Step 4: Verificación completa.** Correr `npx vitest run && npm run typecheck && npm run build:map && npx playwright test`. **Expected:** todo PASS y el mapa por debajo de 3 MB.
- [ ] **Step 5: Commit** `docs: cómo corregir un frente y la nueva regla de marcas`.
- [ ] **Step 6: Revisión final del usuario.** El usuario recorre EA en el juego y marca lo que no coincide. Cada corrección se hace editando `data/frentes.json`, corriendo `npm run build:map` y commiteando.
