import * as THREE from "three";

export function rock_createGeometry(seed: number) {
  const geom = new THREE.SphereGeometry(1, 50, 14);

  const attr_pos = geom.attributes.position;

  for (let i = 0; i < attr_pos.count; i++) {
    const x = attr_pos.getX(i);
    const y = attr_pos.getY(i);
    const z = attr_pos.getZ(i);

    const f =
      1 +
      Math.sin(x * 3.9 + seed) *
        Math.sin(y * 3.1 + 3.0) *
        Math.cos(z * 4.2) *
        0.18 +
      Math.sin(x * 12.3 + z * 8.1 + seed) * Math.sin(y * 10.7) * 0.075 +
      Math.sin(x * 27.1 + y * 18.4) * Math.cos(z * 23.7 + seed) * 0.022;

    attr_pos.setXYZ(i, x * f, y * f, z * f);
  }

  geom.computeVertexNormals();

  return geom;
}

export function rock_createMesh(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  options?: {
    showWireframe?: boolean
  }
) {
  const material = new THREE.MeshStandardMaterial({
    color: color,
  });
  const mesh = new THREE.Mesh(geometry, material);

  if (options?.showWireframe) {
    const group = new THREE.Group();
    const wireframeMaterial = new THREE.MeshBasicMaterial({
      color: color,
      wireframe: true,
    });
    const wireframeMesh = new THREE.Mesh(geometry, wireframeMaterial);
    group.add(mesh);
    group.add(wireframeMesh);

    return group;
  }

  return mesh;
}

export function dev_light_createSimple(): THREE.Light {
  const light = new THREE.PointLight("#ffffff", 100);
  light.position.set(5, 5, 5);
  return light;
}
