# Etapa 2a: combate en solitario — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una partida de práctica completa en el navegador: aparecer sin armas, juntar botín, pelear contra maniquíes, sobrevivir a la zona y ver la pantalla de victoria o derrota.

**Architecture:**
- **Reglas puras y deterministas en `src/shared/`:** armas, daño, botín, zona y partida. Son funciones de estado → estado, sin reloj ni `Math.random`, para que el servidor de la etapa 3 use el mismo código.
- **Generador del mapa:** suma los puntos de botín y los sólidos que faltan (parapetos, troncos, postes).
- **Cliente:** dibuja (instanciado, dentro de los presupuestos), lee la entrada y corre la simulación a paso fijo de 60 Hz.

**Tech Stack:** TypeScript (erasableSyntaxOnly), three.js 0.187, Vite 8, Vitest (jsdom), Playwright (Chrome + SwiftShader), WebAudio.

**Spec:**
- `docs/superpowers/specs/2026-11-04-etapa2a-combate-design.md`: valores exactos de armas, botín, zona, HUD y controles.
- `docs/superpowers/specs/2026-11-03-adrogue-battle-royale-design.md`: el diseño general.

## Global Constraints

- **Rendimiento.** No se suben los presupuestos de `e2e/perf.spec.ts`:

  | Calidad | Draw calls | Triángulos |
  |---|---|---|
  | baja | 130 | 130.000 |
  | media | 245 | 230.000 |
  | alta | 385 | 305.000 |

  Si algo se pasa, se baja su costo.
- **Determinismo.** Todo lo que está en `src/shared/` es determinista: mismo estado + entrada + dt dan el mismo resultado. Nada de `Math.random`, `Date.now` ni `performance.now` ahí. El azar sale de `src/shared/rng.ts` con semilla.
- **Assets.** No se baja ningún archivo nuevo de internet: armas y maniquíes se arman con geometría en código, y los sonidos se sintetizan con WebAudio. Tampoco se usa nada de Google.
- **Idioma.** Textos de la interfaz, comentarios y mensajes de error en castellano rioplatense.
- **Commits.** Terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Mapa.** `npm run build:map` termina sin warnings y el mapa pesa menos de 3 MB.

## Review Focus

1. **Subir a un techo con parapeto.** Desde cada escalera y cada contenedor, el jugador real (`stepPlayer`) tiene que terminar parado sobre el techo, no trabado contra el parapeto.
2. **Disparar desde adentro de un sólido o pegado a una pared.** El rayo sale del ojo. Si el ojo está a menos de 0,3 m de una pared, la bala pega en esa pared: no la atraviesa.
3. **Juntar con el inventario lleno.** Con las dos ranuras ocupadas, el arma de la mano queda en el piso, donde estaba el objeto, y se puede volver a juntar.
4. **La zona termina la partida.** Si el jugador se esconde y no dispara, los maniquíes mueren por la zona y la partida termina (victoria, o derrota si muere el jugador). Nunca queda abierta para siempre.
5. **Volver a jugar.** "Jugar de nuevo" arranca una partida limpia: botín resorteado, maniquíes nuevos, vida 100 y sin armas. No quedan objetos, decals ni listeners de la anterior.

---

### Task 1: Paso fijo a 60 Hz

**Files:**
- Create: `src/shared/fixed-step.ts`
- Modify: `src/client/main.ts` (bucle `frame`)
- Test: `tests/shared/fixed-step.test.ts`

**Interfaces:**
- Produces: `export const SIM_HZ = 60;` y `export class FixedStep { constructor(hz = SIM_HZ, maxSteps = 5); advance(dt: number, step: (h: number) => void): number }`.
  - `advance` devuelve cuántos pasos corrió.
  - Guarda el resto para el próximo cuadro.
  - Si dt pide más de `maxSteps` pasos, corre `maxSteps` y descarta el resto.
  - Un dt ≤ 0 o que no es finito no corre nada.

- [ ] **Step 1: Tests** en `tests/shared/fixed-step.test.ts`:
  - `advance(1/60)` corre 1 paso con `h === 1/60`.
  - Dos `advance(1/120)` corren 0 y después 1.
  - `advance(1)` corre 5 y el siguiente `advance(0)` corre 0 (el resto se descartó).
  - `advance(-1)` y `advance(NaN)` corren 0.
  - 600 llamadas con dt alternando 1/30 y 1/144 corren exactamente `floor(Σdt·60)` pasos (con tolerancia de 1 por redondeo).
