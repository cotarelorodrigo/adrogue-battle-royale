// Los interiores del mapa generado (public/map/adrogue.map.json), con el controlador real del jugador y el mundo de
// colisiones del juego: se entran por cada puerta, se suben sus escaleras y no se pisan con nada de afuera.
import { readFileSync } from 'node:fs';
import polygonClipping from 'polygon-clipping';
import { isFreeSpot } from '../../../src/mapgen/spawns.ts';
import { BENCH, DUMPSTER, buildCollisionWorld, collisionPrisms, parapetEdges } from '../../../src/shared/collision.ts';
import { ensureCCW, pointInPolygon, polygonArea } from '../../../src/shared/geo.ts';
import type { Vec2 } from '../../../src/shared/geo.ts';
import { buildInteriors, interiorOf, validateInterior } from '../../../src/shared/interiors/index.ts';
import { LEVEL_H } from '../../../src/shared/interiors/openings.ts';
import type { Block, Interior } from '../../../src/shared/interiors/types.ts';
import type { MapData } from '../../../src/shared/mapdata.ts';
import { climbStair, doorDepth, enterDoor, insideOf } from './walk.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const world = buildCollisionWorld(map);
const interiors = buildInteriors(map);
const byId = new Map(map.buildings.map((b) => [b.id, b]));

type Multi = polygonClipping.MultiPolygon;
const closed = (r: Vec2[]): [[number, number][]] => [[...r, r[0]].map((p): [number, number] => [p[0], p[1]])];
const area = (m: Multi): number => m.reduce((t, pg) => t + pg.reduce((a, r, i) => a + (i === 0 ? 1 : -1) * polygonArea(r.slice(0, -1) as Vec2[]), 0), 0);
const unionOf = (rs: Vec2[][]): Multi => (rs.length === 0 ? [] : polygonClipping.union(closed(rs[0]), ...rs.slice(1).map(closed)));
const fmt = (v: number): string => v.toFixed(2);
/** Caja centrada en c con el largo sobre +x local (la de collision.ts para los contenedores y los bancos). */
function orientedBox([cx, cz]: Vec2, rotation: number, length: number, depth: number): Vec2[] {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  const ux = (c * length) / 2, uz = (-s * length) / 2, vx = (s * depth) / 2, vz = (c * depth) / 2;
  return [[cx - ux + vx, cz - uz + vz], [cx + ux + vx, cz + uz + vz], [cx + ux - vx, cz + uz - vz], [cx - ux - vx, cz - uz - vz]];
}
const solidBlocks = (i: Interior): Block[] => i.blocks.filter((x) => x.collide !== 'none');

test('son los 9 lugares con interior', () => {
  expect(interiors.map((i) => i.placeId).sort()).toEqual(
    ['banco-nacion', 'bbva', 'casa-de-la-cultura', 'cine-pixel', 'estacion-adrogue', 'galicia', 'guernica-bar', 'la-veneciana', 'mcdonalds']);
  expect(interiorOf(map, 'galicia').buildingId).toBe(map.interiors.find((i) => i.placeId === 'galicia')!.buildingId);
});

