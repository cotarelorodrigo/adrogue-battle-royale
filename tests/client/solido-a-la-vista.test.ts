// Lo sólido que no se ve (T11b, ítem 4; ronda 1: H1, H2 y H3 de la revisión). Un interior no se dibuja a 60 m o más de su
// caja (QUALITY.interiors.radius), ni más cerca si otro le gana el lugar (en baja se dibuja uno solo, el más cercano):
// entonces lo que no es `out` desaparece pero sigue frenando balas. Al aire libre eso se ve: en los patios (los molinetes
// de la estación, las mesas del Guernica) y arriba del techo (las mesas de la terraza de La Veneciana, el cordón del
// lucernario de la Casa).
//
// El criterio:
// - Los observadores: anillos a 3, 8, 15, 25, 40, 55, 65, 80 y 100 m del borde de la caja (en planta) de cada interior, un
//   punto cada ~4 m, parados donde caen: en el suelo, en un andén o en el techo del edificio vecino (el ojo a 1,6 m de
//   ahí). Cuentan los que no ven dibujado el interior: a ≥ 60 m de su caja, o con la de otro interior más cerca (así en
//   baja, con `max` 1; con `max` 2 o 3 y `calls` pasa en menos lugares: es el caso que manda).
// - Lo que se mira: los bloques sólidos al aire libre, con el medio afuera de la planta (patios) o arriba del techo (y0 ≥
//   el alto del edificio: terraza, techo). Los muebles sólidos entran por su bloque (`mueble`, la caja de MODEL_BOX).
// - Se ve si un rayo a una de sus muestras (el medio y las esquinas de su tapa, el medio de cada costado) no choca con
//   nada de lo que se dibuja ahí: los edificios llenos, sus pretiles, los andenes, los troncos y los props, y las paredes
//   `out` de los interiores (lo de 1 m de alto o más y 1 m de largo o más).
// - Lo que se ve tiene que tener suplente: lo que se dibuja de lejos del mismo interior (sus bloques `out` y las piezas de
//   lejos de sus muebles al aire libre, ITEM_FAR) con el medio de su planta adentro de la del bloque (±3 cm) y que no
//   arranque más de 5 cm por debajo; entre todo, hasta ≥ 90 % de su alto y cubriendo ≥ 80 % de su planta a lo largo de
//   cada uno de sus dos ejes (el de su lado más largo y el de través: el gabinete solo no suple al molinete entero).
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
import { MODEL_BOX } from '../../src/shared/interiors/kit.ts';
import { QUALITY } from '../../src/client/render/quality.ts';

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
/** El edificio donde cae `p` (en planta), o undefined. Con un prefiltro por caja: son ~1500. */
const boxes2 = map.buildings.map((b) => {
  const xs = b.footprint.map((q) => q[0]), zs = b.footprint.map((q) => q[1]);
  return { b, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
});
const buildingAt = (p: Vec2) => boxes2.find((e) => p[0] >= e.x0 && p[0] <= e.x1 && p[1] >= e.z0 && p[1] <= e.z1 && pointInPolygon(p, e.b.footprint))?.b;
const heightOf = (i: Interior): number => map.buildings.find((b) => b.id === i.buildingId)!.height;
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

/** Al aire libre: con el medio afuera de la planta (un patio) o arriba del techo (la terraza, el techo). */
const outdoors = (i: Interior, b: { polygon: Vec2[]; y0: number }): boolean => !pointInPolygon(mid(b.polygon), i.footprint) || b.y0 >= heightOf(i) - 0.01;
/** Los bloques sólidos al aire libre que no son `out`: los que desaparecen cuando el interior no se dibuja. */
const solidsOutdoors = (i: Interior): Block[] => i.blocks.filter((b) => b.collide === 'solid' && !b.out && outdoors(i, b));

/** La caja de lo que dibuja el interior (lo que no es `out`): de ella mide view.ts la distancia. */
const drawnBox = new Map(interiors.map((i) => {
  const box = new THREE.Box3();
  for (const b of i.blocks) {
    if (b.out) continue;
    for (const [x, z] of b.polygon) box.expandByPoint(new THREE.Vector3(x, b.y0, z)).expandByPoint(new THREE.Vector3(x, b.y1, z));
  }
  for (const it of i.items) box.expandByPoint(new THREE.Vector3(...it.at));
  return [i.placeId, box];
}));
const RADIUS = Math.min(...Object.values(QUALITY).map((q) => q.interiors.radius));
/** Por qué desde `eye` no se dibuja `i` (null: se dibuja). */
function undrawn(i: Interior, eye: Vec3): 'lejos' | 'otro más cerca' | null {
  const at = new THREE.Vector3(...eye), d = drawnBox.get(i.placeId)!.distanceToPoint(at);
  if (d >= RADIUS) return 'lejos';
  return interiors.some((o) => o !== i && drawnBox.get(o.placeId)!.distanceToPoint(at) < d) ? 'otro más cerca' : null;
}

const RINGS = [3, 8, 15, 25, 40, 55, 65, 80, 100];
/** Los observadores alrededor de `i` que no lo ven dibujado: en los anillos a RINGS m del borde de su caja en planta (un
 *  punto cada ~4 m), parados en el suelo, en un andén o en el techo de un edificio (no en el suyo ni en sus patios). */
function observers(i: Interior): { eye: Vec3; why: 'lejos' | 'otro más cerca' }[] {
  const box = drawnBox.get(i.placeId)!, [x0, x1, z0, z1] = [box.min.x, box.max.x, box.min.z, box.max.z];
  const out: { eye: Vec3; why: 'lejos' | 'otro más cerca' }[] = [];
  for (const d of RINGS) {
    // el rectángulo de la caja corrido d m, con las esquinas redondeadas: lados y cuartos de círculo
    const pts: Vec2[] = [];
    const side = (a: Vec2, b: Vec2): void => { const n = Math.max(1, Math.round(len(a, b) / 4)); for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); };
    const arc = (c: Vec2, a0: number): void => { const n = Math.max(1, Math.round((Math.PI / 2) * d / 4)); for (let k = 0; k < n; k++) { const a = a0 + ((Math.PI / 2) * k) / n; pts.push([c[0] + d * Math.cos(a), c[1] + d * Math.sin(a)]); } };
    side([x0, z0 - d], [x1, z0 - d]); arc([x1, z0], -Math.PI / 2);
    side([x1 + d, z0], [x1 + d, z1]); arc([x1, z1], 0);
    side([x1, z1 + d], [x0, z1 + d]); arc([x0, z1], Math.PI / 2);
    side([x0 - d, z1], [x0 - d, z0]); arc([x0, z0], Math.PI);
    for (const g of pts) {
      if (pointInPolygon(g, i.footprint) || i.patios.some((r) => pointInPolygon(g, r))) continue;
      const b = buildingAt(g);
      if (b?.id === i.buildingId) continue;
      const eye: Vec3 = [g[0], (b ? b.height : onPlatform(g) ? PLATFORM_H : 0) + 1.6, g[1]];
      const why = undrawn(i, eye);
      if (why) out.push({ eye, why });
    }
  }
  return out;
}

