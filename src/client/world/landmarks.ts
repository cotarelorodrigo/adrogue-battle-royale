// La estación (andenes, alero de chapa, vías y carteles ADROGUÉ) y los monumentos (pedestal + figura simplificada).
// Las medidas que se pisan (andén, pedestales) salen de collision.ts: lo que se ve es lo que se pisa.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLUMN, PEDESTAL, PLATFORM_H } from '../../shared/collision.ts';
import { distPointSegment, ensureCCW, hashIndex, MARGIN_M } from '../../shared/geo.ts';
import type { Vec2 } from '../../shared/geo.ts';
import type { MapData, Place, Prop } from '../../shared/mapdata.ts';
import { splitByCell } from './cells.ts';
import { clipSegment } from './chunks.ts';
import { polygonGeometry, ribbon } from './geometry.ts';
import { SIGN_H, TYPE_LOOK, signGeometry, signMaterial, signTexture } from './signs.ts';
import type { WorldMaterials } from './types.ts';

// Vía (trocha de 1,435 m: decisión de diseño; la del Roca es más ancha)
const GAUGE = 1.435;
const RAIL_HEAD = 0.07;
const RAIL_H = 0.15;
const SLEEPER = { length: 2.6, width: 0.24, height: 0.16 };
/** Los durmientes quedan medio enterrados en el balasto. */
const SLEEPER_SINK = 0.08;
const SLEEPER_STEP = 0.6;
/** Más ancho que la entrevía (≈ 4,2 m): las dos vías comparten balasto. Donde se superponen, la textura va en
 *  coordenadas del mundo y los dos dibujan lo mismo (no se nota el z-fighting). */
const BALLAST_W = 4.8;
const BALLAST_UV = 3;
/** Entre la vereda (0,02) y el asfalto (0,04): en los pasos a nivel la calle tapa el balasto. polygonOffset −1,5 (vereda −1, asfalto −2). */
const Y_BALLAST = 0.03;

// Andén: el borde del lado de la vía es una losa de 25 cm que vuela 60 cm sobre un muro retirado (el hueco de
// seguridad de los andenes de verdad). Arriba la planta es la de la colisión; en los datos de OSM el borde queda a
// menos de 1 m del eje de la vía y sin el hueco el riel más cercano quedaría adentro del andén.
const COPING_H = 0.25;
const RECESS = 0.6;
const EDGE_W = 0.35;
const EDGE_Y = PLATFORM_H + 0.006;

// Alero: techo a dos aguas sobre postes en el eje del andén (sin colisión: finos y pocos).
const CANOPY_LEN = 50;
const CANOPY_EAVE = 3.2;
const CANOPY_RIDGE = 3.6;
const CANOPY_OVERHANG = 0.5;
const POST_STEP = 10;
const POST_R = 0.07;
const STATION_SIGN_W = 3.2;
const STATION_SIGN_BOTTOM = 2.0;

type V3 = [number, number, number];

/** Geometría indexada a mano: cuadriláteros con su normal (y la orientación de los triángulos según esa normal). */
class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];

  /** a, b, c, d en orden alrededor; la cara mira hacia `n` (se da vuelta el orden si hace falta). */
  quad(vs: V3[], n: V3, uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]): void {
    const [a, b, c] = vs;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const flip = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] < 0;
    const base = this.pos.length / 3;
    vs.forEach((v, k) => {
      this.pos.push(...v);
      this.nor.push(...n);
      this.uv.push(...uvs[k]);
    });
    if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

function merge(parts: THREE.BufferGeometry[], what: string): THREE.BufferGeometry {
  const indexed = parts.every((g) => g.index);
  const list = indexed ? parts : parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
  if (!g) throw new Error(`mergeGeometries falló: ${what}`);
  for (const p of new Set([...parts, ...list])) if (p !== g) p.dispose();
  g.computeBoundingSphere();
  return g;
}

function mesh(name: string, g: THREE.BufferGeometry, mat: THREE.Material, castShadow = false): THREE.Mesh {
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.castShadow = castShadow;
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}

