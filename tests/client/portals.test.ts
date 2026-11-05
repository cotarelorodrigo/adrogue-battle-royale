// El recorte de lo de afuera desde adentro (T11b, ítem 1): bajo techo, el mundo se ve solo por las aberturas y los
// huecos del techo. Con los 9 interiores del mapa real y un mundo de prueba (cajas alrededor de cada edificio y la de su
// chunk): mirando a una pared maciza no se dibuja nada de afuera; mirando a una vidriera o a una puerta, lo de enfrente
// sí; y no hay agujeros: todo lo que toca un rayo que sale del interior se dibuja.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CHUNK } from '../../src/client/world/chunks.ts';
import { createOutsideCull, interiorPortals, SHADOW_ONLY } from '../../src/client/world/interiors/portals.ts';
import type { PortalSet } from '../../src/client/world/interiors/portals.ts';
import { CollisionWorld } from '../../src/shared/collision.ts';
import type { Prism } from '../../src/shared/collision.ts';
import { pointInPolygon, signedAreaFromAbove } from '../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../src/shared/geo.ts';
import { buildInteriors } from '../../src/shared/interiors/index.ts';
import type { Interior } from '../../src/shared/interiors/types.ts';
import type { MapData } from '../../src/shared/mapdata.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const interiors = buildInteriors(map);
const byId = (id: string): Interior => interiors.find((i) => i.placeId === id)!;
const setOf = (i: Interior): PortalSet => interiorPortals(map.buildings.find((b) => b.id === i.buildingId)!,
  map.interiors.find((x) => x.placeId === i.placeId)!, i.roofHoles);

/** La cámara del juego (16:9, como en e2e) en `eye`, mirando a `to`. */
function camera(eye: Vec3, to: Vec3): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.15, 500);
  cam.position.set(...eye);
  cam.lookAt(...to);
  cam.updateMatrixWorld();
  return cam;
}
const SUN = new THREE.Layers();
SUN.enable(SHADOW_ONLY); // la de la cámara del sol: la 0 y SHADOW_ONLY
const drawn = (m: THREE.Mesh, cam: THREE.Camera): boolean => m.layers.test(cam.layers);

/** El mundo de prueba alrededor de `i`: cubos de 8 m cada 24 m en el suelo hasta 192 m, otros arriba (de 24 a 32 m)
 *  cada 48 m, y el chunk del edificio entero (como sus mallas: el edificio adentro). */
function world(i: Interior): THREE.Mesh[] {
  const [cx, cz] = i.footprint.reduce((t, p) => [t[0] + p[0] / i.footprint.length, t[1] + p[1] / i.footprint.length], [0, 0]);
  const out: THREE.Mesh[] = [];
  const cube = (x: number, y: number, z: number, s: number, h = s): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, h, s));
    m.position.set(x, y, z);
    m.updateMatrixWorld();
    out.push(m);
  };
  for (let a = -8; a <= 8; a++) for (let b = -8; b <= 8; b++) cube(cx + a * 24, 4, cz + b * 24, 8);
  for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) cube(cx + a * 48, 28, cz + b * 48, 8);
  const [ci, cj] = [Math.floor(cx / CHUNK), Math.floor(cz / CHUNK)];
  cube((ci + 0.5) * CHUNK, 15, (cj + 0.5) * CHUNK, CHUNK, 30);
  return out;
}

/** Los puntos de `i` bajo techo (sobre la planta, con el ojo a 1,6 m por debajo del techo del edificio). */
function eyesInside(i: Interior, roof: number): Vec3[] {
  return Object.values(i.marks).filter((p) => pointInPolygon([p[0], p[2]], i.footprint) && p[1] + 1.6 < roof)
    .map((p): Vec3 => [p[0], p[1] + 1.6, p[2]]);
}

