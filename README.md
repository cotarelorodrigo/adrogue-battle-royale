# Adrogué

El centro de Adrogué para recorrer en primera persona desde el navegador: la estación, las plazas, las calles con sus
árboles y los techos (subís por escaleras de mano y contenedores). Calles y edificios salen de OpenStreetMap y de las
huellas de edificios de Microsoft; las texturas son CC0 de Poly Haven y las fotos de fachada, libres de Wikimedia
Commons (en el juego, **Créditos** lista cada fuente con su licencia).

## Requisitos

- **Node.js 24** o más nuevo (las herramientas de `tools/` son TypeScript que Node corre directo).
- Un navegador con **WebGL2**: Chrome, Edge o Firefox actualizados.

## Jugar

```sh
npm install
npm run dev
```

Abrí <http://localhost:5173> y hacé click en **Hacé click para jugar**.

### Controles

| Tecla | Qué hace |
|---|---|
| W A S D | moverse |
| Mouse | mirar |
| Espacio | saltar; con W frente a un borde de hasta 2,4 m (un contenedor, un murito), trepar |
| C | agacharse |
| W contra una escalera de mano | subir (Espacio o S para soltarse) |
| M | lugares: teletransportarse a uno de los 38 lugares, o a uno al azar |
| Esc | menú: seguir, calidad (Baja / Media / Alta, queda guardada), lugares y créditos |
| F3 | fps y draw calls |

## Regenerar el mapa

El mapa ya viene armado en `public/map/adrogue.map.json`. Para rehacerlo desde las fuentes:

```sh
npm run fetch:osm         # calles, plazas, vías, andenes y fuentes de OpenStreetMap → data/raw/osm.json
npm run fetch:buildings   # huellas de edificios de Microsoft → data/raw/ms-buildings.geojson
npm run build:map         # arma public/map/adrogue.map.json (falla con avisos graves o si pesa 3 MB o más)
```

Las texturas y las fotos se bajan aparte, solo si cambian `data/textures.json` o `data/photo-facades.json`:

```sh
npm run fetch:textures    # Poly Haven → public/textures
npm run fetch:photos      # Wikimedia Commons → public/photos (rechaza licencias que no sean libres)
```

Los lugares (nombre, tipo, dónde están) se editan en `data/places.json`; qué foto va en cada fachada, en
`data/photo-facades.json`. Después de tocarlos, `npm run build:map` (y `npm run fetch:photos` si cambió una foto).

La pared del cartel de cada lugar (o la de su foto, si la foto trae `edgeIndex`) tiene planta baja propia según el tipo:
locales con vidriera para bancos, bares, restaurantes, heladerías, cines, la clínica, la Casa de la Cultura y la
estación; ladrillo para la escuela y los clubes (la tabla está en `src/mapgen/place-facades.ts`). Para cambiarla en un
lugar, agregale `facade` a su entrada en `data/places.json`; los dos campos son opcionales y lo que falte sale del tipo:

```json
"facade": { "ground": "brick", "tint": "#e4e2dc" }
```

| Campo | Valores | Qué cambia |
|---|---|---|
| `ground` | `"shop"` (vidriera con persiana), `"house"` (revoque, puerta y ventana con reja), `"brick"` (ladrillo visto, puerta y ventana con reja) | la planta baja de esa pared |
| `tint` | color `#rrggbb` | el tinte de esa planta baja |

Plazas y monumentos no llevan `facade` (no tienen edificio). Un valor que no está en la lista corta el `build:map` con
el lugar y el campo que falló.

## Corregir un frente de Esteban Adrogué

Las seis veredas de Esteban Adrogué entre Mitre y Espora están relevadas local por local en `data/frentes.json`.
Cada lote es un edificio propio con sus colores, su planta baja y su cartel. Para corregir uno (un color, un nombre, un
local que cerró):

1. Editá `data/frentes.json`.
2. Corré `npm run build:map` hasta que termine sin errores ni avisos (ver más abajo).
3. Mirá el resultado con `npm run dev` y commiteá el JSON junto con `public/map/adrogue.map.json`. Commiteá solo después
   de una corrida limpia: con un aviso, `build:map` igual escribe un mapa nuevo antes de cortar.

