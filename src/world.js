import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { makeInstance, makeGhost } from './assets.js';
import { GRID_N, CELL } from './config.js';

const ORIGIN = -GRID_N * CELL / 2;

let renderer, scene, camera, controls, ground, raycaster, pointer, canvasEl, clock;
let buildingsGroup, highlight;
const occupied = new Map();   // "cx,cz" -> id
const instances = new Map();  // id -> { group, footprint, cx, cz, cells, modelName, rot }

let ghost = null, ghostFootprint = 1, ghostRot = 0, placingType = null;
let ghostState = { valid: false, cx: 0, cz: 0 };

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
  scene.fog = new THREE.Fog('#9fd3e8', 120, 260);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 700);
  camera.position.set(46, 48, 46);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.3;
  controls.minDistance = 16;
  controls.maxDistance = 170;
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
export function render() { controls.update(); renderer.render(scene, camera); }
export function getDelta() { return Math.min(clock.getDelta(), 0.25); }