const colorAttr = (g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry => {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
  return g;
};

/** Textura determinista hecha con puntos (canvas): balasto y chapa acanalada. */
function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const ballastTexture = (): THREE.CanvasTexture =>
  canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#6f6a63';
    ctx.fillRect(0, 0, 128, 128);
    const shades = ['#5a5550', '#7d7770', '#8f8a82', '#4d4945', '#a39d93'];
    for (let i = 0; i < 1400; i++) {
      const h = (k: number): number => hashIndex(10_000 + i * 8 + k);
      ctx.fillStyle = shades[Math.floor(h(0) * shades.length)];
      ctx.beginPath();
      ctx.ellipse(h(1) * 128, h(2) * 128, 0.8 + h(3) * 1.6, 0.6 + h(4) * 1.2, h(5) * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });

/** Chapa acanalada: 4 ondas por textura (u), cada onda clara arriba y oscura en el valle. */
const corrugatedTexture = (): THREE.CanvasTexture =>
  canvasTexture(64, 8, (ctx) => {
    for (let x = 0; x < 64; x++) {
      const l = 0.5 + 0.5 * Math.sin((x / 16) * Math.PI * 2);
      const k = Math.round(150 + 70 * l);
      ctx.fillStyle = `rgb(${k},${k},${k})`;
      ctx.fillRect(x, 0, 1, 8);
    }
  });
const CORRUGATION_REPEAT = 0.48; // m por textura (4 ondas de 12 cm)

// ─── Vías ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Tramos de la polilínea dentro del rectángulo (cortados en el borde). */
function clippedRuns(line: Vec2[], x0: number, z0: number, x1: number, z1: number): Vec2[][] {
  const runs: Vec2[][] = [];
  let run: Vec2[] = [];
  const flush = (): void => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k], b = line[k + 1];
    const c = clipSegment(a, b, x0, z0, x1, z1);
    if (!c) { flush(); continue; }
    if (c[0] !== a) flush(); // entra por el borde: tramo nuevo
    if (run.length === 0) run.push(c[0]);
    run.push(c[1]);
    if (c[1] !== b) flush();
  }
  flush();
  return runs;
}

/** Desplazamiento a la izquierda (normal (−dz, dx)) de cada punto, con inglete limitado a 2×. */
function miters(pts: Vec2[]): Vec2[] {
  const dirs: Vec2[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dz) || 1;
    dirs.push([dx / l, dz / l]);
  }
  return pts.map((_, i) => {
    const d1 = dirs[Math.max(i - 1, 0)], d2 = dirs[Math.min(i, dirs.length - 1)];
    const mx = -d1[1] - d2[1], mz = d1[0] + d2[0], ml2 = mx * mx + mz * mz;
    if (ml2 < 1e-9) return [-d2[1], d2[0]];
    const k = Math.min(2 / ml2, 2 / Math.sqrt(ml2)); // 1/cos(medio ángulo), a lo sumo 2
    return [mx * k, mz * k];
  });
}

/** Riel: perfil rectangular (tope y dos costados) corrido `offset` del eje, apoyado sobre los durmientes. */
function railGeometry(b: Builder, pts: Vec2[], offset: number): void {
  const m = miters(pts);
  const y0 = Y_BALLAST + SLEEPER.height - SLEEPER_SINK, y1 = y0 + RAIL_H, hw = RAIL_HEAD / 2;
  const at = (i: number, o: number): Vec2 => [pts[i][0] + m[i][0] * o, pts[i][1] + m[i][1] * o];
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const L0 = at(i, offset + hw), L1 = at(i + 1, offset + hw), R0 = at(i, offset - hw), R1 = at(i + 1, offset - hw);
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;
    const u0 = s, u1 = s + len;
    s = u1;
    const uv: [number, number][] = [[u0, 0], [u1, 0], [u1, 0.1], [u0, 0.1]];
    b.quad([[L0[0], y1, L0[1]], [L1[0], y1, L1[1]], [R1[0], y1, R1[1]], [R0[0], y1, R0[1]]], [0, 1, 0], uv);
    b.quad([[L0[0], y0, L0[1]], [L1[0], y0, L1[1]], [L1[0], y1, L1[1]], [L0[0], y1, L0[1]]], [nx, 0, nz], uv);
    b.quad([[R1[0], y0, R1[1]], [R0[0], y0, R0[1]], [R0[0], y1, R0[1]], [R1[0], y1, R1[1]]], [-nx, 0, -nz], uv);
  }
}

