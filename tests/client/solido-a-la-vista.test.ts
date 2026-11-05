// Lo sólido que no se ve (T11b, ítem 4). Los interiores se dibujan hasta 60 m (QUALITY.interiors.radius); más lejos, lo
// que no es `out` desaparece pero sigue frenando balas. En las partes patio (al aire libre) eso se ve: los molinetes de
// la estación, en la zona paga, eran el caso conocido.
//
// El criterio: desde puntos de afuera más allá de los 60 m (anillos de 65, 80 y 100 m alrededor de cada patio, cada
// 7,5°, con el ojo a 1,6 m del suelo o del andén), un rayo a una muestra de un bloque sólido de un patio (el medio y las
// esquinas de su tapa, el medio de cada costado) que no choca con nada de lo que se ve de lejos (los edificios llenos,
// sus pretiles, los andenes, los troncos y los props, y las paredes `out` de los interiores: lo de 1 m de alto o más y
// 1 m de largo o más) lo ve. Un bloque así tiene que ser `out` o tener un suplente que se dibuje de lejos: un bloque `out`
// del mismo interior, o la pieza de lejos de su mueble (ITEM_FAR, la dibuja exteriorGeometry con el chunk), con el medio
// de su planta adentro de la del sólido (±3 cm), su tapa a ≥ 90 % de su alto y a lo largo del lado más largo del sólido
// ≥ 50 % de ese lado (un caño de la baranda parado sobre el gabinete no lo suple).
import { readFileSync } from 'node:fs';
import { collisionPrisms, CollisionWorld } from '../../src/shared/collision.ts';
import type { Prism } from '../../src/shared/collision.ts';
import { pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../src/shared/geo.ts';
import { buildInteriors } from '../../src/shared/interiors/index.ts';
import type { Block, Interior } from '../../src/shared/interiors/types.ts';
import type { MapData } from '../../src/shared/mapdata.ts';
import { exteriorGeometry } from '../../src/client/world/interiors/exterior.ts';
import { ITEM_FAR, ITEM_MODELS } from '../../src/client/world/interiors/models.ts';
import * as THREE from 'three';
import { PLATFORM_H } from '../../src/shared/station.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const interiors = buildInteriors(map);

const mid = (ps: Vec2[]): Vec2 => [ps.reduce((t, p) => t + p[0], 0) / ps.length, ps.reduce((t, p) => t + p[1], 0) / ps.length];
const len = (a: Vec2, b: Vec2): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** Lo de un interior que se ve de lejos y tapa: un bloque `out` con costados, de 1 m de alto o más y 1 m de largo o más. */
const wallLike = (b: Block): boolean => !!b.out && !!b.side && b.y1 - b.y0 >= 1 && b.polygon.some((p, k) => len(p, b.polygon[(k + 1) % b.polygon.length]) >= 1);

/** Lo que tapa de lejos: el mapa con los edificios de los interiores llenos, y las paredes `out` de los interiores. */
const occluders = (() => {
  const { prisms } = collisionPrisms({ ...map, interiors: [] });
  const outs: Prism[] = interiors.flatMap((i) => i.blocks.filter(wallLike).map((b) => ({ polygon: b.polygon, minY: b.y0, maxY: b.y1 })));
  return new CollisionWorld([...prisms, ...outs], [], map.bounds);
})();
const inBuilding = (p: Vec2): boolean => map.buildings.some((b) => pointInPolygon(p, b.footprint));
const onPlatform = (p: Vec2): boolean => map.platforms.some((r) => pointInPolygon(p, r));

/** Las muestras de un bloque: el medio y las esquinas de su tapa (3 cm adentro, 1 cm arriba) y el medio de cada costado
 *  (a media altura, 1 cm afuera). */
function samples(b: Block): Vec3[] {
  const c = mid(b.polygon), out: Vec3[] = [[c[0], b.y1 + 0.01, c[1]]];
  for (const p of b.polygon) {
    const d = len(p, c) || 1;
    out.push([p[0] + ((c[0] - p[0]) * 0.03) / d, b.y1 + 0.01, p[1] + ((c[1] - p[1]) * 0.03) / d]);
  }
  b.polygon.forEach((p, k) => {
    const q = b.polygon[(k + 1) % b.polygon.length], m: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const d = len(m, c) || 1;
    out.push([m[0] + ((m[0] - c[0]) * 0.01) / d, (b.y0 + b.y1) / 2, m[1] + ((m[1] - c[1]) * 0.01) / d]);
  });
  return out;
}

/** Desde dónde se lo ve (el primer punto de los anillos con la línea libre), o null. */
function seenFrom(b: Block, center: Vec2): Vec3 | null {
  const pts = samples(b);
  for (const r of [65, 80, 100]) {
    for (let k = 0; k < 48; k++) {
      const a = (k * Math.PI) / 24;
      const g: Vec2 = [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)];
      if (inBuilding(g)) continue;
      const eye: Vec3 = [g[0], (onPlatform(g) ? PLATFORM_H : 0) + 1.6, g[1]];
      for (const s of pts) {
        const d: Vec3 = [s[0] - eye[0], s[1] - eye[1], s[2] - eye[2]];
        const dist = Math.hypot(...d);
        if (!occluders.raycast(eye, d, dist - 0.02)) return eye;
      }
    }
  }
  return null;
}

