// @vitest-environment jsdom
// El techo con hueco y el lucernario (D13, tarea 7) en el cliente, sobre el local de prueba de la tarea 4 con un hueco
// en el techo que atraviesa el bloque cerrado:
// - el techo del chunk y el de la cáscara de sombra se abren en el hueco, y lo tapa una tapa (plana o, si el lucernario
//   sobresale, con sus franjas y el color del vidrio) que se esconde cuando el interior se dibuja;
// - el lucernario da luz de cielo al piso de abajo (un vidrio de adentro no), su vidrio se ve de afuera como vidrio de
//   afuera y parado encima no se está adentro;
// - el plafón: un cartel redondo que mira para abajo, pintado en canvas con un PRNG con semilla.
import * as THREE from 'three';
import { extrudeBuilding, SKY_GLASS_UV } from '../../src/client/world/geometry.ts';
import { cellRect, FRAME_T, MULLION_T, panesOf } from '../../src/client/world/front-atlas.ts';
import { lightAt } from '../../src/client/world/interiors/bake.ts';
import { buildInterior3D } from '../../src/client/world/interiors/build.ts';
import { LABEL_DRAWINGS } from '../../src/client/world/interiors/drawings.ts';
import { roofCut } from '../../src/client/world/interiors/exterior.ts';
import { GLASS_INSIDE, GLASS_OUTSIDE } from '../../src/client/world/interiors/glass.ts';
import { createInteriorViews } from '../../src/client/world/interiors/view.ts';
import type { InteriorKey, WorldMaterials } from '../../src/client/world/types.ts';
import { BAY_W, FLOOR_H } from '../../src/client/world/wall-kit.ts';
import { pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../src/shared/geo.ts';
import { Kit } from '../../src/shared/interiors/kit.ts';
import type { Interior, Look } from '../../src/shared/interiors/types.ts';
import { LOT_OPENINGS } from '../../src/shared/interiors/openings.ts';
import type { Building, InteriorInput } from '../../src/shared/mapdata.ts';
import { LOOKS, testInterior } from '../shared/interiors/fixture.ts';
import { stubCanvas } from './canvas-stub.ts';

beforeEach(() => stubCanvas());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const IN_KEYS = ['in_liso', 'in_porcelanato', 'in_madera', 'in_machimbre', 'in_baldosa', 'in_ceramico', 'in_tela', 'in_metal',
  'in_ladrillo', 'in_vidrio', 'in_luz', 'in_mueble'] as const satisfies readonly InteriorKey[];
const WORLD_KEYS = ['wallGroundHouse', 'wallGroundShop', 'wallUpper', 'brickGround', 'brickUpper', 'roof', 'parapet', 'asphalt',
  'cobble', 'sidewalk', 'grass', 'path', 'platform', 'rail', 'front'] as const;
const fakeMaterials = (): WorldMaterials =>
  Object.fromEntries([...WORLD_KEYS, ...IN_KEYS].map((k) => [k, new THREE.MeshBasicMaterial({ name: k })])) as unknown as WorldMaterials;
const meshesOf = (o: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => { if (c instanceof THREE.Mesh) out.push(c); });
  return out;
};
function triangles(g: THREE.BufferGeometry): THREE.Triangle[] {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const idx = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, k) => k);
  const v = (k: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(p, k);
  const out: THREE.Triangle[] = [];
  for (let k = 0; k < idx.length; k += 3) out.push(new THREE.Triangle(v(idx[k]), v(idx[k + 1]), v(idx[k + 2])));
  return out;
}
const n = new THREE.Vector3();
/** El alto más alto en que una vertical por (x, z) corta los triángulos, o null. */
function topAt(ts: THREE.Triangle[], x: number, z: number): number | null {
  const ray = new THREE.Ray(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
  let best: number | null = null;
  for (const t of ts) {
    const hit = ray.intersectTriangle(t.a, t.b, t.c, false, new THREE.Vector3());
    if (hit && (best === null || hit.y > best)) best = hit.y;
  }
  return best;
}
/** El área en planta de las caras que miran para arriba. */
const upArea = (ts: THREE.Triangle[]): number => ts.filter((t) => t.getNormal(n).y > 0.5).reduce((s, t) => s + t.getArea() * t.getNormal(n).y, 0);

const GLASS: Look = { mat: 'vidrio', color: '#b8d0d6' };
const HOLE: Vec2[] = [[3, 4], [7, 4], [7, 11], [3, 11]];
/** Cuánto sobresale el medio del lucernario de prueba. */
const RISE = 0.4;

/** El local de prueba (10 × 15 m, 7 m de alto, 2 pisos) con un piso público y un hueco de 4 × 7 m que atraviesa el
 *  bloque cerrado (D13) y, con `sky`, su lucernario a dos aguas, de height a height + RISE en el medio, que da al cielo:
 *  la colisión son 20 franjas de vidrio de 0,2 m (sin dibujo) y lo que se ve, los dos paños inclinados y los dos
 *  tímpanos (H1). */
function skylit(sky: boolean, b0?: Building): { b: Building; input: InteriorInput; interior: Interior } {
  const { b: base, input } = testInterior();
  const b = b0 ?? base;
  const k = new Kit(b, input);
  k.shell({ publicFloors: 1, holes: [{ level: 1, polygon: HOLE }], wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
  if (sky) {
    const [H, top] = [b.height, b.height + RISE];
    for (let s = 0; s < 20; s++) {
      const u = 3 + s * 0.2;
      k.block([[u, 4], [u + 0.2, 4], [u + 0.2, 11], [u, 11]], H, H + RISE * (1 - Math.abs(u + 0.1 - 5) / 2), 'glass', 'vidrio', {}, { sky: true });
    }
    const o = { back: true, sky: true } as const;
    k.pane([[3, H, 4], [5, top, 4], [5, top, 11], [3, H, 11]], [-RISE, 2, 0], GLASS, o);
    k.pane([[5, top, 4], [7, H, 4], [7, H, 11], [5, top, 11]], [RISE, 2, 0], GLASS, o);
    k.pane([[3, H, 4], [7, H, 4], [5, top, 4]], [0, 0, -1], GLASS, o);
    k.pane([[3, H, 11], [5, top, 11], [7, H, 11]], [0, 0, 1], GLASS, o);
  }
  return { b, input, interior: k.done(0.8) };
}

describe('el techo con hueco (D13): el chunk, la cáscara y la tapa', () => {
  test('roofHoles: el hueco del bloque cerrado, en el mundo', () => {
    const { interior } = skylit(false);
    expect(interior.roofHoles).toHaveLength(1);
    expect(pointInPolygon([5, 7.5], interior.roofHoles[0])).toBe(true);
    expect(pointInPolygon([1.5, 2], interior.roofHoles[0])).toBe(false);
  });

  test('sin lucernario: el techo del chunk y el de la cáscara se abren en el hueco; la tapa es plana, del techo, a height', () => {
    const { b, input, interior } = skylit(false);
    const e = extrudeBuilding(b, input.openings, roofCut(interior));
    const roof = triangles(e.roof);
    // la cáscara está (hay aberturas): mira para abajo, 5 cm debajo del techo
    expect(roof.some((t) => t.getNormal(n).y < -0.999)).toBe(true);
    for (const [x, z] of [[5, 7.5], [3.1, 4.1], [6.9, 10.9], [4, 9]] as Vec2[]) expect(topAt(roof, x, z), `${x}, ${z}`).toBeNull();
    // afuera del hueco, el techo y la cáscara siguen
    const outside = roof.filter((t) => t.getNormal(n).y < -0.999);
    expect(topAt(roof, 1.5, 2)).toBeCloseTo(b.height, 6);
    expect(topAt(outside, 1.5, 2)).toBeCloseTo(b.height - 0.05, 6);
    expect(Object.keys(e.tapas)).toContain('roof');
    const tapa = triangles(e.tapas.roof!);
    expect(topAt(tapa, 5, 7.5)).toBeCloseTo(b.height, 6);
    expect(upArea(tapa)).toBeCloseTo(4 * 7, 4);
    // sin hueco, nada cambia: ni tapa de techo
    expect(Object.keys(extrudeBuilding(b, input.openings).tapas)).not.toContain('roof');
  });

  test('con lucernario: la tapa sigue sus paños (a dos aguas, en pendiente) con el color del vidrio, sin material nuevo', () => {
    const { b, input, interior } = skylit(true);
    const e = extrudeBuilding(b, input.openings, roofCut(interior));
    expect(topAt(triangles(e.roof), 5, 7.5)).toBeNull();
    // un edificio común: en parapet (revoque teñido), con el color del vidrio en el vértice; las tapas de sus aberturas
    // (las de la planta baja) siguen como estaban
    expect(Object.keys(extrudeBuilding(b, input.openings).tapas)).toEqual(['wallGroundShop']);
    expect(Object.keys(e.tapas).sort()).toEqual(['parapet', 'wallGroundShop']);
    const g = e.tapas.parapet!;
    const tapa = triangles(g);
    expect(topAt(tapa, 5, 7.5)!).toBeGreaterThan(b.height + RISE - 0.05);
    expect(topAt(tapa, 3.05, 7.5)!).toBeLessThan(b.height + 0.05);
    expect(topAt(tapa, 3.05, 7.5)!).toBeGreaterThan(b.height);
    expect(upArea(tapa)).toBeCloseTo(4 * 7, 4);
    // en pendiente (H1): dos aguas y dos tímpanos, no un escalón por franja
    expect(tapa.length, 'triángulos de la tapa').toBeLessThanOrEqual(8);
    for (const u of [3.3, 3.9, 4.5, 5.5, 6.1, 6.7]) {
      expect(topAt(tapa, u, 7.5)!, `u ${u}`).toBeCloseTo(b.height + RISE * (1 - Math.abs(u - 5) / 2), 4);
    }
    const col = g.getAttribute('color');
    for (let k = 0; k < col.count; k++) expect(col.getZ(k), 'azulado').toBeGreaterThan(col.getX(k));
    // un lote: en el atlas del frente (la tapa de sus aberturas ya está: ninguna malla nueva), con uv en el vidrio de
    // la vidriera
    const lot: Building = { ...b, front: { edges: [0], corner: [], pb: 'vidriera', arriba: 'ventanas', puerta: 'inicio' } };
    const el = extrudeBuilding(lot, input.openings, roofCut(skylit(true, lot).interior));
    const plain = Object.keys(extrudeBuilding(lot, input.openings).tapas).sort();
    expect(plain).toContain('front');
    expect(Object.keys(el.tapas).sort()).toEqual(plain);
    const front = el.tapas.front!;
    const over = triangles(front);
    expect(topAt(over, 5, 7.5)!).toBeGreaterThan(b.height + RISE - 0.05);
    const uv = front.getAttribute('uv'), pos = front.getAttribute('position');
    let gable = 0;
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) < b.height - 1e-6) continue; // las de las aberturas
      gable++;
      expect(uv.getX(k)).toBeCloseTo(SKY_GLASS_UV[0], 6);
      expect(uv.getY(k)).toBeCloseTo(SKY_GLASS_UV[1], 6);
    }
    expect(gable).toBeGreaterThan(0);
  });

  test('el vidrio de la tapa (H6): SKY_GLASS_UV cae en un paño de la vidriera, a ≥ 0,1 m del marco y de cada parteluz', () => {
    const cell = cellRect('vidriera');
    // en metros dentro de la celda (una bahía de un piso): x desde la izquierda e y desde el piso
    const x = ((SKY_GLASS_UV[0] - cell.u0) / (cell.u1 - cell.u0)) * BAY_W, y = ((SKY_GLASS_UV[1] - cell.v0) / (cell.v1 - cell.v0)) * FLOOR_H;
    const glass = LOT_OPENINGS.vidriera.filter((o) => o.kind === 'vidrio');
    const o = glass.find((g) => x > g.x0 && x < g.x1 && y > g.y0 && y < g.y1);
    expect(o, `(${x.toFixed(2)}, ${y.toFixed(2)}) en un vidrio`).toBeDefined();
    const n = panesOf('vidriera', o!);
    const mullions = Array.from({ length: n - 1 }, (_, j) => o!.x0 + ((o!.x1 - o!.x0) * (j + 1)) / n);
    const clear = 0.1;
    for (const edge of [o!.x0, o!.x1]) expect(Math.abs(x - edge) - FRAME_T / 2, 'al marco').toBeGreaterThanOrEqual(clear);
    for (const edge of [o!.y0, o!.y1]) expect(Math.abs(y - edge) - FRAME_T / 2, 'al marco').toBeGreaterThanOrEqual(clear);
    for (const m of mullions) expect(Math.abs(x - m) - MULLION_T / 2, `al parteluz de ${m.toFixed(2)}`).toBeGreaterThanOrEqual(clear);
  });

  test('la tapa del techo se esconde cuando el interior se dibuja, y se ve cuando no', () => {
    const { b, input, interior } = skylit(true);
    const e = extrudeBuilding(b, input.openings, roofCut(interior));
    const tapa = new THREE.Mesh(e.tapas.parapet!, new THREE.MeshBasicMaterial());
    const views = createInteriorViews([interior], fakeMaterials(), 'media', new Map([['prueba', [tapa]]]));
    const cam = (pos: Vec3, yaw: number): THREE.PerspectiveCamera => {
      const c = new THREE.PerspectiveCamera(75, 16 / 9, 0.15, 1000);
      c.rotation.order = 'YXZ';
      c.position.set(pos[0], pos[1] + 1.6, pos[2]);
      c.rotation.set(0, yaw, 0);
      return c;
    };
    views.update(cam([5, 0, -10], Math.PI));
    expect(views.drawn()).toEqual(['prueba']);
    expect(tapa.visible).toBe(false);
    views.update(cam([5, 0, -80], Math.PI));
    expect(views.drawn()).toEqual([]);
    expect(tapa.visible).toBe(true);
  });
});

