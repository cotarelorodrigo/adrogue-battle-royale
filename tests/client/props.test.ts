import * as THREE from 'three';
import { nearOf } from '../../src/client/world/near.ts';
import type { InView } from '../../src/client/world/near.ts';
import { buildClimbProps, LADDER_RUNG_STEP, setDumpsterShadows } from '../../src/client/world/props.ts';
import type { Prop } from '../../src/shared/mapdata.ts';

const ladderA: Prop = { kind: 'ladder', base: [10, 20], normal: [0.6, -0.8], topY: 7, buildingId: 'b1' };
const ladderB: Prop = { kind: 'ladder', base: [-5, 3], normal: [-1, 0], topY: 13.4, buildingId: 'b2' };
const dumpA: Prop = { kind: 'dumpster', position: [4, -2], rotation: 0.7 };
const dumpB: Prop = { kind: 'dumpster', position: [-30, 12.5], rotation: -2.1 };
const props: Prop[] = [ladderA, { kind: 'bench', position: [0, 0], rotation: 0 }, dumpA, ladderB, dumpB];

const meshes = buildClimbProps(props);
const byName = (n: string) => meshes.find((m) => m.name === n) as THREE.InstancedMesh;
const dumpsters = meshes.filter((m) => m.name === 'dumpster') as THREE.InstancedMesh[];

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

// T11b: los contenedores iban en una malla por celda de 250 m (24 draw calls en alta desde las vías); ahora en una sola,
// con las copias que se ven (near.ts, inViewInstances)
test('escaleras en 2 draw calls (barandas y peldaños); contenedores en una sola malla instanciada, con los que se ven', () => {
  expect(meshes.filter((m) => m.name === 'ladderRails' || m.name === 'ladderRungs')).toHaveLength(2);
  expect(byName('ladderRails')).toBeInstanceOf(THREE.InstancedMesh);
  // dumpA (4, −2) y dumpB (−30, 12,5), en celdas distintas: la misma malla
  expect(dumpsters).toHaveLength(1);
  expect(dumpsters[0]).toBeInstanceOf(THREE.InstancedMesh);
  expect(dumpsters[0].count).toBe(2);
  const view = dumpsters[0].userData.inView as InView;
  // y la de los que se ven más allá de los de alrededor, sin sombra: la otra malla
  expect(view.far.name).toBe('dumpsterFar');
  expect(meshes).toContain(view.far);
  expect(meshes).toHaveLength(4);
});

test('contenedores: mirando a uno se dibuja ese; con alrededor (la sombra en alta), los dos, en la malla que da sombra', () => {
  const [mesh] = buildClimbProps(props).filter((m) => m.name === 'dumpster') as THREE.InstancedMesh[];
  const view = mesh.userData.inView as InView;
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.15, 500);
  cam.position.set(-10, 1.6, 4);
  cam.lookAt(4, 0, -2); // hacia dumpA; dumpB queda atrás, a ~22 m
  cam.updateMatrixWorld();
  view.update(cam);
  expect([mesh.count, view.far.count]).toEqual([0, 1]);
  const p = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(view.far.instanceMatrix.array, 0));
  expect([p.x, p.z]).toBeCloseTo2D([4, -2], 5);
  view.around = 30;
  view.update(cam);
  expect([mesh.count, view.far.count]).toEqual([2, 0]);
});

test('contenedores: una instancia por prop, en su posición y rotación, de 1,8 × 2 × 1,1', () => {
  const found = [0, 1].map((i) => ({ m: dumpsters[0], ...decompose(dumpsters[0], i) }));
  [dumpA, dumpB].forEach((d) => {
    if (d.kind !== 'dumpster') throw new Error();
    const hit = found.find(({ p }) => Math.hypot(p.x - d.position[0], p.z - d.position[1]) < 1e-5)!;
    expect(hit).toBeDefined();
    const { m, p, q, s } = hit;
    expect(localSize(m)).toEqual([1.8, 2, 1.1]);
    m.geometry.computeBoundingBox();
    expect(m.geometry.boundingBox!.min.y).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    expect(s.toArray()).toEqual([1, 1, 1].map((v) => expect.closeTo(v, 6)));
    // el largo (+x local) va hacia (cos θ, −sin θ), igual que la caja de colisión
    expect(axis(q, 1, 0)).toBeCloseTo2D([Math.cos(d.rotation), -Math.sin(d.rotation)], 5);
  });
  // tres franjas sin las caras que se tapan entre ellas ni la de abajo: 4 lados × 3 franjas + la tapa = 26 triángulos
  expect(dumpsters[0].geometry.index!.count / 3).toBe(26);
});

test('las sombras de los contenedores se prenden y apagan (solo en alta), con los de alrededor que pueden darla', () => {
  setDumpsterShadows(meshes, false, 200);
  for (const m of dumpsters) expect([m.castShadow, (m.userData.inView as InView).around]).toEqual([false, 0]);
  setDumpsterShadows(meshes, true, 200);
  for (const m of dumpsters) expect([m.castShadow, (m.userData.inView as InView).around]).toEqual([true, 200]);
  expect(byName('ladderRails').castShadow).toBe(false);
  expect(byName('dumpsterFar').castShadow).toBe(false); // los de lejos, nunca
});

