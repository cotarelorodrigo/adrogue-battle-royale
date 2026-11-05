// Lo de un interior que se ve siempre, con su edificio (`out`): los bloques y los paños van con el material `parapet`
// del chunk (revoque teñido por vértice, con sol: sin draw calls nuevos) y los carteles, como un Sign más del mapa. Los muebles
// de afuera no: se dibujan con el interior, de cerca.
import * as THREE from 'three';
import { signedAreaFromAbove } from '../../../shared/geo.ts';
import type { Interior } from '../../../shared/interiors/types.ts';
import type { Sign } from '../../../shared/mapdata.ts';
import { triangulateUp } from '../geometry.ts';
import type { RoofCut } from '../geometry.ts';
import { BAY_W, facing, FLOOR_H, newBuilder, quad, tintColor, toGeometry, vert } from '../wall-kit.ts';

/** uv del techo y de los pisos, como en geometry.ts: una unidad cada 4 m. */
const PLANAR_UV = 4;

/** Los bloques y los paños `out` del interior, en una geometría para el merge `parapet` de su chunk. */
export function exteriorGeometry(i: Interior): THREE.BufferGeometry {
  const b = newBuilder(true);
  for (const block of i.blocks) {
    if (!block.out) continue;
    const flipped = signedAreaFromAbove(block.polygon) < 0;
    const poly = flipped ? [...block.polygon].reverse() : block.polygon, n = poly.length;
    for (const [look, y, up] of [[block.top, block.y1, true], [block.bottom, block.y0, false]] as const) {
      if (!look) continue;
      const c = tintColor(look.color);
      const base = b.pos.length / 3;
      for (const [x, z] of poly) vert(b, [x, y, z], [0, up ? 1 : -1, 0], [x / PLANAR_UV, z / PLANAR_UV], c);
      const idx: number[] = [];
      triangulateUp(poly, base, idx);
      if (!up) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
      b.idx.push(...idx);
    }
    if (!block.side) continue;
    const c = tintColor(block.side.color);
    const hidden = new Set(block.hide ?? []);
    for (let k = 0; k < n; k++) {
      if (hidden.has(flipped ? (2 * n - 2 - k) % n : k)) continue; // `hide` cuenta las aristas del polígono guardado
      const [p, q] = [poly[k], poly[(k + 1) % n]];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-6) continue;
      const [ex, ez] = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
      const u0 = (p[0] * ex + p[1] * ez) / BAY_W, u1 = u0 + len / BAY_W;
      const [v0, v1] = [block.y0 / FLOOR_H, block.y1 / FLOOR_H];
      quad(b, [[p[0], block.y0, p[1]], [q[0], block.y0, q[1]], [q[0], block.y1, q[1]], [p[0], block.y1, p[1]]],
        [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], [-ez, 0, ex], c);
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
 *  tapan desde arriba del techo (los Pane `sky` de vidrio), para extrudeBuilding. */
export const roofCut = (i: Interior): RoofCut => ({
  holes: i.roofHoles,
  skylight: i.panes.filter((p) => p.sky && p.look.mat === 'vidrio').map((p) => ({ corners: p.corners, normal: p.normal })),
});