describe('el lucernario en el interior', () => {
  const up: Vec3 = [0, 1, 0];

  test('suma luz de cielo al piso de abajo del hueco (normal hacia abajo: arriba no llega); un vidrio de adentro no suma', () => {
    const { b, interior } = skylit(true);
    const lit = { ...interior, ambient: 0.05, lamps: [] };
    const shut = { ...lit, roofHoles: [] };
    const floor: Vec3 = [5, 0.02, 7.5];
    expect(lightAt(lit, floor, up)).toBeGreaterThan(lightAt(shut, floor, up) + 0.15);
    // debajo del bloque cerrado, lejos del hueco y de la vidriera, casi nada
    expect(lightAt(lit, [5, 0.02, 14.2], up)).toBeLessThan(lightAt(lit, floor, up));
    // arriba del lucernario (en el techo), la fuente no ilumina: mira para abajo
    for (const p of [[5, b.height + 1, 7.5], [1.5, b.height + 0.01, 2]] as Vec3[]) {
      expect(lightAt(lit, p, up), p.join(', ')).toBeCloseTo(lightAt(shut, p, up), 6);
    }
    // un vidrio de adentro horizontal (una mesa de vidrio, un cielorraso de vidrio) sigue sin ser fuente de cielo
    const { interior: plain } = testInterior();
    const { interior: inner } = testInterior({ extra: (k) => k.block([[3, 4], [7, 4], [7, 11], [3, 11]], 2.9, 2.95, 'glass', 'vidrio', { top: GLASS, bottom: GLASS }) });
    for (const p of [[5, 0.02, 7.5], [2, 0.02, 12]] as Vec3[]) {
      expect(lightAt({ ...inner, ambient: 0.05 }, p, up)).toBeCloseTo(lightAt({ ...plain, ambient: 0.05 }, p, up), 6);
    }
  });

  test('su vidrio se ve como vidrio de afuera (GLASS_OUTSIDE) desde el techo, y de adentro (GLASS_INSIDE) desde abajo', () => {
    const { b, interior } = skylit(true);
    const glass = meshesOf(buildInterior3D(interior, fakeMaterials(), 'alta').group).find((x) => x.name === 'in_vidrio')!;
    const [pos, nor, col] = ['position', 'normal', 'color'].map((a) => glass.geometry.getAttribute(a));
    // la cara que mira hacia el medio del hueco (abajo de las aguas, adentro de los tímpanos) es la de adentro
    const mid: Vec3 = [5, b.height, 7.5];
    let outside = 0, inside = 0;
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) < b.height - 1e-6) continue; // las vidrieras del frente
      const toMid = nor.getX(k) * (mid[0] - pos.getX(k)) + nor.getY(k) * (mid[1] - pos.getY(k)) + nor.getZ(k) * (mid[2] - pos.getZ(k));
      if (toMid > 0) {
        inside++;
        expect(col.getX(k)).toBeCloseTo(GLASS_INSIDE, 6);
      } else {
        outside++;
        expect(col.getX(k)).toBeCloseTo(GLASS_OUTSIDE, 6);
      }
    }
    expect(outside).toBeGreaterThan(0);
    expect(inside).toBeGreaterThan(0);
  });

  test('las muestras de la luz de cielo van en el marco del hueco (H5): un hueco angosto girado 30° da la misma luz (± 5 %) que sin girar', () => {
    /** El local girado `a` alrededor del origen (planta y marco), con un hueco de escalera de 1,2 × 5,1 m en el techo. */
    const narrow = (a: number): Interior => {
      const { b, input } = testInterior();
      const rot = ([x, z]: Vec2): Vec2 => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
      const k = new Kit({ ...b, footprint: b.footprint.map(rot) }, { ...input, frame: { origin: [0, 0], u: rot([1, 0]), v: rot([0, 1]) } });
      k.shell({ publicFloors: 1, holes: [{ level: 1, polygon: [[4.4, 5], [5.6, 5], [5.6, 10.1], [4.4, 10.1]] }], wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
      return { ...k.done(0.05), lamps: [] };
    };
    const [plain, turned] = [narrow(0), narrow(Math.PI / 6)];
    const rot = ([x, y, z]: Vec3): Vec3 => [x * Math.cos(Math.PI / 6) - z * Math.sin(Math.PI / 6), y, x * Math.sin(Math.PI / 6) + z * Math.cos(Math.PI / 6)];
    for (const p of [[5, 0.02, 7.55], [5, 0.02, 5.5], [5, 0.02, 9.6], [3.5, 0.02, 8]] as Vec3[]) {
      const [a, c] = [lightAt(plain, p, up) - 0.05, lightAt(turned, rot(p), up) - 0.05];
      expect(a, p.join(', ')).toBeGreaterThan(0.05);
      expect(Math.abs(c - a) / a, `${p.join(', ')}: ${a.toFixed(3)} sin girar, ${c.toFixed(3)} girado`).toBeLessThanOrEqual(0.05);
    }
  });

  test('parado sobre el lucernario no se está adentro; en el piso de abajo del hueco, sí', () => {
    const { b, interior } = skylit(true);
    const views = createInteriorViews([interior], fakeMaterials(), 'media', new Map());
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.15, 1000);
    cam.position.set(5, b.height + RISE + 1.6, 7.5);
    views.update(cam);
    expect(views.inside()).toBe(false);
    cam.position.set(5, 1.6, 7.5);
    views.update(cam);
    expect(views.inside()).toBe(true);
  });
});

