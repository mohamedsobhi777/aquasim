import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FrameCapturer } from './core/capture';
import { DatasetWriter, DirectorySink, ZipSink, type DatasetSink } from './core/dataset';
import { FrameStats } from './core/frameStats';
import { LabelPasses, type InstanceRecord } from './core/labelPasses';
import { lodUpdaters, type LodStats } from './core/lod';
import { SuspendedParticles } from './core/particles';
import { RobotTrack, yawOf } from './core/robotTrack';
import { SedimentPlumes } from './core/sediment';
import { createRng } from './core/rng';
import { Rov, RovController } from './core/rov';
import type { BuiltScene } from './core/sceneModule';
import { excludeFromLabels } from './core/semantics';
import { DEFAULT_SETTINGS, type CameraMode, type SimSettings } from './core/settings';
import { SimClock } from './core/simClock';
import { duration, samplePose, type Pose, type Trajectory } from './core/trajectory';
import { patchUnderwater, setWaterCoefficients, syncLamps, waterUniforms } from './core/water';
import { computeWaterCoefficients } from './core/waterModel';
import { reportToCsv, runEvaluation, type EvalHost, type EvaluationReport } from './eval/runner';
import { findScene } from './scenes/registry';

const BACKDROP_RADIUS = 300;
const CURRENT_DIRECTION = new THREE.Vector3(1, 0, 0.35).normalize();
const UP = new THREE.Vector3(0, 1, 0);
/** Where the world camera starts relative to the robot (robot heading frame): behind, above, to the side. */
const WORLD_CAMERA_OFFSET = new THREE.Vector3(2.2, 1.6, 4.5);
const WORLD_CAMERA_CLEARANCE = 0.3;

