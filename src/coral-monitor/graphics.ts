import * as THREE from "three";
import _ from "lodash";

const TAU = Math.PI * 2;
const SINGLE_GEOMETRY_MAX_VERTEX = 65536;
const UP = new THREE.Vector3(0, 1, 0);

export type GetRandomFunc = () => number;

export function seeded(seed = 73129): GetRandomFunc {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/**
 * Create a cylindrical segment connecting two points with specified radii and sides.
 *
 * NOTE: The zero point of the cylinder is at the midpoint between points a and b.
 * @returns {THREE.CylinderGeometry}
 */
function cylinder_createGeometry(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radiusA: number,
  radiusB: number,
  sides = 6,
) {
  const delta = new THREE.Vector3().subVectors(b, a);

  const geom = new THREE.CylinderGeometry(
    radiusB,
    radiusA,
    delta.length(),
    sides,
    1,
    false,
  );

  const q = new THREE.Quaternion().setFromUnitVectors(
    UP,
    delta.clone().normalize(),
  );

  geom.applyQuaternion(q);
  geom.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);

  return geom;
}

/**
 * Create a branching coral. The base of the coral is at the specified origin (x, y, z).
 *
 */
export function branchCoral_createGeometry(
  x: number,
  y: number,
  z: number,
  size: number,
  rng: GetRandomFunc,
  branchingLevelCnt = 4,
) {
  const origin = new THREE.Vector3(x, y, z);
  const angle = rng() * TAU;

  const segment_list: Array<THREE.BufferGeometry> = [];

  const grow = (
    start: THREE.Vector3,
    dir: THREE.Vector3,
    length: number,
    radius: number,
    branchLevel: number,
  ) => {
    const end = start.clone().addScaledVector(dir, length);
    const mid = start
      .clone()
      .lerp(end, 0.52)
      .add(
        new THREE.Vector3(
          (rng() - 0.5) * length * 0.1,
          0,
          (rng() - 0.5) * length * 0.1,
        ),
      );

    const curve = new THREE.CatmullRomCurve3([start, mid, end]);

    const sides = radius > 0.013 ? 7 : 5;
    const steps = radius > 0.02 ? 4 : 3;

    const branch = new THREE.TubeGeometry(curve, steps, radius, sides, false);
    const bp = branch.attributes.position;

    for (let i = 0; i < bp.count; i++) {
      const row = Math.floor(i / (sides + 1));
      const t = row / steps;
      const c = curve.getPointAt(t);
      const taper = 1 - t * 0.48;

      bp.setXYZ(
        i,
        c.x + (bp.getX(i) - c.x) * taper,
        c.y + (bp.getY(i) - c.y) * taper,
        c.z + (bp.getZ(i) - c.z) * taper,
      );
    }

    branch.computeVertexNormals();

    segment_list.push(branch);

    if (branchLevel <= 0) {
      const tip = end.clone().addScaledVector(dir, length * 0.12);
      const branch = cylinder_createGeometry(
        end,
        tip,
        radius * 0.54,
        radius * 0.18,
        7,
      );
      segment_list.push(branch);

      return;
    }

    const forks = branchLevel > 1 ? 3 : 2;
    for (let j = 0; j < forks; j++) {
      const nd = new THREE.Vector3(
        (rng() - 0.5) * 1.5,
        0.5 + rng() * 0.7,
        (rng() - 0.5) * 1.5,
      );
      nd.addScaledVector(dir, 0.5).normalize();
      grow(end, nd, length * (0.63 + rng() * 0.1), radius * 0.69, branchLevel - 1);
    }
  };

  const crown = origin.clone().add(new THREE.Vector3(0, size * 0.12, 0));

  const rootBranch = cylinder_createGeometry(
    origin,
    crown,
    size * 0.07,
    size * 0.05,
    7,
  );
  segment_list.push(rootBranch);

  const trunks = size > 1.8 ? 4 : 3;

  for (let j = 0; j < trunks; j++) {
    const a = angle + (j / trunks) * TAU;
    const dir = new THREE.Vector3(
      Math.cos(a) * 0.55,
      0.7 + rng() * 0.35,
      Math.sin(a) * 0.55,
    );

    grow(crown, dir.normalize(), size * 0.27, size * 0.041, branchingLevelCnt);
  }

  const mergedGeometry = mergeGeometry(segment_list);
  return mergedGeometry;
}

function mergeGeometry(
  listGeom: Array<THREE.BufferGeometry>,
): THREE.BufferGeometry {
  if (listGeom.length === 0) {
    const g = new THREE.BufferGeometry();

    // Return an empty geometry with a position attribute to avoid errors later
    g.setAttribute("position", new THREE.Float32BufferAttribute([], 3));

    return g;
  }

  if (listGeom.length === 1) {
    return listGeom[0];
  }

  const vertexCount = _.sum(listGeom.map((g) => g.attributes.position.count));
  const indexCount = _.sum(listGeom.map((g) => g.index?.count ?? 0));

  const mergedGeom = new THREE.BufferGeometry();

  for (let attr_name in listGeom[0].attributes) {
    const attr_value = listGeom[0].attributes[attr_name];
    const arrayCtor = attr_value.array.constructor as new (
      length: number,
    ) => typeof attr_value.array;
    const array = new arrayCtor(vertexCount * attr_value.itemSize);

    let offset = 0;

    for (const part of listGeom) {
      const a = part.attributes[attr_name].array;
      array.set(a, offset);
      offset += a.length;
    }

    const attribute = new THREE.BufferAttribute(
      array,
      attr_value.itemSize,
      attr_value.normalized,
    );

    attribute.gpuType = (attr_value as THREE.BufferAttribute).gpuType;
    mergedGeom.setAttribute(attr_name, attribute);
  }

  const indices =
    vertexCount <= SINGLE_GEOMETRY_MAX_VERTEX
      ? new Uint16Array(indexCount)
      : new Uint32Array(indexCount);

  let cursor = 0;
  let base = 0;

  for (const geom of listGeom) {
    for (const index of geom.index?.array ?? []) {
      indices[cursor++] = index + base;
    }

    base += geom.attributes.position.count;
    geom.dispose();
  }

  mergedGeom.setIndex(new THREE.BufferAttribute(indices, 1));
  return mergedGeom;
}

export function createLight_simple(): THREE.Light {
  const light = new THREE.PointLight("#ffffff", 100);
  light.position.set(5, 5, 5);
  return light;
}

export function createMesh_simple(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  options?: {
    showWireframe?: boolean;
  },
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