El archivo tiene `estilos` (lotes de base reutilizables) y `calles`. Cada calle tiene `calle`, `calzada`
(`"empedrado"` o `"asfalto"`) y `frentes`. Cada frente es una vereda de una cuadra:

| Campo del frente | Qué es |
|---|---|
| `id` | nombre único con minúsculas sin acento, números y guiones, por ejemplo `ea-mitre-pellerano-s` (no puede ser una `b` y un número, como los edificios de Microsoft); los edificios se llaman `<id>-1`, `<id>-2`… |
| `desde`, `hasta` | las calles transversales con el nombre de OSM (`"Benigno Macías"`, no `"Macías"`); los lotes van en ese orden |
| `vereda` | `norte`, `sur`, `este` u `oeste` |
| `fecha` | `AAAA-MM` de las imágenes que se miraron |
| `osmAusentes` | locales que OSM ubica sobre esta vereda y que ya no están (ver los avisos más abajo) |
| `lotes` | la lista de lotes, de `desde` a `hasta` |

| Campo del lote | Valores | Qué es |
|---|---|---|
| `ancho` | metros | el ancho sobre la vereda; se escalan todos juntos para que sumen el largo de la cuadra |
| `pisos` | 0 a 20 | la altura (3,2 m por piso + 0,6 m); `0` es un terreno sin edificio (pasaje, plazoleta) |
| `fondo`, `retiro` | metros (15 y 0) | cuánto entra el edificio en la manzana y cuánto se separa de la vereda |
| `color`, `colorPB` | `#rrggbb` | la fachada y la planta baja (sin `colorPB`, la planta baja usa `color`); `color` es obligatorio si `pisos` es mayor que 0 |
| `material` | `revoque`, `ladrillo` | `ladrillo` hace de ladrillo visto los pisos de arriba (salvo `vidriado`) y, en la planta baja, las paredes de `puerta`, `porton` y `pared`. El ladrillo no se tiñe: ahí `color` y `colorPB` no cambian nada. `color` sigue tiñendo las medianeras y el pretil, y `colorPB` (o `color`) una planta baja de `vidriera`, `persiana`, `banco` o `acceso` |
| `pb` | `vidriera`, `persiana`, `porton`, `puerta`, `banco`, `acceso`, `pared` | la planta baja |
| `arriba` | `ventanas`, `balcones`, `vidriado`, `ciego` | los pisos de arriba |
| `puerta` | `inicio`, `medio`, `fin` | dónde va la puerta del local: `inicio` es la punta de `desde` y `fin` la de `hasta` |
| `toldo` | `{ "color": "#rrggbb", "rayas": true }` | un toldo sobre la planta baja |
| `cartel` | ver abajo | el cartel del local |
| `lugar` | id de `data/places.json` | el local es ese lugar del juego (necesita cartel) |
| `osm` | texto | el nombre con el que OSM tiene este local, si difiere del cartel; tiene que ser exacto, con mayúsculas y acentos |
| `nota` | texto | lo que no entra en los otros campos; no se dibuja |
| `usa` | nombre de un estilo | toma los campos del estilo; lo que ponga el lote manda |

Un estilo lleva cualquier campo del lote salvo `ancho`, `usa` y `lugar`. Cada estilo se valida solo, aunque ningún lote
lo use, y el error dice qué estilo falló.

El `cartel` lleva `texto` (hasta 40 letras), `fondo` y `letra` (colores) y, si hacen falta, `marco` (color), `fuente`
(`sans`, `serif`, `condensada`, `redondeada`), `cursiva` (`true`), `posicion` y `ancho` (de 0,5 a 20 metros). Las
marcas van con su nombre, una letra parecida y sus colores; los logos, no. La `posicion` puede ser:

- `frente` (la de siempre): a lo ancho del local, en la franja de arriba de la puerta y las vidrieras (desde 2,35 m).
- `alto`: arriba de todo, debajo del borde del techo.
- `bandera`: perpendicular a la pared, en la punta de `desde`.

