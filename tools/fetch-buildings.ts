import { createWriteStream, mkdirSync } from 'node:fs';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { AREA } from '../src/shared/geo.ts';
import { expandedBbox } from './bbox.ts';

const URL_MS =
  'https://minedbuildings.z5.web.core.windows.net/global-buildings/2026-02-03/global-buildings.geojsonl/RegionName=Argentina/quadkey=210321300/part-00102-4feead82-d499-422b-94cb-c036c212127a.c000.csv.gz';

const b = expandedBbox();
const inside = (lon: number, lat: number, r: typeof b) => lon >= r.west && lon <= r.east && lat >= r.south && lat <= r.north;
const round = (n: number) => Math.round(n * 1e7) / 1e7;

const res = await fetch(URL_MS, { headers: { 'User-Agent': 'adrogue-cs/0.1' } });
if (!res.ok || !res.body) throw new Error(`Microsoft respondió ${res.status}`);
const lines = createInterface({ input: Readable.fromWeb(res.body as never).pipe(createGunzip()), crlfDelay: Infinity });

const kept: string[] = [];
let total = 0, strict = 0;
for await (const line of lines) {
  if (!line.trim()) continue;
  total++;
  const f = JSON.parse(line) as { geometry: { type: string; coordinates: number[][][] } };
  const ring = f.geometry?.coordinates?.[0];
  if (f.geometry?.type !== 'Polygon' || !ring?.length) continue;
  const n = ring.length > 1 ? ring.length - 1 : 1; // el último vértice repite al primero
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += ring[i][0]; cy += ring[i][1]; }
  cx /= n; cy /= n;
  if (!inside(cx, cy, b)) continue;
  if (inside(cx, cy, AREA)) strict++;
  f.geometry.coordinates = f.geometry.coordinates.map((r) => r.map(([x, y]) => [round(x), round(y)]));
  kept.push(JSON.stringify(f));
}
mkdirSync('data/raw', { recursive: true });
const out = createWriteStream('data/raw/ms-buildings.geojson');
out.write('{"type":"FeatureCollection","features":[\n' + kept.join(',\n') + '\n]}\n');
out.end();
await new Promise((r) => out.on('finish', r));
console.log(`leídos ${total}; guardados ${kept.length}; en área estricta ${strict}; en anillo de margen ${kept.length - strict}`);
