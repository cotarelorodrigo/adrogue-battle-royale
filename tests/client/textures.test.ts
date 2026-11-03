import { existsSync, readFileSync, statSync } from 'node:fs';

const SLOTS = ['revoque', 'ladrillo', 'asfalto', 'hormigon', 'pasto', 'sendero', 'techo', 'metal', 'madera', 'corteza', 'empedrado'];
const entries = JSON.parse(readFileSync('data/textures.json', 'utf8')) as { slot: string; license: string }[];

test('textures.json tiene los 11 slots, todos CC0', () => {
  expect(entries.map((e) => e.slot).sort()).toEqual([...SLOTS].sort());
  expect(entries.every((e) => e.license === 'CC0')).toBe(true);
});

test('existen los 3 mapas de cada slot y pesan menos de 25 MB', () => {
  let total = 0;
  for (const slot of SLOTS) {
    for (const map of ['diff', 'nor_gl', 'rough']) {
      const file = `public/textures/${slot}_${map}.jpg`;
      expect(existsSync(file), file).toBe(true);
      total += statSync(file).size;
    }
  }
  expect(total).toBeLessThan(25 * 1024 * 1024);
});
