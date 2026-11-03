import * as THREE from 'three';
import { AWNING, frontGeometry } from '../../src/client/world/fronts.ts';
import { extrudeBuilding, FLOOR_H } from '../../src/client/world/geometry.ts';
import { cellRect } from '../../src/client/world/front-atlas.ts';
import type { FrontCell } from '../../src/client/world/front-atlas.ts';
import type { Building, Front } from '../../src/shared/mapdata.ts';

const FLOORS = 2;
const HEIGHT = FLOORS * FLOOR_H + 0.6;
const front = (over: Partial<Front> = {}): Front => ({ edges: [0], corner: [], pb: 'vidriera', arriba: 'ventanas', puerta: 'inicio', ...over });
/** Lote de `w` m de frente sobre z = 0 (afuera = +z); planta antihoraria. */
const lot = (id: string, w: number, f: Front, over: Partial<Building> = {}): Building => ({
  id, footprint: [[0, 0], [w, 0], [w, -12], [0, -12]], floors: FLOORS, height: HEIGHT, kind: 'shop', wall: 'plaster',
  tint: '#d9d2c3', front: f, ...over,
});
const gfront = (bd: Building) => extrudeBuilding(bd).walls.front;

interface Q { pos: THREE.Vector3[]; uv: THREE.Vector2[]; col: THREE.Color; n: THREE.Vector3; ymin: number; ymax: number; xmin: number }
/** Cada cara es un cuadrilátero de 4 vértices consecutivos. */
function quads(g: THREE.BufferGeometry): Q[] {
  const p = g.getAttribute('position'), t = g.getAttribute('uv'), c = g.getAttribute('color'), nn = g.getAttribute('normal');
  const out: Q[] = [];
  for (let i = 0; i < p.count; i += 4) {
    const pos = [0, 1, 2, 3].map((k) => new THREE.Vector3().fromBufferAttribute(p as THREE.BufferAttribute, i + k));
    const ys = pos.map((v) => v.y);
    out.push({
      pos, uv: [0, 1, 2, 3].map((k) => new THREE.Vector2().fromBufferAttribute(t as THREE.BufferAttribute, i + k)),
      col: new THREE.Color().fromBufferAttribute(c as THREE.BufferAttribute, i), n: new THREE.Vector3().fromBufferAttribute(nn as THREE.BufferAttribute, i),
      ymin: Math.min(...ys), ymax: Math.max(...ys), xmin: Math.min(...pos.map((v) => v.x)),
    });
  }
  return out;
}
const walls = (g: THREE.BufferGeometry) => quads(g).filter((q) => Math.abs(q.n.y) < 1e-6);
const row = (qs: Q[], y0: number, y1: number) => qs.filter((q) => Math.abs(q.ymin - y0) < 1e-6 && Math.abs(q.ymax - y1) < 1e-6).sort((a, b) => a.xmin - b.xmin);
const inCell = (q: Q, c: FrontCell) => {
  const r = cellRect(c), e = 1e-6;
  return q.uv.every((t) => t.x >= r.u0 - e && t.x <= r.u1 + e && t.y >= r.v0 - e && t.y <= r.v1 + e);
};

/** Los colores viven en Float32: se comparan con tolerancia. */
const sameColor = (a: THREE.Color, b: THREE.Color) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 1e-5;