/** Desde dónde se ve `b` sin que `i` se dibuje: el primer observador de cada tipo con la línea libre a una muestra. */
function seenFrom(b: Block, obs: { eye: Vec3; why: 'lejos' | 'otro más cerca' }[]): Partial<Record<'lejos' | 'otro más cerca', Vec3>> {
  const pts = samples(b), got: Partial<Record<'lejos' | 'otro más cerca', Vec3>> = {};
  for (const { eye, why } of obs) {
    if (got[why]) continue;
    for (const s of pts) {
      const d: Vec3 = [s[0] - eye[0], s[1] - eye[1], s[2] - eye[2]];
      if (!occluders.raycast(eye, d, Math.hypot(...d) - 0.02)) { got[why] = eye; break; }
    }
    if (got.lejos && got['otro más cerca']) break;
  }
  return got;
}

/** Lo que se dibuja de lejos (planta y alto, en el mundo). */
interface Far { polygon: Vec2[]; y0: number; y1: number }
/** Una pieza de lejos del mueble `it`, puesta en el mundo. */
function toFar(g: THREE.BufferGeometry, it: Interior['items'][number]): Far {
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(it.yaw).setPosition(...it.at));
  g.computeBoundingBox();
  const pos = g.getAttribute('position');
  const ps = Array.from({ length: pos.count }, (_, v): Vec2 => [pos.getX(v), pos.getZ(v)]);
  return { polygon: ps, y0: g.boundingBox!.min.y, y1: g.boundingBox!.max.y };
}
/** Lo que se dibuja de lejos de un interior: sus bloques `out` y las piezas de lejos de sus muebles al aire libre. */
function farOf(i: Interior): Far[] {
  const items = i.items.filter((it) => ITEM_FAR[it.model] && outdoors(i, { polygon: [[it.at[0], it.at[2]]], y0: it.at[1] }));
  return [...i.blocks.filter((b) => b.out), ...items.flatMap((it) => ITEM_FAR[it.model]!().map((g) => toFar(g, it)))];
}
/** Cuánto (0 a 1) de la planta de `b` cubren `parts` a lo largo de cada uno de sus dos ejes (el de su lado más largo y el
 *  de través): el largo de la unión de lo que cada una tapa, sobre el largo de `b`. */
