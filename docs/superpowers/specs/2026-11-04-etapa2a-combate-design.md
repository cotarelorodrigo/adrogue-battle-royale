# Etapa 2a: combate en solitario — diseño

**Contexto.** Es la etapa 2 del diseño general (`docs/superpowers/specs/2026-11-03-adrogue-battle-royale-design.md`, §7):
"Juego en solitario. Interiores de los 9 lugares, armas, botín, vida, chalecos, botiquines y zona que se achica. Se prueba
con blancos o maniquíes."

**Cómo se decidió.** El usuario dejó a Claude trabajando de noche, con estas palabras: "si te queda tiempo commitea e
inicia la siguiente etapa. tomas las decisiones necesarias". No hubo preguntas. **Todo lo que sigue es decisión de Claude**,
salvo lo que ya fija el diseño general. El usuario lo revisa a la mañana y lo que no le guste se cambia.

## 1. Alcance: la etapa 2 se parte en dos

- **2a (este documento): el combate.** Armas, munición, vida, chaleco, botiquines, botín en la calle y en los techos,
  zona que se achica, maniquíes como rivales, pantalla de victoria y de derrota. También entran los pendientes de la etapa 1
  que el combate necesita: parapetos con colisión, troncos, postes de la estación y paso de tiempo fijo.
- **2b (otro documento, después): los interiores de los 9 lugares.** Necesitan lotes reales. Los 4 lugares de Esteban
  Adrogué (Banco Nación, Galicia, BBVA y Casa de la Cultura) ya los tienen gracias a la etapa de fachadas. Los otros 5 caen
  en bloques fusionados de Microsoft y hay que relevar sus lotes primero.
  - Mientras tanto, el botín de los lugares entrables se pone en la vereda, frente a la puerta.

**Por qué este orden.** Con el combate andando, la partida ya se puede jugar de punta a punta contra maniquíes. Los
interiores agregan lugares donde pelear, pero no cambian las reglas.

## 2. La partida de práctica

- Al tocar "Hacé click para jugar" empieza una partida. El jugador aparece en un punto aleatorio, sin armas.
  - Se mantiene el menú de lugares (M) para recorrer sin pelear: un lugar elegido ahí arranca el modo **paseo**, sin
    zona ni maniquíes, como en la etapa 1.
- **Maniquíes.** 11 por defecto (12 jugadores en total), ubicados en puntos de aparición aleatorios. Quietos y de pie,
  con vida 100 y un chaleco sorteado entre 0, 25 y 50, como un jugador que ya juntó algo.
  - La zona también los lastima. Así la partida termina aunque el jugador no encuentre a todos.
  - Son sólidos: no se los atraviesa. Un tiro que nace adentro de un cuerpo no le pega a ese cuerpo.
  - Todos (el jugador también) aparecen adentro del primer círculo de la zona, a 10 m o más de su borde.
  - `?maniquis=N` (0 a 23) cambia la cantidad, para probar. Con 0 es práctica libre: no hay victoria por eliminación y
    la partida termina solo si el jugador muere.
- **Final.**
  - Si el jugador queda último en pie, gana.
  - Si muere, pierde y ve cuántos quedaban vivos. Si muere en el mismo paso que el último maniquí, es empate con la
    zona.
  - Las muertes por la zona no cuentan como eliminación de nadie. Con la zona cerrada del todo, lastima a todos, aun en
    el centro.
  - En los dos casos aparece una pantalla con "Jugar de nuevo".
- **Duración.** La zona se cierra del todo a los 12 minutos.

## 3. Vida, chaleco y botiquines

- **Vida** 100. **Chaleco** de 0 a 100: recibe el daño primero, como el escudo de Fortnite.
- **Chaleco** (botín): al juntarlo suma 50, hasta 100. Se aplica en el momento.
- **Botiquín** (botín): se guardan hasta 3.
  - Se usa con H. Tarda 3 s y cura 50, hasta 100.
  - Disparar o cambiar de arma lo cancela. Mientras dura se camina lento.

## 4. Armas

- **Modelo de disparo.** Las 4 armas son *hitscan*: un rayo contra el mundo de colisión y contra los cuerpos.
  - No hay caída de bala. Es más simple y alcanza para un grupo de amigos.
  - El servidor de la etapa 3 va a usar el mismo código, que vive en `src/shared/`.
- **Ranuras.** Hay 2 ranuras de arma: teclas 1 y 2, o la rueda del mouse.
  - Juntar un arma con las dos ranuras llenas cambia la que está en la mano: la que se tenía queda en el piso, con las
    balas que tenía en el cargador.
  - El arma que se saca tarda 0,25 s en poder disparar (`MATCH.raise`), lo mismo que dura su animación.
- **Daño por zona del cuerpo.** La cabeza multiplica ×1,5, y ×2 con el francotirador. Las piernas multiplican ×0,75.

