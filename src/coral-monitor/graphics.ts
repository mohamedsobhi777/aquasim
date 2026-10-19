import XXH from "xxhashjs";
import FastNoiseLite from "./lib-external/fastnoise-lite";
import * as THREE from "three";
import _ from "lodash";

const TAU = Math.PI * 2;
const SINGLE_GEOMETRY_MAX_VERTEX = 65536;
const UP = new THREE.Vector3(0, 1, 0);

function meshWithWireframe(mesh: THREE.Mesh) {
  const group = new THREE.Group();
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    wireframe: true,
  });
  const wireframeMesh = new THREE.Mesh(mesh.geometry, wireframeMaterial);
  group.add(mesh);
  group.add(wireframeMesh);
  return group;
}

export function coralThorn_createGeom(
  baseRadius: number,
  length: number,
  control_baseRatio: number,
  control_tipRatio: number,
) {
  const profile = new THREE.Path();
  profile.moveTo(baseRadius, 0);

  profile.bezierCurveTo(
    baseRadius,
    length * control_baseRatio,
    baseRadius * control_tipRatio,
    length,
    0,
    length,
  );

  const points = profile.getPoints(64);
  const thorn_geom = new THREE.LatheGeometry(points, 48);

  return thorn_geom;
}

// Lookup table for the thorn profile: height (0..1) at a normalized distance r (0..1)
// from the thorn center. Uses the same Bézier as coralThorn_createGeom, with
// radius 1 and length 1.
function thornHeightLUT(
  control_baseRatio: number,
  control_tipRatio: number,
  samples = 64,
) {
  const profile = new THREE.Path();
  profile.moveTo(1, 0);
  profile.bezierCurveTo(1, control_baseRatio, control_tipRatio, 1, 0, 1);
  const pts = profile.getPoints(samples); // r goes 1 -> 0 while y goes 0 -> 1

  return (r: number) => {
    if (r >= 1) return 0;
    if (r <= 0) return 1;
    for (let n = 0; n < pts.length - 1; n++) {
      const a = pts[n],
        b = pts[n + 1]; // a.x >= r >= b.x
      if (r <= a.x && r >= b.x) {
        const t = (a.x - r) / (a.x - b.x || 1);
        return a.y + (b.y - a.y) * t;
      }
    }
    return 0;
  };
}

export function coralBranch_createMesh(
  listBasisPoint: Array<THREE.Vector3>,
  radius: number,
  thornRadius: number,
  thornLength: number,
  control_baseRatio: number,
  control_tipRatio: number,
) {
  const radialSegmentCnt = 160;
  const tubeSegmentCnt = 160;
  const tubeClosed = false;

  const curve = new THREE.CatmullRomCurve3(listBasisPoint);
  const tube_geom = new THREE.TubeGeometry(
    curve,
    tubeSegmentCnt,
    radius,
    radialSegmentCnt,
    tubeClosed,
  );

  const heightAt = thornHeightLUT(control_baseRatio, control_tipRatio);

  const tubeSegLen = curve.getLength() / tubeSegmentCnt;
  const radialSegLen = 2 * radius * Math.sin(TAU / radialSegmentCnt);

  const thorn_tubeSegCnt = Math.ceil(thornLength / tubeSegLen);
  const thorn_radialSegCnt = Math.ceil(thornRadius / radialSegLen);

  const thorn_alongTubeCnt = Math.floor(tubeSegmentCnt / thorn_tubeSegCnt);
  const thorn_alongRadialCnt = Math.floor(
    radialSegmentCnt / thorn_radialSegCnt,
  );

  const pos = tube_geom.attributes.position as THREE.BufferAttribute;
  const nor = tube_geom.attributes.normal as THREE.BufferAttribute;

  for (let i = 0; i <= tubeSegmentCnt; ++i) {
    const ci = Math.floor(i / thorn_tubeSegCnt);
    if (ci >= thorn_alongTubeCnt) {
      continue;
    }

    for (let j = 0; j <= radialSegmentCnt; ++j) {
      const cj = Math.floor(j / thorn_alongRadialCnt);
      if (cj >= thorn_alongRadialCnt) {
        continue;
      }

      // Distance from the cell center, in world units
      const di =
        (i - (ci * thorn_tubeSegCnt + thorn_tubeSegCnt / 2)) / thorn_tubeSegCnt;
      const dj =
        (j - (cj * thorn_radialSegCnt + thorn_radialSegCnt / 2)) /
        thorn_radialSegCnt;
      const d = Math.hypot(di, dj);
      if (d >= 1) {
        continue;
      }

      const h = thornLength * heightAt(d);
      const idx = i * (radialSegmentCnt + 1) + j;
      pos.setXYZ(
        idx,
        pos.getX(idx) + nor.getX(idx) * h,
        pos.getY(idx) + nor.getY(idx) * h,
        pos.getZ(idx) + nor.getZ(idx) * h,
      );
    }
  }
  pos.needsUpdate = true;

  // Recompute normals for lighting, then average them across the seam
  // so the duplicated column doesn't leave a visible line
  tube_geom.computeVertexNormals();
  const n = tube_geom.attributes.normal as THREE.BufferAttribute;
  const tmp = new THREE.Vector3(),
    tmp2 = new THREE.Vector3();
  for (let i = 0; i <= tubeSegmentCnt; i++) {
    const a = i * (radialSegmentCnt + 1),
      b = a + radialSegmentCnt;
    tmp
      .fromBufferAttribute(n, a)
      .add(tmp2.fromBufferAttribute(n, b))
      .normalize();
    n.setXYZ(a, tmp.x, tmp.y, tmp.z);
    n.setXYZ(b, tmp.x, tmp.y, tmp.z);
  }
  n.needsUpdate = true;
  tube_geom.computeBoundingSphere();

  const tube_mesh = new THREE.Mesh(
    tube_geom,
    new THREE.MeshStandardMaterial({ color: "#695f5f" }),
  );

  return tube_mesh;
}

// **************************

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
function cylinder_createGeometryOld(
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
      const branch = cylinder_createGeometryOld(
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
      grow(
        end,
        nd,
        length * (0.63 + rng() * 0.1),
        radius * 0.69,
        branchLevel - 1,
      );
    }
  };

  const crown = origin.clone().add(new THREE.Vector3(0, size * 0.12, 0));

  const rootBranch = cylinder_createGeometryOld(
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
  const light = new THREE.PointLight("#ffffff", 150);
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
