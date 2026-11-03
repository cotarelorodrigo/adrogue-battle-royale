import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MARGIN_M, pointInPolygon } from '../../shared/geo.ts';
import type { Vec2 } from '../../shared/geo.ts';
import type { MapData, Road } from '../../shared/mapdata.ts';
import { extrudeBuilding, polygonGeometry, ribbon } from './geometry.ts';
import type { WorldMaterials } from './types.ts';

export const CHUNK = 250;
const GRASS_UV = 4;
const SHADOW_CASTERS = new Set<keyof WorldMaterials>(['wallGroundHouse', 'wallGroundShop', 'wallUpper', 'brickGround', 'brickUpper', 'roof', 'parapet']);

const cell = (x: number, z: number): [number, number] => [Math.floor(x / CHUNK), Math.floor(z / CHUNK)];

export function buildChunks(map: MapData, materials: WorldMaterials): THREE.Group[] {
  const chunks = new Map<string, { ij: [number, number]; parts: Map<keyof WorldMaterials, THREE.BufferGeometry[]> }>();
  const add = (ij: [number, number], mat: keyof WorldMaterials, g: THREE.BufferGeometry): void => {
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

  // Calles: corridas de segmentos consecutivos del mismo chunk (por punto medio)
  const addRibbonRuns = (r: Road, width: number, y: number, mat: keyof WorldMaterials): void => {
    let run: Vec2[] = [];
    let runIj: [number, number] | null = null;
    const flush = (): void => {
      if (runIj && run.length >= 2) add(runIj, mat, ribbon(run, width, y));
      run = []; runIj = null;
    };
    for (let k = 0; k < r.points.length - 1; k++) {
      const a = r.points[k], c = r.points[k + 1];
      const ij = cell((a[0] + c[0]) / 2, (a[1] + c[1]) / 2);
      if (runIj && (ij[0] !== runIj[0] || ij[1] !== runIj[1])) flush();
      if (!runIj) { runIj = ij; run = [a]; }
      run.push(c);
    }
    flush();
  };
  for (const r of map.roads) {
    if (r.points.length < 2) continue;
    if (r.kind === 'footway') {
      const k = Math.floor((r.points.length - 1) / 2);
      const mid: Vec2 = [(r.points[k][0] + r.points[k + 1][0]) / 2, (r.points[k][1] + r.points[k + 1][1]) / 2];
      if (map.parks.some((p) => pointInPolygon(mid, p.polygon))) continue; // lo dibuja el parque
      addRibbonRuns(r, r.width, 0.02, 'sidewalk');
    } else if (r.kind === 'pedestrian') {
      addRibbonRuns(r, r.width, 0.02, 'sidewalk');
    } else {
      addRibbonRuns(r, r.width, 0.02, 'asphalt');
      if (r.sidewalk > 0) addRibbonRuns(r, r.width + 2 * r.sidewalk, 0.01, 'sidewalk');
    }
  }

  const groups: THREE.Group[] = [];
  for (const { ij, parts } of chunks.values()) {
    const group = new THREE.Group();
    group.name = `chunk ${ij[0]},${ij[1]}`;
    group.userData.chunk = ij;
    for (const [mat, geoms] of parts) {
      const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
      if (!merged) throw new Error(`mergeGeometries falló para ${mat} en chunk ${ij}`);
      if (merged !== geoms[0]) for (const g of geoms) g.dispose();
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
