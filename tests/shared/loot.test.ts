import { WEAPONS } from '../../src/shared/combat.ts';
import type { AmmoId, WeaponId } from '../../src/shared/combat.ts';
import { LOOT_TABLE, WEAPON_TABLE, rollLoot } from '../../src/shared/loot.ts';
import type { Drop, LootItem } from '../../src/shared/loot.ts';
import type { LootSpot, LootTier } from '../../src/shared/mapdata.ts';

const N = 20_000;
const TOL = 1.5; // puntos porcentuales
/** n puntos sintéticos del nivel, separados 10 m sobre x, en la fila z. */
const spotsOf = (tier: LootTier, n = N, y = 0, z = 5): LootSpot[] => Array.from({ length: n }, (_, i) => ({ pos: [i * 10, y, z], tier }));
const pct = (n: number, of: number): number => (100 * n) / of;
const ammoOf = (w: WeaponId): AmmoId => WEAPONS[w].ammo;

/** Cuántos puntos dieron cada tipo: un arma son dos drops (ella y su caja), así que la caja de al lado no cuenta. */
function kindsPerSpot(drops: Drop[], spots: number): Record<LootItem['kind'] | 'nada', number> {
  const out = { nada: 0, arma: 0, municion: 0, chaleco: 0, botiquin: 0 };
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    out[d.item.kind]++;
    if (d.item.kind === 'arma') i++; // su munición
  }
  out.nada = spots - out.arma - out.municion - out.chaleco - out.botiquin;
  return out;
}

describe('tablas del botín (spec 2a §5)', () => {
  test('qué sale en cada nivel', () => {
    expect(LOOT_TABLE.calle).toEqual([['nada', 40], ['arma', 25], ['municion', 20], ['chaleco', 7], ['botiquin', 8]]);
    expect(LOOT_TABLE.techo).toEqual([['nada', 20], ['arma', 35], ['municion', 20], ['chaleco', 13], ['botiquin', 12]]);
    expect(LOOT_TABLE.lugar).toEqual([['nada', 0], ['arma', 50], ['municion', 15], ['chaleco', 20], ['botiquin', 15]]);
  });
  test('qué arma sale: en la calle y en lo alto (techos y lugares)', () => {
    expect(WEAPON_TABLE.calle).toEqual([['pistola', 40], ['escopeta', 30], ['rifle', 22], ['francotirador', 8]]);
    expect(WEAPON_TABLE.alto).toEqual([['pistola', 20], ['escopeta', 25], ['rifle', 35], ['francotirador', 20]]);
  });
  test('cada tabla suma 100', () => {
    for (const t of [...Object.values(LOOT_TABLE), ...Object.values(WEAPON_TABLE)]) expect(t.reduce((s, [, w]) => s + w, 0)).toBe(100);
  });
});

describe('rollLoot', () => {
  const mixed: LootSpot[] = [...spotsOf('calle', 300), ...spotsOf('techo', 200, 7, 15), ...spotsOf('lugar', 36, 0, 25)];

  test('la misma semilla da los mismos drops; otra semilla, otros', () => {
    expect(rollLoot(mixed, 42)).toEqual(rollLoot(mixed, 42));
    expect(rollLoot(mixed, 43)).not.toEqual(rollLoot(mixed, 42));
  });

  test('los id son correlativos desde 1', () => {
    const drops = rollLoot(mixed, 7);
    expect(drops.length).toBeGreaterThan(0);
    expect(drops.map((d) => d.id)).toEqual(drops.map((_, i) => i + 1));
  });

  test('todo arma tiene al lado una caja de su munición, a 0,6 m y a la misma altura', () => {
    const drops = rollLoot(mixed, 7);
    const guns = drops.filter((d) => d.item.kind === 'arma');
    expect(guns.length).toBeGreaterThan(50);
    for (const g of guns) {
      if (g.item.kind !== 'arma') continue;
      const box = drops.find((d) => d.id === g.id + 1)!;
      expect(box.item).toEqual({ kind: 'municion', ammo: ammoOf(g.item.weapon) });
      expect(Math.hypot(box.pos[0] - g.pos[0], box.pos[2] - g.pos[2])).toBeCloseTo(0.6, 9);
      expect(box.pos[1]).toBe(g.pos[1]);
    }
  });

  test('cada objeto queda en su punto (o, la caja de un arma, a 0,6 m del suyo)', () => {
    const drops = rollLoot(mixed, 9);
    for (const d of drops) {
      const near = mixed.filter((s) => Math.hypot(s.pos[0] - d.pos[0], s.pos[2] - d.pos[2]) <= 0.6 + 1e-9 && s.pos[1] === d.pos[1]);
      expect(near, `drop ${d.id}`).toHaveLength(1);
    }
  });

  test(`con ${N} puntos de cada nivel, cada tipo sale en la proporción de la tabla (±${TOL} %)`, () => {
    for (const tier of ['calle', 'techo', 'lugar'] as const) {
      const got = kindsPerSpot(rollLoot(spotsOf(tier), 2026), N);
      for (const [kind, w] of LOOT_TABLE[tier]) expect(Math.abs(pct(got[kind], N) - w), `${tier}/${kind}: ${pct(got[kind], N)} %`).toBeLessThan(TOL);
    }
  });

  test(`el arma y la munición suelta salen del reparto de armas del nivel (±${TOL} %)`, () => {
    for (const [tier, level] of [['calle', 'calle'], ['techo', 'alto'], ['lugar', 'alto']] as const) {
      const drops = rollLoot(spotsOf(tier), 11);
      const guns: WeaponId[] = [];
      const loose: AmmoId[] = [];
      for (let i = 0; i < drops.length; i++) {
        const it = drops[i].item;
        if (it.kind === 'arma') { guns.push(it.weapon); i++; } else if (it.kind === 'municion') loose.push(it.ammo);
      }
      for (const [w, p] of WEAPON_TABLE[level]) {
        const n = guns.filter((g) => g === w).length;
        expect(Math.abs(pct(n, guns.length) - p), `${tier}/${w}: ${pct(n, guns.length)} %`).toBeLessThan(TOL * 2);
      }
      for (const ammo of ['liviana', 'cartuchos', 'pesada'] as const) {
        const want = WEAPON_TABLE[level].filter(([w]) => ammoOf(w) === ammo).reduce((s, [, p]) => s + p, 0);
        const n = loose.filter((a) => a === ammo).length;
        expect(Math.abs(pct(n, loose.length) - want), `${tier}/${ammo}: ${pct(n, loose.length)} %`).toBeLessThan(TOL * 2);
      }
    }
  });

  test('sin puntos no hay botín', () => expect(rollLoot([], 1)).toEqual([]));
});
