import { loadFrentes, validateFrentes } from '../../src/mapgen/frentes-input.ts';

const IDS = ['banco-nacion', 'galicia'];
const base = (lotes: unknown[], extra: object = {}) => ({ calles: [{ calle: 'Esteban Adrogué', frentes: [
  { id: 'f1', desde: 'A', hasta: 'B', vereda: 'sur', fecha: '2024-03', lotes, ...extra }] }] });
const cartel = { texto: 'X', fondo: '#000000', letra: '#ffffff' };

test('completa los valores por defecto', () => {
  const l = validateFrentes(base([{ ancho: 8, pisos: 1, color: '#ffffff' }]), 'x', IDS).frentes[0].lotes[0];
  expect(l).toMatchObject({ fondo: 15, retiro: 0, pb: 'vidriera', arriba: 'ventanas', material: 'revoque', puerta: 'inicio' });
});
test('usa: el estilo se mezcla y el lote manda', () => {
  const d = { estilos: { c: { pisos: 1, pb: 'puerta', color: '#eeeeee' } }, ...base([{ usa: 'c', ancho: 9, color: '#111111' }]) };
  expect(validateFrentes(d, 'x', IDS).frentes[0].lotes[0]).toMatchObject({ pisos: 1, pb: 'puerta', color: '#111111', ancho: 9 });
});
test('cartel y toldo con sus valores por defecto; calzada se carga', () => {
  const d = base([{ ancho: 8, pisos: 1, color: '#ffffff', cartel, toldo: { color: '#2e6b3a' } }]);
  d.calles[0] = { ...d.calles[0], calzada: 'asfalto' } as typeof d.calles[0];
  const r = validateFrentes(d, 'x', IDS);
  expect(r.frentes[0].lotes[0].cartel).toMatchObject({ fuente: 'sans', cursiva: false, posicion: 'frente' });
  expect(r.frentes[0].lotes[0].toldo).toEqual({ color: '#2e6b3a', rayas: false });
  expect(r.calzadas).toEqual({ 'Esteban Adrogué': 'asfalto' });
  expect(r.frentes[0].osmAusentes).toEqual([]);
});
test.each([
  [[{ ancho: 8, pisos: 1, colour: '#fff' }], /frente f1, lote 1: campo desconocido "colour"/],
  [[{ ancho: 8, pisos: 1, color: 'rojo' }], /frente f1, lote 1: color tiene que ser #rrggbb/],
  [[{ ancho: 8, pisos: 1, color: '#ffffff', pb: 'local' }], /lote 1: pb tiene que ser uno de vidriera, persiana, porton, puerta, banco, acceso, pared/],
  [[{ ancho: 8, pisos: 0, cartel: { texto: 'X', fondo: '#000000', letra: '#ffffff' } }], /lote 1: un lote sin edificio \(pisos 0\) no lleva cartel/],
  [[{ ancho: 8, pisos: 1, color: '#ffffff', lugar: 'galicia' }], /lote 1: un lote con lugar necesita cartel/],
  [[{ ancho: 8, pisos: 1, color: '#ffffff', usa: 'nada' }], /lote 1: no existe el estilo "nada"/],
  [[{ ancho: 8, pisos: 1, color: '#ffffff', cartel: { texto: 'X', fondo: '#000000', letra: '#ffffff' }, lugar: 'mcdonalds' }], /lote 1: no existe el lugar "mcdonalds"/],
])('error claro %#', (lotes, re) => expect(() => validateFrentes(base(lotes), 'x', IDS)).toThrow(re));
test('un lugar en dos lotes', () => {
  const l = { ancho: 8, pisos: 1, color: '#ffffff', cartel, lugar: 'galicia' };
  expect(() => validateFrentes(base([l, l]), 'x', IDS)).toThrow(/lote 2: el lugar "galicia" ya está en el frente f1, lote 1/);
});
test('fecha AAAA-MM y frentes con id repetido', () => {
  const l = [{ ancho: 8, pisos: 1, color: '#ffffff' }];
  expect(() => validateFrentes(base(l, { fecha: '03/2024' }), 'x', IDS)).toThrow(/frente f1: fecha tiene que ser AAAA-MM/);
  const d = base(l);
  d.calles[0].frentes.push({ ...d.calles[0].frentes[0] });
  expect(() => validateFrentes(d, 'x', IDS)).toThrow(/frente f1: id repetido/);
});
test('rangos y reglas varias', () => {
  const ok = { ancho: 8, pisos: 1, color: '#ffffff' };
  expect(() => validateFrentes(base([{ ...ok, ancho: 0 }]), 'x', IDS)).toThrow(/lote 1: ancho/);
  expect(() => validateFrentes(base([{ ...ok, pisos: 21 }]), 'x', IDS)).toThrow(/lote 1: pisos/);
  expect(() => validateFrentes(base([{ ...ok, fondo: 2 }]), 'x', IDS)).toThrow(/lote 1: fondo/);
  expect(() => validateFrentes(base([{ ...ok, fondo: 50, retiro: 40 }]), 'x', IDS)).toThrow(/lote 1: retiro \+ fondo/);
  expect(() => validateFrentes(base([{ ancho: 8, pisos: 1 }]), 'x', IDS)).toThrow(/lote 1: falta color/);
  expect(() => validateFrentes(base([{ ancho: 8, pisos: 0, toldo: { color: '#000000' } }]), 'x', IDS)).toThrow(/lote 1: un lote sin edificio \(pisos 0\) no lleva toldo/);
  expect(() => validateFrentes(base([{ ...ok, cartel: { ...cartel, texto: '' } }]), 'x', IDS)).toThrow(/lote 1: cartel.texto/);
  expect(() => validateFrentes(base([]), 'x', IDS)).toThrow(/frente f1: lotes no puede estar vacío/);
  expect(() => validateFrentes(base([ok], { hasta: 'A' }), 'x', IDS)).toThrow(/frente f1: desde y hasta/);
});
test('data/frentes.json y el fixture de prueba son válidos', () => {
  expect(() => loadFrentes()).not.toThrow();
  expect(() => loadFrentes('tests/fixtures/frentes-prueba.json')).not.toThrow();
});
