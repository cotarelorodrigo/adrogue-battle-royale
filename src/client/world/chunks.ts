import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clipSegment, MARGIN_M, pointInPolygon } from '../../shared/geo.ts';
import type { Vec2 } from '../../shared/geo.ts';
import type { Interior } from '../../shared/interiors/types.ts';
import type { MapData, Park, Road } from '../../shared/mapdata.ts';
import { extrudeBuilding, GROUND_MAT, polygonGeometry, ribbon, wallMaterials } from './geometry.ts';
import { exteriorGeometry } from './interiors/exterior.ts';
import type { WorldMaterials } from './types.ts';

export const CHUNK = 250;
const GRASS_UV = 4;
const PLANAR_UV = 4;
// Capas del suelo (separadas para evitar z-fighting): césped 0 < vereda < asfalto < sendas/peatonales
const Y_SIDEWALK = 0.02;
const Y_ASPHALT = 0.04;
export const Y_PATH = 0.06;

/** ¿Es un sendero `footway` de plaza? Mira el punto medio del tramo del medio. Esos los dibuja buildParks (sendero);
 *  el resto, chunks (vereda): así cada footway se dibuja una sola vez. */
export function isParkFootway(r: Road, parks: Park[]): boolean {
  if (r.kind !== 'footway' || r.points.length < 2) return false;
  const k = Math.floor((r.points.length - 1) / 2);
  const mid: Vec2 = [(r.points[k][0] + r.points[k + 1][0]) / 2, (r.points[k][1] + r.points[k + 1][1]) / 2];
  return parks.some((p) => pointInPolygon(mid, p.polygon));
}

/** Un edificio se asigna a un chunk como si su centroide estuviera al menos a esto del borde del área (m). */
const EDGE_INSET = 10;
const SHADOW_CASTERS = new Set<keyof WorldMaterials>(['wallGroundHouse', 'wallGroundShop', 'wallUpper', 'brickGround', 'brickUpper', 'roof', 'parapet', 'front']);

const cell = (x: number, z: number): [number, number] => [Math.floor(x / CHUNK), Math.floor(z / CHUNK)];

/**
 * Las mallas del mundo, juntas por chunk y material. Un edificio con interior (de `interiors`) tiene huecos en sus
 * aberturas y suma a `parapet` lo suyo de afuera (exterior.ts); los pedazos recortados quedan como tapas (D6): una
 * malla por interior y material en el grupo de su chunk, nombrada con la clave del material, que las vistas de los
 * interiores muestran mientras el interior no se dibuja.
 */
export function buildChunks(map: MapData, materials: WorldMaterials, interiors: Interior[] = []): { groups: THREE.Group[]; tapas: Map<string, THREE.Mesh[]> } {
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

  // Edificios por centroide, llevado a ≥ EDGE_INSET adentro del área: los del borde (y los que lo cruzan con el centroide
  // afuera) se suman a los merges de un chunk de adentro en vez de abrir uno casi vacío del lado de afuera.
  const inside = (v: number, lo: number, hi: number): number =>
    lo + EDGE_INSET > hi - EDGE_INSET ? (lo + hi) / 2 : Math.min(hi - EDGE_INSET, Math.max(lo + EDGE_INSET, v));
  const withInterior = new Map(interiors.map((i) => [i.buildingId, i]));
  const openingsOf = new Map(map.interiors.map((x) => [x.buildingId, x.openings]));
  const tapaParts: { ij: [number, number]; placeId: string; mat: keyof WorldMaterials; geometry: THREE.BufferGeometry }[] = [];
  for (const b of map.buildings) {
    let cx = 0, cz = 0;
    for (const [x, z] of b.footprint) { cx += x; cz += z; }
    const ij = cell(inside(cx / b.footprint.length, bd.minX, bd.maxX), inside(cz / b.footprint.length, bd.minZ, bd.maxZ));
    const interior = withInterior.get(b.id);
    const e = extrudeBuilding(b, interior ? openingsOf.get(b.id) ?? [] : []);
    const mats = wallMaterials(b);
    add(ij, mats.ground, e.walls.ground);
    add(ij, 'front', e.walls.front);
    // aristas con fachada de lugar (spec 4.3): al merge del material de su planta baja, en el mismo chunk
    for (const o of e.walls.overrides) add(ij, GROUND_MAT[o.ground], o.geometry);
    add(ij, mats.upper, e.walls.upper);
    add(ij, 'roof', e.roof);
    add(ij, 'parapet', e.parapet);
    if (!interior) continue;
    add(ij, 'parapet', exteriorGeometry(interior));
    for (const [mat, geometry] of Object.entries(e.tapas) as [keyof WorldMaterials, THREE.BufferGeometry][]) {
      tapaParts.push({ ij, placeId: interior.placeId, mat, geometry });
    }
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
      if (isParkFootway(r, map.parks)) continue; // lo dibuja buildParks
      addRibbonRuns(r, r.width, Y_PATH, 'sidewalk');
    } else if (r.kind === 'pedestrian') {
      addRibbonRuns(r, r.width, Y_PATH, 'sidewalk');
    } else {
      addRibbonRuns(r, r.width, Y_ASPHALT, r.surface === 'sett' ? 'cobble' : 'asphalt');
      if (r.sidewalk > 0) addRibbonRuns(r, r.width + 2 * r.sidewalk, Y_SIDEWALK, 'sidewalk');
    }
  }

  const groups: THREE.Group[] = [];
  const byChunk = new Map<string, THREE.Group>();
  for (const { ij, parts } of chunks.values()) {
    const group = new THREE.Group();
    group.name = `chunk ${ij[0]},${ij[1]}`;
    group.userData.chunk = ij;
    byChunk.set(`${ij[0]},${ij[1]}`, group);
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
  // las tapas no dan sombra: así no suman draw calls a la pasada de sombras (el hueco no se ve desde el sol)
  const tapas = new Map<string, THREE.Mesh[]>();
  for (const { ij, placeId, mat, geometry } of tapaParts) {
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[mat]);
    mesh.name = mat;
    mesh.receiveShadow = true;
    byChunk.get(`${ij[0]},${ij[1]}`)!.add(mesh);
    tapas.set(placeId, [...(tapas.get(placeId) ?? []), mesh]);
  }
  return { groups, tapas };
}
