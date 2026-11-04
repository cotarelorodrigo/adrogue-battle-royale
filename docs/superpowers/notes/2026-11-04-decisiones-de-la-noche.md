# Decisiones de la noche del 3 al 4 de noviembre de 2026

El usuario dejó a Claude trabajando solo, con estas palabras: "tenes toda la noche para trabajar en esto. si te queda
tiempo commitea e inicia la siguiente etapa. tomas las decisiones necesarias para trabajar toda la noche".

Acá están las decisiones que tomó Claude sin preguntar. Todas se pueden revisar y cambiar. Las técnicas menores (una
convención de ejes, un redondeo, un test mal planteado en el plan) no se listan: quedan en los mensajes de commit.

## Fachadas reales (rama `fachadas-reales`)

### Las que conviene mirar primero

- **No se paró para que revisaras el primer frente.** El plan pedía una pausa después del primer frente relevado. Se
  siguió con los 6. Si no te gusta el estilo, hay que rehacer los datos de los 6 frentes (solo el JSON, no el código).
- **Locales con nombre ilegible.** No llevan cartel (zapatería y bazar de Mitre–Pellerano sur) o llevan el subtítulo que sí
  se lee ("TIENDA DE DULCES"). Nunca se inventó un nombre.
- **Riviera Café.** Quedó como ausente de OSM: en las imágenes de agosto de 2025 el café de la esquina muestra otro
  cartel. Se cargó como BEGONIA. Si sigue siendo Riviera, se cambia el texto.
- **Casa de la Cultura.** Se liga al lote 2 del frente sur de Macías–Espora, con 4 pisos y 45 m de fondo para que entre
  la foto de 12 m. Su punto de OSM queda a 47 m del frente, en el fondo de la manzana. Si está mal, se le saca el lugar
  al lote y vuelve a su edificio de Microsoft.
- **La escuela** (Macías–Espora sur) son 4 lotes retirados 9–12 m, sin cartel. La reja verde no está: el esquema no tiene
  rejas. Queda una vereda ancha vacía delante.
- **Carteles más cortos.** 23 carteles perdieron 0,9–1,9 m para dejar libre el hueco de la escalera. En los frentes
  quebrados el cartel va sobre el tramo recto más largo: FILOMENA pasó de 13,4 a 8,6 m y mistral de 7,2 a 3,7 m. Un
  cartel metido en la pared o flotando se veía peor. Para tenerlos de punta a punta haría falta un cartel quebrado.
- **Trote Bar** (OSM, cruce con Pellerano) no quedó en ningún lote. Necesita mirar Street View otra vez.

### Medidas y datos

- Anchos de los lotes: medidos en Street View y escalados ×1,735 para que sumen el largo real del frente (173,47 m en el
  primero). Las posiciones GPS de Street View coinciden con el resultado en menos de 4 m.
- Los puntos de OSM de la vereda norte están ~25 m corridos al este. Se aceptaron enlaces de 25–31 m (Subway, BBVA,
  prato) porque Street View confirma el lote. El punto de aparición del BBVA sigue al cartel, no al punto de OSM.
- Los nombres de calle en `desde`/`hasta` son "Benigno Macías". Los id de frente siguen diciendo "macias".

### Reglas del código

- Un lugar ligado a un lote relevado no recibe pisos, color ni fachada de `places.json`: manda el lote.
- `puerta: inicio` es el extremo `desde` del lote.
- Los tests de `assemble` ya no cuentan los lotes en el tope de 1350 edificios. "No pierden área" compara contra un mapa
  sin frentes.
- La parada nueva del recorrido de rendimiento se llama `frente-ea-mitre-pellerano-s`.
- Dos tolerancias quedan como están: el ancho mínimo de cartel (0,5 m) y el solape mínimo que avisa (5 cm). Con los
  datos reales no molestan.

## Etapa 2a: combate en solitario (rama `etapa-2a-combate`)

### El diseño

Todo el diseño (`docs/superpowers/specs/2026-11-04-etapa2a-combate-design.md`) es decisión de Claude: las armas y sus
números, el botín, la zona, el HUD y los maniquíes. Lo más discutible:

- La etapa 2 se partió en dos. **2a** es el combate. **2b** son los interiores, porque 5 de los 9 lugares caen en bloques
  fusionados y hay que relevar sus lotes antes.
- Hasta que existan los interiores, el botín de los lugares va en la vereda, frente a la puerta.
- 11 maniquíes quietos, con chaleco sorteado. La zona también los mata, así la partida siempre termina.
- 4 armas hitscan con modelos hechos de cajas y cilindros. Sonidos sintetizados. No se bajó ningún archivo.

### Cambios al diseño durante la implementación

- **Zona.** La tabla original sumaba 525 s, pero el diseño dice que la zona se cierra a los 12 minutos. Se rehízo para que
  sume 720 s:
  - esperas de 120, 90, 75, 60 y 45 s;
  - cierres de 90, 75, 60, 60 y 45 s;
  - los radios y el daño no cambiaron.
