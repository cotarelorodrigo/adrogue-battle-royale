// Qué interiores se dibujan en cada cuadro (§2.6, D7) y sus tapas (D6). Todos se arman al empezar en un grupo escondido
// cada uno, y de nuevo en cada cambio de calidad: el tope de mallas es de la calidad (media y alta, con el mismo detalle,
// compactan distinto) y lo horneado se rehace solo si cambia el detalle. En cada cuadro se muestran los que tocan y se
// esconden sus tapas, y las de los demás quedan a la vista: de lejos la fachada queda igual que sin interiores.
import * as THREE from 'three';
import { pointInPolygon } from '../../../shared/geo.ts';
import type { Vec2 } from '../../../shared/geo.ts';
import type { Interior } from '../../../shared/interiors/types.ts';
import { QUALITY } from '../../render/quality.ts';
import type { Quality } from '../../render/quality.ts';
import type { InteriorKey, WorldMaterials } from '../types.ts';
import { bakeInterior, compactInterior, disposeBaked } from './build.ts';
import type { BakedInterior, InteriorPart } from './build.ts';
import { createOutsideCull, portalInView } from './portals.ts';
import type { PortalSet } from './portals.ts';

export interface InteriorViews {
  readonly group: THREE.Group;
  /** Adentro de un interior (la cámara sobre su planta o un patio, por debajo de lo más alto que tiene): ese solo;
   *  parada en un patio (al aire libre), de sus partes (el edificio y el patio) solo las que la cámara ve. Si no: los
   *  que están a < radius de la cámara (a su caja) y con la caja en el frustum, del más cercano al más lejano, hasta
   *  `max`; uno cuyas mallas no entran en lo que queda de `calls` se saltea y se sigue con los de más lejos (D7, H3, I1
   *  de la revisión final). Las tapas de los que no se dibujan quedan visibles; las de los que se dibujan, no. */
  update(camera: THREE.PerspectiveCamera): void;
  /** Las tapas que llegan después (las de las fotos). */
  addTapas(placeId: string, meshes: THREE.Mesh[]): void;
  /** Lo de afuera (chunks, árboles, carteles…) que se recorta con la cámara bajo techo: de eso se dibuja solo lo que se
   *  ve por las aberturas del interior (sus portales, portals.ts); lo demás sigue dando sombra. */
  cullOutside(objects: THREE.Object3D[]): void;
  /** Con lo del último update: si de afuera se ve algo de `s` (bajo techo, por las aberturas; si no, siempre). */
  outsideSees(s: THREE.Sphere): boolean;
  setQuality(q: Quality): void;
  drawn(): string[]; // placeIds del último update
  /** Si en el último update la cámara estaba bajo techo en un interior: sobre su planta (no en un patio) y por debajo
   *  de su techo (no en la terraza, ni agachado). Para la adaptación del ojo y para recortar lo de afuera. */
  inside(): boolean;
  dispose(): void;
}

/** `meshes`: los draw calls del interior armado; `parts`: el edificio y el patio (con uno solo, es el grupo mismo);
 *  `top`: lo más alto del interior (hasta ahí se está en él); `roof`: su techo (hasta ahí se está bajo techo); `above`:
 *  tiene terraza o algo arriba del techo (el lucernario de la Casa), que se ve de afuera sin aberturas; `baked`: lo
 *  horneado con el detalle de ahora (null hasta el primer armado). */
interface View {
  i: Interior; group: THREE.Group; box: THREE.Box3; parts: InteriorPart[]; tapas: THREE.Mesh[]; top: number; roof: number; meshes: number; above: boolean;
  baked: BakedInterior | null;
}

/**
 * Si la cámara puede ver algo del prisma de una parte (su envolvente en planta, de y0 a y1): no, si un plano del frustum
 * deja todas las esquinas del prisma afuera o si una cara del prisma (el piso, el techo o un costado) deja afuera las
 * ocho esquinas del frustum. La caja alineada a los ejes no alcanza: la de un edificio girado (el Guernica, 36°) se
 * come la vereda de enfrente y el balcón. Sin los ejes de las aristas cruzadas, a veces dice que sí cuando no; nunca al
 * revés.
 */
