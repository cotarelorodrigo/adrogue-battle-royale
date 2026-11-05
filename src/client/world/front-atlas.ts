import * as THREE from 'three';
import { GROUND_CELLS, LOT_OPENINGS, isLotCell } from '../../shared/interiors/openings.ts';
import type { LotCell } from '../../shared/interiors/openings.ts';
import type { Arriba, PlantaBaja } from '../../shared/mapdata.ts';
import { averageLuminance, bars, frame, glass, shutter, WINDOW_GLASS } from './facades.ts';
import type { GlassStops } from './facades.ts';
import { BAY_W, FLOOR_H } from './wall-kit.ts';

export const FRONT_CELLS = ['vidriera', 'vidriera-puerta', 'persiana', 'porton', 'puerta', 'ventana-pb', 'banco', 'banco-puerta',
  'acceso', 'pared-pb', 'ventana', 'balcon', 'vidriado', 'pared', 'porton-l', 'puerta-l', 'ventana-pb-l', 'pared-pb-l',
  'ventana-l', 'balcon-l', 'pared-l', 'toldo', 'toldo-rayas'] as const;
export type FrontCell = (typeof FRONT_CELLS)[number];

/** 5 × 5 celdas cuadradas en la textura; cada una representa 3 m × 3,2 m. */
export const ATLAS_COLS = 5;
/** px de margen por lado, rellenados estirando el borde (contra el sangrado de los mipmaps). */
export const GUTTER = 4;

/** Lado del atlas de los tests y valor por defecto de `cellRect` (2 × textureSize de media/alta). */
const DEFAULT_SIZE = 2048;

/** UV de la celda sin el margen. v = 0 abajo (la celda 0 está arriba a la izquierda del canvas). */
export function cellRect(c: FrontCell, size = DEFAULT_SIZE): { u0: number; v0: number; u1: number; v1: number } {
  const i = FRONT_CELLS.indexOf(c);
  const col = i % ATLAS_COLS;
  const row = Math.floor(i / ATLAS_COLS);
  const pitch = 1 / ATLAS_COLS;
  const g = GUTTER / size;
  return { u0: col * pitch + g, u1: (col + 1) * pitch - g, v1: 1 - (row * pitch + g), v0: 1 - ((row + 1) * pitch - g) };
}

const withBrick = (c: FrontCell, ladrillo: boolean): FrontCell =>
  ladrillo && (FRONT_CELLS as readonly string[]).includes(`${c}-l`) ? (`${c}-l` as FrontCell) : c;

/** La tabla es la de src/shared (mapgen la usa para las aberturas de los lotes). */
const GROUND: Record<PlantaBaja, readonly [FrontCell, FrontCell]> = GROUND_CELLS;

/** Celda de la bahía de la puerta y la del resto de la planta baja. */
export function groundCells(pb: PlantaBaja, ladrillo: boolean): { door: FrontCell; rest: FrontCell } {
  const [door, rest] = GROUND[pb];
  return { door: withBrick(door, ladrillo), rest: withBrick(rest, ladrillo) };
}

const UPPER: Record<Arriba, FrontCell> = { ventanas: 'ventana', balcones: 'balcon', vidriado: 'vidriado', ciego: 'pared' };

export function upperCell(arriba: Arriba, ladrillo: boolean): FrontCell {
  return withBrick(UPPER[arriba], ladrillo);
}

type Ctx = CanvasRenderingContext2D;
type Img = CanvasImageSource;
interface Images { revoque: Img; ladrillo: Img; metal: Img; madera: Img }

/** Lo que ve cada dibujo: medidas en metros × `u` px, el color, y la máscara (255 = pintado). */
interface Pen { c: Ctx; m: Ctx; u: number; img: Images }

/** Hueco que conserva su propio color: la máscara lo apaga. */
function unpaint(p: Pen, x: number, y: number, w: number, h: number): void {
  p.m.fillStyle = '#000';
  p.m.fillRect(x, y, w, h);
}

function texFill(c: Ctx, img: Img, fallback: string, x: number, y: number, w: number, h: number): void {
  c.fillStyle = fallback;
  c.fillRect(x, y, w, h);
  c.drawImage(img, x, y, w, h);
}

