import { FixedStep, SIM_HZ } from '../../src/shared/fixed-step.ts';

function correr(fs: FixedStep, dt: number): number[] {
  const hs: number[] = [];
  fs.advance(dt, (h) => hs.push(h));
  return hs;
}

test('un dt de 1/60 corre un paso con h = 1/60', () => {
  expect(correr(new FixedStep(), 1 / 60)).toEqual([1 / 60]);
  expect(SIM_HZ).toBe(60);
});

test('dos dt de 1/120 corren 0 y después 1 paso', () => {
  const fs = new FixedStep();
  expect(correr(fs, 1 / 120)).toHaveLength(0);
  expect(correr(fs, 1 / 120)).toHaveLength(1);
});

test('un dt enorme corre maxSteps y descarta el resto', () => {
  const fs = new FixedStep();
  expect(fs.advance(1, () => {})).toBe(5);
  expect(fs.advance(0, () => {})).toBe(0);
});

test('un dt negativo o no finito no corre nada', () => {
  const fs = new FixedStep();
  expect(fs.advance(-1, () => {})).toBe(0);
  expect(fs.advance(NaN, () => {})).toBe(0);
  expect(fs.advance(Infinity, () => {})).toBe(0);
});

test('600 cuadros alternando 1/30 y 1/144 corren floor(Σdt·60) pasos', () => {
  const fs = new FixedStep();
  let suma = 0;
  let pasos = 0;
  for (let i = 0; i < 600; i++) {
    const dt = i % 2 === 0 ? 1 / 30 : 1 / 144;
    suma += dt;
    pasos += fs.advance(dt, () => {});
  }
  expect(Math.abs(pasos - Math.floor(suma * 60))).toBeLessThanOrEqual(1);
});
