// Qué copias de una InstancedMesh se dibujan (T11b), eligiéndolas en la misma malla (sin draw calls nuevos):
// - nearInstances: las cercanas a la cámara. Los detalles chicos de todo el mapa (los durmientes, las barandas de las
//   escaleras de mano) se dibujan solo a menos de QUALITY.detailRadius: más allá miden menos de medio píxel de grueso (un
//   durmiente, 15 cm de alto; una baranda, 5 cm) y solo suman triángulos. Las barandas de las 499 escaleras se dibujaban
//   todas desde cualquier lado (una malla para todo el mapa), y los durmientes de una celda de 250 m, todos aunque la
//   celda apenas tocara el cuadro.
// - inViewInstances: en dos mallas, las de alrededor (`near`, la malla dada: las que pueden dar sombra al cuadro aunque
//   estén atrás) y las demás que ve la cámara (`far`, que nunca dan sombra: están fuera de la caja de la cámara del sol).
//   Los contenedores iban en una malla por celda de 250 m: un draw call por celda que tocaba el cuadro (24 en alta desde
//   las vías, con la sombra), con todo lo de la celda adentro; ahora son 2 (3 con la sombra).
import * as THREE from 'three';

/** Cada cuánto (m, en planta) se vuelve a elegir: se eligen las que están a menos de radio + NEAR_STEP, así entre dos
 *  elecciones lo que está a menos del radio sigue adentro. */
export const NEAR_STEP = 8;

export interface Near {
  readonly mesh: THREE.InstancedMesh;
  /** Hasta dónde (m, en planta): rige en el próximo update. Infinity: todas. */
  radius: number;
  /** Deja al principio de la malla (en `count`) las copias cercanas a `eye`, si se movió NEAR_STEP o cambió el radio. */
  update(eye: THREE.Vector3): void;
}

export interface InView {
  /** Las de alrededor (la malla dada, con su sombra). */
  readonly near: THREE.InstancedMesh;
  /** Las demás que ve la cámara: sin sombra. Nombre: el de `near` + 'Far'. */
  readonly far: THREE.InstancedMesh;
  /** Las que están a menos de esto (m, en planta) de la cámara van en `near`, se vean o no. 0: ninguna. */
  around: number;
  /** Elige: en `near`, las de alrededor; en `far`, las otras cuya esfera toca el frustum de `camera` (y, con `keep`,
   *  pasan `keep`: desde adentro de un interior, lo que se ve por sus aberturas). Con la misma cámara (lugar y
   *  proyección), el mismo `around` y `keep` o no como la vez anterior, no hace nada; si una malla queda con las mismas
   *  que la vez anterior, no sube nada. */
  update(camera: THREE.Camera, keep?: (s: THREE.Sphere) => boolean): void;
}

/** Las copias de `mesh` tal como se armaron, y cómo dejar elegidas algunas al principio. */
function pool(mesh: THREE.InstancedMesh) {
  const total = mesh.instanceMatrix.count;
  const matrices = mesh.instanceMatrix.array.slice(0, total * 16);
  const colors = mesh.instanceColor ? mesh.instanceColor.array.slice(0, total * 3) : null;
  const x = Float64Array.from({ length: total }, (_, i) => matrices[i * 16 + 12]);
  const z = Float64Array.from({ length: total }, (_, i) => matrices[i * 16 + 14]);
  const picked = new Int32Array(total);
  const prev = new Int32Array(total);
  let last = -1; // cuántas quedaron la vez anterior (-1: ninguna elección todavía)
  /** Copia las `n` de `picked` (índices de las originales) al principio de la malla; con `lazy`, nada si son las de la
   *  vez anterior. */
  const write = (n: number, lazy = false): void => {
    if (lazy && n === last && picked.subarray(0, n).every((v, k) => v === prev[k])) return;
    prev.set(picked.subarray(0, n));
    last = n;
    const m = mesh.instanceMatrix.array, c = mesh.instanceColor?.array;
    for (let k = 0; k < n; k++) {
      const i = picked[k];
      m.set(matrices.subarray(i * 16, i * 16 + 16), k * 16);
      if (c && colors) c.set(colors.subarray(i * 3, i * 3 + 3), k * 3);
    }
    mesh.count = n;
    mesh.visible = n > 0; // con la esfera vacía three no siempre la descarta
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, n * 3);
      mesh.instanceColor.needsUpdate = true;
    }
    // three las recalcula con las copias que quedan
    mesh.boundingSphere = null;
    mesh.boundingBox = null;
  };
  return { total, matrices, x, z, picked, write };
}

