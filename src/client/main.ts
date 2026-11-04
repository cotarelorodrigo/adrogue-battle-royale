// Arma el juego: carga el mapa, la escena y los materiales, conecta entrada, partida, menús y HUD, y corre el bucle.
// Hay dos modos:
// - partida (spec 2a §2): "Hacé click para jugar" (y "Jugar de nuevo") arranca una partida de práctica contra
//   maniquíes. stepMatch corre a paso fijo y los eventos de todos los pasos del cuadro van a los efectos, a los sonidos
//   y al HUD. El clic derecho apunta: el fov se cierra de a poco al del arma;
// - paseo: un lugar elegido en el menú (M) recorre el mapa sin partida, como en la etapa 1 (stepPlayer, sin zona, sin
//   maniquíes ni botín). Se vuelve a una partida con "Jugar una partida" en el menú de Esc.
import { Group } from 'three';
import { buildCollisionWorld } from '../shared/collision.ts';
import { AMMO_BOX, AMMO_MAX, newGun, WEAPONS } from '../shared/combat.ts';
import type { Vec2, Vec3 } from '../shared/geo.ts';
import type { MapData } from '../shared/mapdata.ts';
import { newMatch, stepMatch } from '../shared/match.ts';
import type { MatchEvent, MatchInput, MatchState } from '../shared/match.ts';
import { FixedStep, SIM_HZ } from '../shared/fixed-step.ts';
import { eyeHeight, initialState, PLAYER, stepPlayer } from '../shared/player.ts';
import type { PlayerState } from '../shared/player.ts';
import { createRng } from '../shared/rng.ts';
import photoFacadeData from '../../data/photo-facades.json';
import { aimTarget, scoped as scopeShown } from './aim.ts';
import { createSfx, playEvents, trackReload } from './audio/sfx.ts';
import { benchSeconds, createBench } from './bench.ts';
import { createDrops } from './combat/drops.ts';
import { createDummies } from './combat/dummies.ts';
import { createEffects } from './combat/effects.ts';
import type { CombatFrame, CombatView } from './combat/types.ts';
import { createViewmodel } from './combat/viewmodel.ts';
import { createZoneWall } from './combat/zone-wall.ts';
import { debugEnabled, installDebug, matchParams } from './debug.ts';
import type { AdrogueDebug } from './debug.ts';
import { createInput } from './input.ts';
import { loadQuality, QUALITY, saveQuality } from './render/quality.ts';
import type { Quality } from './render/quality.ts';
import { createScene, FOV } from './render/scene.ts';
import { createHud, FpsMeter } from './ui/hud.ts';
import { createOverlay, showFatal } from './ui/overlay.ts';
import type { Overlay } from './ui/overlay.ts';
import { buildChunks } from './world/chunks.ts';
import { buildMonuments, buildStation } from './world/landmarks.ts';
import { createMaterials, disposeMaterials } from './world/materials.ts';
import { buildPhotoFacades } from './world/photo-facades.ts';
import type { PhotoFacade } from './world/photo-facades.ts';
import { buildClimbProps, setDumpsterShadows } from './world/props.ts';
import { buildSigns } from './world/signs.ts';
import type { WorldMaterials } from './world/types.ts';
import { buildParks, buildTrees, loadBarkTexture, setTreeDensity } from './world/vegetation.ts';

const MSG_NO_WEBGL2 = 'Tu navegador no soporta WebGL2. Probá con Chrome, Edge o Firefox actualizados.';
const MSG_CONTEXT_LOST = 'Se perdió el contexto gráfico. Recargá la página.';
const MSG_LOAD_FAILED = 'No se pudo cargar el mapa. Recargá la página.';
const INITIAL_PLACE = 'estacion-adrogue';
/** Rapidez (1/s) con la que el fov va y vuelve de la mira (la misma que el arma en mano). */
const AIM_RATE = 14;
/** skipTo no avanza más que esto (s) de una vez. */
const SKIP_MAX = 3600;

type Game = Omit<AdrogueDebug, 'ready' | 'photosReady'>;

