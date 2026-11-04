import polygonClipping from 'polygon-clipping';
import { heightFor } from '../../src/mapgen/buildings.ts';
import { analyzeGround, exitPockets, solidOutlines } from '../../src/mapgen/pockets.ts';
import { buildCollisionWorld, PARAPET_H } from '../../src/shared/collision.ts';
import { ensureCCW, pointInPolygon, polygonArea } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Building, MapData, Prop } from '../../src/shared/mapdata.ts';
import { climbOut, regionAt } from './pocket-exit.ts';

const box = (id: string, x0: number, z0: number, x1: number, z1: number, floors: number): Building => ({
  id, footprint: ensureCCW([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]), height: heightFor(floors), floors,
  kind: 'house', wall: 'plaster', tint: '#ccc',
});
const mapOf = (buildings: Building[], props: Prop[]): MapData => ({
  version: 1, origin: { lat: 0, lon: 0 }, bounds: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 },
  buildings, outskirts: [], roads: [], railways: [], platforms: [], parks: [], places: [], props, trees: [], randomSpawns: [], lootSpots: [], signs: [], interiors: [],
});
// escalera de afuera, sobre la pared norte del bloque N: el techo de los cuatro (un solo cluster) es accesible
const outsideLadder: Prop = { kind: 'ladder', base: [0, -10], normal: [0, -1], topY: heightFor(2), buildingId: 'N' };

describe('patio cerrado por una U de edificios', () => {
  // U = O, N, E (2 pisos); S cierra la boca. Patio de 12 × 12 m en el medio.
  const yard = (): MapData => mapOf([
    box('O', -10, -10, -6, 10, 2), box('N', -6, -10, 6, -6, 2), box('E', 6, -10, 10, 10, 2), box('S', -6, 6, 6, 10, 2),
  ], [outsideLadder]);

  test('el flood fill encuentra el patio como hueco', () => {
    const g = analyzeGround(buildCollisionWorld(yard()), solidOutlines(yard()));
    expect(g.pockets).toHaveLength(1);
    expect(g.pockets[0].area).toBeGreaterThan(100);
    expect(regionAt(g, 0, 0)).toBe(1);
    expect(regionAt(g, -20, 0)).toBe(0);
  });

  test('el patio recibe una escalera adentro que sube a un techo accesible', () => {
    const map = yard();
    const { stats, warnings } = exitPockets(map);
    expect(warnings).toEqual([]);
    expect(stats).toEqual({ pockets: 1, ladders: 1, filled: 0 });
    const added = map.props.filter((p): p is Extract<Prop, { kind: 'ladder' }> => p.kind === 'ladder' && p !== outsideLadder);
    expect(added).toHaveLength(1);
    const l = added[0];
    // la base sobre una pared del patio, la normal hacia el patio
    expect(Math.abs(l.base[0]) <= 6 + 1e-9 && Math.abs(l.base[1]) <= 6 + 1e-9).toBe(true);
    expect(Math.hypot(l.base[0] + l.normal[0], l.base[1] + l.normal[1])).toBeLessThan(Math.hypot(l.base[0], l.base[1]));
    expect(l.topY).toBe(heightFor(2) + PARAPET_H); // hasta el tope del pretil
    const world = buildCollisionWorld(map);
    const g = analyzeGround(world, solidOutlines(map));
    expect(g.pockets).toHaveLength(1);
    expect(climbOut(world, map, g.pockets[0])).toBe(l);
  });

  test('determinista', () => {
    const a = yard(), b = yard();
    exitPockets(a);
    exitPockets(b);
    expect(a).toEqual(b);
  });
});

describe('rendija cerrada donde no entra una escalera', () => {
  // A (1 piso) y B (2 pisos) separados 0,76 m; C y D (3 pisos) cierran las puntas; C es accesible (escalera afuera).
  // El jugador cabe (0,7 m) pero la escalera no: su pie va a 0,45 m de la pared y su caja mide 0,8 m de ancho.
  const slit = (): MapData => mapOf([
    box('A', -10, -5, -0.38, 5, 1), box('B', 0.38, -5, 10, 5, 2), box('C', -10, -8, 10, -5, 3), box('D', -10, 5, 10, 8, 3),
  ], [{ kind: 'ladder', base: [0, -8], normal: [0, -1], topY: heightFor(3), buildingId: 'C' }]);

  test('se rellena al ras del techo vecino más bajo, sin pisar a los vecinos y sin dejar hueco', () => {
    const map = slit();
    expect(analyzeGround(buildCollisionWorld(map), solidOutlines(map)).pockets).toHaveLength(1);
    const { stats, warnings } = exitPockets(map);
    expect(warnings).toEqual([]);
    expect(stats).toEqual({ pockets: 1, ladders: 0, filled: 1 });
    const fills = map.buildings.filter((b) => b.fill);
    expect(fills.length).toBeGreaterThan(0);
    for (const f of fills) {
      expect(f.height).toBeCloseTo(heightFor(1) - 0.01, 9);
      expect(f.id).toMatch(/^r\d{4}$/);
      for (const n of map.buildings.filter((b) => !b.fill)) {
        const inter = polygonClipping.intersection([[...f.footprint, f.footprint[0]]], [[...n.footprint, n.footprint[0]]]);
        const area = inter.reduce((s, poly) => s + polygonArea(poly[0].slice(0, -1) as Vec2[]), 0);
        expect(area, `${f.id} ∩ ${n.id}`).toBeLessThan(1e-3);
      }
    }
    // cubre la rendija de punta a punta
    for (const z of [-4.9, -2, 0, 2, 4.9]) expect(fills.some((f) => pointInPolygon([0, z], f.footprint)), `z=${z}`).toBe(true);
    // y ya no queda ningún hueco
    expect(analyzeGround(buildCollisionWorld(map), solidOutlines(map)).pockets).toEqual([]);
  });
});
