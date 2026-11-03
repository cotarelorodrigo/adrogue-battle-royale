import { CollisionWorld, buildCollisionWorld } from '../../src/shared/collision.ts';
import type { LadderVolume, Prism } from '../../src/shared/collision.ts';
import { distPointSegment, pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../src/shared/geo.ts';
import type { Bounds, MapData } from '../../src/shared/mapdata.ts';

const bounds: Bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
// Cuadrado de 10 × 10 m, h = 3,8: x ∈ [0, 10], z ∈ [−10, 0] (antihorario visto desde arriba).
const square: Prism = { polygon: [[0, 0], [10, 0], [10, -10], [0, -10]], minY: 0, maxY: 3.8, tag: 'A' };
// L cóncava, h = 7: brazo sur x ∈ [20, 40] × z ∈ [−28, −20] y brazo oeste x ∈ [20, 28] × z ∈ [−40, −20].
// Vértice reflejo en (28, −28); la muesca libre es x ∈ [28, 40] × z ∈ [−40, −28].
const ell: Prism = { polygon: [[20, -20], [40, -20], [40, -28], [28, -28], [28, -40], [20, -40]], minY: 0, maxY: 7, tag: 'L' };
// Escalera en la cara sur (z = −20, normal +z) de la L: volumen x ∈ [29,6, 30,4] × z ∈ [−20, −19,4].
const ladder: LadderVolume = { base: [30, -20], normal: [0, 1], topY: 7 };
const w = new CollisionWorld([square, ell], [ladder], bounds);

const insideInnerCorner = [28.2, -28.2, 0.35, 0, 1.8] as const; // pisa las dos paredes de la muesca
const frontOfLadder = [30, -19.5] as const;
const farFromLadder = [30, -18] as const;

describe('tests del plan', () => {
  test('overlaps adentro del edificio pero no arriba del techo', () => {
    expect(w.overlaps(5, -5, 0.35, 0, 1.8)).toBe(true);
    expect(w.overlaps(5, -5, 0.35, 3.9, 5.7)).toBe(false);
  });
  test('supportHeight respeta maxY', () => {
    expect(w.supportHeight(5, -5, 0.35, 4.0)).toBeCloseTo(3.8);
    expect(w.supportHeight(5, -5, 0.35, 3.0)).toBe(0);
  });
  test('pushOut deja el círculo a ≥ r de la pared', () => {
    const [x] = w.pushOut(0.2, -5, 0.35, 0, 1.8);
    expect(x).toBeLessThanOrEqual(-0.35 + 1e-6);
  });
  test('pushOut en la esquina interior de la L', () =>
    expect(w.overlaps(...w.pushOut(...insideInnerCorner), 0.35, 0, 1.8)).toBe(false));
  test('raycast contra la pared y contra el techo desde arriba', () => {
    expect(w.raycast([-10, 1, -5], [1, 0, 0], 100)!.dist).toBeCloseTo(10);
    expect(w.raycast([5, 20, -5], [0, -1, 0], 100)!.point[1]).toBeCloseTo(3.8);
    expect(w.raycast([-10, 5, -5], [1, 0, 0], 100)).toBeNull();
  });
  test('ladderAt frente a la escalera y no lejos de ella', () => {
    expect(w.ladderAt(...frontOfLadder, 0.35, 1)).not.toBeNull();
    expect(w.ladderAt(...farFromLadder, 0.35, 1)).toBeNull();
  });
});

describe('overlaps', () => {
  test('tocar la pared a exactamente r no superpone (distancia estricta)', () => {
    expect(w.overlaps(-0.35, -5, 0.35, 0, 1.8)).toBe(false);
    expect(w.overlaps(-0.34, -5, 0.35, 0, 1.8)).toBe(true);
    // pared interior de la muesca (x = 28), que no es borde de la caja; 0,375 es exacto en binario
    expect(w.overlaps(28.375, -34, 0.375, 0, 1.8)).toBe(false);
    expect(w.overlaps(28.37, -34, 0.375, 0, 1.8)).toBe(true);
  });
  test('en una esquina convexa cuenta la distancia al vértice, no la caja', () => {
    expect(w.overlaps(-0.25, 0.25, 0.35, 0, 1.8)).toBe(false); // 0,354 m del vértice (0, 0)
    expect(w.overlaps(-0.24, 0.24, 0.35, 0, 1.8)).toBe(true); // 0,339 m
  });
  test('parado sobre el techo (pies = maxY) no superpone; apenas por debajo sí', () => {
    expect(w.overlaps(5, -5, 0.35, 3.8, 5.6)).toBe(false);
    expect(w.overlaps(5, -5, 0.35, 3.79, 5.59)).toBe(true);
  });
  test('un intervalo que termina en el suelo no superpone', () => expect(w.overlaps(5, -5, 0.35, -2, 0)).toBe(false));
  test('en la muesca de la L no hay superposición', () => expect(w.overlaps(34, -34, 0.35, 0, 1.8)).toBe(false));
});

describe('supportHeight', () => {
  test('el círculo que asoma sobre el borde cuenta; tocarlo a r no', () => {
    expect(w.supportHeight(-0.3, -5, 0.35, 4)).toBeCloseTo(3.8);
    expect(w.supportHeight(-0.35, -5, 0.35, 4)).toBe(0);
  });
  test('maxY es inclusivo', () => expect(w.supportHeight(5, -5, 0.35, 3.8)).toBeCloseTo(3.8));
  test('elige el techo más alto ≤ maxY entre varios', () => {
    const low: Prism = { polygon: [[0, 1], [2, 1], [2, -1], [0, -1]], minY: 0, maxY: 1 };
    const high: Prism = { polygon: [[2, 1], [4, 1], [4, -1], [2, -1]], minY: 0, maxY: 3 };
    const s = new CollisionWorld([low, high], [], bounds);
    expect(s.supportHeight(2, 0, 0.35, 5)).toBe(3);
    expect(s.supportHeight(2, 0, 0.35, 2)).toBe(1);
    expect(s.supportHeight(2, 0, 0.35, 0.5)).toBe(0);
  });
  test('la muesca de la L es suelo', () => expect(w.supportHeight(34, -34, 0.35, 100)).toBe(0));
});

describe('pushOut', () => {
  test('sin superposición devuelve la misma posición', () => expect(w.pushOut(-3, 3, 0.35, 0, 1.8)).toEqual([-3, 3]));
  test('ignora prismas que no se superponen en altura (parado en el techo)', () =>
    expect(w.pushOut(9.9, -5, 0.35, 3.8, 5.6)).toEqual([9.9, -5]));
  test('en una esquina convexa empuja radialmente desde el vértice', () =>
    expect(w.pushOut(-0.2, 0.2, 0.35, 0, 1.8)).toBeCloseTo2D([-0.35 / Math.SQRT2, 0.35 / Math.SQRT2], 4));
  test('en la esquina interior de la L queda a r de las dos paredes', () =>
    expect(w.pushOut(...insideInnerCorner)).toBeCloseTo2D([28.35, -28.35], 4));
  test('con el centro adentro sale por la arista más cercana', () =>
    expect(w.pushOut(5, -4, 0.35, 0, 1.8)).toBeCloseTo2D([5, 0.35], 4)); // z = 0 está a 4 m; las demás a ≥ 5
  test('adentro junto al vértice reflejo: sale y resuelve las dos paredes', () =>
    expect(w.pushOut(27.9, -27.9, 0.35, 0, 1.8)).toBeCloseTo2D([28.35, -28.35], 4));
  test('con el centro justo sobre una pared sale por esa pared', () => {
    expect(w.pushOut(10, -5, 0.35, 0, 1.8)).toBeCloseTo2D([10.35, -5], 4);
    expect(w.pushOut(0, -5, 0.35, 0, 1.8)).toBeCloseTo2D([-0.35, -5], 4);
  });
  test('con más contactos de los que entran se queda con los más profundos', () => {
    const post = (cx: number, cz: number): Prism => ({ polygon: [[cx - 0.01, cz + 0.01], [cx + 0.01, cz + 0.01], [cx + 0.01, cz - 0.01], [cx - 0.01, cz - 0.01]], minY: 0, maxY: 3 });
    // 9 postes finitos a 0,42 m (al alcance pero sin tocar) y, último en el orden, uno a 0,25 m que sí se mete
    const ring = Array.from({ length: 9 }, (_, i) => ((-80 + 20 * i) * Math.PI) / 180).map((a) => post(0.43 * Math.cos(a), 0.43 * Math.sin(a)));
    const s = new CollisionWorld([...ring, post(0.26, 0)], [], bounds);
    expect(s.pushOut(0, 0, 0.35, 0, 1.8)).toBeCloseTo2D([-0.1, 0], 4);
  });
  test('esquina formada por dos prismas distintos', () => {
    const a: Prism = { polygon: [[0, 1], [10, 1], [10, 0], [0, 0]], minY: 0, maxY: 3 }; // pared z ∈ [0, 1]
    const b: Prism = { polygon: [[0, 1], [1, 1], [1, -10], [0, -10]], minY: 0, maxY: 3 }; // pared x ∈ [0, 1]
    const s = new CollisionWorld([a, b], [], bounds);
    const p = s.pushOut(1.2, -0.2, 0.35, 0, 1.8);
    expect(p).toBeCloseTo2D([1.35, -0.35], 4);
    expect(s.overlaps(p[0], p[1], 0.35, 0, 1.8)).toBe(false);
  });
});

describe('pushOut caminando a 5 m/s con subpasos de 1/120 s', () => {
  const box = (x0: number, z0: number, x1: number, z1: number): Prism => ({ polygon: [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], minY: 0, maxY: 6 });
  /** Avanza el disco (r 0,35, y ∈ [0, 1,8]) y llama a pushOut tras cada subpaso; exige que nunca quede superpuesto. */
  function walk(ps: Prism[], start: Vec2, dir: Vec2, seconds: number, each: (p: Vec2) => void = () => {}): Vec2 {
    const ww = new CollisionWorld(ps, [], bounds);
    const l = Math.hypot(dir[0], dir[1]);
    const sx = (dir[0] / l) * (5 / 120), sz = (dir[1] / l) * (5 / 120);
    let p = start;
    for (let i = 0; i < seconds * 120; i++) {
      p = ww.pushOut(p[0] + sx, p[1] + sz, 0.35, 0, 1.8);
      expect(ww.overlaps(p[0], p[1], 0.35, 0, 1.8), `paso ${i}: ${p}`).toBe(false);
      each(p);
    }
    return p;
  }

  test('boca de 0,6 m entre dos cajas: se frena donde toca las dos esquinas', () => {
    const stop = Math.sqrt(0.35 ** 2 - 0.3 ** 2); // 0,1803
    const end = walk([box(0, -20, 10, 0), box(10.6, -20, 30, 0)], [10.3, 1], [0, -1], 3, (p) => expect(p[1]).toBeGreaterThanOrEqual(stop - 1e-3));
    expect(end).toBeCloseTo2D([10.3, 0.1803], 3);
  });
  test('pasaje que se angosta 1° por lado (1,0 m en la boca): no pasa del tope', () => {
    const α = Math.PI / 180;
    const d = 20 * Math.tan(α); // cada pared entra d en 20 m
    const a: Prism = { polygon: [[0, 0], [10, 0], [10 + d, -20], [0, -20]], minY: 0, maxY: 6 };
    const b: Prism = { polygon: [[11, 0], [30, 0], [30, -20], [11 - d, -20]], minY: 0, maxY: 6 };
    const stop = (0.35 - 0.5 * Math.cos(α)) / Math.sin(α); // distancia r a las dos paredes en el eje: ≈ −8,590
    const end = walk([a, b], [10.5, 1], [0, -1], 4, (p) => expect(p[1]).toBeGreaterThanOrEqual(stop - 1e-3));
    expect(end[1]).toBeCloseTo(-8.590, 2);
  });
  test('rincón en V de 15° entre dos edificios: se frena a r de las dos paredes', () => {
    const a = (7.5 * Math.PI) / 180;
    const [s, c] = [Math.sin(a), Math.cos(a)];
    const A: Prism = { polygon: [[0, 0], [-20 * s, 20 * c], [-30, 20 * c], [-30, -10], [0, -10]], minY: 0, maxY: 6 };
    const B: Prism = { polygon: [[0, 0], [0, -10], [30, -10], [30, 20 * c], [20 * s, 20 * c]], minY: 0, maxY: 6 };
    const stop = 0.35 / s; // 2,681
    const end = walk([A, B], [0, 15], [0, -1], 6, (p) => expect(p[1]).toBeGreaterThanOrEqual(stop - 1e-3));
    expect(end).toBeCloseTo2D([0, 2.681], 2);
  });
  test('hueco paralelo de 0,69 m: no entra', () => {
    const stop = Math.sqrt(0.35 ** 2 - 0.345 ** 2); // 0,0589
    const end = walk([box(0, -20, 10, 0), box(10.69, -20, 30, 0)], [10.345, 1], [0, -1], 3, (p) => expect(p[1]).toBeGreaterThanOrEqual(stop - 1e-3));
    expect(end[1]).toBeCloseTo(0.0589, 3);
  });
  test('justo encima de la línea de las esquinas no sale disparado (pliegue casi paralelo)', () => {
    const ww = new CollisionWorld([box(0, -20, 10, 0), box(10.695, -20, 30, 0)], [], bounds);
    const stop = Math.sqrt(0.35 ** 2 - 0.3475 ** 2); // 0,04176
    expect(ww.pushOut(10.3475, 0.0001, 0.35, 0, 1.8)).toBeCloseTo2D([10.3475, stop], 4);
  });
  test('si un paso cae adentro de un hueco < 2r, overlaps lo delata y rechazar el paso lo deja afuera', () => {
    // hueco de 0,699 m: el tope (0,019 m) queda más cerca que un subpaso (0,042 m), así que un paso entra al hueco
    const ww = new CollisionWorld([box(0, -20, 10, 0), box(10.699, -20, 30, 0)], [], bounds);
    const stop = Math.sqrt(0.35 ** 2 - 0.3495 ** 2);
    let p: Vec2 = [10.3495, 1];
    let rejected = 0;
    for (let i = 0; i < 360; i++) {
      const q = ww.pushOut(p[0], p[1] - 5 / 120, 0.35, 0, 1.8);
      if (ww.overlaps(q[0], q[1], 0.35, 0, 1.8)) rejected++; // lo que hará el controlador (Tarea 9)
      else p = q;
      expect(p[1]).toBeGreaterThanOrEqual(stop - 1e-3);
    }
    expect(rejected).toBeGreaterThan(0);
  });
  test('se desliza por la fachada de dos casas pegadas sin trabarse en la medianera', () => {
    const end = walk([box(0, -10, 10, 0), box(10, -10, 20, 0)], [2, 0.4], [1, -0.3], 3);
    expect(end).toBeCloseTo2D([2 + 15 / Math.sqrt(1.09), 0.35], 3); // conserva la componente tangencial: x ≈ 16,367
  });
});

describe('ladderAt', () => {
  test('devuelve el volumen dado, con y ∈ [0, topY]', () => {
    expect(w.ladderAt(...frontOfLadder, 0.35, 0)).toBe(ladder);
    expect(w.ladderAt(...frontOfLadder, 0.35, 7)).toBe(ladder);
    expect(w.ladderAt(...frontOfLadder, 0.35, 7.1)).toBeNull();
    expect(w.ladderAt(...frontOfLadder, 0.35, -0.5)).toBeNull();
  });
  test('el ancho es 0,8 m a lo largo de la pared y la profundidad 0,6 m hacia afuera', () => {
    expect(w.ladderAt(30, -19.4 + 0.34, 0.35, 1)).toBe(ladder);
    expect(w.ladderAt(30, -19.4 + 0.36, 0.35, 1)).toBeNull();
    expect(w.ladderAt(30.4 + 0.34, -19.7, 0.35, 1)).toBe(ladder);
    expect(w.ladderAt(30.4 + 0.36, -19.7, 0.35, 1)).toBeNull();
    expect(w.ladderAt(29.6 - 0.36, -19.7, 0.35, 1)).toBeNull();
  });
  test('la escalera no es un prisma', () => expect(w.overlaps(30, -19.7, 0.1, 0, 1.8)).toBe(false));
  test('escalera en una pared diagonal (normal a 30°)', () => {
    const n: Vec2 = [Math.cos(Math.PI / 6), 0.5]; // (0,866, 0,5)
    const t: Vec2 = [-0.5, Math.cos(Math.PI / 6)]; // tangente de la pared
    const diag: LadderVolume = { base: [0, 0], normal: n, topY: 5 };
    const dw = new CollisionWorld([], [diag], bounds);
    const out = (k: number, u: number): Vec2 => [n[0] * k + t[0] * u, n[1] * k + t[1] * u];
    expect(dw.ladderAt(...out(0.3, 0), 0.1, 1)).toBe(diag); // (0,260, 0,150)
    expect(dw.ladderAt(...out(0.3, 0.45), 0.1, 1)).toBe(diag); // 0,05 m fuera del ancho: el disco lo toca
    expect(dw.ladderAt(...out(0.3, 0.6), 0.1, 1)).toBeNull(); // 0,2 m fuera del ancho
    expect(dw.ladderAt(...out(0.3, -0.6), 0.1, 1)).toBeNull();
    expect(dw.ladderAt(...out(0.75, 0), 0.1, 1)).toBeNull(); // 0,15 m más allá de la profundidad
    expect(dw.ladderAt(...out(-0.15, 0), 0.1, 1)).toBeNull(); // detrás de la pared
  });
});

describe('raycast', () => {
  test('devuelve normal y tag de la cara golpeada', () => {
    expect(w.raycast([-10, 1, -5], [1, 0, 0], 100)).toMatchObject({ point: [0, 1, -5], normal: [-1, 0, 0], tag: 'A' });
    const roof = w.raycast([5, 20, -5], [0, -1, 0], 100)!;
    expect(roof).toMatchObject({ normal: [0, 1, 0], tag: 'A' });
    expect(roof.dist).toBeCloseTo(16.2);
  });
  test('golpea la base desde abajo', () => {
    const hit = w.raycast([5, -5, -5], [0, 1, 0], 100)!;
    expect(hit).toMatchObject({ point: [5, 0, -5], normal: [0, -1, 0] });
    expect(hit.dist).toBeCloseTo(5);
  });
  test('respeta maxDist', () => {
    expect(w.raycast([-10, 1, -5], [1, 0, 0], 9.9)).toBeNull();
    expect(w.raycast([-10, 1, -5], [1, 0, 0], 10.1)).not.toBeNull();
  });
  test('entra por la muesca de la L hasta la pared interior', () => {
    const hit = w.raycast([35, 3, -45], [0, 0, 1], 100)!; // la caja de la L diría z = −40
    expect(hit.dist).toBeCloseTo(17);
    expect(hit.normal).toEqual([0, 0, -1]);
    expect(hit.tag).toBe('L');
  });
  test('rayo diagonal largo que cruza varias celdas', () => {
    const d = Math.hypot(50, 25);
    const hit = w.raycast([-45, 2, -30], [50 / d, 0, 25 / d], 200)!; // llega a x = 0 en z = −7,5
    expect(hit.point[0]).toBeCloseTo(0);
    expect(hit.point[2]).toBeCloseTo(-7.5);
    expect(hit.dist).toBeCloseTo(Math.hypot(45, 22.5));
  });
  test('dir no normalizada se normaliza; dir nula no golpea', () => {
    expect(w.raycast([-10, 1, -5], [3, 0, 0], 100)!.dist).toBeCloseTo(10);
    expect(w.raycast([-10, 1, -5], [0, 0, 0], 100)).toBeNull();
  });
  test('un rayo que nace adentro de un prisma no lo golpea (solo caras de entrada)', () =>
    expect(w.raycast([5, 1, -5], [1, 0, 0], 100)).toBeNull());
  test('el suelo no es un prisma', () => expect(w.raycast([-20, 5, 20], [0, -1, 0], 100)).toBeNull());
});

test('polígonos en sentido horario se normalizan', () => {
  const cw = new CollisionWorld([{ ...square, polygon: [...square.polygon].reverse() }], [], bounds);
  const hit = cw.raycast([-10, 1, -5], [1, 0, 0], 100)!;
  expect(hit.dist).toBeCloseTo(10);
  expect(hit.normal).toEqual([-1, 0, 0]);
  expect(cw.pushOut(5, -4, 0.35, 0, 1.8)).toBeCloseTo2D([5, 0.35], 4);
});

// ---------- buildCollisionWorld ----------

const map: MapData = {
  version: 1,
  origin: { lat: 0, lon: 0 },
  bounds,
  buildings: [{ id: 'b7', footprint: [[0, 0], [10, 0], [10, -10], [0, -10]], height: 6.6, floors: 2, kind: 'house', wall: 'plaster', tint: '#ccc' }],
  outskirts: [{ footprint: [[-40, -30], [-30, -30], [-30, -40], [-40, -40]], height: 9 }],
  roads: [],
  railways: [],
  platforms: [[[20, 0], [30, 0], [30, -4], [20, -4]]],
  parks: [],
  places: [],
  props: [
    { kind: 'ladder', base: [5, 0], normal: [0, 1], topY: 6.6, buildingId: 'b7' },
    { kind: 'dumpster', position: [-10, 10], rotation: Math.PI / 4 },
    { kind: 'dumpster', position: [-20, 10], rotation: -Math.PI / 6 },
    { kind: 'bench', position: [-30, 10], rotation: Math.PI / 3 },
    { kind: 'fountain', position: [20, 20], radius: 2.5 },
    { kind: 'monument', placeId: 'm1', position: [0, 30], style: 'equestrian' },
    { kind: 'monument', placeId: 'm2', position: [10, 30], style: 'statue' },
    { kind: 'monument', placeId: 'm3', position: [20, 30], style: 'column' },
  ],
  trees: [{ position: [-10, -20], variant: 1, scale: 1.3 }],
  randomSpawns: [],
};
const bw = buildCollisionWorld(map);
const top = (x: number, z: number) => bw.raycast([x, 50, z], [0, -1, 0], 100);
const at = (x: number, z: number) => bw.overlaps(x, z, 0, 0, 0.3); // punto a ras del suelo
const along = (p: Vec2, axis: Vec2, d: number): Vec2 => [p[0] + axis[0] * d, p[1] + axis[1] * d];

describe('buildCollisionWorld', () => {
  test('conserva los bounds', () => expect(bw.bounds).toEqual(bounds));
  test('altura de techo y tag de cada elemento', () => {
    const cases: [Vec2, number, string][] = [
      [[5, -5], 6.6, 'b7'],
      [[25, -2], 1.0, 'platform'],
      [[-10, 10], 1.4, 'dumpster'],
      [[-20, 10], 1.4, 'dumpster'],
      [[-10, -20], 3, 'tree'],
      [[-30, 10], 0.5, 'bench'],
      [[20, 20], 0.6, 'fountain'],
      [[0, 30], 2.5, 'monument'],
      [[10, 30], 2.5, 'monument'],
      [[20, 30], 6, 'monument'],
    ];
    for (const [[x, z], h, tag] of cases) {
      const hit = top(x, z);
      expect(hit, tag).not.toBeNull();
      expect(hit!.point[1], tag).toBeCloseTo(h);
      expect(hit!.tag, tag).toBe(tag);
      expect(bw.overlaps(x, z, 0.1, h, h + 1.8), tag).toBe(false); // parado arriba
    }
  });
  test('los prismas apoyan en el suelo', () => expect(bw.raycast([5, -3, -5], [0, 1, 0], 10)!.point[1]).toBeCloseTo(0));
  test('outskirts no genera prismas', () => {
    expect(at(-35, -35)).toBe(false);
    expect(top(-35, -35)).toBeNull();
  });
  test('la escalera es un volumen y no un prisma', () => {
    expect(bw.ladderAt(5, 0.3, 0.35, 1)).toEqual({ base: [5, 0], normal: [0, 1], topY: 6.6 });
    expect(bw.ladderAt(5, 0.3, 0.35, 6.7)).toBeNull();
    expect(at(5, 0.3)).toBe(false);
    expect(top(5, 0.3)).toBeNull();
  });
  test.each<[number, Vec2]>([
    [Math.PI / 4, [-10, 10]],
    [-Math.PI / 6, [-20, 10]],
  ])('contenedor rotado θ = %f: lado largo 1,8 m sobre (cos θ, −sin θ)', (θ, c) => {
    const long: Vec2 = [Math.cos(θ), -Math.sin(θ)];
    const short: Vec2 = [Math.sin(θ), Math.cos(θ)];
    expect(at(...along(c, long, 0.85))).toBe(true);
    expect(at(...along(c, long, -0.85))).toBe(true);
    expect(at(...along(c, long, 0.95))).toBe(false);
    expect(at(...along(c, short, 0.85))).toBe(false);
    expect(at(...along(c, short, 0.5))).toBe(true); // medio ancho 0,55
    expect(at(...along(c, short, 0.6))).toBe(false);
  });
  test('banco de 1,8 × 0,6 m rotado', () => {
    const θ = Math.PI / 3;
    const c: Vec2 = [-30, 10];
    expect(at(...along(c, [Math.cos(θ), -Math.sin(θ)], 0.85))).toBe(true);
    expect(at(...along(c, [Math.sin(θ), Math.cos(θ)], 0.25))).toBe(true);
    expect(at(...along(c, [Math.sin(θ), Math.cos(θ)], 0.35))).toBe(false);
  });
  test('tronco: octógono de r = 0,3', () => {
    expect(at(-10 + 0.25, -20)).toBe(true);
    expect(at(-10, -20 - 0.25)).toBe(true);
    expect(at(-10 + 0.35, -20)).toBe(false);
  });
  test('fuente: octógono de r = radio', () => {
    expect(at(20 + 2.2, 20)).toBe(true);
    expect(at(20, 20 - 2.2)).toBe(true);
    expect(at(20 + 2.6, 20)).toBe(false);
  });
  test('pedestales cuadrados alineados a los ejes: 3 × 3 m y 2 × 2 m para la columna', () => {
    expect(at(0 + 1.4, 30 + 1.4)).toBe(true); // esquina: un octógono o un cuadrado girado no llega
    expect(at(0 + 1.6, 30)).toBe(false);
    expect(at(10 - 1.4, 30 - 1.4)).toBe(true);
    expect(at(20 + 0.9, 30 - 0.9)).toBe(true);
    expect(at(20 + 1.1, 30)).toBe(false);
  });
  test('andén y edificio cubren su polígono', () => {
    expect(at(29.9, -3.9)).toBe(true);
    expect(at(30.1, -2)).toBe(false);
    expect(at(9.9, -9.9)).toBe(true);
  });
});

// ---------- grilla espacial ----------

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Prisma al azar alrededor de (cx, cz): caja rotada, octógono o L cóncava. Con k = 1 cabe en ±18 m del centro. */
function prismAt(rand: () => number, cx: number, cz: number, k = 1): Prism {
  const maxY = 0.3 + rand() * 15;
  const kind = rand();
  if (kind < 0.5) {
    const a = rand() * Math.PI;
    const hl = (0.5 + rand() * 12) * k;
    const hd = (0.5 + rand() * 12) * k;
    const ux = Math.cos(a) * hl, uz = -Math.sin(a) * hl, vx = Math.sin(a) * hd, vz = Math.cos(a) * hd;
    return { polygon: [[cx - ux + vx, cz - uz + vz], [cx + ux + vx, cz + uz + vz], [cx + ux - vx, cz + uz - vz], [cx - ux - vx, cz - uz - vz]], minY: 0, maxY };
  }
  if (kind < 0.8) {
    const r = (0.3 + rand() * 4) * k;
    const polygon: Vec2[] = Array.from({ length: 8 }, (_, i) => [cx + r * Math.cos((i * Math.PI) / 4), cz - r * Math.sin((i * Math.PI) / 4)]);
    return { polygon, minY: 0, maxY };
  }
  const s = (2 + rand() * 20) * k;
  const x0 = cx - s / 2, z0 = cz + s / 2;
  return { polygon: [[x0, z0], [x0 + s, z0], [x0 + s, z0 - s / 2], [x0 + s / 2, z0 - s / 2], [x0 + s / 2, z0 - s], [x0, z0 - s]], minY: 0, maxY };
}

const randomPrism = (rand: () => number, half: number): Prism => prismAt(rand, (rand() * 2 - 1) * half, (rand() * 2 - 1) * half);

function randomLadder(rand: () => number, half: number): LadderVolume {
  const a = rand() * 2 * Math.PI;
  return { base: [(rand() * 2 - 1) * half, (rand() * 2 - 1) * half], normal: [Math.cos(a), Math.sin(a)], topY: 2 + rand() * 10 };
}

const discHits = (p: Prism, x: number, z: number, r: number): boolean =>
  pointInPolygon([x, z], p.polygon) || p.polygon.some((a, i) => distPointSegment([x, z], a, p.polygon[(i + 1) % p.polygon.length]) < r);

describe('grilla espacial', () => {
  const rand = rng(42);
  const prisms = Array.from({ length: 400 }, () => randomPrism(rand, 120));
  const ladders = Array.from({ length: 60 }, () => randomLadder(rand, 120));
  const wb: Bounds = { minX: -150, maxX: 150, minZ: -150, maxZ: 150 };
  const worlds = [16, 2.5, 1e5].map((size) => new CollisionWorld(prisms, ladders, wb, size));
  // la mitad de las consultas cae a ≤ 1,5 m del frente de una escalera
  const near = (): Vec2 => {
    const l = ladders[Math.floor(rand() * ladders.length)];
    return [l.base[0] + l.normal[0] * 0.3 + (rand() * 2 - 1) * 1.5, l.base[1] + l.normal[1] * 0.3 + (rand() * 2 - 1) * 1.5];
  };
  const queries = Array.from({ length: 1500 }, (_, i) => {
    const [x, z] = i % 2 ? near() : [(rand() * 2 - 1) * 140, (rand() * 2 - 1) * 140];
    const dir: Vec3 = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
    return { x, z, r: rand() * 1.5, y: rand() * 16, dir, len: rand() * 150 };
  });

  test('overlaps y supportHeight coinciden con la fuerza bruta en cualquier tamaño de celda', () => {
    for (const q of queries) {
      const ov = prisms.some((p) => q.y < p.maxY && q.y + 1.8 > p.minY && discHits(p, q.x, q.z, q.r));
      const sup = prisms.reduce((m, p) => (p.maxY <= q.y && p.maxY > m && discHits(p, q.x, q.z, q.r) ? p.maxY : m), 0);
      for (const wd of worlds) {
        expect(wd.overlaps(q.x, q.z, q.r, q.y, q.y + 1.8)).toBe(ov);
        expect(wd.supportHeight(q.x, q.z, q.r, q.y)).toBe(sup);
      }
    }
  });
  test('pushOut, ladderAt y raycast no dependen del tamaño de celda', () => {
    let hits = 0, ladderHits = 0;
    for (const q of queries) {
      const [ref, ...rest] = worlds.map((wd) => [
        wd.pushOut(q.x, q.z, q.r, q.y, q.y + 1.8),
        wd.ladderAt(q.x, q.z, q.r, q.y),
        wd.raycast([q.x, q.y, q.z], q.dir, q.len),
      ]);
      if (ref[1]) ladderHits++;
      if (ref[2]) hits++;
      for (const o of rest) expect(o).toEqual(ref);
    }
    expect(hits).toBeGreaterThan(100); // la prueba cubre rayos que golpean
    expect(ladderHits).toBeGreaterThan(100); // y escaleras encontradas
  });
  test('pushOut libera el disco con el mínimo movimiento si no hay huecos más angostos que 2r', () => {
    // Una L, caja u octógono por celda de 30 m, todos a ≤ 12,4 m del centro: entre prismas quedan ≥ 5 m.
    const r3 = rng(3);
    const ps: Prism[] = [];
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) ps.push(prismAt(r3, -285 + 30 * i, -285 + 30 * j, 0.7));
    const lw = new CollisionWorld(ps, [], { minX: -300, maxX: 300, minZ: -300, maxZ: 300 });
    let inside = 0;
    for (let n = 0; n < 3000; n++) {
      // arranque cerca del borde de un prisma: hasta 2 m adentro o a menos de r afuera
      const p = ps[Math.floor(r3() * ps.length)].polygon;
      const e = Math.floor(r3() * p.length);
      const [a, b] = [p[e], p[(e + 1) % p.length]];
      const t = r3();
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const out = r3() * 2.35 - 2; // ∈ [−2, 0,35)
      const s: Vec2 = [a[0] + (b[0] - a[0]) * t - ((b[1] - a[1]) / len) * out, a[1] + (b[1] - a[1]) * t + ((b[0] - a[0]) / len) * out];
      const d = Math.min(...p.map((q, i) => distPointSegment(s, q, p[(i + 1) % p.length])));
      const isIn = pointInPolygon(s, p);
      if (isIn) inside++;
      const [x, z] = lw.pushOut(s[0], s[1], 0.35, 0, 1.8);
      expect(lw.overlaps(x, z, 0.35, 0, 1.8), `${s}`).toBe(false);
      // a lo sumo: salir (d) y despegarse de las dos paredes de un rincón de 90° (r·√2)
      expect(Math.hypot(x - s[0], z - s[1]), `${s}`).toBeLessThanOrEqual((isIn ? d : 0) + 0.35 * Math.SQRT2 + 1e-3);
    }
    expect(inside).toBeGreaterThan(1000); // cubre arranques adentro y afuera
  });
  test('2000 prismas y 10 000 consultas en < 200 ms', () => {
    const r2 = rng(7);
    const ps = Array.from({ length: 2000 }, () => randomPrism(r2, 600));
    const ls = Array.from({ length: 400 }, () => randomLadder(r2, 600));
    const qs = Array.from({ length: 2000 }, () => ({
      x: (r2() * 2 - 1) * 600,
      z: (r2() * 2 - 1) * 600,
      y: r2() * 10,
      dir: [r2() * 2 - 1, r2() * 0.4 - 0.2, r2() * 2 - 1] as Vec3,
    }));
    const t0 = performance.now();
    const big = new CollisionWorld(ps, ls, { minX: -700, maxX: 700, minZ: -700, maxZ: 700 });
    let sink = 0;
    for (const q of qs) {
      if (big.overlaps(q.x, q.z, 0.35, q.y, q.y + 1.8)) sink++;
      sink += big.supportHeight(q.x, q.z, 0.35, q.y + 0.45);
      sink += big.pushOut(q.x, q.z, 0.35, q.y, q.y + 1.8)[0];
      if (big.ladderAt(q.x, q.z, 0.35, q.y)) sink++;
      sink += big.raycast([q.x, q.y + 1.65, q.z], q.dir, 100)?.dist ?? 0;
    }
    const ms = performance.now() - t0;
    expect(Number.isFinite(sink)).toBe(true);
    expect(ms).toBeLessThan(200);
  });
});
