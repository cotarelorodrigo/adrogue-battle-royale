// Puntos de botín sobre el mapa generado (public/map/adrogue.map.json): cantidad, que estén libres y en su lugar (los de
// los lugares, adentro de sus interiores), y que el mapa guardado tenga los mismos que se generan ahora.
import { readFileSync } from 'node:fs';
import { placementWorld } from '../../src/mapgen/assemble.ts';
import { roofClusters } from '../../src/mapgen/climb.ts';
import { farthestFromEdges, lootSpots, shares, walkable } from '../../src/mapgen/loot-spots.ts';
import type { FloorGrid } from '../../src/mapgen/loot-spots.ts';
import { distToRing } from '../../src/mapgen/spatial.ts';
import { isFreeSpot } from '../../src/mapgen/spawns.ts';
import { CollisionWorld, DUMPSTER, TRUNK_R, buildCollisionWorld, roofEdgeY } from '../../src/shared/collision.ts';
import type { Prism } from '../../src/shared/collision.ts';
import { distPointSegment, pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../src/shared/geo.ts';
import { buildInteriors, publicFloorArea } from '../../src/shared/interiors/index.ts';
import type { FloorArea, StairRun } from '../../src/shared/interiors/types.ts';
import { AMMO_BESIDE } from '../../src/shared/loot.ts';
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
const interiors = buildInteriors(map);
/** D11: los puntos de botín de un lugar con interior, según su piso público (m²). */
const placeCount = (area: number): number => Math.min(12, Math.max(4, Math.round(area / 40)));
/** Los metros libres alrededor de cada punto (CLEAR de loot-spots.ts): la caja de munición a AMMO_BESIDE y su medio ancho. */
const CLEAR = AMMO_BESIDE + 0.2;
const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** El piso público donde se apoya `s`: a su altura, sobre la planta y fuera de los huecos. */
const floorUnder = (floors: FloorArea[], s: LootSpot): FloorArea | undefined =>
  floors.find((f) => f.y === s.pos[1] && pointInPolygon(xz(s), f.polygon) && !f.holes.some((h) => pointInPolygon(xz(s), h)));

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

  test('cada uno de los 9 lugares tiene adentro clamp(round(piso público / 40), 4, 12) puntos, sobre sus pisos públicos', () => {
    expect(map.places.filter((p) => p.enterable)).toHaveLength(9);
    expect(interiors).toHaveLength(9);
    const lugar = of('lugar');
    expect(lugar).toHaveLength(interiors.reduce((n, i) => n + placeCount(publicFloorArea(i)), 0));
    for (const i of interiors) {
      const b = map.buildings.find((x) => x.id === i.buildingId)!;
      const mine = lugar.filter((s) => pointInPolygon(xz(s), i.footprint));
      expect(mine, i.placeId).toHaveLength(placeCount(publicFloorArea(i)));
      for (const s of mine) {
        const at = `${i.placeId}: ${s.pos.join(', ')}`;
        // adentro de la planta, debajo del techo, o sobre la terraza (el único techo público)
        expect(s.pos[1] < b.height || (i.terrace && s.pos[1] === b.height), `${at}: fuera del edificio`).toBe(true);
        expect(floorUnder(i.floors, s), `${at}: no está sobre un piso público a su altura`).toBeDefined();
        expect(isFreeSpot(world, s.pos[0], s.pos[2], s.pos[1]), `${at}: no es un punto libre`).toBe(true);
        expect(vehicular.some((r) => toAxis(xz(s), r) <= r.width / 2 + r.sidewalk), `${at}: sobre la vereda`).toBe(false);
      }
      mine.forEach((s, k) => mine.slice(k + 1).forEach((t) =>
        expect(dist3(s.pos, t.pos), `${i.placeId}: dos puntos pegados`).toBeGreaterThanOrEqual(1.5)));
    }
  });

  test('los de un lugar se reparten entre sus pisos públicos según el área (a menos de 1 punto de la proporción)', () => {
    for (const i of interiors) {
      const mine = of('lugar').filter((s) => pointInPolygon(xz(s), i.footprint));
      const total = publicFloorArea(i);
      for (const f of i.floors) {
        const here = mine.filter((s) => floorUnder([f], s)).length;
        expect(Math.abs(here - (mine.length * f.area) / total), `${i.placeId}, piso ${f.level}: ${here} de ${mine.length}`).toBeLessThan(1);
      }
    }
  });

  test('los de un lugar dejan libre el piso de la caja de munición: a ≥ 0,8 m de la pared y de los huecos de su piso', () => {
    for (const i of interiors) {
      for (const s of of('lugar').filter((x) => pointInPolygon(xz(x), i.footprint))) {
        const f = floorUnder(i.floors, s)!;
        const at = `${i.placeId}: ${s.pos.join(', ')}`;
        expect(distToRing(xz(s), f.polygon), at).toBeGreaterThanOrEqual(CLEAR - 1e-6);
        for (const h of f.holes) expect(distToRing(xz(s), h), `${at}: pegado a un hueco`).toBeGreaterThanOrEqual(CLEAR - 1e-6);
      }
    }
  });

  // La calle se separa de la puerta principal de cada lugar con interior (donde estaba el botín del frente antes de los
  // interiores): su botín está adentro y la vereda de la entrada no lleva otro. Con la pared en el medio, un punto de
  // calle puede quedar a menos de 50 m de uno de adentro (el fondo de la Casa de la Cultura está a 45 m de la puerta).
  test('espaciados: los de calle a ≥ 50 m entre sí y de la puerta principal de cada lugar; los de techo, a ≥ 50 m entre sí', () => {
    const dist = (s: LootSpot, t: LootSpot): number => Math.hypot(s.pos[0] - t.pos[0], s.pos[2] - t.pos[2]);
    const among = (a: LootSpot[]): number => Math.min(...a.flatMap((s, i) => a.slice(i + 1).map((t) => dist(s, t))));
    const doors = map.places.flatMap((p) => (p.door ? [p.door] : []));
    expect(doors).toHaveLength(9);
    expect(among(of('calle'))).toBeGreaterThanOrEqual(50);
    expect(Math.min(...of('calle').flatMap((s) => doors.map((d) => Math.hypot(s.pos[0] - d[0], s.pos[2] - d[1]))))).toBeGreaterThanOrEqual(50);
    expect(among(of('techo'))).toBeGreaterThanOrEqual(50);
  });

  test('determinista: dos corridas dan lo mismo y el mapa guardado tiene los mismos', () => {
    expect(lootSpots(map, world)).toEqual(spots);
    expect(map.lootSpots).toEqual(spots);
  });
});

