import * as THREE from 'three';
import { buildClimbProps, LADDER_RUNG_STEP } from '../../src/client/world/props.ts';
import type { Prop } from '../../src/shared/mapdata.ts';

const ladderA: Prop = { kind: 'ladder', base: [10, 20], normal: [0.6, -0.8], topY: 7, buildingId: 'b1' };
const ladderB: Prop = { kind: 'ladder', base: [-5, 3], normal: [-1, 0], topY: 13.4, buildingId: 'b2' };
const dumpA: Prop = { kind: 'dumpster', position: [4, -2], rotation: 0.7 };
const dumpB: Prop = { kind: 'dumpster', position: [-30, 12.5], rotation: -2.1 };
const props: Prop[] = [ladderA, { kind: 'bench', position: [0, 0], rotation: 0 }, dumpA, ladderB, dumpB];

const meshes = buildClimbProps(props);
const byName = (n: string) => meshes.find((m) => m.name === n)!;

function decompose(m: THREE.InstancedMesh, i: number) {
  const mat = new THREE.Matrix4();
  m.getMatrixAt(i, mat);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  mat.decompose(p, q, s);
  return { p, q, s };
}
/** Hacia dónde apunta un eje local en el plano (x, z). */
const axis = (q: THREE.Quaternion, x: number, z: number): [number, number] => {
  const v = new THREE.Vector3(x, 0, z).applyQuaternion(q);
  return [v.x, v.z];
};
/** Caja (en el marco local, sin la matriz de instancia) de la geometría. */
const localSize = (m: THREE.InstancedMesh): number[] => {
  m.geometry.computeBoundingBox();
  return m.geometry.boundingBox!.getSize(new THREE.Vector3()).toArray().map((v) => Math.round(v * 1e4) / 1e4);
};

test('a lo sumo 4 draw calls: barandas, peldaños y contenedores', () => {
  expect(meshes.length).toBeLessThanOrEqual(4);
  for (const m of meshes) expect(m).toBeInstanceOf(THREE.InstancedMesh);
});

test('contenedores: una instancia por prop, en su posición y rotación, de 1,8 × 1,4 × 1,1', () => {
  const m = byName('dumpster');
  expect(m.count).toBe(2);
  expect(localSize(m)).toEqual([1.8, 1.4, 1.1]);
  m.geometry.computeBoundingBox();
  expect(m.geometry.boundingBox!.min.y).toBeCloseTo(0);
  [dumpA, dumpB].forEach((d, i) => {
    if (d.kind !== 'dumpster') throw new Error();
    const { p, q, s } = decompose(m, i);
    expect([p.x, p.z]).toBeCloseTo2D(d.position, 5);
    expect(p.y).toBeCloseTo(0);
    expect(s.toArray()).toEqual([1, 1, 1].map((v) => expect.closeTo(v, 6)));
    // el largo (+x local) va hacia (cos θ, −sin θ), igual que la caja de colisión
    expect(axis(q, 1, 0)).toBeCloseTo2D([Math.cos(d.rotation), -Math.sin(d.rotation)], 5);
  });
});

test('escaleras: barandas a 5 cm de la pared, mirando hacia afuera, hasta topY + manijas', () => {
  const rails = byName('ladderRails');
  expect(rails.count).toBe(2);
  [ladderA, ladderB].forEach((l, i) => {
    if (l.kind !== 'ladder') throw new Error();
    const { p, q, s } = decompose(rails, i);
    expect([p.x, p.z]).toBeCloseTo2D([l.base[0] + l.normal[0] * 0.05, l.base[1] + l.normal[1] * 0.05], 5);
    expect(p.y).toBeCloseTo(0);
    expect(axis(q, 0, 1)).toBeCloseTo2D(l.normal, 5); // +z local = normal de la pared
    expect(s.x).toBeCloseTo(1);
    expect(s.z).toBeCloseTo(1);
    expect(s.y).toBeCloseTo(l.topY + 0.8); // geometría de 1 m de alto escalada por instancia
  });
  rails.geometry.computeBoundingBox();
  const bb = rails.geometry.boundingBox!;
  expect(bb.min.y).toBeCloseTo(0);
  expect(bb.max.y).toBeCloseTo(1);
  expect(bb.max.x - bb.min.x).toBeCloseTo(0.5 + 0.05, 3); // 0,5 m entre ejes de barandas de 5 cm
});

test('escaleras: peldaños cada 0,3 m desde 0,3 hasta topY, todos sobre el plano de la escalera', () => {
  const rungs = byName('ladderRungs');
  const expected = [ladderA, ladderB].map((l) => (l.kind === 'ladder' ? Math.floor(l.topY / LADDER_RUNG_STEP + 1e-9) : 0));
  expect(LADDER_RUNG_STEP).toBe(0.3);
  expect(rungs.count).toBe(expected[0] + expected[1]);
  let i = 0;
  [ladderA, ladderB].forEach((l, k) => {
    if (l.kind !== 'ladder') throw new Error();
    const c: [number, number] = [l.base[0] + l.normal[0] * 0.05, l.base[1] + l.normal[1] * 0.05];
    for (let r = 1; r <= expected[k]; r++, i++) {
      const { p, q } = decompose(rungs, i);
      expect([p.x, p.z]).toBeCloseTo2D(c, 5);
      expect(p.y).toBeCloseTo(r * 0.3, 5);
      expect(axis(q, 0, 1)).toBeCloseTo2D(l.normal, 5);
    }
    const { p } = decompose(rungs, i - 1);
    expect(p.y).toBeLessThanOrEqual(l.topY + 1e-6);
  });
});

test('sin escaleras ni contenedores no hay mallas vacías', () => {
  expect(buildClimbProps([{ kind: 'bench', position: [0, 0], rotation: 0 }])).toEqual([]);
});
