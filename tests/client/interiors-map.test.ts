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
import { roofCut } from '../../src/client/world/interiors/exterior.ts';
import { createInteriorViews } from '../../src/client/world/interiors/view.ts';
import type { InteriorKey, WorldMaterials } from '../../src/client/world/types.ts';
import { pointInPolygon, polygonArea, signedAreaFromAbove } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import { buildInteriors } from '../../src/shared/interiors/index.ts';
import type { Interior } from '../../src/shared/interiors/types.ts';
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

// M2 de la revisión de la tarea 5: el contorno corrido de la cáscara (sus esquinas cortadas con las vecinas) en las
// plantas de verdad, también las agudas y la curva de La Veneciana, y con los huecos del techo (la escalera de la terraza).
describe('el techo del chunk y el de la cáscara en el mapa real (M2)', () => {
  for (const i of interiors) {
    test(`${i.placeId}: el techo cubre la planta menos sus huecos; la cáscara, lo mismo menos lo corrido, mirando abajo y sin dar vueltas`, () => {
      const b = map.buildings.find((x) => x.id === i.buildingId)!;
      const inp = map.interiors.find((x) => x.placeId === i.placeId)!;
      const e = extrudeBuilding(b, inp.openings, roofCut(i));
      const holes = i.roofHoles.reduce((s, h) => s + polygonArea(h), 0);
      const want = polygonArea(b.footprint) - holes;
      const perimeter = b.footprint.reduce((s, p, k) => { const q = b.footprint[(k + 1) % b.footprint.length]; return s + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0);
      const at = (y: number) => triangles(e.roof).filter((t) => [t.a, t.b, t.c].every((p) => Math.abs(p.y - y) < 1e-4));
      const n = new THREE.Vector3();
      const roof = at(b.height), shell = at(b.height - 0.05);
      for (const t of roof) expect(t.getNormal(n).y, 'el techo mira arriba').toBeGreaterThan(0.99);
      for (const t of shell) expect(t.getNormal(n).y, 'la cáscara mira abajo').toBeLessThan(-0.99);
      expect(Math.abs(areaOf(roof) - want), `${i.placeId}: m² del techo`).toBeLessThan(0.01);
      const got = areaOf(shell);
      expect(got, `${i.placeId}: m² de la cáscara`).toBeLessThanOrEqual(want + 0.01);
      expect(got, `${i.placeId}: m² de la cáscara`).toBeGreaterThanOrEqual(want - 0.15 * perimeter - 0.01);
      // los huecos quedan abiertos en los dos
      for (const h of i.roofHoles) {
        const c: Vec2 = [h.reduce((s, p) => s + p[0], 0) / h.length, h.reduce((s, p) => s + p[1], 0) / h.length];
        const ray = new THREE.Ray(new THREE.Vector3(c[0], 100, c[1]), new THREE.Vector3(0, -1, 0));
        for (const t of [...roof, ...shell]) expect(ray.intersectTriangle(t.a, t.b, t.c, false, new THREE.Vector3()), `${i.placeId}: el hueco del techo`).toBeNull();
      }
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
      /** Los huecos del techo (la escalera de la terraza): por ahí no hay nada macizo. */
      const holes = interiors.find((x) => x.placeId === inp.placeId)?.roofHoles ?? [];
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
            const top: Vec2 = [from.x + SUN_DIR.x * roofT, from.z + SUN_DIR.z * roofT];
            if (!exit && holes.some((h) => pointInPolygon(top, h))) continue; // sale por el hueco del techo: ahí también
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

describe('el techo de la Casa de la Cultura (D13, tarea 7)', () => {
  const WORLD = ['wallGroundHouse', 'wallGroundShop', 'wallUpper', 'brickGround', 'brickUpper', 'roof', 'parapet', 'asphalt',
    'cobble', 'sidewalk', 'grass', 'path', 'platform', 'rail', 'front', ...KEYS] as const;
  const fake = Object.fromEntries(WORLD.map((k) => [k, new THREE.MeshBasicMaterial({ name: k })])) as unknown as WorldMaterials;
  /** El alto más alto en que una vertical por (x, z) corta los triángulos, o null. */
  const topAt = (ts: THREE.Triangle[], [x, z]: Vec2): number | null => {
    const ray = new THREE.Ray(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
    let best: number | null = null;
    for (const t of ts) {
      const hit = ray.intersectTriangle(t.a, t.b, t.c, false, new THREE.Vector3());
      if (hit && (best === null || hit.y > best)) best = hit.y;
    }
    return best;
  };

  test('el techo del chunk se abre sobre el atrio; lo tapa la tapa del frente (sin mallas nuevas), a dos aguas, que se esconde con el interior dibujado', () => {
    const casa = interiors.find((i) => i.placeId === 'casa-de-la-cultura')!;
    const b = map.buildings.find((x) => x.id === casa.buildingId)!;
    const hole = casa.roofHoles[0];
    const c: Vec2 = [hole.reduce((s, p) => s + p[0], 0) / hole.length, hole.reduce((s, p) => s + p[1], 0) / hole.length];
    expect(pointInPolygon(c, hole)).toBe(true);
    const { groups, tapas } = buildChunks(map, fake, interiors);
    const roofs = groups.flatMap((g) => g.children.filter((m): m is THREE.Mesh => m instanceof THREE.Mesh && m.name === 'roof'));
    expect(topAt(roofs.flatMap((m) => triangles(m.geometry)), c)).toBeNull();
    // la tapa del techo va en la del frente: la Casa sigue con una sola tapa del chunk (las aberturas del frente)
    const own = tapas.get('casa-de-la-cultura')!;
    expect(own.map((m) => m.name)).toEqual(['front']);
    expect(topAt(triangles(own[0].geometry), c)!).toBeGreaterThan(b.height + 0.5);
    // un poco afuera del hueco, el techo del chunk sigue
    const out: Vec2 = [c[0] + (hole[0][0] - c[0]) * 1.2, c[1] + (hole[0][1] - c[1]) * 1.2];
    expect(topAt(roofs.flatMap((m) => triangles(m.geometry)), out)).toBeCloseTo(b.height, 6);
    const views = createInteriorViews([casa], fake, 'alta', tapas);
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.15, 1000);
    cam.rotation.order = 'YXZ';
    // en la vereda de enfrente, mirando la fachada (la puerta mira hacia afuera: de espaldas a ella)
    const d = casa.doors[0];
    cam.position.set(d.at[0] + d.normal[0] * 15, 1.6, d.at[1] + d.normal[1] * 15);
    cam.rotation.set(0, Math.atan2(d.normal[0], d.normal[1]), 0);
    views.update(cam);
    expect(views.drawn()).toEqual(['casa-de-la-cultura']);
    expect(own[0].visible).toBe(false);
    cam.position.set(d.at[0] + d.normal[0] * 120, 30, d.at[1] + d.normal[1] * 120);
    views.update(cam);
    expect(views.drawn()).toEqual([]);
    expect(own[0].visible).toBe(true);
    views.dispose();
  });

  /** El plano del lucernario de la Casa: H + R · (1 − |de través| / medio ancho), con R lo que sube la cumbrera. */
  function slope(): { H: number; hole: Vec2[]; at: (x: number, z: number) => number } {
    const casa = interiors.find((i) => i.placeId === 'casa-de-la-cultura')!;
    const H = map.buildings.find((x) => x.id === casa.buildingId)!.height;
    const hole = casa.roofHoles[0];
    const c: Vec2 = [hole.reduce((s, p) => s + p[0], 0) / hole.length, hole.reduce((s, p) => s + p[1], 0) / hole.length];
    const d = casa.doors[0].normal, along: Vec2 = [-d[1], d[0]];
    const across = (x: number, z: number): number => Math.abs((x - c[0]) * along[0] + (z - c[1]) * along[1]);
    const half = Math.max(...hole.map((p) => across(p[0], p[1])));
    const R = Math.max(...casa.panes.filter((p) => p.sky).flatMap((p) => p.corners.map((q) => q[1]))) - H;
    return { H, hole, at: (x, z) => H + R * (1 - across(x, z) / half) };
  }

  test('el lucernario dibujado va en pendiente (H1): el vidrio en el plano de las aguas (± 0,01) y la estructura debajo, en pocos triángulos', () => {
    const casa = interiors.find((i) => i.placeId === 'casa-de-la-cultura')!;
    const { H, hole, at } = slope();
    const meshes = new Map<string, THREE.Mesh>();
    buildInterior3D({ ...casa }, materials, 'alta').group.traverse((o) => { if (o instanceof THREE.Mesh) meshes.set(o.name, o); });
    const glass = triangles(meshes.get('in_vidrio')!.geometry).filter((t) => [t.a, t.b, t.c].some((p) => p.y > H + 0.01));
    expect(glass.length).toBeGreaterThan(0);
    expect(glass.length, 'triángulos del vidrio del lucernario').toBeLessThanOrEqual(12);
    for (const t of glass) for (const p of [t.a, t.b, t.c]) expect(Math.abs(p.y - at(p.x, p.z)), `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`).toBeLessThanOrEqual(0.01);
    // la estructura: lo de in_luz arriba del cordón y adentro del hueco, debajo del vidrio y pegado a él
    const frame = triangles(meshes.get('in_luz')!.geometry).filter((t) => [t.a, t.b, t.c].every((p) => p.y > H + 0.16 && pointInPolygon([p.x, p.z], hole)));
    expect(frame.length).toBeGreaterThan(0);
    expect(frame.length, 'triángulos de la estructura').toBeLessThanOrEqual(200);
    for (const t of frame) {
      for (const p of [t.a, t.b, t.c]) {
        expect(p.y, 'debajo del vidrio').toBeLessThanOrEqual(at(p.x, p.z) + 1e-3);
        expect(p.y, 'pegada al vidrio').toBeGreaterThanOrEqual(at(p.x, p.z) - 0.25);
      }
    }
  });

  test('la tapa de lejos del lucernario va en pendiente (H1): ≤ 8 triángulos, en el plano de las aguas, más alta en el medio', () => {
    const { H, at } = slope();
    const { tapas } = buildChunks(map, fake, interiors);
    const sky = triangles(tapas.get('casa-de-la-cultura')![0].geometry).filter((t) => [t.a, t.b, t.c].every((p) => p.y > H - 1e-3));
    expect(sky.length).toBeGreaterThan(0);
    expect(sky.length, 'triángulos de la tapa del lucernario').toBeLessThanOrEqual(8);
    for (const t of sky) for (const p of [t.a, t.b, t.c]) expect(Math.abs(p.y - at(p.x, p.z))).toBeLessThanOrEqual(0.01);
    expect(Math.max(...sky.flatMap((t) => [t.a.y, t.b.y, t.c.y]))).toBeGreaterThan(H + 1);
  });

  test('la Casa no baja del nivel de compactación de hoy (H8): 0 en media y alta; en baja, 1 (los muebles juntos, con sus texturas)', () => {
    const casa = interiors.find((i) => i.placeId === 'casa-de-la-cultura')!;
    const today = { baja: 1, media: 0, alta: 0 } as const;
    for (const q of ['baja', 'media', 'alta'] as const) {
      const { group } = buildInterior3D({ ...casa }, materials, q);
      expect(group.userData.level, `${q}: si un material más la obliga a compactar más, falla`).toBeLessThanOrEqual(today[q]);
      if (q === 'baja') expect(group.children.map((m) => m.name)).toContain('in_porcelanato');
    }
  });
});

// Revisión de la tarea 9 (el balcón): el interior se parte en lo que cae en la planta (el edificio) y lo que cae en un
// patio, cada uno con su caja; parado en un patio, al aire libre, cada parte se dibuja si la cámara la ve.
describe('el edificio y el patio por separado', () => {
  const WORLD = ['wallGroundHouse', 'wallGroundShop', 'wallUpper', 'brickGround', 'brickUpper', 'roof', 'parapet', 'asphalt',
    'cobble', 'sidewalk', 'grass', 'path', 'platform', 'rail', 'front', ...KEYS] as const;
  const fake = Object.fromEntries(WORLD.map((k) => [k, new THREE.MeshBasicMaterial({ name: k })])) as unknown as WorldMaterials;
  const byId = (id: string): Interior => interiors.find((i) => i.placeId === id)!;
  const meshesOf = (g: THREE.Object3D): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    g.traverse((o) => { if (o instanceof THREE.Mesh) out.push(o); });
    return out;
  };

  test('el Guernica y el McDonald\'s, en dos grupos (edificio y patio, cada uno con su caja); la Casa, en uno; sin perder triángulos', () => {
    // la Casa (sin patio): una parte, el grupo mismo
    const casa = buildInterior3D({ ...byId('casa-de-la-cultura') }, materials, 'media');
    expect(casa.parts.map((p) => p.name)).toEqual(['edificio']);
    expect(casa.parts[0].group).toBe(casa.group);
    for (const id of ['guernica-bar', 'mcdonalds'] as const) {
      const i = byId(id);
      for (const q of ['baja', 'media', 'alta'] as const) {
        const built = buildInterior3D({ ...i }, materials, q);
        expect(built.parts.map((p) => p.name), `${id}/${q}`).toEqual(['edificio', 'patio']);
        // todas las mallas, en una parte; la suma de triángulos, la del interior sin partir (sin patios: todo al edificio)
        const all = meshesOf(built.group);
        expect(built.parts.flatMap((p) => meshesOf(p.group)).length, `${id}/${q}`).toBe(all.length);
        const whole = meshesOf(buildInterior3D({ ...i, patios: [] }, materials, q).group);
        expect(all.reduce((t, m) => t + trianglesOf(m), 0), `${id}/${q}: los triángulos`).toBe(whole.reduce((t, m) => t + trianglesOf(m), 0));
        // la caja del edificio llega a la planta y la del patio no entra en ella (salvo el borde)
        const [edificio, patio] = built.parts;
        const fp = new THREE.Box3();
        for (const [x, z] of i.footprint) fp.expandByPoint(new THREE.Vector3(x, 0, z));
        expect(edificio.box.min.x).toBeLessThanOrEqual(fp.min.x + 0.5);
        expect(edificio.box.max.x).toBeGreaterThanOrEqual(fp.max.x - 0.5);
        const c = patio.box.getCenter(new THREE.Vector3());
        expect(pointInPolygon([c.x, c.z], i.footprint), `${id}: el medio de la caja del patio`).toBe(false);
        for (const p of built.parts) expect(p.hull.length, `${id}/${p.name}: su planta`).toBeGreaterThanOrEqual(3);
      }
    }
  }, 30_000);

  test('desde el balcón del Guernica: mirando al patio, el grupo del edificio no se dibuja (el del patio, sí); mirando a la puerta, sí; desde adentro, todo', () => {
    const gu = byId('guernica-bar');
    const views = createInteriorViews([gu], fake, 'media', new Map());
    const groupOf = (part: string): THREE.Object3D => views.group.getObjectByName(`interior:guernica-bar:${part}`)!;
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.15, 1000);
    cam.rotation.order = 'YXZ';
    const q = gu.marks.balcon, door = gu.doors.find((d) => d.level === 1)!;
    // la normal de la puerta mira afuera; la cámara mira hacia −z girada `yaw`: hacia d, yaw = atan2(−dx, −dz)
    const look = (d: Vec2, pitch: number): void => {
      cam.rotation.set(pitch, Math.atan2(-d[0], -d[1]), 0);
      views.update(cam);
    };
    cam.position.set(q[0], q[1] + 1.6, q[2]);
    for (const pitch of [0, -0.4, -0.9]) {
      look(door.normal, pitch);
      expect(views.drawn()).toEqual(['guernica-bar']);
      expect(groupOf('edificio').visible, `mirando al patio (pitch ${pitch})`).toBe(false);
      expect(groupOf('patio').visible).toBe(true);
    }
    look([-door.normal[0], -door.normal[1]], 0);
    expect(groupOf('edificio').visible, 'mirando a la puerta').toBe(true);
    // adentro (bajo techo), mire a donde mire, las dos
    const p = gu.marks['planta-alta'];
    cam.position.set(p[0], p[1] + 1.6, p[2]);
    look([-door.normal[0], -door.normal[1]], 0);
    expect(groupOf('edificio').visible && groupOf('patio').visible).toBe(true);
    look(door.normal, 0);
    expect(groupOf('edificio').visible && groupOf('patio').visible).toBe(true);
    views.dispose();
  });
});
