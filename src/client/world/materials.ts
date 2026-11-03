import * as THREE from 'three';
import { QUALITY } from '../render/quality.ts';
import type { Quality } from '../render/quality.ts';
import { composeFacadeTile } from './facades.ts';
import type { FacadeStyle } from './facades.ts';
import type { WorldMaterials } from './types.ts';

export type { WorldMaterials } from './types.ts';

const SLOTS = ['revoque', 'ladrillo', 'asfalto', 'hormigon', 'pasto', 'sendero', 'techo', 'metal', 'madera'] as const;
type Slot = (typeof SLOTS)[number];
type MapKind = 'diff' | 'nor_gl' | 'rough';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
    img.src = url;
  });
}

function newCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Reduce una imagen a size × size para ahorrar memoria de GPU. */
function downscale(img: CanvasImageSource, size: number): HTMLCanvasElement {
  const [c, ctx] = newCanvas(size, size);
  ctx.drawImage(img, 0, 0, size, size);
  return c;
}

function makeTexture(source: HTMLCanvasElement, color: boolean, anisotropy: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(source);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}

/** Baldosa vainilla: 10 × 10 baldosas de 40 cm (= 4 m) con 3 × 3 puntos, sobre el hormigón. */
function composeSidewalk(base: CanvasImageSource, size: number): HTMLCanvasElement {
  const [c, ctx] = newCanvas(size, size);
  ctx.drawImage(base, 0, 0, size, size);
  ctx.fillStyle = 'rgba(224,208,166,0.8)';
  ctx.fillRect(0, 0, size, size);
  const n = 10;
  const t = size / n;
  const r = Math.max(1.2, t * 0.045);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          const x = i * t + (t * (2 * a + 1)) / 6;
          const y = j * t + (t * (2 * b + 1)) / 6;
          ctx.fillStyle = 'rgba(120,104,70,0.55)';
          ctx.beginPath(); ctx.arc(x + r * 0.35, y + r * 0.35, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(244,232,196,0.95)';
          ctx.beginPath(); ctx.arc(x, y, r * 0.85, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }
  ctx.strokeStyle = 'rgba(90,80,60,0.7)';
  ctx.lineWidth = Math.max(1, size / 512);
  for (let k = 0; k <= n; k++) {
    const p = Math.min(size - ctx.lineWidth / 2, Math.max(ctx.lineWidth / 2, k * t));
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  return c;
}

export async function createMaterials(q: Quality): Promise<WorldMaterials> {
  const { textureSize: size, anisotropy } = QUALITY[q];
  const lambert = q === 'baja';
  const maps: MapKind[] = lambert ? ['diff'] : ['diff', 'nor_gl', 'rough'];

  const base = `${import.meta.env.BASE_URL}textures/`;
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(
    SLOTS.flatMap((slot) => maps.map(async (m) => images.set(`${slot}_${m}`, await loadImage(`${base}${slot}_${m}.jpg`)))),
  );
  const img = (slot: Slot, m: MapKind): HTMLImageElement => images.get(`${slot}_${m}`)!;
  /** Una textura por slot y mapa, compartida entre materiales (cada copia de 1024² son ~5,6 MB de GPU). */
  const textures = new Map<string, THREE.CanvasTexture>();
  const tex = (slot: Slot, m: MapKind): THREE.CanvasTexture => {
    const key = `${slot}_${m}`;
    let t = textures.get(key);
    if (!t) {
      t = makeTexture(downscale(img(slot, m), size), m === 'diff', anisotropy);
      t.name = key;
      textures.set(key, t);
    }
    return t;
  };

  /** Material con los mapas del slot (o `map` propio). `normal: false` lo omite (fachadas). */
  function material(slot: Slot, params: THREE.MeshStandardMaterialParameters = {}, map?: THREE.Texture, normal = true): THREE.Material {
    const diffuse = map ?? tex(slot, 'diff');
    if (lambert) return new THREE.MeshLambertMaterial({ map: diffuse, ...params });
    return new THREE.MeshStandardMaterial({
      map: diffuse,
      normalMap: normal ? tex(slot, 'nor_gl') : null,
      roughnessMap: tex(slot, 'rough'),
      ...params,
    });
  }

  const facade = (slot: 'revoque' | 'ladrillo', style: FacadeStyle): THREE.Material => {
    const canvas = composeFacadeTile(img(slot, 'diff'), style, size, {
      target: slot === 'revoque' ? 0.8 : 0.55,
      metal: img('metal', 'diff'),
      wood: img('madera', 'diff'),
    });
    return material(slot, { vertexColors: true }, makeTexture(canvas, true, anisotropy), false);
  };

  const offset = (n: number) => ({ polygonOffset: true, polygonOffsetFactor: n, polygonOffsetUnits: n });
  const sidewalkMap = makeTexture(composeSidewalk(img('hormigon', 'diff'), size), true, anisotropy);

  return {
    wallGroundHouse: facade('revoque', 'house'),
    wallGroundShop: facade('revoque', 'shop'),
    wallUpper: facade('revoque', 'upper'),
    brickGround: facade('ladrillo', 'house'),
    brickUpper: facade('ladrillo', 'upper'),
    roof: material('techo', { vertexColors: false }),
    parapet: material('revoque', { vertexColors: true }),
    asphalt: material('asfalto', offset(-2)),
    sidewalk: material('hormigon', offset(-1), sidewalkMap),
    grass: material('pasto'),
    path: material('sendero', offset(-3)),
    platform: material('hormigon'),
    rail: material('metal'),
  };
}

/** Libera los materiales y sus texturas (compartidas o no), cada uno una sola vez. */
export function disposeMaterials(m: WorldMaterials): void {
  const materials = new Set<THREE.Material>(Object.values(m));
  const textures = new Set<THREE.Texture>();
  for (const mat of materials) {
    for (const v of Object.values(mat)) if (v instanceof THREE.Texture) textures.add(v);
  }
  for (const t of textures) t.dispose();
  for (const mat of materials) mat.dispose();
}
