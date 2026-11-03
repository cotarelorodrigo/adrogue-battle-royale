// Formas de subir: escaleras de mano y contenedores, instanciados (3 draw calls para todo el mapa).
// Escaleras: las barandas son una geometría de 1 m de alto que cada instancia estira hasta topY + manijas; los
// peldaños son otra InstancedMesh con una instancia cada 0,3 m (así no se estiran con la altura).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash01 } from '../../shared/geo.ts';
import { DUMPSTER } from '../../shared/collision.ts';
import type { Prop } from '../../shared/mapdata.ts';

export const LADDER_RUNG_STEP = 0.3;
/** Entre ejes de las barandas (el volumen de la escalera mide 0,8: la visual entra holgada). */
const LADDER_W = 0.5;
const RAIL_T = 0.05;
const RUNG_T = 0.03;
/** El plano de la escalera queda a 5 cm de la pared. */
const WALL_GAP = 0.05;
/** Las barandas siguen por encima del techo para agarrarse al pasar (como las escaleras de verdad). */
const HANDLE = 0.8;
/** Franjas del contenedor: zócalo oscuro abajo, cuerpo pintado y tapa un poco más oscura arriba. */
const DUMPSTER_BASE = 0.15;
const DUMPSTER_LID = 0.12;
const PAINT = [new THREE.Color('#2f6b3c'), new THREE.Color('#2b5288')]; // verde (la mayoría) y azul

type Ladder = Extract<Prop, { kind: 'ladder' }>;
type Dumpster = Extract<Prop, { kind: 'dumpster' }>;

/** Caja de color liso: x × y × z, con la base en y0. */
function coloredBox(x: number, y: number, z: number, y0: number, color: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x, y, z);
  g.translate(0, y0 + y / 2, 0);
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

/** Peldaño entre barandas: solo arriba, abajo y el frente (las puntas quedan en las barandas y atrás está la pared, a
 *  centímetros). Son ~11 000 peldaños: cada cara de más son 22 000 triángulos. */
function rungGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(LADDER_W, RUNG_T, RUNG_T);
  g.setIndex(Array.from(g.index!.array).slice(12, 30)); // orden de BoxGeometry: +x, −x, +y, −y, +z, −z
  return g;
}

function dumpsterGeometry(): THREE.BufferGeometry {
  const { length: l, depth: d, height: h } = DUMPSTER;
  return merge([
    coloredBox(l, DUMPSTER_BASE, d, 0, new THREE.Color(0.22, 0.22, 0.22)),
    coloredBox(l, h - DUMPSTER_BASE - DUMPSTER_LID, d, DUMPSTER_BASE, new THREE.Color(1, 1, 1)),
    coloredBox(l, DUMPSTER_LID, d, h - DUMPSTER_LID, new THREE.Color(0.72, 0.72, 0.72)),
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

export function buildClimbProps(props: Prop[]): THREE.InstancedMesh[] {
  const ladders = props.filter((p): p is Ladder => p.kind === 'ladder');
  const dumpsters = props.filter((p): p is Dumpster => p.kind === 'dumpster');
  const out: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();

  if (ladders.length > 0) {
    const steel = new THREE.MeshLambertMaterial({ color: '#858b90' });
    const rails = new THREE.InstancedMesh(railsGeometry(), steel, ladders.length);
    rails.name = 'ladderRails';
    const rungsPer = ladders.map((l) => Math.floor(l.topY / LADDER_RUNG_STEP + 1e-9));
    const rungs = new THREE.InstancedMesh(rungGeometry(), steel, rungsPer.reduce((a, b) => a + b, 0));
    rungs.name = 'ladderRungs';
    let k = 0;
    ladders.forEach((l, i) => {
      const [x, z] = ladderFrame(l, q);
      rails.setMatrixAt(i, m.compose(p.set(x, 0, z), q, s.set(1, l.topY + HANDLE, 1)));
      for (let r = 1; r <= rungsPer[i]; r++) rungs.setMatrixAt(k++, m.compose(p.set(x, r * LADDER_RUNG_STEP, z), q, s.set(1, 1, 1)));
    });
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
    out.push(mesh);
  }
  return out;
}
