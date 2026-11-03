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
