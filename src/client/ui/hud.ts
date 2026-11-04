// HUD: la mira en el centro, con F3 los fps y los draw calls, y lo de la partida (spec 2a §7):
// - abajo a la izquierda, vida y chaleco en barras con números, y los botiquines;
// - abajo a la derecha, el arma en la mano, cargador / total de esa munición y las dos ranuras;
// - arriba al centro, la fase de la zona con su reloj y "Quedan N"; afuera de la zona, una flecha con la distancia;
// - en el centro, la mira que se abre con la dispersión, la marca de acierto (distinta en la cabeza), los números de
//   daño flotando desde el punto del impacto y, debajo, "E: juntar…" (o, apagado, por qué no se puede juntar lo que
//   se mira) y "Recargando…" / "Curando…" / "R: recargar" / "Sin munición";
// - el feed de eliminaciones y, apuntando con el francotirador, la mira telescópica.
// Todo es DOM: se reescribe un texto o un estilo solo cuando cambia.
import { spreadFor, WEAPONS } from '../../shared/combat.ts';
import type { AmmoId, WeaponId } from '../../shared/combat.ts';
import type { Vec3 } from '../../shared/geo.ts';
import type { LootItem } from '../../shared/loot.ts';
import { canTake, MATCH, nearestDrop } from '../../shared/match.ts';
import type { MatchState } from '../../shared/match.ts';
import { zoneAt } from '../../shared/zone.ts';
import type { CombatFrame } from '../combat/types.ts';

/** Cada cuántos ms se reescribe el texto de F3 (escribir en el DOM en cada cuadro no hace falta). */
const STATS_REFRESH_MS = 250;
/** Ventana del promedio de fps. */
const FPS_WINDOW_MS = 1000;
/** Lo que dura la marca de acierto (ms). */
const HITMARK_MS = 220;
/** Números de daño: cuánto duran (ms), cuánto suben (m) y cuántos a la vez como mucho. */
const DMG_MS = 900;
const DMG_RISE = 0.6;
const DMG_MAX = 16;
/** Feed de eliminaciones: cuánto dura cada línea (ms) y cuántas a la vez. */
const FEED_MS = 5000;
const FEED_MAX = 4;
/** Separación mínima de los brazos de la mira (px). */
const GAP_MIN = 3;

export const WEAPON_LABEL: Record<WeaponId, string> = { pistola: 'Pistola', escopeta: 'Escopeta', rifle: 'Rifle', francotirador: 'Francotirador' };
const AMMO_LABEL: Record<AmmoId, string> = { liviana: 'munición liviana', cartuchos: 'cartuchos', pesada: 'munición pesada' };

/** Cómo se nombra un objeto del piso en "E: juntar…". */
export function itemLabel(item: LootItem): string {
  switch (item.kind) {
    case 'arma': return WEAPON_LABEL[item.weapon].toLowerCase();
    case 'municion': return AMMO_LABEL[item.ammo];
    case 'chaleco': return 'chaleco';
    case 'botiquin': return 'botiquín';
  }
}

const AMMO_FULL: Record<AmmoId, string> = { liviana: 'Munición liviana: llena', cartuchos: 'Cartuchos: llenos', pesada: 'Munición pesada: llena' };

/** El cartel apagado de un objeto que no sirve juntar porque ya se tiene el máximo (ver canTake). */
export function fullLabel(item: LootItem): string {
  switch (item.kind) {
    case 'municion': return AMMO_FULL[item.ammo];
    case 'chaleco': return 'Chaleco: lleno';
    case 'botiquin': return `Botiquines: llenos (${MATCH.medkitsMax})`;
    case 'arma': return `E: juntar ${itemLabel(item)}`; // un arma siempre se puede juntar
  }
}

