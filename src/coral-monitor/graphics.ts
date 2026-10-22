import * as THREE from "three";
import { BufferGeometryUtils } from "three/examples/jsm/Addons.js";
import seedrandom from "seedrandom";

import { TAU, UP_DIR, DEG2RAD, ZERO_VEC } from "./const";
import type { RandomFunc } from "../types";

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
  seedHash: string;
}) {
  // @region [sub]
  interface BranchTube {
    geom: THREE.BufferGeometry;
    curve: THREE.Curve<THREE.Vector3>;
  }

  const branchTube_cap_createGeom = (params: {
    capHeight: number;
    tube_radius: number;
    tube_radialSegCnt: number;
    tube_tubeSegCnt: number;
    tube_geom: THREE.TubeGeometry;
    tube_curve: THREE.Curve<THREE.Vector3>;
  }) => {
    const CAP_CURVE_POINT_CNT = 8;

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
      capHeight * 0.55,
      tube_radius * 0.55,
      capHeight,
      0,
      capHeight,
    );

    const tubeCap_geom = new THREE.LatheGeometry(
      cap_curvePath.getPoints(CAP_CURVE_POINT_CNT),
      tube_radialSegCnt,
    );

    const idx = tube_tubeSegCnt;
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

  const branchTube_generate = (params: {
    parentBranch_forwardVec: THREE.Vector3;
    ceil_pt: THREE.Vector3;
    radius: number;
    randFn: RandomFunc;
  }): BranchTube => {
    const originCpt_vertSectionConstraints_ratio = [0.1, 0.9];
    const ceilCpt_horizSectionConstraints_ratio = [0.1, 0.9];
    const ceilCpt_vertSectionConstraints_ratio = [0.1, 0.9];

    const tube_tubeSegCnt = 20;
    const tube_radialSegCnt = 8;
    const capHeight = 0.08;

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

    // Range: -90 <= x < 90 (in degrees)
    const rand_rotation = -Math.PI * 0.5 + Math.PI * randFn();
    tubeFinal_geom.applyMatrix4(
      new THREE.Matrix4().makeRotationAxis(UP_DIR, rand_rotation),
    );

    return {
      geom: tubeFinal_geom,
      curve: tube_curve,
    };
  };

  const rootBranchTube_generate = (params: {
    forward_vec: THREE.Vector3;
    ceilingHeight: number;
    radius: number;
    randFn: RandomFunc;
  }) => {
    const ceil_gapConstraints_ratio = [0.4, 0.8];

    const { forward_vec, ceilingHeight, radius, randFn } = params;

    const forward_dir = forward_vec.clone().normalize();
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

    return branchTube_generate({
      parentBranch_forwardVec: forward_vec,
      ceil_pt,
      radius,
      randFn,
    });
  };
  // @endregion [sub]

  const { seedHash, root_forwardVec, root_ceilingHeight } = params;
  const randFn = seedrandom(seedHash);

  const material = new THREE.MeshStandardMaterial({ color: "#526362" });

  const rootBranchTube = rootBranchTube_generate({
    forward_vec: root_forwardVec,
    ceilingHeight: root_ceilingHeight,
    radius: 0.1,
    randFn,
  });

  return new THREE.Mesh(rootBranchTube.geom, material);
}

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