function coverage(b: Block, parts: Far[]): [number, number] {
  const k = b.polygon.reduce((best, p, j) => (len(p, b.polygon[(j + 1) % b.polygon.length]) > len(b.polygon[best], b.polygon[(best + 1) % b.polygon.length]) ? j : best), 0);
  const [p, q] = [b.polygon[k], b.polygon[(k + 1) % b.polygon.length]], l = len(p, q);
  const axes: Vec2[] = [[(q[0] - p[0]) / l, (q[1] - p[1]) / l], [-(q[1] - p[1]) / l, (q[0] - p[0]) / l]];
  return axes.map((e) => {
    const span = (ps: Vec2[]): [number, number] => { const t = ps.map((v) => v[0] * e[0] + v[1] * e[1]); return [Math.min(...t), Math.max(...t)]; };
    const [lo, hi] = span(b.polygon);
    const iv = parts.map((o) => span(o.polygon)).map(([a, c]): [number, number] => [Math.max(a, lo), Math.min(c, hi)]).filter(([a, c]) => c > a).sort((m, n) => m[0] - n[0]);
    let total = 0, end = -Infinity;
    for (const [a, c] of iv) { if (c > end) { total += c - Math.max(a, end); end = c; } }
    return total / (hi - lo);
  }) as [number, number];
}
/** Si `fars` suplen a `b`: las que tienen el medio de su planta adentro de la de `b` (±3 cm) y no arrancan más de 5 cm por
 *  debajo, juntas, llegan a ≥ 90 % de su alto y cubren ≥ 80 % de su planta a lo largo de cada eje. */
function suple(b: Block, fars: Far[]): { ok: boolean; why: string } {
  const near = (p: Vec2): boolean => pointInPolygon(p, b.polygon) || b.polygon.some((q, k) => {
    const r = b.polygon[(k + 1) % b.polygon.length], l = len(q, r) || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * (r[0] - q[0]) + (p[1] - q[1]) * (r[1] - q[1])) / (l * l)));
    return len(p, [q[0] + (r[0] - q[0]) * t, q[1] + (r[1] - q[1]) * t]) <= 0.03;
  });
  const parts = fars.filter((o) => near(mid(o.polygon)) && o.y0 >= b.y0 - 0.05);
  if (!parts.length) return { ok: false, why: 'sin nada que se dibuje de lejos' };
  const top = Math.max(...parts.map((o) => o.y1)), [ca, cb] = coverage(b, parts);
  const why = `alto ${(((top - b.y0) / (b.y1 - b.y0)) * 100).toFixed(0)} %, planta ${(ca * 100).toFixed(0)} % × ${(cb * 100).toFixed(0)} %`;
  return { ok: top >= b.y0 + 0.9 * (b.y1 - b.y0) && ca >= 0.8 && cb >= 0.8, why };
}

