// jsdom no tiene canvas 2D: un contexto que acepta todo alcanza para armar texturas en los tests (no se mira el dibujo).
// Usar con `// @vitest-environment jsdom` y `vi.restoreAllMocks()` en afterEach.

/** `onSet` ve cada propiedad que se asigna en el contexto (fillStyle, font…). measureText: 0,55 × tamaño por carácter. */
export function stubCanvas(onSet?: (prop: string, value: unknown) => void): void {
  const fake = (): CanvasRenderingContext2D => {
    const state: Record<string | symbol, unknown> = { font: '10px sans-serif' };
    return new Proxy(state, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'measureText') {
          return (text: string) => {
            const px = Number(/(\d+(?:\.\d+)?)px/.exec(String(target.font))?.[1] ?? 10);
            return { width: text.length * px * 0.55 };
          };
        }
        if (prop === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
        if (prop === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} });
        return () => {};
      },
      set(target, prop, value) {
        target[prop] = value;
        if (typeof prop === 'string') onSet?.(prop, value);
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fake() as never);
}
