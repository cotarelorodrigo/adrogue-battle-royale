# Adrogué Battle Royale: documento de diseño

Fecha: 2026-11-03
Estado: revisado por un constructor; esperando la aprobación del usuario

Convención: lo que decidió el usuario figura sin marca. Lo que decidió Claude dentro de la conversación figura como **(decisión de Claude)**. El usuario puede cambiar cualquiera de esas decisiones al revisar el documento.

---

## 1. Qué es y por qué

Es un shooter en primera persona, en modo battle royale, ambientado en el centro real de Adrogué (partido de Almirante Brown, Buenos Aires). El usuario lo quiere para jugar online con sus amigos, cada uno desde su casa y desde el navegador, sin instalar nada.

Lo que lo hace especial es el lugar. Alguien que conoce el barrio tiene que reconocerlo al entrar por sus calles, edificios, locales y plazas reales. Por eso se pidió el estilo realista y se marcaron 37 lugares concretos que tienen que estar.

Cómo se ve el éxito **(decisión de Claude, derivada de la conversación)**:
- Al aparecer en la estación o en la Plaza Brown, cualquiera del grupo dice "esto es Adrogué" en segundos.
- Una partida entre amigos (4 a 12 jugadores) se juega de punta a punta sin trabas, y dan ganas de jugar otra.

## 2. Objetivos, no-objetivos y anti-objetivos

**Objetivos**
- Reproducir el centro de Adrogué en 3D a escala real, dentro del área definida en la sección 4.1.
- Estilo visual realista, con texturas tipo foto.
- Battle royale todos contra todos, con armas que se encuentran en el mapa, movimiento ágil y techos transitables.
- Multijugador online desde el navegador, con salas que se comparten por link.

**No-objetivos (por ahora)**
- Construir estructuras, como en Fortnite.
- Vehículos.
- Cuentas de usuario, progresión, niveles, skins o tienda.
- Partidas masivas. El objetivo es un grupo de amigos.
- Interiores en todos los edificios. Solo se entra a unos pocos lugares (sección 4.4).
- Celulares. Se juega con teclado y mouse en computadora **(decisión de Claude)**.

**Anti-objetivos (cosas que lo harían un fracaso aunque "funcione")**
- Que no se reconozca Adrogué: un mapa genérico de ciudad con el nombre puesto.
- Que en la computadora de los amigos ande tan lento que no se pueda jugar.
- Que una partida sea mayormente caminar sin encontrarse con nadie.

## 3. El juego

### 3.1 Partida (propuesta de Claude, aceptada por el usuario)
- **Inicio:** cada jugador aparece en un punto aleatorio del mapa, sin armas. No hay avión ni micro del que tirarse.
- **Armas y botín:** hay armas tiradas por la calle, en los techos y sobre todo dentro de los lugares donde se puede entrar, que tienen el mejor botín (por ejemplo, la bóveda de los bancos). Para arrancar hay 4 armas (pistola, escopeta, rifle y francotirador), además de munición, botiquines y chalecos.
- **Movimiento:** correr, saltar y agacharse. A los techos se sube por escaleras, contenedores, paredones y elementos similares. Entre techos cercanos se puede saltar.
- **Zona:** un círculo que se achica, como la tormenta de Fortnite. Fuera del círculo se pierde vida de a poco, y siempre queda dentro del área del mapa.
- **Final:** gana el último que queda vivo. Quien muere no reaparece y mira la partida como espectador. Cada partida dura de 10 a 15 minutos.
- **Jugadores por partida:** de 4 a 12 (suposición de Claude que el usuario no corrigió).
- **Grupos chicos (decisión de Claude):** el tamaño inicial de la zona depende de la cantidad de jugadores. Con 2 o 3 la partida arranca en un círculo más chico, para que no sea puro caminar.
- **Bots:** no están previstos, son un no-objetivo. El generador del mapa no necesita producir datos de navegación para bots.