const fmt = (v: number[]): string => v.map((x) => x.toFixed(1)).join(',');

test('ningún bloque sólido al aire libre (patio, terraza o techo) que se ve sin que su interior se dibuje queda sin suplente', () => {
  const rows: string[] = [];
  const missing: string[] = [];
  for (const i of interiors) {
    const solids = solidsOutdoors(i);
    if (!solids.length) continue;
    const obs = observers(i), fars = farOf(i);
    let seen = 0, near = 0, covered = 0;
    for (const b of solids) {
      const at = seenFrom(b, obs), c = mid(b.polygon);
      const what = `${i.placeId}: ${b.role} de ${b.y0.toFixed(2)} a ${b.y1.toFixed(2)} m en (${fmt(c)})`;
      if (!at.lejos && !at['otro más cerca']) { rows.push(`   ${what}: no se ve`); continue; }
      seen++;
      if (at['otro más cerca']) near++;
      const s = suple(b, fars);
      const from = Object.entries(at).map(([why, e]) => `${why} desde (${fmt(e!)})`).join('; ');
      rows.push(`   ${what}: se ve (${from}); ${s.ok ? 'suplido' : 'SIN SUPLENTE'}: ${s.why}`);
      if (s.ok) covered++;
      else missing.push(`${what}, ${from}: ${s.why}`);
    }
    rows.push(`${i.placeId.padEnd(18)} ${String(solids.length).padStart(3)} sólidos al aire libre, ${seen} a la vista sin el interior (${near} con otro más cerca), ${covered} con suplente; ${obs.length} observadores`);
  }
  console.log(rows.join('\n'));
  expect(missing).toEqual([]);
}, 120_000);

// H3: las mesas de picnic del McDonald's no se ven desde ningún observador (las tapa el muro de 2,4 m del patio)
test('las mesas de picnic del patio del McDonald\'s no se ven sin el interior: las tapa el muro', () => {
  const i = interiors.find((x) => x.placeId === 'mcdonalds')!;
  const obs = observers(i);
  const picnic = i.items.filter((it) => it.model === 'mesa-picnic');
  expect(picnic).toHaveLength(3);
  const blocks = solidsOutdoors(i).filter((b) => b.role === 'mueble');
  expect(blocks).toHaveLength(3);
  expect(obs.some((o) => o.eye[1] > 3), 'hay observadores en techos').toBe(true);
  for (const b of blocks) expect(seenFrom(b, obs), `(${fmt(mid(b.polygon))})`).toEqual({});
}, 120_000);

// H1: la pieza de lejos del molinete cubre su caja sólida entera (el gabinete y el paso de los brazos)
test('la pieza de lejos del molinete suple su caja sólida entera: el gabinete solo no alcanza', () => {
  const est = interiors.find((x) => x.placeId === 'estacion-adrogue')!;
  const mols = est.items.filter((it) => it.model === 'molinete');
  expect(mols).toHaveLength(2);
  for (const it of mols) {
    const b = est.blocks.find((k) => k.role === 'mueble' && pointInPolygon([it.at[0], it.at[2]], k.polygon))!;
    // las piezas (en el marco del molinete: el gabinete en x > 0,16, el paso hacia −x) que pasan `keep`
    const pieces = (keep: (g: THREE.BufferGeometry) => boolean): Far[] => ITEM_FAR.molinete!()
      .filter((g) => { g.computeBoundingBox(); return keep(g); }).map((g) => toFar(g, it));
    const all = suple(b, pieces(() => true));
    expect(all.ok, all.why).toBe(true);
    expect(suple(b, pieces((g) => g.boundingBox!.min.x > 0.1)).ok, 'el gabinete solo').toBe(false);
  }
});