/** El vidrio de las vidrieras y puertas de los lotes (solo planta baja: las celdas de LOT_OPENINGS), más claro que el
 *  de las ventanas: es la tapa de los huecos de los interiores (D6) y de lejos tiene que parecerse a un interior visto
 *  por un vidrio que refleja el cielo, sin salto a los 60 m (H2d: en alta, BBVA 72 → 56 y La Veneciana 41 → 35 de luma
 *  sRGB, a 59 y a 61 m). Los pisos de arriba, también el vidriado, siguen con el de las ventanas (N5). */
export const SHOP_GLASS: GlassStops = ['#a6b8c4', '#7d8f9b', '#62717b'];

/** El ancho (m) del marco de un vidrio pintado, centrado en su borde, y el de sus parteluces, centrados en su recta. */
export const FRAME_T = 0.1, MULLION_T = 0.05;

/** Vidrio con parteluces verticales (`mullions` paños) y su marco; de vidriera salvo que se pida otro. */
function drawGlazing(p: Pen, x: number, y: number, w: number, h: number, mullions: number, frameColor: string, stops = SHOP_GLASS): void {
  const { c, u } = p;
  glass(c, x, y, w, h, stops);
  c.strokeStyle = frameColor;
  c.lineWidth = MULLION_T * u;
  for (let i = 1; i < mullions; i++) {
    c.beginPath();
    c.moveTo(x + (w * i) / mullions, y);
    c.lineTo(x + (w * i) / mullions, y + h);
    c.stroke();
  }
  frame(c, x, y, w, h, FRAME_T * u, frameColor);
  unpaint(p, x - 0.05 * u, y - 0.05 * u, w + 0.1 * u, h + 0.1 * u);
}

/** Puerta: el hueco con la hoja de vidrio abierta hacia adentro (D10, solo dibujo). Se ve el vidrio oscurecido por el
 *  interior, con el marco y la hoja de canto contra la jamba, con su manija; de 2 m o más, dos hojas. */
function drawDoor(p: Pen, x: number, y: number, w: number, h: number, frameColor: string): void {
  const { c, u } = p;
  glass(c, x, y, w, h, SHOP_GLASS);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(x, y, w, h);
  frame(c, x, y, w, h, 0.1 * u, frameColor);
  c.fillStyle = frameColor;
  c.fillRect(x + 0.05 * u, y, 0.08 * u, h); // la hoja abierta, de canto contra la jamba
  if (w >= 2 * u) c.fillRect(x + w - 0.13 * u, y, 0.08 * u, h); // la otra hoja, contra la otra jamba
  c.fillStyle = '#c8c8c8';
  c.fillRect(x + 0.16 * u, y + h * 0.45, 0.04 * u, 0.35 * u);
  unpaint(p, x - 0.05 * u, y - 0.05 * u, w + 0.1 * u, h + 0.05 * u);
}

/** Banda de dintel (2,4 a 3,2 m) libre arriba de la planta baja: queda de pared para el cartel. */
const LINTEL = 0.8;

/** Marco y ancho de paño de cada familia de celdas con aberturas. */
const OPENING_LOOK: Record<LotCell, { frame: string; pane: number }> = {
  vidriera: { frame: '#2c2c2c', pane: 0.9 },
  'vidriera-puerta': { frame: '#2c2c2c', pane: 0.9 },
  banco: { frame: '#9ea3a8', pane: 1.4 },
  'banco-puerta': { frame: '#9ea3a8', pane: 1.4 },
  acceso: { frame: '#3a3a3a', pane: 1.4 },
};

/** En cuántos paños iguales se pinta el vidrio `o` de una celda de lote (los parteluces van entre uno y otro). */
export const panesOf = (cell: LotCell, o: { x0: number; x1: number }): number => Math.max(1, Math.round((o.x1 - o.x0) / OPENING_LOOK[cell].pane));

/** Las aberturas de una celda de lote, exactamente en los rectángulos de LOT_OPENINGS: lo pintado coincide con el hueco
 *  del interior. */
function drawOpenings(p: Pen, cell: LotCell): void {
  const { u } = p;
  const look = OPENING_LOOK[cell];
  for (const o of LOT_OPENINGS[cell]) {
    const [x, y, w, h] = [o.x0 * u, (FLOOR_H - o.y1) * u, (o.x1 - o.x0) * u, (o.y1 - o.y0) * u];
    if (o.kind === 'puerta') drawDoor(p, x, y, w, h, look.frame);
    else drawGlazing(p, x, y, w, h, panesOf(cell, o), look.frame);
  }
}

