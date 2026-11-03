// window.__adrogue: ganchos para los tests e2e y el benchmark. Solo existe con ?debug=1.
import type { PlayerState } from '../shared/player.ts';
import type { Quality } from './render/quality.ts';

export interface DebugStats {
  /** renderer.info.render del último cuadro (incluye la pasada de sombras). */
  drawCalls: number;
  triangles: number;
  /** Promedio del último segundo. */
  fps: number;
}

export interface AdrogueDebug {
  /** Al spawn del lugar, mirando hacia él. Tira si el id no existe. */
  teleport(placeId: string): void;
  state(): PlayerState;
  stats(): DebugStats;
  /** Igual que elegirla en el menú (también la guarda). La promesa se cumple cuando ya está aplicada. */
  setQuality(q: Quality): Promise<void>;
  /** Se cumple con el mapa y los materiales cargados y el primer cuadro dibujado; se rechaza si la carga falla. */
  ready: Promise<void>;
}

declare global {
  interface Window {
    __adrogue: AdrogueDebug;
  }
}

export const debugEnabled = (search: string): boolean => new URLSearchParams(search).get('debug') === '1';

export function installDebug(api: AdrogueDebug): void {
  window.__adrogue = api;
}
