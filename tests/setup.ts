import { expect } from 'vitest';
import type { Vec2 } from '../src/shared/geo.ts';

expect.extend({
  toBeCloseTo2D(received: Vec2, expected: Vec2, digits = 2) {
    const tol = 10 ** -digits / 2;
    const pass = Math.abs(received[0] - expected[0]) < tol && Math.abs(received[1] - expected[1]) < tol;
    return {
      pass,
      message: () => `expected [${received}] ${pass ? 'not ' : ''}to be close to [${expected}] (${digits} digits)`,
    };
  },
});

declare module 'vitest' {
  interface Assertion<R, T> {
    toBeCloseTo2D(expected: Vec2, digits?: number): R;
  }
  interface AsymmetricMatchersContaining {
    toBeCloseTo2D(expected: Vec2, digits?: number): unknown;
  }
}
