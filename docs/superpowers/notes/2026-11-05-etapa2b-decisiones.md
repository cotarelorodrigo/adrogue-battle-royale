# Decisiones de la etapa 2b: los interiores (4 y 5 de noviembre de 2026)

La etapa 2b les dio interior a los 9 lugares entrables: los dos bancos, el BBVA, la Casa de la Cultura, el McDonald's,
el Cine Pixel, La Veneciana, el Guernica y la Estación. Se trabajó por tareas (T1 a T11c), cada una con su revisión, y un
controlador fue resolviendo las dudas sobre la marcha. Esas resoluciones vivían en una carpeta de trabajo que se borra:
esta nota las junta, agrupadas por tema, con qué se decidió y por qué. Todas se pueden revisar y cambiar.

Las técnicas menores (un nombre, un redondeo, un comentario) no se listan: quedan en los mensajes de commit.

## 1. Decisiones de la etapa

### El relevamiento

- **Cada lugar sin lote lleva su planta** en `data/plantas.json`: la planta real en un marco local, sus patios, sus
  puertas y vidrios, y el mismo aspecto que un lote. Así se pueden relevar edificios que Microsoft fusionó con media
  manzana.
- **Despejes.** Además de los patios, una planta puede despejar suelo que no es parte del interior: la vereda tapada del
  Guernica, la franja delante del cine, la terraza de mesas del McDonald's. Recortan los bloques de Microsoft, pero no se
  amueblan ni frenan apariciones.
- **"Reemplaza".** Una planta puede borrar entero un bloque de Microsoft que es el mismo edificio corrido: La Veneciana
  borra b0314 y el McDonald's, b0497 (el cuerpo oeste, que tapaba la puerta). El McDonald's no borra b0592, que está
  fusionado con media manzana: quedan franjas de un piso sobre los carriles del AutoMac, como antes.
- **El marco tiene que entrar al edificio:** medio metro hacia adentro desde el origen cae en la planta o en un patio (o
  a 1 cm de su borde). Para eso el origen de La Veneciana va 1 m al norte de su esquina.
- **La foto de la estación se dejó de usar.** Muestra el edificio partido por el pasillo de los molinetes, que ahora el
  juego tiene en 3D: pegada sobre la boletería pintaría el pasillo en una pared. La boletería se dibuja con el atlas.
- **La estación sigue siendo "estación"** para el mapa (el edificio conserva su tipo), como pide el test de siempre.
- **En la ola final, el relevamiento se valida más** (todo rompe el build, con el mensaje en castellano):
  - un lugar entrable sin planta ni lote no tiene interior: se quedaría sin botín y con la puerta contra un bloque;
  - cada arista del frente tiene que mirar a la calle (a 60° o menos; una ochava a 45° todavía es frente);
  - un patio no puede pisar la planta: va afuera, pegado a ella;
  - un "reemplaza" tiene que nombrar un bloque de ese lugar: la planta (con su patio, sus despejes y la vereda) tiene que
    tapar al menos el 10 % del bloque. Hoy los reemplazados van del 19 % al 82 %, y el vecino más grande que toca, apenas
    el 3,6 %;
  - un marco sobre un tramo de calle sin largo es un error, en vez de un marco nulo.

### Cada lugar

- **Estación.**
  - La boletería queda pegada al andén, como en la realidad, y mide 10 × 6,4 m. Al sur hay un patio abierto con la
    línea de molinetes, la escalera al andén y la salida del Túnel Peatonal.
  - Las ventanas de afuera llevan reja verde, también las del andén y los costados. El alero es verde ferroviario oscuro.
    Los carteles ADROGUÉ son nomencladores azules con letras blancas, sin logos de Trenes Argentinos ni de SUBE.
  - Los molinetes son sólidos (lo dice el spec). Para que nunca haya un sólido invisible, de lejos se dibuja una pieza
    simple que cubre toda su colisión.
  - Si la planta de la estación no es la relevada, `build:map` se frena con un error que dice qué falta, en vez de
    armar un hall vacío.
  - El cartel del frente va centrado (9,6 m) y se sacó el cartel de ayuda: así se ve en la realidad. Cuatro puntos de
    botín se corrieron ~0,5 m.
