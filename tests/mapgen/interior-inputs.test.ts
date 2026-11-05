import { readFileSync } from 'node:fs';
import mini from '../fixtures/osm-mini.json';
import { FRONT_CELLS, cellRect } from '../../src/client/world/front-atlas.ts';
import { BAY_W, extrudeBuilding } from '../../src/client/world/geometry.ts';
import { assembleMap } from '../../src/mapgen/assemble.ts';
import type { GeoJSONFeatureCollection } from '../../src/mapgen/buildings.ts';
import type { FrentesInput } from '../../src/mapgen/frentes-input.ts';
import { lotOpenings } from '../../src/mapgen/interior-inputs.ts';
import { aidEnds, doorBay } from '../../src/mapgen/lots.ts';
import { parseOsm } from '../../src/mapgen/osm.ts';
import { loadPlaces } from '../../src/mapgen/places-input.ts';
import { SIN_LOTE, loadPlantas } from '../../src/mapgen/plantas-input.ts';
import type { PlantaInput } from '../../src/mapgen/plantas-input.ts';
import { placePlantas, plantaDoors } from '../../src/mapgen/plantas.ts';
import { isFatalWarning, isFreeSpot, walksIn } from '../../src/mapgen/spawns.ts';
import { CollisionWorld, buildCollisionWorld } from '../../src/shared/collision.ts';
import type { Prism } from '../../src/shared/collision.ts';
import { distPointSegment, pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../src/shared/geo.ts';
import { DOOR_MIN_W, LINTEL_MIN, LOT_OPENINGS, doorsOf } from '../../src/shared/interiors/openings.ts';
import type { Building, InteriorInput, MapData } from '../../src/shared/mapdata.ts';
import { loadRaw } from '../helpers.ts';

const NO_FRENTES: FrentesInput = { frentes: [], calzadas: {} };
const edgeLen = (fp: Vec2[], e: number): number => Math.hypot(fp[(e + 1) % fp.length][0] - fp[e][0], fp[(e + 1) % fp.length][1] - fp[e][1]);
const ringDist = (p: Vec2, fp: Vec2[]): number => Math.min(...fp.map((a, i) => distPointSegment(p, a, fp[(i + 1) % fp.length])));
/** Adentro del anillo o sobre su borde (1 cm): el origen de un lote es su esquina, y origin + 0,5·V corre sobre la
 *  medianera cuando el lote es rectangular. */
const inOrOn = (p: Vec2, r: Vec2[]): boolean => pointInPolygon(p, r) || ringDist(p, r) < 0.01;
const add = (a: Vec2, b: Vec2, k = 1): Vec2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const xz = (s: Vec3): Vec2 => [s[0], s[2]];


/** Las comprobaciones de un mapa: marcos, aberturas, puerta del lugar y punto de aparición. */
function checkInteriors(map: MapData): void {
  const world = buildCollisionWorld(map);
  const byId = new Map(map.buildings.map((b) => [b.id, b]));
  for (const input of map.interiors) {
    const b = byId.get(input.buildingId)!;
    const place = map.places.find((p) => p.id === input.placeId)!;
    const fp = b.footprint;
    const { origin, u, v } = input.frame;
    expect(Math.hypot(...u), input.placeId).toBeCloseTo(1, 9);
    expect(Math.hypot(...v), input.placeId).toBeCloseTo(1, 9);
    expect(Math.abs(u[0] * v[0] + u[1] * v[1]), input.placeId).toBeLessThan(1e-9);
    // V entra al edificio: con un patio adelante (D12), el origen está sobre la línea y el punto cae en el patio
    expect([fp, ...input.patios].some((r) => inOrOn(add(origin, v, 0.5), r)), `${input.placeId}: origin + 0,5·V`).toBe(true);
    for (const o of input.openings) {
      expect(Number.isInteger(o.edge) && o.edge >= 0 && o.edge < fp.length, input.placeId).toBe(true);
      expect(o.s0, input.placeId).toBeGreaterThanOrEqual(0);
      expect(o.s1, input.placeId).toBeGreaterThan(o.s0);
      expect(o.s1, input.placeId).toBeLessThanOrEqual(edgeLen(fp, o.edge) + 1e-9);
      expect(o.y1, input.placeId).toBeGreaterThan(o.y0);
    }
    const doors = doorsOf(b, input);
    expect(doors.length, input.placeId).toBeGreaterThan(0);
    for (const d of doors) {
      expect(d.width, input.placeId).toBeGreaterThanOrEqual(DOOR_MIN_W - 0.01);
      expect(pointInPolygon(add(d.at, d.normal, 0.05), fp), `${input.placeId}: la normal apunta hacia afuera`).toBe(false);
      expect(pointInPolygon(add(d.at, d.normal, -0.05), fp), `${input.placeId}: la normal apunta hacia afuera`).toBe(true);
    }
    // la puerta del lugar es la principal, sobre el borde de la planta
    expect(place.buildingId).toBe(b.id);
    expect(place.door, input.placeId).toBeDefined();
    expect(dist(place.door!, doors[0].at), input.placeId).toBeLessThan(0.01);
    expect(ringDist(place.door!, fp), input.placeId).toBeLessThan(0.01);
    // el punto de aparición: libre, afuera, a 3 a 8 m de la puerta y con camino recto hasta ella
    const s = place.spawn;
    expect(isFreeSpot(world, s[0], s[2]), input.placeId).toBe(true);
    expect(pointInPolygon(xz(s), fp), input.placeId).toBe(false);
    for (const pt of input.patios) expect(pointInPolygon(xz(s), pt), input.placeId).toBe(false);
    const d = dist(xz(s), doors[0].at);
    expect(d, input.placeId).toBeGreaterThanOrEqual(3);
    expect(d, input.placeId).toBeLessThanOrEqual(8);
    expect(walksIn(world, s, doors[0]), input.placeId).toBe(true);
  }
  // los lugares sin interior no tienen puerta
  for (const p of map.places) if (!map.interiors.some((i) => i.placeId === p.id)) expect(p.door, p.id).toBeUndefined();
}

describe('LOT_OPENINGS', () => {
  test('puertas del piso a ≥ 2,2 m y de ≥ 1,0 m aun en la bahía más angosta (2,25 m); todo entra en la celda sin pisarse', () => {
    for (const [cell, ops] of Object.entries(LOT_OPENINGS)) {
      for (const o of ops) {
        expect(o.x0, cell).toBeGreaterThanOrEqual(0);
        expect(o.x1, cell).toBeLessThanOrEqual(3);
        expect(o.x1, cell).toBeGreaterThan(o.x0);
        expect(o.y1, cell).toBeLessThanOrEqual(2.4); // la banda del cartel (2,4 a 3,2 m) queda de pared
        if (o.kind === 'puerta') {
          expect(o.y0, cell).toBe(0);
          expect(o.y1, cell).toBeGreaterThanOrEqual(LINTEL_MIN);
          expect((o.x1 - o.x0) * (2.25 / 3), cell).toBeGreaterThanOrEqual(DOOR_MIN_W);
        }
      }
      const xs = [...ops].sort((a, b) => a.x0 - b.x0);
      for (let i = 1; i < xs.length; i++) expect(xs[i].x0, cell).toBeGreaterThan(xs[i - 1].x1);
    }
    expect(Object.keys(LOT_OPENINGS).sort()).toEqual(['acceso', 'banco', 'banco-puerta', 'vidriera', 'vidriera-puerta']);
  });
});

describe('lotOpenings y el atlas', () => {
  /** La celda del atlas y la x (m, de 0 a BAY_W) que la fachada del cliente pinta en el punto `p` de la planta baja. */
  function paintedAt(b: Building, p: Vec2): { cell: string; x: number } {
    const g = extrudeBuilding(b).walls.front;
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let q = 0; q < pos.count; q += 4) {
      const low = [0, 1, 2, 3].map((k) => q + k).filter((i) => Math.abs(pos.getY(i)) < 1e-6);
      if (low.length !== 2) continue;
      const [a, c] = low.map((i): Vec2 => [pos.getX(i), pos.getZ(i)]);
      if (distPointSegment(p, a, c) > 1e-3) continue;
      const t = dist(p, a) / dist(a, c);
      const u = uv.getX(low[0]) + (uv.getX(low[1]) - uv.getX(low[0])) * t;
      const v = (uv.getY(low[0]) + uv.getY(low[1])) / 2 + 1e-4;
      const cell = FRONT_CELLS.find((f) => { const r = cellRect(f); return u >= r.u0 - 1e-6 && u <= r.u1 + 1e-6 && v >= r.v0 && v <= r.v1; })!;
      const r = cellRect(cell);
      return { cell, x: ((u - r.u0) / (r.u1 - r.u0)) * BAY_W };
    }
    throw new Error(`nada pintado en ${p.join(', ')}`);
  }
  // 10 × 9 m con la puerta de vidriera (asimétrica) en la bahía de desde; la misma arista guardada en los dos sentidos
  const ccw: Vec2[] = [[0, 0], [10, 0], [10, -9], [0, -9]];
  const shop = (footprint: Vec2[], edge: number, contra: boolean): Building => ({
    id: 'l', footprint, height: 7, floors: 2, kind: 'shop', wall: 'plaster', tint: '#ccc',
    front: { edges: [edge], corner: [], pb: 'vidriera', arriba: 'ventanas', puerta: 'inicio', ...(contra ? { contra: true as const } : {}) },
  });
  test.each([
    ['antihoraria', ccw, 0, false], ['antihoraria, contra', ccw, 0, true],
    ['horaria', [...ccw].reverse(), 2, false], ['horaria, contra', [...ccw].reverse(), 2, true],
  ] as [string, Vec2[], number, boolean][])('planta %s: cada abertura cae donde el atlas pinta su rectángulo', (_, fp, edge, contra) => {
    const b = shop(fp, edge, contra);
    const ops = lotOpenings(b);
    expect(ops.filter((o) => o.kind === 'puerta')).toHaveLength(1);
    expect(ops).toHaveLength(2 + 1 + 1); // 3 bahías: la de la puerta (puerta y vidrio) y dos vidrieras
    const [a, c] = [fp[edge], fp[(edge + 1) % 4]];
    const at = (s: number): Vec2 => [a[0] + ((c[0] - a[0]) * s) / 10, a[1] + ((c[1] - a[1]) * s) / 10];
    for (const o of ops) {
      for (const s of [o.s0 + 0.03, (o.s0 + o.s1) / 2, o.s1 - 0.03]) {
        const { cell, x } = paintedAt(b, at(s));
        const rect = LOT_OPENINGS[cell as keyof typeof LOT_OPENINGS]?.find((r) => r.kind === o.kind && x >= r.x0 - 0.01 && x <= r.x1 + 0.01);
        expect(rect, `${o.kind} a ${s.toFixed(2)} m: ${cell} x = ${x.toFixed(2)}`).toBeDefined();
      }
    }
    // la puerta, en la bahía de desde (sin contra, la arista guardada arranca en desde, en los dos sentidos de la planta)
    const door = ops.find((o) => o.kind === 'puerta')!;
    const fromDesde = (s: number): number => (contra ? 10 - s : s);
    expect(Math.max(fromDesde(door.s0), fromDesde(door.s1))).toBeLessThan(10 / 3);
  });
});

