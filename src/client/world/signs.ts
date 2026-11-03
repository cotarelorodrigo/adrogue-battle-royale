// Carteles de los lugares: el nombre (sin logos) en una caja de ancho × 0,9 × 0,12 m apoyada en la fachada.
// Un material por cartel (cada uno con su textura): son 28 carteles, a lo sumo 28 draw calls, y el frustum culling deja
// afuera los que no se ven.
import * as THREE from 'three';
import type { Place, PlaceType } from '../../shared/mapdata.ts';

export const SIGN_H = 0.9;
export const SIGN_D = 0.12;
/** Píxeles por metro: un nombre de 0,3 m de alto ocupa ~48 px, de sobra para leerlo a 20 m. */
const PX_PER_M = 160;
/** Marco, en fracción del alto. Las caras de canto (y la de atrás) se pintan con este color. */
const FRAME = 0.07;
/** Aire entre el marco y el texto, en fracción del alto. */
const PAD = 0.08;
/** Alto de la letra respecto del alto útil, en una y en dos líneas. */
const ONE_LINE = 0.62;
const TWO_LINES = 0.42;

interface Style { bg: string; fg: string; frame: string; family: string; weight: string; italic?: boolean }

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", Times, serif';
const CONDENSED = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const ROUNDED = '"Trebuchet MS", Verdana, sans-serif';

/** Por tipo de lugar, no por marca: los colores y las letras sugieren el rubro sin copiar ningún logo. */
const STYLES: Record<PlaceType, Style> = {
  bank: { bg: '#163d6e', fg: '#ffffff', frame: '#d6dbe2', family: SANS, weight: 'bold' },
  bar: { bg: '#1d1410', fg: '#eab75c', frame: '#5c3b22', family: SERIF, weight: 'bold', italic: true },
  restaurant: { bg: '#26472f', fg: '#f4ead0', frame: '#9c7b3f', family: SERIF, weight: 'bold' },
  fastfood: { bg: '#2b2b2b', fg: '#f3e9d2', frame: '#8a8a8a', family: SANS, weight: '900' },
  icecream: { bg: '#fbefd9', fg: '#6b3a22', frame: '#e58fa6', family: ROUNDED, weight: 'bold' },
  cinema: { bg: '#121212', fg: '#f5d04c', frame: '#a51c1c', family: CONDENSED, weight: 'bold' },
  club: { bg: '#0d47a1', fg: '#ffffff', frame: '#f4f4f4', family: SANS, weight: 'bold' },
  clinic: { bg: '#ffffff', fg: '#00796b', frame: '#00796b', family: SANS, weight: 'bold' },
  school: { bg: '#7a1f2b', fg: '#ffffff', frame: '#d8c9a3', family: SERIF, weight: 'bold' },
  culture: { bg: '#efe6cf', fg: '#4a3423', frame: '#8a6d46', family: SERIF, weight: 'normal' },
  station: { bg: '#1f3f73', fg: '#ffffff', frame: '#e6e6e6', family: SANS, weight: 'bold' },
  monument: { bg: '#2f4a32', fg: '#f0f0e6', frame: '#c9c2a8', family: SERIF, weight: 'normal' },
  plaza: { bg: '#2f4a32', fg: '#f0f0e6', frame: '#c9c2a8', family: SANS, weight: 'bold' },
};

const fontOf = (s: Style, px: number): string => `${s.italic ? 'italic ' : ''}${s.weight} ${px.toFixed(1)}px ${s.family}`;

/** Una o dos líneas (la que deje la letra más grande) y el tamaño en px que entra en maxW × maxH. */
function layout(ctx: CanvasRenderingContext2D, text: string, s: Style, maxW: number, maxH: number): { lines: string[]; px: number } {
  const REF = 100;
  ctx.font = fontOf(s, REF);
  const widthAt = (t: string): number => Math.max(1, ctx.measureText(t).width);
  const one = Math.min(maxH * ONE_LINE, (REF * maxW) / widthAt(text));
  const words = text.split(' ');
  let best = { lines: [text], px: one };
  for (let k = 1; k < words.length; k++) {
    const lines = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
    const px = Math.min(maxH * TWO_LINES, (REF * maxW) / Math.max(...lines.map(widthAt)));
    if (px > best.px * 1.15) best = { lines, px }; // dos líneas solo si se gana bastante
  }
  return best;
}

/** Fondo, marco y nombre centrado. `width` (m) da la proporción del cartel: width × 0,9. */
export function signTexture(text: string, style: PlaceType, width = 6): HTMLCanvasElement {
  const s = STYLES[style];
  const w = Math.max(64, Math.round(width * PX_PER_M));
  const h = Math.round(SIGN_H * PX_PER_M);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const f = Math.round(h * FRAME);
  ctx.fillStyle = s.frame;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = s.bg;
  ctx.fillRect(f, f, w - 2 * f, h - 2 * f);
  const pad = h * PAD;
  const { lines, px } = layout(ctx, text, s, w - 2 * (f + pad), h - 2 * (f + pad));
  ctx.font = fontOf(s, px);
  ctx.fillStyle = s.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = px * 1.1;
  lines.forEach((line, i) => ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * step + px * 0.04));
  return c;
}

/** Caja de width × 0,9 × 0,12 centrada en el origen, con el frente hacia +z. La textura va en el frente (y atrás si
 *  `twoSided`); el resto de las caras toma un punto del marco. */
export function signGeometry(width: number, twoSided = false): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(width, SIGN_H, SIGN_D);
  g.clearGroups();
  const n = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const fu = (FRAME * SIGN_H) / (2 * width), fv = FRAME / 2;
  for (let i = 0; i < n.count; i++) {
    const z = n.getZ(i);
    if (z > 0.5 || (twoSided && z < -0.5)) continue;
    uv.setXY(i, fu, fv);
  }
  return g;
}

/** Lambert con un poco de emisión: se lee también en la fachada a la sombra (los carteles suelen ser luminosos). */
export function signMaterial(canvas: HTMLCanvasElement): THREE.Material {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4; // three lo limita al máximo del equipo; ayuda a leer el cartel en ángulo desde la vereda
  return new THREE.MeshLambertMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.3 });
}

export function buildSigns(places: Place[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'signs';
  for (const p of places) {
    if (!p.sign) continue;
    const { text, anchor, normal, width, bottomY } = p.sign;
    const len = Math.hypot(normal[0], normal[1]) || 1;
    const nx = normal[0] / len, nz = normal[1] / len;
    const mesh = new THREE.Mesh(signGeometry(width), signMaterial(signTexture(text, p.type, width)));
    mesh.name = `sign:${p.id}`;
    mesh.position.set(anchor[0] + nx * (SIGN_D / 2), bottomY + SIGN_H / 2, anchor[1] + nz * (SIGN_D / 2));
    mesh.rotation.y = Math.atan2(nx, nz); // +z local (el frente) → normal
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }
  return group;
}