### 3.2 Cámara y controles
- Primera persona, como en CS (aceptado por el usuario).
- Teclado y mouse: WASD, salto, agacharse, mouse para apuntar **(decisión de Claude)**.

## 4. El mapa

### 4.1 Área
El usuario la ajustó a mano sobre el mapa. Es un rectángulo alineado al norte:
- Suroeste: `-34.80137, -58.39887`
- Noreste: `-34.79351, -58.38246`
- Mide unos 1,5 km de este a oeste por unos 875 m de norte a sur.
- Va desde unas cuadras al oeste de la estación Adrogué, cruza la Av. Espora y termina pasando la Plaza Almirante Brown. La estación y la Plaza Brown tienen que quedar adentro.
- El borde del área es el límite del mapa y no se puede cruzar **(decisión de Claude)**. Lo que hay más allá del borde se puede insinuar visualmente, por ejemplo con siluetas de edificios o niebla, para que el mapa no termine de golpe.
- El terreno es plano, como en el Adrogué real.

### 4.2 Lugares que tienen que estar
Son 37 lugares marcados por el usuario, más la Plaza Almirante Brown, que pidió explícitamente. Las coordenadas salen de OpenStreetMap (ver el Apéndice A). Cada uno tiene que estar en su posición real y tener **el nombre en el cartel**, para que se reconozca al toque.
- En los carteles va el nombre escrito, sin copiar los logos de las marcas **(propuesta de Claude, aceptada)**.

### 4.3 Estilo visual
- **Realista**: el usuario lo eligió entre realista, caricatura y low-poly, después de ver una comparación en 3D.
- **Edificios comunes:** forma real de la planta, altura estimada y texturas genéricas de buena calidad según el tipo (revoque, ladrillo, local con persiana, edificio de departamentos), además de la vereda con baldosa vainilla, el asfalto y otros materiales.
- **Lugares con fotos libres:** la fachada se arma a partir de esas fotos (sección 5.3).
- **Comercios sin fotos libres:** se modelan tomando Street View como referencia visual (forma, colores, materiales, cantidad de ventanas, cartel) y se arman con texturas libres. No se copian ni descargan imágenes de Google.
- **Cuánto trabajo a mano en la etapa 1 (decisión de Claude, sigue el "arrancar y después ir sumando" del usuario):**
  - Los ~30 lugares sin fotos libres son fachadas procedurales configuradas una por una: planta real, altura estimada, colores y materiales elegidos según el tipo de local, y el cartel con el nombre.
  - Se corrigen en iteraciones con lo que el usuario vaya diciendo después de recorrerlos ("La Veneciana es blanca con toldo azul", por ejemplo). No hacen falta modelos hechos a mano.
  - Los ~8 lugares con fotos en Commons usan esas fotos. El constructor se encarga de recortarlas y enderezarlas para que sirvan como textura de fachada.
  - En la etapa 1, los monumentos (San Martín ecuestre, Brown y Esteban Adrogué) son versiones simplificadas: pedestal con la proporción real y figura aproximada. El parecido fiel queda para más adelante.
  - Las fotos propias del usuario se pueden sumar en cualquier momento. No es necesario esperar a la etapa 4.
- **Árboles:** Adrogué es conocido por sus calles arboladas, así que las veredas llevan árboles. También funcionan como cobertura **(decisión de Claude)**.
- **Plazas:** árboles, bancos, monumentos y fuentes, que sirven para cubrirse.
- **Momento del día:** de día **(decisión de Claude)**.

### 4.4 Lugares donde se puede entrar (propuesta de Claude, aceptada)
Son 9 lugares con interior armado:
1. Banco Nación (Esteban Adrogué 1052)
2. Galicia (Esteban Adrogué 1060)
3. BBVA (Esteban Adrogué 1029)
4. McDonald's (Av. Espora)
5. Cine Pixel (la sala a oscuras sirve para emboscadas)
6. La Veneciana (Av. Espora 563)
7. Guernica Bar (Pellerano 706)
8. Casa de la Cultura Almirante Brown (Esteban Adrogué 1224)
9. Estación Adrogué (boletería y andenes)

