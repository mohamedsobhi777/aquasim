import * as THREE from "three";
import { BufferGeometryUtils } from "three/examples/jsm/Addons.js";
import seedrandom from "seedrandom";

import { TAU, UP_DIR, DEG2RAD, ZERO_VEC, PI, xxh } from "./const";
import type { RandomFunc } from "./types";

import weightedSelect from "./lib-external/weighted";
import {
  projectPointOnVec,
  randMultipleWithMinDist,
  randRange,
} from "./lib/math";
import FastNoiseLite from "./lib-external/fastnoise-lite";

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

interface CoralBranchTube {
  /** Combination of tube and cap */
  geom: THREE.BufferGeometry;
  curve: THREE.Curve<THREE.Vector3>;
  tube_geom: THREE.TubeGeometry;
  tube_radialSegCnt: number;
  tube_radius: number;

  id: string;
}

/**
 * @param {number} params.root_distToCeil
 *    The distance from the root to the tip of the root branch
 *
 */
export function branchingCoral_generate(params: {
  root_pt: THREE.Vector3;
  root_normalVec: THREE.Vector3;
  root_distToCeil: number;
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

  const branch_minLengthHaveChild = 0.4;
  const branch_upDirAngleConstraint_deg = 75;
  const branchingPoint_maxCnt = 3;

  /** B[k] means that: If branch's curve length is >= B[k], it should have min k branching points */
  const branchingPoint_minCntByCurveLength = [0, 0.5, 0.8, 1.1];

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
    forward_vec: THREE.Vector3;
    root_pt: THREE.Vector3;
    ceil_pt: THREE.Vector3;
    radius: number;
    randFn: RandomFunc;
    id?: string;
  }): CoralBranchTube => {
    const originCpt_vertSectionConstraints_ratio = [0.1, 0.9];
    const ceilCpt_horizSectionConstraints_ratio = [0.1, 0.5];
    const ceilCpt_vertSectionConstraints_ratio = [0.1, 0.6];

    const tube_tubeSegCnt = 20;
    const tube_radialSegCnt = 8;
    const capHeight = 0.1;

    const { forward_vec, radius, root_pt, ceil_pt, randFn } = params;

    const ground_pt = projectPointOnVec(ceil_pt, root_pt, forward_vec);
    const horiz_vec = ground_pt.clone().sub(root_pt);
    const vert_vec = ceil_pt.clone().sub(ground_pt);

    const originCpt = root_pt.clone().addScaledVector(
      vert_vec,
      randRange({
        a: originCpt_vertSectionConstraints_ratio[0],
        b: originCpt_vertSectionConstraints_ratio[1],
        randFn,
      }),
    );

    const ceilCpt = root_pt
      .clone()
      .addScaledVector(
        horiz_vec,
        randRange({
          a: ceilCpt_horizSectionConstraints_ratio[0],
          b: ceilCpt_horizSectionConstraints_ratio[1],
          randFn,
        }),
      )
      .addScaledVector(
        vert_vec,
        randRange({
          a: ceilCpt_vertSectionConstraints_ratio[0],
          b: ceilCpt_vertSectionConstraints_ratio[1],
          randFn,
        }),
      );

    const tube_curve = new THREE.CubicBezierCurve3(
      root_pt,
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
      id: params.id ?? "",
    };
  };

  const rootBranchTube_generate = (params: {
    root_pt: THREE.Vector3;
    normal_vec: THREE.Vector3;
    root_distToCeil: number;
    radius: number;
    randFn: RandomFunc;
  }) => {
    const { root_pt, normal_vec, root_distToCeil, radius, randFn } = params;

    // Increase randomness
    randFn();

    const normal_dir = normal_vec.normalize();

    const axisOutScreen_dir = new THREE.Vector3(0, 0, 1);

    // Special case handling: Only compute axisOutScreen_dir if normal_dir is not parallel to UP_DIR
    if (normal_dir.distanceToSquared(UP_DIR) > 1e-6) {
      axisOutScreen_dir.copy(UP_DIR).cross(normal_vec).normalize();
    }

    const forward_dir = normal_vec.clone().cross(axisOutScreen_dir).normalize();
    const forward_upAngle_rad = forward_dir.angleTo(UP_DIR);
    const ceil_upAngle_rad = randRange({
      a: -branch_upDirAngleConstraint_deg * DEG2RAD,
      b: Math.min(
        branch_upDirAngleConstraint_deg * DEG2RAD,
        forward_upAngle_rad,
      ),
      randFn,
    });

    const right_dir = UP_DIR.clone().cross(axisOutScreen_dir).normalize();
    const ceil_dir = ZERO_VEC.clone()
      .addScaledVector(UP_DIR, Math.cos(ceil_upAngle_rad))
      .addScaledVector(right_dir, Math.sin(ceil_upAngle_rad))
      .normalize();

    const ceil_pt = root_pt.clone().addScaledVector(ceil_dir, root_distToCeil);

    let rand_rot = TAU * randFn();

    const branch = branchTube_generate({
      forward_vec: forward_dir.clone().applyAxisAngle(UP_DIR, rand_rot),
      root_pt,
      ceil_pt: ceil_pt.applyAxisAngle(UP_DIR, rand_rot),
      radius,
      randFn,
      id: "0",
    });

    return branch;
  };

  /**
   * See prob.gbb file to understand about the choice of function for computing selection weight
   */
  const branchingPointCnt_generate = (params: {
    curCurveLength: number;
    curGrowthLevel: number;
    growthLevelCnt: number;
    randFn: RandomFunc;
  }) => {
    const expoFn_base = 2.67;
    const expoFn_yDownShift = 0.8;
    const weightDecayFactor = 2;

    const { curCurveLength, curGrowthLevel, growthLevelCnt, randFn } = params;

    const listChoice: Array<number> = [];
    const listWeight: Array<number> = [];

    const d = branchingPoint_maxCnt / growthLevelCnt;
    let weightSum = 0;

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
      weightSum += w;
    }

    for (let i = 0; i < listWeight.length; i++) {
      listWeight[i] /= weightSum;
    }

    let choice = 0;

    if (listChoice.length === 1) {
      choice = listChoice[0];
    } else if (listChoice.length != 0) {
      choice = weightedSelect(listChoice, listWeight, {
        rand: randFn,
        normal: true,
      });
    }

    for (let k = branchingPoint_maxCnt; k >= 0; k--) {
      if (curCurveLength >= branchingPoint_minCntByCurveLength[k]) {
        choice = Math.max(choice, k);
        break;
      }
    }

    return choice;
  };

  const branchingLocation_generate = (params: {
    branchingPointCnt: number;
    randFn: RandomFunc;
  }) => {
    const locationConstraints_ratio = [0.05, 0.9];
    const locationDistBetweenConstraint = 0.1;

    const { branchingPointCnt, randFn } = params;

    const listLocation: Array<number> = randMultipleWithMinDist({
      a: locationConstraints_ratio[0],
      b: locationConstraints_ratio[1],
      d: locationDistBetweenConstraint,
      N: branchingPointCnt,
      randFn,
    });

    listLocation.sort();

    return listLocation;
  };

  const branchingRotationRad_generate = (params: {
    branchingPointCnt: number;
    randFn: RandomFunc;
  }) => {
    const branch_angularDeviationConstraint_deg = 150;
    const branch_angularDistConstraint_deg = 30;

    const { branchingPointCnt, randFn } = params;

    const listRotation_rad: Array<number> = randMultipleWithMinDist({
      a: -branch_angularDeviationConstraint_deg,
      b: branch_angularDeviationConstraint_deg,
      d: branch_angularDistConstraint_deg,
      N: branchingPointCnt,
      randFn,
    });

    for (let i = 0; i < listRotation_rad.length; i++) {
      listRotation_rad[i] *= DEG2RAD;
    }

    return listRotation_rad;
  };

  const branch_generateOnParent = (params: {
    parent: CoralBranchTube;
    parent_growthLevel: number;
    locationIdx: number;
    location: number;
    rotation_rad: number;
    queue: Array<growCoral_QueueItem>;
    randFn: RandomFunc;
  }) => {
    const branch_angularDistConstraints_deg = [20, 80];

    const branch_ceilingHeightMin = 0.1;
    const branch_ceilDeviationFromParentConstraints = [-0.3, 0.1];

    const {
      parent,
      parent_growthLevel,
      locationIdx,
      location,
      rotation_rad,
      queue,
      randFn,
    } = params;

    const branch_growthLevel = parent_growthLevel - 1;

    let branchCnt = 1;
    if (location < 0.8) {
      branchCnt = Math.ceil(2 * randFn());
    }

    const branch_listUpDirAngle_deg: Array<number> = [];

    if (branchCnt == 1) {
      branch_listUpDirAngle_deg.push(
        randRange({
          a: -branch_upDirAngleConstraint_deg,
          b: branch_upDirAngleConstraint_deg,
          randFn: randFn,
        }),
      );
    } else {
      const branch_angularDist_deg = randRange({
        a: branch_angularDistConstraints_deg[0],
        b: branch_angularDistConstraints_deg[1],
        randFn: randFn,
      });

      const d1 = randRange({
        a: -branch_angularDist_deg / 2,
        b: branch_angularDist_deg / 2 - branch_angularDist_deg,
        randFn: randFn,
      });
      const d2 = d1 + branch_angularDist_deg;
      branch_listUpDirAngle_deg.push(d1, d2);
    }

    const branch_root_pt = parent.curve.getPoint(location);
    const parent_tip_pt = parent.curve.getPoint(1);
    const parent_tipOnUp_pt = projectPointOnVec(
      parent_tip_pt,
      branch_root_pt,
      UP_DIR,
    );
    const branch_ceilingHeight_upperBound =
      parent_tipOnUp_pt.clone().distanceTo(branch_root_pt) +
      branch_ceilDeviationFromParentConstraints[1];

    let branch_ceilingHeight_lowerBound =
      parent_tipOnUp_pt.clone().distanceTo(branch_root_pt) +
      branch_ceilDeviationFromParentConstraints[0];
    if (branch_ceilingHeight_lowerBound <= 0) {
      branch_ceilingHeight_lowerBound = branch_ceilingHeightMin;
    }

    // console.log(
    //   `branch[${parent.id}] `,
    //   `parent_tip_pt=`,
    //   xyz_toCommaDelimStr(parent_tip_pt),
    //   ` parent_tipOnUp_pt=`,
    //   xyz_toCommaDelimStr(parent_tipOnUp_pt),
    // );

    const branch_listCeilingHeight: Array<number> = [];

    for (let i = 0; i < branch_listUpDirAngle_deg.length; i++) {
      branch_listCeilingHeight.push(
        randRange({
          a: branch_ceilingHeight_lowerBound,
          b: branch_ceilingHeight_upperBound,
          randFn: randFn,
        }),
      );
    }

    const parent_forwardDir = parent.curve.getTangent(location);
    const parent_NDir = parent_forwardDir.clone().cross(UP_DIR).normalize();
    const parent_rightDir = UP_DIR.clone().cross(parent_NDir).normalize();

    // console.log(
    //   `branch[${parent.id}][loc=${location}] `,
    //   ` f_dir=`,
    //   xyz_toCommaDelimStr(parent_forwardDir),
    //   ` n_dir=`,
    //   xyz_toCommaDelimStr(parent_NDir),
    //   ` r_dir=`,
    //   xyz_toCommaDelimStr(parent_rightDir),
    //   ` root_pt=`,
    //   xyz_toCommaDelimStr(branch_root_pt),
    // );

    for (let i = 0; i < branch_listUpDirAngle_deg.length; i++) {
      const branch_id = `${parent.id}-${locationIdx},${i}`;

      let upAngle_rad = branch_listUpDirAngle_deg[i] * DEG2RAD;

      const ceilingHeight = branch_listCeilingHeight[i];
      const ceil_distToRoot = ceilingHeight / Math.cos(upAngle_rad);
      const ceil_pt = ZERO_VEC.clone()
        .addScaledVector(UP_DIR, Math.cos(upAngle_rad))
        .addScaledVector(parent_rightDir, Math.sin(upAngle_rad))
        .multiplyScalar(ceil_distToRoot)
        .add(branch_root_pt);

      // console.log(
      //   `branch[${branch_id}]`,
      //   ` upAngle=`,
      //   branch_listUpDirAngle_deg[i].toFixed(3),
      //   ` forward_upAngle=`,
      //   (parent_forwardDir.angleTo(UP_DIR) / DEG2RAD).toFixed(3),
      //   ` ceilingHeight=`,
      //   ceilingHeight.toFixed(3),
      // );

      ceil_pt
        .sub(branch_root_pt)
        .applyAxisAngle(UP_DIR, rotation_rad)
        .add(branch_root_pt);

      const forward_vec = parent_forwardDir
        .clone()
        .applyAxisAngle(UP_DIR, rotation_rad);

      const branch = branchTube_generate({
        ceil_pt: ceil_pt,
        forward_vec: forward_vec,
        root_pt: branch_root_pt,
        radius: parent.tube_radius,
        id: branch_id,
        randFn: randFn,
      });
      queue.push({
        branch: branch,
        growthLevel: branch_growthLevel,
      });
    }
  };

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

      const curBranch_curveLength = curBranch.curve.getLength();

      if (curBranch_curveLength < branch_minLengthHaveChild) {
        continue;
      }

      // console.log(`branchingPointCnt[${curBranch.id}]`);

      const branchingPointCnt = branchingPointCnt_generate({
        curCurveLength: curBranch_curveLength,
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
      const listBranchRotation_rad = branchingRotationRad_generate({
        branchingPointCnt,
        randFn,
      });

      for (let i = 0; i < listBranchLocation.length; i++) {
        branch_generateOnParent({
          parent: curBranch,
          parent_growthLevel: curGrowthLevel,
          locationIdx: i,
          location: listBranchLocation[i],
          rotation_rad: listBranchRotation_rad[i],
          queue,
          randFn,
        });
      }
    }
  };
  // @endregion [sub]

  const {
    seedHash,
    root_pt,
    root_normalVec,
    root_radius,
    material,
    root_distToCeil,
    growthLevelCnt,
  } = params;
  const randFn = seedrandom(seedHash);

  const merger = new GeometryMerger();

  const rootBranchTube = rootBranchTube_generate({
    root_pt,
    normal_vec: root_normalVec,
    root_distToCeil,
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
  const facetInset = tube_radius * (1 - Math.cos(PI / tube_radialSegCnt));
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

export function brainCoral_generate(params: {
  root_pt: THREE.Vector3;
  root_normalVec: THREE.Vector3;
  x_size: number;
  z_size: number;
  height: number;
  material: THREE.MeshStandardMaterial;
  seedHash: string;
}) {
  const sphere_segCntMinConstraint = 512;

  /** Should be smaller than sphere_segCntMinConstraint */
  const brainPatternTextureImg_minSizeConstraint = 256;

  // #region [sub]
  const brainPatternTexture_generate = (params: {
    sphere_xSize: number;
    sphere_zSize: number;
    seedHash: string;
  }) => {
    const noise_binaryThreshold = -0.01;

    const { seedHash, sphere_xSize, sphere_zSize } = params;

    const seed = xxh().update(seedHash).update("texture").digest().toNumber();
    const noiseGen = new FastNoiseLite(seed);

    // The following settings are based on experiment,
    // It simulates the brain pattern on the coral surface.
    noiseGen.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
    noiseGen.SetFrequency(0.025);
    noiseGen.SetFractalType(FastNoiseLite.FractalType.PingPong);
    noiseGen.SetFractalPingPongStrength(2.1);

    let img_width = brainPatternTextureImg_minSizeConstraint;
    let img_height = brainPatternTextureImg_minSizeConstraint;

    if (sphere_xSize > sphere_zSize) {
      img_width = Math.ceil(
        (sphere_xSize / sphere_zSize) *
          brainPatternTextureImg_minSizeConstraint,
      );
    } else if (sphere_zSize > sphere_xSize) {
      img_height = Math.ceil(
        (sphere_zSize / sphere_xSize) *
          brainPatternTextureImg_minSizeConstraint,
      );
    }

    const imgData = new Uint8Array(img_height * img_width);

    for (let y = 0; y < img_height; y++) {
      for (let x = 0; x < img_width; x++) {
        let noiseVal = noiseGen.GetNoise(x, y);
        if (noiseVal < noise_binaryThreshold) {
          noiseVal = -1;
        } else {
          noiseVal = 1;
        }

        const idx = y * img_width + x;
        const color = Math.floor((noiseVal + 1) * 0.5 * 255);
        imgData[idx] = color;
      }
    }

    const textureData = new THREE.DataArrayTexture(
      imgData,
      img_width,
      img_height,
      1,
    );
    return textureData;
  };

  const brainPatternTexture_getUV = (pt: THREE.Vector3): THREE.Vector2 => {
    const horizontalDistance = Math.hypot(pt.x, pt.z);
    const theta = Math.atan2(horizontalDistance, pt.y);

    // Pole -> 0; hemisphere rim -> 0.5.
    const imageRadius = theta / PI;

    const uv = new THREE.Vector2();

    if (horizontalDistance < 1e-8) {
      uv.set(0.5, 0.5);
    } else {
      uv.set(
        0.5 + (imageRadius * pt.x) / horizontalDistance,
        0.5 - (imageRadius * pt.z) / horizontalDistance,
      );
    }

    return uv;
  };

  const brainPatternTexture_applyOnGeom = (params: {
    sphere: THREE.SphereGeometry;
    textureData: THREE.DataArrayTexture;
    sphere_widthSegCnt: number;
    sphere_heightSegCnt: number;
  }) => {
    const offsetLenConstraint = 0.02;
    const taubinSmooth_iterConstraint = 3;
    const taubinSmooth_lambdaConstraint = 1;
    const taubinSmooth_muConstraint = -0.53;

    const { sphere, textureData, sphere_widthSegCnt, sphere_heightSegCnt } =
      params;

    const attr_position = sphere.attributes.position;
    const attr_normal = sphere.attributes.normal;

    const setCanonIdx = new Set<number>();
    const offsetLen_arr = new Float16Array(attr_position.count);

    for (let i = 0; i < attr_position.count; i++) {
      const pt = new THREE.Vector3(
        attr_position.getX(i),
        attr_position.getY(i),
        attr_position.getZ(i),
      );

      const i_canon = sphereGeometry_getCanonicalIndex({
        i,
        widthSegCnt: sphere_widthSegCnt,
        heightSegCnt: sphere_heightSegCnt,
      });
      if (setCanonIdx.has(i_canon)) {
        continue;
      }

      const uv = brainPatternTexture_getUV(pt);
      const color = DataArrayTexture_getColor({
        data: textureData,
        uv,
      });
      const offsetLen = offsetLenConstraint * (color / 255);

      setCanonIdx.add(i_canon);
      offsetLen_arr[i] = offsetLen;
    }

    taubinSmooth({
      geom: sphere,
      H: offsetLen_arr,
      getCanonicalIndex: (i: number) =>
        sphereGeometry_getCanonicalIndex({
          i,
          widthSegCnt: sphere_widthSegCnt,
          heightSegCnt: sphere_heightSegCnt,
        }),
      iterations: taubinSmooth_iterConstraint,
      lambda: taubinSmooth_lambdaConstraint,
      mu: taubinSmooth_muConstraint,
    });

    for (let i = 0; i < attr_position.count; i++) {
      const pt = new THREE.Vector3(
        attr_position.getX(i),
        attr_position.getY(i),
        attr_position.getZ(i),
      );
      const normal = new THREE.Vector3(
        attr_normal.getX(i),
        attr_normal.getY(i),
        attr_normal.getZ(i),
      ).normalize();
      pt.addScaledVector(normal, offsetLen_arr[i]);
      attr_position.setXYZ(i, pt.x, pt.y, pt.z);
    }

    sphere.computeBoundingBox();
    sphere.computeVertexNormals();
  };
  // #endregion [sub]

  const {
    seedHash,
    material,
    root_pt,
    x_size,
    z_size,
    root_normalVec,
    height,
  } = params;

  let sphere_widthSegCnt = 100;
  let sphere_heightSegCnt = 100;

  if (x_size > z_size) {
    sphere_heightSegCnt = sphere_segCntMinConstraint;
    sphere_widthSegCnt = Math.floor((x_size / z_size) * sphere_heightSegCnt);
  } else {
    sphere_widthSegCnt = sphere_segCntMinConstraint;
    sphere_heightSegCnt = Math.floor((z_size / x_size) * sphere_widthSegCnt);
  }

  const sphere = new THREE.SphereGeometry(
    1,
    sphere_widthSegCnt,
    sphere_heightSegCnt,
    0,
    TAU,
    0,
    PI / 2,
  );
  sphere.scale(x_size / 2, height, z_size / 2);

  const brainPatternTextureData = brainPatternTexture_generate({
    sphere_xSize: x_size,
    sphere_zSize: z_size,
    seedHash,
  });
  brainPatternTexture_applyOnGeom({
    sphere: sphere,
    textureData: brainPatternTextureData,
    sphere_widthSegCnt,
    sphere_heightSegCnt,
  });

  const rotation_axisVec = new THREE.Vector3().crossVectors(
    UP_DIR,
    root_normalVec,
  );
  const rotation_angleRad = UP_DIR.angleTo(root_normalVec);

  sphere.applyMatrix4(
    new THREE.Matrix4()
      .premultiply(
        new THREE.Matrix4().makeRotationAxis(
          rotation_axisVec,
          rotation_angleRad,
        ),
      )
      .premultiply(
        new THREE.Matrix4().makeTranslation(root_pt.x, root_pt.y, root_pt.z),
      ),
  );

  const mesh = new THREE.Mesh(sphere, material);
  // return meshWithWireframe(mesh);
  return mesh;
}

function sphereGeometry_getCanonicalIndex(params: {
  i: number;
  widthSegCnt: number;
  heightSegCnt: number;
}): number {
  const { i, widthSegCnt, heightSegCnt } = params;
  const rowSize = widthSegCnt + 1;
  const iy = Math.floor(i / rowSize);
  const ix = i % rowSize;

  if (iy === 0 || iy === heightSegCnt) {
    // pole: first vertex of the row
    return iy * rowSize;
  }
  if (ix === widthSegCnt) {
    // seam: same as ix = 0
    return iy * rowSize;
  }
  return i;
}

/**
 * Currently only support REDFormat
 */
function DataArrayTexture_getColor(params: {
  data: THREE.DataArrayTexture;
  uv: THREE.Vector2;
}): number {
  // #region [sub]
  const readColor = (x: number, y: number) => {
    x = THREE.MathUtils.clamp(x, 0, data.image.width - 1);
    y = THREE.MathUtils.clamp(y, 0, data.image.height - 1);

    const index = y * data.image.width + x;
    return data.image.data![index];
  };
  // #endregion [sub]

  const { data, uv } = params;
  const width = data.image.width;
  const height = data.image.height;

  const mid_x = Math.floor(uv.x * width) - 0.5;
  const mid_y = Math.floor(uv.y * height) - 0.5;

  const x0 = Math.floor(mid_x);
  const y0 = Math.floor(mid_y);
  const tx = mid_x - x0;
  const ty = mid_y - y0;
  const a = readColor(x0, y0);
  const b = readColor(x0 + 1, y0);
  const c = readColor(x0, y0 + 1);
  const d = readColor(x0 + 1, y0 + 1);

  const bottom = a + (b - a) * tx;
  const top = c + (d - c) * tx;

  const color_out = Math.floor(bottom + (top - bottom) * ty);
  return color_out;
}

type taubinSmooth_InputArray = Float32Array | Float16Array;

/**
 * This function update H in-place
 *
 * @param params
 * @returns
 */
function taubinSmooth<T extends taubinSmooth_InputArray>(params: {
  geom: THREE.BufferGeometry;
  H: T;
  getCanonicalIndex: (i: number) => number;
  iterations?: number;
  lambda?: number;
  mu?: number;
}): T {
  // #region [sub]
  const addNeighbor = (
    sets: Map<number, Set<number>>,
    a: number,
    b: number,
  ) => {
    if (a === b) {
      return;
    }
    let s = sets.get(a);
    if (!s) {
      sets.set(a, (s = new Set()));
    }
    s.add(b);
  };

  const computeRange = (h: T, canon: number[]) => {
    let min = Infinity,
      max = -Infinity;
    for (const k of canon) {
      if (h[k] < min) {
        min = h[k];
      }
      if (h[k] > max) {
        max = h[k];
      }
    }
    return { min, max };
  };

  const smoothPass = (
    h: T,
    tmp: T,
    canon: number[],
    nb: Map<number, number[]>,
    factor: number,
  ) => {
    for (const k of canon) {
      const ns = nb.get(k)!;
      let s = 0;
      for (const j of ns) {
        s += h[j];
      }
      tmp[k] = h[k] + factor * (s / ns.length - h[k]);
    }
    for (const k of canon) {
      h[k] = tmp[k];
    }
  };

  const createLike = (src: T, init: number | T): T => {
    const Ctor = src.constructor as new (init: number | ArrayLike<number>) => T;
    return new Ctor(init);
  };
  // #endregion [sub]

  const {
    geom,
    H,
    getCanonicalIndex,
    iterations = 5,
    lambda = 0.5,
    mu = -0.53,
  } = params;

  const ptCnt = geom.attributes.position.count;
  const geom_index = geom.index ? geom.index.array : null;
  const indexCnt = geom_index ? geom_index.length : ptCnt;

  // 1. Neighbours between canonical vertices
  const sets = new Map<number, Set<number>>();
  for (let t = 0; t < indexCnt; t += 3) {
    const a = getCanonicalIndex(geom_index ? geom_index[t] : t);
    const b = getCanonicalIndex(geom_index ? geom_index[t + 1] : t + 1);
    const c = getCanonicalIndex(geom_index ? geom_index[t + 2] : t + 2);
    addNeighbor(sets, a, b);
    addNeighbor(sets, a, c);
    addNeighbor(sets, b, a);
    addNeighbor(sets, b, c);
    addNeighbor(sets, c, a);
    addNeighbor(sets, c, b);
  }
  const canon = [...sets.keys()];
  const nb = new Map<number, number[]>();
  for (const k of canon) {
    nb.set(k, [...sets.get(k)!]);
  }

  // Working copy (same type as H), indexed by canonical id
  const h = createLike(H, H);
  const tmp = createLike(H, H);

  const original = computeRange(h, canon);

  // 2. Taubin smoothing: shrink (lambda) then inflate (mu)
  for (let it = 0; it < iterations; it++) {
    smoothPass(h, tmp, canon, nb, lambda);
    smoothPass(h, tmp, canon, nb, mu);
  }

  // 3. Restore the original peak/valley range
  const smoothed = computeRange(h, canon);
  const scale =
    (original.max - original.min) / (smoothed.max - smoothed.min || 1);

  // 4. Update H in-place
  for (let i = 0; i < ptCnt; i++) {
    const k = getCanonicalIndex(i);
    H[i] = original.min + (h[k] - smoothed.min) * scale;
  }

  return H;
}

export function fanCoral_generate(params: {
  root_pt: THREE.Vector3;
  root_normalVec: THREE.Vector3;
  height: number;
  material: THREE.MeshStandardMaterial;
  seedHash: string;
}) {
  type Branch = {
    start: THREE.Vector2;
    end: THREE.Vector2;
    startRadius: number;
    endRadius: number;
    angle: number;
    parent?: Branch;
  };
  type MainBranch = { segments: Branch[] };
  type BranchIndex = Map<string, Branch[]>;
  type AngleRange = { min: number; max: number };
  type TinyGrowth = {
    start: THREE.Vector2;
    angle: number;
    parent: Branch;
    distance: number;
  };
  type GeometryData = {
    positions: number[];
    normals: number[];
    indices: number[];
  };

  const mainBranch_maxLevel = 3;
  const mainBranch_segmentCnt = 3;
  const mainBranch_minHeightRatio = 0.9;
  const mainBranch_targetHeight =
    mainBranch_minHeightRatio + (1 - mainBranch_minHeightRatio) * 0.3;
  const mainBranch_min = 0.025;
  const mainBranch_max = 0.032;
  const tinyBranch_min = 0.001;
  const tinyBranch_max = 0.0016;
  const tinyBranch_maxDeviation_deg = 120;

  // Distances are relative to the requested height.
  const tinyBranch_gapOnMain = 0.0025;
  const tinyBranch_segmentLenStep = 0.01;
  const tinyBranch_maxGrowthDistance = 0.21;
  const baseRock_minHeight = 0.05;
  const baseRock_maxHeight = 0.08;
  const baseRock_minRadius = 0.12;
  const baseRock_maxRadius = 0.17;
  const baseRock_widthSegments = 32;
  const baseRock_heightSegments = 16;
  const baseRock_deformation = 0.22;
  const mainCoral_topDelta = 0.015;
  const collisionCellSize = 0.1;
  const radialSegments = 6;
  const { root_pt, root_normalVec, height, material, seedHash } = params;

  // #region [sub]
  const branchCells = (branch: Branch) => {
    const radius = Math.max(branch.startRadius, branch.endRadius) * 1.05;
    const min = branch.start.clone().min(branch.end).addScalar(-radius);
    const max = branch.start.clone().max(branch.end).addScalar(radius);
    min.divideScalar(collisionCellSize).floor();
    max.divideScalar(collisionCellSize).floor();
    const cells: string[] = [];

    for (let x = min.x; x <= max.x; x++) {
      for (let y = min.y; y <= max.y; y++) {
        cells.push(`${x},${y}`);
      }
    }
    return cells;
  };

  const closestBranchPoints = (
    firstStart: THREE.Vector2,
    firstEnd: THREE.Vector2,
    secondStart: THREE.Vector2,
    secondEnd: THREE.Vector2,
  ) => {
    const u = firstEnd.clone().sub(firstStart);
    const v = secondEnd.clone().sub(secondStart);
    const w = firstStart.clone().sub(secondStart);
    const a = u.dot(u);
    const b = u.dot(v);
    const c = u.dot(w);
    const e = v.dot(v);
    const f = v.dot(w);
    const denominator = a * e - b * b;
    let s =
      denominator > 1e-12 * a * e
        ? THREE.MathUtils.clamp((b * f - c * e) / denominator, 0, 1)
        : 0;
    let t = (b * s + f) / e;

    if (t < 0) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else if (t > 1) {
      t = 1;
      s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
    }
    return firstStart
      .clone()
      .addScaledVector(u, s)
      .distanceTo(secondStart.clone().addScaledVector(v, t));
  };

  const branchCanGrow = (
    branch: Branch,
    parent: Branch | undefined,
    index: BranchIndex,
  ) => {
    const nearby = new Set<Branch>();
    for (const cell of branchCells(branch)) {
      for (const existing of index.get(cell) ?? []) {
        nearby.add(existing);
      }
    }

    for (const existing of nearby) {
      let ancestor = parent;
      while (ancestor && ancestor !== existing) {
        ancestor = ancestor.parent;
      }
      const existingDirection = existing.end.clone().sub(existing.start);
      const startProjection = THREE.MathUtils.clamp(
        branch.start.clone().sub(existing.start).dot(existingDirection) /
          existingDirection.lengthSq(),
        0,
        1,
      );
      const startDistance = branch.start.distanceTo(
        existing.start
          .clone()
          .addScaledVector(existingDirection, startProjection),
      );
      const startRadius = THREE.MathUtils.lerp(
        existing.startRadius,
        existing.endRadius,
        startProjection,
      );
      const connected =
        (ancestor === existing ||
          existing.start.distanceToSquared(branch.start) < 1e-12 ||
          existing.end.distanceToSquared(branch.start) < 1e-12) &&
        startDistance < (branch.startRadius + startRadius) * 1.05;
      if (connected) {
        // A connected branch may overlap at its base, but must emerge from it.
        const endProjection = THREE.MathUtils.clamp(
          branch.end.clone().sub(existing.start).dot(existingDirection) /
            existingDirection.lengthSq(),
          0,
          1,
        );
        const endDistance = branch.end.distanceTo(
          existing.start
            .clone()
            .addScaledVector(existingDirection, endProjection),
        );
        const endRadius = THREE.MathUtils.lerp(
          existing.startRadius,
          existing.endRadius,
          endProjection,
        );
        if (endDistance < (branch.endRadius + endRadius) * 1.05) {
          return false;
        }
        continue;
      }

      const firstParts = branch.startRadius === branch.endRadius ? 1 : 2;
      const secondParts = existing.startRadius === existing.endRadius ? 1 : 2;
      for (let i = 0; i < firstParts; i++) {
        const firstA = i / firstParts;
        const firstB = (i + 1) / firstParts;
        const firstRadius = Math.max(
          THREE.MathUtils.lerp(branch.startRadius, branch.endRadius, firstA),
          THREE.MathUtils.lerp(branch.startRadius, branch.endRadius, firstB),
        );
        for (let j = 0; j < secondParts; j++) {
          const secondA = j / secondParts;
          const secondB = (j + 1) / secondParts;
          const secondRadius = Math.max(
            THREE.MathUtils.lerp(
              existing.startRadius,
              existing.endRadius,
              secondA,
            ),
            THREE.MathUtils.lerp(
              existing.startRadius,
              existing.endRadius,
              secondB,
            ),
          );
          const closest = closestBranchPoints(
            branch.start.clone().lerp(branch.end, firstA),
            branch.start.clone().lerp(branch.end, firstB),
            existing.start.clone().lerp(existing.end, secondA),
            existing.start.clone().lerp(existing.end, secondB),
          );
          if (closest < (firstRadius + secondRadius) * 1.05) {
            return false;
          }
        }
      }
    }
    return true;
  };

  const indexBranch = (branch: Branch, index: BranchIndex) => {
    for (const cell of branchCells(branch)) {
      const list = index.get(cell);
      if (list) {
        list.push(branch);
      } else {
        index.set(cell, [branch]);
      }
    }
  };

  const removeBranch = (branch: Branch, index: BranchIndex) => {
    for (const cell of branchCells(branch)) {
      const list = index.get(cell);
      if (list) {
        const position = list.indexOf(branch);
        if (position !== -1) {
          list.splice(position, 1);
        }
        if (list.length === 0) {
          index.delete(cell);
        }
      }
    }
  };

  const tinyBranch_boundAngle = (angle: number, ranges: AngleRange[]) => {
    let range = ranges[0];
    let distance = Math.max(range.min - angle, 0, angle - range.max);
    for (let i = 1; i < ranges.length; i++) {
      const candidate = ranges[i];
      const candidateDistance = Math.max(
        candidate.min - angle,
        0,
        angle - candidate.max,
      );
      if (candidateDistance < distance) {
        range = candidate;
        distance = candidateDistance;
      }
    }

    const width = range.max - range.min;
    if (width < 1e-12) {
      return range.min;
    }
    const period = 2 * width;
    const offset = ((angle - range.min) % period + period) % period;
    return range.min + (offset <= width ? offset : period - offset);
  };

  const addBranch = (branch: Branch, geometryData: GeometryData) => {
    const { start, end, startRadius, endRadius } = branch;
    const { positions, normals, indices } = geometryData;
    const direction = end.clone().sub(start).normalize();
    const side = new THREE.Vector3(direction.y, -direction.x, 0);
    const depth = new THREE.Vector3(0, 0, 1);
    const firstVertex = positions.length / 3;

    for (let ring = 0; ring < 2; ring++) {
      const center = ring === 0 ? start : end;
      const radius = ring === 0 ? startRadius : endRadius;

      for (let i = 0; i < radialSegments; i++) {
        const angle = (i / radialSegments) * TAU;
        const normal = side
          .clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(depth, Math.sin(angle));
        const point = new THREE.Vector3(center.x, center.y, 0)
          .addScaledVector(normal, radius);
        point.y = Math.max(0, point.y);
        positions.push(point.x, point.y, point.z);
        normals.push(normal.x, normal.y, normal.z);
      }
    }

    for (let i = 0; i < radialSegments; i++) {
      const next = (i + 1) % radialSegments;
      const a = firstVertex + i;
      const b = firstVertex + next;
      const c = firstVertex + radialSegments + i;
      const d = firstVertex + radialSegments + next;
      indices.push(a, c, b, b, c, d);
    }
  };

  const addMainJoint = (
    center: THREE.Vector2,
    radius: number,
    jointGeometry: THREE.SphereGeometry,
    geometryData: GeometryData,
  ) => {
    const firstVertex = geometryData.positions.length / 3;
    const position = jointGeometry.getAttribute("position");
    const normal = jointGeometry.getAttribute("normal");
    const jointIndex = jointGeometry.getIndex()!;
    for (let i = 0; i < position.count; i++) {
      geometryData.positions.push(
        center.x + position.getX(i) * radius * 1.05,
        Math.max(0, center.y + position.getY(i) * radius * 1.05),
        position.getZ(i) * radius * 1.05,
      );
      geometryData.normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
    for (let i = 0; i < jointIndex.count; i++) {
      geometryData.indices.push(firstVertex + jointIndex.getX(i));
    }
  };

  const growMainBranch = (
    start: THREE.Vector2,
    angle: number,
    radius: number,
    level: number,
    branches: MainBranch[],
    parent: Branch | undefined,
    index: BranchIndex,
    randFn: RandomFunc,
  ): boolean => {
    const isTerminal = level === mainBranch_maxLevel;
    const endRadius =
      radius * (isTerminal ? 0.14 + randFn() * 0.12 : 0.65 + randFn() * 0.2);
    const targetHeight = (mainBranch_targetHeight * level) / mainBranch_maxLevel;
    const heightStep = (targetHeight - start.y) / mainBranch_segmentCnt;
    let segmentStart = start;
    let segmentAngle = angle;
    let previous = parent;
    const segments: Branch[] = [];

    for (let i = 0; i < mainBranch_segmentCnt; i++) {
      segmentAngle = THREE.MathUtils.clamp(
        segmentAngle + (randFn() - 0.5) * 0.28,
        -1.15,
        1.15,
      );
      const segmentLength = heightStep / Math.cos(segmentAngle);
      const segmentEnd = segmentStart.clone().add(
        new THREE.Vector2(
          Math.sin(segmentAngle) * segmentLength,
          Math.cos(segmentAngle) * segmentLength,
        ),
      );
      const segment: Branch = {
        start: segmentStart,
        end: segmentEnd,
        startRadius: THREE.MathUtils.lerp(
          radius,
          endRadius,
          i / mainBranch_segmentCnt,
        ),
        endRadius: THREE.MathUtils.lerp(
          radius,
          endRadius,
          (i + 1) / mainBranch_segmentCnt,
        ),
        angle: segmentAngle,
        parent: previous,
      };
      if (!branchCanGrow(segment, previous, index)) {
        for (const added of segments) {
          removeBranch(added, index);
        }
        return false;
      }
      indexBranch(segment, index);
      segments.push(segment);
      previous = segment;
      segmentStart = segmentEnd;
    }

    // Discard incomplete paths so every surviving main tip reaches the target.
    if (!isTerminal) {
      let hasChild = false;
      for (const sign of [-1, 1]) {
        const childAngle = THREE.MathUtils.clamp(
          segmentAngle * (0.65 + randFn() * 0.25) +
            sign * (0.18 + randFn() * 0.5),
          -1.15,
          1.15,
        );
        if (
          growMainBranch(
            segmentStart,
            childAngle,
            endRadius,
            level + 1,
            branches,
            previous,
            index,
            randFn,
          )
        ) {
          hasChild = true;
        }
      }
      if (!hasChild) {
        for (const added of segments) {
          removeBranch(added, index);
        }
        return false;
      }
    }
    branches.push({ segments });
    return true;
  };

  const growTinyBranch = (
    growth: TinyGrowth,
    radius: number,
    angleRanges: AngleRange[],
    index: BranchIndex,
    branches: Branch[],
    pending: TinyGrowth[],
    randFn: RandomFunc,
  ) => {
    const { start, angle, parent, distance } = growth;
    if (start.y < radius || distance >= tinyBranch_maxGrowthDistance) {
      return;
    }

    const segmentLength = Math.min(
      tinyBranch_segmentLenStep,
      tinyBranch_maxGrowthDistance - distance,
    );
    if (segmentLength <= 1e-9) {
      return;
    }
    const vertical = Math.cos(angle);
    const end = start.clone().add(
      new THREE.Vector2(
        Math.sin(angle) * segmentLength,
        Math.abs(vertical) < 1e-12 ? 0 : vertical * segmentLength,
      ),
    );
    if (end.y < radius) {
      return;
    }
    const branch = {
      start,
      end,
      startRadius: radius,
      endRadius: radius,
      angle,
      parent,
    };
    if (!branchCanGrow(branch, parent, index)) {
      return;
    }
    indexBranch(branch, index);
    branches.push(branch);

    const nextDistance = distance + segmentLength;
    if (nextDistance >= tinyBranch_maxGrowthDistance - 1e-9) {
      return;
    }

    for (const sign of [-1, 1]) {
      pending.push({
        start: end,
        angle: tinyBranch_boundAngle(
          angle + sign * (0.18 + randFn() * 0.3),
          angleRanges,
        ),
        parent: branch,
        distance: nextDistance,
      });
    }
  };
  // #endregion [sub]

  if (!Number.isFinite(height) || height <= 0) {
    throw new RangeError("Fan coral height must be a positive finite number");
  }
  if (
    !Number.isFinite(root_normalVec.x) ||
    !Number.isFinite(root_normalVec.y) ||
    !Number.isFinite(root_normalVec.z) ||
    (root_normalVec.x === 0 &&
      root_normalVec.y === 0 &&
      root_normalVec.z === 0)
  ) {
    throw new RangeError(
      "Fan coral root normal must be a finite nonzero vector",
    );
  }
  if (![root_pt.x, root_pt.y, root_pt.z].every(Number.isFinite)) {
    throw new RangeError("Fan coral root point must be finite");
  }
  if (
    !Number.isFinite(tinyBranch_maxDeviation_deg) ||
    tinyBranch_maxDeviation_deg < 0 ||
    tinyBranch_maxDeviation_deg > 180
  ) {
    throw new RangeError(
      "Tiny branch maximum deviation must be between 0 and 180 degrees",
    );
  }

  const normalScale = Math.max(
    Math.abs(root_normalVec.x),
    Math.abs(root_normalVec.y),
    Math.abs(root_normalVec.z),
  );
  const normal = new THREE.Vector3(
    root_normalVec.x / normalScale,
    root_normalVec.y / normalScale,
    root_normalVec.z / normalScale,
  ).normalize();
  const planeNormal = new THREE.Vector3().crossVectors(normal, UP_DIR);
  const planeScale = Math.max(Math.abs(planeNormal.x), Math.abs(planeNormal.z));
  const horizontal = new THREE.Vector3();
  if (planeScale === 0) {
    horizontal.set(1, 0, 0);
  } else {
    planeNormal.set(planeNormal.x / planeScale, 0, planeNormal.z / planeScale);
    horizontal.crossVectors(planeNormal, normal).normalize();
  }
  const depth = new THREE.Vector3().crossVectors(horizontal, normal).normalize();
  const maxDeviation = tinyBranch_maxDeviation_deg * DEG2RAD;
  const upAngle = Math.atan2(horizontal.y, normal.y);
  const localAngleLimit = PI;
  const angleRanges: AngleRange[] = [];
  const minAngle = Math.max(
    -localAngleLimit,
    Math.atan2(-normal.y, horizontal.y) + (PI / 2 - maxDeviation),
  );
  const maxAngle = Math.min(localAngleLimit, upAngle + maxDeviation);
  if (minAngle <= maxAngle) {
    angleRanges.push({ min: minAngle, max: maxAngle });
  }

  // The allowed world-up sector can wrap across the local angle boundary.
  const wrappedMin = Math.max(-localAngleLimit, upAngle - maxDeviation - TAU);
  const wrappedMax = Math.min(localAngleLimit, upAngle + maxDeviation - TAU);
  if (
    wrappedMin <= wrappedMax &&
    (angleRanges.length === 0 || wrappedMax > wrappedMin)
  ) {
    const first = angleRanges[0];
    if (first && wrappedMax >= first.min) {
      first.min = wrappedMin;
    } else {
      angleRanges.push({ min: wrappedMin, max: wrappedMax });
    }
  }
  if (angleRanges.length === 0) {
    throw new RangeError(
      "Tiny branch deviation allows no growth above the root surface",
    );
  }

  const randFn = seedrandom(seedHash);
  const mainBranch_initialRadius = randRange({
    a: mainBranch_min,
    b: mainBranch_max,
    randFn,
  });
  const tinyBranch_radius = THREE.MathUtils.clamp(
    mainBranch_initialRadius * 0.2,
    tinyBranch_min,
    tinyBranch_max,
  );
  const mainBranches: MainBranch[] = [];
  const tinyBranches: Branch[] = [];
  const branchIndex: BranchIndex = new Map();
  const pendingTiny: TinyGrowth[] = [];
  const geometryData: GeometryData = { positions: [], normals: [], indices: [] };

  const spineAngle = (randFn() - 0.5) * 0.3;
  const spinePhase = randFn() * TAU;
  let spinePoint = new THREE.Vector2();
  let spineRadius = mainBranch_initialRadius;
  let spineParent: Branch | undefined;
  const spineBranches: MainBranch[] = [];
  for (let level = 1; level <= mainBranch_maxLevel; level++) {
    const endRadius = spineRadius * (level === mainBranch_maxLevel ? 0.2 : 0.75);
    const segments: Branch[] = [];
    for (let i = 0; i < mainBranch_segmentCnt; i++) {
      const step = (level - 1) * mainBranch_segmentCnt + i;
      const angle = spineAngle + 0.08 * Math.sin(spinePhase + step * 0.6);
      const nextHeight =
        (mainBranch_targetHeight * (step + 1)) /
        (mainBranch_maxLevel * mainBranch_segmentCnt);
      const length = (nextHeight - spinePoint.y) / Math.cos(angle);
      const end = spinePoint.clone().add(
        new THREE.Vector2(Math.sin(angle) * length, Math.cos(angle) * length),
      );
      const segment: Branch = {
        start: spinePoint,
        end,
        startRadius: THREE.MathUtils.lerp(
          spineRadius,
          endRadius,
          i / mainBranch_segmentCnt,
        ),
        endRadius: THREE.MathUtils.lerp(
          spineRadius,
          endRadius,
          (i + 1) / mainBranch_segmentCnt,
        ),
        angle,
        parent: spineParent,
      };
      if (!branchCanGrow(segment, spineParent, branchIndex)) {
        throw new Error("Unable to grow the fan coral's main spine");
      }
      indexBranch(segment, branchIndex);
      segments.push(segment);
      spinePoint = end;
      spineParent = segment;
    }
    const mainBranch = { segments };
    mainBranches.push(mainBranch);
    spineBranches.push(mainBranch);
    spineRadius = endRadius;
  }

  const oppositeSide = spineAngle < 0 ? 1 : -1;
  growMainBranch(
    new THREE.Vector2(),
    oppositeSide * (0.55 + randFn() * 0.2),
    mainBranch_initialRadius,
    1,
    mainBranches,
    undefined,
    branchIndex,
    randFn,
  );
  for (let level = 1; level < mainBranch_maxLevel; level++) {
    const parent = spineBranches[level - 1].segments[mainBranch_segmentCnt - 1];
    const sign = level === 1 ? -oppositeSide : oppositeSide;
    growMainBranch(
      parent.end,
      sign * (0.4 + randFn() * 0.35),
      parent.endRadius,
      level + 1,
      mainBranches,
      parent,
      branchIndex,
      randFn,
    );
  }

  for (const mainBranch of mainBranches) {
    let distanceAlongBranch = 0;
    let nextStartDistance = tinyBranch_gapOnMain / 2;
    for (const branch of mainBranch.segments) {
      const length = branch.start.distanceTo(branch.end);
      const side = new THREE.Vector2(
        Math.cos(branch.angle),
        -Math.sin(branch.angle),
      );
      while (nextStartDistance < distanceAlongBranch + length) {
        const fraction = (nextStartDistance - distanceAlongBranch) / length;
        const radius = THREE.MathUtils.lerp(
          branch.startRadius,
          branch.endRadius,
          fraction,
        );
        for (const sign of [-1, 1]) {
          pendingTiny.push({
            start: branch.start
              .clone()
              .lerp(branch.end, fraction)
              .addScaledVector(
                side,
                sign * Math.max(0, radius - tinyBranch_radius * 2),
              ),
            angle: tinyBranch_boundAngle(
              branch.angle + sign * (0.65 + randFn() * 0.35),
              angleRanges,
            ),
            parent: branch,
            distance: 0,
          });
        }
        nextStartDistance += tinyBranch_gapOnMain;
      }
      distanceAlongBranch += length;
    }
  }

  const mainParents = new Set<Branch>();
  for (const mainBranch of mainBranches) {
    for (const segment of mainBranch.segments) {
      if (segment.parent) {
        mainParents.add(segment.parent);
      }
    }
  }
  const tipStarts: TinyGrowth[] = [];
  for (const mainBranch of mainBranches) {
    const tip = mainBranch.segments[mainBranch.segments.length - 1];
    if (!mainParents.has(tip)) {
      tipStarts.push({
        start: tip.end.clone(),
        angle: tinyBranch_boundAngle(tip.angle, angleRanges),
        parent: tip,
        distance: 0,
      });
    }
  }

  let frontier = [...tipStarts, ...pendingTiny];
  while (frontier.length > 0) {
    const next: TinyGrowth[] = [];
    for (const growth of frontier) {
      growTinyBranch(
        growth,
        tinyBranch_radius,
        angleRanges,
        branchIndex,
        tinyBranches,
        next,
        randFn,
      );
    }
    frontier = next;
  }

  for (const mainBranch of mainBranches) {
    for (const segment of mainBranch.segments) {
      addBranch(segment, geometryData);
    }
  }
  for (const branch of tinyBranches) {
    addBranch(branch, geometryData);
  }

  const jointGeometry = new THREE.SphereGeometry(1, 16, 12);
  for (const mainBranch of mainBranches) {
    for (const branch of mainBranch.segments) {
      addMainJoint(branch.end, branch.endRadius, jointGeometry, geometryData);
    }
  }
  jointGeometry.dispose();

  const rockRandFn = seedrandom(`${seedHash}/baseRock`);
  const rockHeight = randRange({
    a: baseRock_minHeight,
    b: baseRock_maxHeight,
    randFn: rockRandFn,
  });
  const rockRadius = randRange({
    a: baseRock_minRadius,
    b: baseRock_maxRadius,
    randFn: rockRandFn,
  });
  const rockNoise = new FastNoiseLite(Math.floor(rockRandFn() * 2147483647));
  rockNoise.SetFrequency(1.5);
  const rockGeometry = new THREE.SphereGeometry(
    1,
    baseRock_widthSegments,
    baseRock_heightSegments,
    0,
    TAU,
    0,
    PI / 2,
  );
  const rockPosition = rockGeometry.getAttribute("position");
  let maxRockHeight = 0;
  let maxRockRadius = 0;
  for (let i = 0; i < rockPosition.count; i++) {
    const x = rockPosition.getX(i);
    const y = rockPosition.getY(i);
    const z = rockPosition.getZ(i);
    const deformation = 1 + baseRock_deformation * rockNoise.GetNoise(x, y, z);
    const deformedX = x * deformation;
    const deformedY = y * deformation;
    const deformedZ = z * deformation;
    rockPosition.setXYZ(i, deformedX, deformedY, deformedZ);
    maxRockHeight = Math.max(maxRockHeight, deformedY);
    maxRockRadius = Math.max(maxRockRadius, Math.hypot(deformedX, deformedZ));
  }
  rockGeometry.scale(
    rockRadius / maxRockRadius,
    rockHeight / maxRockHeight,
    rockRadius / maxRockRadius,
  );
  const rockRimStart = rockPosition.count - baseRock_widthSegments - 1;
  for (let i = rockRimStart; i < rockPosition.count; i++) {
    rockPosition.setY(i, 0);
  }
  rockGeometry.computeVertexNormals();

  const mainCoral_baseHeight = rockHeight - mainCoral_topDelta;
  for (let i = 1; i < geometryData.positions.length; i += 3) {
    geometryData.positions[i] += mainCoral_baseHeight;
  }

  const rockFirstVertex = geometryData.positions.length / 3;
  const rockNormal = rockGeometry.getAttribute("normal");
  const rockIndex = rockGeometry.getIndex()!;
  for (let i = 0; i < rockPosition.count; i++) {
    geometryData.positions.push(
      rockPosition.getX(i),
      rockPosition.getY(i),
      rockPosition.getZ(i),
    );
    geometryData.normals.push(
      rockNormal.getX(i),
      rockNormal.getY(i),
      rockNormal.getZ(i),
    );
  }
  for (let i = 0; i < rockIndex.count; i++) {
    geometryData.indices.push(rockFirstVertex + rockIndex.getX(i));
  }

  const rockBottomCenter = geometryData.positions.length / 3;
  geometryData.positions.push(0, 0, 0);
  geometryData.normals.push(0, -1, 0);
  for (let i = 0; i <= baseRock_widthSegments; i++) {
    geometryData.positions.push(
      rockPosition.getX(rockRimStart + i),
      0,
      rockPosition.getZ(rockRimStart + i),
    );
    geometryData.normals.push(0, -1, 0);
    if (i > 0) {
      geometryData.indices.push(
        rockBottomCenter,
        rockBottomCenter + i + 1,
        rockBottomCenter + i,
      );
    }
  }
  rockGeometry.dispose();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(geometryData.positions, 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(geometryData.normals, 3),
  );
  geometry.setIndex(geometryData.indices);
  geometry.scale(height, height, height);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(root_pt);
  mesh.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(horizontal, normal, depth),
  );
  return mesh;
}
