// Mundo de colisiones 2,5D: prismas verticales (planta poligonal × [minY, maxY]) y volúmenes de escalera,
// indexados en una grilla uniforme. Lo usan el cliente y, más adelante, el servidor: solo depende de src/shared.
import { signedAreaFromAbove } from './geo.ts';
import type { Vec2, Vec3 } from './geo.ts';
import type { Bounds, MapData } from './mapdata.ts';

export interface Prism { polygon: Vec2[]; minY: number; maxY: number; tag?: string }
/** Volumen de una escalera de mano: 0,8 m de ancho a lo largo de la pared y 0,6 m de profundidad desde `base`
 *  hacia `normal` (normal exterior de la pared), con y ∈ [0, topY]. No colisiona: solo lo consulta `ladderAt`. */
export interface LadderVolume { base: Vec2; normal: Vec2; topY: number }
export interface RayHit { dist: number; point: Vec3; normal: Vec3; tag?: string }

/** Tolerancia vertical: un intervalo que solo toca la tapa (pies = maxY ± EPS) no se superpone y sí apoya. */
const EPS = 1e-6;
/** Holgura que agrega `pushOut` para que el resultado quede estrictamente afuera. */
const SKIN = 1e-6;
/** Vueltas de `pushOut` (cada una: juntar contactos, linealizarlos y resolverlos juntos). */
const PUSH_ITERS = 12;
/** Contactos simultáneos que resuelve `pushOut` (se quedan los más profundos). */
const MAX_CONTACTS = 8;
/** Los bordes a menos de r + CONTACT_MARGIN también son contactos, y cada vuelta de `pushOut` desde afuera avanza a lo
 *  sumo eso: lo que estaba en contacto sigue al alcance en la vuelta siguiente. */
const CONTACT_MARGIN = 0.1;
const LADDER_HALF_W = 0.4;
const LADDER_DEPTH = 0.6;

interface Box { minX: number; minZ: number; maxX: number; maxZ: number }

interface Solid extends Box {
  v: Float64Array; // vértices antihorarios vistos desde arriba: x0, z0, x1, z1, …
  minY: number;
  maxY: number;
  tag: string | undefined;
}

interface Ladder extends Box {
  src: LadderVolume;
  bx: number; bz: number; // base
  nx: number; nz: number; // normal unitaria
  tx: number; tz: number; // tangente unitaria
}

