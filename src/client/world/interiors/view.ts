// Qué interiores se dibujan en cada cuadro (§2.6, D7) y sus tapas (D6). Todos se arman al empezar (y de nuevo si la
// calidad cambia el detalle) en un grupo escondido cada uno; en cada cuadro se muestran los que tocan y se esconden sus
// tapas, y las de los demás quedan a la vista: de lejos la fachada queda igual que sin interiores.
import * as THREE from 'three';
import { pointInPolygon } from '../../../shared/geo.ts';
import type { Vec2 } from '../../../shared/geo.ts';
import type { Interior } from '../../../shared/interiors/types.ts';
import { QUALITY } from '../../render/quality.ts';
import type { Quality } from '../../render/quality.ts';
import type { InteriorKey, WorldMaterials } from '../types.ts';
import { buildInterior3D } from './build.ts';

export interface InteriorViews {
  readonly group: THREE.Group;
  /** Adentro de un interior (la cámara sobre su planta o un patio, por debajo del techo): ese solo. Si no: los que están
   *  a < radius de la cámara (a su caja) y con la caja en el frustum, del más cercano al más lejano, hasta `max` y
   *  mientras la suma de sus mallas entre en `calls` (D7, H3). Las tapas de los que no se dibujan quedan visibles; las
   *  de los que se dibujan, no. */
  update(camera: THREE.PerspectiveCamera): void;
  /** Las tapas que llegan después (las de las fotos). */
  addTapas(placeId: string, meshes: THREE.Mesh[]): void;
  setQuality(q: Quality): void;
  drawn(): string[]; // placeIds del último update
  /** Si en el último update la cámara estaba adentro de un interior (la misma regla: para la adaptación del ojo). */
  inside(): boolean;
  dispose(): void;
}

/** `meshes`: los draw calls del interior armado. */
interface View { i: Interior; group: THREE.Group; box: THREE.Box3; tapas: THREE.Mesh[]; top: number; meshes: number }

const isKey = (k: string): k is InteriorKey => k.startsWith('in_');

/** Libera lo propio de un interior armado: sus geometrías y los carteles (textura y material); los materiales de
 *  WorldMaterials no, son de todos. */
function release(group: THREE.Group): void {
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    if (o instanceof THREE.InstancedMesh) o.dispose();
    if (o.name.startsWith('labels:')) {
      const m = o.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    }
  });
}

export function createInteriorViews(interiors: Interior[], m: WorldMaterials, q: Quality, tapas: Map<string, THREE.Mesh[]>): InteriorViews {
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
    return { i, group: hidden, box: new THREE.Box3(), tapas: [...(tapas.get(i.placeId) ?? [])], top: Math.max(0, ...i.blocks.filter((b) => !b.out).map((b) => b.y1)), meshes: 0 };
  });
  /** Arma (o vuelve a armar) un interior con los materiales de ahora, y queda a la vista si lo estaba. */
  const build = (v: View): void => {
    const built = buildInterior3D(v.i, current(), quality);
    built.group.visible = v.group.visible;
    group.remove(v.group);
    release(v.group);
    v.group = built.group;
    v.box = built.box;
    v.meshes = 0;
    built.group.traverse((o) => { if (o instanceof THREE.Mesh) v.meshes++; });
    group.add(v.group);
  };
  for (const v of views) build(v);

  const show = (v: View, on: boolean): void => {
    v.group.visible = on;
    for (const t of v.tapas) t.visible = !on;
  };
  const inside = (v: View, p: THREE.Vector3): boolean => {
    const xz: Vec2 = [p.x, p.z];
    return p.y < v.top && (pointInPolygon(xz, v.i.footprint) || v.i.patios.some((r) => pointInPolygon(xz, r)));
  };
  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  const eye = new THREE.Vector3();

  return {
    group,
    update(camera) {
      camera.updateMatrixWorld();
      camera.getWorldPosition(eye);
      frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const here = views.find((v) => inside(v, eye));
      within = here !== undefined;
      if (here) last = [here];
      else {
        // del más cercano al más lejano, mientras entren en `max` y la suma de sus mallas en `calls` (H3)
        last = [];
        let calls = 0;
        const near = views
          .map((v) => ({ v, d: v.box.distanceToPoint(eye) }))
          .filter(({ v, d }) => d < preset.radius && frustum.intersectsBox(v.box))
          .sort((a, b) => a.d - b.d);
        for (const { v } of near) {
          if (last.length >= preset.max || calls + v.meshes > preset.calls) break;
          last.push(v);
          calls += v.meshes;
        }
      }
      for (const v of views) show(v, last.includes(v));
    },
    addTapas(placeId, meshes) {
      const v = views.find((x) => x.i.placeId === placeId);
      if (!v) return; // un lugar sin interior: sus tapas quedan como están, a la vista
      v.tapas.push(...meshes);
      for (const t of meshes) t.visible = !last.includes(v);
    },
    setQuality(next) {
      const detail = preset.detail;
      quality = next;
      preset = QUALITY[next].interiors;
      if (preset.detail !== detail) for (const v of views) build(v);
    },
    drawn: () => last.map((v) => v.i.placeId),
    inside: () => within,
    dispose() {
      for (const v of views) release(v.group);
      empty.dispose();
      group.clear();
      last = [];
      within = false;
    },
  };
}
