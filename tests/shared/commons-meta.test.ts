import { isAcceptedLicense, plain } from '../../tools/commons-meta.ts';

test.each(['CC BY-SA 4.0', 'CC BY-SA 3.0', 'CC BY 2.0', 'CC0', 'Public domain'])('acepta %s', (l) => {
  expect(isAcceptedLicense(l)).toBe(true);
});
test.each(['CC BY-NC 4.0', 'CC BY-ND 2.0', 'CC BY-NC-SA 3.0', 'GFDL', 'CC BY-SA', ''])('rechaza "%s"', (l) => {
  expect(isAcceptedLicense(l)).toBe(false);
});
test('plain saca etiquetas y decodifica entidades', () => {
  expect(plain('<a href="x">O&#39;Brien &amp; &quot;Co&quot;&nbsp;&#x41;</a>')).toBe('O\'Brien & "Co" A');
});