function drawGround(p: Pen, cell: string): void {
  const { c, u } = p;
  const top = LINTEL * u;
  const kind = cell.replace(/-l$/, '');
  const H = FLOOR_H * u;
  if (isLotCell(kind)) {
    drawOpenings(p, kind);
    return;
  }
  switch (kind) {
    case 'persiana': {
      const [x, y, w, h] = [0.1 * u, top + 0.1 * u, 2.8 * u, H - top - 0.1 * u];
      texFill(c, p.img.metal, '#8b9097', x, y, w, h);
      c.strokeStyle = 'rgba(0,0,0,0.3)';
      c.lineWidth = 0.015 * u;
      for (let yy = y + 0.08 * u; yy < y + h; yy += 0.08 * u) {
        c.beginPath();
        c.moveTo(x, yy);
        c.lineTo(x + w, yy);
        c.stroke();
      }
      c.fillStyle = '#3b3f45';
      c.fillRect(x, y + h - 0.1 * u, w, 0.1 * u);
      frame(c, x, y, w, h, 0.08 * u, '#2c2c2c');
      unpaint(p, x - 0.04 * u, y - 0.04 * u, w + 0.08 * u, h + 0.04 * u);
      break;
    }
    case 'porton': {
      const [x, y, w, h] = [0.2 * u, top + 0.1 * u, 2.6 * u, H - top - 0.1 * u];
      texFill(c, p.img.metal, '#6e7379', x, y, w, h);
      c.strokeStyle = 'rgba(0,0,0,0.4)';
      c.lineWidth = 0.03 * u;
      c.strokeRect(x + 0.15 * u, y + 0.15 * u, w - 0.3 * u, h * 0.4);
      c.strokeRect(x + 0.15 * u, y + h * 0.55, w - 0.3 * u, h * 0.4 - 0.1 * u);
      bars(c, x + 0.3 * u, y + 0.25 * u, w - 0.6 * u, h * 0.3, u);
      frame(c, x, y, w, h, 0.1 * u, '#2c2c2c');
      unpaint(p, x - 0.05 * u, y - 0.05 * u, w + 0.1 * u, h + 0.05 * u);
      break;
    }
    case 'puerta': {
      const [x, y, w, h] = [0.8 * u, top + 0.1 * u, 1.4 * u, H - top - 0.1 * u];
      shutter(c, { wood: p.img.madera }, x, y, w, h, u);
      c.strokeStyle = 'rgba(0,0,0,0.4)';
      c.lineWidth = 0.03 * u;
      c.strokeRect(x + 0.2 * u, y + 0.2 * u, w - 0.4 * u, 0.9 * u);
      c.fillStyle = '#c9a54a';
      c.beginPath();
      c.arc(x + w - 0.2 * u, y + h * 0.5, 0.06 * u, 0, Math.PI * 2);
      c.fill();
      frame(c, x, y, w, h, 0.1 * u, '#2e2014');
      unpaint(p, x - 0.05 * u, y - 0.05 * u, w + 0.1 * u, h + 0.05 * u);
      break;
    }
    case 'ventana-pb': {
      const [x, y, w, h] = [0.7 * u, 1.3 * u, 1.6 * u, 1.4 * u];
      glass(c, x, y, w, h);
      frame(c, x, y, w, h, 0.08 * u, '#e8e6e0');
      bars(c, x, y, w, h, u);
      c.fillStyle = '#cfcac0';
      c.fillRect(x - 0.1 * u, y + h, w + 0.2 * u, 0.1 * u);
      unpaint(p, x - 0.04 * u, y - 0.04 * u, w + 0.08 * u, h + 0.08 * u);
      unpaint(p, x - 0.1 * u, y + h, w + 0.2 * u, 0.1 * u);
      break;
    }
    default: { // pared-pb: zócalo más oscuro, sigue siendo pared pintada
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(0, H - 0.4 * u, 3 * u, 0.4 * u);
    }
  }
}

const UPPER_KINDS: string[] = Object.values(UPPER);

