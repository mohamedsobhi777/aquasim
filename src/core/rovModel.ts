import * as THREE from 'three';
import { excludeFromLabels } from './semantics';
import { patchUnderwater } from './water';

/**
 * Visual model of a small work-class inspection ROV, in the robot's body
 * frame: the camera sits at the origin looking down -z, so the vehicle
 * extends behind it (+z). Visible only from the world camera; it is never in
 * captured datasets.
 */
export interface RovModel {
  group: THREE.Group;
  /** Lamp housings; their x follows the lamp spacing setting. */
  lampHousings: THREE.Object3D[];
  /** Arms from the frame to each lamp housing, rebuilt when spacing changes. */
  brackets: THREE.Group;
  bracketMaterial: THREE.Material;
}

const HALF_WIDTH = 0.55;
const LENGTH = 1.7;
const FRONT_Z = -0.12;
const BOTTOM_Y = -0.55;
const FRAME_TOP_Y = 0.3;

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

function bar(a: THREE.Vector3, b: THREE.Vector3, size: number, material: THREE.Material): THREE.Mesh {
  const direction = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, direction.length(), size), material);
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

/** Ducted thruster: open duct (a short tube) with a hub, axis along local y. */
function thruster(material: THREE.Material, hubMaterial: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 20, 1, true), material);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12), hubMaterial);
  group.add(duct, hub);
  return group;
}

export function createRovModel(lampSpacing: number): RovModel {
  const group = new THREE.Group();
  group.name = 'rov-model';

  const foam = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0xf2b21b, roughness: 0.65 }));
  const frame = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x1d1f21, roughness: 0.6, metalness: 0.3 }));
  const metal = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.35, metalness: 0.8 }));
  const duct = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.5, side: THREE.DoubleSide }));
  const glass = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x0b1a26, roughness: 0.05, metalness: 0.9 }));
  const lens = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1d0, emissiveIntensity: 2.5 }));
  const tether = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0xd94f1e, roughness: 0.6 }));

  const back = FRONT_Z + LENGTH;
  // Open frame: corner posts, top and bottom rails.
  for (const x of [-HALF_WIDTH, HALF_WIDTH]) {
    for (const z of [FRONT_Z + 0.05, back - 0.05]) group.add(bar(v(x, BOTTOM_Y, z), v(x, FRAME_TOP_Y, z), 0.05, frame));
    for (const y of [BOTTOM_Y, FRAME_TOP_Y]) group.add(bar(v(x, y, FRONT_Z), v(x, y, back), 0.05, frame));
  }
  for (const z of [FRONT_Z + 0.05, back - 0.05]) group.add(bar(v(-HALF_WIDTH, BOTTOM_Y, z), v(HALF_WIDTH, BOTTOM_Y, z), 0.05, frame));

  // Skids.
  for (const x of [-HALF_WIDTH + 0.1, HALF_WIDTH - 0.1]) group.add(bar(v(x, BOTTOM_Y - 0.08, FRONT_Z + 0.1), v(x, BOTTOM_Y - 0.08, back - 0.1), 0.06, metal));

  // Syntactic-foam buoyancy block with a chamfered nose.
  const buoyancy = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 2 + 0.06, 0.38, LENGTH - 0.25), foam);
  buoyancy.position.set(0, FRAME_TOP_Y + 0.19, FRONT_Z + LENGTH / 2 + 0.12);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, HALF_WIDTH * 2 + 0.06, 3, 1), foam);
  nose.rotation.set(0, 0, Math.PI / 2);
  nose.position.set(0, FRAME_TOP_Y + 0.19, FRONT_Z + 0.25);
  group.add(buoyancy, nose);

  // Electronics pod and camera housing (the camera itself is at the origin, facing -z).
  const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 20), metal);
  pod.rotation.x = Math.PI / 2;
  pod.position.set(0, -0.2, 0.75);
  const cameraHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 20), metal);
  cameraHousing.rotation.x = Math.PI / 2;
  cameraHousing.position.set(0, 0, 0.13);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  dome.rotation.x = -Math.PI / 2;
  dome.position.set(0, 0, 0.02);
  group.add(pod, cameraHousing, dome, bar(v(0, -0.08, 0.15), v(0, -0.2, 0.3), 0.04, frame));

  // Four vectored horizontal thrusters at 45 degrees and two vertical thrusters.
  for (const [x, z] of [
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ] as const) {
    const t = thruster(duct, metal);
    t.position.set(x * (HALF_WIDTH - 0.15), -0.32, z === 0 ? FRONT_Z + 0.35 : back - 0.3);
    t.rotation.set(Math.PI / 2, 0, (x * (z === 0 ? 1 : -1) * Math.PI) / 4);
    group.add(t);
  }
  for (const x of [-0.28, 0.28]) {
    const t = thruster(duct, metal);
    t.position.set(x, FRAME_TOP_Y + 0.19, FRONT_Z + LENGTH / 2 + 0.15);
    t.scale.set(1, 1.9, 1);
    group.add(t);
  }

  // Lamp housings on brackets; positions follow the lamp spacing.
  const lampHousings = [-1, 1].map((side) => {
    const housing = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.2, 16), metal);
    body.rotation.x = Math.PI / 2;
    body.position.z = 0.08;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.065, 16), lens);
    face.rotation.y = Math.PI;
    face.position.z = -0.025;
    housing.add(body, face);
    housing.userData.side = side;
    group.add(housing);
    return housing;
  });
  const brackets = new THREE.Group();
  brackets.name = 'lamp-brackets';
  group.add(brackets);

  // Stowed two-link manipulator on the lower front.
  const shoulder = v(-0.25, -0.42, FRONT_Z + 0.05);
  const elbow = v(-0.12, -0.3, FRONT_Z - 0.32);
  const wrist = v(0.12, -0.42, FRONT_Z - 0.22);
  group.add(bar(shoulder, elbow, 0.07, metal), bar(elbow, wrist, 0.06, metal));
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.1), frame);
  jaw.position.copy(wrist);
  group.add(jaw);

  // Tether rising from the back of the vehicle.
  const tetherCurve = new THREE.CatmullRomCurve3([v(0, FRAME_TOP_Y + 0.38, back - 0.15), v(0, 1.2, back + 0.4), v(0.4, 3.5, back + 1.2), v(1.2, 9, back + 2)]);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(tetherCurve, 40, 0.025, 8, false), tether));

  const model: RovModel = { group, lampHousings, brackets, bracketMaterial: frame };
  layoutLamps(model, lampSpacing);
  excludeFromLabels(group);
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) object.receiveShadow = true;
  });
  return model;
}

/** Places lamp housings (and their brackets) to match the lamp positions on the robot. */
export function layoutLamps(model: RovModel, spacing: number): void {
  model.brackets.children.forEach((child) => (child as THREE.Mesh).geometry.dispose());
  model.brackets.clear();
  model.lampHousings.forEach((housing) => {
    const side = housing.userData.side as number;
    housing.position.set((side * spacing) / 2, 0.12, 0.05);
    const anchor = v(side * HALF_WIDTH, FRAME_TOP_Y, FRONT_Z + 0.1);
    const mount = housing.position.clone().add(v(0, 0, 0.12));
    if (anchor.distanceTo(mount) > 0.05) model.brackets.add(bar(anchor, mount, 0.035, model.bracketMaterial));
  });
}