// T11b: las barandas de las ~500 escaleras del mapa van en una malla: se dibujan solo las cercanas a la cámara (near.ts);
// los peldaños (un cuadrilátero por escalera) y los contenedores, como antes
test('escaleras: de las barandas, solo las cercanas a la cámara (en la misma malla)', () => {
  const props2 = buildClimbProps(props);
  const near = nearOf(props2);
  expect(near.map((n) => n.mesh.name)).toEqual(['ladderRails']);
  near[0].radius = 10;
  near[0].update(new THREE.Vector3(10, 1.6, 20)); // al lado de ladderA; ladderB queda a ~22,7 m (más que 10 + NEAR_STEP)
  expect(near[0].mesh.count).toBe(1);
  const p = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(near[0].mesh.instanceMatrix.array, 0));
  expect(Math.hypot(p.x - 10, p.z - 20)).toBeLessThan(1);
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

test('escaleras: peldaños cada 0,3 m desde 0,3 hasta topY, en un cuadrilátero por escalera recortado por alpha-test', () => {
  const rungs = meshes.find((m) => m.name === 'ladderRungs')!;
  expect(rungs).not.toBeInstanceOf(THREE.InstancedMesh);
  const mat = rungs.material as THREE.MeshLambertMaterial;
  expect(mat.color.getHexString()).toBe((byName('ladderRails').material as THREE.MeshLambertMaterial).color.getHexString());
  expect(mat.alphaTest).toBeGreaterThan(0);
  const tex = mat.alphaMap as THREE.DataTexture;
  expect(tex.wrapT).toBe(THREE.RepeatWrapping);
  const g = rungs.geometry;
  const pos = g.getAttribute('position'), uv = g.getAttribute('uv'), nor = g.getAttribute('normal');
  expect(pos.count).toBe(4 * 2);
  expect(g.index!.count).toBe(6 * 2); // 2 triángulos por escalera (eran ~6 por peldaño)
  expect(LADDER_RUNG_STEP).toBe(0.3);
  // la textura repite cada 0,3 m en v: v − y/0,3 es la misma constante en todos los vértices
  const vOff = uv.getY(0) - pos.getY(0) / 0.3;
  for (let i = 0; i < pos.count; i++) expect(uv.getY(i) - pos.getY(i) / 0.3).toBeCloseTo(vOff, 4); // float32
  // filas opacas de la textura: exactamente las que caen a menos de medio peldaño (1,5 cm) del eje de un peldaño
  const rows = tex.image.height, data = tex.image.data as Uint8Array;
  for (let r = 0; r < rows; r++) {
    let dy = ((r + 0.5) / rows - vOff) * 0.3;
    dy -= Math.round(dy / 0.3) * 0.3;
    expect(data[r * 4 * tex.image.width + 1] /* .g: el canal que lee alphaMap */, `fila ${r}`).toBe(Math.abs(dy) < 0.015 ? 255 : 0);
  }
  [ladderA, ladderB].forEach((l, k) => {
    if (l.kind !== 'ladder') throw new Error();
    const n = Math.floor(l.topY / LADDER_RUNG_STEP + 1e-9);
    const len = Math.hypot(...l.normal), nx = l.normal[0] / len, nz = l.normal[1] / len;
    const c: [number, number] = [l.base[0] + l.normal[0] * 0.05, l.base[1] + l.normal[1] * 0.05];
    const ys: number[] = [];
    for (let i = 4 * k; i < 4 * k + 4; i++) {
      const dx = pos.getX(i) - c[0], dz = pos.getZ(i) - c[1];
      expect(dx * nx + dz * nz).toBeCloseTo(0, 5); // sobre el plano de la escalera
      expect(Math.abs(dx * -nz + dz * nx)).toBeCloseTo(0.25, 5); // de baranda a baranda
      expect([nor.getX(i), nor.getZ(i)]).toBeCloseTo2D([nx, nz], 5); // mira hacia afuera de la pared
      ys.push(pos.getY(i));
    }
    // del primer peldaño (0,3) al último (n × 0,3 ≤ topY), cada uno con su medio espesor
    expect(Math.min(...ys)).toBeCloseTo(0.3 - 0.015, 5);
    expect(Math.max(...ys)).toBeCloseTo(n * 0.3 + 0.015, 5);
    expect(n * 0.3).toBeLessThanOrEqual(l.topY + 1e-6);
    // la cara de adelante es la que mira hacia afuera (los triángulos giran antihorario vistos desde la calle)
    const t = g.index!.array.slice(6 * k, 6 * k + 3);
    const [a, b, d] = [...t].map((i) => new THREE.Vector3().fromBufferAttribute(pos, i));
    const face = b.clone().sub(a).cross(d.clone().sub(a)).normalize();
    expect([face.x, face.z]).toBeCloseTo2D([nx, nz], 5);
  });
});

test('sin escaleras ni contenedores no hay mallas vacías', () => {
  expect(buildClimbProps([{ kind: 'bench', position: [0, 0], rotation: 0 }])).toEqual([]);
});
