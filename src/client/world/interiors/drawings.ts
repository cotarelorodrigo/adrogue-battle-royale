// Los carteles que llevan un dibujo en vez de su texto (Label.drawing), dibujados en canvas al armar el interior: no se
// baja ninguna imagen (§2.4). Como los carteles de texto, son claros y se hornean con la luz del lugar. Los que varían
// (el plafón, los cuadros) salen de un PRNG con el texto del cartel de semilla: el mismo cartel, el mismo dibujo.
import { hash01 } from '../../../shared/geo.ts';
import type { LabelDrawing } from '../../../shared/interiors/types.ts';
import type { SignLook } from '../../../shared/mapdata.ts';
import { createRng } from '../../../shared/rng.ts';
import type { Rng } from '../../../shared/rng.ts';
import { PX_PER_M } from '../signs.ts';

type Ctx = CanvasRenderingContext2D;

/** Un canvas de width × height m a PX_PER_M (al menos 64 px de lado) y su contexto. */
function sheet(width: number, height: number): { canvas: HTMLCanvasElement; c: Ctx; w: number; h: number } {
  const w = Math.max(64, Math.round(width * PX_PER_M)), h = Math.max(64, Math.round(height * PX_PER_M));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, c: canvas.getContext('2d')!, w, h };
}

/** El PRNG de un dibujo: su semilla es el texto del cartel. */
const rngOf = (seed: string): Rng => createRng(Math.floor(hash01(seed) * 4294967296));
/** Un elemento de `list` al azar. */
const any = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng.next() * list.length) % list.length];
/** Los colores de `list` en un orden al azar (Fisher-Yates). */
function shuffled<T>(rng: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let k = out.length - 1; k > 0; k--) {
    const j = Math.floor(rng.next() * (k + 1)) % (k + 1);
    [out[k], out[j]] = [out[j], out[k]];
  }
  return out;
}

const circle = (c: Ctx, x: number, y: number, r: number): void => {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
};

/** Un anillo de radio r con un degradado de borde: claro arriba a la izquierda, oscuro abajo a la derecha (relieve). */
function bevel(c: Ctx, x: number, y: number, r: number, w: number, light: string, dark: string): void {
  const g = c.createLinearGradient(x - r, y - r, x + r, y + r);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  c.strokeStyle = g;
  c.lineWidth = w;
  circle(c, x, y, r);
  c.stroke();
}

/**
 * La puerta redonda del tesoro (§4.1), de frente: la chapa del marco (`look.marco`), la puerta de acero con su borde en
 * relieve, la corona de bulones, el volante de cinco rayos con su cubo y las dos bisagras del lado izquierdo. Ocupa el
 * cuadrado del cartel; el acero sale de `look.fondo` y los bulones y el volante, de `look.letra`.
 */
function tesoro(look: SignLook, width: number, height: number): HTMLCanvasElement {
  const { canvas, c, w, h } = sheet(width, height);
  const [x, y, r] = [w / 2, h / 2, Math.min(w, h) * 0.46];
  // la chapa del marco, con un borde más oscuro
  c.fillStyle = look.marco;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.lineWidth = Math.max(2, r * 0.03);
  c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, w - c.lineWidth, h - c.lineWidth);
  // el aro del marco y la puerta
  c.fillStyle = 'rgba(0,0,0,0.45)';
  circle(c, x, y, r);
  c.fill();
  const steel = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  steel.addColorStop(0, '#ffffff');
  steel.addColorStop(1, look.fondo);
  c.fillStyle = look.fondo;
  circle(c, x, y, r * 0.9);
  c.fill();
  c.globalAlpha = 0.35;
  c.fillStyle = steel;
  circle(c, x, y, r * 0.9);
  c.fill();
  c.globalAlpha = 1;
  bevel(c, x, y, r * 0.9, r * 0.05, 'rgba(255,255,255,0.7)', 'rgba(0,0,0,0.6)');
  bevel(c, x, y, r * 0.62, r * 0.03, 'rgba(0,0,0,0.5)', 'rgba(255,255,255,0.6)');
  // los bulones, en corona entre el borde y el anillo de adentro
  c.fillStyle = look.letra;
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI * 2) / 16;
    circle(c, x + Math.cos(a) * r * 0.76, y + Math.sin(a) * r * 0.76, r * 0.035);
    c.fill();
  }
  // el volante: aro, cinco rayos y el cubo
  c.strokeStyle = look.letra;
  c.lineCap = 'round';
  c.lineWidth = r * 0.05;
  circle(c, x, y, r * 0.3);
  c.stroke();
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * r * 0.36, y + Math.sin(a) * r * 0.36);
    c.stroke();
  }
  c.fillStyle = look.letra;
  circle(c, x, y, r * 0.08);
  c.fill();
  // las bisagras, del lado izquierdo, sobre el aro
  c.fillStyle = 'rgba(0,0,0,0.55)';
  for (const dy of [-0.45, 0.45]) c.fillRect(x - r * 1.0, y + dy * r - r * 0.08, r * 0.2, r * 0.16);
  return canvas;
}

