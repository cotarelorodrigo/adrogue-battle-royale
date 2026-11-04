// @vitest-environment jsdom
// Los 9 interiores del mapa real, armados para dibujar en cada calidad: a lo sumo 20 mallas (draw calls) cada uno
// (§2.6) y no más que el tope de interiores de la calidad (H3). Imprime los triángulos y lo que tarda armarlo (con el
// horneado) de cada uno, para seguir el costo a medida que las tareas suman planes y muebles.
// Y sus edificios: los huecos de las aberturas con sus tapas (H4) y la sombra sin manchas de sol por las aberturas (H1).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { QUALITY } from '../../src/client/render/quality.ts';
import { SUN_DIR } from '../../src/client/render/scene.ts';
import { buildChunks } from '../../src/client/world/chunks.ts';
import { extrudeBuilding } from '../../src/client/world/geometry.ts';
import { buildInterior3D, MAX_MESHES } from '../../src/client/world/interiors/build.ts';
import type { InteriorKey, WorldMaterials } from '../../src/client/world/types.ts';
import { signedAreaFromAbove } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import { buildInteriors } from '../../src/shared/interiors/index.ts';
import type { MapData } from '../../src/shared/mapdata.ts';
import { stubCanvas } from './canvas-stub.ts';

beforeEach(() => stubCanvas());
afterEach(() => vi.restoreAllMocks());

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const interiors = buildInteriors(map);
const KEYS = ['in_liso', 'in_porcelanato', 'in_madera', 'in_machimbre', 'in_baldosa', 'in_ceramico', 'in_tela', 'in_metal',
  'in_ladrillo', 'in_vidrio', 'in_luz', 'in_mueble'] as const satisfies readonly InteriorKey[];
const materials = Object.fromEntries(KEYS.map((k) => [k, new THREE.MeshBasicMaterial({ name: k })])) as unknown as Pick<WorldMaterials, InteriorKey>;

const trianglesOf = (m: THREE.Mesh): number => {
  const per = (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3;
  return m instanceof THREE.InstancedMesh ? per * m.count : per;
};

test('el mapa tiene los 9 interiores', () => {
  expect(interiors).toHaveLength(9);
});

for (const q of ['baja', 'media', 'alta'] as const) {
  test(`${q}: cada interior en ≤ ${MAX_MESHES} mallas y en interiors.calls`, () => {
    const rows: string[] = [];
    let total = 0;
    for (const i of interiors) {
      const meshes: THREE.Mesh[] = [];
      const t0 = performance.now();
      // una copia: el horneado prepara cada interior una vez (y la guarda), así se mide entero
      buildInterior3D({ ...i }, materials, q).group.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
      const ms = performance.now() - t0;
      total += ms;
      const tris = meshes.reduce((s, m) => s + trianglesOf(m), 0);
      rows.push(`${q.padEnd(5)} ${i.placeId.padEnd(20)} ${String(meshes.length).padStart(2)} mallas ${String(tris).padStart(7)} triángulos ${ms.toFixed(0).padStart(4)} ms`);
      expect(meshes.length, `${q}/${i.placeId}`).toBeLessThanOrEqual(Math.min(MAX_MESHES, QUALITY[q].interiors.calls));
    }
    // el armado con el horneado (N4), para seguirlo a medida que las tareas suman lámparas y tabiques: sin tope, que
    // con la máquina cargada varía
    rows.push(`${q.padEnd(5)} los ${interiors.length}, armados con el horneado: ${total.toFixed(0)} ms`);
    console.log(rows.join('\n'));
  });
}

function triangles(g: THREE.BufferGeometry): THREE.Triangle[] {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const idx = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, k) => k);
  const v = (k: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(p, k);
  const out: THREE.Triangle[] = [];
  for (let k = 0; k < idx.length; k += 3) out.push(new THREE.Triangle(v(idx[k]), v(idx[k + 1]), v(idx[k + 2])));
  return out;
}
const areaOf = (ts: THREE.Triangle[]): number => ts.reduce((s, t) => s + t.getArea(), 0);