describe('frontGeometry', () => {
  test('atributos como los demás muros y una cara por bahía', () => {
    const g = gfront(lot('a', 9, front()));
    expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
    const w = walls(g);
    for (const q of w) expect(q.n.z).toBeCloseTo(1); // hacia afuera
  });

  test('lote de 9 m, 2 pisos, vidriera: 3 bahías por fila y la puerta en la primera', () => {
    const w = walls(gfront(lot('a', 9, front())));
    const ground = row(w, 0, FLOOR_H);
    expect(ground).toHaveLength(3);
    expect(inCell(ground[0], 'vidriera-puerta')).toBe(true);
    expect(ground.slice(1).every((q) => inCell(q, 'vidriera') && !inCell(q, 'vidriera-puerta'))).toBe(true);
    const up = row(w, FLOOR_H, 2 * FLOOR_H);
    expect(up).toHaveLength(3);
    expect(up.every((q) => inCell(q, 'ventana'))).toBe(true);
    const band = row(w, 2 * FLOOR_H, HEIGHT);
    expect(band).toHaveLength(3);
    for (const q of band) {
      expect(q.ymax - q.ymin).toBeCloseTo(0.6);
      expect(inCell(q, 'pared')).toBe(true);
      const r = cellRect('pared');
      expect(Math.max(...q.uv.map((t) => t.y))).toBeCloseTo(r.v0 + ((r.v1 - r.v0) * 0.6) / FLOOR_H);
    }
  });

  test('puerta fin: la celda de la puerta queda en la última bahía; medio en la central', () => {
    const fin = row(walls(gfront(lot('a', 9, front({ puerta: 'fin' })))), 0, FLOOR_H);
    expect(inCell(fin[2], 'vidriera-puerta')).toBe(true);
    expect(fin.slice(0, 2).some((q) => inCell(q, 'vidriera-puerta'))).toBe(false);
    const medio = row(walls(gfront(lot('a', 12, front({ puerta: 'medio' })))), 0, FLOOR_H); // 4 bahías: floor(3/2) = 1
    expect(medio.map((q) => inCell(q, 'vidriera-puerta'))).toEqual([false, true, false, false]);
  });

  test('planta guardada en sentido horario: "inicio" es el comienzo de la arista guardada', () => {
    // horario: la arista guardada 3 es (9,0) → (0,0); la puerta va del lado de x = 9
    const bd = lot('cw', 9, front({ edges: [3] }), { footprint: [[0, 0], [0, -12], [9, -12], [9, 0]] });
    const ground = row(walls(gfront(bd)), 0, FLOOR_H);
    expect(ground).toHaveLength(3);
    expect(inCell(ground[2], 'vidriera-puerta')).toBe(true);
    for (const q of walls(gfront(bd))) expect(q.n.z).toBeCloseTo(1);
  });

  test('contra: "inicio" cae en el extremo desde, que es el otro extremo físico', () => {
    const doorAt = (bd: Building): number => {
      const g = row(walls(gfront(bd)), 0, FLOOR_H);
      return g.findIndex((q) => inCell(q, 'vidriera-puerta'));
    };
    // antihorario: la arista guardada va de x = 0 a x = 9
    expect(doorAt(lot('a', 9, front()))).toBe(0);
    expect(doorAt(lot('a', 9, front({ contra: true })))).toBe(2);
    // horario: la arista guardada 3 va de x = 9 a x = 0
    const cw = [[0, 0], [0, -12], [9, -12], [9, 0]] as Building['footprint'];
    expect(doorAt(lot('a', 9, front({ edges: [3] }), { footprint: cw }))).toBe(2);
    expect(doorAt(lot('a', 9, front({ edges: [3], contra: true }), { footprint: cw }))).toBe(0);
  });

  test('lotes vecinos con colores distintos dan colores distintos (anti-objetivo del spec)', () => {
    const a = quads(gfront(lot('a', 9, front(), { tint: '#d9d2c3' })));
    const b = quads(gfront(lot('b', 9, front(), { tint: '#7a9e6b' })));
    expect(sameColor(a[0].col, b[0].col)).toBe(false);
  });

  test('colorPB pinta solo la planta baja', () => {
    const qs = walls(gfront(lot('a', 9, front({ colorPB: '#2b2b2b' }))));
    const pb = new THREE.Color().setStyle('#2b2b2b'), tint = new THREE.Color().setStyle('#d9d2c3');
    for (const q of qs) expect(sameColor(q.col, q.ymax <= FLOOR_H + 1e-6 ? pb : tint)).toBe(true);
    expect(qs.some((q) => q.ymax <= FLOOR_H + 1e-6)).toBe(true);
  });

  test('dos aristas casi colineales: la bahía de la unión tiene u continuo y suma una bahía', () => {
    const bd = lot('c', 9, front({ edges: [0, 1] }), { footprint: [[0, 0], [4.4, 0], [9, 0.05], [9, -12], [0, -12]] });
    const ground = walls(gfront(bd)).filter((q) => q.ymax <= FLOOR_H + 1e-6 && q.ymin < 1e-6).sort((a, b) => a.xmin - b.xmin);
    expect(ground).toHaveLength(4); // 3 bahías, una partida en la unión
    const [p1, p2] = ground.filter((q) => q.xmin > 2.9 && q.xmin < 4.5);
    const r = cellRect('vidriera');
    const span = (q: Q) => [Math.min(...q.uv.map((t) => t.x)), Math.max(...q.uv.map((t) => t.x))];
    expect(span(p1)[1]).toBeCloseTo(span(p2)[0]);
    expect(span(p2)[1] - span(p1)[0]).toBeCloseTo(r.u1 - r.u0);
  });

  test('toldo: 2 caras por pedazo, entre 2,0 y 2,3 y con 1 m de salida', () => {
    const plain = quads(gfront(lot('a', 9, front())));
    const g = gfront(lot('a', 9, front({ toldo: { color: '#aa2222', rayas: true } })));
    const aw = quads(g).filter((q) => Math.abs(q.n.y) > 1e-6);
    expect(quads(g).length - plain.length).toBe(6); // 3 pedazos × 2
    expect(aw.filter((q) => q.n.y > 0)).toHaveLength(3);
    expect(aw.filter((q) => q.n.y < 0)).toHaveLength(3);
    for (const q of aw) {
      expect(q.ymin).toBeCloseTo(AWNING.bottomY);
      expect(q.ymax).toBeCloseTo(AWNING.topY);
      expect(Math.max(...q.pos.map((v) => v.z))).toBeCloseTo(AWNING.depth);
      expect(inCell(q, 'toldo-rayas')).toBe(true);
      expect(sameColor(q.col, new THREE.Color().setStyle('#aa2222'))).toBe(true);
    }
    const xs = aw.flatMap((q) => q.pos.map((v) => v.x));
    expect(Math.min(...xs)).toBeCloseTo(AWNING.inset);
    expect(Math.max(...xs)).toBeCloseTo(9 - AWNING.inset);
  });

  test('esquina: la planta baja usa la celda rest y no lleva toldo', () => {
    // frente sobre z = 0 y esquina sobre x = 9 (arista 1), 6 m
    const bd = lot('e', 9, front({ corner: [1], toldo: { color: '#aa2222' } }), { footprint: [[0, 0], [9, 0], [9, -6], [0, -6]] });
    const qs = quads(gfront(bd));
    const side = qs.filter((q) => Math.abs(q.n.x) > 0.5);
    expect(side.length).toBeGreaterThan(0);
    expect(row(side, 0, FLOOR_H).every((q) => inCell(q, 'vidriera'))).toBe(true);
    expect(row(side, FLOOR_H, 2 * FLOOR_H).every((q) => inCell(q, 'ventana'))).toBe(true);
    expect(side.every((q) => Math.abs(q.n.y) < 1e-6)).toBe(true);
    expect(qs.filter((q) => Math.abs(q.n.y) > 1e-6)).toHaveLength(6); // el toldo es solo el de la corrida principal
  });
});

describe('extrudeBuilding con front', () => {
  test('las aristas del frente no van en ground ni en upper; sí en front', () => {
    const e = extrudeBuilding(lot('a', 9, front()));
    for (const g of [e.walls.ground, e.walls.upper]) {
      const p = g.getAttribute('position');
      expect(p.count).toBeGreaterThan(0);
      for (let i = 0; i < p.count; i += 4) {
        const zs = [0, 1, 2, 3].map((k) => p.getZ(i + k));
        expect(zs.every((z) => Math.abs(z) < 1e-6)).toBe(false); // ninguna cara entera sobre el frente
      }
    }
    expect(e.walls.front.getAttribute('position').count).toBeGreaterThan(0);
  });

  test('un edificio sin front da walls.front vacía', () => {
    const { front: _f, ...plain } = lot('a', 9, front());
    expect(extrudeBuilding(plain).walls.front.getAttribute('position').count).toBe(0);
  });

  test('frontGeometry directo con edgeOf identidad', () => {
    const bd = lot('a', 9, front());
    expect(frontGeometry(bd, bd.footprint, (e) => e).getAttribute('position').count).toBeGreaterThan(0);
  });
});