describe('doorsOf', () => {
  const b: Building = { id: 'x', footprint: [[0, 0], [10, 0], [10, -8], [0, -8]], height: 4, floors: 1, kind: 'shop', wall: 'plaster', tint: '#ccc' };
  const input: InteriorInput = {
    placeId: 'p', buildingId: 'x', frame: { origin: [0, 0], u: [1, 0], v: [0, -1] }, patios: [],
    openings: [
      { kind: 'vidrio', edge: 0, s0: 0.5, s1: 3, y0: 0.3, y1: 2.3 },
      { kind: 'puerta', edge: 0, s0: 4, s1: 6, y0: 0, y1: 2.3 },
      { kind: 'puerta', edge: 1, s0: 1, s1: 2.2, y0: 3.2, y1: 5.4 },
    ],
  };
  test('en el orden de openings: el centro sobre la cara, la normal hacia afuera, el ancho y el nivel', () => {
    const ds = doorsOf(b, input);
    expect(ds).toHaveLength(2);
    expect(ds[0]).toEqual({ at: [5, 0], normal: [expect.closeTo(0, 9), expect.closeTo(1, 9)], width: 2, level: 0 });
    expect(ds[1].at[0]).toBeCloseTo(10);
    expect(ds[1].at[1]).toBeCloseTo(-1.6);
    expect(ds[1].normal[0]).toBeCloseTo(1);
    expect(ds[1].level).toBe(1);
    // la misma planta guardada al revés (horaria): la normal sigue hacia afuera
    const cw = { ...b, footprint: [...b.footprint].reverse() };
    const back = doorsOf(cw, { ...input, openings: [{ kind: 'puerta', edge: 2, s0: 4, s1: 6, y0: 0, y1: 2.3 }] });
    expect(back[0].at).toEqual([5, 0]);
    expect(back[0].normal[1]).toBeCloseTo(1);
  });
});

