import * as THREE from 'three';
import { FlyCamera, FlyController } from './core/flyCamera';
import { lodUpdaters } from './core/lod';
import { SuspendedParticles } from './core/particles';
import { createRng } from './core/rng';
import type { BuiltScene } from './core/sceneModule';
import { DEFAULT_SETTINGS, type SimSettings } from './core/settings';
import { SimClock } from './core/simClock';
import { patchUnderwater, setWaterCoefficients } from './core/water';
import { computeWaterCoefficients } from './core/waterModel';
import { findScene } from './scenes/registry';

const BACKDROP_RADIUS = 300;
const CURRENT_DIRECTION = new THREE.Vector3(1, 0, 0.35).normalize();
const EXPOSURE = 1.1;

export class AquaSimApp {
  readonly settings: SimSettings = structuredClone(DEFAULT_SETTINGS);
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly clock = new SimClock();
  readonly fly = new FlyCamera();
  private readonly controller: FlyController;
  private readonly particles: SuspendedParticles;
  private lods: ReturnType<typeof lodUpdaters> = [];
  private readonly hemisphere = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  private readonly downwelling = new THREE.DirectionalLight(0xffffff, 1);
  private readonly backdrop: THREE.Mesh;
  private built?: BuiltScene;
  private lastWall = performance.now();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = EXPOSURE;

    this.controller = new FlyController(this.fly, canvas);
    this.particles = new SuspendedParticles(this.settings.seed);

    // Open water: a black backdrop that receives the veiling light.
    this.backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(BACKDROP_RADIUS, 32, 16),
      patchUnderwater(new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, depthWrite: false })),
    );
    this.backdrop.name = 'water-backdrop';
    this.backdrop.renderOrder = -1;

    this.downwelling.position.set(0.3, 1, 0.2);
    this.scene.add(this.hemisphere, this.downwelling, this.backdrop, this.fly.camera, this.particles.points);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.loadScene();
  }

  loadScene(): void {
    if (this.built) {
      this.scene.remove(this.built.root);
      this.built.dispose();
    }
    const { sceneId, seed } = this.settings;
    const built = findScene(sceneId).build({ seed, rng: createRng(seed) });
    this.built = built;
    this.scene.add(built.root);
    this.lods = lodUpdaters(built.root);
    this.settings.water.turbidity = built.turbidity;
    this.fly.setPose(built.spawn);
    this.clock.set(0);
    this.applySettings();
  }

  get scenario(): BuiltScene {
    if (!this.built) throw new Error('No scene loaded');
    return this.built;
  }

  /** Camera depth below the water surface, metres (0 at the surface). */
  get depth(): number {
    return Math.max(0, this.scenario.surfaceHeight - this.fly.camera.position.y);
  }

  /** Pushes settings that do not change every frame into the particles. */
  applySettings(): void {
    this.particles.setCount(this.settings.particles.count);
  }

  private updateWater(): void {
    const { turbidity, enabled, daylight } = this.settings.water;
    const c = computeWaterCoefficients({ turbidity, depth: this.depth });
    setWaterCoefficients(c, enabled);
    const ambient = new THREE.Color(c.ambient[0], c.ambient[1], c.ambient[2]);
    this.hemisphere.color.copy(ambient).multiplyScalar(enabled ? daylight * 0.35 : 1.2);
    this.hemisphere.groundColor.copy(ambient).multiplyScalar(enabled ? daylight * 0.05 : 0.3);
    this.downwelling.color.copy(ambient).multiplyScalar(enabled ? daylight * 0.25 : 1.5);
  }

  private step(dt: number): void {
    const time = this.clock.now;
    this.controller.update(dt);
    this.fly.keepAboveGround(this.scenario.groundHeight);
    this.scenario.update?.(time, dt);

    const camera = this.fly.camera;
    camera.updateMatrixWorld();
    const position = camera.getWorldPosition(new THREE.Vector3());
    this.backdrop.position.copy(position);
    this.updateWater();
    const pixelScale = this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    for (const update of this.lods) update({ camera, pixelScale });
    const current = CURRENT_DIRECTION.clone().multiplyScalar(this.settings.particles.currentSpeed);
    this.particles.sync(time, position, current, pixelScale);
  }

  frame = (): void => {
    const now = performance.now();
    const wallDelta = (now - this.lastWall) / 1000;
    this.lastWall = now;
    this.step(this.clock.tick(wallDelta));
    this.renderer.render(this.scene, this.fly.camera);
    requestAnimationFrame(this.frame);
  };

  private resize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.fly.camera.aspect = clientWidth / Math.max(1, clientHeight);
    this.fly.camera.updateProjectionMatrix();
  }
}