function drawUpperFloor(p: Pen, cell: string): void {
  const { c, u } = p;
  const kind = cell.replace(/-l$/, '');
  if (kind === 'ventana') {
    const [x, y, w, h] = [0.95 * u, 0.6 * u, 1.1 * u, 1.7 * u];
    glass(c, x, y, w, h);
    c.strokeStyle = '#e8e6e0';
    c.lineWidth = 0.04 * u;
    c.beginPath();
    c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h);
    c.moveTo(x, y + h * 0.4); c.lineTo(x + w, y + h * 0.4);
    c.stroke();
    frame(c, x, y, w, h, 0.08 * u, '#e8e6e0');
    shutter(c, { wood: p.img.madera }, 0.3 * u, y, 0.6 * u, h, u);
    shutter(c, { wood: p.img.madera }, 2.1 * u, y, 0.6 * u, h, u);
    c.fillStyle = '#cfcac0';
    c.fillRect(0.2 * u, y + h + 0.02 * u, 2.6 * u, 0.1 * u);
    unpaint(p, 0.26 * u, y - 0.04 * u, 2.48 * u, h + 0.08 * u);
    unpaint(p, 0.2 * u, y + h + 0.02 * u, 2.6 * u, 0.1 * u);
  } else if (kind === 'balcon') {
    const [x, y, w, h] = [0.9 * u, 0.5 * u, 1.2 * u, 2.5 * u];
    glass(c, x, y, w, h);
    c.strokeStyle = '#e8e6e0';
    c.lineWidth = 0.04 * u;
    c.beginPath();
    c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h);
    c.stroke();
    frame(c, x, y, w, h, 0.08 * u, '#e8e6e0');
    unpaint(p, x - 0.04 * u, y - 0.04 * u, w + 0.08 * u, h + 0.08 * u);
    c.fillStyle = '#b9b4aa'; // losa del balcón (hormigón, sin pintar)
    c.fillRect(0.1 * u, 3.0 * u, 2.8 * u, 0.2 * u);
    unpaint(p, 0.1 * u, 3.0 * u, 2.8 * u, 0.2 * u);
    bars(c, 0.2 * u, 2.1 * u, 2.6 * u, 0.9 * u, u);
    unpaint(p, 0.15 * u, 2.05 * u, 2.7 * u, 0.95 * u);
  } else if (kind === 'vidriado') {
    drawGlazing(p, 0.1 * u, 0.5 * u, 2.8 * u, 2.4 * u, 4, '#d9d6cf', WINDOW_GLASS); // piso de arriba: el de las ventanas
  }
  // pared: lisa
}

/** Toldo: tela. Lisa o con rayas verticales de 0,25 m (alternando color y blanco). */
function drawAwning(p: Pen, stripes: boolean, W: number, H: number): void {
  const { c, m, u } = p;
  c.fillStyle = '#eeeeee'; // casi blanco: el color del vértice lo tiñe
  c.fillRect(0, 0, W, H);
  m.fillStyle = '#fff';
  m.fillRect(0, 0, W, H);
  if (stripes) {
    const s = 0.25 * u;
    for (let i = 0; i * s < W; i++) {
      if (i % 2 === 0) continue;
      c.fillStyle = '#ffffff';
      c.fillRect(i * s, 0, s, H);
      unpaint(p, i * s, 0, s, H);
    }
  }
  c.strokeStyle = 'rgba(0,0,0,0.08)'; // pliegues de la tela
  c.lineWidth = 0.02 * u;
  for (let x = 0.5 * u; x < W; x += 0.5 * u) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, H);
    c.stroke();
  }
}

function newCanvas(size: number): [HTMLCanvasElement, Ctx] {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  return [cv, cv.getContext('2d')!];
}

/** Estira el borde de cada celda `GUTTER` px hacia afuera. */
function fillGutter(ctx: Ctx, cv: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number): void {
  const [w, h, g] = [x1 - x0, y1 - y0, GUTTER];
  ctx.drawImage(cv, x0, y0, 1, h, x0 - g, y0, g, h);
  ctx.drawImage(cv, x1 - 1, y0, 1, h, x1, y0, g, h);
  ctx.drawImage(cv, x0 - g, y0, w + 2 * g, 1, x0 - g, y0 - g, w + 2 * g, g);
  ctx.drawImage(cv, x0 - g, y1 - 1, w + 2 * g, 1, x0 - g, y1, w + 2 * g, g);
}

