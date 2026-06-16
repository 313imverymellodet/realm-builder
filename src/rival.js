// The rival AI: a second settlement that grows its own economy and races the
// player to finish its Wonder. Pure "brain" (economy + build plan) so its pacing
// can be unit-tested in Node; all rendering goes through injected hooks.
import { BUILDINGS, modelFor } from './buildings.js';
import { CELL, RIVAL_CENTER } from './config.js';

// Ordered build strategy. CAPS entries are meta-steps, not buildings.
const PLAN = [
  'house', 'farm', 'lumber', 'house', 'mine', 'market',
  'farm', 'temple', 'storage', 'house', 'lumber', 'barracks',
  'ADVANCE_AGE', 'wonder', 'WONDER_UP', 'WONDER_UP',
];
// "Build points" required to reach each step (rises geometrically).
const COSTS = PLAN.map((_, i) => Math.round(30 * Math.pow(1.26, i)));

const DIFF = { easy: 0.55, normal: 0.75, hard: 1.05 };

let hooks = { spawn: () => {}, clear: () => {}, onWin: () => {}, onProgress: () => {} };
let diffMult = 1.0;

const fresh = () => ({ econ: 0, planIdx: 0, age: 1, wonderLevel: 0, buildings: [], over: false });
export let state = fresh();

export function setHooks(h) { hooks = { ...hooks, ...h }; }

// ---------- layout: a tidy town around the rival center ----------
function slotPos(i) {
  const cols = 6, sp = CELL * 2.1;
  const row = Math.floor(i / cols), col = i % cols;
  return {
    x: RIVAL_CENTER.x + (col - (cols - 1) / 2) * sp,
    z: RIVAL_CENTER.z + 16 + row * sp, // rows in front of (toward player) the Town Center
  };
}
const TC_POS = { x: RIVAL_CENTER.x, z: RIVAL_CENTER.z };
const WONDER_POS = { x: RIVAL_CENTER.x, z: RIVAL_CENTER.z - 24 }; // behind the Town Center
const sizeFor = (type) => BUILDINGS[type].footprint * CELL * 0.82;

// ---------- progression ----------
function place(type, slot) {
  const p = slotPos(slot);
  const key = 'b' + state.buildings.length;
  state.buildings.push({ type, slot, level: 1, key });
  hooks.spawn(key, modelFor(type, state.age, 1), sizeFor(type), p.x, p.z);
}

function advance(item) {
  if (item === 'ADVANCE_AGE') {
    state.age = 2;
    hooks.spawn('tc', modelFor('towncenter', 2, 1), sizeFor('towncenter'), TC_POS.x, TC_POS.z);
    for (const b of state.buildings) {
      const p = slotPos(b.slot);
      hooks.spawn(b.key, modelFor(b.type, 2, b.level), sizeFor(b.type), p.x, p.z);
    }
  } else if (item === 'wonder') {
    state.wonderLevel = 1;
    hooks.spawn('wonder', modelFor('wonder', state.age, 1), sizeFor('wonder'), WONDER_POS.x, WONDER_POS.z);
  } else if (item === 'WONDER_UP') {
    state.wonderLevel++;
    hooks.spawn('wonder', modelFor('wonder', state.age, state.wonderLevel), sizeFor('wonder'), WONDER_POS.x, WONDER_POS.z);
    if (state.wonderLevel >= 3) { state.over = true; hooks.onWin(); }
  } else {
    place(item, state.buildings.length);
  }
}

// Build rate grows with the rival's town size, then scaled by difficulty.
const rate = () => (1.8 + state.buildings.length * 0.55) * diffMult;

export function tick(dt) {
  if (state.over || state.planIdx >= PLAN.length) return;
  state.econ += rate() * dt;
  let changed = false;
  while (state.planIdx < PLAN.length && state.econ >= COSTS[state.planIdx]) {
    state.econ -= COSTS[state.planIdx];
    advance(PLAN[state.planIdx]);
    state.planIdx++;
    changed = true;
    if (state.over) break;
  }
  if (changed) hooks.onProgress(progress());
}

export function progress() {
  return {
    builds: state.buildings.length,
    age: state.age,
    wonderLevel: state.wonderLevel,
    pct: Math.min(1, state.planIdx / PLAN.length),
    nextEta: state.planIdx < PLAN.length
      ? Math.max(0, (COSTS[state.planIdx] - state.econ) / rate())
      : 0,
  };
}

// ---------- lifecycle ----------
export function reset(difficulty = 'normal') {
  diffMult = DIFF[difficulty] ?? 1.0;
  hooks.clear();
  state = fresh();
  hooks.spawn('tc', modelFor('towncenter', 1, 1), sizeFor('towncenter'), TC_POS.x, TC_POS.z);
  hooks.onProgress(progress());
}

export function serialize() { return { ...state, diffMult }; }

export function restore(data, difficulty) {
  hooks.clear();
  state = { ...fresh(), ...(data || {}) };
  diffMult = DIFF[difficulty] ?? data?.diffMult ?? 1.0;
  hooks.spawn('tc', modelFor('towncenter', state.age, 1), sizeFor('towncenter'), TC_POS.x, TC_POS.z);
  for (const b of state.buildings) {
    const p = slotPos(b.slot);
    hooks.spawn(b.key, modelFor(b.type, state.age, b.level), sizeFor(b.type), p.x, p.z);
  }
  if (state.wonderLevel > 0) {
    hooks.spawn('wonder', modelFor('wonder', state.age, state.wonderLevel), sizeFor('wonder'), WONDER_POS.x, WONDER_POS.z);
  }
  hooks.onProgress(progress());
}

export function isOver() { return state.over; }