/** Los colores del plafón: vivos y cálidos, con dos fríos de contrapunto. */
const PLAFON_COLORS = ['#d8432e', '#f08a24', '#f5c431', '#e2557f', '#8e3f9e', '#2f7fc1', '#2fa59a', '#7cb342', '#c0392b', '#f3e2b8'] as const;

/**
 * La cara pintada del plafón que cuelga bajo el lucernario (§4.4): un disco propio, abstracto, que no copia la obra. Sobre
 * el fondo (`look.fondo`), anillos concéntricos partidos en gajos de colores (cada anillo con su cantidad de gajos y
 * su giro), unos arcos y unas manchas traslúcidas que cruzan los anillos, rayos finos y un medallón en el medio con un
 * degradado; el borde, un aro oscuro (`look.letra`). Se ve desde abajo: ocupa el círculo inscripto del cartel.
 */
function plafon(look: SignLook, width: number, height: number, seed: string): HTMLCanvasElement {
  const { canvas, c, w, h } = sheet(width, height);
  const rng = rngOf(seed);
  const [x, y, R] = [w / 2, h / 2, Math.min(w, h) / 2];
  c.fillStyle = look.fondo;
  c.fillRect(0, 0, w, h);
  const colors = shuffled(rng, PLAFON_COLORS);
  // los anillos, de afuera hacia adentro: cada uno con sus gajos, de colores que se alternan
  const rings = 5 + Math.floor(rng.next() * 3);
  for (let k = 0; k < rings; k++) {
    const r0 = R * (0.94 - (k * 0.72) / rings), r1 = R * (0.94 - ((k + 1) * 0.72) / rings);
    const n = 8 + 4 * Math.floor(rng.next() * 5), turn = rng.next() * Math.PI * 2;
    for (let j = 0; j < n; j++) {
      const [a0, a1] = [turn + (j * Math.PI * 2) / n, turn + ((j + 1) * Math.PI * 2) / n];
      c.fillStyle = colors[(j + k * 3) % colors.length];
      c.beginPath();
      c.arc(x, y, r0, a0, a1);
      c.arc(x, y, r1, a1, a0, true);
      c.closePath();
      c.fill();
    }
  }
  // arcos anchos y manchas traslúcidas que cruzan los anillos (lo que lo hace de una mano y no de un compás)
  c.globalAlpha = 0.45;
  for (let k = 0; k < 7; k++) {
    const a = rng.next() * Math.PI * 2, d = R * (0.2 + rng.next() * 0.6);
    c.fillStyle = any(rng, colors);
    circle(c, x + Math.cos(a) * d, y + Math.sin(a) * d, R * (0.08 + rng.next() * 0.16));
    c.fill();
  }
  c.lineCap = 'round';
  for (let k = 0; k < 5; k++) {
    const a = rng.next() * Math.PI * 2;
    c.strokeStyle = any(rng, colors);
    c.lineWidth = R * (0.03 + rng.next() * 0.05);
    c.beginPath();
    c.arc(x, y, R * (0.3 + rng.next() * 0.55), a, a + 0.6 + rng.next() * 1.8);
    c.stroke();
  }
  c.globalAlpha = 1;
  // rayos finos, del medallón al borde
  c.strokeStyle = 'rgba(30,24,20,0.35)';
  c.lineWidth = Math.max(1, R * 0.006);
  const rays = 24 + 12 * Math.floor(rng.next() * 3);
  for (let k = 0; k < rays; k++) {
    const a = (k * Math.PI * 2) / rays;
    c.beginPath();
    c.moveTo(x + Math.cos(a) * R * 0.22, y + Math.sin(a) * R * 0.22);
    c.lineTo(x + Math.cos(a) * R * 0.94, y + Math.sin(a) * R * 0.94);
    c.stroke();
  }
  // el medallón y el aro del borde
  const g = c.createRadialGradient(x, y, R * 0.02, x, y, R * 0.22);
  g.addColorStop(0, '#fff6dc');
  g.addColorStop(1, colors[0]);
  c.fillStyle = g;
  circle(c, x, y, R * 0.22);
  c.fill();
  c.strokeStyle = look.letra;
  c.lineWidth = R * 0.05;
  circle(c, x, y, R * 0.97);
  c.stroke();
  return canvas;
}