describe('troncos de los patios (H10 de la T9)', () => {
  const trunks = interiors.flatMap((i) => i.trees);

  test('el mundo de prismas llenos de assemble tiene el tronco de cada árbol de patio', () => {
    expect(trunks.length).toBeGreaterThan(0);
    const w = placementWorld(map, interiors);
    for (const t of trunks) expect(w.overlaps(t.position[0], t.position[1], 0.05, 0.05, 1.8), t.position.join(', ')).toBe(true);
    // y sigue siendo el de prismas llenos: 1,5 m adentro de la puerta principal de cada interior hay edificio macizo
    for (const i of interiors) {
      const d = i.doors[0];
      const p: Vec2 = [d.at[0] - d.normal[0] * 1.5, d.at[1] - d.normal[1] * 1.5];
      expect(w.overlaps(p[0], p[1], 0.05, 0.05, 1.8), `${i.placeId}: hueco en el mundo de prismas llenos`).toBe(true);
    }
  });

  test('ningún punto de botín ni de aparición queda a menos de CLEAR (0,8 m) de un tronco de patio', () => {
    const points: Vec3[] = [...spots.map((s) => s.pos), ...map.randomSpawns, ...map.places.map((p) => p.spawn)];
    for (const t of trunks) {
      for (const p of points) {
        const d = Math.hypot(p[0] - t.position[0], p[2] - t.position[1]) - TRUNK_R;
        expect(d, `${p.join(', ')} a ${d.toFixed(2)} m del tronco de ${t.position.join(', ')}`).toBeGreaterThanOrEqual(CLEAR);
      }
    }
  });
});

