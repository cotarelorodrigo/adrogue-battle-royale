// Interior de prueba: un local de 10 m de frente × 15 m de fondo y 2 pisos (7 m), con la puerta en el medio del frente
// y un vidrio a cada lado. Lo usan kit.test y los tests del dibujo (tarea 5).
import { CollisionWorld, interiorPrisms } from '../../../src/shared/collision.ts';
import { Kit } from '../../../src/shared/interiors/kit.ts';
import type { Interior, Look } from '../../../src/shared/interiors/types.ts';
import type { Bounds, Building, InteriorInput } from '../../../src/shared/mapdata.ts';

export const FIXTURE_BOUNDS: Bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
export const LOOKS = {
  pared: { mat: 'liso', color: '#eeeae2' },
  piso: { mat: 'porcelanato', color: '#d0ccc4' },
  techo: { mat: 'liso', color: '#f6f4f0' },
  escalera: { mat: 'madera', color: '#8a6a4a' },
  baranda: { mat: 'metal', color: '#202020' },
} as const satisfies Record<string, Look>;

/**
 * El local en el mundo (el marco local coincide con el del mundo): x ∈ [0, 10] a lo largo del frente, z ∈ [0, 15] hacia
 * adentro; el frente es la arista 0, de (10, 0) a (0, 0), y da a la calle (z < 0).
 * - Puerta de 1,6 m centrada en x = 5 (del piso a 2,3 m).
 * - Vidrios de 3,2 m de 0,3 a 2,3 m: x ∈ [6,3, 9,5] y x ∈ [0,5, 3,7].
 * - Con `stair`, una escalera de 1,2 m de ancho del nivel 0 al 1 contra la pared de x = 10: arranca en z = 4 y sube
 *   hacia +z. `extra` agrega lo que pida cada test antes de `done`.
 */
export function testInterior(o: { publicFloors?: number; stair?: boolean; extra?: (k: Kit) => void } = {}): {
  b: Building; input: InteriorInput; interior: Interior; world: CollisionWorld;
} {
  const b: Building = { id: 'b-prueba', footprint: [[10, 0], [0, 0], [0, 15], [10, 15]], height: 7, floors: 2, kind: 'shop', wall: 'plaster', tint: '#d8d0c0' };
  const input: InteriorInput = {
    placeId: 'prueba', buildingId: b.id, frame: { origin: [0, 0], u: [1, 0], v: [0, 1] },
    openings: [
      { kind: 'vidrio', edge: 0, s0: 0.5, s1: 3.7, y0: 0.3, y1: 2.3 },
      { kind: 'puerta', edge: 0, s0: 4.2, s1: 5.8, y0: 0, y1: 2.3 },
      { kind: 'vidrio', edge: 0, s0: 6.3, s1: 9.5, y0: 0.3, y1: 2.3 },
    ],
    patios: [],
  };
  const k = new Kit(b, input);
  k.shell({ publicFloors: o.publicFloors ?? 1, wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
  if (o.stair) k.stair({ from: 0, to: 1, foot: [9.2, 4], dir: [0, 1], width: 1.2, look: LOOKS.escalera, rail: LOOKS.baranda });
  o.extra?.(k);
  const interior = k.done(0.8);
  return { b, input, interior, world: new CollisionWorld(interiorPrisms(interior), [], FIXTURE_BOUNDS) };
}
