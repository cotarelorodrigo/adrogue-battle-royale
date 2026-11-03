// Descarga las texturas CC0 de Poly Haven listadas en data/textures.json (1k JPG).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

interface Entry { slot: string; assetId: string; license: string; url: string }
const MAPS = ['diff', 'nor_gl', 'rough'] as const;
const MAX_TOTAL = 25 * 1024 * 1024;
const headers = { 'User-Agent': 'adrogue-cs-fetch-textures/0.1' };

async function download(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { headers });
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

// Si la URL directa da 404, se busca la URL exacta del JPG 1k en la API de archivos.
async function resolveUrl(id: string, map: string): Promise<string | null> {
  const res = await fetch(`https://api.polyhaven.com/files/${id}`, { headers });
  if (!res.ok) return null;
  const files = (await res.json()) as Record<string, Record<string, Record<string, { url?: string }>>>;
  return files[map === 'nor_gl' ? 'nor_gl' : map === 'rough' ? 'Rough' : 'Diffuse']?.['1k']?.jpg?.url ?? null;
}

const entries = JSON.parse(readFileSync('data/textures.json', 'utf8')) as Entry[];
mkdirSync('public/textures', { recursive: true });
let total = 0;
const missing: string[] = [];
for (const { slot, assetId } of entries) {
  for (const map of MAPS) {
    const file = `public/textures/${slot}_${map}.jpg`;
    if (!existsSync(file)) {
      const direct = `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${assetId}/${assetId}_${map}_1k.jpg`;
      let data = await download(direct);
      if (!data) {
        const url = await resolveUrl(assetId, map);
        data = url ? await download(url) : null;
      }
      if (data) writeFileSync(file, data);
      else { missing.push(file); continue; }
      console.log('descargado', file);
    }
    total += statSync(file).size;
  }
}
console.log(`${entries.length} slots, total ${(total / 1024 / 1024).toFixed(2)} MB`);
if (missing.length) console.error('Faltan:', missing.join(', '));
if (missing.length || total >= MAX_TOTAL) process.exit(1);