// A dónde se llega caminando desde la puerta principal, en un mundo de prueba con el marco alineado a los ejes: un piso
// de 12 × 10 m con la puerta en x = 0; un cuarto cerrado; un tabique a 30° de la grilla con un paso; y un piso alto
// (una losa a 3,2 m, aparte) al que se sube solo por una escalera.
describe('walkable: lo que se alcanza caminando desde la puerta principal', () => {
  const bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  const box = (x0: number, z0: number, x1: number, z1: number, y0 = 0, y1 = 3): Prism => ({ polygon: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], minY: y0, maxY: y1 });
  /** Un tabique de 0,1 m de espesor de `a` a `b`. */
  const wall = (a: Vec2, b: Vec2): Prism => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [nx, nz] = [(-(b[1] - a[1]) / l) * 0.05, ((b[0] - a[0]) / l) * 0.05];
    return { polygon: [[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]], minY: 0, maxY: 3 };
  };
  const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const frame = { origin: [0, 0] as Vec2, u: [1, 0] as Vec2, v: [0, 1] as Vec2 };
  const ground: FloorArea = { level: 0, y: 0, polygon: rect(0, 0, 12, 10), holes: [], area: 120 };
  const upper: FloorArea = { level: 1, y: 3.2, polygon: rect(20, 0, 30, 10), holes: [], area: 100 };
  const door = { at: [0, 5] as Vec2, normal: [-1, 0] as Vec2, width: 1.2, level: 0 };
  // el cuarto cerrado, de (8, 1) a (11, 4)
  const room = [wall([8, 1], [11, 1]), wall([11, 1], [11, 4]), wall([11, 4], [8, 4]), wall([8, 4], [8, 1])];
  /** Un tabique que cruza el piso por (4, 7) a 30° del eje z, con un paso de `gap` m en el medio. */
  const slanted = (gap: number): Prism[] => {
    const d: Vec2 = [Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
    const end = (t: number): Vec2 => [4 + d[0] * t, 7 + d[1] * t];
    return [wall(end(-12), end(-gap / 2)), wall(end(gap / 2), end(12))];
  };
  const stair: StairRun = { from: 0, to: 1, foot: [5, 0, 2], top: [21, 3.2, 5], yaw: 0 };
  const run = (prisms: Prism[], stairs: StairRun[] = []): FloorGrid[] =>
    walkable(new CollisionWorld([...prisms, box(20, 0, 30, 10, 3, 3.2)], [], bounds), { floors: [ground, upper], doors: [door], stairs }, frame);
  /** ¿Se llega a la celda más cercana a `p` del piso `k`? (Tiene que ser una celda libre.) */
  const reaches = (g: FloorGrid[], k: number, p: Vec2): boolean => {
    let best = 0;
    for (let c = 0; c < g[k].x.length; c++) {
      if (Math.hypot(g[k].x[c] - p[0], g[k].z[c] - p[1]) < Math.hypot(g[k].x[best] - p[0], g[k].z[best] - p[1])) best = c;
    }
    expect(g[k].free[best], `${p.join(', ')} no es una celda libre`).toBe(1);
    return g[k].reached[best] === 1;
  };

  test('el cuarto cerrado es piso libre, pero no se llega', () => {
    const g = run(room);
    expect(reaches(g, 0, [2, 5])).toBe(true);
    expect(reaches(g, 0, [9.5, 2.5])).toBe(false);
  });

  test('por un paso de 1 m en un tabique a 30° de la grilla se pasa; por uno de 0,6 m, no', () => {
    // del otro lado del tabique (hacia +x): el punto (10, 8)
    expect(reaches(run(slanted(1.0)), 0, [10, 8])).toBe(true);
    expect(reaches(run(slanted(0.6)), 0, [10, 8])).toBe(false);
  });

  test('al piso alto se llega solo por su escalera (del pie en planta baja a la llegada arriba)', () => {
    expect(reaches(run([]), 1, [25, 5])).toBe(false);
    expect(reaches(run([], [stair]), 1, [25, 5])).toBe(true);
    // con el pie de la escalera adentro del cuarto cerrado, tampoco
    expect(reaches(run(room, [{ ...stair, foot: [9.5, 0, 2.5] }]), 1, [25, 5])).toBe(false);
  });
});

// m9 de la revisión final: el desempate va por nivel aunque `floors` no venga ordenado
describe('shares: cuántos puntos le tocan a cada piso', () => {
  test('según el área: la parte entera y lo que sobra a los de mayor resto', () => {
    expect(shares([{ area: 300, level: 0 }, { area: 100, level: 1 }], 8)).toEqual([6, 2]);
    expect(shares([{ area: 250, level: 0 }, { area: 150, level: 1 }], 7)).toEqual([4, 3]); // 4,375 y 2,625
  });
  test('en empate de restos, el de nivel más bajo, aunque venga después en floors', () => {
    expect(shares([{ area: 100, level: 0 }, { area: 100, level: 1 }], 5)).toEqual([3, 2]);
    expect(shares([{ area: 100, level: 1 }, { area: 100, level: 0 }], 5)).toEqual([2, 3]);
    // en el mismo nivel, el primero de floors
    expect(shares([{ area: 100, level: 1 }, { area: 100, level: 1 }, { area: 200, level: 0 }], 5)).toEqual([1, 1, 3]);
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