describe.each(interiors.map((i) => [i.placeId, i] as const))('%s', (id, i) => {
  const b = byId.get(i.buildingId)!;

  test('validateInterior da []', () => expect(validateInterior(i)).toEqual([]));

  // `hide` es lo que no se dibuja: una pared de afuera esconde la cara de afuera (la 0), las puntas y lo que queda sobre
  // una arista vecina, nunca la cara de adentro (la paralela a la 0, del lado de la planta). En una esquina de 90° el
  // producto que decide el recorte puede dar un positivo de redondeo: las dos puntas de la cara de adentro quedan cada
  // una sobre una recta de recorte distinta, y eso no es "sobre una arista vecina".
  test('ninguna pared de afuera esconde su cara de adentro', () => {
    const hidden: string[] = [];
    for (const x of i.blocks.filter((y) => !y.out && (y.role === 'pared' || y.role === 'dintel') && y.hide?.includes(0))) {
      const [a, c] = [x.polygon[0], x.polygon[1]];
      const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const across = (r: Vec2): number => ((r[0] - a[0]) * (c[1] - a[1]) - (r[1] - a[1]) * (c[0] - a[0])) / l;
      for (const k of x.hide!) {
        const [p, q] = [x.polygon[k], x.polygon[(k + 1) % x.polygon.length]];
        const parallel = Math.abs(across(q) - across(p)) < 1e-6;
        if (k !== 0 && parallel && Math.abs(across(p)) > 0.05 && Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.05) {
          hidden.push(`${x.role} ${JSON.stringify(x.polygon.map((r) => r.map(fmt)))}, cara ${k}`);
        }
      }
    }
    expect(hidden).toEqual([]);
  });

  // Hasta que el lugar tenga su plan, una puerta de un nivel ≥ publicFloors da al bloque cerrado (D13) y no se camina:
  // hoy es solo la del piso 1 del Guernica (su balcón y la planta alta llegan en la tarea 9, que sube publicFloors a 2).
  test('cada puerta de un piso público: enterDoor termina adentro y apoyado, a la altura de su nivel', () => {
    const doors = i.doors.filter((d) => d.level < i.publicFloors);
    expect(doors.length).toBeGreaterThan(0);
    for (const d of doors) {
      const s = enterDoor(world, d, d.level > 0 ? { from: 1 } : {});
      const at = `${id}, puerta en ${d.at.map(fmt).join(', ')}: termina en ${s.pos.map(fmt).join(', ')}`;
      expect(insideOf(b, s.pos), at).toBe(true);
      expect(doorDepth(d, s.pos), at).toBeGreaterThanOrEqual(2);
      expect(s.onGround, at).toBe(true);
      expect(Math.abs(s.pos[1] - d.level * LEVEL_H), at).toBeLessThanOrEqual(0.05);
    }
  });

  test('cada escalera: climbStair sube a top[1] y baja', () => {
    for (const st of i.stairs) {
      const up = climbStair(world, st);
      expect(Math.abs(up.pos[1] - st.top[1]), `${id}: sube a ${fmt(up.pos[1])}`).toBeLessThanOrEqual(0.05);
      const down = climbStair(world, st, true);
      expect(Math.abs(down.pos[1] - st.foot[1]), `${id}: baja a ${fmt(down.pos[1])}`).toBeLessThanOrEqual(0.05);
    }
  });

  // Los huecos del techo (`roofHoles`: el atrio de la Casa de la Cultura, D13) quedan abiertos: nada los cubre a esa
  // altura (el lucernario va arriba, desde height) y el chunk los abre igual en su techo.
  test('la planta corrida 0,2 m: en lo alto, las paredes y el techo cubren la planta justa (menos los huecos del techo), sin pisarse', () => {
    const y = b.height - 0.01;
    const top = solidBlocks(i).filter((x) => x.y0 < y && x.y1 > y);
    const slabs = top.filter((x) => x.role === 'losa').map((x) => x.polygon);
    const walls = top.filter((x) => x.role !== 'losa').map((x) => x.polygon);
    const all = unionOf([...slabs, ...walls]);
    const holes = unionOf(i.roofHoles);
    const fp = polygonClipping.difference(closed(ensureCCW(b.footprint)), ...(holes.length > 0 ? [holes] : []));
    expect(area(polygonClipping.difference(fp, all)), `${id}: lo que queda sin cubrir`).toBeLessThan(0.01);
    expect(area(polygonClipping.difference(all, fp)), `${id}: lo que sale de la planta o pisa un hueco del techo`).toBeLessThan(0.01);
    expect(area(polygonClipping.intersection(unionOf(slabs), unionOf(walls))), `${id}: techo sobre las paredes`).toBeLessThan(0.01);
    // la arista de adentro del pretil es la misma planta corrida
    const inner = parapetEdges(ensureCCW(b.footprint)).map((e) => e.ai);
    expect(Math.abs(area(unionOf(slabs)) - (polygonArea(inner) - area(holes))), id).toBeLessThan(0.01);
  });

  test('todo marks cumple isFreeSpot a su altura', () => {
    for (const [name, p] of Object.entries(i.marks)) expect(isFreeSpot(world, p[0], p[2], p[1]), `${id}: ${name}`).toBe(true);
  });
});

