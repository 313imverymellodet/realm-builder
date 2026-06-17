// Building definitions: economy values, footprints, and model-name mapping.
// Tuned for a ~10-15 minute path to the Wonder win. No hard-fail; raids and
// starvation only set you back.

export const RES = ['food', 'wood', 'stone', 'gold'];
export const RES_ICON = { food: '🌾', wood: '🪵', stone: '🪨', gold: '🪙' };

const ageName = (age) => (age >= 2 ? 'SecondAge' : 'FirstAge');

// Scale a base cost for an upgrade from `level` -> `level+1`.
const up = (base, level, mult = 1.8) => {
  const o = {};
  for (const k in base) o[k] = Math.round(base[k] * (level + 0.5) * mult);
  return o;
};

export const BUILDINGS = {
  towncenter: {
    name: 'Town Center', icon: '🏛️', footprint: 2, maxLevel: 3, buildable: false,
    desc: 'The heart of your settlement. Houses people and yields a little gold.',
    model: (age, l) => `TownCenter_${ageName(age)}_Level${l}`,
    popCap: (l) => [0, 8, 14, 20][l],
    produce: (l) => ({ gold: 0.4 * l }),
    upgrade: (l) => up({ wood: 100, stone: 70, gold: 50 }, l, 1.6),
  },
  house: {
    name: 'House', icon: '🏠', footprint: 1, maxLevel: 3, buildable: true,
    desc: 'Provides housing. More people means more workers for your economy.',
    model: (age, l) => `Houses_${ageName(age)}_1_Level${l}`,
    buildCost: { wood: 20 },
    popCap: (l) => [0, 5, 9, 14][l],
    upgrade: (l) => up({ wood: 20 }, l),
  },
  farm: {
    name: 'Farm', icon: '🌾', footprint: 2, maxLevel: 3, buildable: true,
    desc: 'Grows food to feed your growing population. Needs workers.',
    model: (age, l) => `Farm_${ageName(age)}_Level${l}_Wheat`,
    buildCost: { wood: 15 },
    produce: (l) => ({ food: 1.6 * l }),
    workers: 2,
    upgrade: (l) => up({ wood: 18 }, l),
  },
  lumber: {
    name: 'Lumber Camp', icon: '🪵', footprint: 1, maxLevel: 3, buildable: true,
    desc: 'Gathers wood — your basic construction material.',
    model: () => 'Logs',
    buildCost: { wood: 10 },
    produce: (l) => ({ wood: 1.6 * l }),
    workers: 2,
    upgrade: (l) => up({ wood: 14, stone: 6 }, l),
  },
  mine: {
    name: 'Mine', icon: '⛏️', footprint: 1, maxLevel: 3, buildable: true,
    desc: 'Extracts stone and a trickle of gold from the earth.',
    model: () => 'Mine',
    buildCost: { wood: 25, stone: 5 },
    produce: (l) => ({ stone: 1.4 * l, gold: 0.7 * l }),
    workers: 3,
    upgrade: (l) => up({ wood: 26, gold: 16 }, l),
  },
  windmill: {
    name: 'Windmill', icon: '🌬️', footprint: 1, maxLevel: 3, buildable: true,
    desc: 'A strong, steady source of food.',
    model: (age) => `Windmill_${ageName(age)}`,
    buildCost: { wood: 30, stone: 10 },
    produce: (l) => ({ food: 2.2 * l }),
    workers: 2,
    upgrade: (l) => up({ wood: 30, stone: 12 }, l),
  },
  market: {
    name: 'Market', icon: '🪙', footprint: 2, maxLevel: 3, buildable: true,
    desc: 'Generates gold through trade.',
    model: (age, l) => `Market_${ageName(age)}_Level${l}`,
    buildCost: { wood: 45, stone: 20 },
    produce: (l) => ({ gold: 2.2 * l }),
    workers: 2,
    upgrade: (l) => up({ wood: 40, stone: 22 }, l),
  },
  storage: {
    name: 'Storehouse', icon: '📦', footprint: 1, maxLevel: 3, buildable: true,
    desc: 'Raises the maximum you can stockpile of every resource.',
    model: (age, l) => `Storage_${ageName(age)}_Level${l}`,
    buildCost: { wood: 35, stone: 5 },
    capBonus: (l) => 200 * l,
    upgrade: (l) => up({ wood: 30, stone: 8 }, l),
  },
  watchtower: {
    name: 'Watchtower', icon: '🗼', footprint: 1, maxLevel: 3, buildable: true,
    desc: 'A cheap source of Might to help fend off raiders.',
    model: (age, l) => `WatchTower_${ageName(age)}_Level${l}`,
    buildCost: { wood: 20, stone: 25 },
    might: (l) => 6 * l,
    workers: 1,
    upgrade: (l) => up({ wood: 18, stone: 25 }, l),
  },
  barracks: {
    name: 'Barracks', icon: '⚔️', footprint: 2, maxLevel: 3, buildable: true,
    desc: 'Trains a garrison, adding lots of Might to defend against raids.',
    model: (age, l) => `Barracks_${ageName(age)}_Level${l}`,
    buildCost: { wood: 50, stone: 30 },
    might: (l) => 12 * l,
    workers: 3,
    upgrade: (l) => up({ wood: 45, stone: 35 }, l),
  },
  temple: {
    name: 'Temple', icon: '✨', footprint: 2, maxLevel: 3, buildable: true,
    desc: 'Raises Happiness, boosting the output of every building. Unlocks the Age.',
    model: (age, l) => `Temple_${ageName(age)}_Level${l}`,
    buildCost: { wood: 40, stone: 40, gold: 20 },
    happiness: (l) => 12 * l,
    workers: 2,
    upgrade: (l) => up({ wood: 38, stone: 38, gold: 22 }, l),
  },
  wonder: {
    name: 'Wonder', icon: '🏆', footprint: 3, maxLevel: 3, buildable: true, requiresAge: 2,
    desc: 'Your crowning achievement. Build it and raise it to Level 3 to win.',
    model: (age, l) => `Wonder_${ageName(age)}_Level${l}`,
    buildCost: { wood: 200, stone: 200, gold: 150 },
    upgrade: (l) => ({ wood: 250 * l, stone: 250 * l, gold: 200 * l }),
    isWonder: true,
  },
};

// Order shown in the bottom build bar.
export const BUILD_ORDER = [
  'house', 'farm', 'lumber', 'mine', 'windmill', 'market',
  'storage', 'watchtower', 'barracks', 'temple', 'wonder',
];

export function modelFor(type, age, level) { return BUILDINGS[type].model(age, level); }
export function footprintOf(type) { return BUILDINGS[type].footprint; }

// The resource a building mainly outputs (for gather-bit visuals), or null.
export function primaryResource(type) {
  const d = BUILDINGS[type];
  if (!d.produce) return null;
  const p = d.produce(1);
  let best = null, max = 0;
  for (const k in p) if (p[k] > max) { max = p[k]; best = k; }
  return best;
}

export function costToString(cost) {
  const e = Object.entries(cost || {});
  if (!e.length) return 'free';
  return e.map(([k, v]) => `${RES_ICON[k]}${v}`).join('  ');
}
