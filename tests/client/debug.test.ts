import { DEFAULT_DUMMIES, matchParams } from '../../src/client/debug.ts';

test('?maniquis: 11 por defecto, limitado a 0–23', () => {
  expect(DEFAULT_DUMMIES).toBe(11);
  expect(matchParams('').dummies).toBe(11);
  expect(matchParams('?maniquis=2').dummies).toBe(2);
  expect(matchParams('?maniquis=0').dummies).toBe(0);
  expect(matchParams('?maniquis=99').dummies).toBe(23);
  expect(matchParams('?maniquis=-4').dummies).toBe(0);
  expect(matchParams('?maniquis=muchos').dummies).toBe(11);
});

test('?semilla: un entero de 32 bits, o null para que la elija el cliente', () => {
  expect(matchParams('?debug=1&semilla=7').seed).toBe(7);
  expect(matchParams('').seed).toBeNull();
  expect(matchParams('?semilla=').seed).toBeNull();
  expect(matchParams('?semilla=abc').seed).toBeNull();
  expect(matchParams('?semilla=4294967297').seed).toBe(1);
});
