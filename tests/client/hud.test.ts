// @vitest-environment jsdom
// El HUD de la partida: vida, chaleco, munición, ranuras, zona, "Quedan N", cartel de juntar, marca de acierto, números
// de daño, feed de eliminaciones, flecha hacia la zona y mira telescópica. Se arma con estados de verdad de newMatch.
import { createHud } from '../../src/client/ui/hud.ts';
import type { Hud, HudFrame } from '../../src/client/ui/hud.ts';
import { CollisionWorld } from '../../src/shared/collision.ts';
import { newGun } from '../../src/shared/combat.ts';
import type { WeaponId } from '../../src/shared/combat.ts';
import type { Vec3 } from '../../src/shared/geo.ts';
import type { MapData } from '../../src/shared/mapdata.ts';
import { nearestDrop, newMatch } from '../../src/shared/match.ts';
import type { MatchEvent, MatchState } from '../../src/shared/match.ts';
import { initialState } from '../../src/shared/player.ts';
import { zoneAt } from '../../src/shared/zone.ts';

// Mapa mínimo de 400 × 400 m, sin edificios, con 24 puntos de aparición en fila.
const bounds = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
const map: MapData = {
  version: 1, origin: { lat: 0, lon: 0 }, bounds, buildings: [], outskirts: [], roads: [], railways: [], platforms: [],
  parks: [], places: [], signs: [], props: [], trees: [],
  randomSpawns: Array.from({ length: 24 }, (_, i) => [-115 + 10 * i, 0, 50] as Vec3),
  lootSpots: [],
};
const world = new CollisionWorld([], [], bounds);

let root: HTMLElement;
let hud: Hud;

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  hud = createHud(root);
});

/** Copia modificada (el estado es datos). */
function mod(s: MatchState, f: (c: MatchState) => void): MatchState {
  const c = structuredClone(s);
  f(c);
  return c;
}
const start = (dummies = 11): MatchState => newMatch(map, world, { seed: 1, dummies });
/** Con el jugador en el origen, quieto, mirando a −z. */
const atOrigin = (s: MatchState): MatchState => mod(s, (c) => {
  c.me.player = initialState([0, 0, 0]);
  c.look = { yaw: 0, pitch: 0 };
});
const armed = (s: MatchState, weapon: WeaponId, reserve: number): MatchState => mod(s, (c) => {
  c.inv.slots[0] = newGun(weapon);
  c.inv.ammo.liviana = reserve;
});

function frame(state: MatchState, over: Partial<HudFrame> = {}): HudFrame {
  const p = state.me.player.pos;
  return {
    state, cam: { pos: [p[0], p[1] + 1.65, p[2]], yaw: state.look.yaw, pitch: state.look.pitch }, now: 1000, events: [],
    fov: 75, scoped: false, project: () => [400, 300], ...over,
  };
}

const byId = (id: string): HTMLElement => {
  const e = root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!e) throw new Error(`no hay [data-testid="${id}"]`);
  return e;
};
/** Visible = ni él ni ningún ancestro con hidden. */
function shown(id: string): boolean {
  for (let e: HTMLElement | null = byId(id); e; e = e.parentElement) if (e.hidden) return false;
  return true;
}
const text = (id: string): string => byId(id).textContent ?? '';

test('al empezar muestra vida 100 y chaleco 0', () => {
  hud.combat(frame(start()));
  expect(shown('hud-vida')).toBe(true);
  expect(text('hud-vida')).toBe('100');
  expect(text('hud-chaleco')).toBe('0');
});

test('con el rifle muestra 30 / 30, el arma en las ranuras y "Quedan 12" con 11 maniquíes', () => {
  const s = armed(start(11), 'rifle', 30);
  hud.combat(frame(s));
  expect(text('hud-municion')).toBe('30 / 30');
  expect(text('hud-arma')).toBe('Rifle');
  expect(text('hud-ranuras')).toBe('1 Rifle2 —');
  expect(byId('hud-ranuras').querySelector('.active')?.textContent).toBe('1 Rifle');
  expect(text('hud-quedan')).toBe('Quedan 12');
  // un maniquí menos
  hud.combat(frame(mod(s, (c) => {
    c.dummies[3].alive = false;
  })));
  expect(text('hud-quedan')).toBe('Quedan 11');
});

test('sin arma no hay munición', () => {
  hud.combat(frame(start()));
  expect(text('hud-arma')).toBe('Sin arma');
  expect(shown('hud-municion')).toBe(false);
});

