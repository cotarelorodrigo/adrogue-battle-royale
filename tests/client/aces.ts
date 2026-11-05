// Para los tests: el color que se ve adentro de un interior. Es la cuenta de three para ACESFilmicToneMapping (el tone
// mapping de render/scene.ts, TONE_MAPPING), tal cual está en tonemapping_pars_fragment.glsl.js: el color lineal por
// la exposición / 0,6, la matriz de entrada, RRTAndODTFit, la matriz de salida y el recorte a [0, 1]. Después, a sRGB.
// La exposición es la de adentro (INDOOR_EXPOSURE): si la tarea que la calibre la cambia, lo que se compara con esto
// se corre y su test lo avisa.
import { INDOOR_EXPOSURE, INDOOR_GAIN } from '../../src/client/render/exposure.ts';
import { INTERIOR_EXPOSURE } from '../../src/client/world/interiors/build.ts';

/** Por cuánto se multiplica la luz horneada de adentro, visto adentro con el ojo adaptado: INTERIOR_EXPOSURE y la
 *  ganancia de lo horneado (interiors/baked.ts). Lo horneado se ve `seen(color, luz · ADENTRO)`. */
export const ADENTRO = INTERIOR_EXPOSURE * INDOOR_GAIN;

export type RGB = [number, number, number];

/** Las constantes de RRTAndODTFit y las dos matrices (por columnas, como el mat3 de GLSL), como las escribe three. */
export const ACES = {
  fit: ['0.0245786', '0.000090537', '0.983729', '0.4329510', '0.238081'],
  input: [[0.59719, 0.076, 0.0284], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]],
  output: [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]],
} as const;

export const hexRGB = (hex: string): RGB => [1, 3, 5].map((j) => parseInt(hex.slice(j, j + 2), 16)) as RGB;
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSRGB = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const [a, b, c, d, e] = ACES.fit.map(Number);
const fit = (v: number): number => (v * (v + a) - b) / (v * (c * v + d) + e);
const mul = (m: readonly (readonly number[])[], v: RGB): RGB =>
  [0, 1, 2].map((r) => m[0][r] * v[0] + m[1][r] * v[1] + m[2][r] * v[2]) as RGB;

/**
 * El sRGB (0–255) que se ve de `hex` adentro. `k` multiplica el color lineal antes del tone mapping: 1 para lo que
 * brilla (in_luz, ITEM_GLOW, carteles `glow`) y luz · ADENTRO para lo horneado.
 */
export function seen(hex: string, k = 1, exposure = INDOOR_EXPOSURE): RGB {
  return seenLinear(hexRGB(hex).map((x) => toLinear(x / 255) * k) as RGB, exposure);
}

/** Lo mismo desde un color lineal ya armado (el de una textura por el tinte y la luz, canal por canal). */
export function seenLinear(rgb: RGB, exposure = INDOOR_EXPOSURE): RGB {
  const lin = rgb.map((x) => x * (exposure / 0.6)) as RGB;
  const out = mul(ACES.output, mul(ACES.input, lin).map(fit) as RGB);
  return out.map((x) => Math.round(255 * toSRGB(Math.min(1, Math.max(0, x))))) as RGB;
}

/** sRGB (0–1) → lineal. */
export const linear = toLinear;

/** CIE L*a*b* (D65) de un sRGB 0–255. */
function lab(rgb: RGB): RGB {
  const [r, g, bl] = rgb.map((x) => toLinear(x / 255));
  const xyz = [(0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * bl, (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883];
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = xyz.map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** ΔE*ab (CIE76) entre dos sRGB 0–255: ~2 apenas se nota, ~10 se ve otro color. */
export function deltaE(p: RGB, q: RGB): number {
  const [x, y] = [lab(p), lab(q)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