function trackPose(pose: Pose): { position: THREE.Vector3; yaw: number } {
  return { position: new THREE.Vector3(...pose.position), yaw: yawOf(new THREE.Quaternion(...pose.quaternion)) };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export interface Playback {
  trajectory: Trajectory;
  startTime: number;
}

export class AquaSimApp {
  readonly settings: SimSettings = structuredClone(DEFAULT_SETTINGS);
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly clock = new SimClock();
  readonly rov = new Rov();
  readonly controller: RovController;
  readonly stats = new FrameStats();
  readonly passes = new LabelPasses();
  /** Orbit camera for watching the robot from outside; never used for capture. */
  readonly worldCamera = new THREE.PerspectiveCamera(55, 1, 0.05, 400);
  private readonly orbit: OrbitControls;
  private readonly followAnchor = new THREE.Vector3();
  private readonly capturer: FrameCapturer;
  private readonly particles: SuspendedParticles;
  readonly sediment: SedimentPlumes;
  /** Recent robot path; drives the wake and kicked-up sediment. */
  readonly track = new RobotTrack();
  private lods: ReturnType<typeof lodUpdaters> = [];
  /** Geometry selected by level of detail for the last rendered view. */
  lodStats: LodStats = { triangles: 0, perLevel: [] };
  private readonly hemisphere = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  private readonly downwelling = new THREE.DirectionalLight(0xffffff, 1);
  private readonly backdrop: THREE.Mesh;
  private built?: BuiltScene;
  private instances: InstanceRecord[] = [];
  private lastWall = performance.now();
  private capturing = false;
  playback: Playback | null = null;
  /** The most recent evaluation, for display. */
  lastEvaluation: EvaluationReport | null = null;
  onStatus: (message: string) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.capturer = new FrameCapturer(this.renderer, this.passes);
    this.controller = new RovController(this.rov, canvas);
    this.orbit = new OrbitControls(this.worldCamera, canvas);
    this.orbit.enabled = false;
    this.orbit.enableDamping = true;
    this.orbit.minDistance = 1.5;
    this.orbit.maxDistance = 80;
    this.particles = new SuspendedParticles(this.settings.seed);
    this.sediment = new SedimentPlumes();

    // Open water: a black backdrop that receives veiling light and lamp in-scatter.
    this.backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(BACKDROP_RADIUS, 32, 16),
      patchUnderwater(new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, depthWrite: false })),
    );
    this.backdrop.name = 'water-backdrop';
    this.backdrop.renderOrder = -1;
    excludeFromLabels(this.backdrop);

    this.downwelling.position.set(0.3, 1, 0.2);
    this.scene.add(this.hemisphere, this.downwelling, this.backdrop, this.rov.body, this.particles.points, this.sediment.mesh);

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
    this.instances = this.passes.prepare(built.root, built.classes);
    this.lods = lodUpdaters(built.root);
    this.settings.water.presetId = built.water.presetId;
    this.settings.water.turbidity = built.water.turbidity;
    this.rov.setPose(built.spawn);
    this.track.clear();
    this.playback = null;
    this.controller.enabled = true;
    this.clock.set(0);
    this.applySettings();
    this.setCameraMode(this.settings.render.camera);
  }

  get activeCamera(): THREE.PerspectiveCamera {
    return this.settings.render.camera === 'world' ? this.worldCamera : this.rov.camera;
  }

  setCameraMode(mode: CameraMode): void {
    this.settings.render.camera = mode;
    const world = mode === 'world';
    this.orbit.enabled = world;
    this.controller.mouseLook = !world;
    this.rov.setModelVisible(world);
    if (world) this.placeWorldCamera();
  }

  /** Puts the world camera behind and above the robot, looking at it. */
  private placeWorldCamera(): void {
    const robot = this.rov.body.position;
    const heading = new THREE.Quaternion().setFromAxisAngle(UP, this.rov.yaw);
    this.worldCamera.position.copy(robot).add(WORLD_CAMERA_OFFSET.clone().applyQuaternion(heading));
    this.orbit.target.copy(robot);
    this.followAnchor.copy(robot);
    this.orbit.update();
  }

  /** Carries the world camera along with the robot so the user's chosen orbit angle is kept. */
  private followRobot(): void {
    if (this.settings.render.camera !== 'world') return;
    const delta = this.rov.body.position.clone().sub(this.followAnchor);
    this.worldCamera.position.add(delta);
    this.orbit.target.add(delta);
    this.followAnchor.copy(this.rov.body.position);
    this.orbit.update();
    const p = this.worldCamera.position;
    p.y = Math.max(p.y, this.scenario.groundHeight(p.x, p.z) + WORLD_CAMERA_CLEARANCE);
  }

  get scenario(): BuiltScene {
    if (!this.built) throw new Error('No scene loaded');
    return this.built;
  }

  get instanceCount(): number {
    return this.instances.reduce((sum, r) => sum + r.count, 0);
  }

  /** Pushes settings that do not change every frame into renderer, lamps and particles. */
  applySettings(): void {
    const { lamps, particles, camera, render } = this.settings;
    this.renderer.toneMappingExposure = render.exposure;
    this.rov.camera.fov = camera.fov;
    this.rov.camera.updateProjectionMatrix();
    this.rov.setLampSpacing(lamps.spacing);
    this.rov.lamps.forEach((lamp) => {
      lamp.visible = lamps.on;
      lamp.intensity = lamps.intensity;
      lamp.angle = THREE.MathUtils.degToRad(lamps.angleDeg);
      lamp.castShadow = lamps.shadows;
    });
    waterUniforms.uLampScatter.value = lamps.scatter;
    waterUniforms.uBeamShadows.value = lamps.beamShadows ? 1 : 0;
    this.particles.setCount(particles.count);
  }

  private updateWater(): void {
    const depth = Math.max(0, this.scenario.surfaceHeight - this.rov.body.position.y);
    const { presetId, turbidity, enabled, daylight } = this.settings.water;
    const c = computeWaterCoefficients({ presetId, turbidity, depth });
    setWaterCoefficients(c, enabled);
    const ambient = new THREE.Color(c.ambient[0], c.ambient[1], c.ambient[2]);
    this.hemisphere.color.copy(ambient).multiplyScalar(enabled ? daylight * 0.35 : 1.2);
    this.hemisphere.groundColor.copy(ambient).multiplyScalar(enabled ? daylight * 0.05 : 0.3);
    this.downwelling.color.copy(ambient).multiplyScalar(enabled ? daylight * 0.25 : 1.5);
  }

  play(trajectory: Trajectory): void {
    this.playback = { trajectory, startTime: this.clock.now };
    this.controller.enabled = false;
  }

  stopPlayback(): void {
    this.playback = null;
    this.controller.enabled = true;
  }

  private step(dt: number): void {
    const time = this.clock.now;
    if (this.playback) {
      const local = time - this.playback.startTime;
      this.rov.setPose(samplePose(this.playback.trajectory, local));
      if (local > duration(this.playback.trajectory)) this.stopPlayback();
    } else {
      this.controller.update(dt);
      this.rov.keepAboveGround(this.scenario.groundHeight);
    }
    this.scenario.update?.(time, dt);
    this.track.record(time, this.rov.body.position, yawOf(this.rov.body.quaternion), this.scenario.groundHeight);
    this.followRobot();
    this.syncFrame(this.activeCamera);
  }

  /** Brings every time- and camera-dependent uniform up to date for rendering. */
  private syncFrame(camera: THREE.PerspectiveCamera, imageHeight = this.renderer.domElement.height): void {
    this.rov.body.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const position = camera.getWorldPosition(new THREE.Vector3());
    this.backdrop.position.copy(position);
    this.updateWater();
    const pixelScale = imageHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const current = CURRENT_DIRECTION.clone().multiplyScalar(this.settings.particles.currentSpeed);
    this.updateLod(camera, pixelScale);
    this.particles.sync(this.clock.now, position, current, pixelScale);
    this.particles.setWake(this.clock.now, this.track.all, this.settings.particles.wake);
    const { enabled, strength } = this.settings.sediment;
    this.sediment.sync(this.clock.now, this.track.all, enabled ? strength : 0, current, this.scenario.groundHeight, position);
    syncLamps(camera, this.rov.lamps);
  }

  /** Picks detail levels for the camera about to render; RGB and label passes then share the same geometry. */
  private updateLod(camera: THREE.Camera, pixelScale: number): void {
    const view = { camera, pixelScale, enabled: this.settings.render.lod };
    const stats: LodStats = { triangles: 0, perLevel: [] };
    for (const update of this.lods) {
      const s = update(view);
      stats.triangles += s.triangles;
      s.perLevel.forEach((n, i) => (stats.perLevel[i] = (stats.perLevel[i] ?? 0) + n));
    }
    this.lodStats = stats;
  }

  frame = (): void => {
    const now = performance.now();
    const wallDelta = (now - this.lastWall) / 1000;
    this.lastWall = now;
    this.stats.push(wallDelta * 1000);

    if (!this.capturing) {
      this.step(this.clock.tick(wallDelta));
      this.renderView();
    }
    requestAnimationFrame(this.frame);
  };

  private renderView(): void {
    const view = this.settings.render.view;
    const render = (): void => this.renderer.render(this.scene, this.activeCamera);
    if (view === 'rgb') {
      render();
      return;
    }
    const clear = this.renderer.getClearColor(new THREE.Color());
    this.renderer.setClearColor(0x000000);
    try {
      this.passes.withPass(this.scene, view, true, render);
    } finally {
      this.renderer.setClearColor(clear);
    }
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    this.renderer.setSize(clientWidth, clientHeight, false);
    for (const camera of [this.rov.camera, this.worldCamera]) {
      camera.aspect = clientWidth / Math.max(1, clientHeight);
      camera.updateProjectionMatrix();
    }
  }

  private manifest(trajectory: Trajectory | null) {
    return {
      scene: this.settings.sceneId,
      seed: this.settings.seed,
      trajectory: trajectory?.name ?? null,
      classes: this.scenario.classes,
      instances: this.instances,
      settings: structuredClone(this.settings) as unknown as Record<string, unknown>,
    };
  }

  private async openSink(name: string): Promise<DatasetSink> {
    if (DirectorySink.isSupported()) {
      try {
        return await DirectorySink.pick(name);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        console.warn('Folder export unavailable, falling back to zip download', error);
      }
    }
    return new ZipSink(`${name}.zip`);
  }

  /** Captures the current view (all passes) as a one-frame dataset. */
  async captureCurrent(): Promise<void> {
    await this.runCapture(null, async (writer) => {
      this.syncFrame(this.rov.camera, this.settings.capture.height);
      await writer.addFrame(this.capturer.capture(this.scene, this.rov.camera, this.settings.capture), this.clock.now);
    });
  }

  /**
   * Freezes the simulation at time `t` of a trajectory and syncs everything for
   * a robot-camera render `height` pixels tall. Only depends on `t`, so frames
   * can be produced in any order.
   */
  private prepareTrajectoryFrame(trajectory: Trajectory, t: number, height: number): void {
    this.clock.set(t);
    this.rov.setPose(samplePose(trajectory, t));
    this.scenario.update?.(t, 0);
    this.track.rebuild(t, (s) => trackPose(samplePose(trajectory, s)), this.scenario.groundHeight);
    this.syncFrame(this.rov.camera, height);
  }

  /** Replays a trajectory deterministically and captures evenly spaced frames. */
  async captureTrajectory(trajectory: Trajectory): Promise<void> {
    const { frames } = this.settings.capture;
    const total = duration(trajectory);
    await this.runCapture(trajectory, async (writer) => {
      for (let i = 0; i < frames; i++) {
        const t = frames === 1 ? 0 : (total * i) / (frames - 1);
        this.prepareTrajectoryFrame(trajectory, t, this.settings.capture.height);
        const frame = this.capturer.capture(this.scene, this.rov.camera, this.settings.capture);
        await writer.addFrame(frame, t, { trajectoryTime: t, sedimentPuffs: this.sediment.puffCount });
        this.onStatus(`Captured ${i + 1}/${frames}`);
      }
    });
  }

  private async runCapture(trajectory: Trajectory | null, body: (writer: DatasetWriter) => Promise<void>): Promise<void> {
    if (this.capturing) throw new Error('A capture is already running');
    const sink = await this.openSink(`aquasim_${this.settings.sceneId}_${trajectory?.name ?? 'snapshot'}_${timestamp()}`);
    const writer = new DatasetWriter(sink, this.manifest(trajectory));
    await this.exclusive(trajectory !== null, async () => {
      await body(writer);
      await writer.finish();
      this.onStatus(`Saved ${writer.frames} frame(s)`);
    });
  }

  /**
   * Runs offline work (captures, evaluations) with the live loop stopped,
   * time frozen and the robot model hidden; restores everything afterwards.
   * `movesTime`: the work jumps the clock, so put it and the track back.
   */
  private async exclusive<T>(movesTime: boolean, body: () => Promise<T>): Promise<T> {
    if (this.capturing) throw new Error('A capture is already running');
    const wasPaused = this.clock.isPaused;
    const savedTime = this.clock.now;
    const modelVisible = this.rov.model.group.visible;
    this.capturing = true;
    this.clock.setPaused(true);
    // Datasets are always taken from the robot's camera, without the robot in view.
    this.rov.setModelVisible(false);
    try {
      return await body();
    } finally {
      if (movesTime) {
        this.clock.set(savedTime);
        this.track.clear();
      }
      this.clock.setPaused(wasPaused);
      this.rov.setModelVisible(modelVisible);
      this.capturing = false;
      this.lastWall = performance.now();
    }
  }

  /**
   * Effect-by-effect evaluation along a trajectory: frame time, geometry,
   * image change and label checks per variant. Downloads JSON + CSV.
   */
  async evaluate(trajectory: Trajectory): Promise<EvaluationReport> {
    const report = await this.exclusive(true, () => runEvaluation(this.evalHost(), trajectory, { size: this.settings.capture, ...this.settings.evaluation }, this.onStatus));
    this.lastEvaluation = report;
    const sink = new ZipSink(`aquasim_eval_${report.scene}_${report.trajectory}_${timestamp()}.zip`);
    const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
    await sink.write('evaluation.json', encode(JSON.stringify(report, null, 2)));
    await sink.write('evaluation.csv', encode(reportToCsv(report)));
    await sink.finish();
    this.onStatus(`Evaluation done: ${report.variants.length} variants x ${report.frames} frames`);
    return report;
  }

  private evalHost(): EvalHost {
    const gl = this.renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      settings: this.settings,
      applySettings: () => this.applySettings(),
      prepareFrame: (trajectory, t, height) => this.prepareTrajectoryFrame(trajectory, t, height),
      timeRgb: (size, repeats) => this.capturer.timeRgb(this.scene, this.rov.camera, size, repeats),
      capture: (size) => this.capturer.capture(this.scene, this.rov.camera, size),
      lodTriangles: () => this.lodStats.triangles,
      sceneId: this.settings.sceneId,
      rendererName: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown',
    };
  }

  get isCapturing(): boolean {
    return this.capturing;
  }
}
