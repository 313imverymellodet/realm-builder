// Animated KayKit characters (CC0). Heroes and skeletons share the Rig_Medium
// skeleton, so a single clip library is retargeted onto every unit.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const sceneCache = new Map();   // file -> Promise<THREE.Object3D>
let clipLib = null;             // { Idle, Walk, Run, Attack, Hit, Death }
let ready = false;
let root = null;                // THREE.Group all units live in

const UNIT_HEIGHT = 2.6;        // world units tall
const FACE_OFFSET = Math.PI;    // KayKit characters face -Z; rotate to face travel dir

function loadGlb(url) {
  return new Promise((res, rej) => loader.load(url, res, undefined, rej));
}
function loadScene(file) {
  if (!sceneCache.has(file)) {
    sceneCache.set(file, loadGlb(`/units/${file}.glb`).then((g) => g.scene));
  }
  return sceneCache.get(file);
}

export async function initUnits(parentGroup) {
  root = parentGroup;
  const [mv, gen, cm] = await Promise.all([
    loadGlb('/units/Rig_Medium_MovementBasic.glb'),
    loadGlb('/units/Rig_Medium_General.glb'),
    loadGlb('/units/Rig_Medium_CombatMelee.glb'),
  ]);
  const pick = (g, name) => g.animations.find((c) => c.name === name);
  clipLib = {
    Idle: pick(gen, 'Idle_A'),
    Walk: pick(mv, 'Walking_C') || pick(mv, 'Walking_A'),
    Run: pick(mv, 'Running_A'),
    Attack: pick(cm, 'Melee_1H_Attack_Slice_Diagonal') || pick(cm, 'Melee_1H_Attack_Chop'),
    Hit: pick(gen, 'Hit_A'),
    Death: pick(gen, 'Death_A'),
  };
  ready = true;
}

const all = new Set();

class Unit {
  constructor(model) {
    this.group = model;
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const k in clipLib) if (clipLib[k]) this.actions[k] = this.mixer.clipAction(clipLib[k]);
    this.current = null;
    this.speed = 3.2;
    this.state = 'idle';
    this.target = null;
    this.onArrive = null;
    this.timer = 0;            // role brain timer
    this.role = 'villager';
    this.home = new THREE.Vector3();
    this.homeR = 6;
    this.play('Idle');
  }

  play(name, { loop = true, fade = 0.2 } = {}) {
    const a = this.actions[name];
    if (!a || this.current === a) return;
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = !loop;
    a.fadeIn(fade);
    a.play();
    if (this.current) this.current.fadeOut(fade);
    this.current = a;
  }

  setPos(x, z) { this.group.position.set(x, 0, z); return this; }
  face(dx, dz) { if (dx || dz) this.group.rotation.y = Math.atan2(dx, dz) + FACE_OFFSET; }

  walkTo(x, z, onArrive = null, run = false) {
    this.target = new THREE.Vector3(x, 0, z);
    this.onArrive = onArrive;
    this.state = 'walk';
    this.play(run ? 'Run' : 'Walk');
  }
  idle() { this.state = 'idle'; this.target = null; this.play('Idle'); this.timer = 1 + Math.random() * 3; }
  attack(onHit = null) {
    this.state = 'attack';
    this.timer = 0;
    this.onHit = onHit;
    this.play('Attack', { loop: false, fade: 0.08 });
  }
  die(onGone = null) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.timer = 0;
    this.onGone = onGone;
    this.play('Death', { loop: false, fade: 0.08 });
  }
  remove() { root.remove(this.group); all.delete(this); this.removed = true; }

  update(dt) {
    this.mixer.update(dt);
    const p = this.group.position;

    if (this.state === 'walk' && this.target) {
      const dx = this.target.x - p.x, dz = this.target.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.45) {
        const cb = this.onArrive; this.target = null; this.onArrive = null; this.idle();
        if (cb) cb(this);
      } else {
        p.x += (dx / d) * this.speed * dt;
        p.z += (dz / d) * this.speed * dt;
        this.face(dx / d, dz / d);
      }
    } else if (this.state === 'idle') {
      this.timer -= dt;
      if (this.role === 'villager' && this.timer <= 0) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * this.homeR;
        this.walkTo(this.home.x + Math.cos(a) * r, this.home.z + Math.sin(a) * r);
      }
    } else if (this.state === 'attack') {
      this.timer += dt;
      if (this.onHit && this.timer > 0.45) { const cb = this.onHit; this.onHit = null; cb(this); }
      if (this.timer > (this.actions.Attack?.getClip().duration || 1)) this.idle();
    } else if (this.state === 'dead') {
      this.timer += dt;
      if (this.timer > 1.8) {
        const cb = this.onGone; this.remove(); if (cb) cb();
      }
    }
  }
}

export async function spawn(file, x, z, init) {
  if (!ready) return null;
  const src = await loadScene(file);
  const model = skeletonClone(src);
  const box = new THREE.Box3().setFromObject(model);
  const h = (box.max.y - box.min.y) || 1;
  model.scale.setScalar(UNIT_HEIGHT / h);
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  root.add(model);
  const u = new Unit(model);
  u.setPos(x, z);
  all.add(u);
  init?.(u);
  return u;
}

export function update(dt) {
  for (const u of all) u.update(dt);
}

export function clearAll() {
  for (const u of [...all]) u.remove();
}

export function isReady() { return ready; }
export function count() { return all.size; }