/** La arista `e` de la planta guardada `fp`: su punta, su dirección, su largo y la normal hacia afuera. */
function edge(fp: Vec2[], e: number): { a: Vec2; d: Vec2; len: number; n: Vec2 } {
  const [a, q] = [fp[e], fp[(e + 1) % fp.length]];
  const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
  const d: Vec2 = [(q[0] - a[0]) / len, (q[1] - a[1]) / len];
  return { a, d, len, n: signedAreaFromAbove(fp) > 0 ? [-d[1], d[0]] : [d[1], -d[0]] };
}

describe('los edificios de los interiores (H4)', () => {
  // el chequeo de la revisión: ninguna pared tapa una abertura, cada abertura tiene su tapa y las tapas suman su área
  for (const inp of map.interiors) {
    test(`${inp.placeId}: huecos y tapas en el mapa real`, () => {
      const b = map.buildings.find((x) => x.id === inp.buildingId)!;
      const e = extrudeBuilding(b, inp.openings);
      const walls = [e.walls.ground, e.walls.upper, e.walls.front, ...e.walls.overrides.map((o) => o.geometry)].flatMap(triangles);
      const tapas = Object.values(e.tapas).flatMap((g) => triangles(g!));
      const hits = (ts: THREE.Triangle[], at: THREE.Vector3, out: THREE.Vector3): boolean => {
        const ray = new THREE.Ray(at.clone().addScaledVector(out, 1), out.clone().negate());
        return ts.some((t) => {
          const x = ray.intersectTriangle(t.a, t.b, t.c, false, new THREE.Vector3());
          return x !== null && x.distanceTo(ray.origin) < 2;
        });
      };
      const bad: string[] = [];
      for (const o of inp.openings) {
        const { a, d, n } = edge(b.footprint, o.edge);
        for (const f of [0.1, 0.5, 0.9]) {
          const s = o.s0 + (o.s1 - o.s0) * f;
          const at = new THREE.Vector3(a[0] + d[0] * s, (o.y0 + o.y1) / 2, a[1] + d[1] * s), out = new THREE.Vector3(n[0], 0, n[1]);
          if (hits(walls, at, out)) bad.push(`una pared tapa ${o.kind} de la arista ${o.edge} en ${f}`);
          if (!hits(tapas, at, out)) bad.push(`sin tapa ${o.kind} de la arista ${o.edge} en ${f}`);
        }
      }
      expect(bad).toEqual([]);
      const want = inp.openings.reduce((s, o) => s + (o.s1 - o.s0) * (Math.min(o.y1, b.height) - o.y0), 0);
      expect(Math.abs(areaOf(tapas) - want)).toBeLessThan(1e-4);
    });
  }
});