- [ ] **Step 2: Correr y ver que fallan.** `npx vitest run tests/shared/fixed-step.test.ts`.
- [ ] **Step 3: Implementar `FixedStep`.** En `main.ts`, `stepPlayer` pasa a correr dentro de `fixed.advance(dt, (h) => …)` con el mismo `cmd`. La cámara se actualiza una vez por cuadro con el último estado.
- [ ] **Step 4:** Correr `npx vitest run` y `npx playwright test e2e/` sin `perf.spec.ts`. **Expected:** PASS.
- [ ] **Step 5: Commit** `feat(sim): la simulación corre a paso fijo de 60 Hz`.

### Task 2: Sólidos que faltan: parapetos, troncos y postes, y prueba real de acceso a los techos

**Files:**
- Modify:
  - `src/shared/collision.ts` (`collisionPrisms`);
  - `src/mapgen/climb.ts` (alto de las escaleras);
  - `src/client/world/geometry.ts` (exportar `PARAPET_H` y `PARAPET_T` desde `src/shared/collision.ts`, que pasa a ser la fuente);
  - `src/client/world/vegetation.ts` y `src/client/world/landmarks.ts`, si hace falta compartir constantes.
- Test:
  - `tests/shared/collision.test.ts`;
  - `tests/mapgen/roof-access.test.ts` (nuevo).

**Interfaces:**
- Produces:
  - `export const PARAPET_H = 0.6, PARAPET_T = 0.2;` en `src/shared/collision.ts`.
  - Prismas con tag `parapet:<buildingId>`: uno por arista del pretil dibujado, el cuadrilátero entre la arista y la arista corrida `PARAPET_T` hacia adentro, de `height` a `height + PARAPET_H`. Los rellenos (`b.fill`) no llevan pretil.
  - Troncos con `maxY` igual al alto del tronco dibujado de su variante, que es más que el actual `TRUNK_H = 3`. El alto sale de una tabla compartida `TREE_TRUNK_H` por variante, exportada desde `src/shared/collision.ts` y usada por `vegetation.ts`.
  - Postes de la estación (alero y carteles ADROGUÉ) como prismas con tag `station-post`. Las posiciones salen de la misma función que usa `landmarks.ts`; si no existe, se extrae a `src/shared/`.
  - Escaleras con `topY = b.height + PARAPET_H` en los edificios con pretil, para que el empuje final pase por encima.
- Consumes: `stepPlayer`, `PLAYER` (`src/shared/player.ts`).

- [ ] **Step 1: Tests de colisión.**
  - Con un edificio cuadrado de 10 × 10 y alto 6:
    - un jugador parado en el techo a 0,5 m del borde, caminando hacia afuera 1 s, sigue en el techo (`pos[1] ≈ 6`, `onGround`);
    - con salto, cae afuera.
  - Un rayo horizontal a `y = 6.3` desde afuera pega a la distancia del pretil.
  - Un relleno (`fill: true`) no tiene pretil.
  - Un tronco de variante 1 bloquea un disco a `y = 4.4` y no a `y = 4.7`.
- [ ] **Step 2: Test de acceso real** en `tests/mapgen/roof-access.test.ts`, sobre `public/map/adrogue.map.json`:
  - Para cada escalera del mapa: `initialState` al pie mirando a la pared y W apretada en pasos de 1/60 s, hasta 20 s.
    - Termina con `mode === 'walk'`, `onGround` y `pos[1]` igual al alto del techo ±0,05.
  - Para 50 contenedores elegidos con semilla fija: arrimarse, saltar, mantle al contenedor y después al techo vecino. Tiene que terminar en un techo.
  - Si alguno falla, el mensaje dice el id del edificio.
- [ ] **Step 3: Correr y ver que fallan.**
- [ ] **Step 4: Implementar.** Después correr `npm run build:map`. Este paso reemplaza la verificación `hasAccess` de `src/mapgen/climb.ts` en los tests: se puede quedar como chequeo rápido, pero el test nuevo es el que manda.
- [ ] **Step 5: Verificar.** `npx vitest run`, `npm run build:map` (0 warnings) y `npx playwright test` (incluye perf y el tour que sube por una escalera). **Expected:** PASS.
- [ ] **Step 6: Commit** `feat(colisión): pretiles, troncos y postes sólidos; prueba real de subida a cada techo`.