/** Las paletas de los cuadros de las muestras: cada cuadro toma una. */
const PALETTES = [
  ['#1d3557', '#457b9d', '#a8dadc', '#f1faee', '#e63946'],
  ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'],
  ['#3d2c2e', '#8c5e58', '#d9a679', '#f2e3c6', '#5b7553'],
  ['#0b132b', '#3a506b', '#5bc0be', '#f6ae2d', '#f26419'],
  ['#2b2d42', '#8d99ae', '#edf2f4', '#ef233c', '#d90429'],
  ['#3c1642', '#086375', '#1dd3b0', '#affc41', '#b2ff9e'],
] as const;

/**
 * Un cuadro abstracto de una muestra (§4.4: salas con paneles), propio: el fondo de un color de su paleta, campos de
 * color superpuestos, unos círculos, trazos gruesos y una línea fina; el marco (`look.marco`) alrededor.
 */
function cuadro(look: SignLook, width: number, height: number, seed: string): HTMLCanvasElement {
  const { canvas, c, w, h } = sheet(width, height);
  const rng = rngOf(seed);
  const pal = shuffled(rng, any(rng, PALETTES));
  const m = Math.max(4, Math.round(Math.min(w, h) * 0.06));
  c.fillStyle = look.marco;
  c.fillRect(0, 0, w, h);
  c.fillStyle = pal[0];
  c.fillRect(m, m, w - 2 * m, h - 2 * m);
  const [iw, ih] = [w - 2 * m, h - 2 * m];
  const px = (f: number): number => m + f * iw, py = (f: number): number => m + f * ih;
  // campos de color
  for (let k = 0; k < 3 + Math.floor(rng.next() * 3); k++) {
    c.globalAlpha = 0.65 + rng.next() * 0.35;
    c.fillStyle = pal[1 + (k % (pal.length - 1))];
    const [a, b] = [rng.next() * 0.7, rng.next() * 0.7];
    c.fillRect(px(a), py(b), iw * (0.15 + rng.next() * 0.5), ih * (0.1 + rng.next() * 0.45));
  }
  // círculos
  for (let k = 0; k < 1 + Math.floor(rng.next() * 3); k++) {
    c.globalAlpha = 0.8;
    c.fillStyle = any(rng, pal);
    circle(c, px(0.15 + rng.next() * 0.7), py(0.15 + rng.next() * 0.7), Math.min(iw, ih) * (0.06 + rng.next() * 0.18));
    c.fill();
  }
  // trazos gruesos y una línea fina
  c.globalAlpha = 1;
  c.lineCap = 'round';
  for (let k = 0; k < 2 + Math.floor(rng.next() * 2); k++) {
    c.strokeStyle = any(rng, pal);
    c.lineWidth = Math.min(iw, ih) * (0.02 + rng.next() * 0.05);
    c.beginPath();
    c.moveTo(px(rng.next()), py(rng.next()));
    c.quadraticCurveTo(px(rng.next()), py(rng.next()), px(rng.next()), py(rng.next()));
    c.stroke();
  }
  c.strokeStyle = pal[pal.length - 1];
  c.lineWidth = Math.max(1, Math.min(iw, ih) * 0.008);
  c.beginPath();
  c.moveTo(px(0.05), py(0.2 + rng.next() * 0.6));
  c.lineTo(px(0.95), py(0.2 + rng.next() * 0.6));
  c.stroke();
  // la sombra del marco sobre la tela
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.lineWidth = Math.max(1, m * 0.3);
  c.strokeRect(m, m, iw, ih);
  return canvas;
}

/** Los colores de las fotos del menú (pan, carne, papas, lechuga, gaseosa, helado): planos, sin imagen. */
const FOOD = ['#d99a3d', '#7a3d1f', '#f2c14e', '#6aa84f', '#b0302a', '#f4ede0'] as const;

/**
 * Una pantalla de menú (§4.5) propia, sin logos: el fondo (`look.fondo`) oscuro, una franja de título del color del marco
 * con el nombre del cartel, y dos o tres productos con su foto (formas planas: el pan, la carne, las papas en su caja,
 * el vaso) y su precio (`look.letra`). Brilla: la pinta el plan con `glow`.
 */
