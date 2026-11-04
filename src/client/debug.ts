// window.__adrogue: ganchos para los tests e2e. Solo existe con ?debug=1 (el benchmark, ?bench=1, no los necesita).
// También lee los parámetros de la partida (?maniquis, ?semilla), que sirven sin ?debug=1.
import type { Inventory } from '../shared/match.ts';
import type { WeaponId } from '../shared/combat.ts';
import type { Vec3 } from '../shared/geo.ts';
import type { PlayerState } from '../shared/player.ts';
import type { Quality } from './render/quality.ts';

export interface DebugStats {
  /** renderer.info.render del último cuadro (incluye la pasada de sombras y la del arma en mano). */
  drawCalls: number;
  triangles: number;
  /** Promedio del último segundo. */
  fps: number;
}

/** Una copia de lo principal de la partida. */
export interface DebugMatch {
  t: number;
  seed: number;
  me: { hp: number; armor: number; alive: boolean; pos: Vec3 };
  inv: Inventory;
  /** vivos, contando al jugador */
  alive: number;
  /** objetos en el piso */
  drops: number;
  kills: number;
  over: null | { won: boolean; alive: number; at: number };
}

/** Lo que dibujan los efectos y los maniquíes ahora (para ver que "Jugar de nuevo" no deja nada de la anterior). */
export interface DebugCounters { decals: number; tracers: number; dummies: number }

export interface AdrogueDebug {
  /** Al spawn del lugar, mirando hacia él. Tira si el id no existe. En una partida mueve al jugador de la partida (no
   *  arranca el modo paseo, como el menú de lugares). */
  teleport(placeId: string): void;
  /** Pies en `pos`, quieto, mirando a `yaw` (pitch 0). No valida que el lugar esté libre: es para los tests (pararse al
   *  pie de una escalera, mirar desde el borde del mapa). En una partida mueve al jugador de la partida. */
  placeAt(pos: Vec3, yaw: number): void;
  state(): PlayerState;
  stats(): DebugStats;
  /** Igual que elegirla en el menú (también la guarda). La promesa se cumple cuando ya está aplicada. */
  setQuality(q: Quality): Promise<void>;
  /** La partida en curso, o null en el modo paseo (o antes de jugar). */
  match(): DebugMatch | null;
  /** Un arma en la mano (en la ranura de la mano si está libre; si no, en la otra; con las dos llenas, reemplaza la de
   *  la mano) y una caja de su munición. */
  give(weapon: WeaponId): void;
  /** Pone de pie, quieto, al maniquí `i` (desde 0) en `pos`. Uno muerto sigue muerto. */
  placeDummy(i: number, pos: Vec3): void;
  /** Avanza la partida de a pasos de 1/60 s hasta `t` (s), sin dibujar, con el jugador quieto. */
  skipTo(t: number): void;
  /** Partida nueva con esa semilla y esos maniquíes, como "Jugar de nuevo". */
  newMatch(seed: number, dummies: number): void;
  counters(): DebugCounters;
  /** Se cumple con el mapa y los materiales cargados y el primer cuadro dibujado; se rechaza si la carga falla. */
  ready: Promise<void>;
  /** Se cumple cuando las fotos de fachada ya están en la escena (o fallaron): se cargan sin frenar el arranque. */
  photosReady: Promise<void>;
}

declare global {
  interface Window {
    __adrogue: AdrogueDebug;
  }
}

export const debugEnabled = (search: string): boolean => new URLSearchParams(search).get('debug') === '1';

/** Maniquíes por partida: 11 (12 jugadores en total); ?maniquis=N los cambia, de 0 a 23. */
export const DEFAULT_DUMMIES = 11;
export const MAX_DUMMIES = 23;

/** ?maniquis=N (0–23; si no es un número, 11) y ?semilla=N (un entero; si no hay, null: la elige el cliente). */
export function matchParams(search: string): { dummies: number; seed: number | null } {
  const q = new URLSearchParams(search);
  const n = Number.parseInt(q.get('maniquis') ?? '', 10);
  const s = q.get('semilla');
  const seed = s !== null && /^\d+$/.test(s.trim()) ? Number(s.trim()) >>> 0 : null;
  return { dummies: Number.isFinite(n) ? Math.min(MAX_DUMMIES, Math.max(0, n)) : DEFAULT_DUMMIES, seed };
}

export function installDebug(api: AdrogueDebug): void {
  window.__adrogue = api;
}
