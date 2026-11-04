# Etapa 2b: interiores de los 9 lugares — diseño

**Contexto.** Completa la etapa 2 del diseño general (`docs/superpowers/specs/2026-11-03-adrogue-battle-royale-design.md`,
§4.4 y §7). La 2a hizo el combate; la 2b arma los interiores de los 9 lugares donde se entra:
- Banco Nación, Galicia y BBVA;
- Casa de la Cultura;
- McDonald's;
- Cine Pixel;
- La Veneciana;
- Guernica Bar;
- Estación Adrogué.

**Cómo se decidió.** El usuario pidió: "resolvelo vos. tiene que ser lo más real posible". Todo lo que sigue es decisión de
Claude, salvo lo que ya fija el diseño general.

**De dónde sale lo "real".** Las referencias son fotos públicas de usuarios en Google Maps y Street View.
- Sirven solo para mirar, como en la etapa de fachadas: ninguna imagen entra al repo ni al juego.
- Las notas de lo que se vio en cada lugar están en §4.
- Los bancos no tienen fotos de adentro. Se arma la sucursal típica de cada banco, con sus colores.

## 1. Objetivos y no-objetivos

**Objetivos.**
- Se entra caminando por la puerta real de cada uno de los 9 lugares.
- Adentro, cada lugar se reconoce a primera vista: la distribución, los materiales, los muebles, los colores y los carteles
  (texto y colores de la marca, sin logos) salen de las referencias.