describe('sombra entera en el mapa real (H1)', () => {
  const WORLD = ['wallGroundHouse', 'wallGroundShop', 'wallUpper', 'brickGround', 'brickUpper', 'roof', 'parapet', 'asphalt',
    'cobble', 'sidewalk', 'grass', 'path', 'platform', 'rail', 'front', ...KEYS] as const;
  const fake = Object.fromEntries(WORLD.map((k) => [k, new THREE.MeshBasicMaterial({ name: k })])) as unknown as WorldMaterials;

  test('por cada abertura de espaldas al sol, el suelo de 0,2 a 1,5 m afuera queda en sombra si el sol entra por ella y sale por lo macizo', () => {
    // lo que dibuja la pasada de sombras: las caras de espaldas al sol de las mallas con castShadow
    const casters: { t: THREE.Triangle; box: THREE.Box3 }[] = [];
    const nrm = new THREE.Vector3();
    for (const g of buildChunks(map, fake, interiors).groups) {
      g.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || !o.castShadow) return;
        for (const t of triangles(o.geometry)) if (t.getNormal(nrm).dot(SUN_DIR) < 0) casters.push({ t, box: new THREE.Box3().setFromPoints([t.a, t.b, t.c]) });
      });
    }
    const bad: string[] = [];
    let rays = 0;
    for (const inp of map.interiors) {
      const b = map.buildings.find((x) => x.id === inp.buildingId)!;
      const fp = b.footprint;
      // las caras que puede cruzar un rayo de los de este edificio: las de su caja y las de la caja corrida hacia el sol
      const base = new THREE.Box3().setFromPoints(fp.map(([x, z]) => new THREE.Vector3(x, 0, z))).expandByScalar(2);
      base.max.y = b.height + 2;
      const reach = base.clone().union(base.clone().translate(SUN_DIR.clone().multiplyScalar((b.height + 2) / SUN_DIR.y)));
      const near = casters.filter((c) => c.box.intersectsBox(reach));
      /** Dónde corta el rayo la arista `e` (s en su largo e y), si la cruza entre t0 y t1. */
      const crossing = (o: THREE.Vector3, e: number, t0: number, t1: number): { t: number; s: number; y: number } | null => {
        const { a, d, len, n } = edge(fp, e);
        const den = SUN_DIR.x * n[0] + SUN_DIR.z * n[1];
        if (Math.abs(den) < 1e-9) return null;
        const t = ((a[0] - o.x) * n[0] + (a[1] - o.z) * n[1]) / den;
        if (t <= t0 + 1e-6 || t >= t1) return null;
        const s = (o.x + SUN_DIR.x * t - a[0]) * d[0] + (o.z + SUN_DIR.z * t - a[1]) * d[1];
        return s >= 0 && s <= len ? { t, s, y: o.y + SUN_DIR.y * t } : null;
      };
      const inOpening = (e: number, s: number, y: number): boolean =>
        inp.openings.some((o) => o.edge === e && s > o.s0 && s < o.s1 && y > o.y0 && y < Math.min(o.y1, b.height));
      for (const o of inp.openings) {
        const { a, d, n } = edge(fp, o.edge);
        if (n[0] * SUN_DIR.x + n[1] * SUN_DIR.z >= 0) continue; // la pared mira al sol: su sombra va para adentro
        for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          for (const out of [0.2, 0.5, 1, 1.5]) {
            const s = o.s0 + (o.s1 - o.s0) * f;
            const from = new THREE.Vector3(a[0] + d[0] * s + n[0] * out, 0.02, a[1] + d[1] * s + n[1] * out);
            const enter = crossing(from, o.edge, 0, Infinity);
            if (!enter || !inOpening(o.edge, enter.s, enter.y)) continue; // pega en lo macizo de afuera, o pasa por arriba
            // por dónde sale: por el techo, o por la primera arista que cruza después de entrar
            const roofT = (b.height - from.y) / SUN_DIR.y;
            let exit: { t: number; s: number; y: number; e: number } | null = null;
            for (let e = 0; e < fp.length; e++) {
              const x = e === o.edge ? null : crossing(from, e, enter.t, roofT);
              if (x && (!exit || x.t < exit.t)) exit = { ...x, e };
            }
            if (exit && inOpening(exit.e, exit.s, exit.y)) continue; // dos aberturas alineadas: ahí da el sol
            rays++;
            const ray = new THREE.Ray(from, SUN_DIR.clone());
            const hit = near.some(({ t, box }) => ray.intersectsBox(box) && ray.intersectTriangle(t.a, t.b, t.c, false, new THREE.Vector3()) !== null);
            if (!hit) bad.push(`${inp.placeId}: ${o.kind} de la arista ${o.edge}, s ${s.toFixed(2)}, a ${out} m`);
          }
        }
      }
    }
    console.log(`sombra (H1): ${rays} rayos por aberturas de espaldas al sol, ${bad.length} con sol`);
    expect(rays).toBeGreaterThan(50);
    expect(bad).toEqual([]);
  });
});
