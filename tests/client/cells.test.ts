import * as THREE from 'three';
import { CELL, partitionByCell, splitByCell } from '../../src/client/world/cells.ts';
import type { Vec2 } from '../../src/shared/geo.ts';

/** Puntos repartidos por varias celdas, con algunos justo en los bordes y en coordenadas negativas. */
const points: Vec2[] = [
  [10, 10], [-10, 10], [260, -5], [249.99, 0], [250, 0], [-250, -250], [-250.01, 3], [0, 0], [600, 600], [12, 240],
  ...Array.from({ length: 200 }, (_, i): Vec2 => [((i * 37) % 900) - 450, ((i * 53) % 700) - 350]),
];
const cellOf = ([x, z]: Vec2, size = CELL): string => `${Math.floor(x / size)},${Math.floor(z / size)}`;

describe('partitionByCell', () => {
  test('cada índice cae en exactamente una celda, la de su punto', () => {
    const groups = partitionByCell(points);
    const seen = groups.flat().sort((a, b) => a - b);
    expect(seen).toEqual(points.map((_, i) => i));
    for (const g of groups) {
      expect(g.length).toBeGreaterThan(0);
      expect(new Set(g.map((i) => cellOf(points[i]))).size).toBe(1);
    }
    // celdas distintas en grupos distintos
    expect(new Set(groups.map((g) => cellOf(points[g[0]]))).size).toBe(groups.length);
  });

  test('los bordes van a la celda de arriba (floor), también con negativos', () => {
    const groups = partitionByCell(points);
    const groupOf = (i: number): number[] => groups.find((g) => g.includes(i))!;
    expect(groupOf(3)).not.toContain(4); // 249,99 y 250 en celdas distintas
    expect(groupOf(0)).toContain(7); // (10, 10) y (0, 0): celda 0,0
    expect(groupOf(1)).not.toContain(0); // −10 es la celda −1
    expect(groupOf(5)).not.toContain(6); // −250 es la celda −1; −250,01, la −2
  });

  test('conserva el orden de entrada dentro de cada celda y es determinista', () => {
    const groups = partitionByCell(points);
    for (const g of groups) expect(g).toEqual([...g].sort((a, b) => a - b));
    expect(partitionByCell(points)).toEqual(groups);
  });

  test('el lado de la celda es configurable', () => {
    expect(partitionByCell([[0, 0], [99, 99], [100, 0]], 100)).toEqual([[0, 1], [2]]);
    expect(partitionByCell([])).toEqual([]);
  });
});

describe('splitByCell', () => {
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  geometry.setAttribute('slot', new THREE.InstancedBufferAttribute(Float32Array.from(points, (_, i) => i % 3), 1));
  const material = new THREE.MeshLambertMaterial();
  const depth = new THREE.MeshDepthMaterial();
  const source = new THREE.InstancedMesh(geometry, material, points.length);
  source.name = 'prueba';
  source.castShadow = true;
  source.receiveShadow = true;
  source.customDepthMaterial = depth;
  source.userData.extra = 'x';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  points.forEach(([x, z], i) => {
    source.setMatrixAt(i, m.compose(new THREE.Vector3(x, i * 0.01, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i), s));
    source.setColorAt(i, new THREE.Color(i / points.length, 0.5, 0.25));
  });
  source.count = 7; // ya recortada: igual se parten todas las instancias que tiene
  const parts = splitByCell(source);

  test('una malla por celda; entre todas, cada instancia una vez, con su matriz y su color', () => {
    expect(parts).toHaveLength(partitionByCell(points).length);
    const all = parts.flatMap((p) => Array.from(p.userData.instances as Uint32Array));
    expect(all.sort((a, b) => a - b)).toEqual(points.map((_, i) => i));
    const a = new THREE.Matrix4(), b = new THREE.Matrix4(), ca = new THREE.Color(), cb = new THREE.Color();
    for (const p of parts) {
      const idx = p.userData.instances as Uint32Array;
      expect(p.count).toBe(idx.length);
      const cells = new Set<string>();
      idx.forEach((src, k) => {
        p.getMatrixAt(k, a);
        source.getMatrixAt(src, b);
        expect(a.equals(b)).toBe(true);
        p.getColorAt(k, ca);
        source.getColorAt(src, cb);
        expect(ca.equals(cb)).toBe(true);
        cells.add(cellOf(points[src]));
      });
      expect(cells.size).toBe(1);
    }
  });

  test('misma geometría (compartida), material, nombre, sombras y userData', () => {
    for (const p of parts) {
      expect(p.material).toBe(material);
      expect(p.name).toBe('prueba');
      expect(p.castShadow).toBe(true);
      expect(p.receiveShadow).toBe(true);
      expect(p.customDepthMaterial).toBe(depth);
      expect(p.userData.extra).toBe('x');
      expect(p.geometry.getAttribute('position')).toBe(geometry.getAttribute('position'));
      expect(p.geometry.index).toBe(geometry.index);
    }
  });

  test('los atributos por instancia de la geometría se parten igual que las matrices', () => {
    for (const p of parts) {
      const slot = p.geometry.getAttribute('slot') as THREE.InstancedBufferAttribute;
      expect(slot).toBeInstanceOf(THREE.InstancedBufferAttribute);
      expect(slot).not.toBe(geometry.getAttribute('slot'));
      const idx = p.userData.instances as Uint32Array;
      expect(slot.count).toBe(idx.length);
      idx.forEach((src, k) => expect(slot.getX(k)).toBe(src % 3));
    }
  });

  test('sin atributos por instancia se comparte la misma geometría', () => {
    const plain = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 2);
    plain.setMatrixAt(1, new THREE.Matrix4().makeTranslation(300, 0, 0));
    const [p0, p1] = splitByCell(plain);
    expect(p0.geometry).toBe(plain.geometry);
    expect(p1.geometry).toBe(plain.geometry);
    expect(p0.instanceColor).toBeNull();
  });
});