### Task 3: Reglas de combate (armas, daño, disparo)

**Files:**
- Create: `src/shared/rng.ts`, `src/shared/combat.ts`
- Test: `tests/shared/rng.test.ts`, `tests/shared/combat.test.ts`

**Interfaces:**
- Produces, en `rng.ts`:
  - `export type Rng = { next(): number }`: uniforme en [0, 1).
  - `export function createRng(seed: number): Rng` (mulberry32).
  - `export function pick<T>(rng: Rng, weighted: readonly (readonly [T, number])[]): T`.
- Produces, en `combat.ts`:
  - `export type WeaponId = 'pistola' | 'escopeta' | 'rifle' | 'francotirador'`
  - `export type AmmoId = 'liviana' | 'cartuchos' | 'pesada'`
  - `export const WEAPONS: Record<WeaponId, WeaponSpec>`, con los valores exactos de la tabla del spec §4: `damage, pellets, rate, auto, mag, reload, spreadStill, spreadMove, range, falloffFrom?, ammo, headMult, aimFov`.
  - `export const AMMO_BOX: Record<AmmoId, number> = { liviana: 30, cartuchos: 12, pesada: 8 }` y `export const AMMO_MAX = { liviana: 180, cartuchos: 48, pesada: 32 }`.
  - `export interface Vitals { hp: number; armor: number }`
  - `export function applyDamage(v: Vitals, dmg: number): Vitals`: el chaleco recibe primero.
  - `export function applyZoneDamage(v: Vitals, dmg: number): Vitals`: solo vida.
  - `export interface Gun { id: WeaponId; inMag: number; nextShotAt: number; reloadUntil: number | null }`
  - `export function newGun(id): Gun`: cargador lleno.
  - `export function canFire(g: Gun, t: number): boolean`
  - `export function fire(g: Gun, t: number): Gun`: consume 1 y fija `nextShotAt = t + 1/rate`.
  - `export function startReload(g: Gun, t: number, reserve: number): Gun`: no hace nada con el cargador lleno o sin reserva.
  - `export function finishReload(g: Gun, t: number, reserve: number): { gun: Gun; used: number }`
  - `export function spreadDirs(rng: Rng, yaw: number, pitch: number, spreadDeg: number, pellets: number): Vec3[]`: conos uniformes en el disco angular.
  - `export interface Hitbox { id: string; pos: Vec3 /* pies */; crouching: boolean }`
  - `export type HitPart = 'cabeza' | 'cuerpo' | 'piernas'`
  - `export function hitscan(world: CollisionWorld, targets: readonly Hitbox[], origin: Vec3, dir: Vec3, range: number): { kind: 'target'; id: string; part: HitPart; dist: number; point: Vec3 } | { kind: 'world'; dist: number; point: Vec3; normal: Vec3 } | null`
    - El cuerpo es un cilindro de radio 0,35 alrededor de `pos`.
    - Partes, parado: piernas de 0 a 0,8, cuerpo de 0,8 a 1,45, cabeza de 1,45 a 1,8. Agachado se escala por 1,2/1,8.
    - El piso (`y = 0`) cuenta como mundo.
  - `export function shotDamage(w: WeaponSpec, part: HitPart, dist: number): number`: cabeza ×`headMult`, piernas ×0,75, y la caída de la escopeta lineal de `falloffFrom` (10 m) a `range` (35 m), hasta el 30 %.

- [ ] **Step 1: Tests.**
  - mulberry32 con semilla 1 da la misma secuencia dos veces, y semillas distintas dan secuencias distintas.
  - `pick` respeta los pesos: 10.000 sorteos de [['a',1],['b',3]] dan a ≈ 25 % ±2.
  - `applyDamage({hp:100, armor:30}, 50)` da `{hp:80, armor:0}`.
  - `applyZoneDamage({hp:100, armor:50}, 10)` da `{hp:90, armor:50}`.
  - Rifle:
    - 30 disparos a 9/s vacían el cargador en 29/9 s;
    - `canFire` es false durante la recarga;
    - `finishReload` con reserva 10 deja `inMag` 10 y `used` 10.
  - `hitscan` contra un maniquí a 10 m:
    - mirando a 1,6 m de alto da `cabeza`, a 1,0 m `cuerpo` y a 0,4 m `piernas`;
    - con una pared en el medio da `world`;
    - apuntando al piso da `world` con normal (0,1,0).
  - Shot damage:
    - el francotirador a la cabeza hace 190;
    - un perdigón de escopeta hace 10 a 10 m y 3 a 35 m.
  - `spreadDirs` con spread 0 devuelve la dirección exacta del yaw/pitch (convención de `player.ts`: yaw 0 = −z); con 5° ningún rayo se aparta más de 5°.
  - Un rayo que arranca adentro de un prisma pega en ese prisma a distancia 0 (`kind: 'world'`): no lo atraviesa.