test('mirando a una pared maciza desde adentro, lo de afuera no se dibuja (y sigue dando sombra)', () => {
  // el Banco Nación: todas sus aberturas en el frente; desde el salón, de espaldas a ellas
  const i = byId('banco-nacion');
  const set = setOf(i);
  const door = i.doors[0];
  const eye: Vec3 = [i.marks.salon[0], i.marks.salon[1] + 1.6, i.marks.salon[2]];
  const cam = camera(eye, [eye[0] - door.normal[0] * 10, eye[1], eye[2] - door.normal[1] * 10]);
  const meshes = world(i);
  const cull = createOutsideCull();
  cull.add(meshes);
  cull.update(cam, set);
  expect(meshes.filter((m) => drawn(m, cam)).length, 'las cajas que se dibujan').toBe(0);
  for (const m of meshes) expect(m.layers.test(SUN), 'la sombra').toBe(true);
  // lo mismo para lo que se elige por copia (los contenedores, near.ts): sees
  const behind = new THREE.Sphere(new THREE.Vector3(eye[0] - door.normal[0] * 30, 1, eye[2] - door.normal[1] * 30), 1.5);
  expect(cull.sees(behind), 'un contenedor detrás de la pared').toBe(false);
  // de vuelta afuera (sin set), todo
  cull.update(cam, null);
  expect(meshes.every((m) => drawn(m, cam))).toBe(true);
  expect(cull.sees(behind)).toBe(true);
});

describe('mirando a una vidriera o a una puerta desde adentro, lo de enfrente se dibuja', () => {
  for (const id of ['banco-nacion', 'mcdonalds', 'casa-de-la-cultura'] as const) {
    test(id, () => {
      const i = byId(id);
      const b = map.buildings.find((x) => x.id === i.buildingId)!;
      const input = map.interiors.find((x) => x.placeId === id)!;
      const set = setOf(i);
      const ccw = signedAreaFromAbove(b.footprint) > 0;
      const eyes = eyesInside(i, set.roof);
      const meshes = world(i);
      const cull = createOutsideCull();
      cull.add(meshes);
      for (const kind of ['vidrio', 'puerta'] as const) {
        const o = input.openings.find((x) => x.kind === kind)!;
        const [a, c] = [b.footprint[o.edge], b.footprint[(o.edge + 1) % b.footprint.length]];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const d: Vec2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
        const n: Vec2 = ccw ? [-d[1], d[0]] : [d[1], -d[0]];
        const s = (o.s0 + o.s1) / 2, y = (o.y0 + o.y1) / 2;
        const at: Vec3 = [a[0] + d[0] * s, y, a[1] + d[1] * s];
        // desde el punto de adentro más cerca, mirando al medio de la abertura
        const eye = eyes.sort((p, q) => Math.hypot(p[0] - at[0], p[2] - at[2]) - Math.hypot(q[0] - at[0], q[2] - at[2]))[0];
        const cam = camera(eye, at);
        cull.update(cam, set);
        const front = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4));
        front.position.set(at[0] + n[0] * 8, 2, at[2] + n[1] * 8);
        front.updateMatrixWorld();
        const probe = createOutsideCull();
        probe.add([front]);
        probe.update(cam, set);
        expect(drawn(front, cam), `${id}/${kind}: lo de enfrente`).toBe(true);
        expect(probe.sees(new THREE.Sphere(front.position.clone(), 1.5)), `${id}/${kind}: un contenedor enfrente`).toBe(true);
        // y algo de lo que está en el cuadro no se ve por ninguna abertura: no se dibuja
        const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
        const inView = meshes.filter((m) => frustum.intersectsObject(m));
        expect(inView.filter((m) => !drawn(m, cam)).length, `${id}/${kind}: lo del cuadro que se recorta (de ${inView.length})`).toBeGreaterThan(0);
      }
    });
  }
});

/** Lo que tapa desde adentro: los bloques del interior que se ven (con alguna cara), menos los de vidrio y los `out`, y
 *  el suelo bajo la planta (en el umbral de una puerta, entre la losa y la vereda, un rayo rasante pasa por debajo). */
function occluders(i: Interior): CollisionWorld {
  const prisms: Prism[] = i.blocks.filter((b) => !b.out && b.collide !== 'glass' && b.role !== 'vidrio' && (b.side || b.top || b.bottom))
    .map((b) => ({ polygon: b.polygon, minY: b.y0, maxY: b.y1 }));
  prisms.push({ polygon: i.footprint, minY: -1, maxY: 0 });
  const xs = i.footprint.map((p) => p[0]), zs = i.footprint.map((p) => p[1]);
  return new CollisionWorld(prisms, [], { minX: Math.min(...xs) - 50, maxX: Math.max(...xs) + 50, minZ: Math.min(...zs) - 50, maxZ: Math.max(...zs) + 50 });
}

