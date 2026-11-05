// @vitest-environment jsdom
// La estación (§4.9) en el cliente: los muebles nuevos (el molinete, la terminal SUBE, el banco con respaldo y la
// ventanilla) y sus cajas, los colores que brillan calibrados con la ACES a la exposición de adentro (los tubos, la luz
// de las ventanas y la terminal), las ventanas con rejas de afuera tapando las pintadas del frente (el atlas) y lo que
// cuesta dibujarla en baja.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { QUALITY } from '../../src/client/render/quality.ts';
import { cellRect } from '../../src/client/world/front-atlas.ts';
import { extrudeBuilding, FLOOR_H } from '../../src/client/world/geometry.ts';
import { lightAt } from '../../src/client/world/interiors/bake.ts';
import { buildInterior3D, INTERIOR_EXPOSURE } from '../../src/client/world/interiors/build.ts';
import { exteriorGeometry } from '../../src/client/world/interiors/exterior.ts';
import { ITEM_GLOW, ITEM_MODELS, SUBE_COLORES } from '../../src/client/world/interiors/models.ts';
import type { InteriorKey, WorldMaterials } from '../../src/client/world/types.ts';
import { pointInPolygon, toLocal } from '../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../src/shared/geo.ts';
import { interiorOf } from '../../src/shared/interiors/index.ts';
import { MODEL_BOX, SOLID_MIN_H } from '../../src/shared/interiors/kit.ts';
import type { ItemModel } from '../../src/shared/interiors/types.ts';
import type { MapData } from '../../src/shared/mapdata.ts';
import { deltaE, seen } from './aces.ts';
import type { RGB } from './aces.ts';
import { stubCanvas } from './canvas-stub.ts';

beforeEach(() => stubCanvas());
afterEach(() => vi.restoreAllMocks());

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const ID = 'estacion-adrogue';
const i = interiorOf(map, ID);
const b = map.buildings.find((x) => x.id === i.buildingId)!;
const frame = map.interiors.find((x) => x.placeId === ID)!.frame;
const local = (p: Vec2): Vec2 => toLocal(frame, p);
const luma = ([r, g, bl]: RGB): number => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
const NUEVOS = ['molinete', 'sube', 'banco-respaldo', 'ventanilla'] as const satisfies readonly ItemModel[];

describe('los muebles de la estación', () => {
  test('cada modelo se arma (posición y color por vértice); la terminal SUBE brilla', () => {
    for (const m of NUEVOS) {
      const g = ITEM_MODELS[m]();
      expect(g.getAttribute('position').count, m).toBeGreaterThan(0);
      expect(g.getAttribute('color'), m).toBeDefined();
    }
    expect(ITEM_GLOW.sube).toBe(true);
  });

  test('las cajas sólidas: molinete, terminal SUBE y banco con respaldo (0,8 m), y el modelo entra en su caja', () => {
    expect(MODEL_BOX['banco-respaldo']!.h).toBeCloseTo(0.8, 6);
    for (const m of ['molinete', 'sube', 'banco-respaldo'] as const) {
      const box = MODEL_BOX[m]!;
      expect(box.h, m).toBeGreaterThanOrEqual(SOLID_MIN_H);
      const g = ITEM_MODELS[m]();
      g.computeBoundingBox();
      const s = g.boundingBox!.getSize(new THREE.Vector3());
      // lo que se ve es lo que frena: el modelo llena su caja (± 6 cm) y no sale de ella más de eso
      expect(Math.abs(s.x - box.w), `${m}: ancho ${s.x.toFixed(2)}`).toBeLessThanOrEqual(0.06);
      expect(Math.abs(s.z - box.d), `${m}: fondo ${s.z.toFixed(2)}`).toBeLessThanOrEqual(0.06);
      expect(Math.abs(s.y - box.h), `${m}: alto ${s.y.toFixed(2)}`).toBeLessThanOrEqual(0.06);
    }
  });
});

