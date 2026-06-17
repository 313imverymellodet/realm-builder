import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { makeInstance, makeGhost } from './assets.js';
import { GRID_N, CELL, RIVAL_CENTER } from './config.js';

const ORIGIN = -GRID_N * CELL / 2;

let renderer, scene, camera, controls, ground, raycaster, pointer, canvasEl, clock;
let buildingsGroup, highlight;
const occupied = new Map();   // "cx,cz" -> id
const instances = new Map();  // id -> { group, footprint, cx, cz, cells, modelName, rot }

let rivalGroup, decorGroup, unitsGroup, bitsGroup;
const rivalMap = new Map();    // key -> { group, modelName }

export function getUnitsGroup() { return unitsGroup; }
export function getBitsGroup() { return bitsGroup; }

let ghost = null, ghostFootprint = 1, ghostRot = 0, placingType = null;
let ghostState = { valid: false, cx: 0, cz: 0 };

// Camera focus tween (used to fly between your realm and the rival's).
let focusStart = null, focusGoal = null, focusT = 1;
const camOffset = new THREE.Vector3();

// Per-frame animators: fn(dt, elapsed) -> true when finished. Drives the
// "pop-in" of placed buildings and the river's surface waves.
const animators = [];
let elapsed = 0;
const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
function popIn(obj, dur = 0.4) {
  obj.scale.setScalar(0.001);
  let t = 0;
  animators.push((dt) => {
    t = Math.min(1, t + dt / dur);
    obj.scale.setScalar(Math.max(0.001, easeOutBack(t)));
    return t >= 1;
  });
}

// Hooks set by main.js
export const hooks = {
  canAfford: () => true,   // (type) -> bool
  onPlace: () => {},       // (type, cx, cz)
  onSelect: () => {},      // (id)
  onDeselect: () => {},
};

export function initWorld(canvas) {
  canvasEl = canvas;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#9fd3e8');
  scene.fog = new THREE.Fog('#9fd3e8', 200, 520);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 900);
  camera.position.set(46, 48, 46);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.3;
  controls.minDistance = 16;
  controls.maxDistance = 260;
  controls.target.set(0, 0, 0);
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

  scene.add(new THREE.HemisphereLight('#ffffff', '#5f8a36', 0.9));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.0);
  sun.position.set(70, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 80;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.camera.far = 300; sun.shadow.bias = -0.0004;
  scene.add(sun);

  // Big grassy apron so the world doesn't end at the build area.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.MeshStandardMaterial({ color: '#6aa033' })
  );
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.05; apron.receiveShadow = true;
  scene.add(apron);

  // The buildable ground (raycast target).
  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_N * CELL, GRID_N * CELL),
    new THREE.MeshStandardMaterial({ color: '#7cb342' })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(GRID_N * CELL, GRID_N, '#4f7a28', '#6b9a38');
  grid.position.y = 0.02;
  grid.material.opacity = 0.4; grid.material.transparent = true;
  scene.add(grid);

  // ---- rival realm to the north (drier, "enemy" ground) ----
  const rivalGround = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: '#a98a52' })
  );
  rivalGround.rotation.x = -Math.PI / 2;
  rivalGround.position.set(RIVAL_CENTER.x, -0.02, RIVAL_CENTER.z);
  rivalGround.receiveShadow = true;
  scene.add(rivalGround);

  // ---- animated river separating the two realms ----
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(440, 38, 80, 14),
    new THREE.MeshStandardMaterial({ color: '#3f86c4', metalness: 0.2, roughness: 0.35, transparent: true, opacity: 0.92, flatShading: true })
  );
  river.rotation.x = -Math.PI / 2;
  river.position.set(0, -0.04, -80);
  scene.add(river);
  // gentle surface waves (local z maps to world height after the rotation)
  const rpos = river.geometry.attributes.position;
  const baseXY = [];
  for (let i = 0; i < rpos.count; i++) baseXY.push([rpos.getX(i), rpos.getY(i)]);
  animators.push((dt, t) => {
    for (let i = 0; i < rpos.count; i++) {
      const [x, y] = baseXY[i];
      rpos.setZ(i, 0.55 * Math.sin(x * 0.08 + t * 1.6) * Math.cos(y * 0.16 + t * 1.1));
    }
    rpos.needsUpdate = true;
    return false; // runs forever
  });

  rivalGroup = new THREE.Group();
  scene.add(rivalGroup);

  decorGroup = new THREE.Group();
  scene.add(decorGroup);
  scatterDecor();

  unitsGroup = new THREE.Group();
  scene.add(unitsGroup);

  bitsGroup = new THREE.Group();
  scene.add(bitsGroup);

  buildingsGroup = new THREE.Group();
  scene.add(buildingsGroup);

  highlight = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1.0, 40),
    new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
  );
  highlight.rotation.x = -Math.PI / 2;
  highlight.position.y = 0.07;
  highlight.visible = false;
  scene.add(highlight);

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  clock = new THREE.Clock();

  window.addEventListener('resize', onResize);
  setupInput();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---------- grid math ----------
