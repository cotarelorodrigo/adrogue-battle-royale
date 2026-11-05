// Las texturas de los interiores (§2.4). Porcelanato, madera, machimbre, baldosa, cerámico y tela se dibujan en canvas
// con un PRNG con semilla (el mismo dibujo en cada arranque); liso, metal y ladrillo salen de las CC0 de
// public/textures. Son claras y casi grises: el color del Look, por vértice, las tiñe (una baldosa roja o terracota es
// la misma textura con otro color).
import * as THREE from 'three';
import type { Mat } from '../../../shared/interiors/types.ts';
import { createRng } from '../../../shared/rng.ts';
import type { Rng } from '../../../shared/rng.ts';
import { averageLuminance } from '../facades.ts';

/** Los Mat con textura: el vidrio y la luz van sin. */
export type TexMat = Exclude<Mat, 'vidrio' | 'luz'>;
/** Metros que cubre una textura de lado: las uv de las caras son metros / TILE_M. */
export const TILE_M = 2.4;

type Ctx = CanvasRenderingContext2D;
/** Lo que ve cada dibujo: el canvas y su contexto, el lado en px, los px por metro y el sorteo. */
interface Pen { canvas: HTMLCanvasElement; c: Ctx; s: number; u: number; rng: Rng }

/** Un gris (0–255) con un toque de tono: [r, g, b] = v · tint. */
const rgb = (v: number, tint: readonly [number, number, number] = [1, 1, 1]): string =>
  `rgb(${tint.map((k) => Math.round(Math.min(255, Math.max(0, v * k)))).join(',')})`;
/** v ± spread al azar. */
const vary = (rng: Rng, v: number, spread: number): number => v + (rng.next() * 2 - 1) * spread;

/** Grilla de piezas cuadradas de `tile` m con junta de `joint` m: cada pieza con su gris y un granito parejo. */
function tiles(p: Pen, tile: number, joint: number, base: number, spread: number, grout: number, grain: number): void {
  const { c, s, u, rng } = p;
  const n = Math.round(TILE_M / tile), t = s / n, j = Math.max(1, joint * u);
  c.fillStyle = rgb(grout);
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const v = vary(rng, base, spread);
      c.fillStyle = rgb(v);
      c.fillRect(i * t + j / 2, k * t + j / 2, t - j, t - j);
      for (let g = 0; g < grain; g++) {
        c.fillStyle = rgb(vary(rng, v, 14));
        c.fillRect(i * t + j / 2 + rng.next() * (t - j - 2), k * t + j / 2 + rng.next() * (t - j - 2), 2, 2);
      }
    }
  }
}

/** Tablas de 12 cm a lo largo de x, de TILE_M / 2 cada una y corridas al azar por fila, con vetas. */
function planks(p: Pen): void {
  const { c, s, u, rng } = p;
  const rows = Math.round(TILE_M / 0.12), h = s / rows, warm = [1, 0.95, 0.86] as const;
  for (let r = 0; r < rows; r++) {
    const off = rng.next() * s;
    for (const x0 of [off - s, off - s / 2, off, off + s / 2]) {
      const v = vary(rng, 225, 14);
      c.fillStyle = rgb(v, warm);
      c.fillRect(x0, r * h, s / 2, h);
      for (let g = 0; g < 5; g++) {
        c.fillStyle = rgb(v - 25 - rng.next() * 20, warm);
        c.fillRect(x0, r * h + rng.next() * h, s / 2, Math.max(1, 0.004 * u));
      }
      c.fillStyle = rgb(150, warm); // la junta entre tablas
      c.fillRect(x0, r * h, Math.max(1, 0.003 * u), h);
    }
    c.fillStyle = rgb(140, warm);
    c.fillRect(0, r * h, s, Math.max(1, 0.003 * u));
  }
}

/** Machimbre: listones verticales de 10 cm con la ranura en V (una línea oscura y una clara). */
function tongueAndGroove(p: Pen): void {
  const { c, s, u, rng } = p;
  const n = Math.round(TILE_M / 0.1), w = s / n, warm = [1, 0.96, 0.88] as const;
  for (let i = 0; i < n; i++) {
    const v = vary(rng, 228, 10);
    c.fillStyle = rgb(v, warm);
    c.fillRect(i * w, 0, w, s);
    for (let g = 0; g < 4; g++) {
      c.fillStyle = rgb(v - 18 - rng.next() * 16, warm);
      c.fillRect(i * w + rng.next() * w, 0, Math.max(1, 0.003 * u), s);
    }
    c.fillStyle = rgb(120, warm);
    c.fillRect(i * w, 0, Math.max(1, 0.006 * u), s);
    c.fillStyle = rgb(250, warm);
    c.fillRect(i * w + Math.max(1, 0.006 * u), 0, Math.max(1, 0.003 * u), s);
  }
}

