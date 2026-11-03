import * as THREE from 'three';
import type { Vec2 } from '../../shared/geo.ts';
import { ensureCCW } from '../../shared/geo.ts';
import type { Building, FacadeGround } from '../../shared/mapdata.ts';

/** Alto de un piso (copia de mapgen/buildings.ts; el cliente no importa mapgen). */
export const FLOOR_H = 3.2;
/** Ancho de un módulo de fachada en metros. */
export const BAY_W = 3.0;
const PARAPET_H = 0.6;
const PARAPET_T = 0.2;
const MITER_LIMIT = 2;
const PLANAR_UV = 4;

interface Builder {
  pos: number[]; nor: number[]; uv: number[]; col: number[] | null; idx: number[];
}
const newBuilder = (withColor: boolean): Builder => ({ pos: [], nor: [], uv: [], col: withColor ? [] : null, idx: [] });

function toGeometry(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  if (b.col) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setIndex(b.idx);
  return g;
}

function vert(b: Builder, p: [number, number, number], n: [number, number, number], uv: [number, number], c?: THREE.Color): number {
  b.pos.push(...p); b.nor.push(...n); b.uv.push(...uv);
  if (b.col) b.col.push(c!.r, c!.g, c!.b);
  return b.pos.length / 3 - 1;
}

/** Cuadrilátero a,b,c,d (en ese orden alrededor) con winding antihorario visto desde el lado de `n`. */
function quad(b: Builder, vs: [number, number, number][], uvs: [number, number][], n: [number, number, number], c?: THREE.Color): void {
  const i = vs.map((p, k) => vert(b, p, n, uvs[k], c));
  b.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
}

const tintCache = new Map<string, THREE.Color>();
function tintColor(tint: string): THREE.Color {
  let c = tintCache.get(tint);
  if (!c) { c = new THREE.Color().setStyle(tint); tintCache.set(tint, c); }
  return c;
}

/** Triangula un polígono simple (x,z) y emite triángulos con normal +y. Los vértices ya están en b (en orden). */
function triangulateUp(poly: Vec2[], base: number, idx: number[]): void {
  // Pasamos (x, −z): así un polígono antihorario desde arriba también lo es en el plano 2D.
  const contour = poly.map(([x, z]) => new THREE.Vector2(x, -z));
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const cross = (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
    // normal.y = −(cross en x,z) con x/z de mano derecha invertida: y>0 si cross < 0
    if (cross < 0) idx.push(base + a, base + b, base + c);
    else idx.push(base + a, base + c, base + b);
  }
}

/** `colorOf(i)`: color de la arista i de `fp`, o null para saltearla (va en otra banda). */
function wallBand(fp: Vec2[], cum: number[], y0: number, y1: number, colorOf: (i: number) => THREE.Color | null): THREE.BufferGeometry {
  const b = newBuilder(true);
  for (let i = 0; i < fp.length; i++) {
    const color = colorOf(i);
    if (!color) continue;
    const a = fp[i], c = fp[(i + 1) % fp.length];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const n: [number, number, number] = [-dz / len, 0, dx / len];
    const u0 = cum[i] / BAY_W, u1 = (cum[i] + len) / BAY_W;
    quad(b, [[a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]]],
      [[u0, y0 / FLOOR_H], [u1, y0 / FLOOR_H], [u1, y1 / FLOOR_H], [u0, y1 / FLOOR_H]], n, color);
  }
  return toGeometry(b);
}

/** Desplaza hacia adentro cada vértice de un anillo antihorario, con inglete limitado a 2×. */
function insetRing(fp: Vec2[], t: number): Vec2[] {
  const n = fp.length;
  const normals = fp.map((a, i) => {
    const c = fp[(i + 1) % n];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    return [-dz / len, dx / len] as Vec2; // hacia afuera
  });
  return fp.map((p, i) => {
    const n1 = normals[(i + n - 1) % n], n2 = normals[i];
    const mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) return [p[0] - n2[0] * t, p[1] - n2[1] * t] as Vec2;
    const scale = Math.min((2 * t) / ml, MITER_LIMIT * t);
    return [p[0] - (mx / ml) * scale, p[1] - (mz / ml) * scale] as Vec2;
  });
}