- [ ] **Step 2: Correr y ver que fallan.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr. Expected:** PASS.
- [ ] **Step 5: Commit** `feat(combate): armas, daño y disparo hitscan en src/shared`.

### Task 4: Puntos de botín en el mapa y sorteo del botín

**Files:**
- Create: `src/mapgen/loot-spots.ts`, `src/shared/loot.ts`
- Modify:
  - `src/shared/mapdata.ts`: `lootSpots: LootSpot[]` en `MapData`;
  - `src/mapgen/assemble.ts`;
  - `tools/build-map.ts` (línea de resumen);
  - `e2e/helpers.ts`, si el tipo lo pide.
- Test: `tests/mapgen/loot-spots.test.ts`, `tests/shared/loot.test.ts`

**Interfaces:**
- Produces:
  - `export type LootTier = 'calle' | 'techo' | 'lugar'`
  - `export interface LootSpot { pos: Vec3; tier: LootTier }`, en `mapdata.ts`.
  - `export function lootSpots(map: MapData, world: CollisionWorld): LootSpot[]`, determinista:
    - **calle:** un punto cada ~25 m sobre las veredas de las calles vehiculares, adentro del área y en lugar libre (`isFreeSpot`).
    - **techo:** uno por edificio no relleno con techo de más de 60 m², alcanzable por `roofClusters` y las ayudas de `climb.ts`, en el punto del techo más lejano a los bordes y a ≥ 0,8 m del pretil.
    - **lugar:** 4 por lugar `enterable`, en semicírculo a 2–4 m del cartel, sobre la vereda y libres.
  - `export type LootItem = { kind: 'arma'; weapon: WeaponId } | { kind: 'municion'; ammo: AmmoId } | { kind: 'chaleco' } | { kind: 'botiquin' }`
  - `export const LOOT_TABLE: Record<LootTier, readonly (readonly [LootItem['kind'] | 'nada', number])[]>` y `export const WEAPON_TABLE: Record<'calle' | 'alto', readonly (readonly [WeaponId, number])[]>`, con los porcentajes del spec §5.
  - `export interface Drop { id: number; pos: Vec3; item: LootItem }`
  - `export function rollLoot(spots: readonly LootSpot[], seed: number): Drop[]`
    - Un arma suma un segundo `Drop` de su munición, a 0,6 m.
    - La munición sale del mismo reparto que el tipo de las armas del nivel.
    - Los `id` son correlativos desde 1.

- [ ] **Step 1: Tests.**
  - Sobre el mapa real:
    - hay entre 150 y 600 puntos;
    - todos adentro de `bounds`;
    - cada uno libre: `world.overlaps` de un disco de 0,3 m entre `pos[1]+0.05` y `pos[1]+0.5` da false;
    - los de techo están a la altura de algún techo ±0,01;
    - hay 4 × 9 de nivel `lugar`;
    - dos corridas dan lo mismo.
  - `rollLoot`:
    - la misma semilla da los mismos drops;
    - con 20.000 puntos de calle sintéticos, la proporción de cada tipo queda a ±1,5 % de la tabla;
    - todo arma tiene su munición a 0,6 m.
- [ ] **Step 2: Correr y ver que fallan.**
- [ ] **Step 3: Implementar.** Después correr `npm run build:map` (mapa < 3 MB).
- [ ] **Step 4: Verificar.** `npx vitest run`. **Expected:** PASS.
- [ ] **Step 5: Commit** `feat(botín): puntos de botín en el mapa y sorteo con semilla`.

### Task 5: Zona que se achica

**Files:**
- Create: `src/shared/zone.ts`
- Test: `tests/shared/zone.test.ts`