const key = (cx, cz) => cx + ',' + cz;
function setPointer(clientX, clientY) {
  const rect = canvasEl.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}
function pointerToCell(clientX, clientY) {
  setPointer(clientX, clientY);
  const hit = raycaster.intersectObject(ground)[0];
  if (!hit) return null;
  return {
    cx: Math.floor((hit.point.x - ORIGIN) / CELL),
    cz: Math.floor((hit.point.z - ORIGIN) / CELL),
  };
}
const anchorFor = (cx, cz, f) => ({ ax: cx - Math.floor(f / 2), az: cz - Math.floor(f / 2) });
function cellsOf(ax, az, f) { const c = []; for (let i = 0; i < f; i++) for (let j = 0; j < f; j++) c.push([ax + i, az + j]); return c; }
const inBounds = (ax, az, f) => ax >= 0 && az >= 0 && ax + f <= GRID_N && az + f <= GRID_N;
const cellsFree = (cells) => cells.every(([x, z]) => !occupied.has(key(x, z)));
const centerWorld = (ax, az, f) => ({ x: ORIGIN + (ax + f / 2) * CELL, z: ORIGIN + (az + f / 2) * CELL });

// ---------- placement ghost ----------
export async function startPlacing(type, modelName, footprint) {
  cancelPlacing();
  placingType = type;
  ghostFootprint = footprint;
  ghostRot = 0;
  const g = await makeGhost(modelName, footprint * CELL * 0.82);
  // a cancel or another startPlacing may have happened while loading
  if (placingType !== type) { disposeGhost(g); return; }
  if (ghost) disposeGhost(ghost); // drop any earlier ghost still in the scene
  ghost = g;
  ghost.visible = false;
  scene.add(ghost);
}
// The ghost owns unique materials (geometry is shared from the cache, so it is
// left alone); dispose the materials when discarding a ghost.
function disposeGhost(g) {
  if (!g) return;
  scene.remove(g);
  g.traverse((o) => { if (o.isMesh && o.material) o.material.dispose(); });
}
export function cancelPlacing() {
  placingType = null;
  if (ghost) { disposeGhost(ghost); ghost = null; }
}
export function rotateGhost() { ghostRot = (ghostRot + Math.PI / 2) % (Math.PI * 2); if (ghost) ghost.rotation.y = ghostRot; }

function updateGhost(clientX, clientY) {
  if (!ghost) return;
  const cell = pointerToCell(clientX, clientY);
  if (!cell) { ghost.visible = false; ghostState.valid = false; return; }
  const { ax, az } = anchorFor(cell.cx, cell.cz, ghostFootprint);
  const cells = cellsOf(ax, az, ghostFootprint);
  const ok = inBounds(ax, az, ghostFootprint) && cellsFree(cells) && hooks.canAfford(placingType);
  const c = centerWorld(ax, az, ghostFootprint);
  ghost.position.set(c.x, 0, c.z);
  ghost.visible = true;
  ghostState = { valid: ok, cx: ax, cz: az };
  ghost.userData.setValid?.(ok);
}

