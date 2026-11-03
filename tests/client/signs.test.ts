// @vitest-environment jsdom
import * as THREE from 'three';
import { buildSigns, signTexture } from '../../src/client/world/signs.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Place } from '../../src/shared/mapdata.ts';
import { stubCanvas } from './canvas-stub.ts';

beforeEach(() => stubCanvas());
afterEach(() => vi.restoreAllMocks());

const placeWithSign: Place = {
  id: 'guernica-bar', name: 'Guernica Bar', type: 'bar', position: [-61.04, 158.97], enterable: false, buildingId: 'b0867',
  sign: { text: 'GUERNICA BAR', anchor: [-55.02, 171.99], normal: [0.862, -0.507], width: 5.06, bottomY: 3 },
  spawn: [-50, 0, 170],
};
const plaza: Place = { id: 'plaza', name: 'Plaza', type: 'plaza', position: [0, 0], enterable: false, spawn: [0, 0, 0] };

/** Medidas de la caja en su marco local (al décimo de milímetro: las posiciones se guardan en float32). */
const sizeOf = (m: THREE.Mesh): number[] => {
  m.geometry.computeBoundingBox();
  const s = m.geometry.boundingBox!.getSize(new THREE.Vector3());
  return s.toArray().map((v) => Math.round(v * 1e4) / 1e4);
};
/** Hacia dónde mira la cara del frente (+z local) en el plano (x, z). */
const facing = (m: THREE.Mesh): Vec2 => {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion);
  return [f.x, f.z];
};

test('cartel con medidas y orientación del MapData', () => {
  const m = buildSigns([placeWithSign]).children[0] as THREE.Mesh;
  expect(sizeOf(m)).toEqual([placeWithSign.sign!.width, 0.9, 0.12]);
  expect(facing(m)).toBeCloseTo2D(placeWithSign.sign!.normal);
});

test('el centro queda 6 cm afuera de la pared y con la base a bottomY', () => {
  const m = buildSigns([placeWithSign]).children[0] as THREE.Mesh;
  const { anchor, normal, bottomY } = placeWithSign.sign!;
  expect([m.position.x, m.position.z]).toBeCloseTo2D([anchor[0] + normal[0] * 0.06, anchor[1] + normal[1] * 0.06], 4);
  expect(m.position.y).toBeCloseTo(bottomY + 0.45);
});

test('un cartel por lugar con sign; los lugares sin cartel no suman', () => {
  const g = buildSigns([placeWithSign, plaza, { ...placeWithSign, id: 'otro' }]);
  expect(g.children).toHaveLength(2);
});

test('el nombre va solo en la cara del frente; el resto de las caras usa el color del marco', () => {
  const m = buildSigns([placeWithSign]).children[0] as THREE.Mesh;
  const n = m.geometry.getAttribute('normal');
  const uv = m.geometry.getAttribute('uv');
  const front: number[] = [], rest: number[][] = [];
  for (let i = 0; i < n.count; i++) {
    if (n.getZ(i) > 0.5) front.push(uv.getX(i), uv.getY(i));
    else rest.push([uv.getX(i), uv.getY(i)]);
  }
  expect(Math.min(...front)).toBe(0);
  expect(Math.max(...front)).toBe(1);
  // todas las demás caras toman un único punto del marco (color liso)
  expect(new Set(rest.map((p) => p.join())).size).toBe(1);
  const [u, v] = rest[0];
  expect(Math.min(u, 1 - u, v, 1 - v)).toBeLessThan(0.05);
});

test('la textura tiene la proporción del cartel', () => {
  const c = signTexture('MCDONALD\'S', 'fastfood', 2.83);
  expect(c.width / c.height).toBeCloseTo(2.83 / 0.9, 1);
  const d = signTexture('BANCO NACIÓN', 'bank');
  expect(d.width / d.height).toBeCloseTo(6 / 0.9, 1);
});

test('fondo y tipografía cambian según el tipo de lugar', () => {
  const drawn = (type: Place['type']) => {
    const calls: string[] = [];
    stubCanvas((prop, value) => {
      if (prop === 'fillStyle' || prop === 'font') calls.push(`${prop}=${String(value)}`);
    });
    signTexture('NOMBRE', type);
    return calls.join('|');
  };
  expect(drawn('bank')).not.toBe(drawn('bar'));
  expect(drawn('cinema')).not.toBe(drawn('icecream'));
});
