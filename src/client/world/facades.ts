import { BAY_W, FLOOR_H } from './geometry.ts';

export type FacadeStyle = 'house' | 'shop' | 'upper';

export interface FacadeOptions {
  /** Luminancia media buscada para la base (0..1). Revoque: 0.8; ladrillo: menos, el tinte por vértice multiplica. */
  target?: number;
  /** Imágenes de relleno para persianas metálicas y de madera. */
  metal?: CanvasImageSource;
  wood?: CanvasImageSource;
}

type Ctx = CanvasRenderingContext2D;

/** Luminancia media (0..1) de una imagen, muestreada en 16 × 16. */
function averageLuminance(img: CanvasImageSource): number {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  return sum / 256;
}

function fillRect(ctx: Ctx, img: CanvasImageSource | undefined, fallback: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = fallback;
  ctx.fillRect(x, y, w, h);
  if (img) ctx.drawImage(img, x, y, w, h);
}

function glass(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#5d7383');
  g.addColorStop(0.5, '#33434f');
  g.addColorStop(1, '#202b33');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

function frame(ctx: Ctx, x: number, y: number, w: number, h: number, t: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = t;
  ctx.strokeRect(x, y, w, h);
}

/** Reja: barrotes verticales y dos travesaños. */
function bars(ctx: Ctx, x: number, y: number, w: number, h: number, u: number): void {
  ctx.strokeStyle = '#1d1d1d';
  ctx.lineWidth = 0.03 * u;
  const n = 6;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(x + (w * i) / n, y);
    ctx.lineTo(x + (w * i) / n, y + h);
    ctx.stroke();
  }
  for (const f of [0.15, 0.85]) {
    ctx.beginPath();
    ctx.moveTo(x, y + h * f);
    ctx.lineTo(x + w, y + h * f);
    ctx.stroke();
  }
  ctx.lineWidth = 0.05 * u;
  ctx.strokeRect(x, y, w, h);
}

/** Hoja de persiana de madera con tablillas horizontales. */
function shutter(ctx: Ctx, o: FacadeOptions, x: number, y: number, w: number, h: number, u: number): void {
  fillRect(ctx, o.wood, '#6b4a2b', x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.02 * u;
  for (let yy = y + 0.1 * u; yy < y + h; yy += 0.1 * u) {
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy);
    ctx.stroke();
  }
  frame(ctx, x, y, w, h, 0.03 * u, '#3a2815');
}

function drawUpper(ctx: Ctx, o: FacadeOptions, u: number): void {
  const [x, y, w, h] = [0.95 * u, 0.6 * u, 1.1 * u, 1.7 * u];
  glass(ctx, x, y, w, h);
  ctx.strokeStyle = '#e8e6e0';
  ctx.lineWidth = 0.04 * u;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h);
  ctx.moveTo(x, y + h * 0.4); ctx.lineTo(x + w, y + h * 0.4);
  ctx.stroke();
  frame(ctx, x, y, w, h, 0.08 * u, '#e8e6e0');
  shutter(ctx, o, 0.3 * u, y, 0.6 * u, h, u);
  shutter(ctx, o, 2.1 * u, y, 0.6 * u, h, u);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; // sombra bajo el dintel
  ctx.fillRect(0.25 * u, y - 0.06 * u, 2.5 * u, 0.06 * u);
  ctx.fillStyle = '#cfcac0'; // alféizar
  ctx.fillRect(0.2 * u, y + h + 0.02 * u, 2.6 * u, 0.1 * u);
}

function drawHouse(ctx: Ctx, o: FacadeOptions, u: number, H: number): void {
  // Puerta de madera a la izquierda, ventana con reja a la derecha.
  const [dx, dw, dh] = [0.35 * u, 0.95 * u, 2.2 * u];
  const dy = H - dh;
  fillRect(ctx, o.wood, '#5a3d22', dx, dy, dw, dh);
  frame(ctx, dx, dy, dw, dh, 0.08 * u, '#2e2014');
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 0.03 * u;
  ctx.strokeRect(dx + 0.15 * u, dy + 0.15 * u, dw - 0.3 * u, 0.8 * u);
  ctx.strokeRect(dx + 0.15 * u, dy + 1.1 * u, dw - 0.3 * u, 0.9 * u);
  ctx.fillStyle = '#c9a54a';
  ctx.beginPath();
  ctx.arc(dx + dw - 0.14 * u, dy + 1.1 * u, 0.05 * u, 0, Math.PI * 2);
  ctx.fill();
  const [wx, wy, ww, wh] = [1.7 * u, 1.0 * u, 1.0 * u, 1.3 * u];
  glass(ctx, wx, wy, ww, wh);
  frame(ctx, wx, wy, ww, wh, 0.07 * u, '#e8e6e0');
  bars(ctx, wx, wy, ww, wh, u);
}

function drawShop(ctx: Ctx, o: FacadeOptions, u: number, H: number): void {
  const [x, y, w] = [0.3 * u, 0.5 * u, 2.4 * u];
  const h = H - 0.15 * u - y;
  glass(ctx, x, y, w, h);
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 0.05 * u;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.6, y); ctx.lineTo(x + w * 0.6, y + h);
  ctx.stroke();
  // Persiana metálica a medio subir: cubre la mitad superior del vano.
  const sh = h * 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, sh);
  ctx.clip();
  fillRect(ctx, o.metal, '#8b9097', x, y, w, sh);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 0.015 * u;
  for (let yy = y + 0.08 * u; yy < y + sh; yy += 0.08 * u) {
    ctx.beginPath();
    ctx.moveTo(x, yy); ctx.lineTo(x + w, yy);
    ctx.stroke();
  }
  ctx.fillStyle = '#3b3f45'; // listón inferior
  ctx.fillRect(x, y + sh - 0.06 * u, w, 0.08 * u);
  frame(ctx, x, y, w, h, 0.1 * u, '#2c2c2c');
}

/**
 * Un módulo de fachada de 3 m × 3,2 m sobre la textura base (revoque o ladrillo).
 * El canvas es de `size × round(size · 3,2 / 3)` px, así un píxel cubre lo mismo en ambos ejes
 * y la UV de las paredes (una unidad = un módulo) lo mapea sin distorsión. Determinista.
 */
export function composeFacadeTile(base: CanvasImageSource, style: FacadeStyle, size: number, options: FacadeOptions = {}): HTMLCanvasElement {
  const W = size;
  const H = Math.round((size * FLOOR_H) / BAY_W);
  const u = W / BAY_W; // px por metro
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(base, 0, 0, W, H);

  // Aclara y desatura hacia la luminancia buscada para que el tinte por vértice se lea.
  const l0 = averageLuminance(canvas);
  const target = options.target ?? 0.8;
  const a = Math.min(0.9, Math.max(0, (target - l0) / (1 - l0)));
  ctx.fillStyle = `rgba(255,255,255,${a})`;
  ctx.fillRect(0, 0, W, H);

  if (style === 'upper') drawUpper(ctx, options, u);
  else if (style === 'house') drawHouse(ctx, options, u, H);
  else drawShop(ctx, options, u, H);
  return canvas;
}