| Arma | Daño | Cadencia | Cargador | Recarga | Dispersión (quieto / moviéndose) | Alcance | Munición |
|---|---|---|---|---|---|---|---|
| Pistola | 22 | 4/s, tiro a tiro | 12 | 1,2 s | 1° / 2,5° | 120 m | liviana |
| Escopeta | 8 perdigones × 10 | 1,1/s | 6 | 2,4 s | 5° / 6° | 35 m, con daño que baja desde los 10 m | cartuchos |
| Rifle | 20 | 9/s, automática | 30 | 2,0 s | 0,8° / 3° | 250 m | liviana |
| Francotirador | 95 | 0,7/s | 5 | 3,0 s | 0° con mira / 6° sin mira | 400 m | pesada |

- **Dispersión.** "Moviéndose" es una velocidad de más de 0,5 m/s, contando la vertical: saltar o trepar también cuenta.
  El francotirador no mira el movimiento: 0° con mira y 6° sin mira. A las otras armas, apuntar les divide la dispersión
  de la tabla por 2.
- **Cargador vacío.** Gatillar con el cargador vacío suena un clic y, si hay reserva, empieza la recarga. Sin reserva,
  el HUD dice "Sin munición".

- **Mira.** El clic derecho apunta: baja la dispersión a la mitad y acerca la vista (fov 55° con el rifle, la pistola y
  la escopeta, 20° con el francotirador).
- **Munición.** Hay 3 tipos: liviana, cartuchos y pesada. Cada caja trae 30 de liviana, 12 cartuchos o 8 de pesada.
  Se cargan hasta 180, 48 y 32.
- **Cómo se ven.** Las armas, en primera persona y tiradas en el piso, se arman con cajas y cilindros en código.
  - No se baja ningún modelo. Los modelos libres (Kenney, Quaternius) quedan para cuando el usuario los apruebe, porque
    bajar archivos nuevos necesita su permiso.
  - Cada arma tiene silueta y color distintos, para reconocerla de lejos.
- **Cómo suenan.** Los sonidos se sintetizan con WebAudio (ruido filtrado más un golpe grave): disparo distinto por
  arma, recarga, impacto, pasos no. No se baja ningún archivo.
- **Lo que se ve al disparar.**
  - Fogonazo y trazador.
  - Marca de impacto en la pared: un decal chico que se borra a los 10 s, con un máximo de 64.
  - Marca de acierto en la mira, distinta si es a la cabeza.
  - Número de daño flotante.

## 5. Botín

- **Puntos de botín.** Los genera el mapa (`map.lootSpots`), en tres niveles:
  - **calle:** sobre las veredas de las calles vehiculares, un punto cada 50 m de calle (alternando la vereda), a 50 m o
    más de cualquier otro, y sin superponerse con props.
  - **techo:** sobre techos que se pueden alcanzar de más de 60 m², a 50 m o más entre sí (en planta). Entre dos
    vecinos gana el más alto.
  - Al pie de la letra (un punto cada 25 m y uno por techo) salían unos 1700 puntos, el triple de lo que pide una partida
    de 12. Con la separación de 50 m quedan 525: 231 de calle, 258 de techo y 36 de lugar. En promedio hay un punto a
    23 m, y a 76 m como máximo. Se ajusta con las constantes de `src/mapgen/loot-spots.ts`.
  - **lugar:** 4 puntos frente a la puerta de cada uno de los 9 lugares entrables, hasta que existan los interiores.
- **Qué sale en cada punto.** Se sortea al empezar la partida con una semilla (`src/shared/loot.ts`, PRNG propio, no
  `Math.random`). En la etapa 3 lo sortea el servidor con el mismo código.

| Nivel | Nada | Arma (con 1 caja de su munición) | Munición | Chaleco | Botiquín |
|---|---|---|---|---|---|
| calle | 40 % | 25 % | 20 % | 7 % | 8 % |
| techo | 20 % | 35 % | 20 % | 13 % | 12 % |
| lugar | 0 % | 50 % | 15 % | 20 % | 15 % |

- **Qué arma sale.**
  - En la calle: pistola 40 %, escopeta 30 %, rifle 22 %, francotirador 8 %.
  - En los techos y los lugares: 20 %, 25 %, 35 % y 20 %, en ese orden.
- **Cómo se junta.** Con E, mirando el objeto a menos de 2,5 m. Cerca aparece "E: juntar escopeta". Si no se puede
  juntar porque ya se lleva el máximo, aparece apagado, por ejemplo "Chaleco: lleno".
- **Cómo se ve.**
  - Los objetos flotan un poco sobre el piso y giran despacio.
  - Están instanciados por tipo: pocos draw calls.
  - Solo se ven cerca, para no pasar los presupuestos: a menos de 80 m en `baja`, 100 m en `media` y 120 m en `alta`.