**Interfaces:**
- Produces:
  - `export const ZONE_PHASES: readonly { wait: number; shrink: number; radius: number; dps: number }[]`: la tabla del spec §6.
  - `export interface ZonePlan { center0: Vec2; r0: number; circles: { center: Vec2; r: number }[] }`
  - `export function planZone(bounds: Bounds, players: number, seed: number): ZonePlan`
    - Radio inicial = la mitad de la diagonal × max(0,35, √(players/12)).
    - Cada círculo siguiente está entero dentro del anterior y su centro dentro de `bounds`.
  - `export interface ZoneNow { phase: number /* 1..5, 6 = cerrada */; center: Vec2; r: number; nextAt: number; dps: number; shrinking: boolean }`
  - `export function zoneAt(plan: ZonePlan, t: number): ZoneNow`: interpolación lineal del centro y del radio durante el cierre.
  - `export const ZONE_TOTAL: number`: suma de esperas y cierres (720 s).

- [ ] **Step 1: Tests.**
  - `ZONE_TOTAL === 720`.
  - `zoneAt(plan, 0)` da `r === r0` y `phase 1`.
  - A mitad de un cierre, el radio está en el medio.
  - `zoneAt(plan, 720).r === 0`.
  - Para 100 semillas, cada círculo está adentro del anterior (`|c_i − c_{i−1}| + r_i ≤ r_{i−1} + 1e-9`) y su centro adentro de `bounds`.
  - Con 2 jugadores, `r0` es el 40,8 % del de 12.
  - `dps` de la fase 5 es 10.
- [ ] **Step 2: Correr y ver que fallan.** Después implementar y correr hasta PASS.
- [ ] **Step 3: Commit** `feat(zona): fases y círculos de la zona con semilla`.

### Task 6: La partida (estado puro)

