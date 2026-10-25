import * as THREE from 'three';

/** Spacing of track samples, seconds. Samples sit on a fixed time grid (k * interval). */
export const TRACK_INTERVAL = 0.2;
/** How much history is kept, seconds (longest-lived effect: sediment plumes). */
export const TRACK_WINDOW = 30;
/** A gap longer than this between samples means the robot was teleported, not flown. */
const MAX_FLIGHT_GAP = 1;

const FORWARD = new THREE.Vector3();

/** Heading of a camera orientation (rotation about +y, 0 = looking down -z). */
export function yawOf(quaternion: THREE.Quaternion): number {
  FORWARD.set(0, 0, -1).applyQuaternion(quaternion);
  return Math.atan2(-FORWARD.x, -FORWARD.z);
}

export interface TrackSample {
  /** Simulation time, a multiple of TRACK_INTERVAL. */
  t: number;
  position: THREE.Vector3;
  /** m/s, finite difference to the previous sample (zero after a jump). */
  velocity: THREE.Vector3;
  yaw: number;
  /** Height of the robot origin (camera) above the ground directly below. */
  altitude: number;
}

/**
 * The robot's recent path. Wake and kicked-up sediment are pure functions of
 * this track and the current time, so a trajectory capture can rebuild the
 * exact same history for any frame instead of depending on frame spacing.
 */
export class RobotTrack {
  private readonly samples: TrackSample[] = [];

  get all(): readonly TrackSample[] {
    return this.samples;
  }

  clear(): void {
    this.samples.length = 0;
  }

  /** Adds a sample when `t` reaches the next grid slot. Going back in time restarts the track. */
  record(t: number, position: THREE.Vector3, yaw: number, groundHeight: (x: number, z: number) => number): void {
    const slot = Math.floor(t / TRACK_INTERVAL + 1e-6) * TRACK_INTERVAL;
    const last = this.samples[this.samples.length - 1];
    if (last && slot < last.t - 1e-6) this.clear();
    else if (last && slot - last.t < TRACK_INTERVAL * 0.5) return;
    this.push(slot, position, yaw, groundHeight);
    this.prune(slot);
  }

  /** Replaces the track with the path given by `poseAt` over the window ending at `now`. */
  rebuild(
    now: number,
    poseAt: (t: number) => { position: THREE.Vector3; yaw: number },
    groundHeight: (x: number, z: number) => number,
  ): void {
    this.clear();
    const lastSlot = Math.floor(now / TRACK_INTERVAL + 1e-6);
    const firstSlot = Math.max(0, lastSlot - Math.round(TRACK_WINDOW / TRACK_INTERVAL));
    for (let k = firstSlot; k <= lastSlot; k++) {
      const t = k * TRACK_INTERVAL;
      const pose = poseAt(t);
      this.push(t, pose.position, pose.yaw, groundHeight);
    }
  }

  private push(t: number, position: THREE.Vector3, yaw: number, groundHeight: (x: number, z: number) => number): void {
    const last = this.samples[this.samples.length - 1];
    const velocity = new THREE.Vector3();
    if (last && t - last.t > 1e-6 && t - last.t <= MAX_FLIGHT_GAP)
      velocity.subVectors(position, last.position).divideScalar(t - last.t);
    this.samples.push({
      t,
      position: position.clone(),
      velocity,
      yaw,
      altitude: position.y - groundHeight(position.x, position.z),
    });
  }

  private prune(now: number): void {
    const cutoff = now - TRACK_WINDOW;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].t < cutoff) drop++;
    if (drop > 0) this.samples.splice(0, drop);
  }
}
