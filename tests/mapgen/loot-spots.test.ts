// Puntos de botín sobre el mapa generado (public/map/adrogue.map.json): cantidad, que estén libres y en su lugar, y que
// el mapa guardado tenga los mismos que se generan ahora.
import { readFileSync } from 'node:fs';
import { roofClusters } from '../../src/mapgen/climb.ts';
import { farthestFromEdges, lootSpots } from '../../src/mapgen/loot-spots.ts';
import { distToRing } from '../../src/mapgen/spatial.ts';
import { DUMPSTER, buildCollisionWorld, roofEdgeY } from '../../src/shared/collision.ts';
import { distPointSegment, pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { LootSpot, MapData } from '../../src/shared/mapdata.ts';
import { PLAYER } from '../../src/shared/player.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const world = buildCollisionWorld(map);
const spots = lootSpots(map, world);
const of = (tier: LootSpot['tier']): LootSpot[] => spots.filter((s) => s.tier === tier);
const xz = (s: LootSpot): Vec2 => [s.pos[0], s.pos[2]];
const vehicular = map.roads.filter((r) => !['footway', 'pedestrian', 'service'].includes(r.kind));
/** Distancia de `p` al eje de la calle `r`. */
const toAxis = (p: Vec2, r: (typeof map.roads)[number]): number =>
  Math.min(...r.points.slice(1).map((q, i) => distPointSegment(p, r.points[i], q)));

/** Edificios a cuyo techo se sube: su cluster de techos tiene una escalera, o un contenedor pegado a un techo al que
 *  se llega desde arriba del contenedor (como hasAccess de assemble.test). */
function reachable(m: MapData): Set<string> {
  const served = new Set<string>();
  for (const p of m.props) {
    if (p.kind === 'ladder') served.add(p.buildingId);
    else if (p.kind === 'dumpster') {
      for (const b of m.buildings)
        if (roofEdgeY(b) <= DUMPSTER.height + PLAYER.mantleReach + 1e-6 && distToRing(p.position, b.footprint) <= DUMPSTER.depth / 2 + 0.3) served.add(b.id);
    }
  }
  return new Set(roofClusters(m.buildings).filter((c) => c.some((id) => served.has(id))).flat());
}

describe('lootSpots sobre el mapa real', () => {
  test('entre 150 y 600 puntos, de los tres niveles', () => {
    expect(spots.length).toBeGreaterThanOrEqual(150);
    expect(spots.length).toBeLessThanOrEqual(600);
    expect(of('calle').length).toBeGreaterThan(100);
    expect(of('techo').length).toBeGreaterThan(100);
  });

  test('todos adentro del área', () => {
    for (const s of spots) {
      expect(s.pos[0]).toBeGreaterThan(map.bounds.minX); expect(s.pos[0]).toBeLessThan(map.bounds.maxX);
      expect(s.pos[2]).toBeGreaterThan(map.bounds.minZ); expect(s.pos[2]).toBeLessThan(map.bounds.maxZ);
    }
  });

  test('cada uno libre: nada se mete en un disco de 0,3 m entre 5 y 50 cm sobre el punto', () => {
    const bad = spots.filter((s) => world.overlaps(s.pos[0], s.pos[2], 0.3, s.pos[1] + 0.05, s.pos[1] + 0.5));
    expect(bad).toEqual([]);
  });

  test('la caja de munición de un arma (a 0,6 m) también queda libre: 0,8 m sin nada alrededor', () => {
    const bad = spots.filter((s) => world.overlaps(s.pos[0], s.pos[2], 0.8, s.pos[1] + 0.05, s.pos[1] + 1.8));
    expect(bad).toEqual([]);
  });

  test('los de calle, en el piso y sobre una vereda: fuera de toda calzada y a lo sumo a una vereda del eje', () => {
    for (const s of of('calle')) {
      const p = xz(s);
      expect(s.pos[1]).toBe(0);
      expect(world.supportHeight(p[0], p[1], 0.35, Infinity), p.join(',')).toBe(0);
      expect(vehicular.some((r) => toAxis(p, r) < r.width / 2), `${p.join(',')} en la calzada`).toBe(false);
      expect(vehicular.some((r) => toAxis(p, r) <= r.width / 2 + r.sidewalk), `${p.join(',')} lejos de las veredas`).toBe(true);
    }
  });

  test('los de techo, a la altura de un techo alcanzable (±1 cm), arriba de él y uno por edificio', () => {
    const reach = reachable(map);
    const used = new Set<string>();
    for (const s of of('techo')) {
      const b = map.buildings.find((x) => !x.fill && pointInPolygon(xz(s), x.footprint) && Math.abs(x.height - s.pos[1]) <= 0.01);
      expect(b, xz(s).join(',')).toBeDefined();
      expect(reach.has(b!.id), b!.id).toBe(true);
      expect(used.has(b!.id), b!.id).toBe(false);
      used.add(b!.id);
      expect(world.supportHeight(s.pos[0], s.pos[2], 0.35, s.pos[1] + 0.01)).toBeCloseTo(s.pos[1], 6);
    }
  });

  test('4 por cada uno de los 9 lugares entrables, frente al cartel a 2–4 m y sobre la vereda', () => {
    const places = map.places.filter((p) => p.enterable);
    expect(places).toHaveLength(9);
    expect(of('lugar')).toHaveLength(4 * 9);
    for (const p of places) {
      const sign = p.sign!;
      const mine = of('lugar').filter((s) => {
        const d = Math.hypot(s.pos[0] - sign.anchor[0], s.pos[2] - sign.anchor[1]);
        return d >= 2 - 1e-6 && d <= 4 + 1e-6;
      });
      expect(mine, p.id).toHaveLength(4);
      mine.forEach((s, i) => mine.slice(i + 1).forEach((t) =>
        expect(Math.hypot(s.pos[0] - t.pos[0], s.pos[2] - t.pos[2]), `${p.id}: dos puntos pegados`).toBeGreaterThanOrEqual(1.5)));
      for (const s of mine) {
        const off: Vec2 = [s.pos[0] - sign.anchor[0], s.pos[2] - sign.anchor[1]];
        expect(off[0] * sign.normal[0] + off[1] * sign.normal[1], `${p.id}: delante del cartel`).toBeGreaterThan(0);
        expect(s.pos[1]).toBe(0);
        expect(vehicular.some((r) => toAxis(xz(s), r) < r.width / 2), `${p.id}: ${xz(s).join(',')} en la calzada`).toBe(false);
      }
    }
  });

  test('espaciados: los de calle a ≥ 50 m entre sí y de los de los lugares; los de techo, a ≥ 50 m entre sí', () => {
    const dist = (s: LootSpot, t: LootSpot): number => Math.hypot(s.pos[0] - t.pos[0], s.pos[2] - t.pos[2]);
    const among = (a: LootSpot[]): number => Math.min(...a.flatMap((s, i) => a.slice(i + 1).map((t) => dist(s, t))));
    const between = (a: LootSpot[], b: LootSpot[]): number => Math.min(...a.flatMap((s) => b.map((t) => dist(s, t))));
    expect(among(of('calle'))).toBeGreaterThanOrEqual(50);
    expect(between(of('calle'), of('lugar'))).toBeGreaterThanOrEqual(50);
    expect(among(of('techo'))).toBeGreaterThanOrEqual(50);
  });

  test('determinista: dos corridas dan lo mismo y el mapa guardado tiene los mismos', () => {
    expect(lootSpots(map, world)).toEqual(spots);
    expect(map.lootSpots).toEqual(spots);
  });
});

describe('farthestFromEdges', () => {
  test('en un rectángulo de 10 × 4: el centro, a 2 m de los bordes', () => {
    const { p, d } = farthestFromEdges([[0, 0], [10, 0], [10, 4], [0, 4]]);
    expect(d).toBeGreaterThan(2 - 0.05); expect(d).toBeLessThanOrEqual(2 + 1e-9);
    expect(p[1]).toBeCloseTo(2, 1);
    expect(p[0]).toBeGreaterThan(2 - 0.05); expect(p[0]).toBeLessThan(8 + 0.05);
  });
  test('en una L de brazos de 4 m: en el codo, donde el círculo toca los dos bordes de afuera y la esquina de adentro', () => {
    // L: brazo de 20 × 4 sobre x y brazo de 4 × 12 sobre z; la esquina de adentro está en (4, 4). En (t, t), la distancia
    // a los bordes x = 0 y z = 0 es t y a la esquina √2·(4 − t): son iguales en t = 4√2 / (1 + √2) ≈ 2,34 (> 2, el medio
    // ancho de un brazo); el centro de la caja (10, 6) queda afuera
    const fp: Vec2[] = [[0, 0], [20, 0], [20, 4], [4, 4], [4, 12], [0, 12]];
    const t = (4 * Math.SQRT2) / (1 + Math.SQRT2);
    const { p, d } = farthestFromEdges(fp);
    expect(pointInPolygon(p, fp)).toBe(true);
    expect(d).toBeGreaterThan(t - 0.05); expect(d).toBeLessThanOrEqual(t + 1e-9);
    expect(Math.hypot(p[0] - t, p[1] - t)).toBeLessThan(0.2);
  });
  test('una planta degenerada da distancia 0', () => expect(farthestFromEdges([[0, 0], [5, 0], [10, 0]]).d).toBe(0));
});
