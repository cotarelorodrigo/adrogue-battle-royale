import { mkdirSync, writeFileSync } from 'node:fs';
import { expandedBbox } from './bbox.ts';

const b = expandedBbox();
const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${b.west.toFixed(6)},${b.south.toFixed(6)},${b.east.toFixed(6)},${b.north.toFixed(6)}`;
console.log('GET', url);
const res = await fetch(url, { headers: { 'User-Agent': 'adrogue-cs/0.1' } });
if (!res.ok) throw new Error(`OSM respondió ${res.status}`);
const text = await res.text();
const json = JSON.parse(text) as { elements: { type: string; tags?: Record<string, string> }[] };
mkdirSync('data/raw', { recursive: true });
writeFileSync('data/raw/osm.json', text);
const highways = json.elements.filter((e) => e.type === 'way' && e.tags?.highway).length;
console.log(`data/raw/osm.json: ${(text.length / 1024).toFixed(0)} KB, ${json.elements.length} elementos, ${highways} ways highway`);
