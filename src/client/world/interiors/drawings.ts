// Los carteles que llevan un dibujo en vez de su texto (Label.drawing), dibujados en canvas al armar el interior: no se
// baja ninguna imagen (§2.4). Como los carteles de texto, son claros y se hornean con la luz del lugar.
import type { LabelDrawing } from '../../../shared/interiors/types.ts';
import type { SignLook } from '../../../shared/mapdata.ts';
import { PX_PER_M } from '../signs.ts';

type Ctx = CanvasRenderingContext2D;

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
  const w = Math.max(64, Math.round(width * PX_PER_M)), h = Math.max(64, Math.round(height * PX_PER_M));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
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

/** El dibujo de cada Label.drawing, al tamaño del cartel (ancho × alto en metros, a PX_PER_M). */
export const LABEL_DRAWINGS: Record<LabelDrawing, (look: SignLook, width: number, height: number) => HTMLCanvasElement> = { tesoro };
