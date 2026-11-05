// Carteles: el nombre (sin logos) en una caja de ancho × 0,9 × 0,12 m apoyada en la fachada.
// Todos los carteles se dibujan en unas pocas páginas de atlas (una malla y un material por página), así los draw calls
// no crecen con la cantidad de carteles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SIGN_D, SIGN_H } from '../../shared/mapdata.ts';
import type { Fuente, Place, PlaceType, Sign, SignLook } from '../../shared/mapdata.ts';

export { SIGN_H, SIGN_D };
/** Píxeles por metro: un nombre de 0,3 m de alto ocupa ~38 px, de sobra para leerlo a 20 m. */
export const PX_PER_M = 128;
/** Lado de una página del atlas, en px. */
export const PAGE = 2048;
/** Marco, en fracción del alto. Las caras de canto (y la de atrás) se pintan con este color. */
const FRAME = 0.07;
/** Aire entre el marco y el texto, en fracción del alto. */
const PAD = 0.08;
/** Alto de la letra respecto del alto útil, en una y en dos líneas. */
const ONE_LINE = 0.62;
const TWO_LINES = 0.42;

type Weight = 'normal' | 'bold' | '900';
type Look = SignLook & { weight?: string };

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", Times, serif';
const CONDENSED = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const ROUNDED = '"Trebuchet MS", Verdana, sans-serif';
/** La manuscrita, con fuentes que ya traen los sistemas: Snell Roundhand, Brush Script MT y Apple Chancery (macOS),
 *  Segoe Script (Windows) y Bradley Hand; si no hay ninguna, una serif. Sin el genérico `cursive`: en Windows es la
 *  Comic Sans. Ya es inclinada: no lleva `cursiva`. */
const SCRIPT = '"Snell Roundhand", "Brush Script MT", "Apple Chancery", "Segoe Script", "Bradley Hand", serif';
const FAMILY: Record<Fuente, string> = { sans: SANS, serif: SERIF, condensada: CONDENSED, redondeada: ROUNDED, script: SCRIPT };

/** Por tipo de lugar, para los carteles que no vienen del relevamiento: los colores y las letras sugieren el rubro sin copiar ningún logo. */
export const TYPE_LOOK: Record<PlaceType, SignLook & { weight: Weight }> = {
  bank: { fondo: '#163d6e', letra: '#ffffff', marco: '#d6dbe2', fuente: 'sans', weight: 'bold' },
  bar: { fondo: '#1d1410', letra: '#eab75c', marco: '#5c3b22', fuente: 'serif', weight: 'bold', cursiva: true },
  restaurant: { fondo: '#26472f', letra: '#f4ead0', marco: '#9c7b3f', fuente: 'serif', weight: 'bold' },
  fastfood: { fondo: '#2b2b2b', letra: '#f3e9d2', marco: '#8a8a8a', fuente: 'sans', weight: '900' },
  icecream: { fondo: '#fbefd9', letra: '#6b3a22', marco: '#e58fa6', fuente: 'redondeada', weight: 'bold' },
  cinema: { fondo: '#121212', letra: '#f5d04c', marco: '#a51c1c', fuente: 'condensada', weight: 'bold' },
  club: { fondo: '#0d47a1', letra: '#ffffff', marco: '#f4f4f4', fuente: 'sans', weight: 'bold' },
  clinic: { fondo: '#ffffff', letra: '#00796b', marco: '#00796b', fuente: 'sans', weight: 'bold' },
  school: { fondo: '#7a1f2b', letra: '#ffffff', marco: '#d8c9a3', fuente: 'serif', weight: 'bold' },
  culture: { fondo: '#efe6cf', letra: '#4a3423', marco: '#8a6d46', fuente: 'serif', weight: 'normal' },
  // la estación: como los nomencladores azules de los andenes (fondo y borde azules, letras blancas)
  station: { fondo: '#1c3f8f', letra: '#ffffff', marco: '#16336f', fuente: 'sans', weight: 'bold' },
  monument: { fondo: '#2f4a32', letra: '#f0f0e6', marco: '#c9c2a8', fuente: 'serif', weight: 'normal' },
  plaza: { fondo: '#2f4a32', letra: '#f0f0e6', marco: '#c9c2a8', fuente: 'sans', weight: 'bold' },
};

const fontOf = (l: Look, px: number): string => `${l.cursiva ? 'italic ' : ''}${l.weight ?? 'bold'} ${px.toFixed(1)}px ${FAMILY[l.fuente]}`;

