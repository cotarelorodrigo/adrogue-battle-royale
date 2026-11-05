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
export const LABEL_DRAWINGS: Record<LabelDrawing, (look: SignLook, width: number, height: number, seed: string) => HTMLCanvasElement> = { tesoro, plafon, cuadro, menu, zigzag };
