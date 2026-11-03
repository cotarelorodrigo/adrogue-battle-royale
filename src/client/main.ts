// Arma el juego: carga el mapa, la escena y los materiales, conecta entrada, jugador, menús y HUD, y corre el bucle.
import { buildCollisionWorld } from '../shared/collision.ts';
import type { Vec2, Vec3 } from '../shared/geo.ts';
import type { MapData } from '../shared/mapdata.ts';
import { eyeHeight, initialState, stepPlayer } from '../shared/player.ts';
import type { PlayerState } from '../shared/player.ts';
import photoFacadeData from '../../data/photo-facades.json';
import { debugEnabled, installDebug } from './debug.ts';
import type { AdrogueDebug } from './debug.ts';
import { createInput } from './input.ts';
import { loadQuality, QUALITY, saveQuality } from './render/quality.ts';
import type { Quality } from './render/quality.ts';
import { createScene } from './render/scene.ts';
import { createHud, FpsMeter } from './ui/hud.ts';
import { createOverlay, showFatal } from './ui/overlay.ts';
import type { Overlay } from './ui/overlay.ts';
import { buildChunks } from './world/chunks.ts';
import { buildMonuments, buildStation } from './world/landmarks.ts';
import { createMaterials, disposeMaterials } from './world/materials.ts';
import { buildPhotoFacades } from './world/photo-facades.ts';
import type { PhotoFacade } from './world/photo-facades.ts';
import { buildClimbProps } from './world/props.ts';
import { buildSigns } from './world/signs.ts';
import type { WorldMaterials } from './world/types.ts';
import { buildParks, buildTrees, loadBarkTexture, setTreeDensity } from './world/vegetation.ts';

const MSG_NO_WEBGL2 = 'Tu navegador no soporta WebGL2. Probá con Chrome, Edge o Firefox actualizados.';
const MSG_CONTEXT_LOST = 'Se perdió el contexto gráfico. Recargá la página.';
const MSG_LOAD_FAILED = 'No se pudo cargar el mapa. Recargá la página.';
const INITIAL_PLACE = 'estacion-adrogue';

type Game = Omit<AdrogueDebug, 'ready'>;

const root = document.getElementById('app')!;
const debug = debugEnabled(location.search);
let game: Game | null = null;
let markReady!: () => void;
let failReady!: (e: unknown) => void;
const ready = new Promise<void>((resolve, reject) => {
  markReady = resolve;
  failReady = reject;
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
    ready,
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
  let quality = loadQuality();
  let raf = 0;

  const overlay = createOverlay(root, {
    quality,
    requestLock: () => lockPointer(canvas),
    exitLock: () => document.exitPointerLock(),
    onQuality: (q) => void setQuality(q),
    onPlace: (id) => (id === null ? spawnRandom() : teleport(id)),
  });
  boot.overlay = overlay;
  document.addEventListener('pointerlockchange', () => overlay.pointerLocked(document.pointerLockElement === canvas));
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
  const photos = await buildPhotoFacades(map, photoFacadeData as PhotoFacade[], import.meta.env.BASE_URL, QUALITY[quality].textureSize, QUALITY[quality].anisotropy);
  if (boot.lost) throw new Error('Se perdió el contexto WebGL durante la carga');
  scene.addStatic([
    buildStation(map, materials),
    buildParks(map, materials),
    buildMonuments(map.props, map.places),
    photos,
    buildSigns(map.places),
    ...trees,
    ...buildClimbProps(map.props),
  ]);

  let state: PlayerState = initialState([0, 0, 0]);
  function spawnAt(spawn: Vec3, lookAt: Vec2): void {
    state = initialState(spawn);
    const dx = lookAt[0] - spawn[0], dz = lookAt[1] - spawn[2];
    input.setLook(dx === 0 && dz === 0 ? input.read().yaw : Math.atan2(-dx, -dz), 0);
  }
  function placeAt(pos: Vec3, yaw: number): void {
    state = initialState(pos);
    input.setLook(yaw, 0);
  }
  function teleport(placeId: string): void {
    const place = map.places.find((p) => p.id === placeId);
    if (!place) throw new Error(`No existe el lugar "${placeId}"`);
    spawnAt(place.spawn, place.sign ? place.sign.anchor : place.position);
  }
  /** Un spawn al azar de map.randomSpawns, mirando hacia el centro del mapa. */
  function spawnRandom(): void {
    spawnAt(map.randomSpawns[Math.floor(Math.random() * map.randomSpawns.length)], [0, 0]);
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
  }

  const fps = new FpsMeter();
  let last = performance.now();
  let first = true;
  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const dt = (now - last) / 1000; // stepPlayer recorta a maxDt y descarta dt ≤ 0
    last = now;
    const cmd = input.read();
    if (overlay.screen === 'playing') state = stepPlayer(state, cmd, world, dt); // sin puntero capturado, en pausa
    scene.update(state.pos, eyeHeight(state), cmd.yaw, cmd.pitch);
    scene.render();
    fps.tick(now);
    hud.update(now, fps.fps, scene.renderer.info.render.calls);
    if (first) {
      first = false;
      markReady();
    }
  }

  teleport(INITIAL_PLACE);
  game = {
    teleport,
    placeAt,
    state: () => structuredClone(state), // copia: desde afuera no se puede tocar el estado del juego
    stats: () => ({ drawCalls: scene.renderer.info.render.calls, triangles: scene.renderer.info.render.triangles, fps: fps.fps }),
    setQuality,
  };
  overlay.ready(map.places);
  raf = requestAnimationFrame(frame);
}
