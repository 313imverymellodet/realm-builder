import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const protoCache = new Map();

// Load a glTF scene once and cache the promise. Geometry/materials are shared
// across clones, so we never dispose them (that would corrupt other instances).
export function loadProto(name) {
  if (protoCache.has(name)) return protoCache.get(name);
  const p = new Promise((resolve, reject) => {
    loader.load(
      `/models/${name}.gltf`,
      (g) => {
        g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        resolve(g.scene);
      },
      undefined,
      (err) => { console.error(`Failed to load model "${name}"`, err); reject(err); }
    );
  });
  protoCache.set(name, p);
  return p;
}

// Auto-fit a model to a target horizontal size and sit it on the ground (y=0).
// Returns a wrapper Group whose origin is the footprint center on the ground.
function fitAndGround(model, targetSize) {
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxH = Math.max(size.x, size.z) || 1;
  model.scale.setScalar(targetSize / maxH);
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  model.position.y = -box.min.y;
  const group = new THREE.Group();
  group.add(model);
  return group;
}

export async function makeInstance(name, targetSize) {
  const model = (await loadProto(name)).clone(true);
  return fitAndGround(model, targetSize);
}

// Translucent, tintable preview. Uses its own materials so it never touches the
// shared source materials. group.userData.setValid(bool) recolors green/red.
export async function makeGhost(name, targetSize) {
  const model = (await loadProto(name)).clone(true);
  const group = fitAndGround(model, targetSize);
  const mats = [];
  model.traverse((o) => {
    if (o.isMesh) {
      o.material = new THREE.MeshStandardMaterial({
        color: 0x44ff66, transparent: true, opacity: 0.55, emissive: 0x114400, depthWrite: false,
      });
      o.castShadow = false; o.receiveShadow = false;
      mats.push(o.material);
    }
  });
  group.userData.setValid = (ok) => {
    for (const m of mats) { m.color.setHex(ok ? 0x44ff66 : 0xff5544); m.emissive.setHex(ok ? 0x114400 : 0x441100); }
  };
  return group;
}