/** Centro y dirección de cada durmiente, cada SLEEPER_STEP a lo largo del tramo. */
function sleeperSpots(pts: Vec2[], out: { p: Vec2; d: Vec2 }[]): void {
  let next = SLEEPER_STEP / 2;
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const d: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    while (next <= s + len) {
      const t = next - s;
      out.push({ p: [a[0] + d[0] * t, a[1] + d[1] * t], d });
      next += SLEEPER_STEP;
    }
    s += len;
  }
}

// ─── Andenes y alero ────────────────────────────────────────────────────────────────────────────────────────────────

/** Distancia, punto más cercano y dirección (unitaria) del tramo de vía más cercano a p. */
function nearestRail(p: Vec2, rails: Vec2[][]): { d: number; q: Vec2; dir: Vec2 } {
  let best = { d: Infinity, q: p, dir: [1, 0] as Vec2 };
  for (const r of rails) {
    for (let k = 0; k + 1 < r.length; k++) {
      const a = r[k], b = r[k + 1];
      const d = distPointSegment(p, a, b);
      const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
      if (d < best.d && l2 > 0) {
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
        const l = Math.sqrt(l2);
        best = { d, q: [a[0] + dx * t, a[1] + dz * t], dir: [dx / l, dz / l] };
      }
    }
  }
  return best;
}

/** Lados del anillo (antihorario) que dan a la vía: paralelos a ella (±25°), mirándola, y los más cercanos (±1 m).
 *  Las puntas del andén quedan afuera aunque toquen el eje de la vía (pasa en los datos de OSM). */
function railSides(ring: Vec2[], rails: Vec2[][]): boolean[] {
  const n = ring.length;
  const info = ring.map((a, i) => {
    const c = ring[(i + 1) % n];
    const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
    const mid: Vec2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    const { d, q, dir } = nearestRail(mid, rails);
    const facing = len > 0 && (-dz * (q[0] - mid[0]) + dx * (q[1] - mid[1])) / len > 0;
    const parallel = len > 0 && Math.abs(dx * dir[0] + dz * dir[1]) / len > Math.cos((25 * Math.PI) / 180);
    return { d, ok: facing && parallel && len >= 2 };
  });
  const dmin = Math.min(...info.filter((e) => e.ok).map((e) => e.d));
  return info.map((e) => e.ok && e.d <= dmin + 1);
}

function platformGeometry(ring: Vec2[], rail: boolean[], walls: Builder, edge: Builder): void {
  const n = ring.length;
  const yc = PLATFORM_H - COPING_H;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i], c = ring[(i + 1) % n];
    const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const nx = -dz / len, nz = dx / len; // hacia afuera (anillo antihorario visto desde arriba)
    const u0 = s / 4, u1 = (s + len) / 4;
    s += len;
    const wall = (p: Vec2, q: Vec2, y0: number, y1: number, nrm: V3): void =>
      walls.quad([[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]], nrm, [[u0, y0 / 4], [u1, y0 / 4], [u1, y1 / 4], [u0, y1 / 4]]);
    if (!rail[i]) {
      wall(a, c, 0, PLATFORM_H, [nx, 0, nz]);
      continue;
    }
    const inset = (p: Vec2, k: number): Vec2 => [p[0] - nx * k, p[1] - nz * k];
    const ai = inset(a, RECESS), ci = inset(c, RECESS);
    wall(a, c, yc, PLATFORM_H, [nx, 0, nz]); // frente de la losa
    walls.quad([[a[0], yc, a[1]], [c[0], yc, c[1]], [ci[0], yc, ci[1]], [ai[0], yc, ai[1]]], [0, -1, 0]); // bajo la losa
    wall(ai, ci, 0, yc, [nx, 0, nz]); // muro retirado
    wall(a, ai, 0, yc, [dx / len, 0, dz / len]); // tapas del hueco en las puntas
    wall(ci, c, 0, yc, [-dx / len, 0, -dz / len]);
    const ae = inset(a, EDGE_W), ce = inset(c, EDGE_W);
    edge.quad([[a[0], EDGE_Y, a[1]], [c[0], EDGE_Y, c[1]], [ce[0], EDGE_Y, ce[1]], [ae[0], EDGE_Y, ae[1]]], [0, 1, 0]);
  }
}