Un cartel de `frente` o `alto` es recto: si la fachada se quiebra, va en el tramo recto más largo. Sin `ancho` ocupa
ese tramo menos 20 cm por punta. Si la escalera (o el contenedor) para subir al techo del lote no entra en otra pared
que dé a una calle, mapgen la pone en una punta de la fachada, lejos de la puerta y de la bandera, y el cartel y el toldo
dejan libre ese tramo.

Un error de formato (un campo que no existe, un color mal escrito, un `lugar` repetido) corta el `build:map` sin
escribir el mapa, con el frente y el lote que fallaron. Lo mismo pasa con los anchos: si suman más de un 10 % de más o
de menos que el largo de la cuadra, falta o sobra un lote.

Además hay avisos. El mapa se escribe igual, pero el armado termina con error, así que no se commitea hasta que no
quede ninguno:

- **`lugar`:** un lugar de `data/places.json` que cae sobre la vereda tiene que tener un lote que lo nombre (por
  `lugar` o por el texto del cartel), y uno solo.
- **`osmAusentes`:** cada local de OSM sobre la vereda tiene que coincidir con el cartel o el `osm` de un lote. Si ya
  no existe, se anota su nombre en `osmAusentes`; un nombre ahí que OSM no tiene sobre esa vereda también avisa.
- **Lotes que se pisan:** dos lotes de frentes distintos ocupan el mismo lugar (un frente copiado, o las esquinas de
  dos frentes que se cruzan).
- **`cartel.ancho`:** el cartel no entra en la fachada; se dibuja más chico.
- **`calzada`:** OSM no tiene ninguna calle con ese nombre.

Las líneas que dicen "a N m del punto del lugar" o "<-> OSM" solo informan qué tan lejos quedó cada lote de su punto
en el mapa.

Street View se usa solo para mirar. Ninguna captura de Google entra al repo ni al juego: los colores y los textos se
copian a mano en el JSON.

## Medir el rendimiento en otra notebook

Con `?bench=1` el juego no espera al jugador: la cámara recorre sola, siempre igual, la estación, Esteban Adrogué,
Avenida Espora, la Plaza Brown y los techos durante 60 segundos (`&benchSecs=30` lo acorta). Al final muestra:

```
Promedio: 58 fps · Peor 5 %: 41 fps · Calidad: Media
```

Para correrlo en la notebook de alguien más:

1. En tu compu, `npm run build` y después `npx vite preview --host`. Vite muestra una dirección **Network**, algo como
   `http://192.168.0.23:4173`. (Si no, copiá el proyecto a esa notebook y corré ahí `npm install` y `npm run dev`.)
2. En la otra notebook, conectada a la misma red, abrí esa dirección con `/?bench=1` al final, en Chrome o Edge.
3. Mejor enchufada (con batería muchas bajan el rendimiento), con las otras pestañas cerradas y la ventana maximizada
   o en pantalla completa (F11).
4. Al terminar, los botones **Medir en: Baja / Media / Alta** repiten la medición en otra calidad (y la dejan
   guardada para jugar); **Jugar** vuelve al juego.

Qué quieren decir los números:

- **Promedio**: cuadros por segundo de todo el recorrido. El tope es la frecuencia de la pantalla (60 en casi todas
  las notebooks), así que 58–60 en Media ya es el objetivo cumplido.
- **Peor 5 %**: el promedio del 5 % de cuadros más lentos, o sea los tirones. Por encima de 30 se juega bien aunque
  el promedio sea más alto; por debajo se notan saltos.
- La meta: **60 en Media** en una notebook de 2020 con gráficos integrados, y **nunca menos de 30 en Baja**. Si en
  Baja el peor 5 % queda por debajo de 30, avisá con el resultado y el modelo de la notebook.

## Tests

```sh
npm test            # unitarios (Vitest)
npm run typecheck   # tsc --noEmit
npm run e2e         # Playwright con Chrome; deja capturas en test-results/
```

Los e2e dibujan con SwiftShader (WebGL por software): los fps que dan ahí no dicen nada de una placa de video de
verdad. Lo que vigilan son los draw calls y los triángulos por calidad (`e2e/perf.spec.ts`).