test('collisionPrisms: ningún edificio con interior queda como prisma lleno de 0 a height (el pretil sigue)', () => {
  const { prisms } = collisionPrisms(map);
  for (const i of interiors) {
    const b = byId.get(i.buildingId)!;
    const full = prisms.filter((p) => p.tag === b.id && p.minY <= 0 && p.maxY >= b.height && polygonArea(p.polygon) > 0.5 * polygonArea(b.footprint));
    expect(full, i.placeId).toEqual([]);
    expect(prisms.filter((p) => p.tag === `parapet:${b.id}`).length, i.placeId).toBe(parapetEdges(ensureCCW(b.footprint)).length);
  }
});

test('ningún relleno pisa una planta de interior más de 0,05 m², y ninguna escalera de mano cae adentro', () => {
  const rooms = interiors.map((i) => ({ id: i.placeId, fp: closed(ensureCCW(byId.get(i.buildingId)!.footprint)) }));
  for (const f of map.buildings.filter((b) => b.fill)) {
    for (const r of rooms) expect(area(polygonClipping.intersection(closed(ensureCCW(f.footprint)), r.fp)), `${f.id} en ${r.id}`).toBeLessThanOrEqual(0.05);
  }
  for (const p of map.props) {
    if (p.kind !== 'ladder') continue;
    const len = Math.hypot(p.normal[0], p.normal[1]);
    // el medio del volumen de la escalera (0,3 m hacia afuera de la pared)
    const mid: Vec2 = [p.base[0] + (p.normal[0] / len) * 0.3, p.base[1] + (p.normal[1] / len) * 0.3];
    for (const i of interiors) expect(pointInPolygon(mid, byId.get(i.buildingId)!.footprint), `escalera en ${p.base.join(', ')} adentro de ${i.placeId}`).toBe(false);
  }
});

test('ningún prop (contenedor, escalera, banco) se pisa con un bloque sólido de un interior, ni con uno `out`', () => {
  const props: { what: string; poly: Vec2[]; y0: number; y1: number }[] = [];
  for (const p of map.props) {
    if (p.kind === 'dumpster') props.push({ what: `contenedor en ${p.position.join(', ')}`, poly: orientedBox(p.position, p.rotation, DUMPSTER.length, DUMPSTER.depth), y0: 0, y1: DUMPSTER.height });
    else if (p.kind === 'bench') props.push({ what: `banco en ${p.position.join(', ')}`, poly: orientedBox(p.position, p.rotation, BENCH.length, BENCH.depth), y0: 0, y1: BENCH.height });
    else if (p.kind === 'ladder') {
      const len = Math.hypot(p.normal[0], p.normal[1]);
      const [nx, nz] = [p.normal[0] / len, p.normal[1] / len];
      const [tx, tz] = [-nz, nx];
      const at = (t: number, w: number): Vec2 => [p.base[0] + tx * t + nx * w, p.base[1] + tz * t + nz * w];
      // se apoya en la fachada de su edificio y la base está redondeada al cm: la caja arranca a 1 cm de la pared
      props.push({ what: `escalera en ${p.base.join(', ')}`, poly: [at(-0.4, 0.01), at(0.4, 0.01), at(0.4, 0.6), at(-0.4, 0.6)], y0: 0, y1: p.topY });
    }
  }
  for (const i of interiors) {
    for (const x of solidBlocks(i)) {
      const box = [Math.min(...x.polygon.map((q) => q[0])), Math.min(...x.polygon.map((q) => q[1])), Math.max(...x.polygon.map((q) => q[0])), Math.max(...x.polygon.map((q) => q[1]))];
      for (const p of props) {
        if (p.y1 <= x.y0 || p.y0 >= x.y1) continue;
        if (p.poly.every((q) => q[0] < box[0]) || p.poly.every((q) => q[0] > box[2]) || p.poly.every((q) => q[1] < box[1]) || p.poly.every((q) => q[1] > box[3])) continue;
        const over = area(polygonClipping.intersection(closed(ensureCCW(p.poly)), closed(x.polygon)));
        expect(over, `${i.placeId}: ${x.role} pisa ${p.what}`).toBeLessThan(1e-3);
      }
    }
  }
});