/** Un suplente: un prisma que se dibuja de lejos (planta y alto) con el medio de su planta adentro de la de `b` (±3 cm), la
 *  tapa a ≥ 90 % del alto de `b` y, a lo largo del lado más largo de `b`, ≥ 50 % de ese lado. */
interface Far { polygon: Vec2[]; y0: number; y1: number }
function suple(b: Block, o: Far): boolean {
  const near = (p: Vec2): boolean => pointInPolygon(p, b.polygon) || b.polygon.some((q, k) => {
    const r = b.polygon[(k + 1) % b.polygon.length], l = len(q, r) || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * (r[0] - q[0]) + (p[1] - q[1]) * (r[1] - q[1])) / (l * l)));
    return len(p, [q[0] + (r[0] - q[0]) * t, q[1] + (r[1] - q[1]) * t]) <= 0.03;
  });
  const k = b.polygon.reduce((best, p, j) => (len(p, b.polygon[(j + 1) % b.polygon.length]) > len(b.polygon[best], b.polygon[(best + 1) % b.polygon.length]) ? j : best), 0);
  const [p, q] = [b.polygon[k], b.polygon[(k + 1) % b.polygon.length]], l = len(p, q);
  const e: Vec2 = [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
  const along = o.polygon.map((v) => v[0] * e[0] + v[1] * e[1]);
  return near(mid(o.polygon)) && o.y1 >= b.y0 + 0.9 * (b.y1 - b.y0) && o.y0 >= b.y0 - 0.05 && Math.max(...along) - Math.min(...along) >= 0.5 * l;
}
/** Lo que se dibuja de lejos de un interior: sus bloques `out` y las piezas de lejos de los muebles de sus patios (sus
 *  cajas en el mundo, en planta y alto). */
function farOf(i: Interior): Far[] {
  const items = i.items.filter((it) => ITEM_FAR[it.model] && !pointInPolygon([it.at[0], it.at[2]], i.footprint));
  return [
    ...i.blocks.filter((b) => b.out),
    ...items.flatMap((it) => ITEM_FAR[it.model]!().map((g): Far => {
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(it.yaw).setPosition(...it.at));
      g.computeBoundingBox();
      const pos = g.getAttribute('position');
      const ps = Array.from({ length: pos.count }, (_, v): Vec2 => [pos.getX(v), pos.getZ(v)]);
      return { polygon: ps, y0: g.boundingBox!.min.y, y1: g.boundingBox!.max.y };
    })),
  ];
}

