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

Abrí <http://localhost:5173> y hacé click en **Hacé click para jugar**: arranca una partida de práctica.

### La partida

Aparecés sin armas en un punto al azar, con 11 maniquíes repartidos por el centro (12 jugadores en total). Los
maniquíes no se mueven ni disparan: tienen vida 100 y algunos, chaleco. En la calle, en los techos y adentro de los
lugares hay botín: armas (pistola, escopeta, rifle y francotirador), munición, chalecos y botiquines. La zona se achica
en 5 fases y se cierra del todo a los 12 minutos; afuera se pierde vida, y también la pierden los maniquíes. Ganás si
quedás último en pie; si te eliminan, ves cuántos quedaban. En los dos casos, **Jugar de nuevo** arranca otra partida.

Elegir un lugar en el menú de lugares (M) deja la partida y pasa al **modo paseo**: recorrer el mapa sin zona, sin
maniquíes y sin botín. Para volver a jugar, **Jugar una partida** en el menú de Esc.

### Controles

| Tecla | Qué hace |
|---|---|
| W A S D | moverse |
| Shift | correr mientras la mantenés: 8,5 m/s en vez de 6, solo hacia adelante (también en diagonal); no se corre agachado, apuntando, disparando ni curándote |
| Mouse | mirar |
| Espacio | saltar; con W frente a un borde de hasta 2,4 m (un contenedor, un murito), trepar |
| C | agacharse |
| W contra una escalera de mano | subir (Espacio o S para soltarse) |
| Clic izquierdo | disparar (el rifle sigue disparando mientras lo mantenés; las otras, un tiro por clic) |
| Clic derecho | apuntar: acerca la vista y achica la dispersión; con el francotirador, mira telescópica |
| R | recargar (con el cargador vacío, también recarga apretar el gatillo) |
| E | juntar lo que tenés adelante, a menos de 2,5 m y a la vista: no a través de una pared ni de un vidrio (aparece "E: juntar…") |
| 1, 2 o la rueda | cambiar de arma (la rueda: hacia arriba la 1, hacia abajo la 2); la que sacás tarda 0,25 s en poder disparar |
| H | usar un botiquín: tarda 3 s y cura 50 (disparar o cambiar de arma lo corta) |
| M | lugares: pasar al modo paseo en uno de los 38 lugares, o en uno al azar |
| Esc | menú: seguir, calidad (Baja / Media / Alta, queda guardada), lugares y créditos; en el modo paseo, también **Jugar una partida** |
| F3 | fps y draw calls |

Si una tecla no responde (por ejemplo, D sola no te mueve pero Shift+D sí), lo más probable es una extensión del
navegador con atajos de teclado, como Vimium o Surfingkeys, que se queda con la tecla antes que el juego. Para
confirmarlo, probá en una ventana de incógnito, donde las extensiones vienen apagadas. Para arreglarlo, excluí
`http://localhost:5173/*` (o la dirección donde juegues) en las opciones de la extensión.

### Para probar

Dos parámetros de la dirección cambian la partida:

- `?maniquis=N`: cuántos maniquíes, de 0 a 23 (11 si no se dice). Con 0 es práctica libre: no se gana, la partida
  termina solo si la zona te elimina.
- `?semilla=N`: la semilla del sorteo (botín, zona, puntos de aparición y chalecos de los maniquíes). La misma semilla
  da la misma partida; **Jugar de nuevo** sigue con N + 1, N + 2… Sin semilla, se elige una al azar.

Por ejemplo, <http://localhost:5173/?maniquis=2&semilla=7>.

## Lugares con interior

Nueve lugares se recorren por adentro. Se entra por sus puertas de verdad (el menú de lugares te deja en la vereda,
frente a la principal) y se sube por las escaleras a los pisos públicos; lo de arriba queda cerrado. Las paredes, las
losas y los muebles frenan como cualquier pared. Los vidrios y las barandas frenan al jugador, pero no a las balas.

| Lugar | Qué hay adentro |
|---|---|
| Banco Nación, Galicia y BBVA | el vestíbulo de los cajeros automáticos y, pasando la pared de vidrio, el salón: la fila de espera, el turnero, los escritorios, la línea de cajas con sus mamparas y, al fondo, la puerta redonda del tesoro (dibujada: no se abre) |
| Casa de la Cultura | el hall con la mesa de informes, el atrio con el lucernario y el plafón de colores, los balcones de los pisos 1 y 2, las salas de muestras, el auditorio con su escenario y la Sala 3 arriba |
| McDonald's (Espora) | el salón con la barra, los sillones y las mesas, el mostrador con las pantallas de menú, la cocina, el pasillo de los baños y el patio del fondo con mesas de picnic |
| Cine Pixel | el hall con los afiches y el candy bar, y las dos salas a oscuras con sus gradas de butacas |
| La Veneciana (Espora) | el salón vidriado con el mostrador y la vitrina de helados, el metegol y, por la escalera, la terraza con sombrillas |
| Guernica Bar | la barra con las canillas y los estantes de botellas, las mesas, la planta alta con el escenario, el balcón y el patio de adelante con sus jacarandás |
| Estación Adrogué | el hall de la boletería con sus ventanillas, la terminal SUBE y el mural, y el patio de los molinetes con la escalera al andén |

