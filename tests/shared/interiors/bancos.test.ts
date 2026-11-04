// Los tres bancos (§4.1–4.3) sobre el mapa real, con el controlador del jugador y el hitscan del juego: el vestíbulo de
// cajeros (al frente en el Nación y el BBVA, a un costado en el Galicia), la pared de vidrio con su puerta, la línea de
// cajas con su mampara, los muebles, los carteles de cada marca y la puerta del tesoro, que no se abre.
import { readFileSync } from 'node:fs';
import { buildCollisionWorld } from '../../../src/shared/collision.ts';
import { hitscan } from '../../../src/shared/combat.ts';
import type { Vec2, Vec3 } from '../../../src/shared/geo.ts';
import { bancoPlan } from '../../../src/shared/interiors/bancos.ts';
import { INTERIOR_PLANS, interiorOf } from '../../../src/shared/interiors/index.ts';
import { Kit, MODEL_BOX } from '../../../src/shared/interiors/kit.ts';
import type { Door } from '../../../src/shared/interiors/openings.ts';
import type { Block, Interior, ItemModel } from '../../../src/shared/interiors/types.ts';
import type { Building, InteriorInput, MapData, Opening } from '../../../src/shared/mapdata.ts';
import { doorDepth, insideOf, walkTo } from './walk.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const world = buildCollisionWorld(map);

