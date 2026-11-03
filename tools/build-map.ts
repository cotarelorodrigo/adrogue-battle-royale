import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assembleMap } from '../src/mapgen/assemble.ts';
import { loadPlaces } from '../src/mapgen/places-input.ts';

const OUT = 'public/map/adrogue.map.json';
const MAX_KB = 3 * 1024;

const { map, warnings, stats } = assembleMap({
  osm: JSON.parse(readFileSync('data/raw/osm.json', 'utf8')),
  buildings: JSON.parse(readFileSync('data/raw/ms-buildings.geojson', 'utf8')),
  places: loadPlaces(),
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
console.log(`edificios: ${map.buildings.length} (${count(map.buildings)})`);
console.log(`outskirts: ${map.outskirts.length}`);
console.log(`calles: ${map.roads.length}, parques: ${map.parks.length}, lugares: ${map.places.length}`);
console.log(`props: ${map.props.length} (${count(map.props)})`);
console.log(`arboles: ${map.trees.length}, randomSpawns: ${map.randomSpawns.length}`);
console.log(`ayudas de ascenso: clusters=${stats.clusters} dumpsters=${stats.dumpsters} ladders=${stats.ladders} tier0=${stats.tier0} tier1=${stats.tier1} fallback=${stats.fallback}`);
console.log(`warnings: ${warnings.length}`);
for (const w of warnings) console.log(`  - ${w}`);
console.log(`${OUT}: ${kb} KB`);
if (kb >= MAX_KB) { console.error('El JSON supera 3 MB'); process.exit(1); }
if (warnings.length > 0) process.exit(1);