describe('lo que brilla, a la exposición de adentro (aces.ts)', () => {
  const pared = i.blocks.find((x) => x.role === 'pared' && x.side)!.side!.color;
  const tubos = [...new Set(i.blocks.filter((x) => x.y0 > 2.8 && pointInPolygon(x.polygon[0], b.footprint) && (x.bottom?.mat === 'luz' || x.side?.mat === 'luz'))
    .map((x) => (x.bottom?.mat === 'luz' ? x.bottom : x.side)!.color))];

  test('los tubos fluorescentes se ven blancos fríos', () => {
    expect(tubos.length).toBeGreaterThanOrEqual(1);
    for (const c of tubos) {
      const v = seen(c);
      expect(luma(v), `${c} se ve (${v.join(', ')})`).toBeGreaterThanOrEqual(225);
      expect(v[2], `${c}: frío`).toBeGreaterThanOrEqual(v[0]);
    }
  });

  test('las ventanas del frente, desde adentro, se leen como luz de día por un vidrio: más claras que la pared, más oscuras que los tubos, azuladas', () => {
    const colors = new Set(i.panes.filter((p) => p.look.mat === 'luz' && Math.abs(p.normal[1]) < 0.1 && p.corners.every((q) => pointInPolygon([q[0], q[2]], b.footprint))).map((p) => p.look.color));
    expect(colors.size).toBeGreaterThanOrEqual(1);
    const muro = seen(pared, 1 * INTERIOR_EXPOSURE);
    for (const c of colors) {
      const v = seen(c), say = `${c} se ve (${v.join(', ')})`;
      expect(luma(v), `${say}: más clara que la pared a luz plena (${muro.join(', ')})`).toBeGreaterThanOrEqual(luma(muro) + 20);
      for (const t of tubos) expect(luma(v), `${say}: más oscura que un tubo`).toBeLessThanOrEqual(luma(seen(t)) - 10);
      expect(v[2] - v[0], `${say}: azulada`).toBeGreaterThanOrEqual(10);
      expect(Math.max(...v) - Math.min(...v), `${say}: casi sin color`).toBeLessThanOrEqual(40);
    }
  });

  test('la terminal SUBE brilla sin hornear: su cuerpo se ve como su pintura a la luz del hall, y la pantalla, prendida', () => {
    const t = i.items.find((it) => it.model === 'sube')!;
    const n: Vec3 = [Math.sin(t.yaw), 0, Math.cos(t.yaw)];
    const L = lightAt(i, [t.at[0] + n[0] * 0.3, t.at[1] + 1.0, t.at[2] + n[2] * 0.3], n);
    const cuerpo = seen(SUBE_COLORES.cuerpo), pintura = seen(SUBE_COLORES.pintura, L * INTERIOR_EXPOSURE);
    expect(deltaE(cuerpo, pintura), `cuerpo (${cuerpo.join(', ')}) contra la pintura a luz ${L.toFixed(2)} (${pintura.join(', ')})`).toBeLessThanOrEqual(10);
    const franja = seen(SUBE_COLORES.franja), celeste = seen(SUBE_COLORES.franjaPintura, L * INTERIOR_EXPOSURE);
    expect(deltaE(franja, celeste), `franja (${franja.join(', ')}) contra (${celeste.join(', ')})`).toBeLessThanOrEqual(10);
    const p = seen(SUBE_COLORES.pantalla);
    expect(luma(p), `pantalla (${p.join(', ')})`).toBeGreaterThan(luma(cuerpo) + 30);
    expect(p[2]).toBeGreaterThan(p[0]);
  });
});

describe('afuera', () => {
  test('las ventanas con rejas (out) tapan las ventanas pintadas del frente: lo pintado queda detrás del zócalo o de la ventana', () => {
    const front = extrudeBuilding(b).walls.front;
    const pos = front.getAttribute('position'), uv = front.getAttribute('uv');
    const r = cellRect('ventana-pb');
    const bays: [number, number][] = [];
    for (let k = 0; k < pos.count; k += 4) {
      const vs = [0, 1, 2, 3].map((j) => k + j);
      if (!vs.every((j) => uv.getX(j) >= r.u0 - 1e-6 && uv.getX(j) <= r.u1 + 1e-6 && uv.getY(j) >= r.v0 - 1e-6 && uv.getY(j) <= r.v1 + 1e-6)) continue;
      if (Math.min(...vs.map((j) => pos.getY(j))) > 1e-6 || Math.max(...vs.map((j) => pos.getY(j))) < FLOOR_H - 1e-6) continue;
      const us = vs.map((j) => local([pos.getX(j), pos.getZ(j)])[0]);
      bays.push([Math.min(...us), Math.max(...us)]);
    }
    expect(bays.length, 'las bahías con ventana pintada').toBeGreaterThanOrEqual(1);
    const out = i.blocks.filter((x) => x.out && x.side).map((x) => {
      const l = x.polygon.map(local);
      return { u0: Math.min(...l.map((p) => p[0])), u1: Math.max(...l.map((p) => p[0])), v1: Math.max(...l.map((p) => p[1])), y0: x.y0, y1: x.y1 };
    }).filter((x) => x.v1 <= 0.01); // la cara de afuera del frente (el muro está apenas torcido: v 0,000–0,004)
    for (const [a, c] of bays) {
      const s = (c - a) / 3; // la celda mide 3 m y se estira con la bahía
      // lo pintado: el vidrio con su marco (x 0,66–2,34 de la celda, y 0,46–1,94) y el alféizar (x 0,6–2,4, y 0,4–0,5)
      for (let x = 0.6; x <= 2.4 + 1e-9; x += 0.05) {
        for (let y = 0.4; y <= 1.95 + 1e-9; y += 0.05) {
          const u = a + x * s;
          expect(out.some((o) => o.u0 <= u + 1e-6 && o.u1 >= u - 1e-6 && o.y0 <= y + 1e-6 && o.y1 >= y - 1e-6), `queda a la vista (u ${u.toFixed(2)}, y ${y.toFixed(2)})`).toBe(true);
        }
      }
    }
  });
});

describe('lo que cuesta', () => {
  const KEYS = ['in_liso', 'in_porcelanato', 'in_madera', 'in_machimbre', 'in_baldosa', 'in_ceramico', 'in_tela', 'in_metal',
    'in_ladrillo', 'in_vidrio', 'in_luz', 'in_mueble'] as const satisfies readonly InteriorKey[];
  const materials = Object.fromEntries(KEYS.map((k) => [k, new THREE.MeshBasicMaterial({ name: k })])) as unknown as Pick<WorldMaterials, InteriorKey>;
  const trianglesOf = (m: THREE.Mesh): number => {
    const per = (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3;
    return m instanceof THREE.InstancedMesh ? per * m.count : per;
  };

  test('en baja: el interior en su tope de mallas y, con lo de afuera (out), ≤ 8.000 triángulos', () => {
    let meshes = 0, tris = 0;
    buildInterior3D({ ...i }, materials, 'baja').group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        meshes++;
        tris += trianglesOf(o);
      }
    });
    const ext = exteriorGeometry(i);
    const out = (ext.index?.count ?? ext.getAttribute('position').count) / 3;
    expect(meshes).toBeLessThanOrEqual(QUALITY.baja.interiors.calls);
    expect(tris + out, `interior ${tris} + afuera ${out}`).toBeLessThanOrEqual(8000);
  });
});
