// Lo de un interior que se ve siempre, con su edificio (`out`): los bloques y los paños van con el material `parapet`
// del chunk (revoque teñido por vértice, con sol: sin draw calls nuevos) y los carteles, como un Sign más del mapa. Los muebles
// de afuera se dibujan con el interior, de cerca; de los sólidos al aire libre (en los patios y arriba del techo: la
// terraza) va además su pieza de lejos (ITEM_FAR).
import * as THREE from 'three';
import { pointInPolygon, signedAreaFromAbove } from '../../../shared/geo.ts';
import type { Interior, Look } from '../../../shared/interiors/types.ts';
import type { Sign } from '../../../shared/mapdata.ts';
import { triangulateUp } from '../geometry.ts';
import type { RoofCut } from '../geometry.ts';
import { BAY_W, facing, FLOOR_H, newBuilder, quad, REVOQUE_MEDIA, tintColor, toGeometry, vert } from '../wall-kit.ts';
import { ITEM_FAR } from './models.ts';

/** uv del techo y de los pisos, como en geometry.ts: una unidad cada 4 m. */
const PLANAR_UV = 4;
/** Lo de metal y lo pintado (`luz`: la estructura del lucernario) va liso, sin el grano del revoque: todo su uv es un
 *  solo punto de la textura, MEAN_UV, y su color va dividido por REVOQUE_MEDIA (se ve el del Look). El metal, además,
 *  lleva el reflejo del piso al pie de sus costados (su color por SHEEN) y el del cielo arriba, como el acero
 *  inoxidable cepillado (el gabinete del molinete). */
const smooth = (l: Look): boolean => l.mat === 'metal' || l.mat === 'luz';
const SHEEN = 0.8;
/** Un punto de la foto del revoque que da su media: el medio del texel (96, 48) de 512, que en 1024 cae en la esquina de
 *  cuatro texels (el bilineal da su media, la misma caja de 2 × 2 px de la foto). Esa caja y la de 4 × 4 de alrededor
 *  dan la media ±0,5 % en los tres canales: lo mismo en baja (512) que en media y alta (1024). Antes era [0,5, 0,5], un
 *  texel cualquiera. */
export const MEAN_UV: [number, number] = [96.5 / 512, 1 - 48.5 / 512];
/** El color de lo liso: el del Look, compensado por la media del texel. */
const smoothColor = (hex: string): THREE.Color => {
  const c = tintColor(hex);
  return new THREE.Color(c.r / REVOQUE_MEDIA[0], c.g / REVOQUE_MEDIA[1], c.b / REVOQUE_MEDIA[2]);
};

/** Los bloques y los paños `out` del interior, y las piezas de lejos de sus muebles al aire libre (afuera de su planta, o
 *  arriba de `roof`, el alto del edificio: H2 de la revisión de la T11b), en una geometría para el merge `parapet` de su
 *  chunk. */
