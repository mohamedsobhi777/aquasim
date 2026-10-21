
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