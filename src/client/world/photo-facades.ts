// Fachadas con foto: cada foto de Commons se rectifica (homografía inversa, muestreo bilineal) y se pega como un cuadro
// propio sobre una arista del edificio del lugar, sin tocar el merge del chunk (un draw call por foto).
import * as THREE from 'three';
import type { Vec2 } from '../../shared/geo.ts';
import { applyHomography, computeHomography } from '../../shared/homography.ts';
import type { Quad } from '../../shared/homography.ts';
import type { Building, MapData, Place } from '../../shared/mapdata.ts';

export interface PhotoFacade {
  placeId: string;
  commonsFile: string;
  /** En píxeles de la foto, en orden SI, SD, ID, II. */
  corners: Quad;
  widthM: number;
  heightM: number;
  /** Arista del edificio donde va la foto, si no es la del cartel (entonces se centra en la posición del lugar). */
  edgeIndex?: number;
}

/** Separación de la pared: el cartel 3D está a 0,06 m, por delante. */
export const FACADE_OFFSET = 0.03;

export interface FacadeQuad {
  /** Centro del cuadro sobre el suelo, ya separado de la pared. */
  center: Vec2;
  width: number;
  height: number;
  /** Rotación sobre +Y para que el frente (+z) mire hacia afuera. */
  yaw: number;
  /** Tramo horizontal de la foto rectificada que se muestra (0–1). */
  u: [number, number];
  /** Tope vertical de la foto rectificada que se muestra (desde abajo, 0–1). */
  vMax: number;
}

/**
 * Ubica el cuadro en la arista del cartel (o en `edgeIndex`): centrado en el ancla (o en la posición del lugar) proyectada
 * sobre la arista, de ancho min(widthM, arista) y de alto min(heightM, edificio). Lo que no entra se recorta de la foto
 * (al centro a lo ancho, arriba a lo alto) para no deformarla.
 */
export function facadeQuad(building: Building, place: Place, f: Pick<PhotoFacade, 'widthM' | 'heightM' | 'edgeIndex'>): FacadeQuad {
  const fp = building.footprint;
  const edge = (i: number): [Vec2, Vec2] => [fp[i], fp[(i + 1) % fp.length]];
  const refPoint = f.edgeIndex === undefined ? place.sign?.anchor ?? place.position : place.position;
  let index = f.edgeIndex ?? 0;
  if (f.edgeIndex === undefined) {
    let best = Infinity;
    for (let i = 0; i < fp.length; i++) {
      const [a, b] = edge(i);
      const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      if (len2 === 0) continue;
      const t = Math.min(1, Math.max(0, ((refPoint[0] - a[0]) * (b[0] - a[0]) + (refPoint[1] - a[1]) * (b[1] - a[1])) / len2));
      const d = Math.hypot(a[0] + t * (b[0] - a[0]) - refPoint[0], a[1] + t * (b[1] - a[1]) - refPoint[1]);
      if (d < best) { best = d; index = i; }
    }
  }
  const [a, b] = edge(index);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len === 0) throw new Error(`Arista degenerada en el edificio ${building.id}`);
  const dir: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const normal: Vec2 = [-dir[1], dir[0]]; // hacia afuera en un polígono antihorario visto desde arriba
  const width = Math.min(f.widthM, len);
  const height = Math.min(f.heightM, building.height);
  const s = Math.min(len - width / 2, Math.max(width / 2, (refPoint[0] - a[0]) * dir[0] + (refPoint[1] - a[1]) * dir[1]));
  const k = (1 - width / f.widthM) / 2;
  return {
    center: [a[0] + dir[0] * s + normal[0] * FACADE_OFFSET, a[1] + dir[1] * s + normal[1] * FACADE_OFFSET],
    width,
    height,
    yaw: Math.atan2(normal[0], normal[1]),
    u: [k, 1 - k],
    vMax: height / f.heightM,
  };
}

/**
 * Lleva el cuadrilátero `corners` (SI, SD, ID, II) de la foto a un rectángulo outW × outH. Canvas 2D no tiene transformación
 * proyectiva: se recorre cada píxel de salida, se busca su origen con la homografía inversa y se muestrea en bilineal.
 */
export function rectify(img: HTMLImageElement, corners: Quad, outW: number, outH: number): HTMLCanvasElement {
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = sw;
  srcCanvas.height = sh;
  const sctx = srcCanvas.getContext('2d');
  if (!sctx) throw new Error('Sin contexto 2D');
  sctx.drawImage(img, 0, 0);
  const src = sctx.getImageData(0, 0, sw, sh).data;

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Sin contexto 2D');
  const dst = octx.createImageData(outW, outH);
  const h = computeHomography([[0, 0], [outW, 0], [outW, outH], [0, outH]], corners);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [px, py] = applyHomography(h, [x + 0.5, y + 0.5]);
      const fx = Math.min(sw - 1, Math.max(0, px - 0.5)), fy = Math.min(sh - 1, Math.max(0, py - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[(y0 * sw + x0) * 4 + c] * (1 - tx) + src[(y0 * sw + x1) * 4 + c] * tx;
        const bottom = src[(y1 * sw + x0) * 4 + c] * (1 - tx) + src[(y1 * sw + x1) * 4 + c] * tx;
        dst.data[o + c] = top * (1 - ty) + bottom * ty;
      }
      dst.data[o + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
    img.src = url;
  });
}

/**
 * Un cuadro por foto, con la foto rectificada a `size` px de ancho. Una foto que no carga deja la fachada lisa y avisa con
 * console.warn.
 */
export async function buildPhotoFacades(
  map: MapData, facades: PhotoFacade[], baseUrl: string, size: number, anisotropy: number,
): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'photoFacades';
  await Promise.all(facades.map(async (f) => {
    try {
      const place = map.places.find((p) => p.id === f.placeId);
      const building = map.buildings.find((b) => b.id === place?.buildingId);
      if (!place || !building) throw new Error(`Sin edificio para ${f.placeId}`);
      const img = await loadImage(`${baseUrl}photos/${f.placeId}.jpg`);
      const canvas = rectify(img, f.corners, size, Math.round((size * f.heightM) / f.widthM));
      const q = facadeQuad(building, place, f);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = anisotropy;
      const geometry = new THREE.PlaneGeometry(q.width, q.height);
      const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, q.u[0] + uv.getX(i) * (q.u[1] - q.u[0]), uv.getY(i) * q.vMax);
      // Sin luces: la foto ya trae su iluminación.
      const material = new THREE.MeshBasicMaterial({ map: texture, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `photoFacade-${f.placeId}`;
      mesh.position.set(q.center[0], q.height / 2, q.center[1]);
      mesh.rotation.y = q.yaw;
      group.add(mesh);
    } catch (e) {
      console.warn(`Sin foto de fachada para ${f.placeId}:`, e);
    }
  }));
  return group;
}
