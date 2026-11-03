// @vitest-environment jsdom
import * as THREE from 'three';
import { createMaterials, disposeMaterials } from '../../src/client/world/materials.ts';
import type { WorldMaterials } from '../../src/client/world/types.ts';

// jsdom no dibuja: un contexto 2D que acepta todo y una Image que "carga" enseguida alcanzan para armar los materiales.
function fakeContext(): CanvasRenderingContext2D {
  return new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 16;
  height = 16;
  set src(_v: string) {
    queueMicrotask(() => this.onload?.());
  }
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext() as never);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function texturesOf(m: WorldMaterials): THREE.Texture[] {
  const out = new Set<THREE.Texture>();
  for (const mat of Object.values(m)) for (const v of Object.values(mat)) if (v instanceof THREE.Texture) out.add(v);
  return [...out];
}

for (const q of ['baja', 'media', 'alta'] as const) {
  test(`${q}: cada textura de slot se crea una sola vez`, async () => {
    const m = await createMaterials(q);
    const named = texturesOf(m).filter((t) => t.name !== '');
    expect(named.length).toBeGreaterThan(0);
    expect(new Set(named.map((t) => t.name)).size).toBe(named.length);
  });
}

test('disposeMaterials libera cada material y cada textura una sola vez', async () => {
  const m = await createMaterials('media');
  const textures = texturesOf(m);
  const materials = new Set(Object.values(m));
  const texDispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
  const matDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
  disposeMaterials(m);
  expect(texDispose).toHaveBeenCalledTimes(textures.length);
  expect(new Set(texDispose.mock.contexts)).toEqual(new Set(textures));
  expect(matDispose).toHaveBeenCalledTimes(materials.size);
  expect(new Set(matDispose.mock.contexts)).toEqual(materials);
});

test('las texturas se piden bajo BASE_URL (el juego puede vivir en una subcarpeta)', async () => {
  vi.stubEnv('BASE_URL', '/adrogue-cs/');
  const srcs: string[] = [];
  vi.stubGlobal('Image', class extends FakeImage {
    override set src(v: string) {
      srcs.push(v);
      super.src = v;
    }
  });
  await createMaterials('baja');
  expect(srcs.length).toBeGreaterThan(0);
  expect(srcs.every((s) => s.startsWith('/adrogue-cs/textures/'))).toBe(true);
});