// ---------- building instances ----------
export async function spawnBuilding(id, modelName, footprint, cx, cz, rot = 0) {
  // Reserve the cells synchronously so a rapid second click can't place an
  // overlapping building while this model is still loading.
  const cells = cellsOf(cx, cz, footprint);
  cells.forEach(([x, z]) => occupied.set(key(x, z), id));
  instances.set(id, { group: null, footprint, cx, cz, cells, modelName, rot });

  const inst = await makeInstance(modelName, footprint * CELL * 0.82);
  const rec = instances.get(id);
  if (!rec || rec.modelName !== modelName) return; // removed or swapped while loading
  const c = centerWorld(cx, cz, footprint);
  inst.position.set(c.x, 0, c.z);
  inst.rotation.y = rot;
  inst.userData.buildingId = id;
  rec.group = inst;
  buildingsGroup.add(inst);
  popIn(inst);
}

export async function swapBuilding(id, modelName) {
  const rec = instances.get(id);
  if (!rec || rec.modelName === modelName) return; // no-op if unchanged
  rec.modelName = modelName; // claim immediately; stale loads check against this

  const inst = await makeInstance(modelName, rec.footprint * CELL * 0.82);
  const rec2 = instances.get(id);
  if (!rec2 || rec2.modelName !== modelName) return; // removed or superseded while loading
  const c = centerWorld(rec2.cx, rec2.cz, rec2.footprint);
  inst.position.set(c.x, 0, c.z);
  inst.rotation.y = rec2.rot;
  inst.userData.buildingId = id;
  if (rec2.group) buildingsGroup.remove(rec2.group);
  rec2.group = inst;
  buildingsGroup.add(inst);
  popIn(inst);
}

export function removeBuilding(id) {
  const rec = instances.get(id);
  if (!rec) return;
  rec.cells.forEach(([x, z]) => occupied.delete(key(x, z)));
  buildingsGroup.remove(rec.group);
  instances.delete(id);
  if (highlight.userData.id === id) hideHighlight();
}

export function clearWorld() {
  for (const id of [...instances.keys()]) removeBuilding(id);
  occupied.clear();
  hideHighlight();
  cancelPlacing();
}

// World-space center of a placed building (for positioning units near it).
export function buildingWorldPos(id) {
  const rec = instances.get(id);
  if (!rec) return null;
  const c = centerWorld(rec.cx, rec.cz, rec.footprint);
  return { x: c.x, z: c.z };
}

// ---------- rival realm (non-interactive: cannot be selected) ----------
// Doubles as both spawn and swap: claims the slot by modelName so the last
// requested model wins even if loads resolve out of order.
export async function spawnRival(rkey, modelName, size, x, z) {
  let rec = rivalMap.get(rkey);
  if (rec) { rec.modelName = modelName; } else { rec = { group: null, modelName }; rivalMap.set(rkey, rec); }
  const inst = await makeInstance(modelName, size);
  const cur = rivalMap.get(rkey);
  if (!cur || cur.modelName !== modelName) return; // superseded or cleared while loading
  inst.position.set(x, 0, z);
  if (cur.group) rivalGroup.remove(cur.group);
  cur.group = inst;
  rivalGroup.add(inst);
  popIn(inst);
}
export function clearRival() {
  for (const [, rec] of rivalMap) if (rec.group) rivalGroup.remove(rec.group);
  rivalMap.clear();
}

// ---------- camera focus ----------
export function focusOn(x, z) {
  focusStart = controls.target.clone();
  focusGoal = new THREE.Vector3(x, 0, z);
  camOffset.copy(camera.position).sub(controls.target);
  focusT = 0;
}

