// Aberturas de los interiores: las que pinta el atlas de frentes en la planta baja de un lote (así lo pintado coincide
// con el hueco) y las puertas de un interior en el mundo. Determinista y sin DOM: lo usan mapgen, la colisión y el cliente.
import { signedAreaFromAbove } from '../geo.ts';
import type { Vec2 } from '../geo.ts';
import type { Building, InteriorInput, Opening, PlantaBaja } from '../mapdata.ts';

/** D10: una puerta mide al menos DOOR_MIN_W de ancho y su dintel queda al menos a LINTEL_MIN del piso (m). */
export const DOOR_MIN_W = 1.0, LINTEL_MIN = 2.2;
/** Alto de un nivel (m): una puerta del nivel k arranca en k · LEVEL_H (FLOOR_H de mapgen y del cliente). */
export const LEVEL_H = 3.2;
/** Ancho (m) de la celda del atlas en que se miden LOT_OPENINGS: el de una bahía de fachada (BAY_W de
 *  client/world/wall-kit.ts). En el mundo, la bahía mide L / n y las x se estiran con ella, como la textura. */
export const BAY_W = 3.0;

/** Las celdas de planta baja del atlas por tipo de planta baja: la de la bahía de la puerta y la del resto (sin la
 *  variante de ladrillo, que agrega client/world/front-atlas.ts; las celdas con aberturas no la tienen). */
export const GROUND_CELLS = {
  vidriera: ['vidriera-puerta', 'vidriera'],
  persiana: ['persiana', 'persiana'],
  porton: ['porton', 'ventana-pb'],
  puerta: ['puerta', 'ventana-pb'],
  banco: ['banco-puerta', 'banco'],
  acceso: ['acceso', 'vidriera'],
  pared: ['pared-pb', 'pared-pb'],
} as const satisfies Record<PlantaBaja, readonly [string, string]>;

/** Las celdas del atlas que son aberturas de verdad en un lugar con interior. */
export type LotCell = 'vidriera' | 'vidriera-puerta' | 'banco' | 'banco-puerta' | 'acceso';
type CellOpening = { kind: Opening['kind']; x0: number; x1: number; y0: number; y1: number };

/** Aberturas de cada celda: x en metros desde el borde izquierdo de una celda de BAY_W, y alturas desde el piso. Las
 *  puertas van del piso a ≥ LINTEL_MIN y miden ≥ DOOR_MIN_W aun en la bahía más angosta (2,25 m: x · 0,75). Todo queda
 *  por debajo de 2,4 m: la banda de arriba es pared, para el cartel. */
export const LOT_OPENINGS: Record<LotCell, readonly CellOpening[]> = {
  vidriera: [{ kind: 'vidrio', x0: 0.15, x1: 2.85, y0: 0.3, y1: 2.3 }],
  'vidriera-puerta': [
    { kind: 'puerta', x0: 0.2, x1: 1.6, y0: 0, y1: 2.3 },
    { kind: 'vidrio', x0: 1.7, x1: 2.85, y0: 0.3, y1: 2.3 },
  ],
  banco: [{ kind: 'vidrio', x0: 0.1, x1: 2.9, y0: 0.2, y1: 2.3 }],
  'banco-puerta': [
    { kind: 'vidrio', x0: 0.1, x1: 0.6, y0: 0.2, y1: 2.3 },
    { kind: 'puerta', x0: 0.7, x1: 2.3, y0: 0, y1: 2.3 },
    { kind: 'vidrio', x0: 2.4, x1: 2.9, y0: 0.2, y1: 2.3 },
  ],
  acceso: [{ kind: 'puerta', x0: 0.4, x1: 2.6, y0: 0, y1: 2.3 }],
};

export const isLotCell = (c: string): c is LotCell => Object.hasOwn(LOT_OPENINGS, c);

/** Una puerta en el mundo: el centro al ras de la cara exterior, la normal (unitaria) hacia afuera, el ancho (m) y el
 *  nivel (0 = planta baja). */
export interface Door { at: Vec2; normal: Vec2; width: number; level: number }

/** Las puertas de `input` sobre la planta guardada de `b`, en el orden de `openings`. */
export function doorsOf(b: Building, input: InteriorInput): Door[] {
  const fp = b.footprint;
  const ccw = signedAreaFromAbove(fp) > 0;
  return input.openings.filter((o) => o.kind === 'puerta').map((o): Door => {
    const [a, c] = [fp[o.edge], fp[(o.edge + 1) % fp.length]];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    const d: Vec2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
    const s = (o.s0 + o.s1) / 2;
    // afuera es la derecha de la arista recorrida en sentido antihorario (visto desde arriba)
    return { at: [a[0] + d[0] * s, a[1] + d[1] * s], normal: ccw ? [-d[1], d[0]] : [d[1], -d[0]], width: o.s1 - o.s0, level: Math.round(o.y0 / LEVEL_H) };
  });
}
