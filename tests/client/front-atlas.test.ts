// @vitest-environment jsdom
import * as THREE from 'three';
import { ATLAS_COLS, FRONT_CELLS, GUTTER, SHOP_GLASS, cellRect, composeFrontAtlas, frontMaterial, groundCells, packAtlas, upperCell } from '../../src/client/world/front-atlas.ts';
import type { FrontCell } from '../../src/client/world/front-atlas.ts';
import { WINDOW_GLASS } from '../../src/client/world/facades.ts';
import { BAY_W, FLOOR_H } from '../../src/client/world/wall-kit.ts';
import { BAY_W as OPENINGS_BAY_W, LOT_OPENINGS } from '../../src/shared/interiors/openings.ts';
import type { LotCell } from '../../src/shared/interiors/openings.ts';
import type { PlantaBaja } from '../../src/shared/mapdata.ts';
import { stubCanvas } from './canvas-stub.ts';

beforeEach(() => stubCanvas());
afterEach(() => vi.restoreAllMocks());

describe('cellRect', () => {
  test('23 celdas que no se pisan y quedan dentro de [0, 1]', () => {
    expect(FRONT_CELLS).toHaveLength(23);
    const rects = FRONT_CELLS.map((c) => cellRect(c));
    for (const r of rects) {
      expect(r.u0).toBeGreaterThanOrEqual(0);
      expect(r.v0).toBeGreaterThanOrEqual(0);
      expect(r.u1).toBeLessThanOrEqual(1);
      expect(r.v1).toBeLessThanOrEqual(1);
      expect(r.u1).toBeGreaterThan(r.u0);
      expect(r.v1).toBeGreaterThan(r.v0);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const overlap = a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1;
        expect(overlap, `${FRONT_CELLS[i]} / ${FRONT_CELLS[j]}`).toBe(false);
      }
    }
  });

  test('el margen mide GUTTER/size de cada lado', () => {
    const size = 2048;
    const r = cellRect('vidriera', size);
    expect(r.u0).toBeCloseTo(GUTTER / size);
    expect(r.u1 - r.u0).toBeCloseTo(1 / ATLAS_COLS - (2 * GUTTER) / size);
    expect(r.v1).toBeCloseTo(1 - GUTTER / size);
    const r2 = cellRect('vidriera-puerta', size);
    expect(r2.u0 - r.u1).toBeCloseTo((2 * GUTTER) / size);
  });

  test('la celda 0 (arriba a la izquierda del canvas) tiene v1 ≈ 1 y la 5 queda debajo', () => {
    expect(cellRect(FRONT_CELLS[0]).v1).toBeGreaterThan(0.99);
    expect(cellRect(FRONT_CELLS[0]).u0).toBeLessThan(0.01);
    expect(cellRect(FRONT_CELLS[5]).v1).toBeLessThan(cellRect(FRONT_CELLS[0]).v0 + 1e-9);
  });
});

describe('groundCells', () => {
  const table: [PlantaBaja, string, string][] = [
    ['vidriera', 'vidriera-puerta', 'vidriera'],
    ['persiana', 'persiana', 'persiana'],
    ['porton', 'porton', 'ventana-pb'],
    ['puerta', 'puerta', 'ventana-pb'],
    ['banco', 'banco-puerta', 'banco'],
    ['acceso', 'acceso', 'vidriera'],
    ['pared', 'pared-pb', 'pared-pb'],
  ];
  test.each(table)('%s', (pb, door, rest) => {
    expect(groundCells(pb, false)).toEqual({ door, rest });
  });
  test('con ladrillo usa la variante -l cuando existe', () => {
    expect(groundCells('porton', true)).toEqual({ door: 'porton-l', rest: 'ventana-pb-l' });
    expect(groundCells('puerta', true)).toEqual({ door: 'puerta-l', rest: 'ventana-pb-l' });
    expect(groundCells('pared', true)).toEqual({ door: 'pared-pb-l', rest: 'pared-pb-l' });
    expect(groundCells('vidriera', true)).toEqual({ door: 'vidriera-puerta', rest: 'vidriera' });
    expect(groundCells('persiana', true)).toEqual({ door: 'persiana', rest: 'persiana' });
  });
  test('pisos de arriba', () => {
    expect(upperCell('ventanas', false)).toBe('ventana');
    expect(upperCell('balcones', false)).toBe('balcon');
    expect(upperCell('vidriado', false)).toBe('vidriado');
    expect(upperCell('ciego', false)).toBe('pared');
    expect(upperCell('ventanas', true)).toBe('ventana-l');
    expect(upperCell('balcones', true)).toBe('balcon-l');
    expect(upperCell('vidriado', true)).toBe('vidriado');
    expect(upperCell('ciego', true)).toBe('pared-l');
  });
});