const root = document.getElementById('app')!;
const debug = debugEnabled(location.search);
/** Segundos del benchmark (?bench=1, ?benchSecs=N) o null para jugar. No necesita ?debug=1. */
const benchSecs = benchSeconds(location.search);
const params = matchParams(location.search);
/** La primera partida usa ?semilla o una al azar (el único Math.random del juego); cada partida nueva, la siguiente. */
const firstSeed = params.seed ?? Math.floor(Math.random() * 4294967296);
let game: Game | null = null;
let markReady!: () => void;
let failReady!: (e: unknown) => void;
const ready = new Promise<void>((resolve, reject) => {
  markReady = resolve;
  failReady = reject;
});
/** Se cumple cuando las fotos de fachada ya están en la escena (o no se pudieron cargar): el arranque no las espera. */
let markPhotosReady: () => void = () => {};
const photosReady = new Promise<void>((resolve) => {
  markPhotosReady = resolve;
});
ready.catch(() => {}); // si la carga falla el mensaje ya está en pantalla; solo los tests esperan esta promesa

if (debug) {
  const need = (): Game => {
    if (!game) throw new Error('El juego todavía no cargó: esperá __adrogue.ready');
    return game;
  };
  installDebug({
    teleport: (id) => need().teleport(id),
    placeAt: (pos, yaw) => need().placeAt(pos, yaw),
    state: () => need().state(),
    stats: () => need().stats(),
    setQuality: (q) => need().setQuality(q),
    match: () => need().match(),
    give: (w) => need().give(w),
    placeDummy: (i, pos) => need().placeDummy(i, pos),
    skipTo: (t) => need().skipTo(t),
    newMatch: (seed, n) => need().newMatch(seed, n),
    counters: () => need().counters(),
    ready,
    photosReady,
  });
}

start().catch(failReady);

function supportsWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext(); // contexto de prueba: liberarlo ya
    return gl !== null;
  } catch {
    return false;
  }
}

async function loadMap(): Promise<MapData> {
  const res = await fetch(`${import.meta.env.BASE_URL}map/adrogue.map.json`);
  if (!res.ok) throw new Error(`Mapa: HTTP ${res.status}`);
  return (await res.json()) as MapData;
}

/** Chrome y Edge devuelven una promesa que se rechaza si no se puede (p. ej. recién salido con Esc); Firefox, nada. */
function lockPointer(el: HTMLElement): void {
  try {
    void el.requestPointerLock()?.catch(() => {});
  } catch {
    // sin pointer lock: se queda en el menú
  }
}

/** Lo que el manejo de errores de start() necesita saber de la carga en curso. */
interface Boot { overlay?: Overlay; lost: boolean }

async function start(): Promise<void> {
  if (!supportsWebGL2()) {
    showFatal(root, MSG_NO_WEBGL2);
    throw new Error('Sin WebGL2');
  }
  const boot: Boot = { lost: false };
  try {
    await run(boot);
  } catch (err) {
    // Cualquier falla de la carga (mapa, texturas, armado de la escena) termina en el mensaje, nunca en "Cargando…"
    // para siempre. Si se perdió el contexto, su mensaje ya está en pantalla.
    console.error(err);
    if (!boot.lost) {
      if (boot.overlay) boot.overlay.fatal(MSG_LOAD_FAILED);
      else showFatal(root, MSG_LOAD_FAILED);
    }
    throw err;
  }
}

