// Parte las InstancedMesh grandes (árboles, contenedores, durmientes) en celdas fijas del suelo. three descarta cada
// malla entera por frustum (y por camera.far, que sigue a la calidad), así que con una sola malla para todo el mapa se
// dibujan todas las instancias, detrás de la cámara o a 1 km; por celda, solo las celdas que se ven. Lo mismo en la
// pasada de sombras: la cámara del sol cubre ±80 m y deja afuera las celdas que no toca.
import * as THREE from 'three';
import type { Vec2 } from '../../shared/geo.ts';

/** Lado de la celda (el mismo que el de los chunks). Medido en la Tarea 15 en los 6 puntos del recorrido: con 250 m
 *  las instancias dibujadas bajan ~65 % por ~30 draw calls más en media; con 175 o 125 m bajan apenas unos puntos
 *  más y los draw calls se duplican o triplican. */
export const CELL = 250;

/** Índices de `points` agrupados por celda de `size` × `size` (borde inferior incluido). Dentro de cada grupo, en el
 *  orden de entrada; los grupos, ordenados por celda (x y después z). */
export function partitionByCell(points: Vec2[], size = CELL): number[][] {
  const cells = new Map<string, { i: number; j: number; idx: number[] }>();
  points.forEach(([x, z], k) => {
    const i = Math.floor(x / size), j = Math.floor(z / size);
    const key = `${i},${j}`;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { i, j, idx: [] }));
    c.idx.push(k);
  });
  return [...cells.values()].sort((a, b) => a.i - b.i || a.j - b.j).map((c) => c.idx);
}

/** Geometría para un subconjunto de instancias: comparte índice y atributos de vértice (se suben una sola vez a la
 *  GPU) y recorta los atributos por instancia. Sin atributos por instancia, la misma geometría. */
function subsetGeometry(g: THREE.BufferGeometry, idx: number[]): THREE.BufferGeometry {
  const perInstance = Object.entries(g.attributes).filter(([, a]) => a instanceof THREE.InstancedBufferAttribute);
  if (perInstance.length === 0) return g;
  const out = new THREE.BufferGeometry();
  out.setIndex(g.index);
  for (const [name, a] of Object.entries(g.attributes)) {
    if (!(a instanceof THREE.InstancedBufferAttribute)) {
      out.setAttribute(name, a);
      continue;
    }
    const n = a.itemSize, src = a.array;
    const arr = new (src.constructor as new (len: number) => typeof src)(idx.length * n);
    idx.forEach((i, k) => {
      for (let c = 0; c < n; c++) arr[k * n + c] = src[i * n + c];
    });
    out.setAttribute(name, new THREE.InstancedBufferAttribute(arr, n, a.normalized, a.meshPerAttribute));
  }
  return out;
}

/** Una InstancedMesh por celda, según la posición (x, z) de cada instancia; se parten todas las que tiene `mesh`, no
 *  solo las primeras `count`. Mismo material, nombre, sombras y userData; el orden de las instancias se conserva y
 *  `userData.instances` dice de qué índice de `mesh` viene cada una (para repartir otros datos por instancia). */
export function splitByCell(mesh: THREE.InstancedMesh, size = CELL): THREE.InstancedMesh[] {
  const total = mesh.instanceMatrix.count;
  const mat = mesh.instanceMatrix.array;
  const points = Array.from({ length: total }, (_, i): Vec2 => [mat[i * 16 + 12], mat[i * 16 + 14]]);
  return partitionByCell(points, size).map((idx) => {
    const part = new THREE.InstancedMesh(subsetGeometry(mesh.geometry, idx), mesh.material, idx.length);
    idx.forEach((i, k) => part.instanceMatrix.array.set(mat.subarray(i * 16, i * 16 + 16), k * 16));
    if (mesh.instanceColor) {
      const c = new THREE.Color();
      idx.forEach((i, k) => part.setColorAt(k, mesh.getColorAt(i, c)));
    }
    part.name = mesh.name;
    part.castShadow = mesh.castShadow;
    part.receiveShadow = mesh.receiveShadow;
    part.customDepthMaterial = mesh.customDepthMaterial;
    part.customDistanceMaterial = mesh.customDistanceMaterial;
    part.frustumCulled = mesh.frustumCulled;
    part.userData = { ...mesh.userData, instances: Uint32Array.from(idx) };
    return part;
  });
}
