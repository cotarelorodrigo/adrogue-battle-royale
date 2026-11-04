// Los tres bancos (§4.1–4.3) sobre el mapa real, con el controlador del jugador y el hitscan del juego: el vestíbulo de
// cajeros (al frente en el Nación y el BBVA, a un costado en el Galicia), la pared de vidrio con su puerta, la línea de
// cajas con su mampara, los muebles, los carteles de cada marca y la puerta del tesoro, que no se abre.
import { readFileSync } from 'node:fs';
import { buildCollisionWorld } from '../../../src/shared/collision.ts';
import { hitscan } from '../../../src/shared/combat.ts';
import type { Vec2, Vec3 } from '../../../src/shared/geo.ts';
import { INTERIOR_PLANS, interiorOf } from '../../../src/shared/interiors/index.ts';
import { MODEL_BOX } from '../../../src/shared/interiors/kit.ts';
import type { Door } from '../../../src/shared/interiors/openings.ts';
import type { Block, Interior, ItemModel } from '../../../src/shared/interiors/types.ts';
import type { MapData } from '../../../src/shared/mapdata.ts';
import { doorDepth, insideOf, walkTo } from './walk.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const world = buildCollisionWorld(map);

interface Caso { id: string; vestibulo: 'frente' | 'costado'; cajas: number; cajeros: [number, number]; marca: string; colores: string[] }
const BANCOS: Caso[] = [
  { id: 'banco-nacion', vestibulo: 'frente', cajas: 3, cajeros: [2, 3], marca: 'BANCO NACIÓN', colores: ['#005ba4', '#59b7e6'] },
  { id: 'galicia', vestibulo: 'costado', cajas: 4, cajeros: [2, Infinity], marca: 'Galicia', colores: ['#e1561f'] },
  { id: 'bbva', vestibulo: 'frente', cajas: 3, cajeros: [2, Infinity], marca: 'BBVA', colores: ['#1e44a8'] },
];