// ---------- decorative environment (one-time scatter of CC0 nature props) ----------
async function scatterDecor() {
  const TREES = ['Resource_Tree1', 'Resource_Tree2', 'Resource_PineTree', 'Resource_PineTree_Group', 'Resource_Tree_Group'];
  const ROCKS = ['Rock', 'Rock_Group', 'Resource_Rock_1', 'Resource_Rock_2'];
  const MTNS = ['Mountain_Single', 'Mountain_Group_1', 'Mountain_Group_2', 'MountainLarge_Single'];
  const half = GRID_N * CELL / 2; // player build area half-extent
  const inPlayer = (x, z) => Math.abs(x) < half + 5 && Math.abs(z) < half + 5;
  const inRival = (x, z) => Math.abs(x - RIVAL_CENTER.x) < 64 && Math.abs(z - RIVAL_CENTER.z) < 64;
  const inRiver = (z) => Math.abs(z + 80) < 22;
  const valid = (x, z) => !inPlayer(x, z) && !inRival(x, z) && !inRiver(z);

  const place = async (pool, size, x, z) => {
    const name = pool[(Math.random() * pool.length) | 0];
    try {
      const inst = await makeInstance(name, size * (0.8 + Math.random() * 0.5));
      inst.position.set(x, 0, z);
      inst.rotation.y = Math.random() * Math.PI * 2;
      decorGroup.add(inst);
    } catch { /* skip a missing decoration */ }
  };

  for (let i = 0; i < 60; i++) {
    let x = 0, z = 0, ok = false, tries = 0;
    while (!ok && tries++ < 20) { x = (Math.random() - 0.5) * 250; z = -230 + Math.random() * 340; ok = valid(x, z); }
    if (ok) place(Math.random() < 0.7 ? TREES : ROCKS, Math.random() < 0.7 ? 5 : 4, x, z);
  }
  // mountains as a far backdrop ring
  for (const [x, z] of [[-130, -150], [130, -150], [-150, -30], [150, -30], [-120, 70], [120, 70], [0, -255], [-90, -250], [90, -250], [0, 105]]) {
    place(MTNS, 22, x + (Math.random() - 0.5) * 20, z + (Math.random() - 0.5) * 20);
  }
}

// ---------- selection ----------
function showHighlight(id) {
  const rec = instances.get(id);
  if (!rec) return;
  const c = centerWorld(rec.cx, rec.cz, rec.footprint);
  const r = rec.footprint * CELL * 0.6;
  highlight.geometry.dispose();
  highlight.geometry = new THREE.RingGeometry(r * 0.9, r, 48);
  highlight.position.set(c.x, 0.07, c.z);
  highlight.visible = true;
  highlight.userData.id = id;
}
function hideHighlight() { highlight.visible = false; highlight.userData.id = null; }
export function clearSelection() { hideHighlight(); }

function findBuildingId(obj) {
  let o = obj;
  while (o) { if (o.userData && o.userData.buildingId != null) return o.userData.buildingId; o = o.parent; }
  return null;
}

// ---------- input ----------
let downPos = null;
function setupInput() {
  canvasEl.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY, b: e.button }; });
  canvasEl.addEventListener('pointermove', (e) => { if (placingType) updateGhost(e.clientX, e.clientY); });
  canvasEl.addEventListener('pointerup', (e) => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 5;
    const wasLeft = downPos.b === 0;
    downPos = null;
    if (moved || !wasLeft) return; // drags / non-left clicks drive the camera

    if (placingType) {
      if (ghostState.valid) hooks.onPlace(placingType, ghostState.cx, ghostState.cz);
      return;
    }
    setPointer(e.clientX, e.clientY);
    const hits = raycaster.intersectObjects(buildingsGroup.children, true);
    const id = hits.length ? findBuildingId(hits[0].object) : null;
    if (id != null) { showHighlight(id); hooks.onSelect(id); }
    else { hideHighlight(); hooks.onDeselect(); }
  });
}

// ---------- frame ----------
export function render(dt = 0) {
  elapsed += dt;
  for (let i = animators.length - 1; i >= 0; i--) {
    if (animators[i](dt, elapsed)) animators.splice(i, 1);
  }
  if (focusGoal && focusT < 1) {
    focusT = Math.min(1, focusT + dt * 1.5);
    const e = focusT < 0.5 ? 2 * focusT * focusT : 1 - Math.pow(-2 * focusT + 2, 2) / 2; // easeInOut
    const p = focusStart.clone().lerp(focusGoal, e);
    controls.target.copy(p);
    camera.position.copy(p).add(camOffset);
    if (focusT >= 1) focusGoal = null;
  }
  controls.update();
  renderer.render(scene, camera);
}
export function getDelta() { return Math.min(clock.getDelta(), 0.25); }