/** Grilla uniforme sobre las cajas de los elementos. Las consultas llenan `found` con índices sin repetir. */
class Grid {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  readonly size: number;
  readonly nx: number;
  readonly nz: number;
  readonly found: Int32Array;
  private readonly start: Int32Array;
  private readonly items: Int32Array;
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(boxes: readonly Box[], size: number) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const b of boxes) {
      x0 = Math.min(x0, b.minX); z0 = Math.min(z0, b.minZ);
      x1 = Math.max(x1, b.maxX); z1 = Math.max(z1, b.maxZ);
    }
    const empty = boxes.length === 0;
    this.x0 = empty ? 0 : x0; this.z0 = empty ? 0 : z0;
    this.x1 = empty ? 0 : x1; this.z1 = empty ? 0 : z1;
    this.size = size;
    this.nx = empty ? 0 : Math.floor((x1 - x0) / size) + 1;
    this.nz = empty ? 0 : Math.floor((z1 - z0) / size) + 1;
    this.found = new Int32Array(boxes.length);
    this.seen = new Uint32Array(boxes.length);

    // CSR: start[c] … start[c + 1] son los elementos de la celda c.
    const start = new Int32Array(this.nx * this.nz + 1);
    const forCells = (b: Box, f: (c: number) => void): void => {
      const i0 = this.cellX(b.minX), i1 = this.cellX(b.maxX), j0 = this.cellZ(b.minZ), j1 = this.cellZ(b.maxZ);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * this.nx + i);
    };
    for (const b of boxes) forCells(b, (c) => start[c + 1]++);
    for (let c = 0; c < this.nx * this.nz; c++) start[c + 1] += start[c];
    const items = new Int32Array(start[this.nx * this.nz]);
    const fill = start.slice(0, -1);
    boxes.forEach((b, k) => forCells(b, (c) => (items[fill[c]++] = k)));
    this.start = start;
    this.items = items;
  }

  cellX(x: number): number {
    return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.x0) / this.size)));
  }

  cellZ(z: number): number {
    return Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.z0) / this.size)));
  }

  /** Empieza una consulta nueva: los elementos ya vistos vuelven a contar. */
  begin(): void {
    if (++this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
  }

  /** Agrega a `found[n…]` los elementos de la celda que no se vieron en esta consulta; devuelve el nuevo n. */
  collect(cell: number, n: number): number {
    const { start, items, seen, found, stamp } = this;
    for (let k = start[cell], e = start[cell + 1]; k < e; k++) {
      const it = items[k];
      if (seen[it] !== stamp) {
        seen[it] = stamp;
        found[n++] = it;
      }
    }
    return n;
  }

  /** Elementos cuyas celdas tocan la caja; devuelve cuántos quedaron en `found`. */
  query(minX: number, minZ: number, maxX: number, maxZ: number): number {
    this.begin();
    if (this.nx === 0 || !(maxX >= this.x0 && minX <= this.x1 && maxZ >= this.z0 && minZ <= this.z1)) return 0;
    const i0 = this.cellX(minX), i1 = this.cellX(maxX), j0 = this.cellZ(minZ), j1 = this.cellZ(maxZ);
    let n = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) n = this.collect(j * this.nx + i, n);
    return n;
  }
}

function toSolid(p: Prism): Solid {
  const pts = signedAreaFromAbove(p.polygon) < 0 ? [...p.polygon].reverse() : p.polygon;
  const ring = pts.filter((q, i) => {
    const prev = pts[(i + pts.length - 1) % pts.length];
    return q[0] !== prev[0] || q[1] !== prev[1]; // sin vértices repetidos (ni anillo cerrado)
  });
  const v = new Float64Array(ring.length * 2);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  ring.forEach(([x, z], i) => {
    v[2 * i] = x;
    v[2 * i + 1] = z;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  });
  return { v, minX, minZ, maxX, maxZ, minY: p.minY, maxY: p.maxY, tag: p.tag };
}