describe('walksIn', () => {
  const box = (x0: number, z0: number, x1: number, z1: number, maxY: number, minY = 0): Prism =>
    ({ polygon: [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], minY, maxY });
  const bounds = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 };
  const door = { at: [0, 0] as Vec2, normal: [0, 1] as Vec2, width: 1.6, level: 0 };
  const house = box(-5, -10, 5, 0, 4);
  test('derecho hasta la puerta: libre', () => expect(walksIn(new CollisionWorld([house], [], bounds), [0, 0, 5], door)).toBe(true));
  test('un poste en el medio lo corta; un banco bajo (hasta 0,5 m), no', () => {
    expect(walksIn(new CollisionWorld([house, box(-0.2, 2.3, 0.2, 2.7, 3)], [], bounds), [0, 0, 5], door)).toBe(false);
    expect(walksIn(new CollisionWorld([house, box(-1, 2.3, 1, 2.7, 0.5)], [], bounds), [0, 0, 5], door)).toBe(true);
  });
});

describe('interiores sobre el mapa real', () => {
  const { map } = assembleMap(loadRaw());
  const byId = new Map(map.buildings.map((b) => [b.id, b]));
  const place = (id: string) => map.places.find((p) => p.id === id)!;

  test('lotOpenings del Banco Nación: una sola puerta, en la bahía del medio; vidrios en las otras', () => {
    const b = byId.get(place('banco-nacion').buildingId!)!;
    const f = b.front!;
    expect(f.puerta).toBe('medio');
    const ops = lotOpenings(b);
    // posición sobre la corrida principal, de desde a hasta
    const starts = new Map<number, number>();
    let acc = 0;
    for (const e of f.edges) { starts.set(e, acc); acc += edgeLen(b.footprint, e); }
    const runPos = (edge: number, s: number): number => starts.get(edge)! + (f.contra ? edgeLen(b.footprint, edge) - s : s);
    const { n, bay } = doorBay(acc, 'medio');
    const bayOf = (o: (typeof ops)[number]): number => Math.min(n - 1, Math.floor(runPos(o.edge, (o.s0 + o.s1) / 2) / (acc / n)));
    const doors = ops.filter((o) => o.kind === 'puerta');
    expect(doors).toHaveLength(1);
    const [d] = doors;
    expect(bayOf(d)).toBe(bay);
    expect(d.y0).toBe(0);
    expect(d.y1).toBeGreaterThanOrEqual(2.2);
    expect(d.s1 - d.s0).toBeGreaterThanOrEqual(1.0);
    const glassBays = new Set(ops.filter((o) => o.kind === 'vidrio').map(bayOf));
    for (let k = 0; k < n; k++) if (k !== bay) expect(glassBays.has(k), `bahía ${k}`).toBe(true);
    for (const o of ops) {
      expect(f.edges).toContain(o.edge);
      expect(o.s0).toBeGreaterThanOrEqual(0);
      expect(o.s1).toBeGreaterThan(o.s0);
      expect(o.s1).toBeLessThanOrEqual(edgeLen(b.footprint, o.edge));
    }
  });

  test('uno por lugar entrable presente: los cuatro lotes, y los de SIN_LOTE solo con su planta', () => {
    const ids = map.interiors.map((i) => i.placeId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['banco-nacion', 'galicia', 'bbva', 'casa-de-la-cultura']) expect(ids, id).toContain(id);
    for (const p of map.places) {
      const b = p.buildingId ? byId.get(p.buildingId) : undefined;
      // un lugar entrable tiene interior si su edificio es un lote relevado o una planta (las de SIN_LOTE, sin planta, todavía no)
      expect(ids.includes(p.id), p.id).toBe(p.enterable && b?.front !== undefined);
    }
    for (const i of map.interiors) {
      expect(byId.get(i.buildingId), i.placeId).toBeDefined();
      expect(i.buildingId, i.placeId).toBe(SIN_LOTE.includes(i.placeId) ? `pl-${i.placeId}` : place(i.placeId).buildingId);
    }
  });

  test('marcos, aberturas, Place.door y punto de aparición', () => checkInteriors(map));

  test('randomSpawns: ninguno adentro de una planta o un patio de un interior', () => {
    for (const s of map.randomSpawns) {
      for (const i of map.interiors) {
        expect(pointInPolygon(xz(s), byId.get(i.buildingId)!.footprint), s.join(',')).toBe(false);
        for (const pt of i.patios) expect(pointInPolygon(xz(s), pt), s.join(',')).toBe(false);
      }
    }
  });

  test('ningún pie de escalera ni contenedor queda a menos de 1,0 m de la puerta (0,5 m afuera)', () => {
    const aids = map.props.flatMap((p) => (p.kind === 'ladder' ? [p.base] : p.kind === 'dumpster' ? [p.position] : []));
    for (const i of map.interiors) {
      for (const d of doorsOf(byId.get(i.buildingId)!, i)) {
        const front = add(d.at, d.normal, 0.5);
        for (const a of aids) expect(dist(a, front), `${i.placeId}: ${a.join(',')}`).toBeGreaterThanOrEqual(1.0);
      }
    }
  });
});