A los demás edificios no se entra, pero tienen la fachada reconocible y casi siempre se puede subir a sus techos.

### 4.5 Techos y recorrido vertical
- Se anda por los techos y se salta de un techo a otro (lo pidió el usuario).
- Casi todos los edificios tienen que tener techo transitable, y tiene que haber formas de subir (escaleras, contenedores, paredones, rejas, árboles) distribuidas por todo el mapa.

## 5. Datos y fuentes

### 5.1 Lo que se verificó durante la conversación
- **OpenStreetMap** tiene bien cargadas las calles del área (unas 210 vías), las vías del tren y los andenes, y 125 lugares con nombre. Es la fuente para el trazado de calles, las plazas y la ubicación de los lugares.
- **OpenStreetMap tiene solo 30 edificios dibujados** en el área, cuando en realidad hay miles, y casi ninguno tiene altura o cantidad de pisos. **Los contornos de los edificios tienen que salir de otra fuente.** Candidatas: Overture Maps (buildings), Google Open Buildings y Microsoft Global ML Building Footprints. Todas son abiertas y cubren Latinoamérica, y hay que verificar la cobertura real en Adrogué.
- **Elegido al planificar:** Microsoft Global ML Building Footprints (ODbL, release 2026-02-03). Tiene 1233 edificios dentro del área, que coinciden bien con la vista satelital, y ninguno trae altura.
- Los servidores de consulta de OpenStreetMap (Overpass) estuvieron saturados durante la sesión. La descarga directa con la API principal (`/api/0.6/map`) del rectángulo funcionó y pesa alrededor de 1 MB.
- Las teselas de calles y de satélite de Esri se ven sin API key y sirven de referencia visual. Las de OpenStreetMap y CARTO no sirvieron en la herramienta de revisión.

### 5.2 Alturas
No hay datos de altura confiables en OpenStreetMap. Las alturas se estiman. Ver la sección 9.

### 5.3 Fotos e imágenes
- **No se usa nada descargado de Google Maps ni de Street View**, porque sus condiciones de uso lo prohíben. Street View solo se mira como referencia.
- **Wikimedia Commons** tiene unas 80 fotos útiles de Adrogué, mayormente con licencia CC BY-SA, que exige citar al autor. Hay fotos de la estación (2022 y 2025), la Plaza Brown y su monumento, el Monumento a Esteban Adrogué, la Casa de la Cultura, la Plazoleta Las Delicias, la Plaza Bynnon y La Zorra, además de fotos de calles como Esteban Adrogué, la Av. Espora y el paseo comercial.
- **Mapillary** (fotos de calle con licencia CC BY-SA): no se pudo verificar la cobertura en Adrogué. Su API necesita una cuenta gratuita.
- **Texturas genéricas:** de bibliotecas libres como ambientCG o Poly Haven, con licencia CC0.
- **Fotos propias del usuario:** pueden reemplazar cualquier fachada más adelante.

### 5.4 Créditos y licencias
El juego tiene que incluir una pantalla de créditos con: OpenStreetMap (ODbL), la fuente de los edificios con su licencia, cada foto CC BY-SA con su autor, y las texturas usadas.

## 6. Tecnología