const fmt = (p: readonly number[]): string => p.map((v) => v.toFixed(2)).join(', ');
const xz = (p: Vec3): Vec2 => [p[0], p[2]];
const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const centroid = (p: Vec2[]): Vec2 => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
/** Distancia de `p` a la recta de a → c. */
const toLine = (p: Vec2, a: Vec2, c: Vec2): number =>
  Math.abs((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) / dist2(a, c);
/** La arista más larga de un polígono, como dirección unitaria. */
function along(poly: Vec2[]): Vec2 {
  let best: Vec2 = [1, 0], len = 0;
  poly.forEach((p, k) => {
    const q = poly[(k + 1) % poly.length], l = dist2(p, q);
    if (l > len) [best, len] = [[(q[0] - p[0]) / l, (q[1] - p[1]) / l], l];
  });
  return best;
}
/** Las caras de la pared de vidrio entre el vestíbulo y el salón: el vidrio que arranca del piso (los de la vidriera
 *  arrancan en el antepecho y la mampara de las cajas, sobre el mostrador). */
const partition = (i: Interior): Block[] => i.blocks.filter((b) => b.role === 'vidrio' && b.collide === 'glass' && b.y0 < 0.01);

describe.each(BANCOS)('$id', (c) => {
  const i = interiorOf(map, c.id);
  const b = map.buildings.find((x) => x.id === i.buildingId)!;
  const door: Door = i.doors[0];
  const inward: Vec2 = [-door.normal[0], -door.normal[1]];
  const tangent: Vec2 = [-door.normal[1], door.normal[0]];
  const mark = (name: string): Vec3 => {
    const p = i.marks[name];
    if (!p) throw new Error(`${c.id}: falta la marca "${name}"`);
    return p;
  };
  const count = (m: ItemModel): number => i.items.filter((it) => it.model === m).length;
  // la arista de la planta en la que está la puerta de la calle (el frente) y sus vecinas (las medianeras)
  const fp = b.footprint, n = fp.length;
  const front = fp.findIndex((p, k) => toLine(door.at, p, fp[(k + 1) % n]) < 1e-3 && dist2(door.at, p) + dist2(door.at, fp[(k + 1) % n]) < dist2(p, fp[(k + 1) % n]) + 1e-3);

  test('tiene su plan, solo la planta baja es pública y floors tiene solo el nivel 0', () => {
    expect(INTERIOR_PLANS[c.id], c.id).toBeDefined();
    expect(i.publicFloors).toBe(1);
    expect(i.terrace).toBe(false);
    expect(i.floors.map((f) => f.level)).toEqual([0]);
    expect(front, `${c.id}: la arista de la puerta`).toBeGreaterThanOrEqual(0);
  });

  if (c.vestibulo === 'frente') {
    test('el vestíbulo va al frente: la pared de vidrio corre paralela a la vidriera, a 3,5 ± 0,5 m de fondo, de lado a lado', () => {
      const glass = partition(i);
      expect(glass.length, c.id).toBeGreaterThan(0);
      for (const g of glass) for (const p of g.polygon) {
        const d = doorDepth(door, [p[0], 0, p[1]]);
        expect(d, `${c.id}: vértice en ${fmt(p)}`).toBeGreaterThanOrEqual(3.0);
        expect(d, `${c.id}: vértice en ${fmt(p)}`).toBeLessThanOrEqual(4.0);
      }
      const s = glass.flatMap((g) => g.polygon.map((p) => p[0] * tangent[0] + p[1] * tangent[1]));
      expect(Math.max(...s) - Math.min(...s), `${c.id}: de lado a lado`).toBeGreaterThan(dist2(fp[front], fp[(front + 1) % n]) - 0.6);
      const depth = doorDepth(door, mark('puerta-salon'));
      expect(depth, c.id).toBeGreaterThanOrEqual(3.0);
      expect(depth, c.id).toBeLessThanOrEqual(4.0);
      expect(doorDepth(door, mark('vestibulo')), c.id).toBeLessThan(depth - 0.5);
      expect(doorDepth(door, mark('salon')), c.id).toBeGreaterThan(depth + 0.5);
    });
  } else {
    test('el vestíbulo va a un costado, contra la medianera del lado de la puerta: la pared de vidrio corre paralela a ella', () => {
      const sides = [(front + n - 1) % n, (front + 1) % n].map((k) => [fp[k], fp[(k + 1) % n]] as const);
      const v = xz(mark('vestibulo'));
      const [ma, mc] = sides.reduce((x, y) => (toLine(v, ...y) < toLine(v, ...x) ? y : x));
      const md: Vec2 = [(mc[0] - ma[0]) / dist2(ma, mc), (mc[1] - ma[1]) / dist2(ma, mc)];
      const parallel = partition(i).filter((g) => Math.abs(along(g.polygon)[0] * md[1] - along(g.polygon)[1] * md[0]) < Math.sin((5 * Math.PI) / 180));
      expect(parallel.length, `${c.id}: vidrio paralelo a la medianera`).toBeGreaterThan(0);
      const w = toLine(centroid(parallel[0].polygon), ma, mc);
      expect(toLine(v, ma, mc), `${c.id}: el vestíbulo, entre la medianera y el vidrio`).toBeLessThan(w);
      expect(toLine(door.at, ma, mc) + door.width / 2, `${c.id}: la puerta de la calle da al vestíbulo`).toBeLessThan(w);
      expect(toLine(xz(mark('salon')), ma, mc), `${c.id}: el salón, del otro lado`).toBeGreaterThan(w);
      expect(Math.abs(toLine(xz(mark('puerta-salon')), ma, mc) - w), `${c.id}: la puerta del salón, en el vidrio`).toBeLessThan(0.1);
    });
  }

  test('de la vereda, por la puerta de la calle: walkTo([vestibulo, puerta-salon, salon]) termina a < 0,5 m del salón', () => {
    const start: Vec3 = [door.at[0] + door.normal[0], 0, door.at[1] + door.normal[1]];
    const s = walkTo(world, start, [xz(mark('vestibulo')), xz(mark('puerta-salon')), xz(mark('salon'))], 15);
    expect(dist2(xz(s.pos), xz(mark('salon'))), `${c.id}: termina en ${fmt(s.pos)}`).toBeLessThan(0.5);
    expect(insideOf(b, s.pos)).toBe(true);
  });

  describe('la mampara de las cajas', () => {
    const shot = (y: number) => {
      const salon = mark('salon'), cajas = mark('cajas');
      return hitscan(world, [{ id: 'cajero', pos: cajas, crouching: false }], [salon[0], y, salon[2]], [cajas[0] - salon[0], 0, cajas[2] - salon[2]], 100);
    };

    test('un tiro a 1,6 m desde el salón le da al de las cajas: el vidrio no frena (pero frena a los jugadores)', () => {
      expect(shot(1.6), c.id).toMatchObject({ kind: 'target', id: 'cajero' });
      const salon = mark('salon'), cajas = mark('cajas');
      const d = dist2(xz(salon), xz(cajas));
      const glass = world.raycast([salon[0], 1.6, salon[2]], [(cajas[0] - salon[0]) / d, 0, (cajas[2] - salon[2]) / d], d);
      expect(glass, `${c.id}: sin throughGlass hay un vidrio en el medio`).not.toBeNull();
    });

    test('a 0,8 m da en el mostrador', () => {
      const hit = shot(0.8);
      expect(hit?.kind, c.id).toBe('world');
      expect(hit!.dist, c.id).toBeLessThan(dist2(xz(mark('salon')), xz(mark('cajas'))));
    });

    test('caminando del salón a las cajas no se llega: el mostrador frena a más de 0,4 m', () => {
      const s = walkTo(world, mark('salon'), xz(mark('cajas')), 6);
      expect(dist2(xz(s.pos), xz(mark('cajas'))), `${c.id}: termina en ${fmt(s.pos)}`).toBeGreaterThan(0.4);
    });
  });

  test(`muebles: ${c.cajas} puestos de caja, cajeros automáticos, 2 escritorios y 1 turnero`, () => {
    expect(count('puesto-caja')).toBe(c.cajas);
    expect(count('cajero')).toBeGreaterThanOrEqual(c.cajeros[0]);
    expect(count('cajero')).toBeLessThanOrEqual(c.cajeros[1]);
    expect(count('escritorio')).toBe(2);
    expect(count('turnero')).toBe(1);
    for (const m of ['cajero', 'escritorio', 'puesto-caja'] as const) expect(MODEL_BOX[m], m).toBeDefined();
    expect(MODEL_BOX.turnero).toBeUndefined();
    expect(MODEL_BOX['puesto-caja']!.h).toBeCloseTo(1.1, 9);
    // cada puesto, con su número arriba
    for (let k = 1; k <= c.cajas; k++) expect(i.labels.map((l) => l.text), c.id).toContain(`CAJA ${k}`);
  });

  test(`carteles: "${c.marca}" con los colores de la marca`, () => {
    const brand = i.labels.filter((l) => l.text === c.marca);
    expect(brand.length, c.id).toBeGreaterThan(0);
    const colors = new Set(brand.flatMap((l) => [l.look.fondo, l.look.letra, l.look.marco].map((x) => x.toLowerCase())));
    for (const col of c.colores) expect([...colors], c.id).toContain(col);
  });

  test('el tesoro: la puerta redonda es un cartel en la pared del fondo, sin abertura; caminando hacia ella se frena contra la pared', () => {
    const input = map.interiors.find((x) => x.placeId === c.id)!;
    const back = fp.findIndex((p, k) => {
      const q = fp[(k + 1) % n], m: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      return doorDepth(door, [m[0], 0, m[1]]) > 10;
    });
    expect(back, c.id).toBeGreaterThanOrEqual(0);
    expect(input.openings.filter((o) => o.edge === back), c.id).toEqual([]);
    const t = mark('tesoro');
    // la pared del fondo, a 1 m: un tiro hacia el fondo da en ella a 0,5, 1,2 y 2 m de alto
    const face: number[] = [];
    for (const y of [0.5, 1.2, 2.0]) {
      const hit = hitscan(world, [], [t[0], y, t[2]], [inward[0], 0, inward[1]], 10);
      expect(hit?.kind, `${c.id} a ${y} m`).toBe('world');
      face.push(hit!.dist);
    }
    for (const d of face) expect(Math.abs(d - 1), c.id).toBeLessThanOrEqual(0.05);
    const vault = i.labels.filter((l) => l.drawing === 'tesoro');
    expect(vault, c.id).toHaveLength(1);
    expect(vault[0].normal[0] * door.normal[0] + vault[0].normal[1] * door.normal[1], `${c.id}: mira al salón`).toBeGreaterThan(0.99);
    expect(dist2(xz(vault[0].at), [t[0] + inward[0], t[2] + inward[1]]), `${c.id}: frente al tesoro`).toBeLessThan(0.1);
    const s = walkTo(world, t, [t[0] + inward[0] * 3, t[2] + inward[1] * 3], 4);
    const left = face[1] - ((s.pos[0] - t[0]) * inward[0] + (s.pos[2] - t[2]) * inward[1]);
    expect(left, `${c.id}: termina en ${fmt(s.pos)}`).toBeLessThanOrEqual(0.4);
    expect(left, c.id).toBeGreaterThan(0.3);
  });
});