test('packAtlas: voltea las filas (v = 0 abajo) y A es la R de la máscara', () => {
  // Canvas 2 × 2, filas de arriba abajo: píxel (0,0) = 10,20,30; el resto, distinguible.
  const color = new Uint8ClampedArray([10, 20, 30, 255, 11, 21, 31, 255, 12, 22, 32, 255, 13, 23, 33, 255]);
  const mask = new Uint8ClampedArray([255, 0, 0, 255, 100, 0, 0, 255, 0, 0, 0, 255, 50, 0, 0, 255]);
  const out = packAtlas(color, mask, 2);
  expect(out).toBeInstanceOf(Uint8Array);
  expect(out).toHaveLength(16);
  // Fila de abajo del texel = primera fila del canvas... y la de arriba del canvas va en la última.
  expect([...out.slice(8, 12)]).toEqual([10, 20, 30, 255]);
  expect([...out.slice(12, 16)]).toEqual([11, 21, 31, 100]);
  expect([...out.slice(0, 4)]).toEqual([12, 22, 32, 0]);
  expect([...out.slice(4, 8)]).toEqual([13, 23, 33, 50]);
});

test('composeFrontAtlas devuelve dos canvas cuadrados del lado pedido', () => {
  const img = { revoque: {}, ladrillo: {}, metal: {}, madera: {} } as never;
  const { color, mask } = composeFrontAtlas(img, 1024);
  expect([color.width, color.height, mask.width, mask.height]).toEqual([1024, 1024, 1024, 1024]);
});

