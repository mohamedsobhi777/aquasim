import * as THREE from 'three';

/**
 * Level-of-detail support shared by scenes. Objects register an updater that
 * picks their detail for the camera about to render; the app runs every
 * updater once per frame before rendering.
 */
export interface LodView {
  camera: THREE.Camera;
  /** Image height / (2 tan(fov / 2)): metres at 1 m distance -> pixels. */
  pixelScale: number;
}

type LodUpdater = (view: LodView) => void;

export function registerLod(object: THREE.Object3D, update: LodUpdater): void {
  object.userData.lodUpdate = update;
}

export function lodUpdaters(root: THREE.Object3D): LodUpdater[] {
  const found: LodUpdater[] = [];
  root.traverse((object) => {
    const update = object.userData.lodUpdate as LodUpdater | undefined;
    if (update) found.push(update);
  });
  return found;
}

export interface InstancedLodLevel {
  geometry: THREE.BufferGeometry;
  /** Use this level while an instance's projected bounding radius is at least this many pixels. */
  minPixels: number;
}

const frustum = new THREE.Frustum();
const viewProjection = new THREE.Matrix4();
const sphere = new THREE.Sphere();
const cameraPosition = new THREE.Vector3();

/**
 * Many copies of one object drawn at a few detail levels. Each frame every
 * instance is frustum-culled and assigned the coarsest level whose
 * `minPixels` its projected size still reaches; instances smaller than the
 * last level's threshold are skipped.
 */
export class InstancedLod {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[];
  private readonly matrices: THREE.Matrix4[];
  private readonly bounds: THREE.Sphere[];
  /** Extra culling margin, metres, so instances do not pop in at the edge of the view. */
  private readonly frustumMargin: number;

  constructor(
    name: string,
    levels: readonly InstancedLodLevel[],
    material: THREE.Material,
    matrices: readonly THREE.Matrix4[],
    frustumMargin = 2,
  ) {
    if (levels.length === 0) throw new Error(`${name}: needs at least one level`);
    levels.forEach((level, i) => {
      if (i > 0 && level.minPixels > levels[i - 1].minPixels)
        throw new Error(`${name}: levels must go from fine to coarse`);
    });
    this.group.name = name;
    this.matrices = matrices.map((m) => m.clone());
    this.frustumMargin = frustumMargin;
    const local =
      levels[0].geometry.boundingSphere ??
      (levels[0].geometry.computeBoundingSphere(), levels[0].geometry.boundingSphere!);
    this.bounds = this.matrices.map((m) => local.clone().applyMatrix4(m));

    this.meshes = levels.map((level, i) => {
      const mesh = new THREE.InstancedMesh(level.geometry, material, Math.max(1, matrices.length));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.name = `${name}-lod${i}`;
      mesh.userData.minPixels = level.minPixels;
      // Culling happens per instance in update().
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });
    registerLod(this.group, (view) => this.update(view));
    this.update(null);
  }

  /** Assigns instances to levels for `view`; null shows every instance at full detail. */
  update(view: LodView | null): void {
    const counts = this.meshes.map(() => 0);
    if (view) {
      view.camera.updateMatrixWorld();
      viewProjection.multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      view.camera.getWorldPosition(cameraPosition);
    }
    for (let i = 0; i < this.matrices.length; i++) {
      let level = 0;
      if (view) {
        sphere.copy(this.bounds[i]);
        sphere.radius += this.frustumMargin;
        if (!frustum.intersectsSphere(sphere)) continue;
        const distance = Math.max(1e-3, this.bounds[i].center.distanceTo(cameraPosition) - this.bounds[i].radius);
        const pixels = (this.bounds[i].radius * view.pixelScale) / distance;
        level = this.meshes.findIndex((mesh) => pixels >= (mesh.userData.minPixels as number));
        if (level < 0) continue;
      }
      this.meshes[level].setMatrixAt(counts[level]++, this.matrices[i]);
    }
    this.meshes.forEach((mesh, level) => {
      mesh.count = counts[level];
      mesh.visible = counts[level] > 0;
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  dispose(): void {
    this.meshes.forEach((mesh) => mesh.geometry.dispose());
  }
}
