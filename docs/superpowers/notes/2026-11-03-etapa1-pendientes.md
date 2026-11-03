# Etapa 1: lo que quedó pendiente

Sale de las revisiones por tarea y de la revisión final de la rama `etapa-1-mapa`. Sirve como punto de partida para planificar la etapa 2.

## Primero en la etapa 2 (antes de armas e interiores)

- **Parapetos sin colisión.** Hoy son solo visuales y los jugadores quedan "adentro" del parapeto en el borde del techo. Cuando haya tiros van a ser la cobertura de los techos.
  - Al arreglarlo, revisar que `heightFor` (pisos·3.2 + 0.6) no cuente el parapeto dos veces (ver R14).
- **Troncos y copas.**
  - Se puede subir a la punta de 765 de 3333 troncos y quedar escondido dentro de la copa.
  - El tronco sólido mide 3 m y el dibujado mide entre 4.0 y 4.6 m.
  - Hay que decidir qué sólido llevan el tronco y la copa.
- **Manzanas fusionadas.** Las huellas de Microsoft se unieron en bloques de 2.200 a 12.700 m².
  - 14 de los 28 lugares con cartel caen sobre esos bloques, y 4 de los 9 lugares donde se puede entrar.
  - Los interiores necesitan los lotes reales.
  - Además, por eso hay techos planos enormes y carteles lejos de su lugar: santander a 22 m, casa-de-la-cultura a 34,5 m y cine-pixel a 31,5 m.
- **Prueba de acceso a techos.** `hasAccess` solo verifica que exista una ayuda de escalada. Conviene reemplazarla por una prueba que suba cada techo con `stepPlayer` real, para que un cambio de salto o de alcance no deje techos aislados sin que nadie se entere.
- **Postes de la estación.** Los postes del alero y los de los carteles ADROGUÉ no tienen sólido.

## Antes de la etapa 3 (online)

- **Paso de tiempo fijo.** Hoy `dt` es variable y no hay acumulador (R17), así que el movimiento deriva entre 2 y 6 cm cada 3 s según el ritmo de cuadros. El servidor y el cliente tienen que simular igual.
- **Funciones matemáticas.** `Math.hypot`, `sin` y `cos` no dan resultados idénticos bit a bit entre motores. Revisarlo cuando la física corra en el servidor.

## Menores (cuando se toque el área)

- **Huecos (`src/mapgen/pockets.ts`).**
  - La holgura de 2,5 cm unió a la zona principal un rincón de 5 × 5 cm entre b0922 y b0931 (267.69, 223.70), donde el paso más angosto mide 0,688 m. Entrar ahí es casi imposible.
  - Cuando se alcanza `MAX_FINE_NODES`, el hueco se da por conectado sin avisar. Debería ser un warning fatal.
- **Fachadas por lugar.** Si dos lugares comparten arista, gana el primero y no hay aviso.
- **Recorte por chunk.** Con el chunk elegido por centroide recortado 10 m adentro, el vértice más lejano queda a 204 m y `CULL_PAD` es 177,5 m. Se ve solo con más de 79 % de niebla.
- **Escaleras y peldaños.** Los peldaños planos desaparecen de canto y a más de unos 30 m. Las escaleras de los huecos también aparecen en techos de 3,8 m, donde el resto del mapa usa contenedores.
- **Benchmark.**
  - `bench.ts` copia los helpers `el`/`button` de `overlay.ts`; el panel de resultados debería vivir en el overlay.
  - `benchSecs` no tiene tope.
  - "Medir en" no hace nada si el almacenamiento está bloqueado; conviene pasar la calidad en la URL.
- **Geometría compartida.** `subsetGeometry` (`cells.ts`) comparte buffers entre partes: si se hace dispose de una, se rompen las demás. Además pierde `groups`, `drawRange` y los morph.
- **Helpers duplicados.** `colorAttr`, `colored` y `merge` están repetidos entre `landmarks.ts`, `vegetation.ts` y `props.ts`. Conviene llevarlos a `geometry.ts`. `landmarks.ts` tiene más de 500 líneas.
- **Arranque fallido.** En el camino de error genérico quedan vivos los listeners de input y el renderer.
- **Fotos.**
  - Se rectifican con la calidad del arranque y no se regeneran al cambiarla.
  - No se libera su memoria.
  - La de la Casa de la Cultura es de 2012 y muestra un cartel municipal de la época.
  - La Zorra no tiene foto exterior libre.
- **Pasto entre vereda y fachada.** Queda una franja de pasto donde la fachada está retirada. En las calles comerciales tendría que haber baldosa hasta la pared.
- **Estación.** Los andenes de OSM quedan entre 0,23 y 1,8 m de las vías y no son paralelos a ellas. La trocha está dibujada a 1.435 m, pero el Roca usa trocha ancha de 1.676 m.
- **Resto.** Las revisiones también anotaron detalles de tests, como tolerancias débiles, aserciones vacías en algunos tests de chunks y climb, y tests de UI que faltan.
