import * as THREE from "three";
import * as dat from "dat.gui";

function makeCurvedTube(
  x,
  p,
  {
    bend = 0.25,
    radius = 0.03,
    tubularSegments = 64,
    radialSegments = 16,
    color = 0x44aaff,
    capped = true,
  } = {},
) {
  p = THREE.MathUtils.clamp(p, -1, 1);

  // Start and end of the curved centreline.
  const start = new THREE.Vector3(0, 0, 0);
  const end = new THREE.Vector3(1, x, 0);

  // Calculate a sideways control-point offset in the XY plane.
  const direction = end.clone().sub(start).normalize();
  const normal = new THREE.Vector3(-direction.y, direction.x, 0);

  const control = start
    .clone()
    .add(end)
    .multiplyScalar(0.5)
    .addScaledVector(normal, p * bend);

  const curve = new THREE.QuadraticBezierCurve3(start, control, end);

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });

  const tubeGeometry = new THREE.TubeGeometry(
    curve,
    tubularSegments,
    radius,
    radialSegments,
    false, // false: this is not a loop
  );

  const tube = new THREE.Mesh(tubeGeometry, material);

  // One object to add to the scene and move/rotate as a unit.
  const group = new THREE.Group();
  group.add(tube);

  if (capped) {
    function createCap(t, facesOutward) {
      const capGeometry = new THREE.CircleGeometry(radius, radialSegments);
      const cap = new THREE.Mesh(capGeometry, material);

      // t = 0 is the start; t = 1 is the end.
      const position = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();

      cap.position.copy(position);

      // CircleGeometry initially faces +Z.
      const outwardDirection = facesOutward
        ? tangent.clone().negate()
        : tangent;

      cap.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        outwardDirection,
      );

      group.add(cap);
    }

    createCap(0, true); // outward from the starting end
    createCap(1, false); // outward from the ending end
  }

  return { group, curve, control, tube };
}

export class CoralMonitorScenario {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private gui: dat.GUI;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    gui: dat.GUI,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.gui = gui;
  }

  public init() {
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight1.position.set(5, 5, 5);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight2.position.set(-5, -5, -5);
    this.scene.add(dirLight2);
    const { group } = makeCurvedTube(
      5, // endpoint: (1, 0.4, 0)
      -0.01, // curve toward one side
      {
        bend: 0.3,
        radius: 0.2,
        color: 0xff8844,
      },
    );

    group.scale.set(1, 3, 1);

    this.scene.add(group);
  }
}
