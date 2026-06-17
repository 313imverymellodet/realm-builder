// Floating "gather" bits: when a building produces, a little resource model
// (KayKit ResourceBits, CC0) pops above it, rises, spins, and shrinks away.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();
let group = null;
const active = [];

const MODEL = { food: 'Textiles_A', wood: 'Wood_Log_A', stone: 'Stone_Chunks_Small', gold: 'Gold_Nugget_Small' };
const BIT_SIZE = 1.15;   // target max dimension of a bit
const LIFE = 1.3;        // seconds

function load(name) {
  if (!cache.has(name)) {
    cache.set(name, new Promise((res, rej) => {
      loader.load(`/bits/${name}.gltf`, (g) => {
        const s = g.scene;
        const box = new THREE.Box3().setFromObject(s);
        const d = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) || 1;
        s.userData.norm = BIT_SIZE / d;
        res(s);
      }, undefined, rej);
    }));
  }
  return cache.get(name);
}

export function initBits(parentGroup) { group = parentGroup; }

export async function spawnBit(resKey, x, z, baseY = 2.6) {
  const name = MODEL[resKey];
  if (!name || !group) return;
  const proto = await load(name);
  const m = proto.clone(true);
  m.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  m.position.set(x + (Math.random() - 0.5) * 1.4, baseY, z + (Math.random() - 0.5) * 1.4);
  m.scale.setScalar(0.001);
  group.add(m);
  active.push({ m, t: 0, norm: proto.userData.norm, y0: baseY, spin: Math.random() < 0.5 ? 1 : -1 });
}

export function update(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const b = active[i];
    b.t += dt;
    if (b.t >= LIFE) { group.remove(b.m); active.splice(i, 1); continue; }
    const t = b.t;
    let s; // pop in, hold, shrink out
    if (t < 0.15) s = t / 0.15;
    else if (t > 1.0) s = 1 - (t - 1.0) / 0.3;
    else s = 1;
    b.m.scale.setScalar(Math.max(0.001, s * b.norm));
    b.m.position.y = b.y0 + Math.min(1, t / 1.0) * 2.3; // rise
    b.m.rotation.y += dt * 4 * b.spin;
  }
}

export function clearBits() {
  for (const b of active) group.remove(b.m);
  active.length = 0;
}