**Files:**
- Create: `src/shared/match.ts`
- Test: `tests/shared/match.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `SIM_HZ`.
  - Task 3: `WEAPONS`, `Gun`, `fire`, `startReload`, `finishReload`, `spreadDirs`, `hitscan`, `shotDamage`, `applyDamage`, `applyZoneDamage`, `createRng`.
  - Task 4: `Drop`, `rollLoot`.
  - Task 5: `planZone`, `zoneAt`.
  - `stepPlayer` y `PlayerState`.
- Produces:
  - `export interface Fighter { id: string; name: string; player: PlayerState; vitals: Vitals; alive: boolean; diedAt?: number }`
  - `export interface Inventory { slots: [Gun | null, Gun | null]; active: 0 | 1; ammo: Record<AmmoId, number>; medkits: number; healingUntil: number | null }`
  - `export interface MatchState { t: number; seed: number; me: Fighter; inv: Inventory; dummies: Fighter[]; drops: Drop[]; zone: ZonePlan; aiming: boolean; events: MatchEvent[]; over: null | { won: boolean; alive: number; at: number }; kills: number; nextDropId: number }`
  - `export type MatchEvent = { type: 'shot'; weapon: WeaponId; from: Vec3; to: Vec3[] } | { type: 'hit'; id: string; part: HitPart; dmg: number; point: Vec3 } | { type: 'impact'; point: Vec3; normal: Vec3 } | { type: 'kill'; id: string; name: string } | { type: 'pickup'; item: LootItem } | { type: 'reload'; weapon: WeaponId } | { type: 'empty' } | { type: 'zone-hurt'; dmg: number } | { type: 'over'; won: boolean }`
    - Los eventos son los del último paso: `stepMatch` vacía la lista al empezar.
  - `export interface MatchInput extends PlayerInput { fire: boolean; aim: boolean; reload: boolean; use: boolean; heal: boolean; slot: 0 | 1 | null }`
  - `export function newMatch(map: MapData, world: CollisionWorld, opts: { seed: number; dummies: number }): MatchState`
    - Jugador y maniquíes en `map.randomSpawns` distintos, elegidos con la semilla.
    - El jugador arranca sin armas, con vida 100 y chaleco 0.
    - Los maniquíes arrancan con vida 100 y chaleco sorteado entre 0 y 50 de a 25.
  - `export function stepMatch(s: MatchState, input: MatchInput, world: CollisionWorld, h: number): MatchState`
    - **Orden de cada paso:**
      1. movimiento (`stepPlayer`; durante la curación, velocidad × 0,5);
      2. cambio de ranura (cancela la recarga y la curación);
      3. juntar (`use`): el drop más cercano a menos de 2,5 m en la dirección de la mirada (coseno > 0,8 o distancia < 1 m). Si es un arma con las dos ranuras llenas, la del slot activo vuelve al piso como `Drop` nuevo en el lugar;
      4. recarga;
      5. disparo: semiautomáticas por flanco de `fire`, la automática mientras está apretado. Dispersión: quieto o moviéndose (`|vel| > 0.5`) y mitad con `aim`. Cada perdigón hace `hitscan` desde el ojo;
      6. curación: con H y botiquines, 3 s y +50 hasta 100; disparar la cancela;
      7. zona: daño a todos los vivos afuera, `dps·h`;
      8. muertes, `kill` y `over`.
    - **Fin de la partida:** con `me` muerto termina en derrota; si queda solo `me`, en victoria.
    - **Tiempo:** `t` avanza `h`. Con `over` puesto, el estado ya no cambia salvo `t`.
  - `export function hitboxes(s: MatchState): Hitbox[]`: los maniquíes vivos.
  - `export function nearestDrop(s: MatchState): Drop | null`: el que juntaría `use`, para el cartel "E: juntar…".

- [ ] **Step 1: Tests**, con un `CollisionWorld` chico armado a mano (un edificio y el piso) y un `MapData` mínimo:
  - `newMatch` es determinista por semilla y nadie arranca superpuesto.
  - Juntar:
    - un arma con las ranuras vacías la pone en el slot 0 con el cargador lleno;
    - la caja de munición de al lado es otro drop: juntarla después suma `AMMO_BOX` a ese tipo;
    - con las dos ranuras llenas, el arma activa queda como drop en el lugar.
  - Disparar:
    - con el rifle a un maniquí a 10 m (mirándolo al pecho) le baja 20, o menos si tiene chaleco;
    - 5 tiros con el francotirador a la cabeza lo matan, emiten `kill` y suman `kills`;
    - la pistola no repite si `fire` queda apretado.
  - Recargar no pasa de la reserva y descuenta munición.
  - Munición, chaleco y botiquines:
    - una caja de munición no pasa de `AMMO_MAX`;
    - el chaleco suma 50 hasta 100;
    - el cuarto botiquín no se junta y queda en el piso.
  - Curación:
    - el botiquín cura 50 en 3 s y camina a la mitad de velocidad;
    - disparar o cambiar de ranura a mitad la cancela sin consumir el botiquín.
  - Zona:
    - con 2 maniquíes y el jugador escondido adentro del último círculo, a los 720 s + 30 s los maniquíes (afuera) murieron por la zona y `over.won` es true;
    - si el jugador está afuera, `over.won` es false.
  - Después de `over` nada cambia.
- [ ] **Step 2: Correr y ver que fallan.** Después implementar y correr hasta PASS.
- [ ] **Step 3: Commit** `feat(partida): estado y reglas de la partida de práctica`.

### Task 7: Dibujo y sonido del combate

**Files:**
- Create:
  - `src/client/combat/dummies.ts` (maniquíes instanciados);
  - `src/client/combat/drops.ts` (botín instanciado por tipo, a menos de 120 m, flotando y girando);
  - `src/client/combat/zone-wall.ts` (cilindro translúcido azul de 60 m, sin sombra, sin escribir profundidad, 1 draw call, más el borde en el piso);
  - `src/client/combat/viewmodel.ts` (arma en primera persona por `WeaponId`, en una escena aparte con su propia cámara y fov 70, menos de 6 draw calls; fogonazo; retroceso; animación de recarga);
  - `src/client/combat/effects.ts` (trazadores que duran 80 ms, decals de impacto con máximo 64 que se borran a los 10 s, 1 draw call cada uno);
  - `src/client/combat/models.ts` (geometrías de las 4 armas, del maniquí y de los objetos de botín: cajas y cilindros con colores planos);
  - `src/client/audio/sfx.ts` (WebAudio: `shot(weapon)`, `reload()`, `hit(head)`, `pickup()`, `zoneHurt()`, `empty()`; crea el `AudioContext` en el primer gesto del usuario).
- Test: `tests/client/combat-render.test.ts`, `tests/client/sfx.test.ts`

**Interfaces:**
- Consumes: `MatchState`, `MatchEvent`, `Drop`, `ZoneNow`, `WeaponId`.
- Produces: cada módulo exporta `create…(scene | renderer, quality)` con `update(state, camPos, now)` y `dispose()`. `sfx.ts` exporta `createSfx(): Sfx`, que en entornos sin `AudioContext` (jsdom) no hace nada.

- [ ] **Step 1: Tests de cantidades.**
  - 23 maniquíes vivos son 1 o 2 draw calls (InstancedMesh). Uno muerto no se dibuja: se cae y desaparece a los 2 s.
  - 300 drops de 8 tipos son a lo sumo 8 InstancedMesh, y los que están a más de 120 m de la cámara no se cuentan en `count`.
  - Cada arma del viewmodel tiene menos de 6 meshes y menos de 2.000 triángulos.
  - Decals: después de 100 impactos hay 64.
  - `dispose()` deja `renderer.info.memory.geometries` como estaba.
  - `createSfx` en jsdom no tira.
- [ ] **Step 2: Correr y ver que fallan.** Después implementar y correr hasta PASS.
- [ ] **Step 3: Commit** `feat(cliente): maniquíes, botín, zona, arma en mano, efectos y sonidos`.

### Task 8: Integración: entrada, HUD, pantallas, modo paseo, debug y e2e

**Files:**
- Modify:
  - `src/client/input.ts`: botones del mouse, rueda, E, R, H, 1 y 2, como flancos y estados en `read()`, que pasa a devolver `MatchInput`;
  - `src/client/main.ts`: arma la partida, corre `stepMatch` a paso fijo, pasa los eventos a efectos y sonidos, maneja la mira y el fov;
  - `src/client/ui/hud.ts`: vida, chaleco, munición, ranuras, zona, "Quedan N", cartel de juntar, marca de acierto (distinta en la cabeza), número de daño flotante proyectado desde el punto del impacto, feed de eliminaciones y flecha con la distancia hacia la zona;
  - `src/client/ui/overlay.ts`: pantallas `victoria` y `derrota` con "Jugar de nuevo"; el menú de lugares arranca el **modo paseo** (sin partida);
  - `src/client/debug.ts`;
  - `index.html` / CSS;
  - `README.md` (controles);
  - `e2e/helpers.ts` y `e2e/perf.spec.ts`: parada `combate` con 11 maniquíes, botín y zona a la vista.
- Create: `e2e/match.spec.ts`
- Test: `tests/client/hud.test.ts`, `tests/client/input.test.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces, debug (`window.__adrogue`, solo con `?debug=1`):
  - `match(): { t; me: { hp; armor; alive; pos }; inv; alive: number; over }`: una copia.
  - `give(weapon: WeaponId): void`
  - `placeDummy(i: number, pos: Vec3): void`
  - `skipTo(t: number): void`: avanza la simulación de a pasos de 1/60 sin dibujar.
  - `newMatch(seed: number, dummies: number): void`
