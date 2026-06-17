import { BUILDINGS, RES, RES_ICON, modelFor } from './buildings.js';
import { GRID_N } from './config.js';

const START = () => ({
  res: { food: 100, wood: 160, stone: 60, gold: 40 },
  population: 5,
  age: 1,
  buildings: [],   // { id, type, level, cx, cz }
  nextId: 1,
  tElapsed: 0,
  nextRaid: 75,
  raidWarned: false,
  raidCount: 0,
  difficulty: 'normal',
  won: false,
  lost: false,
});

export const state = START();

// Hooks set by main.js (bridge to world + ui + rival).
export const hooks = {
  spawn: () => {}, swap: () => {}, remove: () => {}, clearWorld: () => {},
  onToast: () => {}, onWin: () => {}, onChange: () => {}, onSound: () => {},
  serializeRival: () => null, restoreRival: () => {},
};

const BASE_CAP = { food: 300, wood: 350, stone: 300, gold: 300 };

// Food each person eats per second. Shared with the UI's rate readout so the
// displayed net food rate can never drift from the economy.
export const FOOD_PER_POP = 0.15;

// ---------- derived stats ----------
export function caps() {
  const c = { ...BASE_CAP };
  let bonus = 0;
  for (const b of state.buildings) { const d = BUILDINGS[b.type]; if (d.capBonus) bonus += d.capBonus(b.level); }
  for (const k of RES) c[k] += bonus;
  return c;
}
export function popCap() {
  let cap = 0;
  for (const b of state.buildings) { const d = BUILDINGS[b.type]; if (d.popCap) cap += d.popCap(b.level); }
  return cap;
}
export function might() {
  let m = 0; for (const b of state.buildings) { const d = BUILDINGS[b.type]; if (d.might) m += d.might(b.level); } return m;
}
export function happiness() {
  let h = 0; for (const b of state.buildings) { const d = BUILDINGS[b.type]; if (d.happiness) h += d.happiness(b.level); } return h;
}
export function workersNeeded() {
  let w = 0; for (const b of state.buildings) { const d = BUILDINGS[b.type]; if (d.workers) w += d.workers; } return w;
}
export function efficiency() {
  const need = workersNeeded();
  if (need <= 0) return 1;
  return Math.max(0, Math.min(1, state.population / need));
}
export function grossProduction() {
  const p = { food: 0, wood: 0, stone: 0, gold: 0 };
  for (const b of state.buildings) {
    const d = BUILDINGS[b.type];
    if (d.produce) { const pr = d.produce(b.level); for (const k in pr) p[k] += pr[k]; }
  }
  return p;
}

// ---------- economy helpers ----------
export function canAfford(cost) { return Object.entries(cost || {}).every(([k, v]) => state.res[k] >= v); }
function pay(cost) { for (const k in cost) state.res[k] -= cost[k]; }
function grant(cost) { const c = caps(); for (const k in cost) state.res[k] = Math.min(c[k], state.res[k] + cost[k]); }

// ---------- actions ----------
export function tryBuild(type, cx, cz) {
  const def = BUILDINGS[type];
  if (def.requiresAge && state.age < def.requiresAge) { hooks.onToast(`${def.name} requires the Second Age`, 'warn'); return false; }
  const cost = def.buildCost || {};
  if (!canAfford(cost)) { hooks.onToast(`Not enough resources for ${def.name}`, 'warn'); return false; }
  pay(cost);
  const id = state.nextId++;
  state.buildings.push({ id, type, level: 1, cx, cz });
  hooks.spawn(id, modelFor(type, state.age, 1), def.footprint, cx, cz);
  hooks.onToast(`${def.icon} ${def.name} built`, 'ok');
  hooks.onChange();
  return true;
}

export function upgradeCostOf(b) { const d = BUILDINGS[b.type]; return d.upgrade ? d.upgrade(b.level) : null; }

export function tryUpgrade(id) {
  const b = state.buildings.find((x) => x.id === id);
  if (!b) return false;
  const def = BUILDINGS[b.type];
  if (b.level >= def.maxLevel) { hooks.onToast('Already at max level', 'warn'); return false; }
  const cost = def.upgrade(b.level);
  if (!canAfford(cost)) { hooks.onToast('Not enough resources to upgrade', 'warn'); return false; }
  pay(cost);
  b.level++;
  hooks.swap(id, modelFor(b.type, state.age, b.level));
  hooks.onToast(`${def.icon} ${def.name} → Level ${b.level}`, 'ok');
  if (def.isWonder && b.level >= 3 && !state.won) { state.won = true; hooks.onWin(); }
  hooks.onChange();
  return true;
}

export function refundOf(b) {
  const cost = BUILDINGS[b.type].buildCost || {};
  const r = {}; for (const k in cost) r[k] = Math.round(cost[k] * 0.4); return r;
}
export function demolish(id) {
  const i = state.buildings.findIndex((x) => x.id === id);
  if (i < 0) return;
  const b = state.buildings[i];
  if (b.type === 'towncenter') { hooks.onToast('You cannot demolish the Town Center', 'warn'); return; }
  grant(refundOf(b));
  state.buildings.splice(i, 1);
  hooks.remove(id);
  hooks.onToast(`${BUILDINGS[b.type].name} demolished`, 'ok');
  hooks.onChange();
}

