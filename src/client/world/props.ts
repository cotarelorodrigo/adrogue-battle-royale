// Formas de subir: escaleras de mano (2 draw calls para todo el mapa) y contenedores (instanciados, en una malla con los
// que se ven: near.ts).
// Escaleras: las barandas son una geometría de 1 m de alto que cada instancia estira hasta topY + manijas; los
// peldaños, un cuadrilátero por escalera con una textura que deja ver solo una franja cada 0,3 m (alpha-test): eran
// ~11 000 cajitas y ~67 000 triángulos, ahora son 2 triángulos por escalera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash01 } from '../../shared/geo.ts';
import { DUMPSTER } from '../../shared/collision.ts';
import type { Prop } from '../../shared/mapdata.ts';
import { inViewInstances, nearInstances } from './near.ts';
import type { InView } from './near.ts';

export const LADDER_RUNG_STEP = 0.3;
/** Entre ejes de las barandas (el volumen de la escalera mide 0,8: la visual entra holgada). */
const LADDER_W = 0.5;
const RAIL_T = 0.05;
const RUNG_T = 0.03;
/** El plano de la escalera queda a 5 cm de la pared. */
const WALL_GAP = 0.05;
/** Las barandas siguen por encima del techo para agarrarse al pasar (como las escaleras de verdad). */
const HANDLE = 0.8;
/** Filas de la textura de los peldaños por cada 0,3 m. El eje del peldaño cae en v = RUNG_V (28/64: el medio de un
 *  grupo de 8 filas), así los mipmaps no lo parten en dos y se sigue viendo hasta ~30 m, donde ya mide menos de un
 *  píxel. */
const RUNG_ROWS = 64;
const RUNG_V = 28 / RUNG_ROWS;
/** Franjas del contenedor: zócalo oscuro abajo, cuerpo pintado y tapa un poco más oscura arriba. */
const DUMPSTER_BASE = 0.15;
const DUMPSTER_LID = 0.12;
const PAINT = [new THREE.Color('#2f6b3c'), new THREE.Color('#2b5288')]; // verde (la mayoría) y azul

type Ladder = Extract<Prop, { kind: 'ladder' }>;
type Dumpster = Extract<Prop, { kind: 'dumpster' }>;

/** Caras de BoxGeometry, en su orden. */
const BOX_FACES = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;

/** Caja de color liso: x × y × z, con la base en y0, sin las caras `drop` (las que quedan tapadas). */
function coloredBox(x: number, y: number, z: number, y0: number, color: THREE.Color,
  drop: (typeof BOX_FACES)[number][] = []): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x, y, z);
  g.translate(0, y0 + y / 2, 0);
  const idx = Array.from(g.index!.array);
  g.setIndex(BOX_FACES.flatMap((f, k) => (drop.includes(f) ? [] : idx.slice(k * 6, k * 6 + 6))));
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [color.r, color.g, color.b]).flat(), 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('mergeGeometries falló');
  for (const p of parts) p.dispose();
  return g;
}

/** Dos barandas de RAIL_T × 1 m en x = ±LADDER_W/2, centradas en z = 0. */
function railsGeometry(): THREE.BufferGeometry {
  return merge([-1, 1].map((side) => {
    const g = new THREE.BoxGeometry(RAIL_T, 1, RAIL_T);
    g.translate((side * LADDER_W) / 2, 0.5, 0);
    return g;
  }));
}

/** Franjas opacas de RUNG_T cada LADDER_RUNG_STEP (en v), transparente entre medio. El alfa va en .g: el canal que
 *  lee alphaMap. Con mipmaps: de lejos el peldaño se afina y desaparece en vez de titilar. */