- **La Veneciana.** Va corrida 2,5 m al sudeste respecto del relevamiento satelital, para no pisar el carril del
  AutoHelado de OSM, que el juego dibuja. Todo el techo es terraza pública (el kit no parte techos). Las mesas y sombrillas van en el tercio
  sobre Espora, como en la foto satelital. Lleva baranda blanca de caño en todo el borde, porque una terraza pública
  real la tiene y sin ella el jugador se cae. El cartel va en letra cursiva, como los toldos. El techo del chunk queda (se
  ve de lejos) y el hueco de la escalera se abre con el mismo recorte que el lucernario de la Casa.
- **McDonald's.** Se ajusta a los carriles del AutoMac de OSM: 13,2 m de fondo en vez de 15,4. El "patio del fondo" es
  la franja este de la parcela, adentro del anillo del AutoMac, con pared de ladrillo alrededor. El salón queda unos 9 m
  más corto que el rectángulo satelital.
- **Guernica.** 12 m de frente sobre Spiro, 16 m de fondo y 2 pisos, con el patio de adelante hasta la vereda. El balcón
  del piso 1 se probó junto con las apariciones en el mundo hueco.
- **Cine.** Mide 8,0 m de alto, porque una sala con gradas no entra en un piso de 3,8 m. La franja delante del cine es un despeje, no un patio: el cine no tiene patio. Las salas están a oscuras de
  verdad: se calibró la luz con la exposición de adentro, porque la adaptación del ojo no las puede aclarar.
- **Casa de la Cultura.** El atrio tiene un hueco en el techo con lucernario: el techo del edificio se abre, y una tapa
  de vidrio lo cubre de lejos y se esconde cuando el interior se dibuja. El plafón y las obras de las salas son dibujos
  abstractos sorteados con semilla: no se copia ninguna obra.
- **Bancos.** Detalles de una sucursal argentina: cajeros con pantalla encendida y su cartel de "Autoservicio", cajas
  numeradas, el turnero "C 042", sillas de espera unidas, escritorios con monitor y el tesoro como un dibujo en la pared.
  Colores del Nación ≈ #005ba4 y #59b7e6.
- **Escaleras.** El ancho mínimo de 1,2 m es el de la huella: un pasamanos que entra 5 cm se acepta, como en los códigos
  reales.

### Luz y aspecto

- **El ojo se adapta** al entrar y al salir (~1 s), como en la realidad, y así los interiores se juegan aunque afuera
  pegue el sol.
- **La calibración de la luz se hizo una sola vez, al final** (T11c), con los 9 interiores armados. Calibrar por tarea con
  datos a medias hacía rehacer los colores varias veces.
- **Los carteles de marca brillan como cajas de luz:** son lo que hace reconocible un lugar, y el test mira el color que
  se ve en pantalla.
- **Las vidrieras del atlas se aclararon en todos los lotes:** de día una vidriera no es negra, y el salto entre la
  vidriera pintada y el interior se achica. Solo en planta baja; los pisos de arriba quedaron como estaban.
- **Interiores que no se vean lavados:** sombreado por cara en los muebles, paneles que no iluminan su propio
  cielorraso, menos luz ambiente y pisos de tono medio, con tests de contraste. Las ventanas pueden ser tan claras como
  un panel, o más, porque de día lo son.
- **El blanco de La Veneciana** se corrigió en su propio lugar, sin tocar la exposición de afuera.
- **La ganancia global** (que un interior visto desde otro se vea más claro) se aceptó: con el ojo adentro casi nunca se
  dibuja otro interior.
- **El tono de los blancos (k = 1,25) y el hall de la Casa se quedan como están.** Son cuestión de ojo, no de test.
- **Las sendas de OSM no pisan los patios:** la diagonal de la estación entraba por abajo de la baranda a la zona paga.
  Se recortan las sendas con la forma de cada patio.
- **"Bajo techo" es uno solo** (ola final): sobre la planta y por debajo del techo. En la terraza de La Veneciana se está
  al sol, con la exposición de afuera, de pie o agachado entre las barandas.

### Rendimiento

- **Los presupuestos del perf no se suben nunca.** Si algo no entra, se recorta en el interior: baja 130 draw calls y
  130k triángulos, media 245 y 230k, alta 385 y 305k.
- **Cuántos interiores se dibujan:** hasta 8, 18 y 36 draw calls de interiores en baja, media y alta, según el margen
  medido en la parada más cargada.
- **Se mide en las paradas del recorrido.** Una pose de afuera del recorrido que se pase no rompe el test, pero se mide
  y se recorta igual (lo hizo la T11b).
- **La T11 se partió en tres** (botín y e2e, rendimiento, aspecto): eran ~15 frentes en 10 archivos, y un rechazo de
  aspecto no tenía que trabar el botín.
