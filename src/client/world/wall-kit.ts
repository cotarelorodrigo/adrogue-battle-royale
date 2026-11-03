// Piezas comunes de las paredes (geometry.ts, fronts.ts, front-atlas.ts): hoja sin imports locales, para no hacer ciclos.
import * as THREE from 'three';

/** Alto de un piso (copia de mapgen/buildings.ts; el cliente no importa mapgen). */
export const FLOOR_H = 3.2;
/** Ancho de un módulo de fachada en metros. */
export const BAY_W = 3.0;

export interface Builder {
  pos: number[]; nor: number[]; uv: number[]; col: number[] | null; idx: number[];
}
export const newBuilder = (withColor: boolean): Builder => ({ pos: [], nor: [], uv: [], col: withColor ? [] : null, idx: [] });

export function toGeometry(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  if (b.col) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setIndex(b.idx);
  return g;
}

export function vert(b: Builder, p: [number, number, number], n: [number, number, number], uv: [number, number], c?: THREE.Color): number {
  b.pos.push(...p); b.nor.push(...n); b.uv.push(...uv);
  if (b.col) b.col.push(c!.r, c!.g, c!.b);
  return b.pos.length / 3 - 1;
}

/** Cuadrilátero a,b,c,d (en ese orden alrededor) con winding antihorario visto desde el lado de `n`. */
export function quad(b: Builder, vs: [number, number, number][], uvs: [number, number][], n: [number, number, number], c?: THREE.Color): void {
  const i = vs.map((p, k) => vert(b, p, n, uvs[k], c));
  b.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
}

const tintCache = new Map<string, THREE.Color>();
export function tintColor(tint: string): THREE.Color {
  let c = tintCache.get(tint);
  if (!c) { c = new THREE.Color().setStyle(tint); tintCache.set(tint, c); }
  return c;
}