function parapetRing(fp: Vec2[], cum: number[], y0: number, color: THREE.Color): THREE.BufferGeometry {
  const b = newBuilder(true);
  const y1 = y0 + PARAPET_H;
  const inner = insetRing(fp, PARAPET_T);
  const n = fp.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = fp[i], c = fp[j], ai = inner[i], ci = inner[j];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const nx = -dz / len, nz = dx / len;
    const u0 = cum[i] / BAY_W, u1 = (cum[i] + len) / BAY_W;
    const v0 = y0 / FLOOR_H, v1 = y1 / FLOOR_H;
    // cara exterior (al ras de la pared)
    quad(b, [[a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]]],
      [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], [nx, 0, nz], color);
    // cara interior (mira hacia adentro): winding invertido
    quad(b, [[ci[0], y0, ci[1]], [ai[0], y0, ai[1]], [ai[0], y1, ai[1]], [ci[0], y1, ci[1]]],
      [[u1, v0], [u0, v0], [u0, v1], [u1, v1]], [-nx, 0, -nz], color);
    // tope
    const uv = (p: Vec2): [number, number] => [p[0] / PLANAR_UV, p[1] / PLANAR_UV];
    quad(b, [[a[0], y1, a[1]], [c[0], y1, c[1]], [ci[0], y1, ci[1]], [ai[0], y1, ai[1]]],
      [uv(a), uv(c), uv(ci), uv(ai)], [0, 1, 0], color);
  }
  return toGeometry(b);
}

/**
 * `walls.ground` es la planta baja de las aristas comunes; las de `bd.facades` van aparte en `walls.overrides`, una
 * geometría por tipo de planta baja (el que dibuja las suma al merge de ese material, sin draw calls nuevos).
 */
export function extrudeBuilding(bd: Building): {
  walls: { ground: THREE.BufferGeometry; upper: THREE.BufferGeometry; overrides: { ground: FacadeGround; geometry: THREE.BufferGeometry }[] };
  roof: THREE.BufferGeometry;
  parapet: THREE.BufferGeometry;
} {
  const fp = ensureCCW(bd.footprint);
  const color = tintColor(bd.tint);
  // facades cuenta aristas sobre el footprint guardado; si ensureCCW lo dio vuelta, la arista i es la n − 2 − i
  const n = fp.length;
  const flipped = fp !== bd.footprint;
  const own = new Map<number, { ground: FacadeGround; color: THREE.Color }>();
  for (const f of bd.facades ?? []) {
    own.set(flipped ? (2 * n - 2 - f.edge) % n : f.edge, { ground: f.ground, color: f.tint ? tintColor(f.tint) : color });
  }

  const cum: number[] = [0];
  for (let i = 0; i < fp.length; i++) {
    const c = fp[(i + 1) % fp.length];
    cum.push(cum[i] + Math.hypot(c[0] - fp[i][0], c[1] - fp[i][1]));
  }

  const rb = newBuilder(true);
  for (const [x, z] of fp) vert(rb, [x, bd.height, z], [0, 1, 0], [x / PLANAR_UV, z / PLANAR_UV], color);
  triangulateUp(fp, 0, rb.idx);

  const groundH = Math.min(FLOOR_H, bd.height);
  const grounds = [...new Set([...own.values()].map((o) => o.ground))].sort();
  return {
    walls: {
      ground: wallBand(fp, cum, 0, groundH, (i) => (own.has(i) ? null : color)),
      // edificio más bajo que un piso: sin banda superior (geometría vacía)
      upper: bd.height > FLOOR_H ? wallBand(fp, cum, FLOOR_H, bd.height, () => color) : toGeometry(newBuilder(true)),
      overrides: grounds.map((ground) => ({
        ground,
        geometry: wallBand(fp, cum, 0, groundH, (i) => { const o = own.get(i); return o?.ground === ground ? o.color : null; }),
      })),
    },
    roof: toGeometry(rb),
    // un relleno de hueco (mapgen/pockets.ts) es un parche de techo entre vecinos: sin pretil propio
    parapet: bd.fill ? toGeometry(newBuilder(true)) : parapetRing(fp, cum, bd.height, color),
  };
}