- **Con la cámara adentro se recorta el mundo de afuera,** los carteles se ordenan por celda del atlas y las partes de
  patio y de edificio de cada interior se dibujan por separado. Así entró el balcón del Guernica en las 3 calidades.
- **La pose más justa** es alta en la escalera del andén: 368 draw calls y 299.108 triángulos contra 385 y 305.000. Se
  aceptó así: lo que sumó son marcas que evitan grietas en las paredes.
- **El cambio de calidad entre media y alta vuelve a compactar los interiores** (ola final). Antes, el McDonald's armado
  en alta no entraba en media y desde la vereda de enfrente desaparecía hasta recargar. Lo horneado se reusa mientras
  no cambie el detalle: entre media y alta no se vuelve a hornear (~60 ms en el navegador).
- **Las 3 poses más justas quedan vigiladas en el perf** (ola final): las de alta en el andén de la estación, con los
  mismos presupuestos. Son solo del perf, no del recorrido.

### Botín

- **Adentro de cada lugar hay entre 4 y 12 puntos de botín,** uno cada 40 m² de piso público (la terraza cuenta),
  repartidos entre los pisos según el área. El primero va lo más lejos posible de la puerta, y solo donde se llega
  caminando desde ella.
- **Se ubica en el mundo hueco,** con los árboles de los patios: una caja de munición no cae en el hueco de una escalera
  ni adentro de un tronco.
- **La vereda de la entrada de un lugar con interior no lleva botín** a menos de 50 m de su puerta: su botín está
  adentro.
- **Para juntar algo hay que verlo:** no se junta a través de una pared, un vidrio ni una baranda.
- **Ola final:** los interiores se arman una sola vez (en el juego y al generar el mapa), y el reparto entre pisos
  desempata por nivel aunque los pisos no vengan ordenados. El mapa salió idéntico byte a byte.

### e2e y pruebas

- **La suite completa de Playwright corre con 2 navegadores a la vez** y el recorrido tiene 480 s: con más, SwiftShader
  corre más lento que el reloj y fallan las partidas. Tarda ~8 min. Ninguna verificación se aflojó.
- **Un test que se baja hasta pasar ya no prueba nada:** cuando una cota molestaba, se volvió a la original y se cambió
  el código.
- **Los tests caminan:** entrar por cada puerta, subir cada escalera, rodear un rincón. Con el controlador real del
  jugador, no con atajos.
- **Ola final:** un e2e mira el McDonald's desde la vereda de enfrente mientras la calidad pasa de alta a media y vuelve,
  y tiene que dibujarse en los tres pasos.

## 2. Pendientes para la etapa 3

- **El horneado de la luz (m3).** Hoy se hace todo junto al cargar y al cambiar de detalle (de baja a media o alta): ~1,5
  a 1,8 s en media, con el juego congelado. Hay que hornear de a poco (cuando el interior entra en el radio) o en un
  worker. Entre media y alta ya no se hornea.
- **Vidrieras de un solo lado a más de 60 m.** De lejos se tapan con una tapa opaca, pero las balas cruzan el vidrio.
  Con jugadores reales, el de adentro ve y le pega al de la calle, y el de la calle ve una vidriera ciega. Hay que
  reverlo antes del multijugador.
- **Rendimiento en una placa de verdad.** Todas las cifras son de SwiftShader (draw calls y triángulos). Falta medir fps
  en GPU real.
- **La vereda en el borde (m13).** En el test de aspecto, la vereda pide ≤ 46 y da 45,2: cualquier recalibración de la
  ganancia lo rompe.
- **La escalera de la estación está fija (m14).** `ESCALERA` y `LINEA_U` son números en `estacion.ts`. Si se corre el
  relevamiento del andén, `build:map` se frena (el error dice qué falta), pero hay que mover la escalera a mano.
- **La ganancia global (M5 de la T11c).** Un interior visto desde otro se ve más claro de lo que debería. Hoy casi no
  pasa.
- **Para un ojo humano:** el tono de los blancos con k = 1,25 (el Nación pasó de 177 a 202 de luma, y el Santander) y el
  hall de la Casa de la Cultura, que sigue muy blanco.
- **`kit.ts` tiene ~790 líneas.** Conviene sacar el cascarón a su propio archivo antes de sumarle cosas.

## Cosas que se vieron y no se tocaron

- Cada cambio de calidad tarda ~8 s en SwiftShader, casi todo en armar las texturas de la calidad nueva. Los interiores
  son ~60 ms de eso.