interface Axis { d: Vec2; w: Vec2; s0: number; s1: number; tc: number; width: number }

/** Eje del andén: dirección del lado más largo y extensión de la planta a lo largo (s) y a lo ancho (t). */
function axisOf(ring: Vec2[]): Axis {
  let d: Vec2 = [1, 0], best = 0;
  ring.forEach((a, i) => {
    const c = ring[(i + 1) % ring.length], l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (l > best) { best = l; d = [(c[0] - a[0]) / l, (c[1] - a[1]) / l]; }
  });
  const w: Vec2 = [-d[1], d[0]];
  const ss = ring.map((p) => p[0] * d[0] + p[1] * d[1]), ts = ring.map((p) => p[0] * w[0] + p[1] * w[1]);
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  return { d, w, s0: Math.min(...ss), s1: Math.max(...ss), tc: (t0 + t1) / 2, width: t1 - t0 };
}

const at = (ax: Axis, s: number, t: number): Vec2 => [ax.d[0] * s + ax.w[0] * t, ax.d[1] * s + ax.w[1] * t];

/** Caja (largo sobre `dir`) centrada en (p, y). */
function beam(p: Vec2, y: number, dir: Vec2, length: number, wide: number, tall: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(length, tall, wide);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(p[0], y, p[1]),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dir[1], dir[0])), new THREE.Vector3(1, 1, 1)));
  return g;
}

function post(p: Vec2, y0: number, y1: number, r = POST_R): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, 8, 1, true);
  g.translate(p[0], (y0 + y1) / 2, p[1]);
  return g;
}

/** Techo a dos aguas: cada faldón con su cara de arriba y la de abajo (se ve desde el andén). */
function canopyRoof(b: Builder, ax: Axis, sa: number, sb: number): void {
  const yR = PLATFORM_H + CANOPY_RIDGE, yE = PLATFORM_H + CANOPY_EAVE, half = ax.width / 2 + CANOPY_OVERHANG;
  for (const side of [-1, 1]) {
    const r0 = at(ax, sa, ax.tc), r1 = at(ax, sb, ax.tc);
    const e0 = at(ax, sa, ax.tc + side * half), e1 = at(ax, sb, ax.tc + side * half);
    const vs: V3[] = [[r0[0], yR, r0[1]], [r1[0], yR, r1[1]], [e1[0], yE, e1[1]], [e0[0], yE, e0[1]]];
    const slope = Math.hypot(half, yR - yE);
    const up = new THREE.Vector3(ax.w[0] * side * (yR - yE), half, ax.w[1] * side * (yR - yE)).normalize();
    const uv: [number, number][] = [[sa / CORRUGATION_REPEAT, 0], [sb / CORRUGATION_REPEAT, 0], [sb / CORRUGATION_REPEAT, slope], [sa / CORRUGATION_REPEAT, slope]];
    b.quad(vs, [up.x, up.y, up.z], uv);
    b.quad(vs, [-up.x, -up.y, -up.z], uv);
  }
}

