# Fachadas reales: piloto en Esteban Adrogué

**Estado:** diseño para aprobar.
**Viene después de:** la etapa 1 (mapa caminable), que ya está terminada y en `main`.
**Va antes de:** la etapa 2 (juego en solitario).
**Diseño general del juego:** `docs/superpowers/specs/2026-11-03-adrogue-battle-royale-design.md`.
**Pendientes de la etapa 1:** `docs/superpowers/notes/2026-11-03-etapa1-pendientes.md`.

## 1. Qué es y por qué

El usuario recorrió el mapa y quiere que cada cuadra se vea como la ciudad real. Hoy el frente de una manzana es un solo bloque con el mismo módulo repetido. Por eso dos locales vecinos que en la realidad son distintos salen iguales. Su ejemplo: el Banco Provincia tiene su cartel, pero la textura y el color son iguales a los de los locales de al lado.

Esta etapa cambia eso: **cada local o edificio del frente tiene su propio aspecto.** Se arranca con un piloto en una sola calle, **Esteban Adrogué**, para ver cómo queda. Si el usuario lo aprueba, el mismo método se extiende a otras calles en etapas siguientes.

Lo que más le importa al usuario, en este orden:
1. **Los colores de cada edificio.**
2. **Los textos y los carteles:** el nombre real de cada local, con los colores de su cartel.
3. **Las formas:** la altura y la cantidad de pisos de cada edificio. Tiene que notarse una casa baja al lado de un edificio de varios pisos, o una vidriera al lado de un portón.

Cómo describe la calle el usuario: es de **empedrado** y tiene muchos locales, desde bancos hasta heladerías, zapaterías y casas de cambio.

## 2. Objetivos, no-objetivos y anti-objetivos

**Objetivos del piloto**
- **Cobertura.** Las dos veredas de Esteban Adrogué dentro del área de juego. En OpenStreetMap son unos 583 m de calle, o sea unas 6 cuadras y unos 12 frentes de manzana.
- **Datos de cada frente.** Cada frente se divide en lotes, uno por local o edificio, como se ven en la calle. Cada lote tiene:
  - el ancho sobre la vereda;
  - la altura o cantidad de pisos;
  - el color o los colores de la fachada;
  - el tipo de planta baja: vidriera, persiana, portón, puerta de casa, entrada de banco, etc.;
  - el toldo, si tiene, con su color;
  - el cartel: texto, colores, estilo de letra aproximado y posición;
  - lo más visible de los pisos de arriba: cantidad y tipo de ventanas, balcones, material (revoque, ladrillo, vidrio).
- **Forma.** Cada lote se levanta a su propia altura, al menos en la franja que da a la calle. Así se ve el perfil real de la cuadra. También se puede subir a esos techos, como al resto.
- **Calzada.** Esteban Adrogué se dibuja de empedrado.
- **Locales de OpenStreetMap.** Los locales que OSM tiene sobre Esteban Adrogué aparecen con su cartel, aunque no estén entre los 38 lugares. Hoy hay unos 22 a 30 m de la calle y 20 tienen nombre, entre ellos Galicia, Santander, Macro, Supervielle, Banco Nación, BBVA, Bonafide, Lucciano's, Subway, El Faro y Filomena.
  - Si Street View muestra un nombre distinto o un local que OSM no tiene, manda Street View.
- **Archivo editable.** Todos los datos quedan en un archivo dentro de `data/`, en un formato que el usuario pueda editar a mano para corregir un color, un nombre o un ancho sin tocar código. Al regenerar el mapa, la corrección aparece en el juego.

**No-objetivos**
- Otras calles. Quedan para después del piloto.
- Interiores. Son de la etapa 2, aunque los lotes de esta etapa le sirven a la etapa 2 (ver sección 6).
- Copiar las fotos tal cual. El resultado tiene que ser reconocible, no idéntico píxel por píxel.
- Logos.

**Anti-objetivos.** El piloto fracasa, aunque funcione, si pasa alguna de estas cosas:
- Dos locales vecinos que en la realidad son distintos se siguen viendo iguales.
- Algún pixel de Google termina dentro del repo o del juego.
- El juego anda menos fluido. Sigue valiendo "gana lo fluido": tienen que respetarse los presupuestos de `e2e/perf.spec.ts`.
- Se rompe lo que ya funciona: caminar, subir a los techos, colisiones, huecos con salida y los carteles de los 38 lugares.

## 3. Restricciones

Siguen valiendo todas las del diseño general (sección 8), con estos cambios que aprobó el usuario en esta conversación:

- **Street View como referencia visual.**
  - Claude mira Street View cuadra por cuadra desde el Chrome del usuario, con la extensión de Claude, y anota lo que ve: colores, anchos, pisos, carteles y plantas bajas.
  - Las capturas que haga para mirar quedan solo en el scratchpad de la sesión. Nunca se commitean, nunca se publican y nunca se usan como textura.
  - Esto ya estaba permitido en el diseño general (sección 4.3: "se modelan tomando Street View como referencia visual").