/** Tela: trama y urdimbre de hilos de 4 mm con hilos más gruesos o más claros al azar. */
function cloth(p: Pen): void {
  const { c, s, u, rng } = p;
  const step = Math.max(2, 0.004 * u * 2), n = Math.round(s / step), d = s / n;
  c.fillStyle = rgb(215);
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) {
    c.fillStyle = `rgba(255,255,255,${0.15 + rng.next() * 0.2})`;
    c.fillRect(0, i * d, s, d / 2);
    c.fillStyle = `rgba(0,0,0,${0.06 + rng.next() * 0.1})`;
    c.fillRect(i * d, 0, d / 2, s);
  }
}

/** La luminancia media (sRGB, 0–1) a la que se aclara cada CC0: la textura queda clara y el tinte por vértice se lee. La
 *  foto del ladrillo ya trae su tono: aclarada, su promedio es un rosado apagado, y el tinte no tiene que volver a ponerle
 *  el rojo (H2 de la tarea 8). */
export const PHOTO_LUMA = { liso: 0.85, metal: 0.75, ladrillo: 0.55 } as const;

/** Cuánto blanco (0–0,9) se le pinta encima a una foto de luminancia media `l0` para llevarla a `target`. */
export const photoBlend = (l0: number, target: number): number => Math.min(0.9, Math.max(0, (target - l0) / Math.max(1e-3, 1 - l0)));

/** Una CC0 a `s` px, aclarada hacia la luminancia `target` (como las fachadas): así el tinte por vértice se lee. */
function photo(p: Pen, img: CanvasImageSource, target: number): void {
  const { canvas, c, s } = p;
  c.drawImage(img, 0, 0, s, s);
  c.fillStyle = `rgba(255,255,255,${photoBlend(averageLuminance(canvas), target)})`;
  c.fillRect(0, 0, s, s);
}

/** El color medio de un canvas, lineal (lo que la textura le multiplica en promedio al color por vértice). */
function meanLinear(img: HTMLCanvasElement): [number, number, number] {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  const sum: [number, number, number] = [0, 0, 0];
  const col = new THREE.Color();
  for (let i = 0; i < d.length; i += 4) {
    col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace);
    sum[0] += col.r;
    sum[1] += col.g;
    sum[2] += col.b;
  }
  return sum.map((x) => x / 256) as [number, number, number];
}

/** Las 9 texturas de los interiores, de `size` × `size` px y con RepeatWrapping. Cada una lleva en `userData.tone` su
 *  color medio, lineal: en baja, compactado al nivel 3, el ladrillo va sin textura y su tono pasa al color por vértice. */
export function interiorTextures(size: 512 | 1024, cc0: { revoque: CanvasImageSource; metal: CanvasImageSource; ladrillo: CanvasImageSource }): Record<TexMat, THREE.Texture> {
  const draw: Record<TexMat, (p: Pen) => void> = {
    liso: (p) => photo(p, cc0.revoque, PHOTO_LUMA.liso),
    porcelanato: (p) => tiles(p, 0.6, 0.003, 222, 6, 170, 60),
    madera: planks,
    machimbre: tongueAndGroove,
    baldosa: (p) => tiles(p, 0.2, 0.006, 230, 10, 150, 6),
    ceramico: (p) => tiles(p, 0.3, 0.004, 238, 5, 205, 10),
    tela: cloth,
    metal: (p) => photo(p, cc0.metal, PHOTO_LUMA.metal),
    ladrillo: (p) => photo(p, cc0.ladrillo, PHOTO_LUMA.ladrillo),
  };
  const out = {} as Record<TexMat, THREE.Texture>;
  (Object.keys(draw) as TexMat[]).forEach((mat, k) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const c = canvas.getContext('2d')!;
    draw[mat]({ canvas, c, s: size, u: size / TILE_M, rng: createRng(0x1a7e + k * 7919) });
    const t = new THREE.CanvasTexture(canvas);
    t.name = `in_${mat}`;
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.userData.tone = meanLinear(canvas);
    out[mat] = t;
  });
  return out;
}
