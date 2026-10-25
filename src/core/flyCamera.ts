import * as THREE from 'three';
import { applyPose, type Pose } from './pose';

const FOV = 60;
const MIN_CLEARANCE = 0.5;
const MAX_PITCH = THREE.MathUtils.degToRad(80);

/** A free-flying underwater camera with yaw/pitch orientation (no roll). */
export class FlyCamera {
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 400);
  yaw = 0;
  pitch = 0;

  /** Rebuilds the camera orientation from yaw/pitch. */
  applyYawPitch(): void {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  setPose(pose: Pose): void {
    applyPose(this.camera, pose);
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = euler.y;
    this.pitch = euler.x;
  }

  keepAboveGround(groundHeight: (x: number, z: number) => number): void {
    const position = this.camera.position;
    const floor = groundHeight(position.x, position.z) + MIN_CLEARANCE;
    if (position.y < floor) position.y = floor;
  }
}

const THRUST = 2.2; // m/s^2
const DRAG = 1.6; // 1/s, linear water drag
const TURN_RATE = 1.2; // rad/s
const MOUSE_SENSITIVITY = 0.0035;

/** Keyboard + mouse flying: WASD move, Q/E down/up, arrow keys or mouse drag to look. */
export class FlyController {
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private dragging = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly fly: FlyCamera,
    element: HTMLElement,
  ) {
    const { signal } = this.abort;
    window.addEventListener('keydown', (e) => this.onKey(e, true), { signal });
    window.addEventListener('keyup', (e) => this.onKey(e, false), { signal });
    window.addEventListener('blur', () => this.keys.clear(), { signal });
    element.addEventListener(
      'pointerdown',
      (e) => {
        this.dragging = true;
        element.setPointerCapture(e.pointerId);
      },
      { signal },
    );
    element.addEventListener('pointerup', () => (this.dragging = false), { signal });
    element.addEventListener(
      'pointermove',
      (e) => {
        if (!this.dragging) return;
        this.fly.yaw -= e.movementX * MOUSE_SENSITIVITY;
        this.fly.pitch = THREE.MathUtils.clamp(this.fly.pitch - e.movementY * MOUSE_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
      },
      { signal },
    );
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
  }

  private axis(positive: string, negative: string): number {
    return (this.keys.has(positive) ? 1 : 0) - (this.keys.has(negative) ? 1 : 0);
  }

  update(dt: number): void {
    const { fly } = this;
    fly.yaw += this.axis('ArrowLeft', 'ArrowRight') * TURN_RATE * dt;
    fly.pitch = THREE.MathUtils.clamp(
      fly.pitch + this.axis('ArrowUp', 'ArrowDown') * TURN_RATE * dt,
      -MAX_PITCH,
      MAX_PITCH,
    );
    fly.applyYawPitch();

    const thrust = new THREE.Vector3(this.axis('KeyD', 'KeyA'), this.axis('KeyE', 'KeyQ'), this.axis('KeyS', 'KeyW'));
    if (thrust.lengthSq() > 0) {
      thrust.normalize().multiplyScalar(THRUST);
      // Horizontal thrust follows heading only; vertical thrust stays world-up.
      const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), fly.yaw);
      thrust.applyQuaternion(heading);
    }
    this.velocity.addScaledVector(thrust, dt).multiplyScalar(Math.exp(-DRAG * dt));
    fly.camera.position.addScaledVector(this.velocity, dt);
  }

  dispose(): void {
    this.abort.abort();
  }
}
