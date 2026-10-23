import * as THREE from "three";
import _ from "lodash";
import { BufferGeometryUtils } from "three/examples/jsm/Addons.js";
import seedrandom from "seedrandom";

import { TAU, UP_DIR, DEG2RAD, ZERO_VEC } from "./const";
import type { RandomFunc } from "../types";
import { object3D_countTriangle } from "./lib/graphics";

import weightedSelect from "./lib-external/weighted";

interface CoralBranchTube {
  /** Combination of tube and cap */
  geom: THREE.BufferGeometry;
  curve: THREE.Curve<THREE.Vector3>;
  tube_geom: THREE.TubeGeometry;
  tube_radialSegCnt: number;
  tube_radius: number;
}

class GeometryMerger {
  listGeom: Array<THREE.BufferGeometry | InstancedGeometryCollection> = [];

  constructor() {}

  push(geom: THREE.BufferGeometry | InstancedGeometryCollection) {
    this.listGeom.push(geom);
  }

  merge() {
    let listBufferGeom: Array<THREE.BufferGeometry> = [];

    for (const geom of this.listGeom) {
      if (geom instanceof THREE.BufferGeometry) {
        listBufferGeom.push(geom);
      } else if ("listMat4" in geom) {
        const collection = geom as InstancedGeometryCollection;

        const mat4 = new THREE.Matrix4();

        for (let i = 0; i < collection.count; i++) {
          const instance = collection.geom.clone();
          mat4.fromArray(collection.listMat4, i * 16);
          instance.applyMatrix4(mat4);
          listBufferGeom.push(instance);
        }
      }
    }

    return BufferGeometryUtils.mergeGeometries(listBufferGeom);
  }
}

/**
 * @param {THREE.Vector3} params.rootNormalVec
 *    The normal vector of the surface where the coral is rooted
 * @param {number} params.rootCeilingHeight
 *    The maximum height from the surface to the tip of the root branch of the coral
 *
 * The mesh zero point is at the base of the coral where it is rooted
 */
