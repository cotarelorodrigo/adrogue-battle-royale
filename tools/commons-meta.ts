// Metadatos de Wikimedia Commons: licencias aceptadas y limpieza del HTML que devuelve la API.

/** Solo CC0, CC BY x.y, CC BY-SA x.y y dominio público (nada de NC, ND ni GFDL). */
export function isAcceptedLicense(shortName: string): boolean {
  return /^(CC0( 1\.0)?|CC BY(-SA)? \d+(\.\d+)?|Public domain)$/i.test(shortName.trim());
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>' };

/** Saca las etiquetas, decodifica las entidades comunes (con nombre y numéricas) y junta los espacios. */
export function plain(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, dec?: string, hex?: string, name?: string) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return ENTITIES[(name ?? '').toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