/** Dónde sale del edificio un rayo desde adentro (`o`, `d` unitaria): donde cruza por primera vez una arista de la
 *  planta (entre el suelo y el techo) o el plano del techo. Lo de afuera que toque antes no se ve: está adentro del
 *  edificio, tapado por el interior (la cáscara de sombra, el suelo bajo la losa). */
function exitOf(fp: Vec2[], roof: number, o: THREE.Vector3, d: THREE.Vector3): number {
  let t = d.y > 0 ? (roof - o.y) / d.y : Infinity;
  for (let k = 0; k < fp.length; k++) {
    const [a, b] = [fp[k], fp[(k + 1) % fp.length]];
    const [ex, ez] = [b[0] - a[0], b[1] - a[1]];
    const den = d.x * ez - d.z * ex;
    if (Math.abs(den) < 1e-12) continue;
    const s = ((a[0] - o.x) * ez - (a[1] - o.z) * ex) / den; // a lo largo del rayo
    const w = ((a[0] - o.x) * d.z - (a[1] - o.z) * d.x) / den; // a lo largo de la arista
    if (s > 1e-6 && w >= 0 && w <= 1 && o.y + d.y * s >= 0 && o.y + d.y * s <= roof) t = Math.min(t, s);
  }
  return t;
}

test('sin agujeros: desde cada punto de adentro de los 9, lo que toca un rayo que sale del interior se dibuja', () => {
  const rows: string[] = [];
  let escapes = 0;
  for (const i of interiors) {
    const set = setOf(i);
    const solid = occluders(i);
    const meshes = world(i);
    const cull = createOutsideCull();
    cull.add(meshes);
    const boxes = meshes.map((m) => new THREE.Box3().setFromObject(m));
    let out = 0, culled = 0, inView = 0;
    for (const eye of eyesInside(i, set.roof)) {
      for (let k = 0; k < 8; k++) {
        for (const pitch of [-0.5, 0, 0.5]) {
          const yaw = (k * Math.PI) / 4;
          const cam = camera(eye, [eye[0] - Math.sin(yaw) * Math.cos(pitch), eye[1] + Math.sin(pitch), eye[2] - Math.cos(yaw) * Math.cos(pitch)]);
          cull.update(cam, set);
          const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
          for (const m of meshes) if (frustum.intersectsObject(m)) { inView++; if (!drawn(m, cam)) culled++; }
          const ray = new THREE.Ray();
          const hit = new THREE.Vector3();
          for (let u = 0; u < 24; u++) {
            for (let v = 0; v < 14; v++) {
              const ndc = new THREE.Vector3(-0.98 + (1.96 * u) / 23, -0.98 + (1.96 * v) / 13, 0.5).unproject(cam);
              const dir = ndc.sub(cam.position).normalize();
              if (solid.raycast(eye, [dir.x, dir.y, dir.z], 150)) continue; // pega adentro
              out++;
              // desde donde sale del edificio
              const t = exitOf(i.footprint, set.roof, cam.position, dir);
              expect(t, `${i.placeId}: un rayo que no pega adentro (desde ${eye.map((x) => x.toFixed(2))}, dir ${dir.toArray().map((x) => x.toFixed(3))}) sale del edificio`).toBeLessThan(150);
              ray.set(cam.position.clone().addScaledVector(dir, t), dir);
              for (let j = 0; j < meshes.length; j++) {
                if (!ray.intersectBox(boxes[j], hit) || hit.distanceTo(cam.position) > cam.far) continue;
                expect(drawn(meshes[j], cam), `${i.placeId}: un rayo desde ${eye.map((x) => x.toFixed(1))} (yaw ${yaw.toFixed(2)}, pitch ${pitch}) sale (dir ${dir.toArray().map((x) => x.toFixed(3))}) y toca la caja ${j}`).toBe(true);
              }
            }
          }
        }
      }
    }
    escapes += out;
    rows.push(`${i.placeId.padEnd(20)} ${String(eyesInside(i, set.roof).length).padStart(2)} puntos, ${String(out).padStart(5)} rayos que salen, ${culled}/${inView} cajas del cuadro recortadas`);
  }
  console.log(rows.join('\n'));
  expect(escapes, 'rayos que salen por las aberturas').toBeGreaterThan(1000);
}, 120_000);
