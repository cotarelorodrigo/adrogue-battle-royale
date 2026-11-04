// @vitest-environment jsdom
// Los 9 interiores del mapa real, armados para dibujar en cada calidad: a lo sumo 20 mallas (draw calls) cada uno
// (§2.6). Imprime los triángulos de cada uno, para seguir el costo a medida que las tareas suman planes y muebles.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildInterior3D, MAX_MESHES } from '../../src/client/world/interiors/build.ts';
import type { InteriorKey, WorldMaterials } from '../../src/client/world/types.ts';
import { buildInteriors } from '../../src/shared/interiors/index.ts';
import type { MapData } from '../../src/shared/mapdata.ts';
import { stubCanvas } from './canvas-stub.ts';

beforeEach(() => stubCanvas());
afterEach(() => vi.restoreAllMocks());

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const interiors = buildInteriors(map);
const KEYS = ['in_liso', 'in_porcelanato', 'in_madera', 'in_machimbre', 'in_baldosa', 'in_ceramico', 'in_tela', 'in_metal',
  'in_ladrillo', 'in_vidrio', 'in_luz', 'in_mueble'] as const satisfies readonly InteriorKey[];
const materials = Object.fromEntries(KEYS.map((k) => [k, new THREE.MeshBasicMaterial({ name: k })])) as unknown as Pick<WorldMaterials, InteriorKey>;

const trianglesOf = (m: THREE.Mesh): number => {
  const per = (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3;
  return m instanceof THREE.InstancedMesh ? per * m.count : per;
};

test('el mapa tiene los 9 interiores', () => {
  expect(interiors).toHaveLength(9);
});

for (const q of ['baja', 'media', 'alta'] as const) {
  test(`${q}: cada interior en ≤ ${MAX_MESHES} mallas`, () => {
    const rows: string[] = [];
    for (const i of interiors) {
      const meshes: THREE.Mesh[] = [];
      buildInterior3D(i, materials, q).group.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
      const tris = meshes.reduce((s, m) => s + trianglesOf(m), 0);
      rows.push(`${q.padEnd(5)} ${i.placeId.padEnd(20)} ${String(meshes.length).padStart(2)} mallas ${String(tris).padStart(7)} triángulos`);
      expect(meshes.length, `${q}/${i.placeId}`).toBeLessThanOrEqual(MAX_MESHES);
    }
    console.log(rows.join('\n'));
  });
}
