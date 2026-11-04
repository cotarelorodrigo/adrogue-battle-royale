export type Quality = 'baja' | 'media' | 'alta';

export interface QualityPreset {
  pixelRatioMax: number;
  shadows: false | { mapSize: number; range: number };
  /** Los ~700 contenedores también proyectan sombra (duplican sus triángulos y casi no se notan). */
  dumpsterShadows: boolean;
  /** Los maniquíes proyectan sombra: como los contenedores, duplican sus triángulos (1.188 con 11), solo en alta. */
  dummyShadows: boolean;
  /** El botín se dibuja hasta esta distancia (m): 120 en alta, como dice el spec. En baja y media, menos: a 100 m un
   *  objeto ocupa 2 o 3 píxeles y donde el mundo ya es caro (Esteban Adrogué a lo largo) los triángulos no alcanzan. */
  dropRadius: number;
  /** Niebla hasta acá (m) y camera.far un poco más allá: lo que se corta ya es del color del horizonte. */
  drawDistance: number;
  treeDensity: number;
  anisotropy: number;
  textureSize: 512 | 1024;
  /** Interiores (D7): se dibujan los que están a menos de `radius` m de la cámara y en pantalla, del más cercano al más
   *  lejano, hasta `max` y mientras la suma de sus mallas entre en `calls` (el margen de draw calls de la calidad, H3:
   *  cada interior se compacta hasta entrar solo). Los muebles de detalle van hasta `detail` (y la luz horneada es más
   *  fina con detalle 2). */
  interiors: { radius: number; max: number; detail: 1 | 2; calls: number };
}

/** camera.far queda esto (m) más allá de drawDistance, donde la niebla ya tapa todo. */
export const FAR_PAST_FOG = 50;

export const QUALITY: Record<Quality, QualityPreset> = {
  baja: { pixelRatioMax: 0.75, shadows: false, dumpsterShadows: false, dummyShadows: false, dropRadius: 80, drawDistance: 250, treeDensity: 0.5,
    anisotropy: 1, textureSize: 512, interiors: { radius: 60, max: 1, detail: 1, calls: 8 } },
  media: { pixelRatioMax: 1, shadows: { mapSize: 1024, range: 80 }, dumpsterShadows: false, dummyShadows: false, dropRadius: 100,
    drawDistance: 450, treeDensity: 1, anisotropy: 4, textureSize: 1024, interiors: { radius: 60, max: 2, detail: 2, calls: 18 } },
  alta: { pixelRatioMax: 2, shadows: { mapSize: 2048, range: 150 }, dumpsterShadows: true, dummyShadows: true, dropRadius: 120,
    drawDistance: 900, treeDensity: 1, anisotropy: 8, textureSize: 1024, interiors: { radius: 60, max: 3, detail: 2, calls: 36 } },
};

/** Cómo se llama cada calidad en pantalla (menú de Esc y benchmark). */
export const QUALITY_LABEL: Record<Quality, string> = { baja: 'Baja', media: 'Media', alta: 'Alta' };

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