// Los colores de la marca, como se ven, los controla tests/client/bancos-luz.test.ts.
interface Caso { id: string; vestibulo: 'frente' | 'costado'; cajas: number; cajeros: [number, number]; marca: string }
const BANCOS: Caso[] = [
  { id: 'banco-nacion', vestibulo: 'frente', cajas: 3, cajeros: [2, 3], marca: 'BANCO NACIÓN' },
  { id: 'galicia', vestibulo: 'costado', cajas: 4, cajeros: [2, Infinity], marca: 'Galicia' },
  { id: 'bbva', vestibulo: 'frente', cajas: 3, cajeros: [2, Infinity], marca: 'BBVA' },
];
/** La caja del turnero de models.ts (su origen en el piso, el frente hacia +z): de 0,9 × 0,46 × 0,08, de 2,3 a 2,76 m. */
const TURNERO = { w: 0.9, d: 0.08, y0: 2.3, y1: 2.76 };
/** El cielorraso de la planta baja (con el bloque cerrado arriba). */
const CIELO = 3.0;

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

    test('a 0,8 m da en la cara del mostrador (± 0,1 m), a 0,8 + 0,3 m del cajero sentado', () => {
      const hit = shot(0.8);
      expect(hit?.kind, c.id).toBe('world');
      // la cara del lado del cliente: la marca de las cajas está 0,8 m detrás del medio del puesto, de 0,6 m de fondo
      const salon = xz(mark('salon')), cajas = xz(mark('cajas'));
      const d = dist2(salon, cajas), ray: Vec2 = [(cajas[0] - salon[0]) / d, (cajas[1] - salon[1]) / d];
      const face: Vec2 = [cajas[0] - inward[0] * (0.8 + MODEL_BOX['puesto-caja']!.d / 2), cajas[1] - inward[1] * (0.8 + MODEL_BOX['puesto-caja']!.d / 2)];
      const want = ((face[0] - salon[0]) * inward[0] + (face[1] - salon[1]) * inward[1]) / (ray[0] * inward[0] + ray[1] * inward[1]);
      expect(Math.abs(hit!.dist - want), `${c.id}: pega a ${hit!.dist.toFixed(2)} m, la cara está a ${want.toFixed(2)} m`).toBeLessThanOrEqual(0.1);
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

  // el dato; cómo se ven sus colores lo controla tests/client/bancos-luz.test.ts
  test(`carteles (el dato): "${c.marca}" va iluminado, como una caja de luz, con el mismo fondo que la franja de las cajas`, () => {
    const brand = i.labels.filter((l) => l.text === c.marca);
    expect(brand.length, c.id).toBeGreaterThan(0);
    const franja = i.blocks.find((x) => x.role === 'tabique' && x.side?.mat === 'luz');
    expect(franja, `${c.id}: la franja iluminada de las cajas`).toBeDefined();
    for (const l of brand) {
      expect(l.glow, c.id).toBe(true);
      expect(l.look.fondo.toLowerCase(), c.id).toBe(franja!.side!.color.toLowerCase());
    }
  });

  test('la fila de espera: al menos una fila de 4 sillas unidas, que se cruzan (sin caja), mirando al turnero; el turnero, a la fila', () => {
    const rows = i.items.filter((it) => it.model === 'sillas-espera');
    expect(rows.length, c.id).toBeGreaterThanOrEqual(1);
    expect(MODEL_BOX['sillas-espera']).toBeUndefined();
    const [t] = i.items.filter((it) => it.model === 'turnero');
    const fwd = (yaw: number): Vec2 => [Math.sin(yaw), Math.cos(yaw)];
    // la fila de adelante del mostrador: la más cerca del turnero
    const row = rows.reduce((a, r) => (dist2(xz(r.at), xz(t.at)) < dist2(xz(a.at), xz(t.at)) ? r : a));
    const toRow: Vec2 = [row.at[0] - t.at[0], row.at[2] - t.at[2]];
    expect(fwd(t.yaw)[0] * toRow[0] + fwd(t.yaw)[1] * toRow[1], `${c.id}: el turnero mira a la fila`).toBeGreaterThan(0);
    expect(fwd(row.yaw)[0] * -toRow[0] + fwd(row.yaw)[1] * -toRow[1], `${c.id}: la fila mira al turnero`).toBeGreaterThan(0);
    const number = i.labels.find((l) => l.glow && l.text === 'C 042')!;
    expect(number.normal[0] * toRow[0] + number.normal[1] * toRow[1], `${c.id}: el número, hacia la fila`).toBeGreaterThan(0);
  });

  test('el turnero no tapa los números de las cajas: se ven desde el salón, desde la vista salón-cajas y desde la fila', () => {
    const [t] = i.items.filter((it) => it.model === 'turnero');
    const [cs, sn] = [Math.cos(t.yaw), Math.sin(t.yaw)];
    // al marco del turnero (la inversa de la rotación three.js: el +x del modelo va a (cos, −sin))
    const local = (p: Vec3): Vec3 => [(p[0] - t.at[0]) * cs - (p[2] - t.at[2]) * sn, p[1], (p[0] - t.at[0]) * sn + (p[2] - t.at[2]) * cs];
    const lo: Vec3 = [-TURNERO.w / 2, TURNERO.y0, -TURNERO.d / 2], hi: Vec3 = [TURNERO.w / 2, TURNERO.y1, TURNERO.d / 2];
    /** ¿El segmento de p a q cruza la caja del turnero? (slabs en su marco) */
    const hits = (p: Vec3, q: Vec3): boolean => {
      const [a, b] = [local(p), local(q)];
      let [t0, t1] = [0, 1];
      for (let k = 0; k < 3; k++) {
        const dk = b[k] - a[k];
        if (Math.abs(dk) < 1e-12) {
          if (a[k] < lo[k] || a[k] > hi[k]) return false;
          continue;
        }
        const [u, v] = [(lo[k] - a[k]) / dk, (hi[k] - a[k]) / dk];
        [t0, t1] = [Math.max(t0, Math.min(u, v)), Math.min(t1, Math.max(u, v))];
        if (t0 > t1) return false;
      }
      return true;
    };
    const salon = mark('salon'), view = i.views.find((v) => v.id === 'salon-cajas')!;
    const eyes: [string, Vec3][] = [['el salón', [salon[0], 1.6, salon[2]]], ['la vista salón-cajas', [view.pos[0], 1.6, view.pos[2]]]];
    // sentados en la fila de adelante del mostrador (los asientos a ±0,275 y ±0,825 m del medio, ojos a 1,2 m)
    const row = i.items.filter((it) => it.model === 'sillas-espera').reduce((a, r) => (dist2(xz(r.at), xz(t.at)) < dist2(xz(a.at), xz(t.at)) ? r : a));
    for (const x of [-0.825, -0.275, 0.275, 0.825]) eyes.push([`la fila (${x})`, [row.at[0] + x * Math.cos(row.yaw), 1.2, row.at[2] - x * Math.sin(row.yaw)]]);
    const blocked: string[] = [];
    for (const l of i.labels.filter((x) => /^CAJA \d$/.test(x.text))) {
      const tan: Vec2 = [-l.normal[1], l.normal[0]];
      for (const [who, eye] of eyes) {
        for (const s of [-0.3, 0, 0.3]) for (const dy of [-0.08, 0, 0.08]) {
          const p: Vec3 = [l.at[0] + tan[0] * s, l.at[1] + dy, l.at[2] + tan[1] * s];
          if (hits(eye, p)) blocked.push(`${l.text} desde ${who}`);
        }
      }
    }
    expect([...new Set(blocked)], c.id).toEqual([]);
  });

  test('la pared de vidrio: perfil de aluminio de piso y de techo y la franja esmerilada a 1,0–1,1 m, en liso (sin Mats nuevos)', () => {
    const glass = partition(i);
    const len = (b: Block): number => { const d = along(b.polygon); const s = b.polygon.map((p) => p[0] * d[0] + p[1] * d[1]); return Math.max(...s) - Math.min(...s); };
    const panes = glass.reduce((a, g) => a + len(g), 0);
    /** Los bloques sin colisión entre `y0` y `y1` sobre algún paño: paralelos, a < 5 cm de su eje y pisando su largo. */
    const onGlass = (y0: number, y1: number): Block[] => i.blocks.filter((x) => x.collide === 'none' && x.role === 'otro' && x.y0 >= y0 - 1e-6 && x.y1 <= y1 + 1e-6 &&
      glass.some((g) => {
        const [d, e] = [along(g.polygon), along(x.polygon)];
        const m = centroid(g.polygon), p = centroid(x.polygon);
        const span = (q: Vec2[]): [number, number] => { const s = q.map((r) => r[0] * d[0] + r[1] * d[1]); return [Math.min(...s), Math.max(...s)]; };
        const [[a0, a1], [b0, b1]] = [span(g.polygon), span(x.polygon)];
        return Math.abs(d[0] * e[1] - d[1] * e[0]) < 0.01 && Math.abs((p[0] - m[0]) * -d[1] + (p[1] - m[1]) * d[0]) < 0.05 && b0 < a1 && a0 < b1;
      }));
    const floor = onGlass(0, 0.06), ceiling = onGlass(CIELO - 0.06, CIELO), band = onGlass(0.98, 1.12).filter((x) => x.y1 - x.y0 >= 0.05);
    const total = (bs: Block[]): number => bs.reduce((a, x) => a + len(x), 0);
    expect(total(floor), `${c.id}: perfil de piso bajo ${panes.toFixed(2)} m de paños`).toBeGreaterThanOrEqual(panes - 0.1);
    expect(total(ceiling), `${c.id}: perfil de techo`).toBeGreaterThanOrEqual(panes - 0.1);
    expect(total(band), `${c.id}: franja esmerilada`).toBeGreaterThanOrEqual(panes - 0.1);
    for (const x of [...floor, ...ceiling, ...band]) for (const look of [x.side, x.top, x.bottom]) if (look) expect(look.mat, c.id).toBe('liso');
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

// Lotes armados a mano (no los del mapa): la planta sale de la puerta de la calle, que tiene que estar en el frente, y
// de las aberturas de su arista, no de las de otra.
describe('la puerta de la calle y su arista', () => {
  // un lote de W × D con el marco del mundo: el frente es la arista 0, de (W, 0) a (0, 0), así que ahí u = W − s; la 1
  // es la medianera de u = 0 (s = v) y la 2, el fondo (s = u)
  const lot = (W: number, D: number, openings: Opening[]): Interior => {
    const b: Building = { id: 'lote', footprint: [[W, 0], [0, 0], [0, D], [W, D]], height: 7, floors: 2, kind: 'shop', wall: 'plaster', tint: '#ccc' };
    const input: InteriorInput = { placeId: 'banco', buildingId: b.id, frame: { origin: [0, 0], u: [1, 0], v: [0, 1] }, openings, patios: [] };
    return bancoPlan('galicia')(new Kit(b, input));
  };
  const door: Opening = { kind: 'puerta', edge: 0, s0: 13.4 - 5.8, s1: 13.4 - 4.2, y0: 0, y1: 2.3 };

  test('si la única puerta está en una medianera (v ≠ 0), no hay sucursal: queda el local vacío, sin marcas', () => {
    const i = lot(13.4, 15, [{ ...door, edge: 1, s0: 4.2, s1: 5.8 }]);
    expect(i.marks).toEqual({});
    expect(i.items).toEqual([]);
  });

  test('una ventana del fondo no corre la pared de vidrio del Galicia: solo cuentan los parantes del frente', () => {
    const plain = lot(13.4, 15, [door]);
    expect(plain.marks['puerta-salon'], 'con la sucursal').toBeDefined();
    // dos ventanas del fondo que, proyectadas sobre el frente, dejarían un "parante" a 0,65 m de la puerta
    const back: Opening[] = [{ kind: 'vidrio', edge: 2, s0: 6.2, s1: 6.35, y0: 1, y1: 2.2 }, { kind: 'vidrio', edge: 2, s0: 6.55, s1: 6.8, y0: 1, y1: 2.2 }];
    const withBack = lot(13.4, 15, [door, ...back]);
    expect(withBack.marks['puerta-salon'][0]).toBeCloseTo(plain.marks['puerta-salon'][0], 9);
  });
});