describe('el plafón: un cartel redondo que mira para abajo', () => {
  const LOOK = { fondo: '#f4efe6', letra: '#202020', marco: '#f4efe6', fuente: 'sans' as const };

  test('un cartel `down` y `round` es un disco horizontal de diámetro width, con la cara hacia abajo', () => {
    const { interior } = testInterior({ extra: (k) => k.label('Plafón', [5, 7.5], 2.8, [0, 1], 3, 3, LOOK, { drawing: 'plafon', down: true, round: true }) });
    expect(interior.labels[0]).toMatchObject({ down: true, round: true, drawing: 'plafon' });
    const mesh = meshesOf(buildInterior3D(interior, fakeMaterials(), 'media').group).find((x) => x.name.startsWith('labels:'))!;
    const ts = triangles(mesh.geometry);
    expect(ts.length).toBeGreaterThanOrEqual(24);
    for (const t of ts) {
      expect(t.getNormal(n).y).toBeCloseTo(-1, 6);
      for (const p of [t.a, t.b, t.c]) {
        expect(p.y).toBeLessThan(2.8);
        expect(p.y).toBeGreaterThan(2.7);
        expect(Math.hypot(p.x - 5, p.z - 7.5)).toBeLessThanOrEqual(1.5 + 1e-6);
      }
    }
    const area = ts.reduce((s, t) => s + t.getArea(), 0);
    expect(area).toBeGreaterThan(Math.PI * 1.5 * 1.5 * 0.97);
  });

  test.each(['plafon', 'cuadro'] as const)('el dibujo %s sale del texto (semilla): el mismo texto, lo mismo; otro, otra cosa; sin Math.random', (d) => {
    const draw = (seed: string): string[] => {
      const calls: string[] = [];
      vi.restoreAllMocks();
      stubCanvas((prop, value) => calls.push(`${prop}=${String(value)}`), (method, args) => calls.push(`${method}(${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : String(a))).join(',')})`));
      const random = vi.spyOn(Math, 'random');
      LABEL_DRAWINGS[d](LOOK, 2, 2, seed);
      expect(random).not.toHaveBeenCalled();
      return calls;
    };
    const a = draw('Sala 1 · obra 1');
    expect(a.length).toBeGreaterThan(20);
    expect(draw('Sala 1 · obra 1')).toEqual(a);
    expect(draw('Sala 1 · obra 2')).not.toEqual(a);
    expect(a.some((c) => c.startsWith('fillText'))).toBe(false);
  });
});