const probe = new THREE.Vector3();
function sees(frustum: THREE.Frustum, corners: THREE.Vector3[], p: InteriorPart): boolean {
  for (const pl of frustum.planes) {
    if (p.hull.every(([x, z]) => pl.distanceToPoint(probe.set(x, p.y0, z)) < 0 && pl.distanceToPoint(probe.set(x, p.y1, z)) < 0)) return false;
  }
  if (corners.every((c) => c.y > p.y1) || corners.every((c) => c.y < p.y0)) return false;
  const n = p.hull.length;
  const [cx, cz] = [p.hull.reduce((t, h) => t + h[0], 0) / n, p.hull.reduce((t, h) => t + h[1], 0) / n];
  for (let k = 0; k < n; k++) {
    const [a, b] = [p.hull[k], p.hull[(k + 1) % n]];
    let [nx, nz] = [b[1] - a[1], a[0] - b[0]];
    if (nx * (cx - a[0]) + nz * (cz - a[1]) > 0) [nx, nz] = [-nx, -nz]; // hacia afuera
    if (corners.every((c) => nx * (c.x - a[0]) + nz * (c.z - a[1]) > 0)) return false;
  }
  return true;
}

const isKey = (k: string): k is InteriorKey => k.startsWith('in_');

/** Libera lo propio de un interior armado: sus geometrías (salvo las de lo horneado, `baked`, que siguen para la próxima
 *  compactación) y los carteles (textura y material); los materiales de WorldMaterials no, son de todos. */
function release(group: THREE.Group, baked: BakedInterior | null): void {
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (!baked?.shared.has(o.geometry)) o.geometry.dispose();
    if (o instanceof THREE.InstancedMesh) o.dispose();
    if (o.name.startsWith('labels:')) {
      const m = o.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    }
  });
}

