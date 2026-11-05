// Lo de afuera visto desde adentro (T11b): bajo techo, el mundo se ve solo por las aberturas del edificio (las de su
// InteriorInput, en la planta guardada) y por los huecos que el interior le abre al techo. Cada una es un portal: desde
// el ojo, el portal y los planos que pasan por el ojo y cada arista arman un frustum (recortado por el de la cámara), y
// de afuera se dibuja solo lo que toca alguno. Lo demás sale de la pasada principal con la capa SHADOW_ONLY: la cámara
// del sol la ve, así las sombras que se ven por una vidriera (la de un árbol en la vereda) no cambian.
//
// Las paredes de afuera del interior van de la planta a WALL_OUT hacia adentro, con las jambas de cada abertura: un rayo
// que sale por una abertura cruza el plano de la planta adentro de su rectángulo, y por un hueco del techo, el plano del
// techo adentro del hueco. Por eso alcanza con portales en esos planos (tests/client/portals.test.ts lo comprueba con
// rayos desde cada punto de adentro de los 9).
import * as THREE from 'three';
import { signedAreaFromAbove } from '../../../shared/geo.ts';
import type { Vec2 } from '../../../shared/geo.ts';
import { LEVEL_H } from '../../../shared/interiors/openings.ts';
import type { Building, InteriorInput } from '../../../shared/mapdata.ts';
import { convexHull } from './build.ts';

/** La capa de lo que solo da sombra: la cámara del sol la ve (scene.ts se la prende) y la del jugador no. */
export const SHADOW_ONLY = 1;
/** Con el ojo a menos de esto (m) del plano de un portal (parado en el umbral), no se recorta nada. */
const ON_PLANE = 0.01;

/** Un portal: un polígono convexo y plano (mundo) y la normal de su plano hacia afuera, del lado de lo que se ve. */
export interface Portal { corners: THREE.Vector3[]; normal: THREE.Vector3 }
/** Los portales de un interior y la altura de su techo: por encima (en la terraza, en el techo) no se recorta nada. */
export interface PortalSet { portals: Portal[]; roof: number }

/**
 * Los portales de un interior: por cada arista de la planta guardada y cada nivel (LEVEL_H), el rectángulo que junta sus
 * aberturas (en el plano de la arista, con la normal de afuera como en doorsOf); y por cada hueco del techo, su
 * envolvente convexa a la altura del techo, con la normal para arriba.
 */
