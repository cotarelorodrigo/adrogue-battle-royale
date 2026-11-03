// Descarga de Wikimedia Commons las fotos de fachadas listadas en data/photo-facades.json (1920 px de ancho como máximo)
// a public/photos/<placeId>.jpg y las suma a data/sources.json. Falla si alguna no es CC0, CC BY, CC BY-SA o dominio público.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

interface Entry { placeId: string; commonsFile: string }
interface Source { id: string; title: string; author: string; license: string; url: string }
interface ImageInfo { thumburl?: string; descriptionurl: string; extmetadata: Record<string, { value: string }> }

const API = 'https://commons.wikimedia.org/w/api.php';
const headers = { 'User-Agent': 'adrogue-cs-tools/0.1 (proyecto personal)' };
const WIDTH = 1920; // un escalón estándar de miniaturas de Commons, ≤ 2048
const MAX_TOTAL = 3 * 1024 * 1024;
const ACCEPTED = /^(CC0|CC BY(-SA)?\b|Public domain)/i;
const SOURCES = 'data/sources.json';

const plain = (html: string): string => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function imageInfo(file: string): Promise<ImageInfo> {
  const q = new URLSearchParams({
    action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: String(WIDTH), titles: `File:${file}`,
  });
  const res = await fetch(`${API}?${q}`, { headers });
  if (!res.ok) throw new Error(`Commons respondió ${res.status} para ${file}`);
  const json = (await res.json()) as { query: { pages: Record<string, { imageinfo?: ImageInfo[] }> } };
  const info = Object.values(json.query.pages)[0]?.imageinfo?.[0];
  if (!info) throw new Error(`No existe File:${file} en Commons`);
  return info;
}

const entries = JSON.parse(readFileSync('data/photo-facades.json', 'utf8')) as Entry[];
const sources = JSON.parse(readFileSync(SOURCES, 'utf8')) as Source[];
mkdirSync('public/photos', { recursive: true });
for (const { placeId, commonsFile } of entries) {
  const info = await imageInfo(commonsFile);
  const license = plain(info.extmetadata.LicenseShortName?.value ?? '');
  if (!ACCEPTED.test(license)) throw new Error(`Licencia no aceptada para ${commonsFile}: "${license}"`);
  const res = await fetch(info.thumburl ?? '', { headers });
  if (!res.ok) throw new Error(`No se pudo bajar ${commonsFile}: ${res.status}`);
  writeFileSync(`public/photos/${placeId}.jpg`, Buffer.from(await res.arrayBuffer()));
  const source: Source = {
    id: `photo-${placeId}`,
    title: `Foto de fachada (rectificada): ${commonsFile.replace(/\.jpg$/i, '')}, Wikimedia Commons`,
    author: plain(info.extmetadata.Artist?.value ?? 'Autor desconocido'),
    license,
    url: info.descriptionurl,
  };
  const i = sources.findIndex((s) => s.id === source.id);
  if (i >= 0) sources[i] = source; else sources.push(source);
  console.log('descargado', placeId, `(${license}, ${source.author})`);
  await pause(1000);
}
writeFileSync(SOURCES, `${JSON.stringify(sources, null, 2)}\n`);
const total = entries.reduce((n, e) => n + statSync(`public/photos/${e.placeId}.jpg`).size, 0);
console.log(`${entries.length} fotos, total ${(total / 1024 / 1024).toFixed(2)} MB`);
if (total >= MAX_TOTAL) process.exit(1);