export function branchingCoral_generate(params: {
  root_forwardVec: THREE.Vector3;
  root_ceilingHeight: number;
  root_radius: number;
  growthLevelCnt: number;
  material: THREE.Material;
  seedHash: string;
}) {
  interface growCoral_QueueItem {
    branch: CoralBranchTube;
    growthLevel: number;
  }

  const thorn_radius = 0.01;
  const thorn_height = 0.06;
  const thorn_spacing = 0.06;
  const thorn_tiltAngle_rad = 20 * DEG2RAD;

  const branchingPoint_maxCnt = 3;
  const branchMaxCntPerBranchingPt = 2;

  // @region [sub]
  const branchTube_cap_createGeom = (params: {
    capHeight: number;
    tube_radius: number;
    tube_radialSegCnt: number;
    tube_tubeSegCnt: number;
    tube_geom: THREE.TubeGeometry;
    tube_curve: THREE.Curve<THREE.Vector3>;
  }) => {
    const capCurve_divisionCnt = 8;
    const capCurve_baseCpFactor = 0.5;
    const capCurve_tipCpFactor = 0.1;

    const {
      capHeight,
      tube_radius,
      tube_radialSegCnt,
      tube_tubeSegCnt,
      tube_geom,
      tube_curve,
    } = params;

    const cap_curvePath = new THREE.Path();
    cap_curvePath.moveTo(tube_radius, 0);
    cap_curvePath.bezierCurveTo(
      tube_radius,
      capHeight * capCurve_baseCpFactor,
      tube_radius * capCurve_tipCpFactor,
      capHeight,
      0,
      capHeight,
    );

    const tubeCap_geom = new THREE.LatheGeometry(
      cap_curvePath.getPoints(capCurve_divisionCnt),
      tube_radialSegCnt,
    );

    const T = tube_geom.tangents[tube_tubeSegCnt].clone();
    const N = tube_geom.normals[tube_tubeSegCnt].clone();
    const B = tube_geom.binormals[tube_tubeSegCnt].clone();
    const P = tube_curve.getPointAt(1);

    const X = B.clone().negate();
    const Y = T;
    const Z = N.clone().negate();

    const m = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(P);
    tubeCap_geom.applyMatrix4(m);

    return tubeCap_geom;
  };

  const branchTube_generate = (params: {
    parentBranch_forwardVec: THREE.Vector3;
    ceil_pt: THREE.Vector3;
    radius: number;
    randFn: RandomFunc;
  }): CoralBranchTube => {
    const originCpt_vertSectionConstraints_ratio = [0.1, 0.9];
    const ceilCpt_horizSectionConstraints_ratio = [0.1, 0.5];
    const ceilCpt_vertSectionConstraints_ratio = [0.1, 0.6];

    const tube_tubeSegCnt = 20;
    const tube_radialSegCnt = 8;
    const capHeight = 0.1;

    const { parentBranch_forwardVec, radius, ceil_pt, randFn } = params;

    const ground_pt = ceil_pt.clone().projectOnVector(parentBranch_forwardVec);
    const horiz_vec = ground_pt.clone().sub(ZERO_VEC);
    const vert_vec = ceil_pt.clone().sub(ground_pt);

    const originCpt = ZERO_VEC.clone().addScaledVector(
      vert_vec,
      originCpt_vertSectionConstraints_ratio[0] +
        (originCpt_vertSectionConstraints_ratio[1] -
          originCpt_vertSectionConstraints_ratio[0]) *
          randFn(),
    );

    const ceilCpt = ZERO_VEC.clone()
      .addScaledVector(
        horiz_vec,
        ceilCpt_horizSectionConstraints_ratio[0] +
          (ceilCpt_horizSectionConstraints_ratio[1] -
            ceilCpt_horizSectionConstraints_ratio[0]) *
            randFn(),
      )
      .addScaledVector(
        vert_vec,
        ceilCpt_vertSectionConstraints_ratio[0] +
          (ceilCpt_vertSectionConstraints_ratio[1] -
            ceilCpt_vertSectionConstraints_ratio[0]) *
            randFn(),
      );

    const tube_curve = new THREE.CubicBezierCurve3(
      ZERO_VEC,
      originCpt,
      ceilCpt,
      ceil_pt,
    );

    const tube_geom = new THREE.TubeGeometry(
      tube_curve,
      tube_tubeSegCnt,
      radius,
      tube_radialSegCnt,
      false,
    );

    const tubeCap_geom = branchTube_cap_createGeom({
      capHeight: capHeight,
      tube_radius: radius,
      tube_radialSegCnt,
      tube_tubeSegCnt,
      tube_geom: tube_geom,
      tube_curve: tube_curve,
    });

    const tubeFinal_geom = BufferGeometryUtils.mergeGeometries([
      tube_geom,
      tubeCap_geom,
    ]);

    return {
      geom: tubeFinal_geom,
      curve: tube_curve,
      tube_geom: tube_geom,
      tube_radialSegCnt: tube_radialSegCnt,
      tube_radius: radius,
    };
  };

  const rootBranchTube_generate = (params: {
    forward_vec: THREE.Vector3;
    ceilingHeight: number;
    radius: number;
    randFn: RandomFunc;
  }) => {
    const ceil_gapConstraints_ratio = [0.4, 1.5];

    const { forward_vec, ceilingHeight, radius, randFn } = params;

    const rand_rotation = randFn() * TAU;

    const forward_dir = forward_vec
      .clone()
      .normalize()
      .applyAxisAngle(UP_DIR, rand_rotation);
    const N = UP_DIR.clone().cross(forward_vec).normalize();
    const localUp_dir = forward_vec.clone().cross(N).normalize();

    const ceil_gapConstraint =
      ceilingHeight *
      (ceil_gapConstraints_ratio[0] +
        (ceil_gapConstraints_ratio[1] - ceil_gapConstraints_ratio[0]) *
          randFn());

    const ceil_pt = ZERO_VEC.clone()
      .addScaledVector(
        forward_dir,
        -ceil_gapConstraint + 2 * ceil_gapConstraint * randFn(),
      )
      .addScaledVector(localUp_dir, ceilingHeight);

    const branch = branchTube_generate({
      parentBranch_forwardVec: forward_dir,
      ceil_pt,
      radius,
      randFn,
    });

    return branch;
  };

  /**
   * See prob.gbb file to understand about the choice of function for computing selection weight
   */
  const branchingPointCnt_generate = (params: {
    curGrowthLevel: number;
    growthLevelCnt: number;
    randFn: RandomFunc;
  }) => {
    const expoFn_base = 1.383;
    const expoFn_yDownShift = 0.8;
    const weightDecayFactor = 2;

    const { curGrowthLevel, growthLevelCnt, randFn } = params;

    const listChoice: Array<number> = [];
    const listWeight: Array<number> = [];

    const d = branchingPoint_maxCnt / growthLevelCnt;

    for (let x = 0; x <= branchingPoint_maxCnt; x++) {
      const x1 = x - (curGrowthLevel - growthLevelCnt) * d;
      const f_x1 = Math.pow(expoFn_base, x1) - expoFn_yDownShift;

      const x2 =
        branchingPoint_maxCnt -
        weightDecayFactor * (x1 - branchingPoint_maxCnt);
      const g_x2 = Math.pow(expoFn_base, x2) - expoFn_yDownShift;

      const w = Math.min(f_x1, g_x2);
      if (w < 0) {
        continue;
      }

      listChoice.push(x);
      listWeight.push(w);
    }

    if (listChoice.length === 0) {
      return 0;
    }

    if (listChoice.length === 1) {
      return listChoice[0];
    }

    return weightedSelect(listChoice, listWeight, { rand: randFn });
  };

  const branchingLocation_generate = (params: {
    branchingPointCnt: number;
    randFn: RandomFunc;
  }) => {
    const locationConstraints_ratio = [0.05, 0.9];

    const { branchingPointCnt, randFn } = params;

    const listLocation: Array<number> = [];

    for (let i = 0; i < branchingPointCnt; i++) {
      const rand_location =
        locationConstraints_ratio[0] +
        (locationConstraints_ratio[1] - locationConstraints_ratio[0]) *
          randFn();
      listLocation.push(rand_location);
    }

    listLocation.sort();

    return listLocation;
  };

  const branch_generate = (params: {
    parentBranch: CoralBranchTube;
    parentGrowthLevel: number;
    location: number;
    queue: Array<growCoral_QueueItem>;
    randFn: RandomFunc;
  }) => {

  }

  const growCoral = (params: {
    rootBranch: CoralBranchTube;
    merger: GeometryMerger;
    randFn: RandomFunc;
  }) => {
    const { rootBranch, merger, randFn } = params;

    let queue: Array<growCoral_QueueItem> = [];
    queue.push({
      branch: rootBranch,
      growthLevel: growthLevelCnt,
    });

    while (queue.length > 0) {
      const { branch: curBranch, growthLevel: curGrowthLevel } = queue.shift()!;

      merger.push(curBranch.geom);

      const curBranch_thornCol = branchTube_createThorns({
        thorn_radius,
        thorn_height,
        thorn_spacing,
        thorn_tiltAngle_rad,
        tube_curve: curBranch.curve,
        tube_radius: curBranch.tube_radius,
        tube_geom: curBranch.tube_geom,
        tube_radialSegCnt: curBranch.tube_radialSegCnt,
      });
      merger.push(curBranch_thornCol);

      if (curGrowthLevel == 0) {
        continue;
      }

      const branchingPointCnt = branchingPointCnt_generate({
        curGrowthLevel,
        growthLevelCnt,
        randFn,
      });
      if (branchingPointCnt == 0) {
        continue;
      }

      const listBranchLocation = branchingLocation_generate({
        branchingPointCnt,
        randFn,
      });

      for (const location of listBranchLocation) {
        branch_generate({
          parentBranch: curBranch,
          parentGrowthLevel: curGrowthLevel,
          location,
          queue,
          randFn,
        });
      }
    }
  };
  // @endregion [sub]

  const {
    seedHash,
    root_forwardVec,
    root_radius,
    material,
    root_ceilingHeight,
    growthLevelCnt,
  } = params;
  const randFn = seedrandom(seedHash);

  const merger = new GeometryMerger();

  const rootBranchTube = rootBranchTube_generate({
    forward_vec: root_forwardVec,
    ceilingHeight: root_ceilingHeight,
    radius: root_radius,
    randFn,
  });
  growCoral({
    rootBranch: rootBranchTube,
    merger,
    randFn,
  });

  const rootBranchTube_finalGeom = merger.merge();

  const rootBranchTube_mesh = new THREE.Mesh(
    rootBranchTube_finalGeom,
    material,
  );

  return rootBranchTube_mesh;
}

