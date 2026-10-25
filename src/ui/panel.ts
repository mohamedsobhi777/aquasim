import GUI from 'lil-gui';
import type { AquaSimApp } from '../app';
import type { CameraMode } from '../core/settings';
import { WATER_PRESETS } from '../core/waterModel';
import { showEvaluation } from './evalReport';
import { SCENES } from '../scenes/registry';

export function createPanel(app: AquaSimApp): GUI {
  const gui = new GUI({ title: 'AquaSim' });
  const s = app.settings;
  const apply = (): void => app.applySettings();
  const report = (error: unknown): void => {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    console.error(error);
    app.onStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`);
  };

  const sceneFolder = gui.addFolder('Scene');
  sceneFolder.add(s, 'sceneId', Object.fromEntries(SCENES.map((m) => [m.label, m.id]))).name('scenario').onFinishChange(() => app.loadScene());
  sceneFolder.add(s, 'seed', 0, 9999, 1).onFinishChange(() => {
    app.loadScene();
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  });
  sceneFolder.add({ pause: () => app.clock.setPaused(!app.clock.isPaused) }, 'pause').name('pause / resume time');

  const water = gui.addFolder('Water');
  water.add(s.water, 'presetId', Object.fromEntries(WATER_PRESETS.map((p) => [p.label, p.id]))).name('water type');
  water.add(s.water, 'turbidity', 0, 1, 0.01);
  water.add(s.water, 'daylight', 0, 20, 0.1).name('surface light');
  water.add(s.water, 'enabled').name('water effects');

  const lamps = gui.addFolder('Lamps');
  lamps.add(s.lamps, 'on').onChange(apply);
  lamps.add(s.lamps, 'intensity', 0, 150, 1).onChange(apply);
  lamps.add(s.lamps, 'angleDeg', 8, 60, 1).name('cone angle').onChange(apply);
  lamps.add(s.lamps, 'spacing', 0, 2.5, 0.05).name('spacing (m)').onChange(apply);
  lamps.add(s.lamps, 'scatter', 0, 5, 0.05).name('beam scatter').onChange(apply);
  lamps.add(s.lamps, 'shadows').onChange(apply);
  lamps.add(s.lamps, 'beamShadows').name('shadows in beams').onChange(apply);

  const particles = gui.addFolder('Suspended particles');
  particles.add(s.particles, 'count', 0, 40000, 100).onChange(apply);
  particles.add(s.particles, 'currentSpeed', 0, 1, 0.01).name('current (m/s)');
  particles.add(s.particles, 'wake').name('robot wake');
  const sediment = gui.addFolder('Kicked-up sediment');
  sediment.add(s.sediment, 'enabled').name('when flying low');
  sediment.add(s.sediment, 'strength', 0, 3, 0.05);

  const view = gui.addFolder('View');
  const cameraController = view
    .add(s.render, 'camera', { 'Robot camera': 'robot', 'World (orbit robot)': 'world' })
    .name('camera [V]')
    .onChange((mode: CameraMode) => app.setCameraMode(mode));
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyV' || e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    app.setCameraMode(s.render.camera === 'robot' ? 'world' : 'robot');
    cameraController.updateDisplay();
  });
  view.add(s.render, 'lod').name('level of detail');
  view.add(s.render, 'view', { 'RGB camera': 'rgb', 'Depth': 'depth', 'Semantic / instances': 'semantic' });
  view.add(s.render, 'exposure', 0.1, 4, 0.05).onChange(apply);
  view.add(s.camera, 'fov', 30, 110, 1).name('vertical fov').onChange(apply);

  const paths = gui.addFolder('Inspection paths');
  const choice = { trajectory: app.scenario.trajectories[0]?.name ?? '' };
  const names = (): string[] => app.scenario.trajectories.map((t) => t.name);
  const trajectoryController = paths.add(choice, 'trajectory', names());
  const selected = () => {
    const trajectory = app.scenario.trajectories.find((t) => t.name === choice.trajectory);
    if (!trajectory) throw new Error(`Unknown trajectory ${choice.trajectory}`);
    return trajectory;
  };
  paths.add({ play: () => app.play(selected()) }, 'play').name('▶ replay');
  paths.add({ stop: () => app.stopPlayback() }, 'stop').name('■ stop / fly manually');
  sceneFolder.onFinishChange(() => {
    trajectoryController.options(names());
    choice.trajectory = names()[0] ?? '';
    trajectoryController.updateDisplay();
  });

  const capture = gui.addFolder('Dataset capture');
  capture.add(s.capture, 'width', 64, 2048, 16);
  capture.add(s.capture, 'height', 64, 2048, 16);
  capture.add(s.capture, 'frames', 1, 2000, 1).name('frames per path');
  capture.add({ snap: () => app.captureCurrent().catch(report) }, 'snap').name('capture current view');
  capture.add({ path: () => app.captureTrajectory(selected()).catch(report) }, 'path').name('capture selected path');

  const evaluation = gui.addFolder('Evaluation');
  evaluation.add(s.evaluation, 'frames', 2, 240, 1).name('poses per path');
  evaluation.add(s.evaluation, 'repeats', 1, 15, 1).name('timed renders / pose');
  evaluation
    .add({ run: () => app.evaluate(selected()).then(showEvaluation).catch(report) }, 'run')
    .name('evaluate effects on path');
  evaluation.close();

  return gui;
}
