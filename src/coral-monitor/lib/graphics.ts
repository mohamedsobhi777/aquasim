import * as THREE from "three";

export function setupGenericLightingEnvironment(scene: THREE.Scene) {
  // Soft fill light: sky colour from above, ground colour from below
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));

  // Key light, like a sun
  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(5, 10, 7);
  scene.add(key);

  // Rim/back light to show the silhouette
  const rim = new THREE.DirectionalLight(0xffffff, 1.0);
  rim.position.set(-5, 5, -7);
  scene.add(rim);
}

export function object3D_countTriangle(object: THREE.Object3D): number {
  let total = 0;

  object.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!geometry) {
      return;
    }

    const position = geometry.getAttribute("position");
    if (!position && !geometry.index) {
      return;
    }

    let count = geometry.index
      ? geometry.index.count / 3 // indexed geometry
      : position.count / 3; // non-indexed geometry

    // Respect drawRange if it's been limited
    if (geometry.drawRange.count !== Infinity) {
      count = Math.min(count, geometry.drawRange.count / 3);
    }

    // InstancedMesh draws the geometry N times
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      count *= (mesh as THREE.InstancedMesh).count;
    }

    total += count;
  });

  return Math.floor(total);
}

export function meshWithWireframe(mesh: THREE.Mesh) {
  const group = new THREE.Group();
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    wireframe: true,
  });
  const wireframeMesh = new THREE.Mesh(mesh.geometry, wireframeMaterial);
  group.add(mesh);
  group.add(wireframeMesh);
  return group;
}