export function interiorPortals(b: Building, input: InteriorInput, roofHoles: Vec2[][]): PortalSet {
  const fp = b.footprint;
  const ccw = signedAreaFromAbove(fp) > 0;
  const groups = new Map<string, { edge: number; s0: number; s1: number; y0: number; y1: number }>();
  for (const o of input.openings) {
    const key = `${o.edge}:${Math.round(o.y0 / LEVEL_H)}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { edge: o.edge, s0: o.s0, s1: o.s1, y0: o.y0, y1: o.y1 });
    else Object.assign(g, { s0: Math.min(g.s0, o.s0), s1: Math.max(g.s1, o.s1), y0: Math.min(g.y0, o.y0), y1: Math.max(g.y1, o.y1) });
  }
  const portals: Portal[] = [...groups.values()].map(({ edge, s0, s1, y0, y1 }) => {
    const [a, c] = [fp[edge], fp[(edge + 1) % fp.length]];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    const d: Vec2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
    const n: Vec2 = ccw ? [-d[1], d[0]] : [d[1], -d[0]];
    const at = (s: number, y: number): THREE.Vector3 => new THREE.Vector3(a[0] + d[0] * s, y, a[1] + d[1] * s);
    return { corners: [at(s0, y0), at(s1, y0), at(s1, y1), at(s0, y1)], normal: new THREE.Vector3(n[0], 0, n[1]) };
  });
  for (const h of roofHoles) {
    portals.push({ corners: convexHull(h).map(([x, z]) => new THREE.Vector3(x, b.height, z)), normal: new THREE.Vector3(0, 1, 0) });
  }
  return { portals, roof: b.height };
}

export interface OutsideCull {
  /** Las mallas de `objects` (y de sus hijos) que se recortan desde adentro, con su caja en el mundo de ahora. */
  add(objects: THREE.Object3D[]): void;
  /** Con `set`, la cámara adentro: cada malla se dibuja solo si su caja toca lo que se ve por alguna abertura; lo demás
   *  sale de la pasada principal y sigue dando sombra (SHADOW_ONLY). Sin `set`, todas. */
  update(camera: THREE.PerspectiveCamera, set: PortalSet | null): void;
  /** Con lo del último update: si se ve algo de `s` (sin recorte, siempre). Para lo que se elige por copia (near.ts). */
  sees(s: THREE.Sphere): boolean;
}

/** La caja en el mundo de una malla; la de una InstancedMesh, con todas sus copias (aunque `count` muestre menos). */
function worldBox(m: THREE.Mesh): THREE.Box3 {
  const g = m.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const box = new THREE.Box3();
  if (m instanceof THREE.InstancedMesh) {
    const one = new THREE.Box3(), mat = new THREE.Matrix4();
    for (let k = 0; k < m.instanceMatrix.count; k++) {
      m.getMatrixAt(k, mat);
      box.union(one.copy(g.boundingBox!).applyMatrix4(mat));
    }
  } else box.copy(g.boundingBox!);
  return box.applyMatrix4(m.matrixWorld);
}

/** Si la caja toca la intersección de los semiespacios de `planes` (con el vértice más adentro de cada plano: a veces
 *  dice que sí cuando no, nunca al revés). */
const pv = new THREE.Vector3();
function touches(planes: readonly THREE.Plane[], box: THREE.Box3): boolean {
  for (const p of planes) {
    pv.set(p.normal.x > 0 ? box.max.x : box.min.x, p.normal.y > 0 ? box.max.y : box.min.y, p.normal.z > 0 ? box.max.z : box.min.z);
    if (p.distanceToPoint(pv) < 0) return false;
  }
  return true;
}

/** `poly` recortado al semiespacio de `plane` (Sutherland–Hodgman). */
function clip(poly: THREE.Vector3[], plane: THREE.Plane): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let k = 0; k < poly.length; k++) {
    const [p, q] = [poly[k], poly[(k + 1) % poly.length]];
    const [dp, dq] = [plane.distanceToPoint(p), plane.distanceToPoint(q)];
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) out.push(p.clone().lerp(q, dp / (dp - dq)));
  }
  return out;
}

/** Si desde `eye` (afuera) se ve algo por el portal: el ojo del lado de afuera de su plano y el portal en el cuadro (los
 *  costados del frustum, planos 0 a 3 de THREE.Frustum, pasan por el ojo). Sin oclusión: a veces dice que sí cuando no. */
export function portalInView(p: Portal, eye: THREE.Vector3, frustum: THREE.Frustum): boolean {
  if (p.normal.dot(eye) - p.normal.dot(p.corners[0]) <= 0) return false;
  let poly = p.corners;
  for (let k = 0; k < 4 && poly.length >= 3; k++) poly = clip(poly, frustum.planes[k]);
  return poly.length >= 3;
}

export function createOutsideCull(): OutsideCull {
  const meshes: { mesh: THREE.Mesh; box: THREE.Box3 }[] = [];
  let active = false;
  /** Los frustums de los portales del último update; null sin recorte. */
  let current: THREE.Plane[][] | null = null;
  const probeBox = new THREE.Box3();
  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  const eye = new THREE.Vector3();

  /** Los frustums de los portales que el ojo ve de adentro; null si el ojo está en el plano de uno (no se recorta). */
  function frusta(set: PortalSet): THREE.Plane[][] | null {
    const out: THREE.Plane[][] = [];
    for (const { corners, normal } of set.portals) {
      const side = normal.dot(eye) - normal.dot(corners[0]);
      if (Math.abs(side) < ON_PLANE) return null;
      if (side > 0) continue; // del lado de afuera de su plano: por ahí no se ve para afuera
      // el portal recortado por los costados del frustum de la cámara (pasan por el ojo): lo que se ve de él
      let poly = corners;
      for (let k = 0; k < 4 && poly.length >= 3; k++) poly = clip(poly, frustum.planes[k]);
      if (poly.length < 3) continue;
      const g = poly.reduce((t, p) => t.add(p), new THREE.Vector3()).divideScalar(poly.length);
      const planes = [...frustum.planes, new THREE.Plane().setFromNormalAndCoplanarPoint(normal, corners[0])];
      for (let k = 0; k < poly.length; k++) {
        const pl = new THREE.Plane().setFromCoplanarPoints(eye, poly[k], poly[(k + 1) % poly.length]);
        if (!(pl.normal.lengthSq() > 0.5)) continue; // degenerado (dos esquinas iguales tras recortar)
        if (pl.distanceToPoint(g) < 0) pl.negate();
        planes.push(pl);
      }
      out.push(planes);
    }
    return out;
  }

  const restore = (): void => {
    for (const { mesh } of meshes) mesh.layers.set(0);
    active = false;
    current = null;
  };

  return {
    add(objects) {
      for (const o of objects) {
        o.updateWorldMatrix(true, true);
        o.traverse((x) => { if (x instanceof THREE.Mesh) meshes.push({ mesh: x, box: worldBox(x) }); });
      }
      if (active) for (const { mesh } of meshes) mesh.layers.set(0); // las nuevas, a la vista hasta el próximo update
    },
    update(camera, set) {
      if (!set) {
        if (active) restore();
        return;
      }
      camera.updateMatrixWorld();
      camera.getWorldPosition(eye);
      frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const fs = frusta(set);
      if (!fs) {
        if (active) restore();
        return;
      }
      for (const { mesh, box } of meshes) {
        const seen = fs.some((planes) => touches(planes, box));
        mesh.layers.set(seen ? 0 : SHADOW_ONLY);
      }
      active = true;
      current = fs;
    },
    sees(s) {
      if (!current) return true;
      probeBox.min.copy(s.center).subScalar(s.radius);
      probeBox.max.copy(s.center).addScalar(s.radius);
      return current.some((planes) => touches(planes, probeBox));
    },
  };
}