- **Cliente:** three.js en el navegador (lo pidió el usuario). Chrome, Edge y Firefox de escritorio **(decisión de Claude)**.
- **Servidor:** Node.js con WebSockets. Es la autoridad sobre la partida: decide los impactos, la vida, el botín y la zona, para que hacer trampa no sea fácil **(decisión de Claude)**.
- **Salas:** alguien crea una sala y comparte el link **(decisión de Claude)**.
- **Hosting:** un servicio gratuito donde pueda correr un proceso Node con WebSockets. Que sea gratuito lo decidió el usuario. El servicio concreto queda a criterio del constructor.
- **Generación del mapa:** el mapa se genera antes de jugar, a partir de los datos, con un proceso reproducible. El juego carga el resultado ya armado y no consulta servicios externos de mapas mientras se juega **(decisión de Claude)**.
- **Máquinas de los jugadores (lo dijo el usuario):** notebooks comunes. La referencia es una notebook de 2020 en adelante con gráficos integrados **(decisión de Claude)**.
- **Si lo realista y lo fluido chocan, gana lo fluido (decisión del usuario).** El juego ofrece calidad baja, media y alta. En calidad media, la notebook de referencia tiene que dar 60 fps a 1080p, y nunca menos de 30 fps estables en calidad baja. Para lograrlo con un estilo realista sobre 1,3 km² y miles de edificios hacen falta niveles de detalle, geometría agrupada, atlas de texturas y un límite de distancia de dibujo. Si hay que recortar, se recorta realismo.
- **Distancia de visión:** es un tema de rendimiento, pero también de juego, porque afecta al francotirador y a poder ver los lugares de lejos. El constructor la ajusta con la regla de que gana lo fluido.

## 7. Etapas (orden propuesto por Claude)

El usuario quiere "arrancar y después ir sumando". El orden es:

1. **Mapa caminable.** Página web donde se recorre el área en primera persona: calles, veredas, edificios con planta real, texturas realistas, árboles, plazas, los 38 lugares con sus carteles y fachadas, techos transitables con formas de subir, y colisiones. Sin armas, sin interiores y sin red.
   - **Hecho cuando:** se puede caminar desde la estación hasta la Plaza Brown por la calle y por los techos, se reconocen los lugares marcados y anda bien en una notebook común.
2. **Juego en solitario.** Interiores de los 9 lugares, armas, botín, vida, chalecos, botiquines y zona que se achica. Se prueba con blancos o maniquíes.
3. **Online.** Servidor, salas por link, sincronización, impactos validados por el servidor, partida completa de principio a fin y modo espectador.
4. **Mejoras.** Fotos propias, edificios históricos que el usuario no marcó pero que existen en la zona (Palacio Municipal, Parroquia San Gabriel, Castelforte, La Cucaracha, Casa Borges), más interiores y ajustes de balance.

Este documento cubre todo el juego para que la etapa 1 se construya sabiendo lo que viene después. El plan detallado empieza por la etapa 1.

## 8. Restricciones

- Todo tiene que correr en el navegador, sin instalar nada.
- Solo se usan datos e imágenes con licencias que permitan reutilizarlos, y se cita a los autores.
- Nada de Google Maps ni Street View como fuente de imágenes.
- Las marcas se muestran con su nombre en el cartel, sin logos.
- **Todo gratis (decisión del usuario).** No se compran modelos, texturas, sonidos ni servicios pagos.
  - Los personajes, las armas, las animaciones y los sonidos salen de fuentes libres, como Kenney, Quaternius, Poly Haven, ambientCG y Freesound (solo con licencias CC0 o CC BY).
  - Se acepta que los personajes y las armas se vean menos realistas que la ciudad. Claude lo avisó y el usuario eligió igual todo gratis.
  - Las fuentes que piden crear una cuenta, como Mixamo para animaciones, son opcionales y la cuenta la crea el usuario.
  - El hosting también tiene que ser gratuito.

## 9. Lo que queda a criterio del constructor

- La fuente concreta de los contornos de edificios (Overture, Google o Microsoft), según la cobertura real en Adrogué.
- Cómo estimar las alturas. Puede ser por tipo de edificio, por superficie de la planta, a partir de un dataset de alturas o con valores por zona. Los 38 lugares marcados pueden llevar alturas puestas a mano.
- Cómo se generan y distribuyen las texturas, las fachadas y los elementos para trepar.
- El formato del mapa generado y cómo se divide para cargarlo.
- El motor de física y colisiones.
- La organización del código y del repositorio, y las herramientas de build.
- El servicio de hosting.
- La distribución exacta del botín y el balance de las armas.

---

## Apéndice A: los 38 lugares

