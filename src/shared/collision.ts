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
/** Los bordes a menos de r + CONTACT_MARGIN también son contactos, y cada vuelta de `pushOut` avanza a lo sumo eso
 *  (región de confianza): la linealización de un vértice casi de costado da un pliegue lejano, y así lo que estaba en
 *  contacto sigue al alcance y se vuelve a linealizar en vez de pasarse. */
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
  // Contactos de pushOut, cada uno un semiplano n·p ≥ b con n unitaria.
  private readonly cnx = new Float64Array(MAX_CONTACTS);
  private readonly cnz = new Float64Array(MAX_CONTACTS);
  private readonly cb = new Float64Array(MAX_CONTACTS);
  private contactInside = false; // algún contacto viene de un centro adentro de un prisma
  private solX = 0; // salida de solve()
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
   *  Cada vuelta junta los contactos (aristas a < r + CONTACT_MARGIN; si el centro está adentro de un prisma, solo la
   *  salida por su borde más cercano), los linealiza como semiplanos desplazados r desde el punto más cercano (del lado
   *  seguro: cumplirlo deja el disco a ≥ r de esa arista) y busca el punto más cercano al pedido que los cumple todos:
   *  el mismo, una proyección o el pliegue entre dos. Así un rincón agudo o un hueco angosto se resuelven juntos en vez
   *  de rebotar entre paredes. Cada vuelta avanza a lo sumo CONTACT_MARGIN (salvo la salida de un prisma).
   *  Puede no haber salida (hueco más angosto que 2r, centro hundido en prismas pegados): devuelve el último intento
   *  y el que llama lo detecta con `overlaps(resultado)` (el controlador rechaza ese movimiento). */
  pushOut(x: number, z: number, r: number, minY: number, maxY: number): Vec2 {
    let ax = x, az = z; // ancla: el punto pedido, o la salida de un prisma si el centro estaba adentro
    for (let iter = 0; iter < PUSH_ITERS; iter++) {
      const k = this.contacts(x, z, r, minY, maxY);
      if (k === 0) break;
      if (this.contactInside) {
        ax = x;
        az = z;
      }
      if (!this.solve(k, ax, az)) break;
      let sx = this.solX, sz = this.solZ;
      const step = Math.hypot(sx - x, sz - z);
      if (this.contactInside) {
        ax = sx; // la salida de un prisma puede ser larga: no se recorta y pasa a ser el ancla
        az = sz;
      } else if (step > CONTACT_MARGIN) {
        sx = x + ((sx - x) * CONTACT_MARGIN) / step;
        sz = z + ((sz - z) * CONTACT_MARGIN) / step;
      }
      x = sx;
      z = sz;
      if (step <= 1e-9) break;
    }
    return [x, z];
  }

  /** Junta en cnx/cnz/cb los contactos del disco en (x, z); devuelve cuántos. Con el centro afuera de un prisma,
   *  cada arista a menos de r + CONTACT_MARGIN; con el centro adentro, solo la salida por el borde más cercano. */
  private contacts(x: number, z: number, r: number, minY: number, maxY: number): number {
    const g = this.grid;
    const reach = r + CONTACT_MARGIN;
    const n = g.query(x - reach, z - reach, x + reach, z + reach);
    let k = 0;
    this.contactInside = false;
    for (let f = 0; f < n; f++) {
      const s = this.solids[g.found[f]];
      if (!overlapsY(s, minY, maxY) || bboxMisses(s, x, z, reach)) continue;
      const v = s.v;
      const inside = insideRing(v, x, z);
      let d2 = Infinity, qx = 0, qz = 0, ex = 0, ez = 0; // borde más cercano (si está adentro)
      for (let i = 0, j = v.length - 2; i < v.length; j = i, i += 2) {
        const ax = v[j], az = v[j + 1], bx = v[i], bz = v[i + 1];
        const t = segT(x, z, ax, az, bx, bz);
        const px = ax + t * (bx - ax), pz = az + t * (bz - az);
        const e2 = (px - x) * (px - x) + (pz - z) * (pz - z);
        if (!inside) {
          if (e2 < reach * reach) k = this.addContact(k, x, z, r, px, pz, e2, bx - ax, bz - az, false);
        } else if (e2 < d2) {
          d2 = e2; qx = px; qz = pz; ex = bx - ax; ez = bz - az;
        }
      }
      if (inside && d2 < Infinity) {
        k = this.addContact(k, x, z, r, qx, qz, d2, ex, ez, true);
        this.contactInside = true;
      }
    }
    return k;
  }

  /** Agrega el semiplano del punto del borde q (a distancia² d2 del centro, sobre una arista de dirección e): el centro
   *  tiene que quedar a ≥ r de q en la dirección de salida. Si ya hay MAX_CONTACTS, reemplaza al menos violado. */
  private addContact(k: number, x: number, z: number, r: number, qx: number, qz: number, d2: number, ex: number, ez: number, inside: boolean): number {
    const { cnx, cnz, cb } = this;
    const d = Math.sqrt(d2);
    let nx: number, nz: number;
    if (d > 1e-9) {
      const sgn = inside ? -1 : 1; // hacia afuera del prisma
      nx = (sgn * (x - qx)) / d;
      nz = (sgn * (z - qz)) / d;
    } else {
      const el = Math.hypot(ex, ez);
      nx = -ez / el; // normal exterior de una arista antihoraria vista desde arriba
      nz = ex / el;
    }
    const b = nx * qx + nz * qz + r + SKIN;
    let slot = k;
    if (k === MAX_CONTACTS) {
      let mv = Infinity;
      for (let i = 0; i < k; i++) {
        const vi = cb[i] - cnx[i] * x - cnz[i] * z;
        if (vi < mv) {
          mv = vi; slot = i;
        }
      }
      if (b - nx * x - nz * z <= mv) return k;
    } else {
      k++;
    }
    cnx[slot] = nx; cnz[slot] = nz; cb[slot] = b;
    return k;
  }

  /** Punto más cercano a (ax, az) que cumple los k semiplanos (en solX/solZ). En 2D es el ancla, la proyección sobre
   *  una recta o la intersección de dos: se prueban todas. false si ninguna los cumple a todos. */
  private solve(k: number, ax: number, az: number): boolean {
    const { cnx, cnz, cb } = this;
    if (this.feasible(k, ax, az)) {
      this.solX = ax;
      this.solZ = az;
      return true;
    }
    let best = Infinity;
    for (let i = 0; i < k; i++) {
      const vi = cb[i] - cnx[i] * ax - cnz[i] * az;
      if (vi <= 0 || vi * vi >= best) continue;
      const x = ax + vi * cnx[i], z = az + vi * cnz[i];
      if (this.feasible(k, x, z)) {
        best = vi * vi; this.solX = x; this.solZ = z;
      }
    }
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const det = cnx[i] * cnz[j] - cnz[i] * cnx[j];
        if (Math.abs(det) < 1e-9) continue; // paralelas
        const x = (cb[i] * cnz[j] - cb[j] * cnz[i]) / det;
        const z = (cnx[i] * cb[j] - cnx[j] * cb[i]) / det;
        const e2 = (x - ax) * (x - ax) + (z - az) * (z - az);
        if (e2 < best && this.feasible(k, x, z)) {
          best = e2; this.solX = x; this.solZ = z;
        }
      }
    }
    return best < Infinity;
  }

  private feasible(k: number, x: number, z: number): boolean {
    for (let i = 0; i < k; i++) if (this.cnx[i] * x + this.cnz[i] * z < this.cb[i] - 1e-9) return false;
    return true;
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

const PLATFORM_H = 1.0;
const TRUNK_R = 0.3;
const TRUNK_H = 3;
const DUMPSTER = { length: 1.8, depth: 1.1, height: 1.4 };
const BENCH = { length: 1.8, depth: 0.6, height: 0.5 };
const FOUNTAIN_H = 0.6;
const PEDESTAL = { side: 3, height: 2.5 };
const COLUMN = { side: 2, height: 6 };

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