## 6. Zona

- **Forma.** Un círculo que se achica en 5 fases. Cada fase tiene una espera y después un cierre.

| Fase | Espera | Cierre | Radio final (relativo al inicial) | Daño afuera |
|---|---|---|---|---|
| 1 | 120 s | 90 s | 60 % | 1/s |
| 2 | 90 s | 75 s | 35 % | 2/s |
| 3 | 75 s | 60 s | 18 % | 4/s |
| 4 | 60 s | 60 s | 7 % | 7/s |
| 5 | 45 s | 45 s | 0 % | 10/s |

Las esperas y los cierres suman 720 s: la zona se cierra del todo a los 12 minutos.

- **Primer círculo.** Cubre todo el mapa: centro en el medio del área y radio igual a la mitad de su diagonal.
  - **Grupos chicos** (diseño general §3.1): con pocos jugadores el radio inicial se escala por √(jugadores/12), con un
    mínimo de 35 %.
- **Círculos siguientes.** Cada uno se elige al azar con la semilla, entero dentro del anterior y dentro del área del mapa.
- **Daño.** Afuera se pierde vida directamente: el chaleco no protege de la zona.
- **Cómo se ve.**
  - Una pared cilíndrica translúcida azul, sin sombra, de 60 m de alto. Si la niebla la tapa, también se ve el borde en
    el piso.
  - El HUD muestra la fase, el tiempo a la próxima y una flecha con la distancia a la zona segura cuando se está afuera.

## 7. HUD y pantallas

- **Abajo a la izquierda:** vida y chaleco, en barras con números.
- **Abajo a la derecha:** arma en la mano, balas en el cargador / total de esa munición, y las dos ranuras.
- **Arriba al centro:** fase de la zona y reloj, y "Quedan N".
- **Centro:** mira, que se abre con la dispersión, y marca de acierto.
- **Mensajes:** "Eliminaste a Maniquí 4", y debajo de la mira "E: juntar…" o "Recargando…".
- **Pantallas de fin:** "¡Ganaste!" o "Te eliminaron — quedaban N", con el tiempo de partida, las eliminaciones y
  "Jugar de nuevo".
- **Controles nuevos:**
  - clic izquierdo: disparar;
  - clic derecho: apuntar;
  - R: recargar;
  - E: juntar;
  - 1, 2 o rueda: cambiar de arma;
  - H: botiquín.

## 8. Pendientes de la etapa 1 que entran acá

- **Paso de tiempo fijo.** La simulación (jugador, armas, zona) corre a 60 Hz con acumulador. La cámara se dibuja con
  el último estado (sin interpolar: a 60 fps no hace falta). Lo pide la etapa 3 y la cadencia de las armas lo necesita
  desde ahora.
- **Parapetos con colisión.** Son la cobertura de los techos. Al sumarlos se revisa que `heightFor` no cuente el
  parapeto dos veces.
- **Troncos.** El sólido sube hasta la altura dibujada del tronco y entra en la copa: nadie queda escondido dentro de la
  copa parado en la punta. Las copas no frenan balas ni jugadores.
  - Queda un hueco: desde 167 techos vecinos se llega a la punta de un tronco y se queda dentro de la copa. Contra
    maniquíes no importa (las copas no frenan balas); se vuelve a mirar en la etapa 3.
- **Postes de la estación.** Los postes del alero y de los carteles ADROGUÉ llevan sólido.
- **Contenedores de basura.** Miden 2,0 m de alto (antes 1,4 m). Con los parapetos sólidos, desde uno de 1,4 m no se
  trepaba al techo de un piso. Ahora son cobertura completa.

## 9. Rendimiento

- Los presupuestos de la etapa 1 no se suben.
- Lo nuevo tiene que entrar en lo que sobra: en `media` hay 245 de presupuesto y la parada más cara usa 208.
  - Maniquíes instanciados: 1 draw call por material.
  - Botín instanciado por tipo, con radio de 80, 100 o 120 m según la calidad.
  - La sombra de los maniquíes solo en `alta`.
  - Zona: 1 draw call.
  - Arma en primera persona: menos de 6 draw calls.
  - Decals: 1 draw call.
- El recorrido de rendimiento suma una parada con maniquíes, botín y la zona a la vista. Todas las paradas se miden
  dentro de una partida con la semilla 42.
- El 4 de noviembre, `media` en esa parada quedó en 226 draw calls y 228.955 triángulos, con unos 1.000 de margen: es
  lo primero que va a fallar si el mapa crece.

## 10. Qué queda fuera de la 2a

- Interiores (2b).
- Rivales que se mueven o disparan. Los bots son no-objetivo del diseño general: los maniquíes alcanzan para probar.
- Red (etapa 3).
- Modelos y sonidos bajados de internet: a decidir con el usuario.
- Agacharse ya existe. Acostarse, no.
