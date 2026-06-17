import { defineConfig } from 'vite';

// Dedupe three so the app and the examples/jsm modules (GLTFLoader,
// OrbitControls, SkeletonUtils) share ONE three instance. Without this,
// SkeletonUtils.clone's `instanceof SkinnedMesh/Bone` checks fail across
// duplicate copies and skinned characters lose their rig.
export default defineConfig({
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['three'] },
});
