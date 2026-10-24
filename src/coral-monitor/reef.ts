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
import { xyz_toCommaDelimStr } from "./lib/utils";
import { meshWithWireframe } from "./lib/graphics";
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
 * @param {THREE.Vector3} params.root_pt
 *    The root point of the coral
 * @param {THREE.Vector3} params.root_forwardVec
 *    The forward vector of the root of the coral. It represents the "surface" where the coral is attached
 * @param {number} params.root_distToCeil
 *    The distance from the root to the tip of the root branch
 *
 */
export function branchingCoral_generate(params: {
  root_pt: THREE.Vector3;
  root_forwardVec: THREE.Vector3;
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
    forward_vec: THREE.Vector3;
    root_distToCeil: number;
    radius: number;
    randFn: RandomFunc;
  }) => {
    const { root_pt, forward_vec, root_distToCeil, radius, randFn } = params;

    // Increase randomness
    randFn();

    const forward_upAngle_rad = forward_vec.angleTo(UP_DIR);
    const ceil_upAngle_rad = randRange({
      a: -branch_upDirAngleConstraint_deg * DEG2RAD,
      b: Math.min(
        branch_upDirAngleConstraint_deg * DEG2RAD,
        forward_upAngle_rad,
      ),
      randFn,
    });

    const n_dir = forward_vec.clone().cross(UP_DIR).normalize();
    const right_dir = UP_DIR.clone().cross(n_dir).normalize();
    const ceil_dir = ZERO_VEC.clone()
      .addScaledVector(UP_DIR, Math.cos(ceil_upAngle_rad))
      .addScaledVector(right_dir, Math.sin(ceil_upAngle_rad))
      .normalize();

    const branch_up_dir = n_dir.clone().cross(forward_vec).normalize();
    const ceil_pt = root_pt.clone().addScaledVector(ceil_dir, root_distToCeil);

    let rand_rot = TAU * randFn();

    const branch = branchTube_generate({
      forward_vec: forward_vec.clone().applyAxisAngle(UP_DIR, rand_rot),
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
    root_forwardVec,
    root_radius,
    material,
    root_distToCeil,
    growthLevelCnt,
  } = params;
  const randFn = seedrandom(seedHash);

  const merger = new GeometryMerger();

  const rootBranchTube = rootBranchTube_generate({
    root_pt,
    forward_vec: root_forwardVec,
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
  root_forwardVec: THREE.Vector3;
  x_size: number;
  z_size: number;
  height: number;
  material: THREE.MeshStandardMaterial;
  seedHash: string;
}) {
  const sphere_widthSegCnt = 128;
  const sphere_heightSegCnt = 128;

  // #region [sub]
  const deformSphere = (params: {
    sphere: THREE.SphereGeometry;
    sphere_widthSegCnt: number;
    sphere_heightSegCnt: number;
    randFn: RandomFunc;
  }) => {
    const deformFactorConstraints = {
      x: [0, 0],
      y: [0, 0.3],
      z: [0, 0.2],
    };

    const { sphere, sphere_widthSegCnt, sphere_heightSegCnt, randFn } = params;

    const attr_position = sphere.getAttribute("position");

    let bounds = {
      x: [Infinity, -Infinity],
      y: [Infinity, -Infinity],
      z: [Infinity, -Infinity],
    };

    for (let i = 0; i < attr_position.count; i++) {
      const pt = {
        x: attr_position.getX(i),
        y: attr_position.getY(i),
        z: attr_position.getZ(i),
      };

      for (const axis of ["x", "y", "z"] as const) {
        const val = pt[axis];
        if (val > bounds[axis][1]) {
          bounds[axis][1] = val;
        }
        if (val < bounds[axis][0]) {
          bounds[axis][0] = val;
        }
      }
    }

    const dict_posIdx_offsetVec: Record<
      number,
      { x: number; y: number; z: number }
    > = {};

    for (let i = 0; i < attr_position.count; i++) {
      const pt = {
        x: attr_position.getX(i),
        y: attr_position.getY(i),
        z: attr_position.getZ(i),
      };

      const i_canon = sphereGeometry_getCanonicalIndex({
        i,
        widthSegCnt: sphere_widthSegCnt,
        heightSegCnt: sphere_heightSegCnt,
      });
      let offsetVec = dict_posIdx_offsetVec[i_canon];
      if (offsetVec === undefined) {
        offsetVec = { x: 0, y: 0, z: 0 };

        for (const axis of ["x", "y", "z"] as const) {
          let offset = Math.min(
            pt[axis] - bounds[axis][0],
            bounds[axis][1] - pt[axis],
          );
          offsetVec[axis] =
            offset *
            randRange({
              a: deformFactorConstraints[axis][0],
              b: deformFactorConstraints[axis][1],
              randFn,
            });
        }

        dict_posIdx_offsetVec[i_canon] = offsetVec;
      }

      attr_position.setXYZ(
        i,
        pt.x + offsetVec.x,
        pt.y + offsetVec.y,
        pt.z + offsetVec.z,
      );
    }
    attr_position.needsUpdate = true;
  };

  const brainPatternTexture_generate = (params: {
    sphere_xSize: number;
    sphere_zSize: number;
    seedHash: string;
  }) => {
    const imgMinSizeConstraint = 512;

    const { seedHash, sphere_xSize, sphere_zSize } = params;

    const seed = xxh().update(seedHash).update("texture").digest().toNumber();
    const noiseGen = new FastNoiseLite(seed);

    // The following settings are based on experiment,
    // It simulates the brain pattern on the coral surface.
    noiseGen.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
    noiseGen.SetFrequency(0.02);
    noiseGen.SetFractalType(FastNoiseLite.FractalType.PingPong);
    noiseGen.SetFractalPingPongStrength(2.11);

    let img_width = imgMinSizeConstraint;
    let img_height = imgMinSizeConstraint;

    if (sphere_xSize > sphere_zSize) {
      img_width = Math.ceil(
        (sphere_xSize / sphere_zSize) * imgMinSizeConstraint,
      );
    } else if (sphere_zSize > sphere_xSize) {
      img_height = Math.ceil(
        (sphere_zSize / sphere_xSize) * imgMinSizeConstraint,
      );
    }

    const imgData = new Uint8Array(img_height * img_width);

    for (let y = 0; y < img_height; y++) {
      for (let x = 0; x < img_width; x++) {
        let noiseVal = noiseGen.GetNoise(x, y);

        const idx = y * img_width + x;
        const color = Math.floor((noiseVal + 1) * 0.5 * 255);
        imgData[idx] = color;
      }
    }

    const textureData = new THREE.DataArrayTexture(imgData, img_width, img_height, 1);
    return textureData;
  };
  // #endregion [sub]

  const {
    seedHash,
    material,
    root_pt,
    x_size,
    z_size,
    root_forwardVec,
    height,
  } = params;

  const randFn = seedrandom(seedHash);

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

  deformSphere({ sphere, randFn, sphere_widthSegCnt, sphere_heightSegCnt });

  sphere.applyMatrix4(
    new THREE.Matrix4().makeTranslation(root_pt.x, root_pt.y, root_pt.z),
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
