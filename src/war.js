// Gameplay layer on top of the units engine: ambient villagers, garrison
// soldiers at military buildings, and raids that play out as on-map battles.
import * as units from './units.js';

const VILLAGER_MODELS = ['Rogue', 'Mage', 'Ranger', 'Barbarian'];
const SOLDIER_MODELS = ['Knight', 'Barbarian'];
const SKELETON_MODELS = ['Skeleton_Warrior', 'Skeleton_Minion', 'Skeleton_Rogue'];
const MILITARY = { barracks: 2, watchtower: 1 }; // soldiers per building

const TOWN = { x: 0, z: 0 };
const LINE = -26;     // battle line just north of town
const rand = (a) => a[(Math.random() * a.length) | 0];

let villagers = [];
let villagerPending = 0;
const garrison = new Map();   // buildingId -> Unit[]
let raid = null;              // active raid choreography

export function reset() {
  units.clearAll();
  villagers = [];
  villagerPending = 0;
  garrison.clear();
  raid = null;
}

// ---------- villagers (count scales with population) ----------
export function syncVillagers(population) {
  const target = Math.max(1, Math.min(8, Math.floor(population / 3)));
  villagers = villagers.filter((u) => !u.removed);
  while (villagers.length + villagerPending < target) {
    villagerPending++;
    const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 12;
    units.spawn(rand(VILLAGER_MODELS), TOWN.x + Math.cos(a) * r, TOWN.z + Math.sin(a) * r, (u) => {
      u.role = 'villager';
      u.home.set(TOWN.x, 0, TOWN.z);
      u.homeR = 16;
      u.speed = 2 + Math.random();
      villagers.push(u);
      villagerPending--;
    });
  }
  while (villagers.length > target) villagers.pop()?.remove();
}

// ---------- garrison (soldiers stand guard at military buildings) ----------
export function syncGarrison(buildings, posOf) {
  const live = new Set();
  for (const b of buildings) {
    const n = MILITARY[b.type];
    if (!n) continue;
    live.add(b.id);
    if (garrison.has(b.id)) continue;
    const arr = [];
    garrison.set(b.id, arr);
    const p = posOf(b.id);
    if (!p) continue;
    for (let i = 0; i < n; i++) {
      const ox = (i - (n - 1) / 2) * 2.2;
      units.spawn(rand(SOLDIER_MODELS), p.x + ox, p.z + 2.5, (u) => {
        u.role = 'soldier';
        u.home.set(p.x + ox, 0, p.z + 2.5);
        u.face(0, -1);
        arr.push(u);
      });
    }
  }
  for (const [id, arr] of garrison) {
    if (!live.has(id)) { arr.forEach((u) => u.remove()); garrison.delete(id); }
  }
}

function allSoldiers() {
  const a = [];
  for (const arr of garrison.values()) for (const u of arr) if (!u.removed) a.push(u);
  return a;
}

// ---------- raid battle ----------
export function doRaid(defended) {
  if (raid) return; // one battle at a time
  const soldiers = allSoldiers();
  const K = defended ? Math.min(soldiers.length + 2, 6) : 5;
  const raiders = [];
  const spread = (i, n) => -12 + (24 * i) / Math.max(1, n - 1);

  for (let i = 0; i < K; i++) {
    const x = spread(i, K);
    units.spawn(rand(SKELETON_MODELS), x, -56, (u) => {
      u.role = 'raider';
      u.speed = 3.6;
      raiders.push(u);
      u.walkTo(x, LINE, null, true); // run to the battle line
    });
  }
  soldiers.forEach((s, i) => {
    s.home.copy(s.group.position);              // remember post so they can return
    s.walkTo(spread(i, soldiers.length), LINE + 5, null, true);
  });

  raid = { t: 0, phase: 'march', defended, raiders, soldiers, homes: soldiers.map((s) => s.home.clone()) };
}

function reattackIdle(list, faceZ) {
  for (const u of list) {
    if (u.removed || u.state === 'dead') continue;
    if (u.state === 'idle') { u.face(0, faceZ); u.attack(); }
  }
}

export function update(dt) {
  units.update(dt);
  if (!raid) return;
  raid.t += dt;

  if (raid.phase === 'march' && raid.t > 2.6) raid.phase = 'fight';

  if (raid.phase === 'fight') {
    reattackIdle(raid.raiders, 1);    // raiders face south (+z) toward town
    reattackIdle(raid.soldiers, -1);  // soldiers face north (-z) toward raiders
    if (raid.t > 5.6) {
      raid.phase = 'resolve';
      if (raid.defended) {
        raid.raiders.forEach((u) => u.die());
        raid.soldiers.forEach((s, i) => { if (!s.removed) s.walkTo(raid.homes[i].x, raid.homes[i].z, (u) => u.face(0, -1)); });
      } else {
        raid.soldiers.forEach((s, i) => {
          if (s.removed) return;
          s.play('Hit', { loop: false, fade: 0.1 });
          setTimeout(() => { if (!s.removed) s.walkTo(raid.homes[i].x, raid.homes[i].z, (u) => u.face(0, -1)); }, 700);
        });
        // raiders break through to the town, then vanish
        raid.raiders.forEach((u) => { if (!u.removed) u.walkTo(TOWN.x + (Math.random() - 0.5) * 6, TOWN.z, (r) => r.remove(), true); });
      }
    }
  }

  if (raid.phase === 'resolve' && raid.t > 11) raid = null;
}