En la partida, el botín de los lugares está adentro. Hay entre 4 y 12 puntos de botín por lugar, uno cada 40 m² de
piso público (contando la terraza de La Veneciana), repartidos entre sus pisos según el área: el primero, lo más lejos
posible de la puerta. Si en un punto sale un arma, trae al lado una caja de su munición. Para juntar algo hay que
verlo: no se junta a través de una pared, un vidrio ni una baranda.

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

## Relevar más lugares: `data/plantas.json`

Los lugares que no tienen lote en `data/frentes.json` (porque caen en un bloque de Microsoft que junta varios
edificios) llevan su planta relevada en `data/plantas.json`. Cada entrada de `plantas` es un lugar:

| Campo | Qué es |
|---|---|
| `lugar` | el id de `data/places.json`; tiene que estar en `SIN_LOTE` (`src/mapgen/plantas-input.ts`) |
| `fecha` | `AAAA-MM` de las imágenes que se miraron |
| `marco` | dónde está el origen de la planta: `{ "lat", "lon", "rumbo" }` (el rumbo, en grados desde el norte en sentido horario, es la dirección de U) o `{ "calle", "vereda", "desde", "hasta", "s" }` (sobre la línea de edificación de esa vereda, a `s` m de `desde`) |
| `planta` | los vértices `[u, v]` en metros (de −200 a 200): u a lo largo del frente y v hacia adentro; de 3 a 60 m de fondo en v |
| `frente` | los índices de las aristas de `planta` que dan a la calle, seguidas (la arista `i` va del punto `i` al `i + 1`); juntas miden hasta 60 m |
| `patios` | lista de polígonos `[u, v]` afuera de la planta, sin losa ni techo, que amuebla el interior |
| `despejes` | lista de polígonos `[u, v]` de suelo que solo se le saca a los bloques de Microsoft (una vereda o un pasillo que tapaban) |
| `reemplaza` | ids de bloques de Microsoft (`"b0714"`) que se borran enteros |
| `puertas` | `{ "arista", "centro", "ancho", "alto", "piso" }`: `centro` en metros desde el punto `arista`; al menos 1,0 × 2,2 m y 0,2 m libres en cada punta de la arista. La primera es la principal y va en el piso 0 |
| `vidrios` | `{ "arista", "desde", "hasta", "abajo", "arriba", "piso" }`: de `desde` a `hasta` m a lo largo de la arista, de `abajo` a `arriba` m sobre su piso; no se pisa con una puerta |
| `escalera` | `{ "arista", "centro" }`: dónde va la escalera de mano al techo, en una arista que no sea del frente (sin esto, va en una punta del frente) |

Además lleva el aspecto con los mismos campos que un lote (`pisos`, `alto`, `color`, `colorPB`, `material`, `pb`,
`arriba`, `puerta`, `toldo`, `cartel`, `nota`; ver la tabla de "Corregir un frente de Esteban Adrogué"). `pisos` es
obligatorio y `alto` (opcional) tiene que dar para esos pisos: al menos `pisos` × 3,2 + 0,6 m. `puerta` tiene que
pintar la puerta en la bahía de la puerta principal (si no, el error dice cuál usar).

Un error de formato corta el `build:map` sin escribir el mapa, con el lugar y el campo que fallaron. Con la planta, el
lugar ya se entra por sus puertas a una caja vacía de un piso; sus muebles, escaleras y pisos de arriba salen de su plan
en `src/shared/interiors/` (uno por lugar, anotado en `INTERIOR_PLANS` de `index.ts`). Después de tocar el JSON,
`npm run build:map` hasta que termine sin avisos: entre otras cosas avisa si no entran los puntos de botín adentro
(`<lugar>: entran k de n puntos de botín adentro`).

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
verdad. Lo que vigilan son los draw calls y los triángulos por calidad (`e2e/perf.spec.ts`). Como dibujan con la CPU,
corren de a 2 navegadores (`workers` en `playwright.config.ts`); con más, el juego va tan lento que los tests largos se
pasan de tiempo. La suite entera tarda de 7 a 8 minutos. `e2e/interiors.spec.ts` entra a los 9 lugares con interior y
deja una captura de cada uno en `test-results/interiores/`.