- Los edificios tienen sus medidas y pisos reales. Los 5 lugares que hoy caen en bloques fusionados de Microsoft
  (McDonald's, Cine Pixel, Guernica, La Veneciana y la estación) se relevan primero.
- Adentro se pelea:
  - el botín de los lugares pasa de la vereda al interior;
  - las paredes y los muebles grandes frenan balas y jugadores;
  - las vidrieras dejan ver y disparar.
- Los presupuestos de rendimiento no se suben (diseño general: "que gane lo fluido").

**No-objetivos.**
- Interiores de otros edificios (etapa 4).
- Subsuelos: el piso del mundo es y = 0 y no se baja de ahí.
- Puertas que se abren o se cierran: las entradas son huecos abiertos, con la hoja de vidrio dibujada abierta.
- Vidrios que se rompen.
- Gente, sonido ambiente o música adentro.
- Copiar murales, afiches u obras: donde la referencia tiene una obra, va un panel de colores o un cartel genérico.

**Anti-objetivo.** Un interior que se vea como una caja vacía con texturas de afuera.

## 2. Reglas comunes

### 2.1 Edificios huecos
- El edificio de un lugar deja de ser un prisma macizo. Pasa a tener:
  - paredes con espesor (0,2 m afuera y 0,1 m en los tabiques);
  - huecos de puerta con dintel (2,2 m de alto como mínimo);
  - losas entre pisos;
  - escaleras de escalones sólidos (contrahuella ≤ 0,2 m, huella 0,3 m, ancho ≥ 1,2 m);
  - barandas (1,0 m de alto).
- El techo sigue siendo transitable, con su pretil, como en la 2a.
- **Pisos.** Se entra a los pisos que en la realidad son públicos. Los demás quedan cerrados: una losa sin escalera, y por
  afuera la fachada de siempre.
- **El mismo código para todos.** El interior se genera de forma determinista en `src/shared/` a partir de los datos del
  mapa (el edificio, su frente, la puerta y el tipo de lugar). Así:
  - el servidor de la etapa 3 arma la misma colisión;
  - el JSON del mapa casi no crece: guarda los datos de entrada, no la geometría.

### 2.2 Vidrio
- Las vidrieras de estos 9 lugares son vidrio de verdad: transparente, frena a los jugadores y **no frena las balas**.
  También las mamparas de las cajas de los bancos y las barandas de vidrio de la Casa de la Cultura.
- En la colisión, el vidrio es un sólido con una marca propia que el hitscan ignora.
- Desde la calle se ve el interior a través del vidrio (§2.6).

### 2.3 Muebles
- Se arman con cajas y cilindros en código, como las armas de la 2a. No se baja ningún modelo.
- **Sólidos** (frenan balas y jugadores): todo mueble de 0,7 m de alto o más que tenga cuerpo, como mostradores, barras,
  estanterías, heladeras, vitrinas, sillones, mesas, butacas del cine y molinetes.
- **No sólidos:** sillas, banquetas y lámparas. Se atraviesan, así no traban el movimiento.
- Las mesas son sólidas: se puede usar una mesa para cubrirse agachado.

### 2.4 Materiales y luz
- **Sin descargas.** No se baja ninguna textura nueva. Se usan:
  - las CC0 que ya están (madera, hormigón, revoque, metal);
  - texturas generadas en canvas al arrancar, como el atlas de frentes: porcelanato con juntas, tablas de madera,
    machimbre, baldosas rojas o terracota, cerámicos y tela.
- **Luz propia.** Adentro no pega el sol ni sus sombras. Cada interior tiene su luz: cielorraso, spots y lámparas, que se
  ven como superficies que brillan. Las superficies se iluminan parejo, con algo más de sombra lejos de las ventanas y en
  los rincones. La técnica la elige el constructor (por ejemplo, colores por vértice horneados).
- **El cine es oscuro.** La sala casi no tiene luz: brillan la pantalla, las tiras ámbar de las paredes y las luces de los
  escalones. Sirve para emboscadas, como dice el diseño general.
- **Carteles.** Los nombres de las marcas van como texto con sus colores y una letra parecida, sin logos (diseño general
  §8). Algunos ejemplos: "CAJA KIOSCO", "BOLETERÍA", "Galicia", "BBVA" y "Banco Nación".

### 2.5 Juego
- **Botín.** Los puntos de botín de nivel `lugar` pasan adentro, sobre el piso de cada lugar, en sus pisos públicos:
  - 1 punto cada ~40 m² de piso público, con un mínimo de 4 y un máximo de 12 por lugar;
  - con el mismo margen libre que hoy.

  Las tablas de probabilidad de la 2a no cambian.
- **Aparición.** Los puntos de aparición al azar quedan afuera, como hoy. El menú de lugares (M) teletransporta afuera,
  frente a la puerta y mirándola.
- **Colisión de los puntos libres.** Los chequeos de "punto libre" de mapgen tienen que contar como libre el piso de un
  interior aunque haya una losa arriba. Hoy `supportHeight(…, Infinity)` ve la losa.

### 2.6 Rendimiento
- Los presupuestos no se suben.
- **Cuándo se dibuja.** Un interior se dibuja solo cuando la cámara está adentro, o a menos de 60 m y con el lugar en
  pantalla.
- **Costo.**
  - Cada interior se junta por material: a lo sumo 20 draw calls.
  - Los muebles repetidos (sillas, mesas, butacas, botellas) van instanciados.
- **Recorrido de rendimiento.** Suma 3 paradas:
  - adentro de la Casa de la Cultura, mirando el atrio;
  - adentro del McDonald's, mirando el salón;
  - en la vereda de Espora, mirando las vidrieras de La Veneciana.
- **Si no entra,** se recorta en el interior (detalle, distancia de dibujo), nunca en la tabla de presupuestos.

## 3. Relevamiento de los 5 lugares sin lote

- McDonald's, Cine Pixel, Guernica Bar, La Veneciana y la estación (el edificio de la boletería) se relevan como en la
  etapa de fachadas.
  - De Street View salen el ancho del frente, las puertas y los pisos.
  - De la vista satelital, el fondo y la forma.
  - Las dos son solo referencia.
- **Qué se carga por lugar.** La planta real, con su forma (la esquina redonda de La Veneciana, el patio del Guernica,
  el patio del fondo del McDonald's), la altura, los pisos y las puertas. El mecanismo de datos lo elige el constructor.
  Puede ser un lote suelto en `data/frentes.json` o un archivo nuevo. Tiene que cumplir dos cosas:
  - recorta los bloques de Microsoft como hacen los lotes;
  - si falta un dato o no cierra, `build:map` falla con un mensaje que diga qué corregir.
- Corrige los pisos que hoy salen del azar:
  - el Guernica tiene 2 pisos, no 7;
  - La Veneciana tiene 1 piso más la terraza, no 3.
- **Estación.** El edificio de la boletería hoy pisa un andén. El relevamiento lo ubica al costado del andén, donde está
  en la realidad.

## 4. Los 9 interiores

Las medidas de los lotes ya relevados son las del mapa. Las de los demás salen del relevamiento.

### 4.1 Banco Nación (lote de 9,4 × 15 m, 2 pisos)
- **Al frente: vestíbulo de cajeros**, detrás de la vidriera, de ~3,5 m de fondo.
  - 2 o 3 cajeros automáticos de pie, con la pantalla que brilla.
  - Paredes blancas y cartelería azul y celeste con "BANCO NACIÓN".
  - Luz blanca fría.
- **Una puerta de vidrio da al salón:**
  - línea de cajas al fondo: mostrador de 1,1 m y mampara de vidrio hasta 2,4 m;
  - 2 escritorios de atención con sillas;
  - fila de sillas de espera;
  - turnero con pantalla.
- **En la pared del fondo, la puerta redonda del tesoro.** Está cerrada: es un cartel en relieve, no se entra.
- Porcelanato gris claro y cielorraso blanco con paneles de luz.
- La planta alta queda cerrada.

### 4.2 Galicia (lote de 13,4 × 15 m, 3 pisos)
- El mismo esquema que el Nación, más ancho:
  - vestíbulo de cajeros a un costado;
  - 4 cajas;
  - cartelería naranja con "Galicia".
- Los pisos altos quedan cerrados.

### 4.3 BBVA (lote de 12 × 15 m, 2 pisos, frente de ladrillo)
- El mismo esquema, con cartelería azul con "BBVA" y vestíbulo de cajeros al frente.
- La planta alta queda cerrada.

### 4.4 Casa de la Cultura (lote de 20,5 × 45 m, 4 pisos) — una ex galería con atrio
- **Entrada.** Un hall da a un **atrio** central de ~10 × 20 m, abierto hasta el techo.
- **Lucernario.** Arriba, uno de vidrio a dos aguas con estructura blanca.
  - Debajo cuelga un gran disco pintado: un plafón de colores, sin copiar la obra.
  - El lucernario es vidrio sólido: se puede caminar encima desde el techo y se ve hacia abajo.
- **Balcones.** El atrio tiene balcones en la planta alta 1 y la 2, con:
  - columnas blancas con capitel;
  - baranda de vidrio con pasamanos negro y tramos de reja negra;
  - esquinas curvas.
- **Escaleras.**
  - Una escalera central ancha sube de la planta baja a la alta 1. En la realidad la central baja a un nivel inferior.
    Como no hay subsuelos (§1), acá sube; queda anotado como diferencia con la realidad.
  - Otra escalera, a un costado, sube de la alta 1 a la alta 2.
- **Planta baja.**
  - Porcelanato blanco y crema.
  - Salas de exposición alrededor del atrio, con tarimas y paneles.
  - Un **auditorio** al fondo, con escenario y filas de sillas.
- El piso 4 queda cerrado.

### 4.5 McDonald's (relevar; 1 piso)
- **Salón** detrás del frente vidriado:
  - una zona de piso de tablas de madera clara y otra de porcelanato gris claro;
  - cielorraso de placas oscuras con spots empotrados;
  - tabiques de listones de madera;
  - columnas revestidas en madera.
- **Muebles:**
  - mesas redondas blancas con pie negro;
  - sillas negras con asiento de madera;
  - sillones tapizados en zigzag blanco y negro;
  - banquetas con tapizado amarillo y sillas amarillas;
  - lámparas campana blancas.
- **Mostrador:**
  - frente negro y mesada blanca;
  - cartel "CAJA KIOSCO" con un "1";
  - pantallas de menú que brillan arriba.
- **Cocina** detrás del mostrador: se entra, y es un buen escondite.
  - Mesadas, freidoras y heladeras de acero.
- **Patio del fondo:**
  - pared de ladrillo;
  - mesas de picnic de madera;
  - sombrillas rojas.
- **Afuera:**
  - revestimiento gris oscuro con la franja roja vertical;
  - "McDonald's" en letras blancas sobre el frente;
  - la M amarilla en la torre, como letra, no como logo.

### 4.6 Cine Pixel (relevar)
- **Marquesina:** frente vidriado de piso a techo bajo una marquesina gris carbón con "CINES PIXEL" en letras blancas
  (la P en magenta) y spots.
- **Hall:**
  - porcelanato beige con bandas gris oscuro;
  - paredes blancas y una pared gris oscura;
  - afiches enmarcados genéricos;
  - cielorraso blanco con un cajón con LED azul.
- **Candy bar:**
  - mostrador blanco y negro;
  - máquina de pochoclo;
  - pantallas de menú que brillan;
  - heladera.
- **Salas.** Dos, según lo que entre en la planta relevada: una grande y una chica.
  - Butacas oscuras en gradas.
  - Pantalla grande con marco negro.
  - Paredes negras con tiras ámbar.
  - Escalones con luz.
  - Luz casi nula (§2.4).

### 4.7 La Veneciana (relevar; 1 piso + terraza)
- **Afuera:**
  - edificio blanco con la esquina redonda (cuerpo cilíndrico vidriado);
  - toldos rojos con "La Veneciana";
  - cartel rojo con letra script blanca;
  - en la vereda, sillas director rojas y sombrillas.
- **Salón:**
  - cielorraso de machimbre barnizado con spots y vigas blancas;
  - columnas blancas;
  - cerámico beige;
  - mesas y sillas de madera oscura;
  - un **metegol** sobre una alfombra redonda gris;
  - ventanales en todo el perímetro;
  - mostrador de madera con la vitrina de helados (los baldes de colores que brillan bajo el vidrio).
- **Esquina redonda:** en el cielorraso, un aro blanco.
- **Escalera a la terraza de la azotea:**
  - baranda blanca de caño;
  - baldosas terracota;
  - sombrillas rojas;
  - sillas director rojas y mesas de madera.

### 4.8 Guernica Bar (relevar; 2 pisos)
- **Adelante:** patio con mesas bajo los árboles y guirnaldas de lamparitas.
- **Frente:** cartel de chapa acanalada con "GUERNICA" en letras que brillan y una estrella a cada lado.
- **Planta baja:**
  - barra larga de madera oscura;
  - detrás, estantes iluminados con botellas;
  - torre de canillas cromada en forma de arco;
  - mesas altas y bajas.
- **Escalera a la planta alta:**
  - una parte techada;
  - un balcón al frente con baranda negra;
  - un rincón de escenario;
  - mesas.
- Estilo industrial: metal negro, madera y lamparitas a la vista.

### 4.9 Estación Adrogué (edificio de la boletería, relevar)
- **Paredes:** blancas o crema con **zócalo celeste** (~1,2 m), ventanas con rejas.
- **Adentro:**
  - un hall con las **ventanillas de la boletería** (vidrio y reja) y el cartel "BOLETERÍA";
  - una terminal de carga SUBE;
  - bancos;
  - un mural de azulejos de colores (patrón propio);
  - la puerta del baño, cerrada.
- **Del lado del andén:**
  - una línea de **molinetes** entre el hall y el andén;
  - la escalera de acceso desde la calle, con narices amarillas y baldosas rojas.
- **Alero de los andenes.** Hoy es gris acero; pasa a **verde**, con columnas y chapa verdes, como el real.
  - Los carteles "Adrogué" son azules con letras blancas.
  - El andén lleva la franja amarilla táctil.

## 5. Cómo se prueba

- **Cada interior, con el controlador real del jugador** (como el test de subida a los techos de la 2a). Se entra por cada
  puerta y se llega a cada piso público y al techo, por las escaleras.
- **Disparos:**
  - las paredes y los muebles sólidos frenan el hitscan;
  - el vidrio no lo frena;
  - desde adentro no se le pega a nadie a través de una pared.
- **Botín:** los puntos `lugar` quedan adentro, sobre piso libre, en la cantidad de §2.5.
- **Datos:** el relevamiento valida sus datos con mensajes claros, y `build:map` termina sin avisos.
- **e2e:**
  - teletransportarse a cada lugar, entrar caminando y ver el interior;
  - sin errores de consola;
  - las 3 paradas nuevas de rendimiento, dentro de los presupuestos.

## 6. Qué queda a criterio del constructor

- La estructura de datos de los interiores. Puede ser un módulo por lugar en `src/shared/interiors/` o una descripción
  en datos. Tiene que ser determinista y cumplir §2.1.
- La técnica de iluminación interior (§2.4).
- La forma exacta de cada distribución, siempre que respete §4 y las medidas relevadas.
- Cuántos detalles entran en cada interior, dentro del costo de §2.6.
