export type Quality = 'baja' | 'media' | 'alta';

export interface QualityPreset {
  pixelRatioMax: number;
  shadows: false | { mapSize: number; range: number };
  drawDistance: number;
  treeDensity: number;
  anisotropy: number;
  textureSize: 512 | 1024;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  baja: { pixelRatioMax: 0.75, shadows: false, drawDistance: 250, treeDensity: 0.5, anisotropy: 1, textureSize: 512 },
  media: { pixelRatioMax: 1, shadows: { mapSize: 1024, range: 80 }, drawDistance: 450, treeDensity: 1, anisotropy: 4, textureSize: 1024 },
  alta: { pixelRatioMax: 2, shadows: { mapSize: 2048, range: 150 }, drawDistance: 900, treeDensity: 1, anisotropy: 8, textureSize: 1024 },
};

const KEY = 'adrogue.calidad';

/** Con el almacenamiento bloqueado (privacidad, iframes) se juega en media y no se recuerda la elección. */
export function loadQuality(): Quality {
  let v: string | null = null;
  try {
    v = localStorage.getItem(KEY);
  } catch {
    // almacenamiento bloqueado
  }
  return v === 'baja' || v === 'media' || v === 'alta' ? v : 'media';
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // almacenamiento bloqueado o lleno: no se recuerda
  }
}