export function buildStation(map: MapData, materials: WorldMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'station';
  const bd = map.bounds;
  const x0 = bd.minX - MARGIN_M, x1 = bd.maxX + MARGIN_M, z0 = bd.minZ - MARGIN_M, z1 = bd.maxZ + MARGIN_M;
  const runs = map.railways.flatMap((r) => clippedRuns(r, x0, z0, x1, z1));

  // Vías: balasto, durmientes y rieles
  if (runs.length > 0) {
    const ballast = new THREE.MeshLambertMaterial({ map: ballastTexture(), polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 });
    const bed = merge(runs.map((r) => ribbon(r, BALLAST_W, Y_BALLAST)), 'balasto');
    const pos = bed.getAttribute('position'), uv = bed.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / BALLAST_UV, pos.getZ(i) / BALLAST_UV);
    group.add(mesh('ballast', bed, ballast));

    const spots: { p: Vec2; d: Vec2 }[] = [];
    for (const r of runs) sleeperSpots(r, spots);
    const sleeperGeo = colorAttr(new THREE.BoxGeometry(SLEEPER.width, SLEEPER.height, SLEEPER.length), '#9a958c');
    const si = Array.from(sleeperGeo.index!.array);
    sleeperGeo.setIndex([...si.slice(0, 18), ...si.slice(24)]); // sin la cara de abajo (orden +x, −x, +y, −y, +z, −z)
    sleeperGeo.translate(0, SLEEPER.height / 2 - SLEEPER_SINK, 0);
    const sleepers = new THREE.InstancedMesh(sleeperGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), spots.length);
    sleepers.name = 'sleepers';
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const UP = new THREE.Vector3(0, 1, 0);
    spots.forEach(({ p, d }, i) => sleepers.setMatrixAt(i, m.compose(v.set(p[0], Y_BALLAST, p[1]), q.setFromAxisAngle(UP, Math.atan2(-d[1], d[0])), one)));
    sleepers.receiveShadow = true;
    group.add(...splitByCell(sleepers)); // una malla por celda: three descarta las que no se ven

    const rails = new Builder();
    const o = GAUGE / 2 + RAIL_HEAD / 2; // eje de cada riel: la trocha se mide entre las caras internas
    for (const r of runs) for (const side of [-1, 1]) railGeometry(rails, r, side * o);
    group.add(mesh('rail', merge([rails.build()], 'rieles'), materials.rail));
  }

  // Andenes, alero y carteles
  if (map.platforms.length > 0) {
    const walls = new Builder(), edge = new Builder();
    const tops: THREE.BufferGeometry[] = [], steel: THREE.BufferGeometry[] = [], signs: THREE.BufferGeometry[] = [];
    const roof = new Builder();
    const station = map.places.find((p) => p.type === 'station');
    for (const poly of map.platforms) {
      const ring = ensureCCW(poly);
      const rail = runs.length > 0 ? railSides(ring, runs) : ring.map(() => false);
      tops.push(polygonGeometry(ring, PLATFORM_H, 4));
      platformGeometry(ring, rail, walls, edge);

      const ax = axisOf(ring);
      const len = Math.min(CANOPY_LEN, ax.s1 - ax.s0);
      const target = station ? station.position[0] * ax.d[0] + station.position[1] * ax.d[1] : (ax.s0 + ax.s1) / 2;
      const sa = Math.min(Math.max(target - len / 2, ax.s0), ax.s1 - len), sb = sa + len;
      canopyRoof(roof, ax, sa, sb);
      const yR = PLATFORM_H + CANOPY_RIDGE, yE = PLATFORM_H + CANOPY_EAVE;
      for (let s = sa + POST_STEP / 2; s < sb; s += POST_STEP) {
        steel.push(post(at(ax, s, ax.tc), PLATFORM_H, yR - 0.1));
        steel.push(beam(at(ax, s, ax.tc), yE - 0.06, ax.w, ax.width + 2 * CANOPY_OVERHANG - 0.3, 0.08, 0.12));
      }
      steel.push(beam(at(ax, (sa + sb) / 2, ax.tc), yR - 0.12, ax.d, len, 0.1, 0.14));

      // Carteles: uno pasando cada punta del alero, contra el borde de atrás, mirando a la vía
      const railEdge = ring.findIndex((_, i) => rail[i]);
      let toRail = 1;
      if (railEdge >= 0) {
        const a = ring[railEdge], c = ring[(railEdge + 1) % ring.length];
        toRail = Math.sign(-(c[1] - a[1]) * ax.w[0] + (c[0] - a[0]) * ax.w[1]) || 1;
      }
      const tBack = ax.tc - toRail * (ax.width / 2 - 0.35);
      const yaw = Math.atan2(ax.w[0] * toRail, ax.w[1] * toRail);
      const yBottom = PLATFORM_H + STATION_SIGN_BOTTOM;
      for (const s of [sa - 8, sb + 8]) {
        const sc = Math.min(Math.max(s, ax.s0 + STATION_SIGN_W), ax.s1 - STATION_SIGN_W);
        const p = at(ax, sc, tBack);
        const g = signGeometry(STATION_SIGN_W, true);
        g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(p[0], yBottom + SIGN_H / 2, p[1]),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
        signs.push(g);
        for (const k of [-1, 1]) steel.push(post(at(ax, sc + k * (STATION_SIGN_W / 2 - 0.25), tBack), PLATFORM_H, yBottom + SIGN_H, 0.045));
      }
    }
    group.add(mesh('platform', merge([...tops, walls.build()], 'andenes'), materials.platform, true));
    group.add(mesh('platformEdge', edge.build(), new THREE.MeshLambertMaterial({
      color: '#e9c21b', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    })));
    const roofMap = corrugatedTexture();
    group.add(mesh('canopy', roof.build(), new THREE.MeshLambertMaterial({ map: roofMap, color: '#9a5a44' }), true));
    group.add(mesh('steel', merge(steel, 'postes'), new THREE.MeshLambertMaterial({ color: '#2f4a3a' })));
    group.add(mesh('stationSigns', merge(signs, 'carteles'), signMaterial(signTexture('ADROGUÉ', TYPE_LOOK.station, STATION_SIGN_W))));
  }
  for (const c of group.children) c.updateMatrix();
  return group;
}

