import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assembleMap } from '../src/mapgen/assemble.ts';
import { isFatalWarning } from '../src/mapgen/spawns.ts';
import { loadPlaces } from '../src/mapgen/places-input.ts';
import { loadFrentes } from '../src/mapgen/frentes-input.ts';
import { SIN_LOTE, loadPlantas } from '../src/mapgen/plantas-input.ts';

const OUT = 'public/map/adrogue.map.json';
const MAX_KB = 3 * 1024;

const frentes = loadFrentes();
const plantas = loadPlantas(frentes);
const { map, warnings, stats, pockets, report } = assembleMap({
  osm: JSON.parse(readFileSync('data/raw/osm.json', 'utf8')),
  buildings: JSON.parse(readFileSync('data/raw/ms-buildings.geojson', 'utf8')),
  places: loadPlaces(),
  photos: JSON.parse(readFileSync('data/photo-facades.json', 'utf8')),
  frentes,
  plantas,
});
const json = JSON.stringify(map);
mkdirSync('public/map', { recursive: true });
writeFileSync(OUT, json);

const count = (xs: { kind: string }[]): string => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x.kind, (m.get(x.kind) ?? 0) + 1);
  return [...m].map(([k, n]) => `${k}=${n}`).join(' ');
};
const kb = Math.round(Buffer.byteLength(json) / 1024);
const solid = map.buildings.filter((b) => !b.fill);
console.log(`edificios: ${solid.length} (${count(solid)}) + ${map.buildings.length - solid.length} rellenos de huecos`);
console.log(`outskirts: ${map.outskirts.length}`);
console.log(`calles: ${map.roads.length}, parques: ${map.parks.length}, lugares: ${map.places.length}`);
console.log(`props: ${map.props.length} (${count(map.props)})`);
console.log(`arboles: ${map.trees.length}, randomSpawns: ${map.randomSpawns.length}`);
console.log(`puntos de botín: ${map.lootSpots.length} (${count(map.lootSpots.map((s) => ({ kind: s.tier })))})`);
console.log(`ayudas de ascenso: clusters=${stats.clusters} dumpsters=${stats.dumpsters} ladders=${stats.ladders} tier0=${stats.tier0} tier1=${stats.tier1} fallback=${stats.fallback} sinAyuda=${stats.noAid} sinAyudaAfuera=${stats.noAidOutside}`);
console.log(`huecos de suelo: encontrados=${pockets.pockets} escaleras=${pockets.ladders} rellenos=${pockets.filled}`);
const facades = map.buildings.flatMap((b) => b.facades ?? []);
console.log(`fachadas de lugar: ${facades.length} (${count(facades.map((f) => ({ kind: f.ground })))})`);
const lots = map.buildings.filter((b) => b.front);
console.log(`frentes: ${frentes.frentes.length}, lotes: ${lots.length}, carteles de lotes: ${map.signs.length + map.places.filter((p) => lots.some((b) => b.id === p.buildingId)).length}`);
console.log(`plantas: ${plantas.length} (de ${SIN_LOTE.length})`);
for (const l of report) console.log(`  ${l}`);
console.log(`warnings: ${warnings.length}`);
for (const w of warnings) console.log(`  - ${w}`);
console.log(`${OUT}: ${kb} KB`);
if (kb >= MAX_KB) { console.error('El JSON supera 3 MB'); process.exit(1); }
// las relajaciones del punto de aparición son avisos esperados; el resto rompe el build
if (warnings.some(isFatalWarning)) process.exit(1);