- **Botín cada 50 m.** El diseño pedía un punto cada ~25 m en la calle y uno por techo de más de 60 m². Así salían 1733
  puntos, demasiados. Quedaron 525 (231 en la calle, 258 en techos y 36 frente a los lugares), separados por al menos
  50 m. En promedio hay un punto a 23 m de cualquier lugar, y como máximo a 76 m. Se ajusta con dos constantes de
  `src/mapgen/loot-spots.ts`.
- **Contenedores de basura de 2,0 m (antes 1,4 m).** Con los pretiles sólidos, desde un contenedor de 1,4 m no se llegaba
  a trepar al techo de un piso. A 2,0 m se llega, pero los 679 contenedores pasan a ser cobertura completa y se ven más
  grandes. La alternativa es poner escaleras en los techos de un piso.
- **Francotirador.** La dispersión es 0° con mira y 6° sin mira, se mueva o no. Las otras armas usan la tabla
  (quieto/moviéndose) y apuntar la divide por 2. "Moviéndose" incluye saltar y trepar.
- **La escopeta también acerca la vista al apuntar** (fov 55, como el rifle y la pistola). El diseño no la nombraba.
- **Curarse** hace caminar a la mitad de velocidad (3 m/s).
- **Muertes por la zona.** No cuentan como eliminación de nadie. Con la zona cerrada del todo lastima a todos, aun en el
  centro: así la partida siempre termina.
- **Con `?maniquis=0`** es práctica libre: no se gana por eliminación y la partida termina solo si te morís.
- **Un arma soltada conserva su cargador.** Así, soltar y volver a juntar no regala balas.

### Cómo se ve y se juega

- **Recorte para no pasar los presupuestos.** En `media`, la parada nueva `combate` daba 232.623 triángulos, sobre el tope
  de 230.000. Para bajarla:
  - el botín se dibuja hasta 80 m en `baja`, 100 m en `media` y 120 m en `alta`;
  - los maniquíes tiran sombra solo en `alta`.

  Ahora `media` queda en 226 draw calls y 228.955 triángulos. Es apenas ~1.000 triángulos de margen: el mundo solo ya
  usa 225.000 en esa vista. Si el mapa crece (etapa 2b), esa parada va a fallar primero, y para eso está.
- **La culata** de la escopeta y del rifle se oculta al apuntar, porque tapaba el centro de abajo de la pantalla.
- **Partidas seguidas.** La partida número k usa la semilla + k. El recorrido de rendimiento usa la semilla fija 42.
- **Desde el modo paseo** (menú de lugares) se vuelve a una partida con "Jugar una partida", en el menú de Esc.
- **Teclas con el menú abierto.** E, R, H, 1 y 2 solo cuentan con el mouse capturado. Antes, una E apretada en la
  pantalla de derrota juntaba algo al empezar la partida siguiente.

### Arreglos de la revisión final

La revisión de toda la rama encontró dos problemas en las reglas de `src/shared/`, que va a heredar el servidor de la
etapa 3:

- **Aparición afuera de la zona.** Con pocos maniquíes, el primer círculo es más chico y había jugadores que aparecían
  afuera. Con `?maniquis=2`, la zona a veces mataba a los dos maniquíes y se ganaba sin hacer nada. Ahora todos aparecen
  adentro, a 10 m o más del borde. Con los 11 maniquíes de siempre no cambia nada.
- **Maniquíes atravesables.** Se los atravesaba caminando, y parado adentro de uno cualquier tiro era a la cabeza. Ahora
  son sólidos, y un tiro que sale de adentro de un cuerpo no le pega.

En la misma tanda entraron detalles que se notan jugando:
- gatillar con el cargador vacío recarga sola, o dice "Sin munición";
- el arma que se saca tarda 0,25 s en disparar, lo mismo que su animación;
- los controles aparecen también en el menú de Esc;
- el menú de lugares avisa que deja la partida;
- el sonido de la recarga dura lo que la recarga;
- un objeto que no se puede juntar muestra, por ejemplo, "Chaleco: lleno";
- si el jugador y el último maniquí mueren juntos, es "empate con la zona".

## Pendientes que quedaron anotados

- `src/client/main.ts` creció a ~480 líneas. Conviene partirlo antes de la etapa 3, no de noche y con el e2e en juego.
- Desde 167 techos vecinos se llega a la punta de un tronco y se queda escondido en la copa (etapa 3).
- La cámara no interpola entre pasos de 60 Hz: en monitores de 144 Hz puede notarse un tirón.
- El sonido de la recarga sigue sonando durante la pausa de Esc.
- Margen de ~1.000 triángulos en `media` en la parada `combate`.
- Minors chicos de cada tarea (comentarios, tests más finos), sin efecto en el juego.

## Cosas que se vieron y no se tocaron

- La celda `ventanas` del atlas dibuja persianas marrones que los edificios reales no tienen.
- La textura de ladrillo es igual en todos los lotes.
- Los puntos de OSM de la vereda norte de Esteban Adrogué están ~25 m corridos al este.