// ─── Monumentos ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Monument = Extract<Prop, { kind: 'monument' }>;

const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
};
const ball = (r: number, x: number, y: number, z: number): THREE.BufferGeometry => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z);
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(r0, r1, h, 8).translate(x, y, z);

/** Figura de pie (≈ 2,45 m), mirando a +z, pies en y = 0: botas, levita, torso, brazos, cabeza y bicornio. */
function standingFigure(): THREE.BufferGeometry[] {
  return [
    box(0.9, 0.08, 0.9, 0, 0.04, 0),
    box(0.2, 0.95, 0.24, -0.13, 0.555, 0), box(0.2, 0.95, 0.24, 0.13, 0.555, 0),
    cyl(0.3, 0.4, 0.75, 0, 1.08, -0.02),
    box(0.56, 0.62, 0.32, 0, 1.72, 0),
    box(0.15, 0.7, 0.17, 0.36, 1.67, 0),
    box(0.15, 0.68, 0.17, -0.36, 2.02, 0.28, -1.0), // brazo izquierdo hacia adelante
    cyl(0.07, 0.08, 0.12, 0, 2.08, 0),
    ball(0.15, 0, 2.25, 0),
    box(0.46, 0.12, 0.18, 0, 2.4, 0),
  ];
}

/** Caballo (hacia +z) con jinete: ≈ 2,9 m de alto y 2,4 de largo, entra en el pedestal de 3 × 3. */
function equestrianFigure(): THREE.BufferGeometry[] {
  const body = new THREE.CylinderGeometry(0.36, 0.36, 1.5, 8).rotateX(Math.PI / 2).translate(0, 1.45, 0);
  return [
    body, ball(0.4, 0, 1.47, 0.7), ball(0.38, 0, 1.45, -0.7),
    box(0.13, 1.15, 0.15, -0.2, 0.575, 0.65), box(0.13, 1.15, 0.15, 0.2, 0.575, 0.65),
    box(0.13, 1.15, 0.15, -0.2, 0.575, -0.7), box(0.13, 1.15, 0.15, 0.2, 0.575, -0.7),
    box(0.26, 0.85, 0.34, 0, 2.0, 0.98, 0.6), // pescuezo
    box(0.22, 0.26, 0.6, 0, 2.3, 1.3, 0.35), // cabeza
    box(0.1, 0.75, 0.12, 0, 1.2, -1.08, -0.35), // cola
    box(0.13, 0.6, 0.18, -0.32, 1.5, 0.05), box(0.13, 0.6, 0.18, 0.32, 1.5, 0.05), // piernas del jinete
    box(0.48, 0.62, 0.3, 0, 2.12, -0.05),
    box(0.14, 0.62, 0.16, 0.3, 2.42, 0.25, -1.2), // brazo señalando
    ball(0.14, 0, 2.6, -0.05),
    box(0.42, 0.11, 0.17, 0, 2.75, -0.05),
  ];
}