/** `portals`: los de cada interior (por placeId); uno sin portales no recorta lo de afuera. */
export function createInteriorViews(interiors: Interior[], m: WorldMaterials, q: Quality, tapas: Map<string, THREE.Mesh[]>,
  portals: ReadonlyMap<string, PortalSet> = new Map()): InteriorViews {
  const group = new THREE.Group();
  group.name = 'interiores';
  // Una malla escondida por material de interior, con su nombre: scene.setMaterials se las cambia como a todas al
  // cambiar la calidad, y de acá salen los materiales de lo que se arma después (nunca uno ya liberado).
  const empty = new THREE.BufferGeometry();
  const holders = (Object.keys(m) as (keyof WorldMaterials)[]).filter(isKey).map((key) => {
    const h = new THREE.Mesh(empty, m[key]);
    h.name = key;
    h.visible = false;
    group.add(h);
    return h;
  });
  const current = (): Pick<WorldMaterials, InteriorKey> =>
    Object.fromEntries(holders.map((h) => [h.name, h.material as THREE.Material])) as Pick<WorldMaterials, InteriorKey>;

  let preset = QUALITY[q].interiors;
  let quality = q;
  let last: View[] = [];
  let within = false;
  const views: View[] = interiors.map((i) => {
    const hidden = new THREE.Group();
    hidden.visible = false;
    // lo de arriba del techo (`sky`: el lucernario y su estructura) no cuenta: parado encima no se está adentro
    const top = Math.max(0, ...i.blocks.filter((b) => !b.out && !b.sky).map((b) => b.y1));
    // el techo: el tope de las losas (el bloque cerrado o el techo, que llegan al alto del edificio). Las barandas, los
    // muebles y la escalera de la terraza quedan arriba: ahí se está en el interior, pero al aire libre (m2)
    const roof = Math.max(0, ...i.blocks.filter((b) => b.role === 'losa').map((b) => b.y1));
    const above = i.terrace || i.blocks.some((b) => b.sky && !b.out) || i.panes.some((p) => p.sky && !p.out);
    return { i, group: hidden, box: new THREE.Box3(), parts: [], tapas: [...(tapas.get(i.placeId) ?? [])], top, roof, meshes: 0, above, baked: null };
  });
  /** Arma (o vuelve a armar) un interior con los materiales y el tope de mallas de ahora, y queda a la vista si lo
   *  estaba. Hornea solo si no hay nada horneado con el detalle de ahora; lo horneado de antes, con otro detalle, se
   *  libera. */
  const build = (v: View): void => {
    const old = v.baked;
    const baked = old?.detail === preset.detail ? old : bakeInterior(v.i, preset.detail);
    const built = compactInterior(baked, current(), quality);
    built.group.visible = v.group.visible;
    group.remove(v.group);
    release(v.group, old);
    if (old && old !== baked) disposeBaked(old);
    v.baked = baked;
    v.group = built.group;
    v.box = built.box;
    v.parts = built.parts;
    v.meshes = 0;
    built.group.traverse((o) => { if (o instanceof THREE.Mesh) v.meshes++; });
    group.add(v.group);
  };
  for (const v of views) build(v);

  /** `building`: si se dibuja su edificio (sus tapas, si no). */
  const show = (v: View, on: boolean, building = on): void => {
    v.group.visible = on;
    for (const t of v.tapas) t.visible = !(on && building);
  };
  /** De afuera: si lo de adentro del edificio se ve por alguna abertura (sin portales, un interior de prueba: sí). */
  const facing = (v: View): boolean => {
    const set = portals.get(v.i.placeId);
    return !set || v.above || set.portals.some((p) => portalInView(p, eye, frustum));
  };
  const inside = (v: View, p: THREE.Vector3): boolean => {
    const xz: Vec2 = [p.x, p.z];
    return p.y < v.top && (pointInPolygon(xz, v.i.footprint) || v.i.patios.some((r) => pointInPolygon(xz, r)));
  };
  const outside = createOutsideCull();
  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  const eye = new THREE.Vector3();
  /** Las ocho esquinas del frustum de la cámara, en el mundo. */
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  const cornersOf = (camera: THREE.PerspectiveCamera): THREE.Vector3[] =>
    corners.map((c, k) => c.set(k & 1 ? 1 : -1, k & 2 ? 1 : -1, k & 4 ? 1 : -1).unproject(camera));

  return {
    group,
    update(camera) {
      camera.updateMatrixWorld();
      camera.getWorldPosition(eye);
      frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const here = views.find((v) => inside(v, eye));
      // bajo techo: sobre la planta y por debajo del techo. Es el único criterio, para la exposición de adentro y para
      // recortar lo de afuera: en un patio, sobre la terraza (aunque agachado, con el ojo entre las barandas) o arriba
      // del techo se está al sol (m2 de la revisión final)
      within = here !== undefined && eye.y < here.roof && pointInPolygon([eye.x, eye.z], here.i.footprint);
      if (here) last = [here];
      else {
        // del más cercano al más lejano, hasta `max`; uno que no entra en lo que queda de `calls` se saltea (H3, I1)
        last = [];
        let calls = 0;
        // de afuera, un interior sin patio que no muestra ninguna abertura no se ve: no se elige (T11b)
        const near = views
          .map((v) => ({ v, d: v.box.distanceToPoint(eye) }))
          .filter(({ v, d }) => d < preset.radius && frustum.intersectsBox(v.box) && (v.parts.length > 1 || facing(v)))
          .sort((a, b) => a.d - b.d);
        for (const { v } of near) {
          if (last.length >= preset.max) break;
          if (calls + v.meshes > preset.calls) continue;
          last.push(v);
          calls += v.meshes;
        }
      }
      // en un patio, al aire libre (el balcón del Guernica, el patio del McDonald's): cada parte, si la cámara la ve
      const patio = here !== undefined && !within ? here : undefined;
      if (patio) cornersOf(camera);
      for (const v of views) {
        const on = last.includes(v);
        // de afuera (ni adentro ni en su patio), el edificio solo si se ve por alguna abertura; el patio, siempre
        const building = !on || here === v || v.parts.length === 1 || facing(v);
        if (v.parts.length > 1) {
          for (const p of v.parts) {
            p.group.visible = v === patio ? frustum.intersectsBox(p.box) && sees(frustum, corners, p) : p.name !== 'edificio' || building;
          }
        }
        show(v, on, v === patio || building);
      }
      // bajo techo, lo de afuera por las aberturas; en un patio, en la terraza o afuera, todo
      outside.update(camera, here && within ? portals.get(here.i.placeId) ?? null : null);
    },
    cullOutside: (objects) => outside.add(objects),
    outsideSees: (s) => outside.sees(s),
    addTapas(placeId, meshes) {
      const v = views.find((x) => x.i.placeId === placeId);
      if (!v) return; // un lugar sin interior: sus tapas quedan como están, a la vista
      v.tapas.push(...meshes);
      for (const t of meshes) t.visible = !last.includes(v);
    },
    setQuality(next) {
      if (next === quality) return;
      // cada calidad tiene su tope de mallas (y en baja, su compactación) y la anisotropía de los carteles: se compacta
      // de nuevo siempre. Entre media y alta (mismo detalle) no se hornea: sin esto, el McDonald's armado en alta (19
      // mallas) no entraba en el tope de 18 de media y desde la calle no se dibujaba más (I1 de la revisión final)
      quality = next;
      preset = QUALITY[next].interiors;
      for (const v of views) build(v);
    },
    drawn: () => last.map((v) => v.i.placeId),
    inside: () => within,
    dispose() {
      for (const v of views) {
        release(v.group, v.baked);
        if (v.baked) disposeBaked(v.baked);
        v.baked = null;
      }
      empty.dispose();
      group.clear();
      last = [];
      within = false;
    },
  };
}