/** Una o dos líneas (la que deje la letra más grande) y el tamaño en px que entra en maxW × maxH. */
function layout(ctx: CanvasRenderingContext2D, text: string, l: Look, maxW: number, maxH: number): { lines: string[]; px: number } {
  const REF = 100;
  ctx.font = fontOf(l, REF);
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

/** Margen entre carteles del atlas, en px: se rellena con el color del marco para que el filtrado no traiga el vecino. */
const GUTTER = 4;

/** Fondo, marco y nombre centrado. `width` (m) da la proporción del cartel: width × `height` (SIGN_H). Si no entra en
 *  una página a PX_PER_M, se dibuja más chico (mismo ancho en el mundo). */
export function signTexture(text: string, look: Look, width: number, height = SIGN_H): HTMLCanvasElement {
  const k = Math.min(1, (PAGE - 2 * GUTTER) / (Math.max(width, height) * PX_PER_M));
  const w = Math.max(64, Math.round(width * PX_PER_M * k));
  const h = Math.max(1, Math.round(height * PX_PER_M * (w / Math.max(1, width * PX_PER_M))));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const f = Math.round(h * FRAME);
  ctx.fillStyle = look.marco;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = look.fondo;
  ctx.fillRect(f, f, w - 2 * f, h - 2 * f);
  const pad = h * PAD;
  const { lines, px } = layout(ctx, text, look, w - 2 * (f + pad), h - 2 * (f + pad));
  ctx.font = fontOf(look, px);
  ctx.fillStyle = look.letra;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = px * 1.1;
  let start = 0; // dónde empieza cada línea en el texto (las separa un espacio)
  lines.forEach((line, i) => {
    const y = h / 2 + (i - (lines.length - 1) / 2) * step + px * 0.04;
    const runs = look.acento ? accentRuns(line, start, look) : [];
    start += line.length + 1;
    if (runs.length < 2) {
      if (runs.length === 1) ctx.fillStyle = runs[0].color;
      ctx.fillText(line, w / 2, y);
      return;
    }
    // con acento: los tramos uno detrás del otro, desde la punta izquierda de la línea centrada
    ctx.textAlign = 'left';
    let x = w / 2 - ctx.measureText(line).width / 2;
    for (const r of runs) {
      ctx.fillStyle = r.color;
      ctx.fillText(r.text, x, y);
      x += ctx.measureText(r.text).width;
    }
    ctx.textAlign = 'center';
  });
  return c;
}

/** Los tramos de una línea (que empieza en `start` del texto) con su color: el del acento de `desde` a `hasta` y el de
 *  la letra en el resto. */
function accentRuns(line: string, start: number, look: Look): { text: string; color: string }[] {
  const a = look.acento!, a0 = Math.max(0, a.desde - start), a1 = Math.min(line.length, a.hasta - start);
  if (a1 <= a0) return [];
  return [{ text: line.slice(0, a0), color: look.letra }, { text: line.slice(a0, a1), color: a.letra }, { text: line.slice(a1), color: look.letra }]
    .filter((r) => r.text.length > 0);
}

export interface AtlasRect { page: number; x: number; y: number; w: number; h: number }

/** Acomoda rectángulos en páginas cuadradas por estantes, en el orden de entrada y sin rotar. Deja `gutter` px entre
 *  rectángulos; abre una página nueva cuando la actual se llena y recorta la última al alto que usó. */
export function packSigns(sizes: { w: number; h: number }[], page = PAGE, gutter = GUTTER): { rects: AtlasRect[]; pages: { w: number; h: number }[] } {
  const rects: AtlasRect[] = [];
  const used: number[] = [];
  let p = 0, x = 0, y = 0, shelf = 0;
  for (const { w, h } of sizes) {
    if (w > page || h > page) throw new Error(`Cartel de ${w}×${h} px: no entra en una página de ${page} px`);
    if (x > 0 && x + w > page) { y += shelf + gutter; x = 0; shelf = 0; }
    if (y + h > page) { p++; x = 0; y = 0; shelf = 0; }
    rects.push({ page: p, x, y, w, h });
    x += w + gutter;
    shelf = Math.max(shelf, h);
    used[p] = Math.max(used[p] ?? 0, y + h);
  }
  const pages = used.map((h, i) => ({ w: page, h: i === used.length - 1 ? h : page }));
  return { rects, pages };
}

/** Caja de width × height (0,9) × 0,12 centrada en el origen, con el frente hacia +z. La textura va en el frente (y atrás
 *  si `twoSided`); el resto de las caras toma un punto del marco. */
export function signGeometry(width: number, twoSided = false, height = SIGN_H): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(width, height, SIGN_D);
  g.clearGroups();
  const n = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const fu = (FRAME * height) / (2 * width), fv = FRAME / 2;
  for (let i = 0; i < n.count; i++) {
    const z = n.getZ(i);
    if (z > 0.5 || (twoSided && z < -0.5)) continue;
    uv.setXY(i, fu, fv);
  }
  return g;
}

