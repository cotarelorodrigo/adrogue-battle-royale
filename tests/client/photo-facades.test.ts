// @vitest-environment jsdom
import { buildPhotoFacades, facadeQuad } from '../../src/client/world/photo-facades.ts';
import type { Building, MapData, Place } from '../../src/shared/mapdata.ts';

// Cuadra de 40 × 20 m, h = 3,8, antihoraria: sur (z = 0, normal +z) de x = 0 a 40.
const building: Building = {
  id: 'b', footprint: [[0, 0], [40, 0], [40, -20], [0, -20]], height: 3.8, floors: 1, kind: 'house', wall: 'brick', tint: '#fff',
};
const place = (anchor: [number, number], position: [number, number]): Place => ({
  id: 'p', name: 'P', type: 'culture', position, enterable: false, buildingId: 'b',
  sign: { text: 'P', anchor, normal: [0, 1], width: 6, bottomY: 3 }, spawn: [0, 0, 5],
});

test('arista del cartel: centrada en el ancla proyectada, 3 cm afuera, mirando hacia afuera', () => {
  const q = facadeQuad(building, place([12, 0.1], [20, -10]), { widthM: 10, heightM: 3 });
  expect(q.width).toBe(10);
  expect(q.height).toBe(3);
  expect(q.center).toBeCloseTo2D([12, 0.03], 6);
  expect(q.yaw).toBeCloseTo(0, 9); // normal +z
  expect(q.u).toEqual([0, 1]);
  expect(q.vMax).toBe(1);
});

test('si la foto es más ancha que la arista, el cuadro se achica y se recorta al centro', () => {
  const q = facadeQuad(building, place([20, 0.1], [20, -10]), { widthM: 80, heightM: 3 });
  expect(q.width).toBe(40);
  expect(q.u[0]).toBeCloseTo(0.25, 9);
  expect(q.u[1]).toBeCloseTo(0.75, 9);
});

test('el cuadro no se sale de la arista: se corre hasta que entre', () => {
  const q = facadeQuad(building, place([38, 0.1], [20, -10]), { widthM: 10, heightM: 3 });
  expect(q.center[0]).toBeCloseTo(35, 9);
});

test('si la foto es más alta que el edificio, se muestra solo la parte de abajo', () => {
  const q = facadeQuad(building, place([20, 0.1], [20, -10]), { widthM: 10, heightM: 7.6 });
  expect(q.height).toBe(3.8);
  expect(q.vMax).toBeCloseTo(0.5, 9);
});

test('edgeIndex elige otra arista y la centra en la posición del lugar', () => {
  const q = facadeQuad(building, place([12, 0.1], [20, -8]), { widthM: 10, heightM: 3, edgeIndex: 2 }); // norte, normal −z
  expect(q.center).toBeCloseTo2D([20, -20.03], 6);
  expect(Math.abs(q.yaw)).toBeCloseTo(Math.PI, 9);
});

describe('buildPhotoFacades', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  test('una foto que no carga no deja malla: avisa con console.warn y nunca con console.error', async () => {
    class FailingImage { onerror: (() => void) | null = null; set src(_: string) { queueMicrotask(() => this.onerror?.()); } }
    vi.stubGlobal('Image', FailingImage);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const map = { places: [place([12, 0.1], [20, -10])], buildings: [building] } as unknown as MapData;
    const { group } = await buildPhotoFacades(map, [{ placeId: 'p', commonsFile: 'x.jpg', corners: [[0, 0], [1, 0], [1, 1], [0, 1]], widthM: 10, heightM: 3 }], '/', 512, 1);
    expect(group.children).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });
});
