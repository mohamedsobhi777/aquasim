import GUI from 'lil-gui';
import type { AquaSimApp } from '../app';
import { SCENES } from '../scenes/registry';

export function createPanel(app: AquaSimApp): GUI {
  const gui = new GUI({ title: 'AquaSim' });
  const s = app.settings;

  const sceneFolder = gui.addFolder('Scene');
  sceneFolder
    .add(s, 'sceneId', Object.fromEntries(SCENES.map((m) => [m.label, m.id])))
    .name('scenario')
    .onFinishChange(() => {
      app.loadScene();
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    });
  sceneFolder.add(s, 'seed', 0, 9999, 1).onFinishChange(() => {
    app.loadScene();
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  });
  sceneFolder.add({ pause: () => app.clock.setPaused(!app.clock.isPaused) }, 'pause').name('pause / resume time');

  const water = gui.addFolder('Water (clear open ocean)');
  water.add(s.water, 'turbidity', 0, 1, 0.01);
  water.add(s.water, 'daylight', 0, 20, 0.1).name('surface light');
  water.add(s.water, 'enabled').name('water effects');

  const particles = gui.addFolder('Suspended particles');
  particles.add(s.particles, 'count', 0, 40000, 100).onChange(() => app.applySettings());
  particles.add(s.particles, 'currentSpeed', 0, 1, 0.01).name('current (m/s)');

  return gui;
}