/** La emisión de un cartel: la de todos y la de uno que brilla (Sign.glow), que además toma menos luz del sol (así, a
 *  pleno sol, no se quema). */
const EMISSIVE = 0.3, GLOW_EMISSIVE = 1.0, GLOW_DIFFUSE = 0.35;

/** Lambert con un poco de emisión: se lee también en la fachada a la sombra (los carteles suelen ser luminosos). Con
 *  `glow`, lee el atributo `glow` de cada vértice (0 o 1: buildSigns) y en los que brillan sube la emisión a
 *  GLOW_EMISSIVE: el mismo material y la misma malla, sin draw calls de más. */
export function signMaterial(canvas: HTMLCanvasElement, glow = false): THREE.Material {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4; // three lo limita al máximo del equipo; ayuda a leer el cartel en ángulo desde la vereda
  const m = new THREE.MeshLambertMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: EMISSIVE });
  if (!glow) return m;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGlow = glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
\ttotalEmissiveRadiance *= mix( 1.0, ${(GLOW_EMISSIVE / EMISSIVE).toFixed(4)}, vGlow );
\tdiffuseColor.rgb *= mix( 1.0, ${GLOW_DIFFUSE.toFixed(4)}, vGlow );`);
  };
  m.customProgramCacheKey = () => 'sign-glow';
  return m;
}

const lookOf = (s: Sign, type?: PlaceType): Look => (s.look ? { ...s.look, weight: 'bold' } : TYPE_LOOK[type ?? 'plaza']);

/** Todos los carteles (los de los lugares y los sueltos del relevamiento) en una malla por página de atlas. */
export function buildSigns(places: Place[], signs: Sign[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'signs';
  const all: { sign: Sign; look: Look }[] = [];
  for (const p of places) if (p.sign) all.push({ sign: p.sign, look: lookOf(p.sign, p.type) });
  for (const s of signs) all.push({ sign: s, look: lookOf(s) });
  if (!all.length) return group;

  const canvases = all.map(({ sign, look }) => signTexture(sign.text, look, sign.width, sign.height));
  const { rects, pages } = packSigns(canvases.map((c) => ({ w: c.width, h: c.height })));
  const pageCanvases = pages.map((pg) => {
    const c = document.createElement('canvas');
    c.width = pg.w;
    c.height = pg.h;
    return c;
  });
  const geos: THREE.BufferGeometry[][] = pages.map(() => []);
  all.forEach(({ sign, look }, i) => {
    const r = rects[i], pg = pages[r.page];
    const ctx = pageCanvases[r.page].getContext('2d')!;
    ctx.fillStyle = look.marco;
    ctx.fillRect(r.x - GUTTER, r.y - GUTTER, r.w + 2 * GUTTER, r.h + 2 * GUTTER);
    ctx.drawImage(canvases[i], r.x, r.y);

    const { anchor, normal, width, bottomY, blade } = sign, height = sign.height ?? SIGN_H;
    const len = Math.hypot(normal[0], normal[1]) || 1;
    const nx = normal[0] / len, nz = normal[1] / len;
    const g = signGeometry(width, !!blade, height);
    g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(sign.glow ? 1 : 0), 1));
    // UV del cartel (0..1) → su rectángulo de la página (v hacia arriba; el canvas cuenta y hacia abajo)
    const uv = g.getAttribute('uv');
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, (r.x + uv.getX(k) * r.w) / pg.w, (pg.h - r.y - r.h + uv.getY(k) * r.h) / pg.h);
    }
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(anchor[0] + nx * (SIGN_D / 2), bottomY + height / 2, anchor[1] + nz * (SIGN_D / 2)),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(nx, nz)), // +z local (el frente) → normal
      new THREE.Vector3(1, 1, 1),
    ));
    geos[r.page].push(g);
  });
  geos.forEach((list, i) => {
    const mesh = new THREE.Mesh(mergeGeometries(list, false), signMaterial(pageCanvases[i], true));
    list.forEach((g) => g.dispose());
    mesh.name = `signs:${i}`;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  });
  return group;
}