describe('interiores de las plantas (fixture)', () => {
  const ms = JSON.parse(readFileSync('tests/fixtures/buildings-mini.geojson', 'utf8')) as GeoJSONFeatureCollection;
  const places = loadPlaces().filter((p) => SIN_LOTE.includes(p.id));
  const plantas = loadPlantas(NO_FRENTES, 'tests/fixtures/plantas-prueba.json');
  const { map, warnings } = assembleMap({ osm: mini as unknown, buildings: ms, places, plantas });
  const shapes = new Map(placePlantas(plantas, parseOsm(mini).roads).map((s) => [s.planta.lugar, s]));

  // los tres lugares de SIN_LOTE que el fixture no trae (m1, abajo) son los únicos que avisan
  const SIN_PLANTA = ['cine-pixel', 'estacion-adrogue', 'la-veneciana'];
  const sinInterior = (id: string): string => `${id}: es entrable y no tiene interior (falta su planta o su lote)`;

  test('sin avisos de los interiores', () => {
    expect(warnings.filter((w) => /interior|abertura|puerta|marco/.test(w) && !SIN_PLANTA.map(sinInterior).includes(w))).toEqual([]);
  });

  // m1 de la revisión final (H2 de la T11a): un lugar entrable sin interior quedaría sin botín y con la puerta a un
  // prisma macizo; el build lo frena
  test('aviso fatal por cada lugar entrable sin interior: los de SIN_LOTE que el fixture no releva', () => {
    expect(places.filter((p) => p.enterable).map((p) => p.id).sort()).toEqual([...SIN_PLANTA, 'guernica-bar', 'mcdonalds'].sort());
    const m1 = warnings.filter((w) => w.includes('es entrable y no tiene interior'));
    expect(m1.sort()).toEqual(SIN_PLANTA.map(sinInterior));
    expect(m1.every(isFatalWarning)).toBe(true);
    // con su planta, el aviso se va
    const all = loadPlantas(NO_FRENTES, 'tests/fixtures/plantas-prueba.json');
    const sinMcd = assembleMap({ osm: mini as unknown, buildings: ms, places, plantas: all.filter((p) => p.lugar !== 'mcdonalds') }).warnings;
    expect(sinMcd.filter((w) => w.includes('es entrable y no tiene interior')).sort()).toEqual([...SIN_PLANTA, 'mcdonalds'].sort().map(sinInterior));
  });

  test('uno por planta, con el marco y los patios de la planta', () => {
    expect(map.interiors.map((i) => i.placeId).sort()).toEqual(['guernica-bar', 'mcdonalds']);
    for (const i of map.interiors) {
      const s = shapes.get(i.placeId)!;
      expect(i.buildingId).toBe(`pl-${i.placeId}`);
      expect(dist(i.frame.origin, s.frame.origin)).toBeLessThan(0.01);
      expect(i.frame.u).toEqual(s.frame.u);
      expect(i.frame.v).toEqual(s.frame.v);
      expect(i.patios).toHaveLength(s.patios.length);
    }
    expect(map.interiors.find((i) => i.placeId === 'guernica-bar')!.patios).toHaveLength(1);
  });

  test('las aberturas de la planta, ubicadas sobre la planta redondeada', () => {
    for (const i of map.interiors) {
      const s = shapes.get(i.placeId)!;
      const b = map.buildings.find((x) => x.id === i.buildingId)!;
      const doors = doorsOf(b, i);
      const want = plantaDoors(s);
      expect(doors).toHaveLength(want.length);
      doors.forEach((d, k) => {
        expect(dist(d.at, want[k].center), i.placeId).toBeLessThan(0.01);
        expect(d.normal[0] * want[k].out[0] + d.normal[1] * want[k].out[1]).toBeCloseTo(1, 3);
        expect(d.width).toBeCloseTo(s.planta.puertas[k].ancho, 1);
      });
      const doorOps = i.openings.filter((o) => o.kind === 'puerta');
      doorOps.forEach((o, k) => {
        expect(o.y0).toBe(s.planta.puertas[k].piso * 3.2);
        expect(o.y1).toBeCloseTo(s.planta.puertas[k].piso * 3.2 + s.planta.puertas[k].alto, 6);
      });
      const glass = i.openings.filter((o) => o.kind === 'vidrio');
      expect(glass).toHaveLength(s.planta.vidrios.length);
      glass.forEach((o, k) => {
        const v = s.planta.vidrios[k];
        expect(o.s1 - o.s0).toBeCloseTo(v.hasta - v.desde, 1);
        expect([o.y0, o.y1]).toEqual([v.abajo, v.arriba]);
      });
    }
  });

  test('marcos, aberturas, Place.door y punto de aparición (afuera del patio)', () => checkInteriors(map));

  test('aviso: el marco de una planta que no entra (la planta queda detrás del origen)', () => {
    const ps = structuredClone(plantas);
    ps[1].planta = [[0, -6], [8, -6], [8, 0], [0, 0]];
    ps[1].frente = [2];
    const w = assembleMap({ osm: mini as unknown, buildings: ms, places, plantas: ps }).warnings;
    expect(w.filter((x) => x.includes('marco del interior'))).toEqual(['mcdonalds: el marco del interior no entra en la planta: origin + 0,5·V cae afuera']);
  });

  test('aidEnds: una puerta más de la planta en una punta saca esa punta', () => {
    const withDoor = (centro: number): PlantaInput[] => {
      const ps = structuredClone(plantas);
      ps[0].puertas.push({ arista: 0, centro, ancho: 1.2, alto: 2.4, piso: 0 });
      return ps;
    };
    const ends = (ps: PlantaInput[]) => aidEnds(placePlantas(ps, parseOsm(mini).roads)[0]);
    expect(ends(plantas)).toEqual(['fin', 'inicio']); // 3 bahías: la puerta en la del medio
    expect(ends(withDoor(1.2))).toEqual(['fin']); // otra puerta en la bahía de desde
    expect(ends(withDoor(8.4))).toEqual(['inicio']); // y en la de hasta
  });
});