/**
 * Represent a N copy of the same geometry, each with its own transformation matrix.
 */
interface InstancedGeometryCollection {
  /** N: Number of instances */
  count: number;

  geom: THREE.BufferGeometry;

  /**
   * Size:  N * 16
   * Transformation matrices for each instance (4x4 matrix per instance)
   */
  listMat4: Float32Array;
}

function branchTube_createThorns(params: {
  thorn_radius: number;
  thorn_height: number;
  thorn_spacing: number;
  thorn_tiltAngle_rad: number;
  tube_curve: THREE.Curve<THREE.Vector3>;
  tube_radius: number;
  tube_geom: THREE.TubeGeometry;
  tube_radialSegCnt: number;
}): InstancedGeometryCollection {
  // #region [sub]

  /**
   * Build the shared thorn LatheGeometry from `thorn_curvePath`.
   * The profile is normalized so that:
   *  - base sits at y = 0, tip at y = height
   *  - widest point has x = radius
   * LatheGeometry revolves around +Y => thorn local "up" is +Y.
   */
  const thorn_createGeom = (
    radius: number,
    height: number,
  ): THREE.LatheGeometry => {
    const curve_baseCpFactor = 0.2;
    const curve_tipCpFactor = 0.8;

    const curve_divisionCnt = 4;
    const lathe_segCnt = 4;

    // This curve is "normalized": Start at (1, 0) and end at (0, 1)
    const curve = new THREE.CubicBezierCurve(
      new THREE.Vector2(1, 0),
      new THREE.Vector2(1, curve_baseCpFactor),
      new THREE.Vector2(curve_tipCpFactor, 1),
      new THREE.Vector2(0, 1),
    );

    const curve_pts = curve
      .getPoints(curve_divisionCnt)
      .map((p) => new THREE.Vector2(p.x * radius, p.y * height));

    return new THREE.LatheGeometry(curve_pts, lathe_segCnt);
  };

  /**
   * Number of frame segments stored in tube_geom.
   * TubeGeometry stores (tubularSegments + 1) frames; validate against tube_tubeSegCnt.
   */
  const tube_resolveFrameSegCnt = (
    geom: THREE.TubeGeometry,
    expectedSegCnt: number,
  ): number => {
    const storedSegCnt = geom.tangents.length - 1;
    if (storedSegCnt !== expectedSegCnt) {
      console.warn(
        `[branchTube_createThorns] tube_tubeSegCnt (${expectedSegCnt}) does not match ` +
          `tube_geom frames (${storedSegCnt}). Using ${storedSegCnt}.`,
      );
      return storedSegCnt;
    }
    return expectedSegCnt;
  };

  /**
   * Interpolate the tube's frame (T, N, B) at arc-length parameter u in [0, 1].
   * Uses the exact frames TubeGeometry was built with, so thorns follow the tube's twist.
   */
  const tube_sampleFrame = (
    geom: THREE.TubeGeometry,
    frameSegCnt: number,
    u: number,
    outT: THREE.Vector3,
    outN: THREE.Vector3,
    outB: THREE.Vector3,
  ): void => {
    const f = THREE.MathUtils.clamp(u, 0, 1) * frameSegCnt;
    const i0 = Math.min(Math.floor(f), frameSegCnt - 1);
    const a = f - i0;

    outT.lerpVectors(geom.tangents[i0], geom.tangents[i0 + 1], a).normalize();
    outN.lerpVectors(geom.normals[i0], geom.normals[i0 + 1], a);
    outN.addScaledVector(outT, -outN.dot(outT)).normalize(); // re-orthogonalize
    outB.crossVectors(outT, outN); // same convention as computeFrenetFrames
  };

  /**
   * Write one thorn's transform into `out`.
   *  - n: outward surface normal at the thorn
   *  - T: tube tangent (toward tip)
   *  - basePos: center of thorn base on the tube surface (point A)
   */
  const thorn_composeMatrix = (
    basePos: THREE.Vector3,
    n: THREE.Vector3,
    T: THREE.Vector3,
    cosTilt: number,
    sinTilt: number,
    sink: number,
    out: THREE.Matrix4,
  ): void => {
    // Displacement vector A -> B on the surface (toward tip).
    // For an offset surface S(u) = C(u) + r*n(u) with rotation-minimizing frames,
    // dS/du is parallel to T; project onto the tangent plane for safety.
    const d = new THREE.Vector3()
      .copy(T)
      .addScaledVector(n, -T.dot(n))
      .normalize();

    // Up vector: angle `tilt` away from d, rotated toward the outward normal.
    //   tilt = PI/2 -> perpendicular to surface
    //   tilt -> 0   -> lying flat, pointing toward the tip
    const up = new THREE.Vector3()
      .addScaledVector(d, cosTilt)
      .addScaledVector(n, sinTilt)
      .normalize();

    // Orthonormal basis with local +Y = up
    const xAx = new THREE.Vector3().crossVectors(n, d).normalize();
    const zAx = new THREE.Vector3().crossVectors(xAx, up).normalize();

    const pos = new THREE.Vector3().copy(basePos).addScaledVector(n, -sink);

    out.makeBasis(xAx, up, zAx).setPosition(pos);
  };

  // #endregion [sub]

  const {
    thorn_radius,
    thorn_height,
    thorn_spacing,
    thorn_tiltAngle_rad,
    tube_curve,
    tube_radius,
    tube_geom,
    tube_radialSegCnt,
  } = params;

  // 0 = base center exactly on surface, 1 = sink to hide gap under tilted base
  const EMBED_FACTOR = 0.6;

  // ---------------------------------------------------------------------------
  // 1. Thorn geometry (shared by all thorns)
  // ---------------------------------------------------------------------------
  const geom = thorn_createGeom(thorn_radius, thorn_height);

  if (thorn_spacing <= 0) {
    throw new Error("thorn_spacing must be positive");
  }

  // ---------------------------------------------------------------------------
  // 2. Layout on the tube surface (hexagonal packing)
  //    - ring step along the curve: spacing * sqrt(3)/2
  //    - step around circumference: ~spacing
  //    - odd rings shifted by half a step
  //    => every nearest-neighbour distance ≈ thorn_spacing
  // ---------------------------------------------------------------------------
  const curveLen = tube_curve.getLength();
  const ringStep = thorn_spacing * (Math.sqrt(3) / 2);
  const ringCnt = Math.max(0, Math.floor(curveLen / ringStep));

  const circumference = TAU * tube_radius;
  const perRing = Math.max(1, Math.floor(circumference / thorn_spacing));
  const dTheta = TAU / perRing;

  const size = ringCnt * perRing;
  const listMat4 = new Float32Array(size * 16);
  if (size === 0) {
    return { count: size, geom, listMat4 };
  }

  // Center the rings so bottom and tip margins are equal
  const margin = (curveLen - (ringCnt - 1) * ringStep) / 2;

  // ---------------------------------------------------------------------------
  // 3. Frame + sinking setup
  // ---------------------------------------------------------------------------
  const frameSegCnt = tube_geom.tangents.length - 1;

  // Sink amount:
  //  - tilted base disc lifts one edge by thorn_radius * cos(tilt)
  //  - faceted tube lies slightly inside the ideal cylinder between vertices
  const facetInset = tube_radius * (1 - Math.cos(Math.PI / tube_radialSegCnt));
  const sink =
    EMBED_FACTOR * thorn_radius * Math.cos(thorn_tiltAngle_rad) + facetInset;

  const cosTilt = Math.cos(thorn_tiltAngle_rad);
  const sinTilt = Math.sin(thorn_tiltAngle_rad);

  // ---------------------------------------------------------------------------
  // 4. Build one matrix per thorn
  // ---------------------------------------------------------------------------
  const C = new THREE.Vector3(); // point on center curve
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  const n = new THREE.Vector3(); // outward surface normal
  const A = new THREE.Vector3(); // thorn base center on surface
  const mat = new THREE.Matrix4();

  let k = 0;
  for (let i = 0; i < ringCnt; i++) {
    const u = (margin + i * ringStep) / curveLen; // arc-length param, matches TubeGeometry's getPointAt
    tube_curve.getPointAt(u, C);
    tube_sampleFrame(tube_geom, frameSegCnt, u, T, N, B);

    const thetaOffset = (i % 2) * 0.5 * dTheta; // stagger odd rings

    for (let j = 0; j < perRing; j++) {
      const theta = thetaOffset + j * dTheta;

      // Same parametrization as TubeGeometry: normal = cos*N + sin*B
      n.set(0, 0, 0)
        .addScaledVector(N, Math.cos(theta))
        .addScaledVector(B, Math.sin(theta))
        .normalize();

      A.copy(C).addScaledVector(n, tube_radius);

      thorn_composeMatrix(A, n, T, cosTilt, sinTilt, sink, mat);
      mat.toArray(listMat4, k * 16);
      k++;
    }
  }

  return { count: size, geom, listMat4 };
}