- URL:
  - `?maniquis=N` (0–23);
  - `?semilla=N`.
  - Sin semilla, se usa una aleatoria del cliente. Es el único `Math.random`, y está en `src/client`.

- [ ] **Step 1: Tests unitarios.**
  - El HUD muestra `100` y `0` al empezar.
  - Con el rifle muestra `30 / 30`, y "Quedan 12" con 11 maniquíes.
  - El cartel "E: juntar escopeta" aparece cuando `nearestDrop` es una escopeta.
  - `input.read()` da `fire` true mientras el botón izquierdo está apretado, y `use` true un solo cuadro por toque de E.
- [ ] **Step 2: e2e `e2e/match.spec.ts`.**
  - **Partida completa:** abrir con `?debug=1&semilla=7&maniquis=2` y jugar.
    1. `give('rifle')`, poner un maniquí a 8 m adelante y mantener el clic izquierdo 2 s: el maniquí muere y el feed dice "Eliminaste a".
    2. `skipTo(800)`: aparece la pantalla de victoria o de derrota.
    3. "Jugar de nuevo": `match().alive === 3`, vida 100 y sin armas.
       - La cantidad de drops es la del sorteo nuevo.
       - No quedan decals ni maniquíes caídos de la partida anterior: se mira con los contadores de debug.
    4. Sin errores de consola.
  - **Modo paseo:** desde el menú de lugares, teletransportarse a `banco-nacion` no arma partida: `match()` da null y no hay HUD de zona.
- [ ] **Step 3: Implementar hasta que pasen.**
- [ ] **Step 4: Verificación completa.** `npx vitest run && npm run typecheck && npm run build:map && npx playwright test`. **Expected:** todo PASS, con los presupuestos sin cambios.
- [ ] **Step 5: Commit** `feat: partida de práctica jugable de punta a punta`.
