import * as THREE from 'three';
import { createRovModel, layoutLamps, type RovModel } from './rovModel';
import type { Pose } from './trajectory';
import { applyPose } from './trajectory';

export interface RovConfig {
  fov: number;
  lampIntensity: number;
  /** Half-angle of each lamp cone, radians. */
  lampAngle: number;
  lampPenumbra: number;
  /** Horizontal distance between the two lamps, metres. Wider spacing reduces backscatter. */
  lampSpacing: number;
  shadowMapSize: number;
}

export const DEFAULT_ROV_CONFIG: RovConfig = {
  fov: 60,
  lampIntensity: 60,
  lampAngle: THREE.MathUtils.degToRad(30),
  lampPenumbra: 0.45,
  lampSpacing: 1.6,
  shadowMapSize: 1024,
};

const LAMP_RANGE = 45;
const MIN_CLEARANCE = 0.5;
const MAX_PITCH = THREE.MathUtils.degToRad(80);

/** The camera robot: a forward camera with two lamps mounted on either side. */
export class Rov {
  readonly body = new THREE.Group();
  readonly camera: THREE.PerspectiveCamera;
  readonly lamps: THREE.SpotLight[];
  /** Vehicle geometry, shown only when viewing the robot from outside. */
  readonly model: RovModel;
  yaw = 0;
  pitch = 0;

  constructor(config: RovConfig = DEFAULT_ROV_CONFIG) {
    this.body.name = 'rov';
    this.camera = new THREE.PerspectiveCamera(config.fov, 1, 0.05, 400);
    this.body.add(this.camera);

    this.lamps = [-1, 1].map((side) => {
      const lamp = new THREE.SpotLight(
        0xfff4e0,
        config.lampIntensity,
        LAMP_RANGE,
        config.lampAngle,
        config.lampPenumbra,
        2,
      );
      lamp.name = side < 0 ? 'lamp-left' : 'lamp-right';
      lamp.position.set((side * config.lampSpacing) / 2, 0.12, 0.05);
      lamp.target.position.set(0, -0.8, -10);
      lamp.castShadow = true;
      lamp.shadow.mapSize.setScalar(config.shadowMapSize);
      lamp.shadow.camera.near = 0.2;
      lamp.shadow.camera.far = LAMP_RANGE;
      lamp.shadow.bias = -0.0004;
      this.body.add(lamp, lamp.target);
      return lamp;
    });

    this.model = createRovModel(config.lampSpacing);
    this.model.group.visible = false;
    this.body.add(this.model.group);
  }

  setLampSpacing(spacing: number): void {
    this.lamps.forEach((lamp, i) => lamp.position.setX(((i === 0 ? -1 : 1) * spacing) / 2));
    layoutLamps(this.model, spacing);
  }

  setModelVisible(visible: boolean): void {
    this.model.group.visible = visible;
  }

  /** Rebuilds the body orientation from yaw/pitch (no roll for manual piloting). */
  applyYawPitch(): void {
    this.body.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  setPose(pose: Pose): void {
    applyPose(this.body, pose);
    const euler = new THREE.Euler().setFromQuaternion(this.body.quaternion, 'YXZ');
    this.yaw = euler.y;
    this.pitch = euler.x;
  }

  keepAboveGround(groundHeight: (x: number, z: number) => number): void {
    const floor = groundHeight(this.body.position.x, this.body.position.z) + MIN_CLEARANCE;
    if (this.body.position.y < floor) this.body.position.y = floor;
  }
}

const THRUST = 2.2; // m/s^2
const BOOST = 3;
const DRAG = 1.6; // 1/s, linear water drag
const TURN_RATE = 1.2; // rad/s
const MOUSE_SENSITIVITY = 0.0035;

/** Keyboard + mouse piloting: WASD move, Q/E down/up, arrows turn, drag to look, Shift boosts. */
export class RovController {
  enabled = true;
  /** Mouse drag turns the robot; disabled while the world camera owns the mouse. */
  mouseLook = true;
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private dragging = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly rov: Rov,
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
        if (!this.dragging || !this.enabled || !this.mouseLook) return;
        this.rov.yaw -= e.movementX * MOUSE_SENSITIVITY;
        this.rov.pitch = THREE.MathUtils.clamp(this.rov.pitch - e.movementY * MOUSE_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
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
    if (!this.enabled) {
      this.velocity.set(0, 0, 0);
      return;
    }
    const { rov } = this;
    rov.yaw += this.axis('ArrowLeft', 'ArrowRight') * TURN_RATE * dt;
    rov.pitch = THREE.MathUtils.clamp(
      rov.pitch + this.axis('ArrowUp', 'ArrowDown') * TURN_RATE * dt,
      -MAX_PITCH,
      MAX_PITCH,
    );
    rov.applyYawPitch();

    const thrust = new THREE.Vector3(this.axis('KeyD', 'KeyA'), this.axis('KeyE', 'KeyQ'), this.axis('KeyS', 'KeyW'));
    if (thrust.lengthSq() > 0) {
      thrust.normalize().multiplyScalar(THRUST * (this.keys.has('ShiftLeft') ? BOOST : 1));
      // Horizontal thrust follows heading only; vertical thrust stays world-up.
      const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rov.yaw);
      thrust.applyQuaternion(heading);
    }
    this.velocity.addScaledVector(thrust, dt).multiplyScalar(Math.exp(-DRAG * dt));
    rov.body.position.addScaledVector(this.velocity, dt);
  }

  get speed(): number {
    return this.velocity.length();
  }

  dispose(): void {
    this.abort.abort();
  }
}