/** `startV`: v (metros recorridos / 4) en el primer punto, para continuar la textura entre tramos. */
export function ribbon(points: Vec2[], width: number, y: number, startV = 0): THREE.BufferGeometry {
  const pts: Vec2[] = [];
  for (const p of points) {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) pts.push([p[0], p[1]]);
  }
  const b = newBuilder(false);
  if (pts.length < 2) return toGeometry(b);
  const h = width / 2;
  const dirs: Vec2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dz);
    dirs.push([dx / l, dz / l]);
  }
  // extremos extendidos h a lo largo de la tangente
  const ext = pts.map((p) => [p[0], p[1]] as Vec2);
  ext[0] = [pts[0][0] - dirs[0][0] * h, pts[0][1] - dirs[0][1] * h];
  const last = pts.length - 1;
  ext[last] = [pts[last][0] + dirs[last - 1][0] * h, pts[last][1] + dirs[last - 1][1] * h];

  let dist = 0;
  const uMax = width / PLANAR_UV;
  for (let i = 0; i < ext.length; i++) {
    if (i > 0) dist += Math.hypot(ext[i][0] - ext[i - 1][0], ext[i][1] - ext[i - 1][1]);
    const d1 = dirs[Math.max(i - 1, 0)], d2 = dirs[Math.min(i, dirs.length - 1)];
    const n1: Vec2 = [-d1[1], d1[0]], n2: Vec2 = [-d2[1], d2[0]];
    const mx = n1[0] + n2[0], mz = n1[1] + n2[1], ml = Math.hypot(mx, mz);
    let ox: number, oz: number;
    if (ml < 1e-6) { ox = n2[0] * h; oz = n2[1] * h; }
    else {
      const len = Math.min((2 * h) / ml, MITER_LIMIT * h);
      ox = (mx / ml) * len; oz = (mz / ml) * len;
    }
    const v = startV + (dist - h) / PLANAR_UV;
    vert(b, [ext[i][0] + ox, y, ext[i][1] + oz], [0, 1, 0], [0, v]);
    vert(b, [ext[i][0] - ox, y, ext[i][1] - oz], [0, 1, 0], [uMax, v]);
  }
  // Cada cuadrilátero se orienta para que la normal sea +y sin depender del signo del giro.
  const pos = b.pos;
  const up = (a: number, c: number, d: number): void => {
    const cross = (pos[c * 3] - pos[a * 3]) * (pos[d * 3 + 2] - pos[a * 3 + 2]) - (pos[c * 3 + 2] - pos[a * 3 + 2]) * (pos[d * 3] - pos[a * 3]);
    if (cross < 0) b.idx.push(a, c, d); else b.idx.push(a, d, c);
  };
  for (let i = 0; i < ext.length - 1; i++) {
    const l0 = i * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
    up(l0, l1, r1);
    up(l0, r1, r0);
  }
  return toGeometry(b);
}

export function polygonGeometry(poly: Vec2[], y: number, uvScale: number): THREE.BufferGeometry {
  const b = newBuilder(false);
  const p = ensureCCW(poly);
  for (const [x, z] of p) vert(b, [x, y, z], [0, 1, 0], [x / uvScale, z / uvScale]);
  triangulateUp(p, 0, b.idx);
  return toGeometry(b);
}