// Las piezas de lejos van con el chunk, siempre: no se salen de la caja sólida del mueble (no muestran de lejos algo que no
// frena balas) y de cerca, con el interior dibujado, casi no se ven: cada vértice queda adentro del modelo (a ≥ 5 mm de su
// cara) o pegado a él (a ≤ 2 cm: la barra del molinete envuelve el brazo de arriba, de 3,6 cm, en 4 cm)
test('las piezas de lejos de cada mueble no se salen de su caja sólida, quedan adentro de su modelo o pegadas a él, y son pocas', () => {
  const models = Object.keys(ITEM_FAR) as (keyof typeof ITEM_FAR)[];
  expect(models.sort()).toEqual(['mesa', 'mesa-alta', 'molinete']);
  const ray = new THREE.Raycaster();
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((d) => new THREE.Vector3(...d));
  for (const m of models) {
    const model = ITEM_MODELS[m]();
    const mesh = new THREE.Mesh(model, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const pos0 = model.getAttribute('position'), idx = model.index ? Array.from(model.index.array) : Array.from({ length: pos0.count }, (_, v) => v);
    const tri = new THREE.Triangle(), q = new THREE.Vector3();
    /** La distancia de `p` a la superficie del modelo. */
    const toSurface = (p: THREE.Vector3): number => {
      let best = Infinity;
      for (let k = 0; k < idx.length; k += 3) {
        tri.set(...([0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(pos0, idx[k + j])) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]));
        best = Math.min(best, tri.closestPointToPoint(p, q).distanceTo(p));
      }
      return best;
    };
    const box = MODEL_BOX[m]!;
    const far = ITEM_FAR[m]!();
    const tris = far.reduce((t, g) => t + (g.index ? g.index.count : g.getAttribute('position').count) / 3, 0);
    expect(tris, `${m}: los triángulos de lejos`).toBeLessThanOrEqual(60);
    for (const g of far) {
      const pos = g.getAttribute('position');
      for (let v = 0; v < pos.count; v++) {
        const p = new THREE.Vector3(pos.getX(v), pos.getY(v), pos.getZ(v));
        const at = `${m}: (${p.toArray().map((x) => x.toFixed(3))})`;
        expect(Math.abs(p.x) <= box.w / 2 + 0.001 && Math.abs(p.z) <= box.d / 2 + 0.001 && p.y >= -0.001 && p.y <= box.h + 0.001, `${at}, en la caja sólida`).toBe(true);
        const inside = dirs.every((d) => { ray.set(p, d); const hit = ray.intersectObject(mesh)[0]; return !!hit && hit.distance >= 0.005; });
        if (!inside) expect(toSurface(p), `${at}: afuera del modelo, a`).toBeLessThanOrEqual(0.02);
      }
    }
  }
});

test('exteriorGeometry suma las piezas de lejos de los muebles al aire libre (en los patios y arriba del techo), no las de los de adentro', () => {
  const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  const farTris = (m: keyof typeof ITEM_FAR): number => ITEM_FAR[m]!().reduce((t, g) => t + tris(g), 0);
  const count: Record<string, number> = {};
  for (const id of ['estacion-adrogue', 'guernica-bar', 'la-veneciana', 'casa-de-la-cultura'] as const) {
    const i = interiors.find((x) => x.placeId === id)!, roof = heightOf(i);
    const items = i.items.filter((it) => ITEM_FAR[it.model] && (!pointInPolygon([it.at[0], it.at[2]], i.footprint) || it.at[1] >= roof - 0.01));
    const extra = items.reduce((t, it) => t + farTris(it.model as keyof typeof ITEM_FAR), 0);
    expect(tris(exteriorGeometry(i, roof)) - tris(exteriorGeometry({ ...i, items: [] }, roof)), id).toBe(extra);
    count[id] = items.length;
  }
  // los dos molinetes; la mesa y las tres mesas altas del Guernica; las 5 mesas de la terraza de La Veneciana; la Casa, ninguno
  expect(count).toEqual({ 'estacion-adrogue': 2, 'guernica-bar': 4, 'la-veneciana': 5, 'casa-de-la-cultura': 0 });
});
