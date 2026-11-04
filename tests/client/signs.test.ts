// @vitest-environment jsdom
import * as THREE from 'three';
import { PAGE, PX_PER_M, TYPE_LOOK, buildSigns, packSigns, signTexture } from '../../src/client/world/signs.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Place, Sign, SignLook } from '../../src/shared/mapdata.ts';
import { stubCanvas } from './canvas-stub.ts';

beforeEach(() => stubCanvas());
afterEach(() => vi.restoreAllMocks());

const placeWithSign: Place = {
  id: 'guernica-bar', name: 'Guernica Bar', type: 'bar', position: [-61.04, 158.97], enterable: false, buildingId: 'b0867',
  sign: { text: 'GUERNICA BAR', anchor: [-55.02, 171.99], normal: [0.862, -0.507], width: 5.06, bottomY: 3 },
  spawn: [-50, 0, 170],
};
const plaza: Place = { id: 'plaza', name: 'Plaza', type: 'plaza', position: [0, 0], enterable: false, spawn: [0, 0, 0] };

/** Caja del cartel ya en el mundo (la malla de la página trae las posiciones horneadas). */
const boxOf = (m: THREE.Mesh): THREE.Box3 => {
  m.geometry.computeBoundingBox();
  return m.geometry.boundingBox!;
};
/** Hacia dónde mira la cara del frente en el plano (x, z): la normal de los vértices que más se alejan del centro. */
const facing = (m: THREE.Mesh, normal: Vec2): Vec2 => {
  const n = m.geometry.getAttribute('normal');
  let best: Vec2 = [0, 0], score = -2;
  for (let i = 0; i < n.count; i++) {
    const d = n.getX(i) * normal[0] + n.getZ(i) * normal[1];
    if (d > score) { score = d; best = [n.getX(i), n.getZ(i)]; }
  }
  return best;
};

test('cartel con medidas y orientación del MapData', () => {
  const m = buildSigns([placeWithSign], []).children[0] as THREE.Mesh;
  const { normal, width } = placeWithSign.sign!;
  const size = boxOf(m).getSize(new THREE.Vector3());
  // el alto es el 0,9 y el espesor (0,12) y el ancho se reparten entre el plano y la normal, que está girada
  expect(size.y).toBeCloseTo(0.9, 4);
  const len = Math.hypot(...normal);
  const [nx, nz] = [normal[0] / len, normal[1] / len];
  expect(size.x).toBeCloseTo(Math.abs(nz) * width + Math.abs(nx) * 0.12, 3);
  expect(size.z).toBeCloseTo(Math.abs(nx) * width + Math.abs(nz) * 0.12, 3);
  expect(facing(m, normal)).toBeCloseTo2D([nx, nz], 4);
});

test('el centro queda 6 cm afuera de la pared y con la base a bottomY', () => {
  const m = buildSigns([placeWithSign], []).children[0] as THREE.Mesh;
  const { anchor, normal, bottomY } = placeWithSign.sign!;
  const c = boxOf(m).getCenter(new THREE.Vector3());
  expect([c.x, c.z]).toBeCloseTo2D([anchor[0] + normal[0] * 0.06, anchor[1] + normal[1] * 0.06], 3);
  expect(c.y).toBeCloseTo(bottomY + 0.45, 4);
});

/** Rango de u, v de las caras que cumplen `pick` (por el producto de la normal con la dirección del frente). */
const uvRange = (m: THREE.Mesh, dir: Vec2, pick: (d: number) => boolean): { u: number[]; v: number[] } => {
  const n = m.geometry.getAttribute('normal'), uv = m.geometry.getAttribute('uv');
  const u: number[] = [], v: number[] = [];
  for (let i = 0; i < n.count; i++) if (pick(n.getX(i) * dir[0] + n.getZ(i) * dir[1])) { u.push(uv.getX(i)); v.push(uv.getY(i)); }
  return { u, v };
};

test('un cartel por lugar con sign; los lugares sin cartel no suman (todos en una malla)', () => {
  const g = buildSigns([placeWithSign, plaza, { ...placeWithSign, id: 'otro' }], []);
  expect(g.children).toHaveLength(1);
  expect(g.children[0].name).toBe('signs:0');
  expect((g.children[0] as THREE.Mesh).geometry.getIndex()?.count).toBe(2 * 36);
});

