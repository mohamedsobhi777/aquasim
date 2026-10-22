import * as THREE from "three";
import XXH from "xxhashjs";
import seedrandom from "seedrandom";

import { TAU, UP_VEC, DEG2RAD, ZERO_VEC } from "./const";
import type { RandomFunc } from "../types";

/**
 * @param {THREE.Vector3} params.rootNormalVec
 *    The normal vector of the surface where the coral is rooted
 * @param {number} params.rootCeilingHeight
 *    The maximum height from the surface to the tip of the root branch of the coral
 *
 * The mesh zero point is at the base of the coral where it is rooted
 */
export function branchingCoral_generateMesh(prms: {
  root_normalVec: THREE.Vector3;
  root_ceilingHeight: number;
  seedHash: string;
}) {
  // @region [sub]
  const branchTube_generateGeom = (params: {
    parentBranch_forwardVec: THREE.Vector3;
    ceil_pt: THREE.Vector3;
    randFn: RandomFunc;
  }) => {
    const horizSectionContraints = [0.1, 0.9];
    const vertSectionConstraints = [0.1, 0.9];

    const { parentBranch_forwardVec, ceil_pt, randFn } = params;

    const ground_pt = ceil_pt.clone().projectOnVector(parentBranch_forwardVec);
    const horiz_vec = ground_pt.clone().sub(ceil_pt).normalize();
    const vert_vec = ceil_pt.clone().sub(ground_pt).normalize();

    const horiz_rand = randFn();
    const vert_rand = randFn();

    const mid_pt = ZERO_VEC.clone()
      .addScaledVector(
        horiz_vec,
        horizSectionContraints[0] +
          (horizSectionContraints[1] - horizSectionContraints[0]) * horiz_rand,
      )
      .addScaledVector(
        vert_vec,
        vertSectionConstraints[0] +
          (vertSectionConstraints[1] - vertSectionConstraints[0]) * vert_rand,
      );


  };

  const rootBranch_generateGeom = (params: {
    normalVec: THREE.Vector3;
    ceilingHeight: number;
    randFn: RandomFunc;
  }) => {
    const ceilingRadius = 0.01;
  };

  const mainBranch_generateGeom = (
    ceilingHeight: number,
    parentBranchForwardVec: THREE.Vector3,
  ): THREE.BufferGeometry | null => {
    return null;
  };
  // @endregion [sub]

  const rng = seedrandom(prms.seedHash);
}