test('el cartel "E: juntar escopeta" aparece cuando nearestDrop es una escopeta', () => {
  const base = atOrigin(start());
  const s = mod(base, (c) => {
    c.look = { yaw: 0, pitch: -0.7 }; // mirando abajo y adelante (−z)
    c.drops = [{ id: 1, pos: [0, 0, -1.5], item: { kind: 'arma', weapon: 'escopeta' } }];
  });
  expect(nearestDrop(s)?.item).toEqual({ kind: 'arma', weapon: 'escopeta' });
  hud.combat(frame(s));
  expect(shown('hud-juntar')).toBe(true);
  expect(text('hud-juntar')).toBe('E: juntar escopeta');
  // sin nada cerca, no hay cartel
  hud.combat(frame(mod(s, (c) => {
    c.drops = [];
  })));
  expect(shown('hud-juntar')).toBe(false);
});

test('el cartel nombra la munición, el chaleco y el botiquín', () => {
  const s = mod(atOrigin(start()), (c) => {
    c.drops = [{ id: 1, pos: [0, 0, -0.5], item: { kind: 'municion', ammo: 'cartuchos' } }]; // a menos de 1 m: sin mirar
  });
  hud.combat(frame(s));
  expect(text('hud-juntar')).toBe('E: juntar cartuchos');
  hud.combat(frame(mod(s, (c) => {
    c.drops[0].item = { kind: 'botiquin' };
  })));
  expect(text('hud-juntar')).toBe('E: juntar botiquín');
});

test('"Recargando…" mientras recarga', () => {
  const s = mod(armed(start(), 'rifle', 30), (c) => {
    c.inv.slots[0]!.inMag = 3;
    c.inv.slots[0]!.reloadUntil = c.t + 2;
  });
  hud.combat(frame(s));
  expect(shown('hud-estado')).toBe(true);
  expect(text('hud-estado')).toBe('Recargando…');
  expect(text('hud-municion')).toBe('3 / 30');
});

test('marca de acierto: aparece con el impacto, distinta en la cabeza, y se va', () => {
  const s = start();
  const hit = (part: 'cabeza' | 'cuerpo'): MatchEvent => ({ type: 'hit', id: 'm1', part, dmg: 20, point: [0, 1, -8] });
  expect(shown('hud-acierto')).toBe(false);
  hud.combat(frame(s, { now: 1000, events: [hit('cuerpo')] }));
  expect(shown('hud-acierto')).toBe(true);
  expect(byId('hud-acierto').classList.contains('head')).toBe(false);
  hud.combat(frame(s, { now: 1050, events: [hit('cuerpo'), hit('cabeza')] }));
  expect(byId('hud-acierto').classList.contains('head')).toBe(true);
  hud.combat(frame(s, { now: 2000 }));
  expect(shown('hud-acierto')).toBe(false);
});

test('número de daño flotante en el punto del impacto proyectado; los perdigones de un cuadro se suman', () => {
  const s = start();
  const point: Vec3 = [3, 1.2, -10];
  const project = vi.fn((p: Vec3): [number, number] | null => (p[0] === 3 ? [123, 45 - (p[1] - 1.2) * 10] : null));
  const pellet = (dmg: number, part: 'cabeza' | 'cuerpo'): MatchEvent => ({ type: 'hit', id: 'm2', part, dmg, point });
  hud.combat(frame(s, { now: 1000, events: [pellet(10, 'cuerpo'), pellet(10, 'cabeza'), pellet(8, 'cuerpo')], project }));
  const nums = [...byId('hud-dano').children] as HTMLElement[];
  expect(nums).toHaveLength(1);
  expect(nums[0].textContent).toBe('28');
  expect(nums[0].classList.contains('head')).toBe(true);
  expect(nums[0].style.transform).toBe('translate(123px, 45px)');
  expect(project).toHaveBeenCalledWith(point);
  // sube con el tiempo y desaparece
  hud.combat(frame(s, { now: 1400, project }));
  const y = Number(/translate\(123px, (-?[\d.]+)px\)/.exec(nums[0].style.transform)![1]);
  expect(y).toBeLessThan(45);
  hud.combat(frame(s, { now: 3000, project }));
  expect(byId('hud-dano').children).toHaveLength(0);
});

test('un impacto detrás de la cámara no muestra el número', () => {
  hud.combat(frame(start(), { events: [{ type: 'hit', id: 'm1', part: 'cuerpo', dmg: 20, point: [0, 1, 8] }], project: () => null }));
  const n = byId('hud-dano').firstElementChild as HTMLElement;
  expect(n.hidden).toBe(true);
});