test('el nombre va solo en la cara del frente; el resto de las caras usa un punto del marco', () => {
  const m = buildSigns([placeWithSign], []).children[0] as THREE.Mesh;
  const front = uvRange(m, placeWithSign.sign!.normal, (d) => d > 0.5);
  const rest = uvRange(m, placeWithSign.sign!.normal, (d) => d <= 0.5);
  // la página se recorta al alto del cartel: el frente ocupa todo el alto
  expect(Math.min(...front.v)).toBeCloseTo(0);
  expect(Math.max(...front.v)).toBeCloseTo(1);
  expect(Math.min(...front.u)).toBeCloseTo(0);
  expect(Math.max(...front.u)).toBeCloseTo(Math.round(5.06 * PX_PER_M) / PAGE, 3); // la página tiene el ancho de PAGE
  expect(new Set(rest.u.map((x, i) => `${x.toFixed(5)},${rest.v[i].toFixed(5)}`)).size).toBe(1);
  expect(Math.min(...rest.u)).toBeLessThan(0.01);
});

const look = (over: Partial<SignLook> = {}): SignLook => ({ fondo: '#112233', letra: '#ddeeff', marco: '#445566', fuente: 'sans', ...over });
const sign = (i: number, over: Partial<Sign> = {}): Sign => ({
  text: `LOCAL ${i}`, anchor: [i * 7, 100], normal: [0, -1], width: 2.5 + (i % 5) * 0.8, bottomY: 2.4, look: look(), ...over,
});

test('28 lugares y 50 carteles: 3 mallas como mucho, UV dentro de [0, 1] y bandera con dos caras con textura', () => {
  const places: Place[] = Array.from({ length: 28 }, (_, i) => ({
    ...plaza, id: `p${i}`, type: 'bar', sign: sign(i, { look: i % 2 ? undefined : look() }),
  }));
  const signs = Array.from({ length: 50 }, (_, i) => sign(i + 28, i % 4 === 0 ? { blade: true, width: 1.2, normal: [1, 0] } : {}));
  const g = buildSigns(places, signs);
  expect(g.children.length).toBeGreaterThanOrEqual(1);
  expect(g.children.length).toBeLessThanOrEqual(3);
  g.children.forEach((c, i) => {
    const m = c as THREE.Mesh;
    expect(m.name).toBe(`signs:${i}`);
    const uv = m.geometry.getAttribute('uv');
    for (let k = 0; k < uv.count; k++) {
      expect(uv.getX(k)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(k)).toBeLessThanOrEqual(1);
      expect(uv.getY(k)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(k)).toBeLessThanOrEqual(1);
    }
  });
  const total = g.children.reduce((a, c) => a + (c as THREE.Mesh).geometry.getIndex()!.count / 36, 0);
  expect(total).toBe(78);
});

test('un cartel de bandera tiene textura en las dos caras y la de atrás va espejada en x', () => {
  const g = buildSigns([], [sign(0, { blade: true, width: 1.2, normal: [1, 0] })]);
  const m = g.children[0] as THREE.Mesh;
  const pos = m.geometry.getAttribute('position'), n = m.geometry.getAttribute('normal'), uv = m.geometry.getAttribute('uv');
  // en el marco del mundo (rotación y = 90°) el frente mira a +x; la cara de atrás a -x
  const face = (sgn: number) => {
    const pts: { z: number; u: number; v: number }[] = [];
    for (let i = 0; i < n.count; i++) if (n.getX(i) * sgn > 0.5) pts.push({ z: pos.getZ(i), u: uv.getX(i), v: uv.getY(i) });
    return pts;
  };
  const front = face(1), back = face(-1);
  const span = (p: { u: number }[]) => Math.max(...p.map((q) => q.u)) - Math.min(...p.map((q) => q.u));
  expect(span(front)).toBeGreaterThan(0.05);
  expect(span(back)).toBeGreaterThan(0.05);
  // visto desde cada lado el texto avanza hacia la derecha: sobre el eje z del mundo, u crece en sentidos contrarios
  const dir = (p: typeof front) => {
    const mu = p.reduce((a, q) => a + q.u, 0) / p.length, mz = p.reduce((a, q) => a + q.z, 0) / p.length;
    return Math.sign(p.reduce((a, q) => a + (q.u - mu) * (q.z - mz), 0));
  };
  expect(dir(front)).not.toBe(0);
  expect(dir(front)).toBe(-dir(back));
});

test('un cartel sin look usa el de su tipo', () => {
  const calls: string[] = [];
  stubCanvas((prop, value) => { if (prop === 'fillStyle') calls.push(String(value)); });
  buildSigns([placeWithSign], []);
  expect(calls).toContain(TYPE_LOOK.bar.fondo);
  expect(calls).toContain(TYPE_LOOK.bar.marco);
});

test('la textura tiene la proporción del cartel', () => {
  const c = signTexture('MCDONALD\'S', TYPE_LOOK.fastfood, 2.83);
  expect(c.width / c.height).toBeCloseTo(2.83 / 0.9, 1);
  const d = signTexture('BANCO NACIÓN', TYPE_LOOK.bank, 6);
  expect(d.width / d.height).toBeCloseTo(6 / 0.9, 1);
  expect(PX_PER_M).toBe(128);
});