function rungTexture(): THREE.DataTexture {
  const data = new Uint8Array(RUNG_ROWS * 4);
  for (let r = 0; r < RUNG_ROWS; r++) {
    const dy = ((r + 0.5) / RUNG_ROWS - RUNG_V) * LADDER_RUNG_STEP; // del centro de la fila al eje del peldaño
    data.fill(Math.abs(dy) < RUNG_T / 2 ? 255 : 0, r * 4, r * 4 + 4);
  }
  const t = new THREE.DataTexture(data, 1, RUNG_ROWS);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Un cuadrilátero por escalera en el plano de las barandas, de baranda a baranda y del primer peldaño (0,3 m) al
 *  último (≤ topY), mirando hacia afuera de la pared; v = y / 0,3 + RUNG_V pone una franja de la textura en cada
 *  peldaño. Escaleras de menos de 0,3 m no tienen peldaños. */
function rungsGeometry(ladders: Ladder[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const q = new THREE.Quaternion(), along = new THREE.Vector3(), out = new THREE.Vector3();
  for (const l of ladders) {
    const n = Math.floor(l.topY / LADDER_RUNG_STEP + 1e-9);
    if (n === 0) continue;
    const [x, z] = ladderFrame(l, q);
    along.set(LADDER_W / 2, 0, 0).applyQuaternion(q);
    out.set(0, 0, 1).applyQuaternion(q);
    const y0 = LADDER_RUNG_STEP - RUNG_T / 2, y1 = n * LADDER_RUNG_STEP + RUNG_T / 2;
    const base = pos.length / 3;
    for (const [side, y] of [[-1, y0], [1, y0], [1, y1], [-1, y1]] as const) {
      pos.push(x + side * along.x, y, z + side * along.z);
      nor.push(out.x, out.y, out.z);
      uv.push((side + 1) / 2, y / LADDER_RUNG_STEP + RUNG_V);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3); // along × arriba = afuera: antihorario desde la calle
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function dumpsterGeometry(): THREE.BufferGeometry {
  const { length: l, depth: d, height: h } = DUMPSTER;
  return merge([
    coloredBox(l, DUMPSTER_BASE, d, 0, new THREE.Color(0.22, 0.22, 0.22), ['+y', '-y']),
    coloredBox(l, h - DUMPSTER_BASE - DUMPSTER_LID, d, DUMPSTER_BASE, new THREE.Color(1, 1, 1), ['+y', '-y']),
    coloredBox(l, DUMPSTER_LID, d, h - DUMPSTER_LID, new THREE.Color(0.72, 0.72, 0.72), ['-y']),
  ]);
}

const UP = new THREE.Vector3(0, 1, 0);

/** Pared → instancia: +z local hacia la normal (hacia afuera), +x a lo largo de la pared. */
function ladderFrame(l: Ladder, q: THREE.Quaternion): [number, number] {
  const len = Math.hypot(l.normal[0], l.normal[1]) || 1;
  const nx = l.normal[0] / len, nz = l.normal[1] / len;
  q.setFromAxisAngle(UP, Math.atan2(nx, nz));
  return [l.base[0] + l.normal[0] * WALL_GAP, l.base[1] + l.normal[1] * WALL_GAP];
}

export function buildClimbProps(props: Prop[]): THREE.Mesh[] {
  const ladders = props.filter((p): p is Ladder => p.kind === 'ladder');
  const dumpsters = props.filter((p): p is Dumpster => p.kind === 'dumpster');
  const out: THREE.Mesh[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();

  if (ladders.length > 0) {
    const steel = '#858b90';
    const rails = new THREE.InstancedMesh(railsGeometry(), new THREE.MeshLambertMaterial({ color: steel }), ladders.length);
    rails.name = 'ladderRails';
    ladders.forEach((l, i) => {
      const [x, z] = ladderFrame(l, q);
      rails.setMatrixAt(i, m.compose(p.set(x, 0, z), q, s.set(1, l.topY + HANDLE, 1)));
    });
    nearInstances(rails); // las ~500 del mapa en una malla: se dibujan las cercanas a la cámara (T11b)
    const rungMat = new THREE.MeshLambertMaterial({ color: steel, alphaMap: rungTexture(), alphaTest: 0.5 });
    const rungs = new THREE.Mesh(rungsGeometry(ladders), rungMat);
    rungs.name = 'ladderRungs';
    rungs.matrixAutoUpdate = false;
    for (const mesh of [rails, rungs]) {
      mesh.receiveShadow = true;
      out.push(mesh);
    }
  }

  if (dumpsters.length > 0) {
    const mesh = new THREE.InstancedMesh(dumpsterGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), dumpsters.length);
    mesh.name = 'dumpster';
    dumpsters.forEach((d, i) => {
      q.setFromAxisAngle(UP, d.rotation); // largo sobre +x local, igual que la caja de colisión
      mesh.setMatrixAt(i, m.compose(p.set(d.position[0], 0, d.position[1]), q, s.set(1, 1, 1)));
      mesh.setColorAt(i, PAINT[hash01(`contenedor:${d.position[0]},${d.position[1]}`) < 0.7 ? 0 : 1]);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // los de alrededor (con sombra en alta) y, en otra malla sin sombra, los demás que se ven (near.ts; `around`, en
    // setDumpsterShadows)
    out.push(mesh, inViewInstances(mesh).far);
  }
  return out;
}

/** Sombras de los contenedores (QUALITY.dumpsterShadows): son ~700 cajas chicas que duplican sus triángulos en la
 *  pasada de sombras y casi no se notan; solo en alta. Con sombra, además de los que se ven se dibujan los que están a
 *  menos de `around` m (los que pueden dar sombra al cuadro desde atrás: hasta donde llega la cámara del sol). */
export function setDumpsterShadows(meshes: THREE.Object3D[], on: boolean, around = 0): void {
  for (const m of meshes) {
    if (m.name !== 'dumpster') continue;
    m.castShadow = on;
    const view = m.userData.inView as InView | undefined;
    if (view) view.around = on ? around : 0;
  }
}
