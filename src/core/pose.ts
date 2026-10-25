import * as THREE from 'three';

/** A camera pose. Plain arrays so poses serialise to JSON. */
export interface Pose {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

export function applyPose(object: THREE.Object3D, pose: Pose): void {
  object.position.fromArray(pose.position);
  object.quaternion.fromArray(pose.quaternion);
}

const lookMatrix = new THREE.Matrix4();
const up = new THREE.Vector3(0, 1, 0);
const quat = new THREE.Quaternion();

/** A camera at `eye` looking at `target` (a camera looks down -z). */
export function lookAtPose(eye: THREE.Vector3, target: THREE.Vector3): Pose {
  lookMatrix.lookAt(eye, target, up);
  quat.setFromRotationMatrix(lookMatrix);
  return { position: [eye.x, eye.y, eye.z], quaternion: [quat.x, quat.y, quat.z, quat.w] };
}