function toLadder(l: LadderVolume): Ladder {
  const len = Math.hypot(l.normal[0], l.normal[1]) || 1;
  const nx = l.normal[0] / len, nz = l.normal[1] / len;
  const tx = -nz, tz = nx;
  const [bx, bz] = l.base;
  const xs = [bx - tx * LADDER_HALF_W, bx + tx * LADDER_HALF_W];
  const zs = [bz - tz * LADDER_HALF_W, bz + tz * LADDER_HALF_W];
  xs.push(xs[0] + nx * LADDER_DEPTH, xs[1] + nx * LADDER_DEPTH);
  zs.push(zs[0] + nz * LADDER_DEPTH, zs[1] + nz * LADDER_DEPTH);
  return { src: l, bx, bz, nx, nz, tx, tz, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** Parámetro t ∈ [0, 1] del punto del segmento a–b más cercano a (px, pz). */
function segT(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Paridad de cruces (mismo criterio que `pointInPolygon`) sobre el anillo plano x0, z0, x1, z1, … */
function insideRing(v: Float64Array, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = v.length - 2; i < v.length; j = i, i += 2) {
    const xi = v[i], zi = v[i + 1], xj = v[j], zj = v[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** ¿El disco queda a ≥ r de la caja del prisma? (Entonces no lo toca.) */
const bboxMisses = (s: Box, x: number, z: number, r: number): boolean =>
  x + r <= s.minX || x - r >= s.maxX || z + r <= s.minZ || z - r >= s.maxZ;

/** ¿El disco toca la planta? Adentro, o a distancia estrictamente menor que r de alguna arista. */
function discHits(s: Solid, x: number, z: number, r: number): boolean {
  if (bboxMisses(s, x, z, r)) return false;
  const v = s.v;
  const r2 = r * r;
  for (let i = 0, j = v.length - 2; i < v.length; j = i, i += 2) {
    const ax = v[j], az = v[j + 1], bx = v[i], bz = v[i + 1];
    const t = segT(x, z, ax, az, bx, bz);
    const ex = ax + t * (bx - ax) - x, ez = az + t * (bz - az) - z;
    if (ex * ex + ez * ez < r2) return true;
  }
  return insideRing(v, x, z);
}

const overlapsY = (s: Solid, minY: number, maxY: number): boolean => minY < s.maxY - EPS && maxY > s.minY + EPS;

export class CollisionWorld {
  readonly bounds: Bounds;
  private readonly solids: Solid[];
  private readonly ladders: Ladder[];
  private readonly grid: Grid;
  private readonly ladderGrid: Grid;
  private readonly hitNormal: [number, number, number] = [0, 0, 0]; // búfer de rayPrism: evita reservar en cada rayo
  // Contactos de pushOut. Arista: semiplano n·p ≥ b (cx, cz = n unitaria, cb = b). Vértice: el centro tiene que quedar
  // fuera del círculo de radio r + SKIN alrededor de (cx, cz). cv = cuánto se viola en el punto donde se juntaron.
  private readonly cIsVertex = new Uint8Array(MAX_CONTACTS);
  private readonly cx = new Float64Array(MAX_CONTACTS);
  private readonly cz = new Float64Array(MAX_CONTACTS);
  private readonly cb = new Float64Array(MAX_CONTACTS);
  private readonly cv = new Float64Array(MAX_CONTACTS);
  private rho = 0; // r + SKIN de la consulta en curso
  // Si el centro está adentro de algún prisma: la salida del más hundido por su propio borde más cercano.
  private inside = false;
  private exitX = 0;
  private exitZ = 0;
  // Estado de solve(): iterado, salto máximo² y mejor candidato.
  private sPx = 0;
  private sPz = 0;
  private sJump2 = 0;
  private sBest = 0;
  private solX = 0;
  private solZ = 0;

  constructor(prisms: Prism[], ladders: LadderVolume[], bounds: Bounds, cellSize = 16) {
    if (!(cellSize > 0)) throw new RangeError(`cellSize inválido: ${cellSize}`);
    this.bounds = bounds;
    this.solids = prisms.map(toSolid);
    this.ladders = ladders.map(toLadder);
    this.grid = new Grid(this.solids, cellSize);
    this.ladderGrid = new Grid(this.ladders, cellSize);
  }

  /** ¿El cilindro (disco de radio r en (x, z), y ∈ [minY, maxY]) se mete en algún prisma? El disco toca la planta si
   *  el centro está adentro o a distancia < r de un borde (tocar a exactamente r no cuenta), y las alturas tienen que
   *  superponerse con largo > 0: con los pies en la tapa (minY = maxY del prisma) no hay superposición. */
  overlaps(x: number, z: number, r: number, minY: number, maxY: number): boolean {
    const g = this.grid;
    const n = g.query(x - r, z - r, x + r, z + r);
    for (let k = 0; k < n; k++) {
      const s = this.solids[g.found[k]];
      if (overlapsY(s, minY, maxY) && discHits(s, x, z, r)) return true;
    }
    return false;
  }

  /** Techo más alto ≤ maxY (± EPS) de los prismas cuya planta toca el disco (mismo criterio que `overlaps`); 0 = suelo. */
  supportHeight(x: number, z: number, r: number, maxY: number): number {
    const g = this.grid;
    const n = g.query(x - r, z - r, x + r, z + r);
    let best = 0;
    for (let k = 0; k < n; k++) {
      const s = this.solids[g.found[k]];
      if (s.maxY > best && s.maxY <= maxY + EPS && discHits(s, x, z, r)) best = s.maxY;
    }
    return best;
  }

  /** Posición corregida para que el disco no toque ningún prisma que se superpone en altura, moviéndolo lo mínimo.
   *  - Si el centro está adentro de un prisma, sale por el borde más cercano de ese prisma (solo esa proyección, una
   *    sola vez por llamada: si cae adentro de otro, devuelve esa salida).
   *  - Si no, junta los contactos (cada arista a < r + CONTACT_MARGIN), los convierte en restricciones del lado seguro
   *    (semiplano a r del punto más cercano de una arista; círculo de radio r si ese punto es un vértice) y va al punto
   *    más cercano que las cumple todas: el mismo, una proyección o el cruce de dos; con los contactos nuevos, repite.
   *    Así un rincón agudo o un hueco angosto se resuelven juntos en vez de rebotar entre paredes.
   *  Ninguna vuelta salta más que la penetración mayor + r + CONTACT_MARGIN (un cruce más lejano se descarta) y,
   *  desde afuera, cada vuelta avanza a lo sumo CONTACT_MARGIN: en total, a lo sumo PUSH_ITERS × CONTACT_MARGIN
   *  (1,2 m). Si hace falta más, o no hay salida (hueco más angosto que 2r, centro hundido en prismas pegados),
   *  devuelve el último intento todavía superpuesto: el que llama lo detecta con `overlaps(resultado)` (el controlador
   *  rechaza ese movimiento). */
  pushOut(x: number, z: number, r: number, minY: number, maxY: number): Vec2 {
    let exited = false;
    for (let iter = 0; iter < PUSH_ITERS; iter++) {
      const k = this.contacts(x, z, r, minY, maxY);
      if (this.inside) {
        if (exited) break; // la salida cayó adentro de otro prisma: no se encadenan saltos
        exited = true;
        x = this.exitX;
        z = this.exitZ;
        continue;
      }
      if (k === 0) break;
      let depth = 0;
      for (let i = 0; i < k; i++) depth = Math.max(depth, this.cv[i]);
      if (!this.solve(k, x, z, depth + r + CONTACT_MARGIN)) break;
      const step = Math.hypot(this.solX - x, this.solZ - z);
      const f = step > CONTACT_MARGIN ? CONTACT_MARGIN / step : 1;
      x += (this.solX - x) * f;
      z += (this.solZ - z) * f;
      if (step <= 1e-9) break;
    }
    return [x, z];
  }

  /** Junta los contactos del disco en (x, z) y devuelve cuántos. Si el centro está adentro de algún prisma, deja en
   *  exitX/exitZ la salida del más hundido. */
  private contacts(x: number, z: number, r: number, minY: number, maxY: number): number {
    const g = this.grid;
    const reach = r + CONTACT_MARGIN;
    const n = g.query(x - reach, z - reach, x + reach, z + reach);
    let k = 0;
    let exitDepth = -Infinity, exitIdx = -1;
    this.rho = r + SKIN;
    this.inside = false;
    for (let f = 0; f < n; f++) {
      const si = g.found[f];
      const s = this.solids[si];
      if (!overlapsY(s, minY, maxY) || bboxMisses(s, x, z, reach)) continue;
      const v = s.v;
      const inside = insideRing(v, x, z);
      let d2 = Infinity, qx = 0, qz = 0, ex = 0, ez = 0; // borde más cercano (si está adentro)
      for (let i = 0, j = v.length - 2; i < v.length; j = i, i += 2) {
        const ax = v[j], az = v[j + 1], bx = v[i], bz = v[i + 1];
        const t = segT(x, z, ax, az, bx, bz);
        const px = t <= 0 ? ax : t >= 1 ? bx : ax + t * (bx - ax); // los vértices, exactos
        const pz = t <= 0 ? az : t >= 1 ? bz : az + t * (bz - az);
        const e2 = (px - x) * (px - x) + (pz - z) * (pz - z);
        if (!inside) {
          if (e2 < reach * reach) k = this.addContact(k, x, z, px, pz, e2, bx - ax, bz - az, t <= 0 || t >= 1);
        } else if (e2 < d2) {
          d2 = e2; qx = px; qz = pz; ex = bx - ax; ez = bz - az;
        }
      }
      if (!inside || d2 === Infinity) continue;
      const d = Math.sqrt(d2);
      if (r + d < exitDepth || (r + d === exitDepth && si > exitIdx)) continue;
      exitDepth = r + d; exitIdx = si;
      let ox: number, oz: number; // dirección de salida
      if (d > 1e-9) {
        ox = (qx - x) / d; oz = (qz - z) / d;
      } else {
        const el = Math.hypot(ex, ez);
        ox = -ez / el; oz = ex / el; // normal exterior de una arista antihoraria vista desde arriba
      }
      this.inside = true;
      this.exitX = qx + ox * this.rho;
      this.exitZ = qz + oz * this.rho;
    }
    return k;
  }

  /** Agrega el contacto con el punto del borde q, a distancia² d2 del centro (e = dirección de su arista). Si ya hay
   *  MAX_CONTACTS, reemplaza al menos violado cuando este lo está más. */
  private addContact(k: number, x: number, z: number, qx: number, qz: number, d2: number, ex: number, ez: number, vertex: boolean): number {
    const { cIsVertex, cx, cz, cb, cv, rho } = this;
    const d = Math.sqrt(d2);
    const isVertex = vertex && d > 1e-9; // con el centro justo sobre el vértice, mejor el semiplano de la arista
    let ax: number, az: number, b = 0;
    if (isVertex) {
      for (let i = 0; i < k; i++) if (cIsVertex[i] && cx[i] === qx && cz[i] === qz) return k; // vértice compartido
      ax = qx; az = qz;
    } else {
      if (d > 1e-9) {
        ax = (x - qx) / d; az = (z - qz) / d;
      } else {
        const el = Math.hypot(ex, ez);
        ax = -ez / el; az = ex / el;
      }
      b = ax * qx + az * qz + rho;
    }
    const viol = rho - d;
    let slot = k;
    if (k === MAX_CONTACTS) {
      let mv = Infinity;
      for (let i = 0; i < k; i++) {
        if (cv[i] < mv) {
          mv = cv[i]; slot = i;
        }
      }
      if (viol <= mv) return k;
    } else {
      k++;
    }
    cIsVertex[slot] = isVertex ? 1 : 0; cx[slot] = ax; cz[slot] = az; cb[slot] = b; cv[slot] = viol;
    return k;
  }

  /** Punto más cercano a (ax, az) que cumple los k contactos, a lo sumo a maxJump; queda en solX/solZ. En 2D es el
   *  mismo punto, la proyección sobre un contacto o un cruce de dos: se prueban todos. */
  private solve(k: number, ax: number, az: number, maxJump: number): boolean {
    const { cIsVertex, cx, cz, cb } = this;
    const rho = this.rho;
    this.sPx = ax; this.sPz = az;
    this.sJump2 = maxJump * maxJump;
    this.sBest = Infinity;
    this.candidate(k, ax, az);
    for (let i = 0; i < k; i++) {
      if (cIsVertex[i]) {
        const dx = ax - cx[i], dz = az - cz[i], l = Math.hypot(dx, dz);
        if (l > 1e-12 && l < rho) this.candidate(k, cx[i] + (dx * rho) / l, cz[i] + (dz * rho) / l);
      } else {
        const vi = cb[i] - cx[i] * ax - cz[i] * az;
        if (vi > 0) this.candidate(k, ax + vi * cx[i], az + vi * cz[i]);
      }
    }
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        if (!cIsVertex[i] && !cIsVertex[j]) {
          const det = cx[i] * cz[j] - cz[i] * cx[j];
          if (Math.abs(det) < 1e-9) continue; // paralelas
          this.candidate(k, (cb[i] * cz[j] - cb[j] * cz[i]) / det, (cx[i] * cb[j] - cx[j] * cb[i]) / det);
        } else if (cIsVertex[i] && cIsVertex[j]) {
          // círculo ∩ círculo (mismo radio)
          const dx = cx[j] - cx[i], dz = cz[j] - cz[i], d = Math.hypot(dx, dz);
          if (d < 1e-12 || d > 2 * rho) continue;
          const h = Math.sqrt(rho * rho - (d * d) / 4) / d;
          const mx = (cx[i] + cx[j]) / 2, mz = (cz[i] + cz[j]) / 2;
          this.candidate(k, mx - dz * h, mz + dx * h);
          this.candidate(k, mx + dz * h, mz - dx * h);
        } else {
          // recta n·p = b ∩ círculo de centro c
          const li = cIsVertex[i] ? j : i, ci = cIsVertex[i] ? i : j;
          const nx = cx[li], nz = cz[li];
          const off = cb[li] - nx * cx[ci] - nz * cz[ci];
          if (Math.abs(off) > rho) continue;
          const h = Math.sqrt(rho * rho - off * off);
          const fx = cx[ci] + off * nx, fz = cz[ci] + off * nz;
          this.candidate(k, fx - nz * h, fz + nx * h);
          this.candidate(k, fx + nz * h, fz - nx * h);
        }
      }
    }
    return this.sBest < Infinity;
  }

  /** Se queda con (x, z) si es el más cercano hasta ahora, está a ≤ maxJump y cumple todos los contactos. */
  private candidate(k: number, x: number, z: number): void {
    const e2 = (x - this.sPx) * (x - this.sPx) + (z - this.sPz) * (z - this.sPz);
    if (e2 >= this.sBest || e2 > this.sJump2) return;
    const { cIsVertex, cx, cz, cb } = this;
    const rho2 = this.rho * this.rho - 1e-9;
    for (let i = 0; i < k; i++) {
      if (cIsVertex[i] ? (x - cx[i]) * (x - cx[i]) + (z - cz[i]) * (z - cz[i]) < rho2 : cx[i] * x + cz[i] * z < cb[i] - 1e-9) return;
    }
    this.sBest = e2;
    this.solX = x;
    this.solZ = z;
  }

  /** Escalera cuyo volumen toca el disco, con 0 ≤ y ≤ topY (± EPS). Si hay varias, la más cercana. */
  ladderAt(x: number, z: number, r: number, y: number): LadderVolume | null {
    const g = this.ladderGrid;
    const n = g.query(x - r, z - r, x + r, z + r);
    let best: Ladder | null = null, bestD2 = Infinity, bestI = -1;
    for (let k = 0; k < n; k++) {
      const li = g.found[k];
      const l = this.ladders[li];
      if (y < -EPS || y > l.src.topY + EPS) continue;
      const rx = x - l.bx, rz = z - l.bz;
      const u = Math.abs(rx * l.tx + rz * l.tz) - LADDER_HALF_W;
      const w = rx * l.nx + rz * l.nz;
      const du = u > 0 ? u : 0;
      const dw = w < 0 ? -w : w > LADDER_DEPTH ? w - LADDER_DEPTH : 0;
      const d2 = du * du + dw * dw;
      if (!(d2 < r * r || d2 === 0)) continue;
      if (d2 < bestD2 || (d2 === bestD2 && li < bestI)) {
        best = l; bestD2 = d2; bestI = li;
      }
    }
    return best ? best.src : null;
  }

  /** Primer impacto contra un prisma (paredes, tapas o bases) a ≤ maxDist. Solo cuentan las caras por las que el
   *  rayo entra: un rayo que nace adentro de un prisma, o justo sobre su tapa o su base (tA = 0), no golpea ese
   *  prisma. El suelo no es un prisma. */
  raycast(origin: Vec3, dir: Vec3, maxDist: number): RayHit | null {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (!(len > 0) || !(maxDist >= 0)) return null;
    const ox = origin[0], oy = origin[1], oz = origin[2];
    const dx = dir[0] / len, dy = dir[1] / len, dz = dir[2] / len;
    const g = this.grid;
    if (g.nx === 0) return null;

    // recorta el rayo a la caja de la grilla en (x, z)
    let t0 = 0, t1 = maxDist;
    if (dx !== 0) {
      const a = (g.x0 - ox) / dx, b = (g.x1 - ox) / dx;
      t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
    } else if (ox < g.x0 || ox > g.x1) return null;
    if (dz !== 0) {
      const a = (g.z0 - oz) / dz, b = (g.z1 - oz) / dz;
      t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
    } else if (oz < g.z0 || oz > g.z1) return null;
    if (!(t0 <= t1)) return null;

    // DDA por las celdas que cruza el rayo; corta cuando la celda siguiente empieza más lejos que el mejor impacto
    let ix = g.cellX(ox + dx * t0), iz = g.cellZ(oz + dz * t0);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    let tMaxX = dx !== 0 ? (g.x0 + (ix + (dx > 0 ? 1 : 0)) * g.size - ox) / dx : Infinity;
    let tMaxZ = dz !== 0 ? (g.z0 + (iz + (dz > 0 ? 1 : 0)) * g.size - oz) / dz : Infinity;
    const tDeltaX = dx !== 0 ? g.size / Math.abs(dx) : Infinity;
    const tDeltaZ = dz !== 0 ? g.size / Math.abs(dz) : Infinity;
    const nrm = this.hitNormal;
    let bestT = Infinity, bestI = -1, bnx = 0, bny = 0, bnz = 0;
    g.begin();
    for (;;) {
      const n = g.collect(iz * g.nx + ix, 0);
      for (let k = 0; k < n; k++) {
        const si = g.found[k];
        const t = rayPrism(this.solids[si], ox, oy, oz, dx, dy, dz, Math.min(maxDist, bestT), nrm);
        if (t < bestT || (t === bestT && t !== Infinity && si < bestI)) {
          bestT = t; bestI = si; bnx = nrm[0]; bny = nrm[1]; bnz = nrm[2];
        }
      }
      const tNext = Math.min(tMaxX, tMaxZ);
      if (tNext >= bestT || tNext > t1) break;
      if (tMaxX < tMaxZ) {
        ix += stepX; tMaxX += tDeltaX;
      } else {
        iz += stepZ; tMaxZ += tDeltaZ;
      }
      if (!(ix >= 0 && ix < g.nx && iz >= 0 && iz < g.nz)) break;
    }
    if (bestI < 0) return null;
    // `+ 0` convierte −0 en 0
    const hit: RayHit = { dist: bestT, point: [ox + dx * bestT, oy + dy * bestT, oz + dz * bestT], normal: [bnx + 0, bny + 0, bnz + 0] };
    const tag = this.solids[bestI].tag;
    if (tag !== undefined) hit.tag = tag;
    return hit;
  }
}

/** t del primer impacto del rayo (dir unitaria) con el prisma, en [0, tMax]; Infinity si no hay. Deja la normal
 *  en `out`. */
function rayPrism(s: Solid, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number, out: [number, number, number]): number {
  let tA = 0, tB = tMax;
  if (dy !== 0) {
    const a = (s.minY - oy) / dy, b = (s.maxY - oy) / dy;
    tA = Math.max(tA, Math.min(a, b)); tB = Math.min(tB, Math.max(a, b));
  } else if (oy < s.minY || oy > s.maxY) return Infinity;
  if (!(tA <= tB)) return Infinity;
  const v = s.v;
  let best = Infinity;
  // tapa o base: el rayo entra a la franja de alturas en tA > 0 con el punto dentro de la planta
  if (tA > 0 && insideRing(v, ox + dx * tA, oz + dz * tA)) {
    best = tA;
    out[0] = 0; out[1] = dy < 0 ? 1 : -1; out[2] = 0;
  }
  // paredes: aristas por las que el rayo entra (dir · normal exterior < 0) dentro de [tA, tB]
  if (dx !== 0 || dz !== 0) {
    for (let i = 0, j = v.length - 2; i < v.length; j = i, i += 2) {
      const ax = v[j], az = v[j + 1];
      const ex = v[i] - ax, ez = v[i + 1] - az;
      const nx = -ez, nz = ex; // normal exterior (sin normalizar)
      const den = dx * nx + dz * nz;
      if (den >= 0) continue;
      const t = ((ax - ox) * nx + (az - oz) * nz) / den;
      if (t < tA || t > tB || t >= best) continue;
      const u = ((ox + dx * t - ax) * ex + (oz + dz * t - az) * ez) / (ex * ex + ez * ez);
      if (u < 0 || u > 1) continue;
      best = t;
      const nl = Math.hypot(nx, nz);
      out[0] = nx / nl; out[1] = 0; out[2] = nz / nl;
    }
  }
  return best;
}

// Medidas de los sólidos de los props. El cliente las usa para que lo que se ve coincida con lo que se pisa.
export const PLATFORM_H = 1.0;
export const TRUNK_R = 0.3;
export const TRUNK_H = 3;
export const DUMPSTER = { length: 1.8, depth: 1.1, height: 1.4 } as const;
export const BENCH = { length: 1.8, depth: 0.6, height: 0.5 } as const;
export const FOUNTAIN_H = 0.6;
export const PEDESTAL = { side: 3, height: 2.5 } as const;
export const COLUMN = { side: 2, height: 6 } as const;

function octagon([cx, cz]: Vec2, r: number): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    out.push([cx + r * Math.cos(a), cz - r * Math.sin(a)]); // antihorario visto desde arriba
  }
  return out;
}

/** Caja centrada en c con el largo sobre el eje local +x: rotación three.js sobre +Y, +x local → (cos θ, −sin θ). */
function orientedBox([cx, cz]: Vec2, rotation: number, length: number, depth: number): Vec2[] {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  const ux = (c * length) / 2, uz = (-s * length) / 2; // medio largo, sobre +x local
  const vx = (s * depth) / 2, vz = (c * depth) / 2; // medio ancho, sobre +z local
  return [[cx - ux + vx, cz - uz + vz], [cx + ux + vx, cz + uz + vz], [cx + ux - vx, cz + uz - vz], [cx - ux - vx, cz - uz - vz]];
}

export function buildCollisionWorld(map: MapData): CollisionWorld {
  const prisms: Prism[] = [];
  const ladders: LadderVolume[] = [];
  for (const b of map.buildings) prisms.push({ polygon: b.footprint, minY: 0, maxY: b.height, tag: b.id });
  for (const p of map.platforms) prisms.push({ polygon: p, minY: 0, maxY: PLATFORM_H, tag: 'platform' });
  for (const t of map.trees) prisms.push({ polygon: octagon(t.position, TRUNK_R), minY: 0, maxY: TRUNK_H, tag: 'tree' });
  for (const p of map.props) {
    switch (p.kind) {
      case 'ladder':
        ladders.push({ base: p.base, normal: p.normal, topY: p.topY });
        break;
      case 'dumpster':
        prisms.push({ polygon: orientedBox(p.position, p.rotation, DUMPSTER.length, DUMPSTER.depth), minY: 0, maxY: DUMPSTER.height, tag: 'dumpster' });
        break;
      case 'bench':
        prisms.push({ polygon: orientedBox(p.position, p.rotation, BENCH.length, BENCH.depth), minY: 0, maxY: BENCH.height, tag: 'bench' });
        break;
      case 'fountain':
        prisms.push({ polygon: octagon(p.position, p.radius), minY: 0, maxY: FOUNTAIN_H, tag: 'fountain' });
        break;
      case 'monument': {
        const m = p.style === 'column' ? COLUMN : PEDESTAL;
        prisms.push({ polygon: orientedBox(p.position, 0, m.side, m.side), minY: 0, maxY: m.height, tag: 'monument' });
        break;
      }
    }
  }
  return new CollisionWorld(prisms, ladders, map.bounds);
}
