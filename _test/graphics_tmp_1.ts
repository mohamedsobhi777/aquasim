import XXH from "xxhashjs";
import FastNoiseLite from "./lib-external/fastnoise-lite";
import * as THREE from "three";
import _ from "lodash";

function brainColor() {
  const setupUV = (params: { sphere: THREE.SphereGeometry }) => {
    const { sphere } = params;

    const attr_position = sphere.attributes.position;
    const attr_uv = sphere.attributes.uv;

    for (let i = 0; i < attr_position.count; i++) {
      const x = attr_position.getX(i);
      const y = attr_position.getY(i);
      const z = attr_position.getZ(i);

      const horizontalDistance = Math.hypot(x, z);
      const theta = Math.atan2(horizontalDistance, y);

      // Pole -> 0; hemisphere rim -> 0.5.
      const imageRadius = theta / PI;

      if (horizontalDistance < 1e-8) {
        attr_uv.setXY(i, 0.5, 0.5);
      } else {
        attr_uv.setXY(
          i,
          0.5 + (imageRadius * x) / horizontalDistance,
          0.5 - (imageRadius * z) / horizontalDistance,
        );
      }
    }

    attr_uv.needsUpdate = true;
  };
}

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

export function coralBranch_createMesh(params: {
  listBasisPoint: Array<THREE.Vector3>;
  radius: number;
  capHeight: number;
  thorn_radius: number;
  thorn_spacing: number;
  thorn_length: number;
  thorn_control_baseRatio: number;
  thorn_control_tipRatio: number;
}) {
  const tube_radialSegCnt = 128;
  const tube_alongSegCnt = 128;
  const tube_closed = false;
  const thorn_curvePointSampleCnt = 64;

  const {
    listBasisPoint,
    radius,
    capHeight,
    thorn_radius,
    thorn_spacing,
    thorn_length,
    thorn_control_baseRatio,
    thorn_control_tipRatio,
  } = params;

  const tube_curve = new THREE.CatmullRomCurve3(listBasisPoint);

  const tube_alongSegLen = tube_curve.getLength() / tube_alongSegCnt;
  const tube_radialSegLen = 2 * radius * Math.sin(TAU / tube_radialSegCnt / 2);

  // @region [sub]
  const thorn_getHeightAt = (
    r: number,
    thorn_normalizedCurvePts: Array<THREE.Vector2>,
  ) => {
    if (r >= 1) {
      return 0;
    }

    if (r <= 0) {
      return 1;
    }

    for (let n = 0; n < thorn_normalizedCurvePts.length - 1; ++n) {
      // a.x >= r >= b.x
      const a = thorn_normalizedCurvePts[n];
      const b = thorn_normalizedCurvePts[n + 1];

      if (r <= a.x && r >= b.x) {
        const t = (a.x - r) / (a.x - b.x || 1);
        return a.y + (b.y - a.y) * t;
      }
    }
    return 0;
  };

  const thorn_getBaseHash = () => {
    const xxh = XXH.h64(0xabcd);

    for (const pt of listBasisPoint) {
      xxh.update(`[${pt.x},${pt.y},${pt.z}]`);
    }

    xxh.update(
      `[${thorn_radius},${thorn_length},${thorn_control_baseRatio},${thorn_control_tipRatio}]`,
    );

    return xxh;
  };

  const thorn_getCenterNoise = () => {
    const xxh = thorn_getBaseHash();
    xxh.update("thorncenter");

    const randSeed = xxh.digest().toNumber();
    const noise = new FastNoiseLite(randSeed);

    return noise;
  };

  const thorn_getHeightNoise = () => {
    const xxh = thorn_getBaseHash();
    xxh.update("thornheight");

    const randSeed = xxh.digest().toNumber();
    const noise = new FastNoiseLite(randSeed);
    noise.SetFrequency(0.01);

    return noise;
  };

  const tube_createGeom = () => {
    return new THREE.TubeGeometry(
      tube_curve,
      tube_alongSegCnt,
      radius,
      tube_radialSegCnt,
      tube_closed,
    );
  };

  const cap_createGeom = () => {
    const cap_curvePath = new THREE.Path();
    cap_curvePath.moveTo(radius, 0);
    cap_curvePath.bezierCurveTo(
      radius,
      capHeight * 0.55,
      radius * 0.55,
      capHeight,
      0,
      capHeight,
    );

    const tubeCap_geom = new THREE.LatheGeometry(
      cap_curvePath.getPoints(32),
      tube_radialSegCnt,
    );

    const idx = tube_alongSegCnt;
    const T = tube_geom.tangents[idx].clone();
    const N = tube_geom.normals[idx].clone();
    const B = tube_geom.binormals[idx].clone();
    const P = tube_curve.getPointAt(1);

    const X = B.clone().negate();
    const Y = T;
    const Z = N.clone().negate();

    const m = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(P);
    tubeCap_geom.applyMatrix4(m);

    return tubeCap_geom;
  };
  // @endregion [sub]

  const tube_geom = tube_createGeom();
  const cap_geom = cap_createGeom();

  const thorn_normalizedCurvePath = new THREE.Path();
  thorn_normalizedCurvePath.moveTo(1, 0);
  thorn_normalizedCurvePath.bezierCurveTo(
    1,
    thorn_control_baseRatio,
    thorn_control_tipRatio,
    1,
    0,
    1,
  );
  const thorn_normalizedCurvePts = thorn_normalizedCurvePath.getPoints(
    thorn_curvePointSampleCnt,
  );

  const thorn_cellSize = 2 * thorn_radius + thorn_spacing;

  const thorn_alongSegCnt = Math.ceil((2 * thorn_cellSize) / tube_alongSegLen);
  const thorn_radialSegCnt = Math.ceil(
    (2 * thorn_cellSize) / tube_radialSegLen,
  );

  const thorn_alongCnt = Math.floor(tube_alongSegCnt / thorn_alongSegCnt);
  const thorn_radialCnt = Math.floor(tube_radialSegCnt / thorn_radialSegCnt);

  let pos = tube_geom.attributes.position as THREE.BufferAttribute;
  let nor = tube_geom.attributes.normal as THREE.BufferAttribute;

  const thorn_centerNoise = thorn_getCenterNoise();
  const thorn_heightNoise = thorn_getHeightNoise();

  for (let i = 0; i <= tube_alongSegCnt; ++i) {
    const thorn_i = Math.floor(i / thorn_alongSegCnt);
    if (thorn_i >= thorn_alongCnt) {
      continue;
    }

    for (let j = 0; j <= tube_radialSegCnt; ++j) {
      const thorn_j = Math.floor(j / thorn_radialSegCnt);
      if (thorn_j >= thorn_radialCnt) {
        continue;
      }

      let thorn_center_i = thorn_i * thorn_alongSegCnt + thorn_alongSegCnt / 2;
      let thorn_center_j =
        thorn_j * thorn_radialSegCnt + thorn_radialSegCnt / 2;

      const ACCEPT_RANGE_RATIO = 0.8;

      thorn_center_i +=
        thorn_alongSegCnt *
        0.5 *
        ACCEPT_RANGE_RATIO *
        thorn_centerNoise.GetNoise(i, j);
      thorn_center_j +=
        thorn_radialSegCnt *
        0.5 *
        ACCEPT_RANGE_RATIO *
        thorn_centerNoise.GetNoise(i, j);

      // Distance from the cell center, in world units
      const di = (i - thorn_center_i) * tube_alongSegLen;
      const dj = (j - thorn_center_j) * tube_radialSegLen;
      const d = Math.hypot(di, dj) / thorn_radius;
      if (d >= 1) {
        continue;
      }

      let h = thorn_getHeightAt(d, thorn_normalizedCurvePts) * thorn_length;
      h *= Math.abs(thorn_heightNoise.GetNoise(i, j));

      const idx = i * (tube_radialSegCnt + 1) + j;
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

  nor = tube_geom.attributes.normal as THREE.BufferAttribute;

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  for (let i = 0; i <= tube_alongSegCnt; i++) {
    const a = i * (tube_radialSegCnt + 1);
    const b = a + tube_radialSegCnt;
    tmp
      .fromBufferAttribute(nor, a)
      .add(tmp2.fromBufferAttribute(nor, b))
      .normalize();
    nor.setXYZ(a, tmp.x, tmp.y, tmp.z);
    nor.setXYZ(b, tmp.x, tmp.y, tmp.z);
  }
  nor.needsUpdate = true;

  tube_geom.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({ color: "#d59a58" });

  const tube_mesh = new THREE.Mesh(tube_geom, material);
  const tubeCap_mesh = new THREE.Mesh(cap_geom, material);

  tube_mesh.add(tubeCap_mesh);

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