Las coordenadas salen de OpenStreetMap (2026-11-03). "Se entra" indica los lugares con interior.

| # | Lugar | Tipo | Lat | Lon | Se entra |
|---|---|---|---|---|---|
| 1 | BBVA | Banco | -34.798398 | -58.392374 | Sí |
| 2 | Banco Itaú - Adrogué Suc 84 | Banco | -34.796430 | -58.389168 |  |
| 3 | Banco Nación (Esteban Adrogué 1052) | Banco | -34.798586 | -58.392217 | Sí |
| 4 | Banco Nación (otra sucursal) | Banco | -34.795494 | -58.396846 |  |
| 5 | Banco Provincia | Banco | -34.798050 | -58.393278 |  |
| 6 | Galicia | Banco | -34.798606 | -58.392087 | Sí |
| 7 | ICBC | Banco | -34.797480 | -58.391750 |  |
| 8 | Macro | Banco | -34.797645 | -58.388998 |  |
| 9 | Santander | Banco | -34.798433 | -58.390473 |  |
| 10 | Guernica Bar | Bar | -34.798873 | -58.391332 | Sí |
| 11 | La Zorra | Bar | -34.798993 | -58.391951 |  |
| 12 | The Way | Bar | -34.797704 | -58.386146 |  |
| 13 | Casa de la Cultura Almirante Brown | Centro cultural | -34.798719 | -58.390055 | Sí |
| 14 | Cine Pixel | Cine | -34.799848 | -58.397106 | Sí |
| 15 | José Mármol Club | Club | -34.797222 | -58.382794 |  |
| 16 | Stallion Fútbol 5 | Cancha | -34.794154 | -58.386708 |  |
| 17 | Clínica I.M.A. SA | Clínica | -34.800743 | -58.398482 |  |
| 18 | Danke | Comida rápida | -34.801169 | -58.384727 |  |
| 19 | Lo de Carlitos | Comida rápida | -34.800347 | -58.397173 |  |
| 20 | McDonald's | Comida rápida | -34.796090 | -58.388472 | Sí |
| 21 | Colegio Alfa | Escuela | -34.796493 | -58.386318 |  |
| 22 | Estación Adrogué | Estación | -34.797811 | -58.394237 | Sí |
| 23 | La Veneciana | Heladería | -34.795163 | -58.388631 | Sí |
| 24 | Lucciano's | Heladería | -34.798739 | -58.391583 |  |
| 25 | Escultura General San Martín | Monumento | -34.797915 | -58.394773 |  |
| 26 | Monumento a Esteban Adrogué | Monumento | -34.797403 | -58.388469 |  |
| 27 | Monumento a San Martín | Monumento | -34.798106 | -58.394886 |  |
| 28 | Monumento al Almirante Guillermo Brown | Monumento | -34.798021 | -58.384416 |  |
| 29 | Parque de la Fuente | Plaza | -34.798758 | -58.384594 |  |
| 30 | Plaza Bynnon | Plaza | -34.794762 | -58.383670 |  |
| 31 | Plaza Rosales | Plaza | -34.800508 | -58.388709 |  |
| 32 | Plaza San Martín | Plaza | -34.798018 | -58.394555 |  |
| 33 | Plazoleta Las Delicias | Plaza | -34.799197 | -58.390138 |  |
| 34 | El Faro | Restaurante | -34.798369 | -58.390746 |  |
| 35 | Filomena | Restaurante | -34.798753 | -58.391067 |  |
| 36 | La Delicia | Restaurante | -34.800109 | -58.388568 |  |
| 37 | La Florencia | Restaurante | -34.795910 | -58.386036 |  |
| 38 | Plaza Almirante Brown | Plaza | -34.798024 | -58.384465 |  |

## Apéndice B: material de referencia de la sesión

Las pantallas de la sesión de diseño (mapa del área, lugares y comparación de estilos) quedaron guardadas en `.superpowers/brainstorm/`. Ese directorio hay que agregarlo a `.gitignore`.
