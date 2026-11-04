import { ZONE_PHASES, ZONE_TOTAL, planZone, zoneAt } from '../../src/shared/zone.ts';

const bounds = { minX: -750, maxX: 750, minZ: -437, maxZ: 437 };

describe('zona', () => {
  it('ZONE_TOTAL es 720 s', () => {
    expect(ZONE_TOTAL).toBe(720);
  });

  it('en t=0 es el círculo inicial, fase 1, quieto', () => {
    const plan = planZone(bounds, 12, 1);
    const z = zoneAt(plan, 0);
    expect(z.r).toBe(plan.r0);
    expect(z.phase).toBe(1);
    expect(z.shrinking).toBe(false);
    expect(z.nextAt).toBe(120);
    expect(zoneAt(plan, -5)).toEqual(z);
  });

  it('a mitad de un cierre el radio y el centro están en el medio', () => {
    const plan = planZone(bounds, 12, 7);
    const z = zoneAt(plan, 120 + 45);
    expect(z.shrinking).toBe(true);
    expect(z.nextAt).toBe(210);
    expect(z.r).toBeCloseTo((plan.r0 + plan.circles[0].r) / 2, 9);
    expect(z.center[0]).toBeCloseTo((plan.center0[0] + plan.circles[0].center[0]) / 2, 9);
    expect(z.center[1]).toBeCloseTo((plan.center0[1] + plan.circles[0].center[1]) / 2, 9);
    // durante la espera de la fase 2 es el círculo 1
    const w = zoneAt(plan, 210 + 10);
    expect(w.phase).toBe(2);
    expect(w.shrinking).toBe(false);
    expect(w.r).toBeCloseTo(plan.circles[0].r, 9);
    expect(w.dps).toBe(2);
  });

  it('en t=720 está cerrada: radio 0, fase 6, 10 de daño', () => {
    const plan = planZone(bounds, 12, 3);
    const z = zoneAt(plan, 720);
    expect(z.r).toBe(0);
    expect(z.phase).toBe(6);
    expect(z.dps).toBe(10);
    expect(zoneAt(plan, 5000).r).toBe(0);
  });

  it('dps de la fase 5 es 10 y los radios finales siguen la tabla', () => {
    expect(ZONE_PHASES[4].dps).toBe(10);
    const plan = planZone(bounds, 12, 3);
    ZONE_PHASES.forEach((p, i) => expect(plan.circles[i].r).toBeCloseTo(plan.r0 * p.radius, 9));
  });

  it('con 2 jugadores r0 es el 40,8 % del de 12', () => {
    const r2 = planZone(bounds, 2, 1).r0;
    const r12 = planZone(bounds, 12, 1).r0;
    expect(r2 / r12).toBeCloseTo(Math.sqrt(2 / 12) / 1, 3);
    expect(r2 / r12).toBeCloseTo(0.408, 3);
  });

  it('100 semillas × 2..24 jugadores: cada círculo entero dentro del anterior y con el centro en bounds', () => {
    for (let seed = 0; seed < 100; seed++) {
      for (let players = 2; players <= 24; players++) {
        const plan = planZone(bounds, players, seed);
        let pc = plan.center0, pr = plan.r0;
        for (const c of plan.circles) {
          expect(Math.hypot(c.center[0] - pc[0], c.center[1] - pc[1]) + c.r).toBeLessThanOrEqual(pr + 1e-9);
          expect(c.center[0]).toBeGreaterThanOrEqual(bounds.minX);
          expect(c.center[0]).toBeLessThanOrEqual(bounds.maxX);
          expect(c.center[1]).toBeGreaterThanOrEqual(bounds.minZ);
          expect(c.center[1]).toBeLessThanOrEqual(bounds.maxZ);
          pc = c.center; pr = c.r;
        }
      }
    }
  });

  it('es determinista por semilla', () => {
    expect(planZone(bounds, 12, 9)).toEqual(planZone(bounds, 12, 9));
    expect(planZone(bounds, 12, 9)).not.toEqual(planZone(bounds, 12, 10));
  });
});