function menu(look: SignLook, width: number, height: number, seed: string): HTMLCanvasElement {
  const { canvas, c, w, h } = sheet(width, height);
  const rng = rngOf(seed);
  c.fillStyle = look.fondo;
  c.fillRect(0, 0, w, h);
  const band = Math.round(h * 0.2);
  c.fillStyle = look.marco;
  c.fillRect(0, 0, w, band);
  c.fillStyle = look.letra;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `bold ${Math.round(band * 0.62)}px "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`;
  c.fillText(seed.replace(/\s*#\d+$/, ''), w / 2, band / 2, w * 0.92);
  const n = w / h > 2.2 ? 3 : 2, cell = w / n;
  for (let k = 0; k < n; k++) {
    const x = cell * k + cell / 2, y = band + (h - band) * 0.42, r = Math.min(cell, h - band) * 0.26;
    // la foto: una hamburguesa (pan, carne, lechuga), unas papas o un vaso, al azar
    const kind = Math.floor(rng.next() * 3) % 3;
    if (kind === 0) {
      c.fillStyle = FOOD[0];
      c.beginPath();
      c.ellipse(x, y - r * 0.25, r, r * 0.55, 0, Math.PI, 0);
      c.fill();
      c.fillStyle = FOOD[3];
      c.fillRect(x - r * 1.02, y - r * 0.12, r * 2.04, r * 0.14);
      c.fillStyle = FOOD[1];
      c.fillRect(x - r * 0.98, y + r * 0.02, r * 1.96, r * 0.28);
      c.fillStyle = FOOD[0];
      c.fillRect(x - r * 0.95, y + r * 0.3, r * 1.9, r * 0.22);
    } else if (kind === 1) {
      c.fillStyle = FOOD[2];
      for (let j = -3; j <= 3; j++) c.fillRect(x + j * r * 0.16 - r * 0.05, y - r * (0.9 - Math.abs(j) * 0.08), r * 0.1, r * 0.9);
      c.fillStyle = FOOD[4];
      c.beginPath();
      c.moveTo(x - r * 0.62, y - r * 0.2);
      c.lineTo(x + r * 0.62, y - r * 0.2);
      c.lineTo(x + r * 0.48, y + r * 0.6);
      c.lineTo(x - r * 0.48, y + r * 0.6);
      c.fill();
    } else {
      c.fillStyle = FOOD[5];
      c.beginPath();
      c.moveTo(x - r * 0.5, y - r * 0.8);
      c.lineTo(x + r * 0.5, y - r * 0.8);
      c.lineTo(x + r * 0.38, y + r * 0.6);
      c.lineTo(x - r * 0.38, y + r * 0.6);
      c.fill();
      c.fillStyle = FOOD[4];
      c.fillRect(x - r * 0.46, y - r * 0.35, r * 0.92, r * 0.3);
    }
    c.fillStyle = look.letra;
    c.font = `bold ${Math.round((h - band) * 0.16)}px "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`;
    c.fillText(`$ ${(4 + Math.floor(rng.next() * 9)) * 1000 + (rng.next() < 0.5 ? 500 : 900)}`, x, band + (h - band) * 0.84, cell * 0.9);
  }
  return canvas;
}

/** El tapizado en zigzag blanco y negro de los sillones del McDonald's (§4.5): franjas en V de `look.fondo` y `look.letra`. */
function zigzag(look: SignLook, width: number, height: number): HTMLCanvasElement {
  const { canvas, c, w, h } = sheet(width, height);
  c.fillStyle = look.fondo;
  c.fillRect(0, 0, w, h);
  c.fillStyle = look.letra;
  const step = Math.max(8, Math.round(0.12 * PX_PER_M)), amp = step * 0.5;
  for (let y = -step; y < h + step; y += step) {
    c.beginPath();
    for (let x = 0, k = 0; x <= w + step; x += step / 2, k++) c.lineTo(x, y + (k % 2 === 0 ? 0 : amp));
    for (let x = Math.floor((w + step) / (step / 2)) * (step / 2), k = Math.floor((w + step) / (step / 2)); x >= 0; x -= step / 2, k--) {
      c.lineTo(x, y + step / 2 + (k % 2 === 0 ? 0 : amp));
    }
    c.closePath();
    c.fill();
  }
  return canvas;
}

/** El dibujo de cada Label.drawing, al tamaño del cartel (ancho × alto en metros, a PX_PER_M), con el texto del cartel
 *  de semilla (el tesoro y el zigzag no la usan). */
/** Los cielos de los afiches (arriba, abajo) y el color de las siluetas. */
const POSTER_SKIES = [
  ['#0f1a3a', '#c4553a'], ['#05070d', '#2a5c8a'], ['#1b0f2e', '#d9822b'], ['#0c2424', '#7fb8a4'], ['#2a0a0a', '#e0b04a'], ['#101010', '#8a2be2'],
] as const;
const SILHOUETTE = '#07080a';

/**
 * El afiche de una película inventada (§4.6: afiches genéricos enmarcados), sin título ni marcas: un cielo en degradé, una
 * luna o un sol, una silueta (una ciudad, unas montañas o una figura parada) y, abajo, el bloque de los créditos en
 * rayitas claras; arriba, dos rayas gruesas donde iría el título. El marco (`look.marco`) alrededor.
 */
function afiche(look: SignLook, width: number, height: number, seed: string): HTMLCanvasElement {
  const { canvas, c, w, h } = sheet(width, height);
  const rng = rngOf(seed);
  const [top, bottom] = any(rng, POSTER_SKIES);
  const m = Math.max(4, Math.round(Math.min(w, h) * 0.05));
  c.fillStyle = look.marco;
  c.fillRect(0, 0, w, h);
  const [x0, y0, iw, ih] = [m, m, w - 2 * m, h - 2 * m];
  const g = c.createLinearGradient(0, y0, 0, y0 + ih);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.fillRect(x0, y0, iw, ih);
  // la luna (o el sol): un disco claro con un halo
  const [mx, my, mr] = [x0 + iw * (0.25 + rng.next() * 0.5), y0 + ih * (0.25 + rng.next() * 0.15), iw * (0.12 + rng.next() * 0.12)];
  c.globalAlpha = 0.25;
  c.fillStyle = '#fff4d6';
  circle(c, mx, my, mr * 1.6);
  c.fill();
  c.globalAlpha = 1;
  circle(c, mx, my, mr);
  c.fill();
  // la silueta, sobre el último tercio
  c.fillStyle = SILHOUETTE;
  const base = y0 + ih * 0.78, kind = Math.floor(rng.next() * 3) % 3;
  if (kind === 0) {
    // una ciudad: edificios de alturas al azar, con alguna ventana encendida
    for (let x = x0; x < x0 + iw; ) {
      const bw = iw * (0.06 + rng.next() * 0.1), bh = ih * (0.08 + rng.next() * 0.3);
      c.fillStyle = SILHOUETTE;
      c.fillRect(x, base - bh, bw + 1, bh + 1);
      c.fillStyle = '#f2c14e';
      for (let k = 0; k < 3; k++) if (rng.next() < 0.5) c.fillRect(x + bw * (0.2 + rng.next() * 0.6), base - bh * (0.2 + rng.next() * 0.7), Math.max(1, bw * 0.12), Math.max(1, bw * 0.12));
      x += bw;
    }
    c.fillStyle = SILHOUETTE;
  } else if (kind === 1) {
    // montañas
    c.beginPath();
    c.moveTo(x0, base);
    for (let k = 0; k <= 6; k++) c.lineTo(x0 + (iw * k) / 6, base - ih * (k % 2 ? 0.12 + rng.next() * 0.25 : 0.03 + rng.next() * 0.08));
    c.lineTo(x0 + iw, base);
    c.fill();
  } else {
    // una figura parada, de espaldas
    const fx = x0 + iw * (0.35 + rng.next() * 0.3), fh = ih * 0.32;
    circle(c, fx, base - fh, fh * 0.11);
    c.fill();
    c.beginPath();
    c.moveTo(fx - fh * 0.16, base - fh * 0.86);
    c.lineTo(fx + fh * 0.16, base - fh * 0.86);
    c.lineTo(fx + fh * 0.2, base);
    c.lineTo(fx - fh * 0.2, base);
    c.fill();
  }
  c.fillRect(x0, base, iw, y0 + ih - base);
  // el título (dos rayas gruesas claras) y los créditos (rayitas finas)
  c.fillStyle = '#f4ede0';
  c.fillRect(x0 + iw * 0.12, y0 + ih * 0.06, iw * 0.76, ih * 0.045);
  c.fillRect(x0 + iw * 0.25, y0 + ih * 0.12, iw * 0.5, ih * 0.03);
  c.globalAlpha = 0.7;
  for (let k = 0; k < 4; k++) c.fillRect(x0 + iw * (0.1 + (k % 2) * 0.04), y0 + ih * (0.83 + k * 0.035), iw * (0.8 - (k % 2) * 0.08), Math.max(1, ih * 0.012));
  c.globalAlpha = 1;
  return canvas;
}

/** El vidrio de las botellas de atrás (lo poco que se ve de su color, en el borde que toma la luz): ya oscuro, porque
 *  el cartel brilla. */
const BACK_GLASS = ['#4a2e0a', '#183012', '#34342a', '#30140c', '#18223a', '#38381a'] as const;
/** Las formas (m): el cuerpo (ancho, alto), el hombro, el cuello (ancho, alto): una de vino, una cuadrada de whisky,
 *  una alta de licor y una petaca redonda. */
const BOTTLE_SHAPES = [
  { bw: 0.075, bh: 0.19, sh: 0.035, nw: 0.024, nh: 0.08 },
  { bw: 0.09, bh: 0.16, sh: 0.015, nw: 0.03, nh: 0.05 },
  { bw: 0.062, bh: 0.23, sh: 0.04, nw: 0.02, nh: 0.06 },
  { bw: 0.11, bh: 0.11, sh: 0.045, nw: 0.028, nh: 0.06 },
] as const;

/**
 * La fila de atrás de un estante de bar (el Guernica), de frente: la luz cálida del fondo (`look.fondo`, que se apaga
 * hacia arriba en `look.marco`: la sombra del estante de arriba) y, apoyadas abajo, botellas de cuatro formas en
 * silueta (`look.letra`), juntas, con el borde que toma la luz del color de su vidrio. Sin etiquetas ni marcas. Se
 * dibuja en metros (el cartel no tiene la proporción del canvas: el lado corto es de al menos 64 px).
 */
function botellas(look: SignLook, width: number, height: number, seed: string): HTMLCanvasElement {
  const { canvas, c, w, h } = sheet(width, height);
  const rng = rngOf(seed);
  const [sx, sy] = [w / width, h / height];
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, look.marco);
  g.addColorStop(0.45, look.fondo);
  g.addColorStop(1, look.fondo);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  for (let x = 0.02 + rng.next() * 0.03; x < width - 0.06; ) {
    const f = any(rng, BOTTLE_SHAPES), k = 0.9 + rng.next() * 0.2;
    const [bw, bh, sh, nw, nh] = [f.bw * k, f.bh * k, f.sh * k, f.nw * k, f.nh * k];
    if (x + bw > width - 0.01) break;
    const cx = (x + bw / 2) * sx, base = h;
    const [hb, hn, ht] = [base - bh * sy, base - (bh + sh) * sy, base - (bh + sh + nh) * sy];
    // la silueta: el cuerpo, el hombro redondeado y el cuello
    c.fillStyle = look.letra;
    c.beginPath();
    c.moveTo(cx - (bw / 2) * sx, base);
    c.lineTo(cx - (bw / 2) * sx, hb);
    c.quadraticCurveTo(cx - (bw / 2) * sx, hn, cx - (nw / 2) * sx, hn);
    c.lineTo(cx - (nw / 2) * sx, ht);
    c.lineTo(cx + (nw / 2) * sx, ht);
    c.lineTo(cx + (nw / 2) * sx, hn);
    c.quadraticCurveTo(cx + (bw / 2) * sx, hn, cx + (bw / 2) * sx, hb);
    c.lineTo(cx + (bw / 2) * sx, base);
    c.closePath();
    c.fill();
    // el borde que toma la luz, del color del vidrio, de un lado del cuerpo y del cuello
    const side = rng.next() < 0.5 ? -1 : 1, edge = Math.max(1, bw * 0.16 * sx);
    c.fillStyle = any(rng, BACK_GLASS);
    c.fillRect(side < 0 ? cx - (bw / 2) * sx + 1 : cx + (bw / 2) * sx - 1 - edge, hb + (base - hb) * 0.06, edge, (base - hb) * 0.86);
    c.fillRect(side < 0 ? cx - (nw / 2) * sx : cx + (nw / 2) * sx - Math.max(1, edge / 2), ht + 1, Math.max(1, edge / 2), hn - ht - 1);
    x += bw + 0.008 + rng.next() * 0.03;
  }
  return canvas;
}

export const LABEL_DRAWINGS: Record<LabelDrawing, (look: SignLook, width: number, height: number, seed: string) => HTMLCanvasElement> = { tesoro, plafon, cuadro, menu, zigzag, afiche, botellas };
