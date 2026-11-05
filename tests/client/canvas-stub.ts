// jsdom no tiene canvas 2D: un contexto que acepta todo alcanza para armar texturas en los tests (no se mira el dibujo).
// Usar con `// @vitest-environment jsdom` y `vi.restoreAllMocks()` en afterEach.

/** `onSet` ve cada propiedad que se asigna en el contexto (fillStyle, font…) y `onCall`, cada método que se llama con sus
 *  argumentos (fillRect, translate…, y addColorStop de los degradados), en el orden en que pasan, de todos los
 *  contextos. El stub no dibuja: sirve para mirar las llamadas, no los píxeles. measureText: 0,55 × tamaño por carácter. */
export function stubCanvas(onSet?: (prop: string, value: unknown) => void, onCall?: (method: string, args: unknown[]) => void): void {
  const fake = (canvas: HTMLCanvasElement | undefined): CanvasRenderingContext2D => {
    const state: Record<string | symbol, unknown> = { font: '10px sans-serif' };
    const log = (canvas && OPS.get(canvas)) ?? [];
    if (canvas) OPS.set(canvas, log);
    const impl = (prop: string): ((...args: never[]) => unknown) | undefined => {
      if (prop === 'measureText') {
        return (text: string) => {
          const px = Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10);
          return { width: text.length * px * 0.55 };
        };
      }
      if (prop === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (prop === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      // los degradados: sus paradas también pasan por onCall, como addColorStop(offset, color)
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: (...a: unknown[]) => onCall?.('addColorStop', a) });
      return undefined;
    };
    return new Proxy(state, {
      get(target, prop) {
        if (prop in target) return target[prop];
        const f = typeof prop === 'string' ? impl(prop) : undefined;
        return (...args: never[]) => {
          if (typeof prop === 'string') {
            onCall?.(prop, args);
            log.push({ method: prop, args: [...args], fill: state.fillStyle });
          }
          return f?.(...args);
        };
      },
      set(target, prop, value) {
        target[prop] = value;
        if (typeof prop === 'string') onSet?.(prop, value);
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement | undefined) {
    // `this`, el canvas (si se llama suelto, sin canvas: no se guarda lo que pinta)
    return fake(this instanceof HTMLCanvasElement ? this : undefined) as never;
  });
}

/** Lo que se llamó en el contexto de cada canvas, con el fillStyle de ese momento. */
const OPS = new WeakMap<HTMLCanvasElement, { method: string; args: unknown[]; fill: unknown }[]>();

/** El color del píxel (x, y) del canvas: el fillStyle del último fillRect que lo cubre (el stub no pinta: rehace sus
 *  rectángulos; las letras y los caminos no cuentan), o undefined si ninguno. */
export function canvasFill(canvas: HTMLCanvasElement, x: number, y: number): string | undefined {
  let got: string | undefined;
  for (const o of OPS.get(canvas) ?? []) {
    if (o.method !== 'fillRect') continue;
    const [rx, ry, rw, rh] = o.args as number[];
    if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) got = String(o.fill);
  }
  return got;
}

/** Los colores con que se escribió en el canvas (fillText), sin repetir, en orden. */
export function canvasTextFills(canvas: HTMLCanvasElement): string[] {
  return [...new Set((OPS.get(canvas) ?? []).filter((o) => o.method === 'fillText').map((o) => String(o.fill)))];
}
