import * as THREE from "three";
import XXH from "xxhashjs";
import seedrandom from "seedrandom";

import { TAU, UP_VEC, DEG2RAD } from "./const";
import type { RandomFunc } from "../types";

/**
 * Random point P with |OP| = h, angle(OP, OD) <= a_rad, angle(OP, OU) <= b_rad.
 * O is the origin.
 * Returns null if no such point exists.
 */
function randomPointWithVecAngleConstraint(params: {
  /** Direction vector OU (non-zero, length doesn't matter). */
  U: THREE.Vector3;
  /** Direction vector OD (non-zero, length doesn't matter). */
  D: THREE.Vector3;
  /** Desired distance from O to P. */
  h: number;
  /** Max angle between OP and OD, in radians (0..π/2). */
  d_rad: number;
  /** Max angle between OP and OU, in radians (0..π/2). */
  u_rad: number;
  /** Returns a random number in [0, 1). */
  randFn: RandomFunc;
  /** Max rejection-sampling attempts before using the fallback point. Default: 10000. */
  maxTries?: number;
}): THREE.Vector3 | null {
  const { U, D, h, d_rad, u_rad, randFn, maxTries = 10000 } = params;

  const EPS = 1e-12;
  const EPS_SQ = EPS * EPS;

  //#region [sub]

  /** Any unit vector perpendicular to unit vector n. */
  const anyPerpendicular = (n: THREE.Vector3): THREE.Vector3 => {
    const helper =
      Math.abs(n.x) < 0.9
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
    return new THREE.Vector3().crossVectors(n, helper).normalize();
  };

  /** Uniform random unit vector inside the cap of half-angle `alpha_rad` around unit axis `n`. */
  const sampleCap = (n: THREE.Vector3, alpha_rad: number): THREE.Vector3 => {
    const cosAlpha = Math.cos(alpha_rad);
    const cosT = cosAlpha + randFn() * (1 - cosAlpha); // uniform in [cos α, 1]
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const phi = randFn() * 2 * Math.PI;

    const e1 = anyPerpendicular(n);
    const e2 = new THREE.Vector3().crossVectors(n, e1);

    return new THREE.Vector3()
      .addScaledVector(n, cosT)
      .addScaledVector(e1, sinT * Math.cos(phi))
      .addScaledVector(e2, sinT * Math.sin(phi));
  };

  //#endregion [sub]

  const d = D.clone().normalize();
  const u = U.clone().normalize();
  const theta_rad = d.angleTo(u); // angle between OD and OU

  const aIsSmaller = d_rad <= u_rad;
  const smallAxis = aIsSmaller ? d : u;
  const smallAng_rad = aIsSmaller ? d_rad : u_rad;
  const bigAxis = aIsSmaller ? u : d;
  const bigAng_rad = aIsSmaller ? u_rad : d_rad;
  const cosBig = Math.cos(bigAng_rad);

  // Fallback: rotate D toward U by fallbackT_rad, where fallbackT_rad <= a_rad and theta_rad - fallbackT_rad <= b_rad
  const fallbackT_rad =
    (Math.max(0, theta_rad - u_rad) + Math.min(d_rad, theta_rad)) / 2;
  const dCrossU = new THREE.Vector3().crossVectors(d, u);

  // ---- Logic ----
  if (U.lengthSq() < EPS_SQ || D.lengthSq() < EPS_SQ) {
    throw new Error("U and D must be non-zero vectors");
  }

  // The two caps don't intersect
  if (theta_rad > d_rad + u_rad + EPS) {
    return null;
  }

  // Small cap fully inside big cap -> every sample is valid
  if (theta_rad + smallAng_rad <= bigAng_rad) {
    return sampleCap(smallAxis, smallAng_rad).multiplyScalar(h);
  }

  // Rejection sampling (uniform over the intersection)
  for (let i = 0; i < maxTries; i++) {
    const p = sampleCap(smallAxis, smallAng_rad);

    if (p.dot(bigAxis) >= cosBig) {
      return p.multiplyScalar(h);
    }
  }

  // Fallback (very thin intersection): guaranteed-valid point on the arc from D toward U
  const rotAxis =
    dCrossU.lengthSq() < EPS_SQ ? anyPerpendicular(d) : dCrossU.normalize();
  return d.clone().applyAxisAngle(rotAxis, fallbackT_rad).multiplyScalar(h);
}

/**
 * Returns a random point P such that:
 *  - |P - H| <= d
 *  - P lies on the plane through H with normal vector OH (O = origin)
 *
 * Points are uniformly distributed over the disk.
 */
export function randomPointOnDisk(params: {
  H: THREE.Vector3;
  d: number;
  randFn: RandomFunc;
}): THREE.Vector3 {
  const { H, d, randFn } = params;
  const normal = H.clone();

  if (normal.lengthSq() === 0) {
    throw new Error(
      "H must not be the origin: the plane normal OH is undefined.",
    );
  }
  normal.normalize();

  // Pick a helper axis that is not (nearly) parallel to the normal
  const helper =
    Math.abs(normal.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);

  // Build an orthonormal basis (u, v) spanning the plane
  const u = new THREE.Vector3().crossVectors(normal, helper).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u); // already unit length

  // Uniform sampling in a disk: sqrt keeps the density uniform over area
  const r = d * Math.sqrt(randFn());
  const theta = randFn() * TAU;

  return H.clone()
    .addScaledVector(u, r * Math.cos(theta))
    .addScaledVector(v, r * Math.sin(theta));
}

/**
 * @param {THREE.Vector3} params.rootNormalVec
 *    The normal vector of the surface where the coral is rooted
 * @param {number} params.rootCeilingHeight
 *    The maximum height from the surface to the tip of the root branch of the coral
 *
 * The mesh zero point is at the base of the coral where it is rooted
 */
export function branchingCoral_generateMesh(params: {
  rootNormalVec: THREE.Vector3;
  rootCeilingHeight: number;
  seedHash: string;
}) {
  let { rootNormalVec, rootCeilingHeight, seedHash } = params;

  rootNormalVec = rootNormalVec.normalize();

  const rng = seedrandom(seedHash);

  // @region [sub]
  const rootBranch_generateGeom = () => {
    const rootCeilingRadius = 0.01;
  };

  const mainBranch_generateGeom = (
    ceilingHeight: number,
    parentBranchForwardVec: THREE.Vector3,
  ): THREE.BufferGeometry | null => {
    return null;
  };
  // @endregion [sub]
}