export const AGE2_COST = { wood: 180, stone: 120, gold: 100 };
export const AGE2_POP = 16;
export function canAdvanceAge() {
  if (state.age >= 2) return false;
  const hasTemple = state.buildings.some((b) => b.type === 'temple');
  return hasTemple && state.population >= AGE2_POP && canAfford(AGE2_COST);
}
export function advanceAge() {
  if (state.age >= 2) return false;
  if (!state.buildings.some((b) => b.type === 'temple')) { hooks.onToast('Build a Temple to advance the Age', 'warn'); return false; }
  if (state.population < AGE2_POP) { hooks.onToast(`Need ${AGE2_POP} population to advance the Age`, 'warn'); return false; }
  if (!canAfford(AGE2_COST)) { hooks.onToast('Not enough resources to advance the Age', 'warn'); return false; }
  pay(AGE2_COST);
  state.age = 2;
  for (const b of state.buildings) hooks.swap(b.id, modelFor(b.type, 2, b.level));
  hooks.onToast('⚜️ Welcome to the Second Age — the Wonder is now available!', 'ok');
  hooks.onChange();
  return true;
}

// ---------- per-frame economy ----------
// Called when the rival finishes its Wonder first.
export function markLost() {
  if (state.won || state.lost) return;
  state.lost = true;
}

export function tick(dt) {
  if (state.won || state.lost) return;
  state.tElapsed += dt;
  const eff = efficiency();
  const happyMult = 1 + Math.min(0.5, happiness() / 100);
  const gross = grossProduction();
  const c = caps();

  for (const k of RES) {
    if (k === 'food') continue;
    state.res[k] = Math.min(c[k], state.res[k] + gross[k] * eff * happyMult * dt);
  }

  const foodNet = gross.food * eff * happyMult - state.population * FOOD_PER_POP;
  let food = state.res.food + foodNet * dt;
  const cap = popCap();
  // A couple of hardy founders never leave, so the settlement can always
  // recover from a famine (growth is food-driven, not gated by staffing —
  // gating it on efficiency would soft-lock the town at zero population).
  const FLOOR = Math.min(2, cap);
  if (food <= 0) {
    food = 0;
    state.population = Math.max(FLOOR, state.population - 0.5 * dt); // starvation
  } else if (state.population < cap) {
    state.population = Math.min(cap, state.population + 0.5 * dt); // growth
  }
  state.res.food = Math.min(c.food, food);

  // ----- raids -----
  if (!state.raidWarned && state.tElapsed > state.nextRaid - 15) {
    state.raidWarned = true;
    hooks.onToast('⚠️ Raiders are approaching! Build up your Might (⚔️).', 'warn');
  }
  if (state.tElapsed > state.nextRaid) {
    state.raidCount++;
    hooks.onSound('raid');
    const strength = 18 + 16 * state.raidCount;
    const m = might();
    if (m >= strength) {
      hooks.onToast(`🛡️ Raid #${state.raidCount} repelled! (Might ${Math.round(m)} vs ${strength})`, 'ok');
    } else {
      const frac = Math.min(0.5, (strength - m) / strength);
      for (const k of RES) state.res[k] *= (1 - frac);
      state.population = Math.max(FLOOR, state.population * (1 - frac * 0.5));
      hooks.onToast(`💥 Raid #${state.raidCount} struck! Lost ${Math.round(frac * 100)}% of stockpiles. (Might ${Math.round(m)} vs ${strength})`, 'bad');
    }
    state.nextRaid += 100;
    state.raidWarned = false;
  }
}

// ---------- selection info for the UI ----------
export function buildingInfo(id) {
  const b = state.buildings.find((x) => x.id === id);
  if (!b) return null;
  const def = BUILDINGS[b.type];
  const lines = [];
  if (def.produce) {
    const pr = def.produce(b.level);
    lines.push('Produces ' + Object.entries(pr).map(([k, v]) => `+${v.toFixed(1)} ${RES_ICON[k]}/s`).join(', '));
  }
  if (def.popCap) lines.push(`Housing +${def.popCap(b.level)} 👥`);
  if (def.capBonus) lines.push(`Storage cap +${def.capBonus(b.level)}`);
  if (def.might) lines.push(`Might +${def.might(b.level)} ⚔️`);
  if (def.happiness) lines.push(`Happiness +${def.happiness(b.level)} ✨`);
  if (def.workers) lines.push(`Employs ${def.workers} 👷`);
  return { id, type: b.type, name: def.name, icon: def.icon, level: b.level, maxLevel: def.maxLevel, lines, building: b };
}

// ---------- lifecycle ----------
export function startNew(difficulty = 'normal') {
  Object.assign(state, START());
  state.difficulty = difficulty;
  hooks.clearWorld();
  const f = BUILDINGS.towncenter.footprint;
  const c = Math.floor(GRID_N / 2 - f / 2);
  const id = state.nextId++;
  state.buildings.push({ id, type: 'towncenter', level: 1, cx: c, cz: c });
  hooks.spawn(id, modelFor('towncenter', 1, 1), f, c, c);
  hooks.onChange();
}
function rebuildWorld() {
  hooks.clearWorld();
  for (const b of state.buildings) {
    hooks.spawn(b.id, modelFor(b.type, state.age, b.level), BUILDINGS[b.type].footprint, b.cx, b.cz);
  }
}

const SAVE_KEY = 'fantasy-rts-save';
export function hasSave() { return !!localStorage.getItem(SAVE_KEY); }
export function save() {
  localStorage.setItem(SAVE_KEY, JSON.stringify({ ...state, rival: hooks.serializeRival() }));
  hooks.onToast('Realm saved', 'ok');
}
export function load() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return false;
  let rival = null;
  try {
    const { rival: r, ...rest } = JSON.parse(raw);
    rival = r;
    Object.assign(state, START(), rest);
  } catch { hooks.onToast('Saved game was corrupt', 'bad'); return false; }
  rebuildWorld();
  hooks.restoreRival(rival, state.difficulty);
  hooks.onChange();
  hooks.onToast('Realm loaded', 'ok');
  return true;
}
export function reset() { localStorage.removeItem(SAVE_KEY); startNew(state.difficulty); }