/** Envuelve `mesh` (con todas sus copias puestas): hasta el primer update se dibujan todas. Queda en mesh.userData.near. */
export function nearInstances(mesh: THREE.InstancedMesh, radius = Infinity): Near {
  const { total, x, z, picked, write } = pool(mesh);
  let lastX = NaN, lastZ = NaN, lastRadius = NaN;
  const near: Near = {
    mesh,
    radius,
    update(eye) {
      if (near.radius === lastRadius && Math.hypot(eye.x - lastX, eye.z - lastZ) < NEAR_STEP) return;
      [lastX, lastZ, lastRadius] = [eye.x, eye.z, near.radius];
      const r2 = (near.radius + NEAR_STEP) ** 2;
      let n = 0;
      for (let i = 0; i < total; i++) {
        const dx = x[i] - eye.x, dz = z[i] - eye.z;
        if (dx * dx + dz * dz < r2) picked[n++] = i;
      }
      write(n);
    },
  };
  mesh.userData.near = near;
  return near;
}

/** Envuelve `mesh` (con todas sus copias puestas), que pasa a ser `near`, y arma `far` (sin copias): hasta el primer
 *  update se dibujan todas en `near`. Queda en mesh.userData.inView. */
export function inViewInstances(mesh: THREE.InstancedMesh, around = 0): InView {
  const far = new THREE.InstancedMesh(mesh.geometry, mesh.material, mesh.instanceMatrix.count);
  far.instanceMatrix.copy(mesh.instanceMatrix);
  if (mesh.instanceColor) far.setColorAt(0, new THREE.Color()).instanceColor!.copy(mesh.instanceColor);
  far.name = `${mesh.name}Far`;
  far.receiveShadow = mesh.receiveShadow;
  far.castShadow = false;
  far.count = 0;
  far.visible = false;
  const [a, b] = [pool(mesh), pool(far)];
  const { total, matrices, x, z } = a;
  const g = mesh.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  // la esfera de cada copia: la de la geometría, puesta con su matriz (con su escala más grande)
  const spheres = Array.from({ length: total }, (_, i) => g.boundingSphere!.clone().applyMatrix4(new THREE.Matrix4().fromArray(matrices, i * 16)));
  const frustum = new THREE.Frustum(), viewProj = new THREE.Matrix4(), eye = new THREE.Vector3();
  // lo que decidió la elección anterior: la cámara (su lugar y su proyección), `around` y si hubo `keep`. Si nada de eso
  // cambió, la elección tampoco (keep, desde adentro, depende solo de dónde está la cámara): no se recorre nada (H5)
  const last = new Float64Array(34).fill(NaN), now = new Float64Array(34);
  const view: InView = {
    near: mesh,
    far,
    around,
    update(camera, keep) {
      camera.updateMatrixWorld();
      now.set(camera.matrixWorld.elements, 0);
      now.set(camera.projectionMatrix.elements, 16);
      now[32] = view.around;
      now[33] = keep ? 1 : 0;
      if (now.every((v, k) => v === last[k])) return;
      last.set(now);
      camera.getWorldPosition(eye);
      frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const a2 = view.around * view.around;
      let n = 0, m = 0;
      for (let i = 0; i < total; i++) {
        const dx = x[i] - eye.x, dz = z[i] - eye.z;
        if (dx * dx + dz * dz < a2) a.picked[n++] = i;
        else if (frustum.intersectsSphere(spheres[i]) && (!keep || keep(spheres[i]))) b.picked[m++] = i;
      }
      a.write(n, true);
      b.write(m, true);
    },
  };
  mesh.userData.inView = view;
  return view;
}

/** Las Near de `objects` y sus hijos, en el orden en que aparecen. */
export function nearOf(objects: THREE.Object3D[]): Near[] {
  const out: Near[] = [];
  for (const o of objects) o.traverse((x) => { if (x.userData.near) out.push(x.userData.near as Near); });
  return out;
}

/** Las InView de `objects` y sus hijos, en el orden en que aparecen. */
export function inViewOf(objects: THREE.Object3D[]): InView[] {
  const out: InView[] = [];
  for (const o of objects) o.traverse((x) => { if (x.userData.inView) out.push(x.userData.inView as InView); });
  return out;
}