async function run(boot: Boot): Promise<void> {
  const canvas = document.createElement('canvas');
  root.append(canvas);
  const hud = createHud(root);
  const input = createInput(window);
  const sfx = createSfx(); // el AudioContext recién nace con el primer gesto
  const reloadSound = trackReload(sfx);
  let quality = loadQuality();
  let raf = 0;

  const overlay = createOverlay(root, {
    quality,
    requestLock: () => lockPointer(canvas),
    exitLock: () => document.exitPointerLock(),
    onQuality: (q) => void setQuality(q),
    onPlace: (id) => startWalk(id),
    onPlay: () => startMatch((firstSeed + matches) >>> 0, params.dummies),
  });
  boot.overlay = overlay;
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    // Con el menú abierto no llegan los keyup ni los mouseup, y lo que se toque no cuenta: al soltar el puntero se suelta
    // todo, y al capturarlo de nuevo no queda ningún pulso de antes (las teclas de movimiento apretadas sí siguen).
    if (locked) input.clearPulses();
    else input.reset();
    overlay.pointerLocked(locked);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // el clic derecho apunta
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault(); // F3 es "buscar" en el navegador
      hud.toggleStats();
    } else if (e.code === 'KeyM' && !e.repeat) {
      overlay.togglePlaces();
    } else if (e.code === 'Escape') {
      overlay.back();
    }
  });

  const map = await loadMap();
  const world = buildCollisionWorld(map);

  const scene = createScene(canvas, map.outskirts, quality);
  canvas.addEventListener('webglcontextlost', () => {
    boot.lost = true;
    cancelAnimationFrame(raf);
    input.dispose();
    sfx.dispose();
    if (document.pointerLockElement) document.exitPointerLock();
    overlay.fatal(MSG_CONTEXT_LOST);
  });

  // La corteza es para toda la partida (no depende de la calidad); si falla, troncos de color liso.
  const [initialMaterials, bark] = await Promise.all([
    createMaterials(quality),
    loadBarkTexture(`${import.meta.env.BASE_URL}textures/corteza_diff.jpg`).catch((e: unknown) => {
      console.error('Sin textura de corteza:', e);
      return undefined;
    }),
  ]);
  let materials: WorldMaterials = initialMaterials;
  if (boot.lost) throw new Error('Se perdió el contexto WebGL durante la carga');
  scene.addChunks(buildChunks(map, materials));
  const trees = buildTrees(map.trees, QUALITY[quality].treeDensity, bark);
  // Las fotos (~1,7 MB y la rectificación) se suman cuando llegan: el juego no las espera.
  buildPhotoFacades(map, photoFacadeData as PhotoFacade[], import.meta.env.BASE_URL, QUALITY[quality].textureSize, QUALITY[quality].anisotropy)
    .then((group) => {
      if (!boot.lost) scene.addStatic([group]);
    })
    .catch((e: unknown) => console.warn('Sin fotos de fachada:', e))
    .finally(markPhotosReady);
  const climbProps = buildClimbProps(map.props);
  setDumpsterShadows(climbProps, QUALITY[quality].dumpsterShadows);
  scene.addStatic([
    buildStation(map, materials),
    buildParks(map, materials),
    buildMonuments(map.props, map.places),
    buildSigns(map.places, map.signs),
    ...trees,
    ...climbProps,
  ]);

  // El combate: maniquíes, botín, zona y efectos cuelgan de un grupo que se esconde en el modo paseo; el arma en mano
  // tiene su propia escena y se dibuja después del mundo.
  const combat = new Group();
  combat.name = 'combate';
  combat.visible = false;
  const dummies = createDummies(combat);
  const drops = createDrops(combat);
  const effects = createEffects(combat);
  const views: CombatView[] = [createZoneWall(combat), drops, dummies, effects];
  /** Lo del combate que cambia con la calidad: hasta dónde se ve el botín y si los maniquíes dan sombra. */
  const applyCombatQuality = (q: Quality): void => {
    drops.setRadius(QUALITY[q].dropRadius);
    dummies.setShadows(QUALITY[q].dummyShadows);
  };
  applyCombatQuality(quality);
  const viewmodel = createViewmodel(scene.renderer);
  scene.addStatic([combat]);

  /** El jugador del modo paseo. */
  let walker: PlayerState = initialState([0, 0, 0]);
  /** La partida en curso; null en el modo paseo (y antes de jugar). */
  let match: MatchState | null = null;
  let matches = 0; // partidas arrancadas: la semilla de la próxima es firstSeed + matches
  let overShown = false;
  let fov = FOV;
  const pickRng = createRng(firstSeed ^ 0x5bd1e995); // el lugar al azar del modo paseo

  const player = (): PlayerState => (match ? match.me.player : walker);
  function setPlayer(p: PlayerState): void {
    if (match) match = { ...match, me: { ...match.me, player: p } };
    else walker = p;
  }
  function inMatch(): MatchState {
    if (!match) throw new Error('No hay partida: es el modo paseo (o todavía no se jugó)');
    return match;
  }
  /** yaw para mirar desde `from` hacia `to` (en planta); si son el mismo punto, el de ahora. */
  const yawToward = (from: Vec3, to: Vec2): number => {
    const dx = to[0] - from[0], dz = to[1] - from[2];
    return dx === 0 && dz === 0 ? input.look().yaw : Math.atan2(-dx, -dz);
  };
  function spawnAt(spawn: Vec3, lookAt: Vec2): void {
    setPlayer(initialState(spawn));
    input.setLook(yawToward(spawn, lookAt), 0);
  }
  function placeAt(pos: Vec3, yaw: number): void {
    setPlayer(initialState(pos));
    input.setLook(yaw, 0);
  }
  function teleport(placeId: string): void {
    const place = map.places.find((p) => p.id === placeId);
    if (!place) throw new Error(`No existe el lugar "${placeId}"`);
    spawnAt(place.spawn, place.sign ? place.sign.anchor : place.position);
  }
  /** Un spawn al azar de map.randomSpawns, mirando hacia el centro del mapa. */
  function spawnRandom(): void {
    spawnAt(map.randomSpawns[Math.floor(pickRng.next() * map.randomSpawns.length)], [0, 0]);
  }

  /** Partida nueva: el jugador en su punto de aparición, mirando hacia el centro del mapa, y nada de la anterior. */
  function startMatch(seed: number, n: number): void {
    match = newMatch(map, world, { seed, dummies: n });
    matches++;
    overShown = false;
    fov = FOV;
    effects.clear();
    hud.clear();
    combat.visible = true;
    overlay.setMode('partida');
    input.clearPulses(); // un toque de antes (o de la partida anterior) no se aplica en la nueva
    input.setLook(yawToward(match.me.player.pos, [0, 0]), 0);
  }
  /** Modo paseo en un lugar (null = al azar): sin partida. */
  function startWalk(placeId: string | null): void {
    match = null;
    combat.visible = false;
    hud.clear();
    overlay.setMode('paseo');
    input.clearPulses();
    if (placeId === null) spawnRandom();
    else teleport(placeId);
  }

  let qualitySeq = 0;
  async function setQuality(q: Quality): Promise<void> {
    const seq = ++qualitySeq; // un pedido nuevo deja sin efecto al anterior que siga cargando
    saveQuality(q);
    overlay.setQuality(q);
    if (q === quality) return;
    let next: WorldMaterials;
    try {
      next = await createMaterials(q);
    } catch (e) {
      console.error('No se pudieron cargar las texturas de la calidad', q, e);
      if (seq === qualitySeq) {
        saveQuality(quality);
        overlay.setQuality(quality);
      }
      return;
    }
    if (seq !== qualitySeq || boot.lost) {
      disposeMaterials(next);
      return;
    }
    scene.setMaterials(next);
    disposeMaterials(materials);
    materials = next;
    quality = q;
    scene.applyQuality(q);
    setTreeDensity(trees, QUALITY[q].treeDensity);
    setDumpsterShadows(climbProps, QUALITY[q].dumpsterShadows);
    applyCombatQuality(q);
  }

  // Benchmark: la cámara recorre sola el camino fijo; empieza a medir cuando la escena está completa (fotos incluidas).
  const bench = benchSecs === null ? null : createBench(root, {
    seconds: benchSecs,
    quality,
    onRerun: (q) => {
      saveQuality(q);
      location.reload();
    },
    onPlay: () => location.assign(location.pathname),
  });
  if (bench) void photosReady.then(() => bench.start(performance.now()));

  /** El fov va de a poco hacia el de la mira del arma (o al normal) y el mouse gira más despacio cuanto más se cierra. */
  function aimFov(m: MatchState, dt: number): void {
    const target = aimTarget(m, FOV);
    fov += (target - fov) * (1 - Math.exp(-AIM_RATE * Math.min(0.1, Math.max(0, dt))));
    if (Math.abs(target - fov) < 0.05) fov = target;
    scene.setFov(fov);
    const half = (deg: number): number => Math.tan((deg * Math.PI) / 360);
    input.setZoom(half(fov) / half(FOV));
  }

  const fps = new FpsMeter();
  const fixed = new FixedStep(); // la simulación avanza a 60 Hz sin importar los fps del cuadro
  let last = performance.now();
  let first = true;
  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const dt = (now - last) / 1000; // FixedStep descarta dt ≤ 0 y limita los pasos por cuadro
    last = now;
    let f: CombatFrame | null = null;
    if (bench) {
      const v = bench.frame(now);
      scene.update(v.pos, PLAYER.eye, v.yaw, v.pitch);
    } else {
      /** los eventos de todos los pasos de este cuadro (state.events tiene solo los del último) */
      const events: MatchEvent[] = [];
      if (overlay.screen === 'playing') { // sin puntero capturado, en pausa
        fixed.advance(dt, (h) => {
          const cmd = input.read(); // uno por paso: cada toque de E, R, H, 1, 2 o la rueda lo consume un solo paso
          if (match) {
            match = stepMatch(match, cmd, world, h);
            events.push(...match.events);
          } else {
            walker = stepPlayer(walker, cmd, world, h);
          }
        });
      }
      const look = input.look();
      const p = player();
      const eye = eyeHeight(p);
      scene.update(p.pos, eye, look.yaw, look.pitch);
      if (match) {
        aimFov(match, dt);
        // terminada, stepMatch deja `aiming` como estaba: el arma en mano y la mira del HUD dejan de apuntar, como el fov
        const state = match.over && match.aiming ? { ...match, aiming: false } : match;
        f = { state, cam: { pos: [p.pos[0], p.pos[1] + eye, p.pos[2]], yaw: look.yaw, pitch: look.pitch }, now, events };
        for (const v of views) v.update(f);
        viewmodel.update(f);
        playEvents(sfx, events);
      } else {
        fov = FOV;
        scene.setFov(FOV);
        input.setZoom(1);
      }
      reloadSound(events, match); // si la recarga se cancela (o se deja la partida), lo que faltaba de su sonido no suena
    }
    scene.render();
    if (f) {
      viewmodel.render(); // encima del mundo, en el mismo cuadro: renderer.info suma las dos pasadas
      hud.combat({ ...f, fov, scoped: scopeShown(f.state, fov, FOV), project: scene.project });
      const over = f.state.over;
      if (over && !overShown) {
        overShown = true;
        overlay.matchOver({ won: over.won, alive: over.alive, time: over.at, kills: f.state.kills, dummies: f.state.dummies.length });
      }
    } else {
      hud.combat(null);
    }
    fps.tick(now);
    hud.update(now, fps.fps, scene.renderer.info.render.calls);
    if (first) {
      first = false;
      markReady();
    }
  }

  teleport(INITIAL_PLACE); // de fondo del título, en el modo paseo hasta que se toque "Hacé click para jugar"
  game = {
    teleport,
    placeAt,
    state: () => structuredClone(player()), // copia: desde afuera no se puede tocar el estado del juego
    stats: () => ({ drawCalls: scene.renderer.info.render.calls, triangles: scene.renderer.info.render.triangles, fps: fps.fps }),
    setQuality,
    match: () => match && {
      t: match.t,
      seed: match.seed,
      me: { hp: match.me.vitals.hp, armor: match.me.vitals.armor, alive: match.me.alive, pos: [...match.me.player.pos] },
      inv: structuredClone(match.inv),
      alive: (match.me.alive ? 1 : 0) + match.dummies.filter((d) => d.alive).length,
      drops: match.drops.length,
      kills: match.kills,
      over: match.over && { ...match.over },
    },
    give(weapon) {
      const m = inMatch();
      if (!Object.hasOwn(WEAPONS, weapon)) throw new Error(`No existe el arma "${weapon}"`);
      const inv = structuredClone(m.inv);
      const other = inv.active === 0 ? 1 : 0;
      if (inv.slots[inv.active] !== null && inv.slots[other] === null) inv.active = other;
      inv.slots[inv.active] = newGun(weapon);
      const ammo = WEAPONS[weapon].ammo;
      inv.ammo[ammo] = Math.min(AMMO_MAX[ammo], inv.ammo[ammo] + AMMO_BOX[ammo]);
      inv.healingUntil = null;
      match = { ...m, inv };
    },
    placeDummy(i, pos) {
      const m = inMatch();
      if (!Number.isInteger(i) || i < 0 || i >= m.dummies.length) throw new RangeError(`No existe el maniquí ${i}: hay ${m.dummies.length}`);
      const list = m.dummies.slice();
      list[i] = { ...list[i], player: initialState(pos) };
      match = { ...m, dummies: list };
    },
    skipTo(t) {
      let m = inMatch();
      if (!(t - m.t <= SKIP_MAX)) throw new RangeError(`skipTo(${t}): a lo sumo ${SKIP_MAX} s de una vez`);
      const still: MatchInput = { forward: 0, right: 0, jump: false, crouch: false, ...input.look(), fire: false, aim: false,
        reload: false, use: false, heal: false, slot: null };
      const h = 1 / SIM_HZ;
      while (m.t < t - 1e-9) m = stepMatch(m, still, world, h); // los eventos de estos pasos no se dibujan ni suenan
      match = m;
    },
    newMatch: (seed, n) => startMatch(seed >>> 0, n),
    counters: () => (combat.visible
      ? { decals: effects.decals, tracers: effects.tracers, dummies: dummies.mesh.count }
      : { decals: 0, tracers: 0, dummies: 0 }),
  };
  if (bench) overlay.bench();
  else overlay.ready(map.places);
  raf = requestAnimationFrame(frame);
}