- **Marcas: cambia la regla.** Antes era "solo el nombre escrito en el cartel, sin logos". Ahora se permiten los **colores de la marca** en el cartel y en la fachada, por ejemplo el verde del Provincia o el azul del Nación, y el **nombre escrito con una letra parecida** a la real.
  - **Logos, no.** Ni copiados ni redibujados, porque el repo es público en GitHub (`cotarelorodrigo/adrogue-battle-royale`).
  - Hay que actualizar la sección 8 del diseño general.
- **Texturas libres.** Solo CC0 o CC BY, igual que hasta ahora, de Poly Haven, ambientCG u otras. Hacen falta texturas nuevas, como empedrado, vidrio y metal de vidriera, y deben quedar en `data/sources.json`.
- **Navegación.** Sigue sin consultarse ningún servicio externo de mapas en tiempo de juego. Todo sale pre-generado.

## 4. Cómo se hace (lo ya decidido)

- **Relevamiento.**
  - Claude recorre Esteban Adrogué en Street View, frente por frente.
  - Para cada frente anota los lotes en orden, desde una esquina, con su ancho estimado. Lo calibra con el largo real del frente en el mapa, para que la suma cierre.
  - Anota también la fecha de la imagen de Street View de cada frente, porque los locales cambian.
- **Revisión del usuario.** Después de relevar la primera cuadra, Claude le muestra al usuario la cuadra armada en el juego antes de relevar el resto. Así se corrige el criterio temprano.
- **Datos.** Un archivo nuevo en `data/` con los frentes y sus lotes. Lo lee mapgen, lo valida con mensajes de error claros y lo vuelca en `adrogue.map.json`.
- **Calzada.** Esteban Adrogué va de empedrado aunque OpenStreetMap la marque como asfalto, porque así lo dijo el usuario y Street View lo confirma.
- **Otras calles de empedrado.** OpenStreetMap ya marca 41 tramos de otras calles del área como `sett` o `cobblestone`, y hoy se dibujan de asfalto. Usar esa marca en todas las calles cuesta poco y va con el objetivo de la etapa, así que entra. **Es decisión de Claude.**
- **Quién releva (decisión de Claude).** El relevamiento lo hace Claude en la sesión principal, con el Chrome del usuario. No lo hace un subagente, porque el navegador del usuario es uno solo. El usuario está presente en la revisión de la primera cuadra.
- **Carteles sin duplicar (decisión de Claude).** Sobre Esteban Adrogué, el lote relevado manda.
  - Si un lote corresponde a uno de los 38 lugares (Banco Nación, Galicia, BBVA, Casa de la Cultura, etc.) o a un local de OSM, se reconoce por nombre y cercanía y hay un solo cartel: el del lote.
  - El lugar conserva su id, su punto de aparición y su menú de teletransporte.
- **Revisión del usuario al final.** El usuario recorre Esteban Adrogué en el juego y marca lo que no coincide. Se corrige editando el archivo de datos.

## 5. Lo que queda a criterio del constructor

- **El formato del archivo de datos,** con dos condiciones:
  - que un humano lo pueda editar;
  - que distintos lotes puedan compartir las mismas piezas: tipos de planta baja, estilos de ventana, estilos de cartel.
- **Cómo se dividen los bloques fusionados de Microsoft** en lotes sobre el frente. Puede ser solo la franja que da a la calle, con una profundidad razonable, o el bloque entero. Se elige lo que convenga, siempre que:
  - los techos queden transitables y con forma de subir;
  - no aparezcan huecos sin salida (ya existe el análisis de huecos en `src/mapgen/pockets.ts`);
  - la colisión coincida con lo que se ve.
- **La técnica de dibujo,** con estas condiciones:
  - Cada lote tiene su color, sus módulos y su cartel.
  - Las llamadas de dibujo no se multiplican por lote. Se puede usar color por vértice, un atlas de texturas para módulos y carteles u otra técnica equivalente.
- **Cuántas capturas de Street View mirar por frente.**
- **Qué texturas libres usar.**
- **Cómo convivir con la foto de la Casa de la Cultura** (Esteban Adrogué 1224):
  - quedarse con la foto y corregir la altura del edificio;
  - o reemplazarla por la fachada relevada.
- **Cómo se ordena el trabajo,** respetando la revisión del usuario después de la primera cuadra.

## 6. Relación con lo que viene

- **Etapa 2.** Cuatro de los nueve lugares donde se va a poder entrar están sobre Esteban Adrogué: Banco Nación (1052), Galicia (1060), BBVA (1029) y la Casa de la Cultura (1224). Los lotes de este piloto les dan el edificio real que sus interiores necesitan, y adelantan para esta calle el pendiente "manzanas fusionadas" de `docs/superpowers/notes/2026-11-03-etapa1-pendientes.md`.
- **Otras calles.** Si el piloto funciona, la idea es extenderlo después a Espora y al resto de las calles comerciales, con el mismo archivo y el mismo método.
