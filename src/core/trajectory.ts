import * as THREE from 'three';

/** A camera pose at a simulation time. Plain arrays so trajectories serialise to JSON. */
export interface Pose {
  t: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

export interface Trajectory {
  name: string;
  poses: Pose[];
}

export function duration(trajectory: Trajectory): number {
  const { poses } = trajectory;
  return poses.length === 0 ? 0 : poses[poses.length - 1].t - poses[0].t;
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

/** Interpolates position linearly and orientation by slerp; clamps outside the time range. */
export function samplePose(trajectory: Trajectory, t: number): Pose {
  const { poses } = trajectory;
  if (poses.length === 0) throw new Error(`trajectory "${trajectory.name}" is empty`);
  if (t <= poses[0].t) return poses[0];
  if (t >= poses[poses.length - 1].t) return poses[poses.length - 1];

  let lo = 0;
  let hi = poses.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (poses[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = poses[lo];
  const b = poses[hi];
  const k = (t - a.t) / (b.t - a.t);
  qa.fromArray(a.quaternion);
  qb.fromArray(b.quaternion);
  qa.slerp(qb, k);
  return {
    t,
    position: [
      a.position[0] + (b.position[0] - a.position[0]) * k,
      a.position[1] + (b.position[1] - a.position[1]) * k,
      a.position[2] + (b.position[2] - a.position[2]) * k,
    ],
    quaternion: [qa.x, qa.y, qa.z, qa.w],
  };
}

export function poseFromObject(object: THREE.Object3D, t: number): Pose {
  return {
    t,
    position: [object.position.x, object.position.y, object.position.z],
    quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
  };
}

export function applyPose(object: THREE.Object3D, pose: Pose): void {
  object.position.fromArray(pose.position);
  object.quaternion.fromArray(pose.quaternion);
}

const lookMatrix = new THREE.Matrix4();
const up = new THREE.Vector3(0, 1, 0);
const quat = new THREE.Quaternion();

/**
 * Builds a constant-speed trajectory: the camera travels along `eye` points
 * while looking at the matching `target` points (a camera looks down -z).
 */
export function lookAtTrajectory(
  name: string,
  eye: readonly THREE.Vector3[],
  target: readonly THREE.Vector3[],
  speed: number,
): Trajectory {
  if (eye.length !== target.length) throw new Error('eye and target point counts differ');
  if (eye.length < 2) throw new Error('a trajectory needs at least two points');
  if (speed <= 0) throw new Error('speed must be positive');

  let t = 0;
  const poses = eye.map((p, i) => {
    if (i > 0) t += p.distanceTo(eye[i - 1]) / speed;
    lookMatrix.lookAt(p, target[i], up);
    quat.setFromRotationMatrix(lookMatrix);
    return { t, position: [p.x, p.y, p.z], quaternion: [quat.x, quat.y, quat.z, quat.w] } as Pose;
  });
  return { name, poses };
}
