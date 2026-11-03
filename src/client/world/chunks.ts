import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MARGIN_M, pointInPolygon } from '../../shared/geo.ts';
import type { Vec2 } from '../../shared/geo.ts';
import type { MapData, Road } from '../../shared/mapdata.ts';
import { extrudeBuilding, polygonGeometry, ribbon } from './geometry.ts';
import type { WorldMaterials } from './types.ts';

export const CHUNK = 250;
const GRASS_UV = 4;
const PLANAR_UV = 4;
// Capas del suelo (separadas para evitar z-fighting): césped 0 < vereda < asfalto < sendas/peatonales
const Y_SIDEWALK = 0.02;
const Y_ASPHALT = 0.04;
const Y_PATH = 0.06;

/** Liang–Barsky: recorta el segmento a un rectángulo; null si queda afuera. */
function clipSegment(a: Vec2, b: Vec2, minX: number, minZ: number, maxX: number, maxZ: number): [Vec2, Vec2] | null {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  let t0 = 0, t1 = 1;
  const test = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  if (!test(-dx, a[0] - minX) || !test(dx, maxX - a[0]) || !test(-dz, a[1] - minZ) || !test(dz, maxZ - a[1])) return null;
  if (t1 - t0 < 1e-9) return null;
  return [
    t0 === 0 ? a : [a[0] + dx * t0, a[1] + dz * t0],
    t1 === 1 ? b : [a[0] + dx * t1, a[1] + dz * t1],
  ];
}
const SHADOW_CASTERS = new Set<keyof WorldMaterials>(['wallGroundHouse', 'wallGroundShop', 'wallUpper', 'brickGround', 'brickUpper', 'roof', 'parapet']);

const cell = (x: number, z: number): [number, number] => [Math.floor(x / CHUNK), Math.floor(z / CHUNK)];

export function buildChunks(map: MapData, materials: WorldMaterials): THREE.Group[] {
  const chunks = new Map<string, { ij: [number, number]; parts: Map<keyof WorldMaterials, THREE.BufferGeometry[]> }>();
  const add = (ij: [number, number], mat: keyof WorldMaterials, g: THREE.BufferGeometry): void => {
    if (g.getAttribute('position').count === 0) { g.dispose(); return; }
    const key = `${ij[0]},${ij[1]}`;
    let c = chunks.get(key);
    if (!c) { c = { ij, parts: new Map() }; chunks.set(key, c); }
    let list = c.parts.get(mat);
    if (!list) { list = []; c.parts.set(mat, list); }
    list.push(g);
  };

  // Suelo base por tile de chunk, cubriendo bounds + margen
  const bd = map.bounds;
  const x0 = bd.minX - MARGIN_M, x1 = bd.maxX + MARGIN_M, z0 = bd.minZ - MARGIN_M, z1 = bd.maxZ + MARGIN_M;
  const [ci0, cj0] = cell(x0, z0);
  const [ci1, cj1] = cell(x1, z1);
  for (let i = ci0; i <= ci1; i++) {
    for (let j = cj0; j <= cj1; j++) {
      const ax = Math.max(x0, i * CHUNK), bx = Math.min(x1, (i + 1) * CHUNK);
      const az = Math.max(z0, j * CHUNK), bz = Math.min(z1, (j + 1) * CHUNK);
      if (bx <= ax || bz <= az) continue;
      add([i, j], 'grass', polygonGeometry([[ax, az], [bx, az], [bx, bz], [ax, bz]], 0, GRASS_UV));
    }
  }

  // Edificios por centroide
  for (const b of map.buildings) {
    let cx = 0, cz = 0;
    for (const [x, z] of b.footprint) { cx += x; cz += z; }
    const ij = cell(cx / b.footprint.length, cz / b.footprint.length);
    const e = extrudeBuilding(b);
    const brick = b.wall === 'brick';
    const groundMat = brick ? 'brickGround' : b.kind === 'house' ? 'wallGroundHouse' : 'wallGroundShop';
    add(ij, groundMat, e.walls.ground);
    add(ij, brick ? 'brickUpper' : 'wallUpper', e.walls.upper);
    add(ij, 'roof', e.roof);
    add(ij, 'parapet', e.parapet);
  }

  // Calles: se recortan al suelo (bounds + margen) y se parten en corridas de segmentos
  // consecutivos del mismo chunk (por punto medio).
  const addRibbonRuns = (r: Road, width: number, y: number, mat: keyof WorldMaterials): void => {
    let run: Vec2[] = [];
    let runIj: [number, number] | null = null;
    let runV = 0;
    let travelled = 0; // metros del polilínea original antes del segmento actual
    const flush = (): void => {
      if (runIj && run.length >= 2) add(runIj, mat, ribbon(run, width, y, runV));
      run = []; runIj = null;
    };
    for (let k = 0; k < r.points.length - 1; k++) {
      const a = r.points[k], c = r.points[k + 1];
      const segLen = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const clipped = clipSegment(a, c, x0, z0, x1, z1);
      if (!clipped) { flush(); travelled += segLen; continue; }
      const [ca, cc] = clipped;
      const startCut = ca[0] !== a[0] || ca[1] !== a[1];
      const endCut = cc[0] !== c[0] || cc[1] !== c[1];
      const ij = cell((ca[0] + cc[0]) / 2, (ca[1] + cc[1]) / 2);
      if (runIj && (startCut || ij[0] !== runIj[0] || ij[1] !== runIj[1])) flush();
      if (!runIj) {
        runIj = ij; run = [ca];
        runV = (travelled + Math.hypot(ca[0] - a[0], ca[1] - a[1])) / PLANAR_UV;
      }
      run.push(cc);
      if (endCut) flush();
      travelled += segLen;
    }
    flush();
  };
  for (const r of map.roads) {
    if (r.points.length < 2) continue;
    if (r.kind === 'footway') {
      const k = Math.floor((r.points.length - 1) / 2);
      const mid: Vec2 = [(r.points[k][0] + r.points[k + 1][0]) / 2, (r.points[k][1] + r.points[k + 1][1]) / 2];
      if (map.parks.some((p) => pointInPolygon(mid, p.polygon))) continue; // lo dibuja el parque
      addRibbonRuns(r, r.width, Y_PATH, 'sidewalk');
    } else if (r.kind === 'pedestrian') {
      addRibbonRuns(r, r.width, Y_PATH, 'sidewalk');
    } else {
      addRibbonRuns(r, r.width, Y_ASPHALT, 'asphalt');
      if (r.sidewalk > 0) addRibbonRuns(r, r.width + 2 * r.sidewalk, Y_SIDEWALK, 'sidewalk');
    }
  }

  const groups: THREE.Group[] = [];
  for (const { ij, parts } of chunks.values()) {
    const group = new THREE.Group();
    group.name = `chunk ${ij[0]},${ij[1]}`;
    group.userData.chunk = ij;
    for (const [mat, geoms] of parts) {
      let merged: THREE.BufferGeometry;
      if (geoms.length === 1) merged = geoms[0];
      else {
        const m = mergeGeometries(geoms, false);
        if (!m) throw new Error(`mergeGeometries falló para ${mat} en chunk ${ij}`);
        merged = m;
        for (const g of geoms) g.dispose();
      }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[mat]);
      mesh.name = mat;
      mesh.castShadow = SHADOW_CASTERS.has(mat);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    groups.push(group);
  }
  return groups;
}