describe('aberturas de los lotes', () => {
  const img = { revoque: {}, ladrillo: {}, metal: {}, madera: {} } as never;
  const size = 1024;
  /** Rectángulos [x, y, w, h] (px de la celda, antes de escalar a lo alto) donde se pinta vidrio: los fillRect que siguen a
   *  un degradado (`glass`). Cada celda arranca con dos translate (el color y la máscara). */
  function glassRects(cell: LotCell): number[][] {
    vi.restoreAllMocks();
    const calls: { m: string; a: unknown[] }[] = [];
    stubCanvas(undefined, (m, a) => calls.push({ m, a }));
    composeFrontAtlas(img, size);
    const starts = calls.flatMap((c, k) => (c.m === 'translate' ? [k] : []));
    const i = FRONT_CELLS.indexOf(cell);
    const seg = calls.slice(starts[2 * i + 1], starts[2 * i + 2] ?? calls.length);
    return seg.flatMap((c, k) => (c.m === 'createLinearGradient' ? [seg.slice(k).find((d) => d.m === 'fillRect')!.a as number[]] : []));
  }

  test('las medidas de LOT_OPENINGS son las del atlas: bahías de BAY_W', () => expect(OPENINGS_BAY_W).toBe(BAY_W));

  /** Los colores de cada vidrio pintado de la celda: las paradas de cada degradado (`glass`). */
  function glassStops(cell: FrontCell): string[][] {
    vi.restoreAllMocks();
    const calls: { m: string; a: unknown[] }[] = [];
    stubCanvas(undefined, (m, a) => calls.push({ m, a }));
    composeFrontAtlas(img, size);
    const starts = calls.flatMap((c, k) => (c.m === 'translate' ? [k] : []));
    const i = FRONT_CELLS.indexOf(cell);
    const seg = calls.slice(starts[2 * i + 1], starts[2 * i + 2] ?? calls.length);
    return seg.flatMap((c, k) => (c.m === 'createLinearGradient' ? [seg.slice(k + 1, k + 4).map((d) => String(d.a[1]))] : []));
  }

  test.each([
    ...(Object.keys(LOT_OPENINGS) as LotCell[]).map((c): [FrontCell, readonly string[]] => [c, SHOP_GLASS]),
    // los pisos de arriba (también el vidriado, N5) y la planta baja que no es de lote, con el vidrio de siempre
    ...(['vidriado', 'ventana', 'balcon', 'ventana-pb'] as const).map((c): [FrontCell, readonly string[]] => [c, WINDOW_GLASS]),
  ])('%s: el vidrio claro de las vidrieras y puertas (la tapa de los interiores) va solo en las celdas de lote de planta baja', (cell, want) => {
    const got = glassStops(cell);
    expect(got.length, cell).toBeGreaterThan(0);
    for (const stops of got) expect(stops).toEqual([...want]);
  });

  test.each(Object.keys(LOT_OPENINGS) as LotCell[])('%s: el vidrio y la hoja de la puerta van exactamente en sus rectángulos', (cell) => {
    const u = (Math.round(size / ATLAS_COLS) - 2 * GUTTER) / BAY_W;
    const want = LOT_OPENINGS[cell].map((o) => [o.x0 * u, (FLOOR_H - o.y1) * u, (o.x1 - o.x0) * u, (o.y1 - o.y0) * u]);
    const got = glassRects(cell);
    const byX = (a: number[], b: number[]): number => a[0] - b[0];
    expect(got.length).toBe(want.length);
    [...got].sort(byX).forEach((r, k) => {
      const w = [...want].sort(byX)[k];
      for (let j = 0; j < 4; j++) expect(Math.abs(r[j] - w[j]), `${cell} rect ${k}[${j}]: ${r} vs ${w}`).toBeLessThanOrEqual(0.5);
    });
  });
});

describe('frontMaterial', () => {
  const shader = () => ({ fragmentShader: 'a\n#include <color_fragment>\nb', vertexShader: '' });
  test.each([true, false])('reemplaza color_fragment por la máscara (lambert=%s)', (lambert) => {
    const map = new THREE.Texture();
    const mat = frontMaterial(map, lambert) as THREE.MeshStandardMaterial;
    expect(mat).toBeInstanceOf(lambert ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial);
    expect(mat.map).toBe(map);
    expect(mat.vertexColors).toBe(true);
    expect(mat.normalMap).toBeNull();
    const s = shader();
    mat.onBeforeCompile(s as never, {} as never);
    expect(s.fragmentShader).toContain('sampledDiffuseColor.a');
    expect(s.fragmentShader).not.toContain('#include <color_fragment>');
    expect(mat.customProgramCacheKey()).toBe('front-mask');
  });
  test('si three ya no tiene color_fragment, el parche no falla en silencio', () => {
    const mat = frontMaterial(new THREE.Texture(), true);
    const s = { fragmentShader: 'a\nb', vertexShader: '' };
    expect(() => mat.onBeforeCompile(s as never, {} as never)).toThrow('frontMaterial: el shader de three no tiene #include <color_fragment>');
  });
  test('en media/alta es standard con roughness 0,85 y metalness 0', () => {
    const mat = frontMaterial(new THREE.Texture(), false) as THREE.MeshStandardMaterial;
    expect(mat.roughness).toBe(0.85);
    expect(mat.metalness).toBe(0);
  });
});