/** Segundos → m:ss (para arriba: 0,2 s todavía es 0:01). */
export function clock(secs: number): string {
  const s = Math.max(0, Math.ceil(secs - 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** fps promediados sobre el último segundo de cuadros. */
export class FpsMeter {
  private times: number[] = [];

  tick(now: number): void {
    this.times.push(now);
    while (this.times.length > 2 && now - this.times[0] > FPS_WINDOW_MS) this.times.shift();
  }

  get fps(): number {
    const n = this.times.length;
    if (n < 2) return 0;
    const span = this.times[n - 1] - this.times[0];
    return span > 0 ? ((n - 1) * 1000) / span : 0;
  }
}

/** Lo que el HUD necesita de un cuadro de la partida, además de lo que reciben las vistas del combate. */
export interface HudFrame extends CombatFrame {
  /** fov vertical de la cámara (grados): la mira se abre según cuánto ocupa la dispersión en pantalla. */
  fov: number;
  /** Apuntando con la mira telescópica (el arma en mano no se dibuja): se ve la mira del francotirador. */
  scoped: boolean;
  /** Un punto del mundo en píxeles de la pantalla, o null si queda detrás de la cámara. */
  project(p: Vec3): [number, number] | null;
}

export interface Hud {
  toggleStats(): void;
  update(now: number, fps: number, drawCalls: number): void;
  /** Lo de la partida, una vez por cuadro. null = sin partida (modo paseo, benchmark): solo queda la mira. */
  combat(f: HudFrame | null): void;
  /** Partida nueva: borra el feed, los números de daño y la marca de acierto. */
  clear(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, testid?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (testid) e.dataset.testid = testid;
  return e;
}

/** Escribe solo si cambió. */
function setText(e: HTMLElement, s: string): void {
  if (e.textContent !== s) e.textContent = s;
}
function setHidden(e: HTMLElement, hidden: boolean): void {
  if (e.hidden !== hidden) e.hidden = hidden;
}
function setStyle(e: HTMLElement, prop: string, value: string): void {
  if (e.style.getPropertyValue(prop) !== value) e.style.setProperty(prop, value);
}

interface Floater { el: HTMLElement; point: Vec3; born: number }
interface FeedLine { el: HTMLElement; born: number }

export function createHud(root: HTMLElement): Hud {
  // la mira: cuatro brazos separados por --gap
  const crosshair = el('div', 'crosshair');
  crosshair.append(el('i'), el('i'), el('i'), el('i'));
  const stats = el('div', 'stats', 'hud-stats');
  stats.hidden = true;

  const hud = el('div', 'match-hud');
  hud.hidden = true;
  const scope = el('div', 'scope', 'hud-mira-telescopica');
  scope.hidden = true;
  const hitmark = el('div', 'hitmarker', 'hud-acierto');
  hitmark.append(el('i'), el('i'), el('i'), el('i'));
  hitmark.hidden = true;
  const dmgLayer = el('div', 'dmg-layer', 'hud-dano');

  const top = el('div', 'hud-top');
  const zone = el('div', 'zone', 'hud-zona');
  const alive = el('div', 'alive', 'hud-quedan');
  top.append(zone, alive);
  const arrowBox = el('div', 'zone-arrow', 'hud-flecha');
  const arrow = el('div', 'arrow');
  const arrowText = el('span');
  arrowBox.append(arrow, arrowText);
  arrowBox.hidden = true;

  const prompt = el('div', 'prompt', 'hud-juntar');
  const status = el('div', 'status', 'hud-estado');
  const feed = el('div', 'feed', 'hud-feed');

  const vitals = el('div', 'vitals');
  const bar = (cls: string, testid: string): { fill: HTMLElement; num: HTMLElement } => {
    const row = el('div', `bar ${cls}`);
    const fill = el('div', 'fill');
    const num = el('span', 'num', testid);
    row.append(fill, num);
    vitals.append(row);
    return { fill, num };
  };
  const hp = bar('hp', 'hud-vida');
  const armor = bar('armor', 'hud-chaleco');
  const medkits = el('div', 'medkits', 'hud-botiquines');
  vitals.append(medkits);

  const weapon = el('div', 'weapon');
  const weaponName = el('div', 'name', 'hud-arma');
  const ammo = el('div', 'ammo', 'hud-municion');
  const slots = el('div', 'slots', 'hud-ranuras');
  const slotEls = [el('span'), el('span')];
  slots.append(...slotEls);
  weapon.append(weaponName, ammo, slots);

  hud.append(scope, dmgLayer, hitmark, top, arrowBox, prompt, status, feed, vitals, weapon);
  root.append(hud, crosshair, stats);

  let lastWrite = -Infinity;
  let hitUntil = -Infinity;
  const floaters: Floater[] = [];
  const lines: FeedLine[] = [];

  function clear(): void {
    for (const f of floaters) f.el.remove();
    floaters.length = 0;
    for (const l of lines) l.el.remove();
    lines.length = 0;
    hitUntil = -Infinity;
    hitmark.hidden = true;
  }

  /** Marca de acierto, números de daño (uno por blanco y por cuadro: los perdigones se suman) y feed. */
  function onEvents(f: HudFrame): void {
    const byTarget = new Map<string, { dmg: number; head: boolean; point: Vec3 }>();
    for (const e of f.events) {
      if (e.type === 'hit') {
        const t = byTarget.get(e.id);
        if (t) {
          t.dmg += e.dmg;
          t.head ||= e.part === 'cabeza';
        } else {
          byTarget.set(e.id, { dmg: e.dmg, head: e.part === 'cabeza', point: e.point });
        }
      } else if (e.type === 'kill') {
        const line = el('div');
        line.textContent = `Eliminaste a ${e.name}`;
        feed.append(line);
        lines.push({ el: line, born: f.now });
        if (lines.length > FEED_MAX) lines.shift()!.el.remove();
      }
    }
    if (byTarget.size === 0) return;
    const head = [...byTarget.values()].some((t) => t.head);
    hitUntil = f.now + HITMARK_MS;
    hitmark.classList.toggle('head', head);
    for (const t of byTarget.values()) {
      const n = el('div', t.head ? 'dmg head' : 'dmg');
      n.textContent = String(Math.round(t.dmg));
      dmgLayer.append(n);
      floaters.push({ el: n, point: t.point, born: f.now });
      if (floaters.length > DMG_MAX) floaters.shift()!.el.remove();
    }
  }

  /** Los números de daño suben y se apagan; la marca de acierto y las líneas del feed vencen. */
  function drawTransient(f: HudFrame): void {
    for (let i = floaters.length - 1; i >= 0; i--) {
      const d = floaters[i];
      const k = (f.now - d.born) / DMG_MS;
      if (k >= 1) {
        d.el.remove();
        floaters.splice(i, 1);
        continue;
      }
      const at = f.project([d.point[0], d.point[1] + DMG_RISE * Math.max(0, k), d.point[2]]);
      setHidden(d.el, at === null);
      if (!at) continue;
      setStyle(d.el, 'transform', `translate(${Math.round(at[0])}px, ${Math.round(at[1])}px)`);
      setStyle(d.el, 'opacity', Math.min(1, (1 - k) / 0.4).toFixed(2)); // se apaga en el último 40 %
    }
    while (lines.length > 0 && f.now - lines[0].born >= FEED_MS) lines.shift()!.el.remove();
    setHidden(hitmark, f.now >= hitUntil);
  }

  function drawVitals(s: MatchState): void {
    const v = s.me.vitals;
    setText(hp.num, String(Math.ceil(v.hp))); // con 0,3 de vida todavía se está vivo: no mostrar 0
    setStyle(hp.fill, 'width', `${Math.max(0, Math.min(100, (v.hp / MATCH.hpMax) * 100)).toFixed(1)}%`);
    setText(armor.num, String(Math.round(v.armor)));
    setStyle(armor.fill, 'width', `${Math.max(0, Math.min(100, (v.armor / MATCH.armorMax) * 100)).toFixed(1)}%`);
    setHidden(medkits, s.inv.medkits === 0);
    setText(medkits, `Botiquines: ${s.inv.medkits} (H)`);
  }

  function drawWeapon(s: MatchState): void {
    const gun = s.inv.slots[s.inv.active];
    setText(weaponName, gun ? WEAPON_LABEL[gun.id] : 'Sin arma');
    setHidden(ammo, !gun);
    if (gun) setText(ammo, `${gun.inMag} / ${s.inv.ammo[WEAPONS[gun.id].ammo]}`);
    slotEls.forEach((e, i) => {
      const g = s.inv.slots[i];
      setText(e, `${i + 1} ${g ? WEAPON_LABEL[g.id] : '—'}`);
      e.classList.toggle('active', i === s.inv.active);
    });
  }

  function drawZone(f: HudFrame): void {
    const s = f.state;
    const z = zoneAt(s.zone, s.t);
    setText(zone, z.r <= 0 ? 'Zona cerrada'
      : z.shrinking ? `Fase ${z.phase} · achicándose ${clock(z.nextAt - s.t)}`
        : `Fase ${z.phase} · se achica en ${clock(z.nextAt - s.t)}`);
    const left = (s.me.alive ? 1 : 0) + s.dummies.filter((d) => d.alive).length;
    setText(alive, `Quedan ${left}`);

    // afuera: flecha hacia el centro (0° = adelante, positivo = a la derecha) y distancia al borde
    const p = s.me.player.pos;
    const dx = z.center[0] - p[0], dz = z.center[1] - p[2];
    const out = Math.hypot(dx, dz) - z.r;
    setHidden(arrowBox, !(z.r > 0 && out > 0));
    if (arrowBox.hidden) return;
    const sy = Math.sin(f.cam.yaw), cy = Math.cos(f.cam.yaw);
    const ahead = -dx * sy - dz * cy, right = dx * cy - dz * sy;
    setStyle(arrow, 'transform', `rotate(${Math.round((Math.atan2(right, ahead) * 180) / Math.PI)}deg)`);
    setText(arrowText, `Zona a ${Math.ceil(out)} m`);
  }

  function drawCenter(f: HudFrame): void {
    const s = f.state;
    const gun = s.inv.slots[s.inv.active];
    // la mira: el cono de la dispersión en píxeles con el fov de ahora
    let gap = GAP_MIN;
    if (gun) {
      const v = s.me.player.vel;
      const spread = spreadFor(WEAPONS[gun.id], { aiming: s.aiming, moving: Math.hypot(v[0], v[1], v[2]) > MATCH.movingSpeed });
      const k = Math.tan((spread * Math.PI) / 180) / Math.tan((f.fov * Math.PI) / 360);
      gap = Math.max(GAP_MIN, k * (window.innerHeight / 2));
    }
    setStyle(crosshair, '--gap', `${gap.toFixed(1)}px`);
    setHidden(crosshair, f.scoped);
    setHidden(scope, !f.scoped);

    // lo que juntaría E; si al alcance no hay nada que sirva juntar, apagado, por qué no se puede juntar lo que se mira
    const drop = nearestDrop(s) ?? nearestDrop(s, { all: true });
    setHidden(prompt, !drop);
    if (drop) {
      const take = canTake(s, drop);
      setText(prompt, take ? `E: juntar ${itemLabel(drop.item)}` : fullLabel(drop.item));
      prompt.classList.toggle('full', !take);
    }
    const st = gun && gun.reloadUntil !== null ? 'Recargando…'
      : s.inv.healingUntil !== null ? 'Curando…'
        : gun && gun.inMag <= 0 ? (s.inv.ammo[WEAPONS[gun.id].ammo] > 0 ? 'R: recargar' : 'Sin munición')
          : '';
    setHidden(status, st === '');
    setText(status, st);
  }

  return {
    toggleStats() {
      stats.hidden = !stats.hidden;
      lastWrite = -Infinity;
    },
    update(now, fps, drawCalls) {
      if (stats.hidden || now - lastWrite < STATS_REFRESH_MS) return;
      lastWrite = now;
      stats.textContent = `${Math.round(fps)} fps · ${drawCalls} draw calls`;
    },
    combat(f) {
      setHidden(hud, f === null);
      if (!f) {
        setStyle(crosshair, '--gap', `${GAP_MIN}px`);
        setHidden(crosshair, false);
        return;
      }
      onEvents(f);
      drawTransient(f);
      drawVitals(f.state);
      drawWeapon(f.state);
      drawZone(f);
      drawCenter(f);
    },
    clear,
  };
}