test('feed: "Eliminaste a Maniquí 4", que se va solo y con clear()', () => {
  const s = start();
  hud.combat(frame(s, { now: 1000, events: [{ type: 'kill', id: 'm4', name: 'Maniquí 4' }] }));
  expect(text('hud-feed')).toBe('Eliminaste a Maniquí 4');
  hud.combat(frame(s, { now: 2000, events: [{ type: 'kill', id: 'm5', name: 'Maniquí 5' }] }));
  expect([...byId('hud-feed').children].map((e) => e.textContent)).toEqual(['Eliminaste a Maniquí 4', 'Eliminaste a Maniquí 5']);
  hud.combat(frame(s, { now: 6500 }));
  expect([...byId('hud-feed').children].map((e) => e.textContent)).toEqual(['Eliminaste a Maniquí 5']);
  hud.clear();
  expect(byId('hud-feed').children).toHaveLength(0);
});

test('zona: la fase y el reloj hasta el próximo cambio', () => {
  const s = start();
  hud.combat(frame(s));
  expect(text('hud-zona')).toBe('Fase 1 · se achica en 2:00');
  hud.combat(frame(mod(s, (c) => {
    c.t = 150.2;
  })));
  expect(text('hud-zona')).toBe('Fase 1 · achicándose 1:00');
  hud.combat(frame(mod(s, (c) => {
    c.t = 800;
  })));
  expect(text('hud-zona')).toBe('Zona cerrada');
});

test('afuera de la zona, una flecha hacia ella con la distancia al borde', () => {
  const s = start();
  const z = zoneAt(s.zone, 0);
  // al este del centro, 40 m afuera del borde, mirando al norte (−z): la zona queda a la izquierda (−90°)
  const outside = mod(s, (c) => {
    c.me.player = initialState([z.center[0] + z.r + 40, 0, z.center[1]]);
    c.look = { yaw: 0, pitch: 0 };
  });
  hud.combat(frame(outside));
  expect(shown('hud-flecha')).toBe(true);
  expect(text('hud-flecha')).toContain('40 m');
  const arrow = byId('hud-flecha').querySelector<HTMLElement>('.arrow')!;
  expect(arrow.style.transform).toBe('rotate(-90deg)');
  // adentro, no hay flecha
  hud.combat(frame(mod(outside, (c) => {
    c.me.player = initialState([z.center[0], 0, z.center[1]]);
  })));
  expect(shown('hud-flecha')).toBe(false);
});

test('la mira se abre con la dispersión: más moviéndose que quieto, menos apuntando', () => {
  const crosshair = root.querySelector<HTMLElement>('.crosshair')!;
  const gap = (): number => parseFloat(crosshair.style.getPropertyValue('--gap'));
  const s = armed(start(), 'rifle', 30);
  hud.combat(frame(s));
  const still = gap();
  hud.combat(frame(mod(s, (c) => {
    c.me.player.vel = [6, 0, 0];
  })));
  const moving = gap();
  hud.combat(frame(mod(s, (c) => {
    c.aiming = true;
  }), { fov: 55 }));
  const aiming = gap();
  expect(moving).toBeGreaterThan(still * 2);
  expect(aiming).toBeLessThan(still);
});

test('con la mira telescópica se ve la mira del francotirador y no la cruz', () => {
  const s = armed(start(), 'francotirador', 0);
  hud.combat(frame(s, { scoped: true, fov: 20 }));
  expect(shown('hud-mira-telescopica')).toBe(true);
  expect(root.querySelector<HTMLElement>('.crosshair')!.hidden).toBe(true);
  hud.combat(frame(s));
  expect(shown('hud-mira-telescopica')).toBe(false);
  expect(root.querySelector<HTMLElement>('.crosshair')!.hidden).toBe(false);
});

test('botiquines: se muestran cuando hay', () => {
  const s = start();
  hud.combat(frame(s));
  expect(shown('hud-botiquines')).toBe(false);
  hud.combat(frame(mod(s, (c) => {
    c.inv.medkits = 2;
  })));
  expect(text('hud-botiquines')).toBe('Botiquines: 2 (H)');
});

test('"Curando…" mientras usa el botiquín', () => {
  hud.combat(frame(mod(start(), (c) => {
    c.inv.medkits = 1;
    c.inv.healingUntil = c.t + 3;
  })));
  expect(text('hud-estado')).toBe('Curando…');
});

test('sin partida (modo paseo) no se ve nada de la partida, pero sí la mira', () => {
  hud.combat(frame(start()));
  hud.combat(null);
  for (const id of ['hud-vida', 'hud-municion', 'hud-zona', 'hud-quedan', 'hud-juntar', 'hud-flecha']) expect(shown(id), id).toBe(false);
  expect(root.querySelector<HTMLElement>('.crosshair')!.hidden).toBe(false);
});