test('un cartel más ancho que la página se achica para entrar, sin deformarse', () => {
  const c = signTexture('MUY LARGO', look(), 40);
  expect(c.width).toBeLessThanOrEqual(PAGE - 8);
  expect(c.width / c.height).toBeCloseTo(40 / 0.9, 0);
  const g = buildSigns([], [sign(0, { width: 40 })]);
  expect(g.children).toHaveLength(1);
});

test('signTexture con un look pinta fondo, letra y marco, y usa su fuente', () => {
  const sets: Record<string, unknown[]> = {};
  stubCanvas((prop, value) => { (sets[prop] ??= []).push(value); });
  signTexture('CAFÉ', look({ fuente: 'serif', fondo: '#aa0000', letra: '#00bb00', marco: '#0000cc' }), 3);
  const paint = [...(sets.fillStyle ?? []), ...(sets.strokeStyle ?? [])];
  for (const c of ['#aa0000', '#00bb00', '#0000cc']) expect(paint).toContain(c);
  expect((sets.font ?? []).some((f) => /Georgia|serif/.test(String(f)))).toBe(true);
});

test('fondo y tipografía cambian según el look', () => {
  const drawn = (l: SignLook) => {
    const calls: string[] = [];
    stubCanvas((prop, value) => { if (prop === 'fillStyle' || prop === 'font') calls.push(`${prop}=${String(value)}`); });
    signTexture('NOMBRE', l, 3);
    return calls.join('|');
  };
  expect(drawn(TYPE_LOOK.bank)).not.toBe(drawn(TYPE_LOOK.bar));
  expect(drawn(look({ fuente: 'condensada' }))).not.toBe(drawn(look({ fuente: 'redondeada' })));
});

test('texto largo: 40 caracteres en 2 m salen en dos líneas, con letra visible y sin pasarse del ancho', () => {
  stubCanvas();
  const stub = (HTMLCanvasElement.prototype.getContext as unknown as { getMockImplementation(): () => CanvasRenderingContext2D }).getMockImplementation()!;
  const drawn: { text: string; font: string; width: number }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => {
    const ctx = stub.call(null);
    return new Proxy(ctx, {
      get(t, prop) {
        if (prop === 'fillText') return (text: string) => drawn.push({ text, font: t.font, width: t.measureText(text).width });
        const v = Reflect.get(t, prop);
        return typeof v === 'function' ? v.bind(t) : v;
      },
      set(t, prop, value) { return Reflect.set(t, prop, value); },
    });
  }) as never);
  const c = signTexture('SOCIEDAD DE FOMENTO BARRIO NORTE Y ANEXOS', look(), 2);
  expect('SOCIEDAD DE FOMENTO BARRIO NORTE Y ANEXOS'.length).toBeGreaterThanOrEqual(40);
  expect(drawn).toHaveLength(2);
  for (const d of drawn) {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(d.font)![1]);
    expect(px).toBeGreaterThan(0);
    expect(d.width).toBeLessThanOrEqual(c.width);
  }
});

describe('packSigns', () => {
  const sizes = Array.from({ length: 120 }, (_, i) => ({ w: 200 + ((i * 97) % 700), h: 115 }));
  test('no se pisan (ni con el margen) y caen dentro de su página', () => {
    const { rects, pages } = packSigns(sizes, 2048, 4);
    expect(rects).toHaveLength(sizes.length);
    rects.forEach((r, i) => {
      expect([r.w, r.h]).toEqual([sizes[i].w, sizes[i].h]);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(pages[r.page].w);
      expect(r.y + r.h).toBeLessThanOrEqual(pages[r.page].h);
    });
    for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
      const p = rects[a], q = rects[b];
      if (p.page !== q.page) continue;
      const apart = p.x + p.w + 4 <= q.x || q.x + q.w + 4 <= p.x || p.y + p.h + 4 <= q.y || q.y + q.h + 4 <= p.y;
      expect(apart, `${a} y ${b}`).toBe(true);
    }
  });
  test('es determinista', () => {
    expect(packSigns(sizes)).toEqual(packSigns(sizes));
  });
  test('abre página nueva cuando no entra más y recorta la última', () => {
    const r = packSigns(Array.from({ length: 5 }, () => ({ w: 1500, h: 1500 })), 2048, 4);
    expect(r.pages).toHaveLength(5);
    expect(r.pages.slice(0, 4).every((p) => p.w === 2048 && p.h === 2048)).toBe(true);
    expect(r.pages[4].h).toBe(1500);
    expect(r.rects.map((x) => x.page)).toEqual([0, 1, 2, 3, 4]);
  });
});
