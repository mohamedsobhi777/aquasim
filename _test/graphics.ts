
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

  // @region [sub]
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

  const material = new THREE.MeshStandardMaterial({ color: "#d59a58" });

  const tube_mesh = new THREE.Mesh(tube_geom, material);
  const tubeCap_mesh = new THREE.Mesh(cap_geom, material);

  tube_mesh.add(tubeCap_mesh);

  return tube_mesh;
}



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