export function exteriorGeometry(i: Interior, roof: number): THREE.BufferGeometry {
  const b = newBuilder(true);
  for (const block of i.blocks) {
    if (!block.out) continue;
    const flipped = signedAreaFromAbove(block.polygon) < 0;
    const poly = flipped ? [...block.polygon].reverse() : block.polygon, n = poly.length;
    for (const [look, y, up] of [[block.top, block.y1, true], [block.bottom, block.y0, false]] as const) {
      if (!look) continue;
      const c = smooth(look) ? smoothColor(look.color) : tintColor(look.color);
      const base = b.pos.length / 3;
      for (const [x, z] of poly) vert(b, [x, y, z], [0, up ? 1 : -1, 0], smooth(look) ? MEAN_UV : [x / PLANAR_UV, z / PLANAR_UV], c);
      const idx: number[] = [];
      triangulateUp(poly, base, idx);
      if (!up) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
      b.idx.push(...idx);
    }
    if (!block.side) continue;
    const flat = smooth(block.side), c = flat ? smoothColor(block.side.color) : tintColor(block.side.color);
    const foot = block.side.mat === 'metal' ? c.clone().multiplyScalar(SHEEN) : c;
    const hidden = new Set(block.hide ?? []);
    for (let k = 0; k < n; k++) {
      if (hidden.has(flipped ? (2 * n - 2 - k) % n : k)) continue; // `hide` cuenta las aristas del polígono guardado
      const [p, q] = [poly[k], poly[(k + 1) % n]];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-6) continue;
      const [ex, ez] = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
      const u0 = (p[0] * ex + p[1] * ez) / BAY_W, u1 = u0 + len / BAY_W;
      const [v0, v1] = [block.y0 / FLOOR_H, block.y1 / FLOOR_H];
      const uvs: [number, number][] = flat ? [MEAN_UV, MEAN_UV, MEAN_UV, MEAN_UV] : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      const vs = ([[p[0], block.y0, p[1]], [q[0], block.y0, q[1]], [q[0], block.y1, q[1]], [p[0], block.y1, p[1]]] as [number, number, number][])
        .map((r, j) => vert(b, r, [-ez, 0, ex], uvs[j], j < 2 ? foot : c));
      b.idx.push(vs[0], vs[1], vs[2], vs[0], vs[2], vs[3]);
    }
  }
  // las piezas de lejos de los muebles sólidos al aire libre (ITEM_FAR): adentro de su modelo o pegadas a él, con su
  // color (por el del mueble) y uv en metros del mundo, como los paños
  for (const it of i.items) {
    const far = ITEM_FAR[it.model];
    if (!far || (pointInPolygon([it.at[0], it.at[2]], i.footprint) && it.at[1] < roof - 0.01)) continue;
    const place = new THREE.Matrix4().makeRotationY(it.yaw).setPosition(it.at[0], it.at[1], it.at[2]);
    const tint = new THREE.Color(it.color ?? '#ffffff');
    for (const g of far()) {
      g.applyMatrix4(place);
      const [pos, nor, col] = [g.getAttribute('position'), g.getAttribute('normal'), g.getAttribute('color')];
      const base = b.pos.length / 3;
      for (let v = 0; v < pos.count; v++) {
        const p: [number, number, number] = [pos.getX(v), pos.getY(v), pos.getZ(v)];
        vert(b, p, [nor.getX(v), nor.getY(v), nor.getZ(v)], [(p[0] + p[2]) / BAY_W, p[1] / FLOOR_H],
          new THREE.Color(col.getX(v), col.getY(v), col.getZ(v)).multiply(tint));
      }
      const idx = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, v) => v);
      for (const k of idx) b.idx.push(base + k);
      g.dispose();
    }
  }
  // los paños out (el pasamanos de una escalera out): de frente hacia su normal, con uv en metros del mundo
  for (const p of i.panes) {
    if (!p.out) continue;
    const cs = facing(p.corners, p.normal), c = tintColor(p.look.color);
    const uv = (q: [number, number, number]): [number, number] => [(q[0] + q[2]) / BAY_W, q[1] / FLOOR_H];
    if (cs.length === 4) quad(b, cs, cs.map(uv), p.normal, c);
    else {
      const k = cs.map((q) => vert(b, q, p.normal, uv(q), c));
      b.idx.push(k[0], k[1], k[2]);
    }
  }
  return toGeometry(b);
}

/** Los carteles `out` del interior, como Sign del mapa (los dibuja buildSigns con los demás), de su alto; los que
 *  brillan, con `glow`. */
export const exteriorSigns = (i: Interior): Sign[] => i.labels.filter((l) => l.out).map((l): Sign => ({
  text: l.text, anchor: [l.at[0], l.at[2]], normal: l.normal, width: l.width, bottomY: l.at[1] - l.height / 2, height: l.height, look: l.look,
  ...(l.glow ? { glow: true as const } : {}),
}));

/** Los lugares cuyo interior trae su propio cartel (un `out` con placeSign): el del lote (Place.sign) no se dibuja, así
 *  no queda uno encima del otro. Place.sign sigue en el mapa: de él sale la fachada del lugar (place-facades.ts). */
export const ownSignPlaces = (interiors: Interior[]): Set<string> =>
  new Set(interiors.filter((i) => i.labels.some((l) => l.out && l.placeSign)).map((i) => i.placeId));

/** Lo que el interior le abre al techo de su edificio (D13): sus huecos y los paños de vidrio del lucernario que los
 *  tapan desde arriba del techo (los Pane `sky` de vidrio), para extrudeBuilding; con terraza, el color de su baldosa
 *  (la cara de arriba de lo que apoya en el piso de la terraza, de GROUND_Y), que tiñe el techo de lejos. */
export function roofCut(i: Interior): RoofCut {
  const cut: RoofCut = {
    holes: i.roofHoles,
    skylight: i.panes.filter((p) => p.sky && p.look.mat === 'vidrio').map((p) => ({ corners: p.corners, normal: p.normal })),
  };
  const deck = i.terrace ? i.floors.find((f) => f.level === i.publicFloors) : undefined;
  const tile = deck && i.blocks.find((b) => b.top && !b.out && Math.abs(b.y0 - deck.y) < 1e-6 && b.y1 - b.y0 < 0.05);
  return tile ? { ...cut, terrace: tile.top!.color } : cut;
}