/** Pedestal de granito del tamaño exacto de la colisión, en tres franjas (zócalo, dado y cornisa). */
function pedestalParts(c: Vec2, side: number, height: number): THREE.BufferGeometry[] {
  const bands: [number, number, string][] = [[0, 0.35, '#a39d92'], [0.35, height - 0.28, '#dcd6ca'], [height - 0.28, height, '#ece6da']];
  return bands.map(([y0, y1, color]) => {
    const g = colorAttr(box(side, y1 - y0, side, c[0], (y0 + y1) / 2, c[1]), color);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * side) / 2, (uv.getY(i) * (y1 - y0)) / 2); // granito cada 2 m
    return g;
  });
}

/** Granito claro moteado (canvas determinista). */
const graniteTexture = (): THREE.CanvasTexture =>
  canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#bdb8b0';
    ctx.fillRect(0, 0, 128, 128);
    const shades = ['#8f8a83', '#d9d5ce', '#a7a29a', '#6f6b66', '#cbc6bf'];
    for (let i = 0; i < 2200; i++) {
      const h = (k: number): number => hashIndex(50_000 + i * 8 + k);
      ctx.fillStyle = shades[Math.floor(h(0) * shades.length)];
      ctx.fillRect(Math.floor(h(1) * 128), Math.floor(h(2) * 128), 1 + Math.floor(h(3) * 2), 1 + Math.floor(h(4) * 2));
    }
  });

/** `places` (opcional): la figura mira hacia el spawn de su lugar, así el teletransporte la muestra de frente. */
export function buildMonuments(props: Prop[], places: Place[] = []): THREE.Group {
  const group = new THREE.Group();
  group.name = 'monuments';
  const list = props.filter((p): p is Monument => p.kind === 'monument');
  if (list.length === 0) return group;
  const pedestals: THREE.BufferGeometry[] = [], figures: THREE.BufferGeometry[] = [];
  for (const mo of list) {
    const dims = mo.style === 'column' ? COLUMN : PEDESTAL;
    pedestals.push(...pedestalParts(mo.position, dims.side, dims.height));
    const spawn = places.find((p) => p.id === mo.placeId)?.spawn;
    const dx = spawn ? spawn[0] - mo.position[0] : 0, dz = spawn ? spawn[2] - mo.position[1] : 1;
    const t = new THREE.Matrix4().compose(new THREE.Vector3(mo.position[0], dims.height, mo.position[1]),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz)),
      new THREE.Vector3().setScalar(mo.style === 'column' ? 1.2 : 1));
    for (const g of mo.style === 'equestrian' ? equestrianFigure() : standingFigure()) figures.push(g.applyMatrix4(t));
  }
  group.add(mesh('pedestals', merge(pedestals, 'pedestales'), new THREE.MeshLambertMaterial({ vertexColors: true, map: graniteTexture() }), true));
  group.add(mesh('figures', merge(figures, 'figuras'), new THREE.MeshLambertMaterial({ color: '#6a7758' }), true));
  for (const c of group.children) c.updateMatrix();
  return group;
}