test('ningún bloque sólido de una parte patio que se ve desde afuera (más allá de los 60 m) queda sin out ni suplente out', () => {
  const rows: string[] = [];
  const missing: string[] = [];
  for (const i of interiors) {
    if (!i.patios.length) continue;
    const patioBlocks = i.blocks.filter((b) => b.collide === 'solid' && !b.out && !pointInPolygon(mid(b.polygon), i.footprint));
    let seen = 0, covered = 0;
    for (const b of patioBlocks) {
      const at = seenFrom(b, mid(i.patios.flat()));
      if (!at) continue;
      seen++;
      if (farOf(i).some((o) => suple(b, o))) { covered++; continue; }
      const c = mid(b.polygon);
      missing.push(`${i.placeId}: ${b.role} de ${b.y0.toFixed(2)} a ${b.y1.toFixed(2)} m en (${c.map((v) => v.toFixed(2))}), visto desde (${at.map((v) => v.toFixed(1))})`);
    }
    rows.push(`${i.placeId.padEnd(18)} ${String(patioBlocks.length).padStart(3)} sólidos en sus patios, ${seen} a la vista de lejos, ${covered} con suplente`);
  }
  console.log(rows.join('\n'));
  expect(missing).toEqual([]);
}, 120_000);

// Las piezas de lejos van con el chunk, siempre: de cerca, con el interior dibujado, quedan adentro de su modelo
test('las piezas de lejos de cada mueble (ITEM_FAR) quedan adentro de su modelo, a ≥ 5 mm de su cara, y son pocas', () => {
  const models = Object.keys(ITEM_FAR) as (keyof typeof ITEM_FAR)[];
  expect(models.sort()).toEqual(['mesa', 'mesa-alta', 'molinete']);
  const ray = new THREE.Raycaster();
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((d) => new THREE.Vector3(...d));
  for (const m of models) {
    const mesh = new THREE.Mesh(ITEM_MODELS[m](), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const far = ITEM_FAR[m]!();
    const tris = far.reduce((t, g) => t + (g.index ? g.index.count : g.getAttribute('position').count) / 3, 0);
    expect(tris, `${m}: los triángulos de lejos`).toBeLessThanOrEqual(60);
    for (const g of far) {
      const pos = g.getAttribute('position');
      for (let v = 0; v < pos.count; v++) {
        const p = new THREE.Vector3(pos.getX(v), pos.getY(v), pos.getZ(v));
        for (const d of dirs) {
          ray.set(p, d);
          const hit = ray.intersectObject(mesh)[0];
          expect(hit, `${m}: (${p.toArray().map((x) => x.toFixed(3))}) hacia ${d.toArray()}, la cara del modelo`).toBeDefined();
          expect(hit.distance, `${m}: (${p.toArray().map((x) => x.toFixed(3))}) hacia ${d.toArray()}`).toBeGreaterThanOrEqual(0.005);
        }
      }
    }
  }
});

test('exteriorGeometry suma las piezas de lejos de los muebles de los patios, no las de los de adentro', () => {
  const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  const farTris = (m: keyof typeof ITEM_FAR): number => ITEM_FAR[m]!().reduce((t, g) => t + tris(g), 0);
  for (const id of ['estacion-adrogue', 'guernica-bar', 'casa-de-la-cultura'] as const) {
    const i = interiors.find((x) => x.placeId === id)!;
    const extra = i.items.filter((it) => ITEM_FAR[it.model] && !pointInPolygon([it.at[0], it.at[2]], i.footprint))
      .reduce((t, it) => t + farTris(it.model as keyof typeof ITEM_FAR), 0);
    expect(tris(exteriorGeometry(i)) - tris(exteriorGeometry({ ...i, items: [] })), id).toBe(extra);
    expect(extra > 0, `${id}: con piezas de lejos`).toBe(id !== 'casa-de-la-cultura'); // la Casa no tiene patio
  }
  // en los patios: los dos molinetes, y la mesa y las tres mesas altas del Guernica
  const est = interiors.find((x) => x.placeId === 'estacion-adrogue')!;
  expect(est.items.filter((it) => it.model === 'molinete' && !pointInPolygon([it.at[0], it.at[2]], est.footprint))).toHaveLength(2);
});