/**
 * Atlas de módulos de fachada (`size` px de lado). `color` lleva el dibujo; `mask`, en su canal R,
 * 255 donde es pared pintada (se tiñe con el color del vértice) y 0 donde conserva su color.
 */
export function composeFrontAtlas(img: Images, size: number): { color: HTMLCanvasElement; mask: HTMLCanvasElement } {
  const [color, cc] = newCanvas(size);
  const [mask, mc] = newCanvas(size);
  mc.fillStyle = '#000';
  mc.fillRect(0, 0, size, size);

  const pitch = size / ATLAS_COLS;
  const inner = Math.round(pitch) - 2 * GUTTER;
  const u = inner / BAY_W; // px por metro en horizontal
  const W = inner;
  const H = FLOOR_H * u;

  // Revoque aclarado a luminancia media 0,9 para que el tinte del vértice se lea casi tal cual.
  const [paint, pc] = newCanvas(inner);
  pc.drawImage(img.revoque, 0, 0, inner, inner);
  const l0 = averageLuminance(paint);
  pc.fillStyle = `rgba(255,255,255,${Math.min(0.9, Math.max(0, (0.9 - l0) / (1 - l0)))})`;
  pc.fillRect(0, 0, inner, inner);

  FRONT_CELLS.forEach((cell, i) => {
    const x0 = Math.round((i % ATLAS_COLS) * pitch) + GUTTER;
    const y0 = Math.round(Math.floor(i / ATLAS_COLS) * pitch) + GUTTER;
    const awning = cell.startsWith('toldo');
    const brick = cell.endsWith('-l');
    const pen: Pen = { c: cc, m: mc, u, img };
    for (const ctx of [cc, mc]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, inner, inner);
      ctx.clip();
      ctx.translate(x0, y0);
      ctx.scale(1, inner / H); // la celda es cuadrada en la textura pero mide 3 × 3,2 m
    }
    if (awning) drawAwning(pen, cell === 'toldo-rayas', W, H);
    else {
      cc.drawImage(brick ? img.ladrillo : paint, 0, 0, W, H);
      mc.fillStyle = brick ? '#000' : '#fff';
      mc.fillRect(0, 0, W, H);
      if (UPPER_KINDS.includes(cell.replace(/-l$/, ''))) drawUpperFloor(pen, cell);
      else drawGround(pen, cell);
    }
    cc.restore();
    mc.restore();
    fillGutter(cc, color, x0, y0, x0 + inner, y0 + inner);
    fillGutter(mc, mask, x0, y0, x0 + inner, y0 + inner);
  });
  return { color, mask };
}

/** RGBA para la `DataTexture` (flipY es false): filas de abajo arriba, A = R de la máscara. */
export function packAtlas(color: Uint8ClampedArray, mask: Uint8ClampedArray, size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = y * size * 4;
    const dst = (size - 1 - y) * size * 4;
    for (let x = 0; x < size * 4; x += 4) {
      out[dst + x] = color[src + x];
      out[dst + x + 1] = color[src + x + 1];
      out[dst + x + 2] = color[src + x + 2];
      out[dst + x + 3] = mask[src + x];
    }
  }
  return out;
}

/** Un material para todas las fachadas: el color del vértice solo tiñe donde la máscara (alfa del mapa) lo permite. */
export function frontMaterial(map: THREE.Texture, lambert: boolean): THREE.Material {
  const params = { map, vertexColors: true };
  const mat = lambert
    ? new THREE.MeshLambertMaterial(params)
    : new THREE.MeshStandardMaterial({ ...params, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    // si una versión nueva de three renombra el chunk, el replace no haría nada y el color teñiría todo el atlas
    // (vidrio y metal incluidos): mejor que se rompa a la vista
    const chunk = '#include <color_fragment>';
    if (!shader.fragmentShader.includes(chunk)) {
      throw new Error(`frontMaterial: el shader de three no tiene ${chunk}; hay que adaptar la máscara del atlas a esta versión`);
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      chunk,
      `diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, sampledDiffuseColor.a );
diffuseColor.a = opacity;`,
    );
  };
  mat.customProgramCacheKey = () => 'front-mask';
  return mat;
}
